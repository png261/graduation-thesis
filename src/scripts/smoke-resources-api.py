#!/usr/bin/env python3
"""Smoke test the deployed Resources API and Cloudrift CodeBuild flow."""

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
import uuid
from typing import Any

import boto3


def api_request(base_url: str, path: str, token: str, method: str = "GET", body: dict[str, Any] | None = None) -> dict[str, Any]:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/{path.lstrip('/')}",
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8")
        raise RuntimeError(f"{method} {path} failed with {exc.code}: {detail}") from exc


def get_stack_outputs(stack_name: str, region: str) -> dict[str, str]:
    cloudformation = boto3.client("cloudformation", region_name=region)
    response = cloudformation.describe_stacks(StackName=stack_name)
    outputs = response["Stacks"][0].get("Outputs", [])
    return {item["OutputKey"]: item["OutputValue"] for item in outputs}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stack-name", default="Infrastructure-agent-stack")
    parser.add_argument("--region", default="us-east-2")
    parser.add_argument("--username", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--timeout-seconds", type=int, default=1200)
    args = parser.parse_args()

    session = boto3.Session(region_name=args.region)
    credentials = session.get_credentials()
    if credentials is None:
        raise RuntimeError("No local AWS credentials are configured")
    frozen = credentials.get_frozen_credentials()

    sts = session.client("sts")
    account_id = sts.get_caller_identity()["Account"]
    outputs = get_stack_outputs(args.stack_name, args.region)

    resources_api_url = outputs["ResourcesApiUrl"]
    client_id = outputs["CognitoClientId"]
    staging_bucket = outputs["StagingBucketName"]

    smoke_id = uuid.uuid4().hex[:12]
    state_key = f"cloudrift-smoke/{smoke_id}.plan.json"
    plan_payload = {
        "format_version": "1.2",
        "terraform_version": "1.7.0",
        "resource_changes": [
            {
                "address": "aws_s3_bucket.staging_bucket",
                "type": "aws_s3_bucket",
                "name": "staging_bucket",
                "change": {
                    "actions": ["no-op"],
                    "after": {
                        "bucket": staging_bucket,
                        "acl": "private",
                        "tags": {
                            "ManagedBy": "InfrastructureAgentSmoke",
                        },
                    },
                },
            }
        ],
    }

    cognito = session.client("cognito-idp")
    auth = cognito.initiate_auth(
        ClientId=client_id,
        AuthFlow="USER_PASSWORD_AUTH",
        AuthParameters={"USERNAME": args.username, "PASSWORD": args.password},
    )
    id_token = auth["AuthenticationResult"]["IdToken"]

    credential_payload = {
        "accountId": account_id,
        "region": args.region,
        "accessKeyId": frozen.access_key,
        "secretAccessKey": frozen.secret_key,
    }
    if frozen.token:
        credential_payload["sessionToken"] = frozen.token
    credential_response = api_request(resources_api_url, "/aws-credential", id_token, "POST", credential_payload)

    backend_response = api_request(
        resources_api_url,
        "/resources/state-backends",
        id_token,
        "POST",
        {
            "name": f"smoke-{smoke_id}",
            "bucket": staging_bucket,
            "key": state_key,
            "region": args.region,
            "service": "s3",
        },
    )
    backend = backend_response["backend"]
    backend_response = api_request(
        resources_api_url,
        f"/resources/state-backends/{backend['backendId']}/plan",
        id_token,
        "POST",
        {"plan": plan_payload},
    )
    backend = backend_response["backend"]
    scan_response = api_request(
        resources_api_url,
        "/resources/scans",
        id_token,
        "POST",
        {"backendId": backend["backendId"]},
    )
    scan_id = scan_response["scan"]["scanId"]

    deadline = time.time() + args.timeout_seconds
    latest_scan = scan_response["scan"]
    while time.time() < deadline:
        scans = api_request(resources_api_url, "/resources/scans", id_token)["scans"]
        latest_scan = next(scan for scan in scans if scan["scanId"] == scan_id)
        if latest_scan["status"] != "RUNNING":
            break
        time.sleep(15)

    summary = {
        "accountId": account_id,
        "credentialConfigured": credential_response["credential"]["configured"],
        "credentialRegion": credential_response["credential"].get("region"),
        "hasSessionToken": credential_response["credential"].get("hasSessionToken", False),
        "backendId": backend["backendId"],
        "service": backend.get("service"),
        "planUpdatedAt": backend.get("planUpdatedAt"),
        "stateObject": f"s3://{staging_bucket}/{state_key}",
        "scanId": scan_id,
        "status": latest_scan["status"],
        "driftAlerts": len(latest_scan.get("driftAlerts", [])),
        "policyAlerts": len(latest_scan.get("policyAlerts", [])),
        "currentResources": len(latest_scan.get("currentResources", [])),
    }
    if latest_scan.get("error"):
        summary["error"] = latest_scan["error"][:1000]
    print(json.dumps(summary, indent=2))
    return 0 if latest_scan["status"] == "SUCCEEDED" else 1


if __name__ == "__main__":
    sys.exit(main())
