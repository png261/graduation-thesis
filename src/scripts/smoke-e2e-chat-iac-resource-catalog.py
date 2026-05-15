#!/usr/bin/env python3
"""
End-to-end smoke for chat, IaC, and Resource Catalog drift detection.

The safe default validates auth, AgentCore chat, and Resource Catalog API access.
Terraform apply and AWS drift mutation are opt-in because they create or modify
AWS resources from https://github.com/png261/hcp-terraform.

Examples:
  SMOKE_COGNITO_USERNAME=dev@gmail.com SMOKE_COGNITO_PASSWORD=... \
  python scripts/smoke-e2e-chat-iac-resource-catalog.py \
    --state-bucket my-tf-state-bucket \
    --state-key smoke/hcp-terraform/terraform.tfstate \
    --save-local-aws-credential

  python scripts/smoke-e2e-chat-iac-resource-catalog.py \
    --state-bucket my-tf-state-bucket \
    --state-key smoke/hcp-terraform/terraform.tfstate \
    --save-local-aws-credential

  python scripts/smoke-e2e-chat-iac-resource-catalog.py \
    --state-bucket my-tf-state-bucket \
    --state-key smoke/hcp-terraform/terraform.tfstate \
    --save-local-aws-credential \
    --apply-iac --confirm-apply \
    --drift --confirm-drift
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any

import boto3
from botocore.exceptions import ClientError

from utils import get_stack_config


DEFAULT_REPO_URL = "https://github.com/png261/hcp-terraform"
DEFAULT_REPO_FULL_NAME = "png261/hcp-terraform"
DEFAULT_TERRAFORM_REGION = "us-west-2"
DEVOPS_AGENT = {"id": "agent1", "mention": "@devops", "name": "InfraQ", "avatar": "IQ"}


def log(message: str) -> None:
    print(message, flush=True)


def fail(message: str) -> None:
    raise RuntimeError(message)


def json_default(value: Any) -> Any:
    return str(value)


def output_key(outputs: dict[str, str], *names: str) -> str:
    for name in names:
        value = outputs.get(name)
        if value:
            return value
    fail(f"Missing CloudFormation output. Tried: {', '.join(names)}")


def decode_jwt_claims(token: str) -> dict[str, Any]:
    payload = token.split(".")[1]
    payload += "=" * (-len(payload) % 4)
    return json.loads(base64.urlsafe_b64decode(payload.encode("utf-8")))


def random_password() -> str:
    return f"Sm0ke!{secrets.token_urlsafe(18)}aA1!"


def create_temp_user(user_pool_id: str, client_id: str, region: str) -> dict[str, str]:
    cognito = boto3.client("cognito-idp", region_name=region)
    username = f"smoke-{uuid.uuid4().hex[:12]}@example.com"
    password = random_password()
    cognito.admin_create_user(
        UserPoolId=user_pool_id,
        Username=username,
        UserAttributes=[
            {"Name": "email", "Value": username},
            {"Name": "email_verified", "Value": "true"},
        ],
        MessageAction="SUPPRESS",
    )
    cognito.admin_set_user_password(
        UserPoolId=user_pool_id,
        Username=username,
        Password=password,
        Permanent=True,
    )
    auth = cognito.initiate_auth(
        AuthFlow="USER_PASSWORD_AUTH",
        ClientId=client_id,
        AuthParameters={"USERNAME": username, "PASSWORD": password},
    )
    tokens = auth["AuthenticationResult"]
    claims = decode_jwt_claims(tokens["IdToken"])
    return {
        "username": username,
        "password": password,
        "accessToken": tokens["AccessToken"],
        "idToken": tokens["IdToken"],
        "userId": claims["sub"],
    }


def delete_temp_user(user_pool_id: str, region: str, username: str) -> None:
    try:
        boto3.client("cognito-idp", region_name=region).admin_delete_user(
            UserPoolId=user_pool_id,
            Username=username,
        )
    except ClientError as exc:
        log(f"Warning: failed to delete temp Cognito user {username}: {exc}")


def authenticate_existing_user(client_id: str, region: str, username: str, password: str) -> dict[str, str]:
    cognito = boto3.client("cognito-idp", region_name=region)
    auth = cognito.initiate_auth(
        AuthFlow="USER_PASSWORD_AUTH",
        ClientId=client_id,
        AuthParameters={"USERNAME": username, "PASSWORD": password},
    )
    tokens = auth["AuthenticationResult"]
    claims = decode_jwt_claims(tokens["IdToken"])
    return {
        "username": username,
        "password": password,
        "accessToken": tokens["AccessToken"],
        "idToken": tokens["IdToken"],
        "userId": claims["sub"],
    }


def request_json(base_url: str, path: str, token: str, method: str = "GET", payload: dict[str, Any] | None = None) -> dict[str, Any]:
    url = urllib.parse.urljoin(base_url.rstrip("/") + "/", path.lstrip("/"))
    body = None
    if payload is not None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            data = response.read().decode("utf-8")
            return json.loads(data or "{}")
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8", "replace")
        fail(f"{method} {path} failed with HTTP {exc.code}: {error_body}")


def runtime_url(runtime_arn: str, region: str) -> str:
    escaped = urllib.parse.quote(runtime_arn, safe="")
    return f"https://bedrock-agentcore.{region}.amazonaws.com/runtimes/{escaped}/invocations?qualifier=DEFAULT"


def invoke_runtime(runtime_arn: str, region: str, access_token: str, session_id: str, payload: dict[str, Any]) -> list[dict[str, Any]]:
    request = urllib.request.Request(
        runtime_url(runtime_arn, region),
        data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
            "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": session_id,
            "X-Amzn-Trace-Id": f"1-{int(time.time()):08x}-{uuid.uuid4().hex[:24]}",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=240) as response:
            text = response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8", "replace")
        fail(f"AgentCore invocation failed with HTTP {exc.code}: {error_body}")

    events: list[dict[str, Any]] = []
    for line in text.splitlines():
        if not line.startswith("data:"):
            continue
        raw = line.split("data:", 1)[1].strip()
        if not raw:
            continue
        try:
            events.append(json.loads(raw))
        except json.JSONDecodeError:
            events.append({"data": raw})
    for event in events:
        if event.get("status") == "error":
            fail(f"AgentCore returned error: {event.get('error')}")
    return events


def runtime_action(runtime_arn: str, region: str, access_token: str, session_id: str, action: str, repository: dict[str, str] | None = None) -> dict[str, Any]:
    events = invoke_runtime(
        runtime_arn,
        region,
        access_token,
        session_id,
        {
            "prompt": action,
            "runtimeSessionId": session_id,
            "githubAction": action,
            **({"repository": repository} if repository else {}),
        },
    )
    return events[-1] if events else {}


def agent_text(events: list[dict[str, Any]]) -> str:
    chunks: list[str] = []
    for event in events:
        value = event.get("data")
        if isinstance(value, str):
            chunks.append(value)
        delta = event.get("delta")
        if isinstance(delta, dict) and isinstance(delta.get("text"), str):
            chunks.append(delta["text"])
    return "".join(chunks).strip()


def clone_repo(repo_url: str, destination: Path) -> None:
    if destination.exists():
        shutil.rmtree(destination)
    subprocess.run(["git", "clone", "--depth", "1", repo_url, str(destination)], check=True)


def write_s3_backend(repo_path: Path, bucket: str, key: str, region: str) -> None:
    backend_tf = repo_path / "backend.tf"
    backend_tf.write_text(
        "\n".join(
            [
                "terraform {",
                '  backend "s3" {}',
                "}",
                "",
            ]
        ),
        encoding="utf-8",
    )
    log(f"Wrote temporary S3 backend overlay at {backend_tf}")


def pick_terraform_binary() -> str:
    for name in ["tofu", "terraform"]:
        path = shutil.which(name)
        if path:
            return path
    fail("Neither tofu nor terraform is available on PATH")


def run_iac_apply(repo_path: Path, bucket: str, key: str, state_region: str) -> None:
    binary = pick_terraform_binary()
    init_cmd = [
        binary,
        "init",
        "-input=false",
        f"-backend-config=bucket={bucket}",
        f"-backend-config=key={key}",
        f"-backend-config=region={state_region}",
    ]
    apply_cmd = [binary, "apply", "-input=false", "-auto-approve"]
    log(f"Running {' '.join(init_cmd)}")
    subprocess.run(init_cmd, cwd=repo_path, check=True)
    log(f"Running {' '.join(apply_cmd)}")
    subprocess.run(apply_cmd, cwd=repo_path, check=True)


def run_iac_validate(repo_path: Path) -> None:
    binary = pick_terraform_binary()
    subprocess.run([binary, "fmt", "-check"], cwd=repo_path, check=True)
    subprocess.run([binary, "init", "-backend=false", "-input=false"], cwd=repo_path, check=True)
    subprocess.run([binary, "validate"], cwd=repo_path, check=True)


def local_aws_credential_payload(region: str) -> dict[str, Any]:
    session = boto3.Session(region_name=region)
    creds = session.get_credentials()
    if not creds:
        fail("No local AWS credentials are available for --save-local-aws-credential")
    frozen = creds.get_frozen_credentials()
    account_id = session.client("sts").get_caller_identity().get("Account", "")
    payload = {
        "credentialId": "smoke-local-aws",
        "name": "Smoke local AWS credential",
        "accountId": account_id,
        "region": region,
        "accessKeyId": frozen.access_key,
        "secretAccessKey": frozen.secret_key,
        "setActive": True,
    }
    if frozen.token:
        payload["sessionToken"] = frozen.token
    return payload


def ensure_credential(api_url: str, id_token: str, region: str, credential_id: str | None, save_local: bool) -> str:
    listing = request_json(api_url, "/aws-credentials", id_token)
    credentials = listing.get("credentials", [])
    active_id = listing.get("activeCredentialId") or ""
    if credential_id:
        if any(item.get("credentialId") == credential_id for item in credentials):
            return credential_id
        fail(f"Credential ID {credential_id} is not saved for this Resource Catalog user")
    if active_id:
        return active_id
    if save_local:
        saved = request_json(api_url, "/aws-credentials", id_token, "POST", local_aws_credential_payload(region))
        return saved["credential"]["credentialId"]
    fail("No Resource Catalog AWS credential is configured. Use --save-local-aws-credential or --credential-id.")


def repository_payload(repo_full_name: str, repo_url: str) -> dict[str, str]:
    owner, name = repo_full_name.split("/", 1)
    return {
        "fullName": repo_full_name,
        "owner": owner,
        "name": name,
        "defaultBranch": "main",
        "url": repo_url,
    }


def find_backend(backends: list[dict[str, Any]], bucket: str, key: str, repository: str) -> dict[str, Any] | None:
    for backend in backends:
        repo = backend.get("repository") or {}
        if backend.get("bucket") == bucket and backend.get("key") == key and repo.get("fullName") == repository:
            return backend
    return None


def ensure_state_backend(
    api_url: str,
    id_token: str,
    name: str,
    bucket: str,
    key: str,
    region: str,
    service: str,
    credential_id: str,
    repo: dict[str, str],
    force_new: bool,
) -> dict[str, Any]:
    backends = request_json(api_url, "/resources/state-backends", id_token).get("backends", [])
    if not force_new:
        existing = find_backend(backends, bucket, key, repo["fullName"])
        if existing:
            log(f"Reusing Resource Catalog backend {existing['backendId']}")
            return existing
    payload = {
        "name": name[:80],
        "bucket": bucket,
        "key": key,
        "region": region,
        "service": service,
        "credentialId": credential_id,
        "repository": repo,
    }
    created = request_json(api_url, "/resources/state-backends", id_token, "POST", payload)["backend"]
    log(f"Created Resource Catalog backend {created['backendId']}")
    return created


def start_scan(api_url: str, id_token: str, backend_id: str) -> dict[str, Any]:
    scan = request_json(api_url, "/resources/scans", id_token, "POST", {"backendId": backend_id})["scan"]
    log(f"Started Resource Catalog scan {scan['scanId']}")
    return scan


def poll_scan(api_url: str, id_token: str, scan_id: str, timeout_seconds: int) -> dict[str, Any]:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        scans = request_json(api_url, "/resources/scans", id_token).get("scans", [])
        scan = next((item for item in scans if item.get("scanId") == scan_id), None)
        if scan and scan.get("status") in {"SUCCEEDED", "FAILED"}:
            return scan
        time.sleep(15)
    fail(f"Timed out waiting for scan {scan_id}")


def create_and_run_drift_guard(api_url: str, id_token: str, backend_id: str, repo_full_name: str, timeout_seconds: int) -> dict[str, Any]:
    guard_id = f"smoke-{uuid.uuid4().hex[:12]}"
    guard = request_json(
        api_url,
        "/resources/drift-guards",
        id_token,
        "POST",
        {
            "guardId": guard_id,
            "name": f"Smoke Drift Guard {guard_id}",
            "backendId": backend_id,
            "repository": repo_full_name,
            "frequency": "manual",
            "enabled": True,
        },
    )["guard"]
    response = request_json(api_url, f"/resources/drift-guards/{guard['guardId']}/run", id_token, "POST", {})
    if response.get("skipped"):
        fail(f"Drift Guard was skipped: {response.get('reason')}")
    scan = response.get("scan") or {}
    log(f"Started Drift Guard scan {scan.get('scanId')}")
    return poll_scan(api_url, id_token, scan["scanId"], timeout_seconds)


def load_state_from_s3(bucket: str, key: str, region: str) -> dict[str, Any]:
    body = boto3.client("s3", region_name=region).get_object(Bucket=bucket, Key=key)["Body"].read()
    return json.loads(body.decode("utf-8"))


def managed_instances(state_payload: dict[str, Any]) -> list[dict[str, Any]]:
    instances: list[dict[str, Any]] = []
    for resource in state_payload.get("resources", []):
        if not isinstance(resource, dict) or resource.get("mode") != "managed":
            continue
        for instance in resource.get("instances", []):
            attrs = instance.get("attributes") if isinstance(instance, dict) else None
            if isinstance(attrs, dict):
                instances.append(
                    {
                        "address": f"{resource.get('type')}.{resource.get('name')}",
                        "type": resource.get("type"),
                        "name": resource.get("name"),
                        "attributes": attrs,
                    }
                )
    return instances


def aws_cmd(command: list[str]) -> None:
    log(f"Running drift command: {' '.join(command)}")
    subprocess.run(command, check=True)


def make_ec2_name_drift(state_payload: dict[str, Any], region: str, restore: bool) -> dict[str, Any]:
    for instance in managed_instances(state_payload):
        if instance["type"] != "aws_instance":
            continue
        attrs = instance["attributes"]
        instance_id = attrs.get("id")
        if not instance_id:
            continue
        tags = attrs.get("tags") if isinstance(attrs.get("tags"), dict) else {}
        original_name = tags.get("Name")
        drift_name = f"smoke-drift-{uuid.uuid4().hex[:8]}"
        aws_cmd(["aws", "ec2", "create-tags", "--region", region, "--resources", instance_id, "--tags", f"Key=Name,Value={drift_name}"])
        return {
            "resourceType": "aws_instance",
            "resourceId": instance_id,
            "field": "tags.Name",
            "driftValue": drift_name,
            "restoreCommand": ["aws", "ec2", "create-tags", "--region", region, "--resources", instance_id, "--tags", f"Key=Name,Value={original_name}"] if restore and original_name else None,
        }
    fail("No aws_instance resource was found in Terraform state to drift")


def restore_drift(drift: dict[str, Any]) -> None:
    command = drift.get("restoreCommand")
    if command:
        aws_cmd(command)


def save_chat_session(api_url: str, id_token: str, session_id: str, prompt: str, response_text: str, repo: dict[str, str]) -> None:
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    request_json(
        api_url,
        "/user/chat-sessions",
        id_token,
        "POST",
        {
            "activeSessionId": session_id,
            "sessions": [
                {
                    "id": session_id,
                    "name": "Smoke e2e chat",
                    "startDate": now,
                    "endDate": now,
                    "repository": repo,
                    "history": [
                        {"role": "user", "content": prompt, "timestamp": now, "agent": DEVOPS_AGENT},
                        {"role": "assistant", "content": response_text[:12000], "timestamp": now, "agent": DEVOPS_AGENT},
                    ],
                }
            ],
        },
    )


def run_chat_smoke(runtime_arn: str, api_url: str, region: str, access_token: str, id_token: str, repo: dict[str, str], require_repo_install: bool) -> dict[str, Any]:
    session_id = str(uuid.uuid4())
    installed = runtime_action(runtime_arn, region, access_token, session_id, "listInstalledRepositories")
    repos = installed.get("repositories") or installed.get("installedRepositories") or []
    repo_names = {item.get("fullName") or item.get("full_name") for item in repos if isinstance(item, dict)}
    repo_installed = repo["fullName"] in repo_names
    if repo_installed:
        runtime_action(runtime_arn, region, access_token, session_id, "setupRepositoryWorkspace", repo)
    elif require_repo_install:
        fail(f"{repo['fullName']} is not installed for the GitHub App")
    else:
        log(f"Warning: {repo['fullName']} is not installed for the GitHub App; chat smoke will run without workspace setup")

    prompt = (
        "Use the devops/IaC specialist path. Inspect the hcp-terraform project context if available, "
        "identify the Terraform provider and managed AWS resource types, and do not modify files or apply."
    )
    events = invoke_runtime(
        runtime_arn,
        region,
        access_token,
        session_id,
        {
            "prompt": prompt,
            "runtimeSessionId": session_id,
            "repository": repo if repo_installed else None,
            "agent": DEVOPS_AGENT,
        },
    )
    text = agent_text(events)
    if not text:
        fail("AgentCore chat smoke returned no assistant text")
    save_chat_session(api_url, id_token, session_id, prompt, text, repo)
    return {
        "sessionId": session_id,
        "repoInstalled": repo_installed,
        "eventCount": len(events),
        "responsePreview": text[:500],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--stack-name", default=None)
    parser.add_argument("--repo-url", default=DEFAULT_REPO_URL)
    parser.add_argument("--repo-full-name", default=DEFAULT_REPO_FULL_NAME)
    parser.add_argument("--state-bucket", default=os.environ.get("SMOKE_STATE_BUCKET", ""))
    parser.add_argument("--state-key", default=os.environ.get("SMOKE_STATE_KEY", "smoke/hcp-terraform/terraform.tfstate"))
    parser.add_argument("--state-region", default=os.environ.get("SMOKE_STATE_REGION", DEFAULT_TERRAFORM_REGION))
    parser.add_argument("--resource-service", choices=["s3", "ec2", "iam"], default="ec2")
    parser.add_argument("--credential-id", default=os.environ.get("SMOKE_AWS_CREDENTIAL_ID", ""))
    parser.add_argument("--save-local-aws-credential", action="store_true")
    parser.add_argument("--username", default=os.environ.get("SMOKE_COGNITO_USERNAME", ""))
    parser.add_argument("--password", default=os.environ.get("SMOKE_COGNITO_PASSWORD", ""))
    parser.add_argument("--keep-temp-user", action="store_true")
    parser.add_argument("--skip-chat", action="store_true")
    parser.add_argument("--require-github-install", action="store_true")
    parser.add_argument("--skip-local-validate", action="store_true")
    parser.add_argument("--apply-iac", action="store_true")
    parser.add_argument("--confirm-apply", action="store_true")
    parser.add_argument("--drift", action="store_true")
    parser.add_argument("--confirm-drift", action="store_true")
    parser.add_argument("--restore-drift", dest="restore_drift", action="store_true", default=True)
    parser.add_argument("--no-restore-drift", dest="restore_drift", action="store_false")
    parser.add_argument("--force-new-backend", action="store_true")
    parser.add_argument("--scan-timeout", type=int, default=900)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.apply_iac and not args.confirm_apply:
        fail("--apply-iac requires --confirm-apply")
    if args.drift and not args.confirm_drift:
        fail("--drift requires --confirm-drift")
    if (args.apply_iac or args.drift) and not args.state_bucket:
        fail("--state-bucket is required for apply or drift")

    stack = get_stack_config(args.stack_name)
    outputs = stack["outputs"]
    region = stack["region"]
    user_pool_id = output_key(outputs, "UserPoolId", "CognitoUserPoolId")
    client_id = output_key(outputs, "UserPoolClientId", "CognitoClientId")
    runtime_arn = output_key(outputs, "RuntimeArn", "AgentRuntimeArn")
    api_url = output_key(outputs, "ResourcesApiUrl", "ResourcesApiEndpoint", "ApiUrl")
    repo = repository_payload(args.repo_full_name, args.repo_url)
    temp_username = ""
    summary: dict[str, Any] = {"stack": stack["stack_name"], "region": region, "repository": repo["fullName"]}

    if args.username and args.password:
        auth = authenticate_existing_user(client_id, region, args.username, args.password)
    else:
        auth = create_temp_user(user_pool_id, client_id, region)
        temp_username = auth["username"]
    summary["userId"] = auth["userId"]

    try:
        with tempfile.TemporaryDirectory(prefix="hcp-terraform-smoke-") as temp_dir:
            repo_path = Path(temp_dir) / "repo"
            clone_repo(args.repo_url, repo_path)
            summary["repoPath"] = str(repo_path)
            if not args.skip_local_validate and not args.apply_iac:
                run_iac_validate(repo_path)
                summary["localValidate"] = "passed"
            if args.apply_iac:
                write_s3_backend(repo_path, args.state_bucket, args.state_key, args.state_region)
                run_iac_apply(repo_path, args.state_bucket, args.state_key, args.state_region)
                summary["apply"] = "completed"

            if not args.skip_chat:
                summary["chat"] = run_chat_smoke(
                    runtime_arn,
                    api_url,
                    region,
                    auth["accessToken"],
                    auth["idToken"],
                    repo,
                    args.require_github_install,
                )

            credential_id = ""
            credential_listing = request_json(api_url, "/aws-credentials", auth["idToken"])
            summary["resourceCatalog"] = {
                "credentialCount": len(credential_listing.get("credentials") or []),
                "activeCredentialId": credential_listing.get("activeCredentialId") or "",
            }

            if args.state_bucket:
                credential_id = ensure_credential(
                    api_url,
                    auth["idToken"],
                    args.state_region,
                    args.credential_id or None,
                    args.save_local_aws_credential,
                )
                summary["credentialId"] = credential_id
                backend = ensure_state_backend(
                    api_url,
                    auth["idToken"],
                    f"Smoke hcp-terraform {int(time.time())}",
                    args.state_bucket,
                    args.state_key,
                    args.state_region,
                    args.resource_service,
                    credential_id,
                    repo,
                    args.force_new_backend,
                )
                summary["backendId"] = backend["backendId"]
                scan = start_scan(api_url, auth["idToken"], backend["backendId"])
                scan = poll_scan(api_url, auth["idToken"], scan["scanId"], args.scan_timeout)
                summary["initialScan"] = {
                    "scanId": scan["scanId"],
                    "status": scan["status"],
                    "driftAlerts": len(scan.get("driftAlerts") or []),
                    "policyAlerts": len(scan.get("policyAlerts") or []),
                    "currentResources": len(scan.get("currentResources") or []),
                    "error": scan.get("error"),
                }
                if scan["status"] != "SUCCEEDED":
                    fail(f"Initial Resource Catalog scan failed: {scan.get('error')}")

                if args.drift:
                    state_payload = load_state_from_s3(args.state_bucket, args.state_key, args.state_region)
                    drift = make_ec2_name_drift(state_payload, DEFAULT_TERRAFORM_REGION, args.restore_drift)
                    summary["driftMutation"] = {key: value for key, value in drift.items() if key != "restoreCommand"}
                    try:
                        drift_scan = create_and_run_drift_guard(
                            api_url,
                            auth["idToken"],
                            backend["backendId"],
                            repo["fullName"],
                            args.scan_timeout,
                        )
                        summary["driftGuardScan"] = {
                            "scanId": drift_scan["scanId"],
                            "status": drift_scan["status"],
                            "driftAlerts": len(drift_scan.get("driftAlerts") or []),
                            "policyAlerts": len(drift_scan.get("policyAlerts") or []),
                            "currentResources": len(drift_scan.get("currentResources") or []),
                            "error": drift_scan.get("error"),
                        }
                        if drift_scan["status"] != "SUCCEEDED":
                            fail(f"Drift Guard scan failed: {drift_scan.get('error')}")
                        if not drift_scan.get("driftAlerts"):
                            fail("Drift Guard scan succeeded but did not report drift alerts")
                    finally:
                        if args.restore_drift:
                            restore_drift(drift)

        log(json.dumps(summary, indent=2, default=json_default))
        return 0
    finally:
        if temp_username and not args.keep_temp_user:
            delete_temp_user(user_pool_id, region, temp_username)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
