"""Resources API Lambda handler."""

import json
import os
import re
import time
import uuid
import base64
import hashlib
import hmac
import subprocess
import tempfile
from decimal import Decimal
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import boto3
import jwt
from botocore.exceptions import ClientError, UnknownServiceError

TABLE_NAME = os.environ["TABLE_NAME"]
CODEBUILD_PROJECT_NAME = os.environ["CODEBUILD_PROJECT_NAME"]
STACK_NAME_BASE = os.environ["STACK_NAME_BASE"]
DRIFT_GUARD_SCHEDULER_ROLE_ARN = os.environ.get("DRIFT_GUARD_SCHEDULER_ROLE_ARN", "")
RESOURCES_LAMBDA_ARN = os.environ.get("RESOURCES_LAMBDA_ARN", "")
GITHUB_APP_SECRET_NAME = os.environ.get("GITHUB_APP_SECRET_NAME", f"/{STACK_NAME_BASE}/github_app")
MEMORY_ID = os.environ.get("MEMORY_ID", "")
CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("CORS_ALLOWED_ORIGINS", "*").split(",")
    if origin.strip()
]

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)
secretsmanager = boto3.client("secretsmanager")
codebuild = boto3.client("codebuild")
cloudwatch_logs = boto3.client("logs")
scheduler = boto3.client("scheduler")
sns = boto3.client("sns")
s3 = boto3.client("s3")
RESOURCE_GRAPH_BUCKET = os.environ.get("RESOURCE_GRAPH_BUCKET", "")
AWS_ICONS_PATH = os.environ.get("AWS_ICONS_PATH", "/opt/aws-official-icons")
GITHUB_API = "https://api.github.com"


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _cors_headers(origin: str | None) -> dict[str, str]:
    allow_origin = CORS_ALLOWED_ORIGINS[0] if CORS_ALLOWED_ORIGINS else "*"
    if origin and (origin in CORS_ALLOWED_ORIGINS or "*" in CORS_ALLOWED_ORIGINS):
        allow_origin = origin
    return {
        "Access-Control-Allow-Origin": allow_origin,
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
        "Access-Control-Allow-Credentials": "true",
        "Content-Type": "application/json",
    }


def _json_default(value: Any) -> Any:
    if isinstance(value, Decimal):
        return int(value) if value % 1 == 0 else float(value)
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def _response(status_code: int, body: dict[str, Any], origin: str | None) -> dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": _cors_headers(origin),
        "body": json.dumps(body, default=_json_default),
    }


def _body(event: dict[str, Any]) -> dict[str, Any]:
    try:
        parsed = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError as exc:
        raise ValueError("Invalid JSON body") from exc
    if not isinstance(parsed, dict):
        raise ValueError("JSON body must be an object")
    return parsed


def _raw_body(event: dict[str, Any]) -> bytes:
    body = event.get("body") or ""
    if event.get("isBase64Encoded"):
        return base64.b64decode(body)
    return body.encode("utf-8")


def _user_id(event: dict[str, Any]) -> str:
    authorizer = event.get("requestContext", {}).get("authorizer", {})
    claims = authorizer.get("claims", {}) if isinstance(authorizer, dict) else {}
    user_id = claims.get("sub")
    if not user_id:
        raise PermissionError("Unauthorized")
    return user_id


def _user_metadata(user_id: str) -> dict[str, str]:
    response = table.get_item(Key={"pk": user_id, "sk": "PROFILE"})
    item = response.get("Item") or {}
    return {"email": str(item.get("email") or "")}


def _store_user_profile(user_id: str, event: dict[str, Any]) -> None:
    authorizer = event.get("requestContext", {}).get("authorizer", {})
    claims = authorizer.get("claims", {}) if isinstance(authorizer, dict) else {}
    email = str(claims.get("email") or "").strip()
    if not email:
        return
    timestamp = _now()
    table.put_item(
        Item={
            "pk": user_id,
            "sk": "PROFILE",
            "type": "profile",
            "email": email,
            "updatedAt": timestamp,
        }
    )


def _secret_name(user_id: str) -> str:
    return f"/{STACK_NAME_BASE}/user-aws-credentials/{user_id}"


def _mask_access_key(access_key_id: str) -> str:
    if len(access_key_id) <= 4:
        return "****"
    return f"****{access_key_id[-4:]}"


def _credential_id(payload: dict[str, Any]) -> str:
    value = str(payload.get("credentialId") or "").strip()
    if value:
        if not re.fullmatch(r"[A-Za-z0-9_.-]{1,80}", value):
            raise ValueError("credentialId is invalid")
        return value
    return str(uuid.uuid4())


def _credential_record_metadata(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "configured": True,
        "credentialId": record.get("credentialId"),
        "name": record.get("name"),
        "accountId": record.get("accountId"),
        "region": record.get("region"),
        "hasSessionToken": bool(record.get("sessionToken")),
        "accessKeyIdSuffix": _mask_access_key(record.get("accessKeyId", "")),
        "updatedAt": record.get("updatedAt"),
    }


def _credential_store(user_id: str) -> dict[str, Any]:
    try:
        secret = secretsmanager.get_secret_value(SecretId=_secret_name(user_id))
    except secretsmanager.exceptions.ResourceNotFoundException:
        return {"version": 2, "activeCredentialId": "", "credentials": {}}

    payload = json.loads(secret.get("SecretString") or "{}")
    if isinstance(payload.get("credentials"), dict):
        return payload

    credential_id = "default"
    legacy = {
        **payload,
        "credentialId": credential_id,
        "name": payload.get("name") or "Default credential",
    }
    return {
        "version": 2,
        "activeCredentialId": credential_id,
        "credentials": {credential_id: legacy},
    }


def _list_aws_credentials(user_id: str) -> dict[str, Any]:
    store = _credential_store(user_id)
    records = [
        _credential_record_metadata(record)
        for record in store.get("credentials", {}).values()
        if isinstance(record, dict)
    ]
    records.sort(key=lambda item: str(item.get("updatedAt") or ""), reverse=True)
    active_id = store.get("activeCredentialId") or (records[0].get("credentialId") if records else "")
    return {
        "credentials": records,
        "activeCredentialId": active_id,
    }


def _credential_metadata(user_id: str, credential_id: str | None = None) -> dict[str, Any]:
    store = _credential_store(user_id)
    credentials = store.get("credentials", {})
    target_id = credential_id or store.get("activeCredentialId")
    if not target_id and credentials:
        target_id = next(iter(credentials))
    record = credentials.get(target_id) if isinstance(credentials, dict) else None
    if not isinstance(record, dict):
        return {"configured": False}
    return _credential_record_metadata(record)


def _credential_payload(user_id: str, credential_id: str | None = None) -> dict[str, Any]:
    store = _credential_store(user_id)
    credentials = store.get("credentials", {})
    target_id = credential_id or store.get("activeCredentialId")
    if not target_id and credentials:
        target_id = next(iter(credentials))
    record = credentials.get(target_id) if isinstance(credentials, dict) else None
    if not isinstance(record, dict):
        raise ValueError("AWS credentials must be saved before using resource builder")
    return record


def _validate_aws_credential(payload: dict[str, Any]) -> tuple[str, str, str, str, str | None]:
    account_id = str(payload.get("accountId") or "").strip()
    region = str(payload.get("region") or "").strip()
    access_key_id = str(payload.get("accessKeyId") or "").strip()
    secret_access_key = str(payload.get("secretAccessKey") or "").strip()
    session_token = payload.get("sessionToken")
    if session_token is not None:
        session_token = str(session_token).strip() or None

    if account_id and not re.fullmatch(r"\d{12}", account_id):
        raise ValueError("accountId must be a 12 digit AWS account ID")
    if region and not re.fullmatch(r"[a-z]{2}-[a-z]+-\d", region):
        raise ValueError("region is invalid")
    if not re.fullmatch(r"[A-Z0-9]{16,128}", access_key_id):
        raise ValueError("accessKeyId is invalid")
    if len(secret_access_key) < 20:
        raise ValueError("secretAccessKey is invalid")
    return account_id, region, access_key_id, secret_access_key, session_token


def _save_aws_credential(user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    account_id, region, access_key_id, secret_access_key, session_token = _validate_aws_credential(payload)
    timestamp = _now()
    credential_id = _credential_id(payload)
    if not account_id:
        try:
            session_kwargs: dict[str, Any] = {
                "aws_access_key_id": access_key_id,
                "aws_secret_access_key": secret_access_key,
                "region_name": region or "ap-southeast-1",
            }
            if session_token:
                session_kwargs["aws_session_token"] = session_token
            account_id = boto3.Session(**session_kwargs).client("sts").get_caller_identity().get("Account", "")
        except ClientError:
            account_id = ""
    credential_name = str(payload.get("name") or "").strip() or _mask_access_key(access_key_id)
    if len(credential_name) > 80:
        raise ValueError("name must be 80 characters or less")
    store = _credential_store(user_id)
    credentials = store.get("credentials", {})
    if not isinstance(credentials, dict):
        credentials = {}
    secret_payload = {
        "credentialId": credential_id,
        "name": credential_name,
        "accountId": account_id,
        "region": region,
        "accessKeyId": access_key_id,
        "secretAccessKey": secret_access_key,
        "updatedAt": timestamp,
    }
    if session_token:
        secret_payload["sessionToken"] = session_token
    credentials[credential_id] = secret_payload
    store = {
        "version": 2,
        "activeCredentialId": credential_id if payload.get("setActive", True) is not False else store.get("activeCredentialId") or credential_id,
        "credentials": credentials,
    }
    secret_string = json.dumps(store)
    name = _secret_name(user_id)
    try:
        secretsmanager.put_secret_value(SecretId=name, SecretString=secret_string)
    except secretsmanager.exceptions.ResourceNotFoundException:
        secretsmanager.create_secret(
            Name=name,
            SecretString=secret_string,
            Tags=[
                {"Key": "ManagedBy", "Value": "InfrastructureAgent"},
                {"Key": "UserId", "Value": user_id},
            ],
        )

    return _credential_record_metadata(secret_payload)


def _aws_session_for_credential(user_id: str, credential_id: str | None = None, region: str | None = None) -> boto3.Session:
    credential = _credential_payload(user_id, credential_id)
    selected_region = (region or credential.get("region") or "ap-southeast-1").strip()
    if not re.fullmatch(r"[a-z]{2}-[a-z]+-\d", selected_region):
        raise ValueError("region is invalid")
    session_kwargs: dict[str, Any] = {
        "aws_access_key_id": credential["accessKeyId"],
        "aws_secret_access_key": credential["secretAccessKey"],
        "region_name": selected_region,
    }
    if credential.get("sessionToken"):
        session_kwargs["aws_session_token"] = credential["sessionToken"]
    return boto3.Session(**session_kwargs)


def _list_s3_buckets(user_id: str, query: dict[str, Any] | None) -> dict[str, Any]:
    query = query or {}
    credential_id = str(query.get("credentialId") or "").strip() or None
    region = str(query.get("region") or "").strip() or "ap-southeast-1"
    session = _aws_session_for_credential(user_id, credential_id, region)
    response = session.client("s3").list_buckets()
    buckets = [
        {
            "name": bucket.get("Name", ""),
            "createdAt": bucket.get("CreationDate").strftime("%Y-%m-%dT%H:%M:%SZ")
            if bucket.get("CreationDate")
            else "",
        }
        for bucket in response.get("Buckets", [])
        if bucket.get("Name")
    ]
    buckets.sort(key=lambda item: item["name"])
    return {"buckets": buckets}


def _github_secret_payload() -> dict[str, Any]:
    try:
        secret = secretsmanager.get_secret_value(SecretId=GITHUB_APP_SECRET_NAME)
    except secretsmanager.exceptions.ResourceNotFoundException as exc:
        raise PermissionError("GitHub App secret is not configured") from exc
    payload = json.loads(secret.get("SecretString") or "{}")
    if not isinstance(payload, dict):
        raise PermissionError("GitHub App secret must be a JSON object")
    return payload


def _github_webhook_secret_metadata() -> dict[str, Any]:
    payload = _github_secret_payload()
    return {
        "configured": bool(payload.get("webhook_secret") or payload.get("client_secret")),
        "updatedAt": payload.get("webhookSecretUpdatedAt"),
    }


def _normalize_bot_login(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if text.endswith("[bot]"):
        return text
    if re.fullmatch(r"[A-Za-z0-9-]+", text):
        return f"{text}[bot]"
    return ""


def _github_app_bot_logins() -> set[str]:
    try:
        payload = _github_secret_payload()
    except PermissionError:
        payload = {}
    candidates: list[Any] = [
        payload.get("app_slug"),
        payload.get("appSlug"),
        payload.get("bot_login"),
        payload.get("botLogin"),
    ]
    for key in ("bot_logins", "botLogins", "app_slugs", "appSlugs", "previous_app_slugs", "previousAppSlugs"):
        value = payload.get(key)
        if isinstance(value, list):
            candidates.extend(value)
        elif value:
            candidates.extend(str(value).split(","))
    candidates.extend(os.environ.get("GITHUB_APP_BOT_LOGINS", "").split(","))
    return {login for login in (_normalize_bot_login(candidate) for candidate in candidates) if login}


def _github_app_bot_login() -> str:
    return next(iter(_github_app_bot_logins()), "")


def _github_request(method: str, path: str, token: str, body: dict[str, Any] | None = None) -> Any:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = Request(
        f"{GITHUB_API}{path}",
        data=data,
        method=method,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "infraq-resources-api",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urlopen(request, timeout=30) as response:
            raw = response.read()
            return json.loads(raw.decode("utf-8")) if raw else {}
    except HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GitHub API {method} {path} failed: {exc.code} {details}") from exc


def _github_app_jwt(payload: dict[str, Any]) -> str:
    now = int(time.time())
    app_id = str(payload.get("app_id") or payload.get("appId") or "").strip()
    private_key = str(
        payload.get("private_key") or payload.get("privateKey") or payload.get("private_key_pem") or ""
    ).replace("\\n", "\n")
    if not app_id or not private_key:
        raise PermissionError("GitHub App credentials require app_id and private_key")
    return jwt.encode({"iat": now - 60, "exp": now + 540, "iss": app_id}, private_key, algorithm="RS256")


def _github_installation_token(owner: str, repo: str) -> str:
    app_payload = _github_secret_payload()
    app_token = _github_app_jwt(app_payload)
    try:
        installation = _github_request("GET", f"/repos/{owner}/{repo}/installation", app_token)
        installation_id = installation["id"]
        token_response = _github_request(
            "POST",
            f"/app/installations/{installation_id}/access_tokens",
            app_token,
            {"repositories": [repo]},
        )
        return token_response["token"]
    except RuntimeError as exc:
        if " failed: 404 " not in str(exc):
            raise

    target = f"{owner}/{repo}".lower()
    installations = _github_request("GET", "/app/installations", app_token)
    if not isinstance(installations, list):
        raise RuntimeError("GitHub API did not return an installation list")
    for installation in installations:
        installation_id = installation.get("id") if isinstance(installation, dict) else None
        if not installation_id:
            continue
        token_response = _github_request("POST", f"/app/installations/{installation_id}/access_tokens", app_token, {})
        installation_token = token_response["token"]
        repositories = _github_request("GET", "/installation/repositories", installation_token)
        for item in repositories.get("repositories", []) if isinstance(repositories, dict) else []:
            if str(item.get("full_name") or "").lower() == target:
                return installation_token
    raise PermissionError("GitHub App is not installed on this repository")


def _is_github_app_pull_request(
    author: Any,
    head_branch: Any,
    created_by_github_app: Any = False,
    bot_login: str | None = None,
    bot_logins: set[str] | None = None,
    author_type: Any = "",
) -> bool:
    if created_by_github_app is True:
        return True
    author_login = str(author or "")
    if str(author_type or "").lower() == "bot" and author_login.endswith("[bot]"):
        return True
    if str(head_branch or "").startswith("agentcore/"):
        return True
    if author_login.endswith("[bot]"):
        return True
    if bot_login is None:
        bot_login = _github_app_bot_login()
    if bot_logins is None:
        bot_logins = {bot_login} if bot_login else _github_app_bot_logins()
    return bool(author_login and author_login in bot_logins)


def _int_value(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _pull_request_reactions(pr: dict[str, Any]) -> dict[str, int]:
    reactions = pr.get("reactions") if isinstance(pr.get("reactions"), dict) else {}
    return {
        "total": _int_value(reactions.get("total_count")),
        "plusOne": _int_value(reactions.get("+1")),
        "minusOne": _int_value(reactions.get("-1")),
        "laugh": _int_value(reactions.get("laugh")),
        "hooray": _int_value(reactions.get("hooray")),
        "confused": _int_value(reactions.get("confused")),
        "heart": _int_value(reactions.get("heart")),
        "rocket": _int_value(reactions.get("rocket")),
        "eyes": _int_value(reactions.get("eyes")),
    }


def _save_github_webhook_secret(payload: dict[str, Any]) -> dict[str, Any]:
    webhook_secret = str(payload.get("webhookSecret") or "").strip()
    if len(webhook_secret) < 8:
        raise ValueError("webhookSecret must be at least 8 characters")
    secret_payload = _github_secret_payload()
    timestamp = _now()
    secret_payload["webhook_secret"] = webhook_secret
    secret_payload["webhookSecretUpdatedAt"] = timestamp
    secretsmanager.put_secret_value(
        SecretId=GITHUB_APP_SECRET_NAME,
        SecretString=json.dumps(secret_payload),
    )
    return {"configured": True, "updatedAt": timestamp}


def _verify_github_webhook(event: dict[str, Any]) -> None:
    headers = {str(key).lower(): str(value) for key, value in (event.get("headers") or {}).items()}
    signature = headers.get("x-hub-signature-256", "")
    delivery = headers.get("x-github-delivery", "")
    if not delivery:
        raise PermissionError("Missing GitHub delivery header")
    github_secret = _github_secret_payload()
    secret = str(github_secret.get("webhook_secret") or github_secret.get("client_secret") or "")
    if not secret:
        raise PermissionError("GitHub webhook_secret is not configured")
    expected = "sha256=" + hmac.new(secret.encode("utf-8"), _raw_body(event), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        raise PermissionError("Invalid GitHub webhook signature")


def _github_headers(event: dict[str, Any]) -> dict[str, str]:
    return {str(key).lower(): str(value) for key, value in (event.get("headers") or {}).items()}


def _repo_full_name(payload: dict[str, Any]) -> str:
    repository = payload.get("repository") or {}
    full_name = repository.get("full_name") if isinstance(repository, dict) else None
    if not full_name or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", str(full_name)):
        raise ValueError("Webhook payload did not include a valid repository full_name")
    return str(full_name)


def _pull_request_item(repo: str, pr: dict[str, Any], event_name: str, action: str, delivery: str) -> dict[str, Any]:
    head = pr.get("head") or {}
    base = pr.get("base") or {}
    user = pr.get("user") or {}
    labels = pr.get("labels") or []
    timestamp = _now()
    state = "merged" if pr.get("merged") is True else pr.get("state") or ""
    author = user.get("login") if isinstance(user, dict) else ""
    author_type = user.get("type") if isinstance(user, dict) else ""
    head_branch = head.get("ref") if isinstance(head, dict) else ""
    return {
        "pk": f"GITHUB#{repo}",
        "sk": f"PR#{pr.get('number')}",
        "type": "githubPullRequest",
        "repository": repo,
        "number": pr.get("number"),
        "title": pr.get("title") or "",
        "state": state,
        "githubState": pr.get("state") or "",
        "merged": bool(pr.get("merged")),
        "mergedAt": pr.get("merged_at") or "",
        "closedAt": pr.get("closed_at") or "",
        "draft": bool(pr.get("draft")),
        "url": pr.get("html_url") or "",
        "author": author,
        "authorType": author_type,
        "headBranch": head_branch,
        "baseBranch": base.get("ref") if isinstance(base, dict) else "",
        "headSha": head.get("sha") if isinstance(head, dict) else "",
        "labels": [label.get("name") for label in labels if isinstance(label, dict) and label.get("name")],
        "createdByGitHubApp": _is_github_app_pull_request(author, head_branch, author_type=author_type),
        "createdAt": pr.get("created_at") or timestamp,
        "githubUpdatedAt": pr.get("updated_at") or timestamp,
        "updatedAt": timestamp,
        "lastEvent": event_name,
        "lastAction": action,
        "lastDelivery": delivery,
        "comments": _int_value(pr.get("comments")),
        "reviewComments": _int_value(pr.get("review_comments")),
        "commits": _int_value(pr.get("commits")),
        "additions": _int_value(pr.get("additions")),
        "deletions": _int_value(pr.get("deletions")),
        "changedFiles": _int_value(pr.get("changed_files")),
        "reactions": _pull_request_reactions(pr),
    }


def _github_pull_request_item(repo: str, pr: dict[str, Any]) -> dict[str, Any]:
    head = pr.get("head") or {}
    base = pr.get("base") or {}
    user = pr.get("user") or {}
    labels = pr.get("labels") or []
    author = user.get("login") if isinstance(user, dict) else ""
    author_type = user.get("type") if isinstance(user, dict) else ""
    head_branch = head.get("ref") if isinstance(head, dict) else ""
    state = "merged" if pr.get("merged") is True else pr.get("state") or ""
    return {
        "repository": repo,
        "number": pr.get("number"),
        "title": pr.get("title") or "",
        "state": state,
        "githubState": pr.get("state") or "",
        "merged": bool(pr.get("merged")),
        "mergedAt": pr.get("merged_at") or "",
        "closedAt": pr.get("closed_at") or "",
        "draft": bool(pr.get("draft")),
        "url": pr.get("html_url") or "",
        "author": author,
        "authorType": author_type,
        "headBranch": head_branch,
        "baseBranch": base.get("ref") if isinstance(base, dict) else "",
        "headSha": head.get("sha") if isinstance(head, dict) else "",
        "labels": [label.get("name") for label in labels if isinstance(label, dict) and label.get("name")],
        "createdByGitHubApp": _is_github_app_pull_request(author, head_branch, author_type=author_type),
        "createdAt": pr.get("created_at") or "",
        "githubUpdatedAt": pr.get("updated_at") or "",
        "updatedAt": pr.get("updated_at") or "",
        "comments": _int_value(pr.get("comments")),
        "reviewComments": _int_value(pr.get("review_comments")),
        "reactions": _pull_request_reactions(pr),
    }


def _list_live_github_pull_requests(repository: str, state: str) -> list[dict[str, Any]]:
    owner, repo_name = repository.split("/", 1)
    token = _github_installation_token(owner, repo_name)
    github_state = state if state in {"open", "closed"} else "all"
    items: list[dict[str, Any]] = []
    page = 1
    while True:
        query = urlencode({"state": github_state, "per_page": 100, "sort": "updated", "direction": "desc", "page": page})
        page_items = _github_request("GET", f"/repos/{owner}/{repo_name}/pulls?{query}", token)
        if not isinstance(page_items, list):
            raise RuntimeError("GitHub API did not return a pull request list")
        items.extend(_github_pull_request_item(repository, item) for item in page_items)
        if len(page_items) < 100:
            break
        page += 1
    if state == "merged":
        return [item for item in items if item.get("merged") is True or item.get("state") == "merged"]
    return items


def _update_pr_check_status(repo: str, number: Any, update: dict[str, Any]) -> None:
    if not number:
        return
    update["type"] = "githubPullRequest"
    update["repository"] = repo
    update["number"] = number
    update["updatedAt"] = _now()
    names = {f"#k{index}": key for index, key in enumerate(update)}
    values = {f":v{index}": value for index, value in enumerate(update.values())}
    table.update_item(
        Key={"pk": f"GITHUB#{repo}", "sk": f"PR#{number}"},
        UpdateExpression="SET " + ", ".join(f"{name} = :v{index}" for index, name in enumerate(names)),
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )


def _update_prs_by_sha(repo: str, sha: str, update: dict[str, Any]) -> int:
    if not sha:
        return 0
    response = table.query(
        KeyConditionExpression="pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues={":pk": f"GITHUB#{repo}", ":prefix": "PR#"},
    )
    count = 0
    for item in response.get("Items", []):
        if item.get("headSha") == sha:
            _update_pr_check_status(repo, item.get("number"), update)
            count += 1
    return count


def _store_github_webhook(event: dict[str, Any]) -> dict[str, Any]:
    _verify_github_webhook(event)
    headers = _github_headers(event)
    event_name = headers.get("x-github-event", "")
    delivery = headers.get("x-github-delivery", "")
    payload = _body(event)
    repo = _repo_full_name(payload)
    timestamp = _now()
    action = str(payload.get("action") or "")

    table.put_item(
        Item={
            "pk": f"GITHUB#{repo}",
            "sk": f"EVENT#{timestamp}#{delivery}",
            "type": "githubWebhookEvent",
            "repository": repo,
            "event": event_name,
            "action": action,
            "delivery": delivery,
            "createdAt": timestamp,
        }
    )

    if event_name == "pull_request" and isinstance(payload.get("pull_request"), dict):
        item = _pull_request_item(repo, payload["pull_request"], event_name, action, delivery)
        table.put_item(Item=item)
        return {"ok": True, "repository": repo, "event": event_name, "pullRequest": item.get("number")}

    if event_name == "check_run" and isinstance(payload.get("check_run"), dict):
        check_run = payload["check_run"]
        check_suite = check_run.get("check_suite") or {}
        pull_requests = check_suite.get("pull_requests") if isinstance(check_suite, dict) else []
        for pr in pull_requests or []:
            _update_pr_check_status(
                repo,
                pr.get("number") if isinstance(pr, dict) else None,
                {
                    "checkStatus": check_run.get("status") or "",
                    "checkConclusion": check_run.get("conclusion") or "",
                    "checkName": check_run.get("name") or "",
                    "checkUrl": check_run.get("html_url") or "",
                    "lastEvent": event_name,
                    "lastAction": action,
                    "lastDelivery": delivery,
                },
            )
        return {"ok": True, "repository": repo, "event": event_name, "updated": len(pull_requests or [])}

    if event_name == "status":
        updated = _update_prs_by_sha(
            repo,
            str(payload.get("sha") or ""),
            {
                "combinedStatus": payload.get("state") or "",
                "statusContext": payload.get("context") or "",
                "statusUrl": payload.get("target_url") or "",
                "lastEvent": event_name,
                "lastAction": action,
                "lastDelivery": delivery,
            },
        )
        return {"ok": True, "repository": repo, "event": event_name, "updated": updated}

    return {"ok": True, "repository": repo, "event": event_name}


def _list_github_pull_requests(repository: str, state: str = "open") -> list[dict[str, Any]]:
    repo = repository.strip()
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
        raise ValueError("repository must use owner/name format")
    query_kwargs = {
        "KeyConditionExpression": "pk = :pk AND begins_with(sk, :prefix)",
        "ExpressionAttributeValues": {":pk": f"GITHUB#{repo}", ":prefix": "PR#"},
        "ScanIndexForward": False,
    }
    items: list[dict[str, Any]] = []
    while True:
        response = table.query(**query_kwargs)
        items.extend(response.get("Items", []))
        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            break
        query_kwargs["ExclusiveStartKey"] = last_key
    bot_logins = _github_app_bot_logins()
    stored_items = [
        item
        for item in items
        if _is_github_app_pull_request(
            item.get("author"),
            item.get("headBranch"),
            item.get("createdByGitHubApp"),
            bot_logins=bot_logins,
            author_type=item.get("authorType"),
        )
    ]
    try:
        live_items = [
            item
            for item in _list_live_github_pull_requests(repo, state)
            if _is_github_app_pull_request(
                item.get("author"),
                item.get("headBranch"),
                item.get("createdByGitHubApp"),
                bot_logins=bot_logins,
                author_type=item.get("authorType"),
            )
        ]
    except Exception:
        live_items = []
    merged_by_number: dict[int, dict[str, Any]] = {}
    for item in stored_items:
        number = _int_value(item.get("number"))
        if number:
            merged_by_number[number] = item
    for item in live_items:
        number = _int_value(item.get("number"))
        if number:
            merged_by_number[number] = {**merged_by_number.get(number, {}), **item}
    items = list(merged_by_number.values())
    if state in {"open", "closed", "merged"}:
        items = [item for item in items if item.get("state") == state]
    return sorted(items, key=lambda item: item.get("githubUpdatedAt") or item.get("updatedAt", ""), reverse=True)


def _state_backend_id() -> str:
    return str(uuid.uuid4())


def _validate_state_backend(payload: dict[str, Any], require_repository: bool = False) -> dict[str, Any]:
    name = str(payload.get("name") or "").strip()
    bucket = str(payload.get("bucket") or "").strip()
    key = str(payload.get("key") or "").strip()
    region = str(payload.get("region") or "").strip()
    service = str(payload.get("service") or "s3").strip().lower()
    credential_id = str(payload.get("credentialId") or "").strip()

    if not name or len(name) > 80:
        raise ValueError("name is required and must be 80 characters or less")
    if not re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", bucket):
        raise ValueError("bucket is invalid")
    if not key or len(key) > 1024:
        raise ValueError("key is required")
    if not re.fullmatch(r"[a-z]{2}-[a-z]+-\d", region):
        raise ValueError("region is invalid")
    if service not in {"s3", "ec2", "iam"}:
        raise ValueError("service must be one of s3, ec2, or iam")
    if credential_id and not re.fullmatch(r"[A-Za-z0-9_.-]{1,80}", credential_id):
        raise ValueError("credentialId is invalid")
    repository = _sanitize_repository(payload.get("repository"))
    if require_repository and not repository:
        raise ValueError("Choose an installed GitHub repository before creating a state backend")
    return {
        "name": name,
        "bucket": bucket,
        "key": key,
        "region": region,
        "service": service,
        "credentialId": credential_id,
        "repository": repository,
    }


def _list_state_backends(user_id: str) -> list[dict[str, Any]]:
    response = table.query(
        KeyConditionExpression="pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues={":pk": user_id, ":prefix": "BACKEND#"},
        ScanIndexForward=False,
    )
    return sorted(response.get("Items", []), key=lambda item: item.get("updatedAt", ""), reverse=True)


def _state_backend_session(user_id: str, backend: dict[str, Any]) -> boto3.Session:
    credential = _credential_payload(user_id, backend.get("credentialId"))
    session_kwargs = {
        "aws_access_key_id": credential["accessKeyId"],
        "aws_secret_access_key": credential["secretAccessKey"],
        "region_name": backend["region"],
    }
    if credential.get("sessionToken"):
        session_kwargs["aws_session_token"] = credential["sessionToken"]
    return boto3.Session(**session_kwargs)


def _read_state_backend_payload(user_id: str, backend: dict[str, Any]) -> dict[str, Any]:
    target_session = _state_backend_session(user_id, backend)
    state_object = target_session.client("s3").get_object(Bucket=backend["bucket"], Key=backend["key"])
    return json.loads(state_object["Body"].read().decode("utf-8"))


def _state_resource_values(values: dict[str, Any]) -> dict[str, Any]:
    allowed_keys = {
        "id",
        "arn",
        "name",
        "name_prefix",
        "bucket",
        "bucket_domain_name",
        "bucket_regional_domain_name",
        "instance_id",
        "instance_type",
        "ami",
        "vpc_id",
        "subnet_id",
        "security_groups",
        "vpc_security_group_ids",
        "function_name",
        "role",
        "handler",
        "runtime",
        "queue_url",
        "topic_arn",
        "key_id",
        "key_arn",
        "db_name",
        "db_instance_identifier",
        "identifier",
        "engine",
        "load_balancer_type",
        "dns_name",
        "tags",
        "tags_all",
    }
    return {key: values[key] for key in sorted(allowed_keys) if key in values}


def _list_state_backend_resources(user_id: str, backend_id: str) -> dict[str, Any]:
    backend = _get_state_backend(user_id, backend_id)
    state_payload = _read_state_backend_payload(user_id, backend)
    show_payload = _state_show_payload(state_payload)
    resources = []
    for resource in _iter_state_resources(show_payload.get("values", {}).get("root_module", {})):
        resource_type = str(resource.get("type") or "")
        if not resource_type.startswith("aws_"):
            continue
        values = resource.get("values") if isinstance(resource.get("values"), dict) else {}
        resources.append(
            {
                "address": resource.get("address"),
                "mode": resource.get("mode") or "managed",
                "type": resource_type,
                "name": resource.get("name"),
                "module": resource.get("module"),
                "index": resource.get("index"),
                "providerName": "registry.terraform.io/hashicorp/aws",
                "values": _state_resource_values(values),
                "backendId": backend["backendId"],
                "backendName": backend.get("name"),
                "stateBucket": backend.get("bucket"),
                "stateKey": backend.get("key"),
                "stateRegion": backend.get("region"),
                "service": backend.get("service"),
                "repository": backend.get("repository"),
                "updatedAt": backend.get("updatedAt"),
            }
        )
    return {"backendId": backend_id, "resources": resources, "resourceCount": len(resources)}


def _chat_session_id(value: Any) -> str:
    session_id = str(value or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,120}", session_id):
        raise ValueError("session id is invalid")
    return session_id


def _sanitize_message(message: Any) -> dict[str, Any]:
    if not isinstance(message, dict):
        raise ValueError("message must be an object")
    role = str(message.get("role") or "").strip()
    if role not in {"user", "assistant"}:
        raise ValueError("message role is invalid")
    content = str(message.get("content") or "")
    if len(content) > 12000:
        content = content[:12000]
    sanitized = {
        "role": role,
        "content": content,
        "timestamp": str(message.get("timestamp") or _now()),
    }
    agent = message.get("agent")
    if isinstance(agent, dict):
        agent_id = str(agent.get("id") or "").strip()
        if agent_id == "agent1":
            sanitized["agent"] = {
                "id": agent_id,
                "mention": "@devops",
                "name": str(agent.get("name") or "InfraQ")[:80],
                "avatar": str(agent.get("avatar") or "IQ")[:12],
                "className": str(agent.get("className") or "")[:120],
            }
    segments = message.get("segments")
    if isinstance(segments, list):
        serialized_segments = json.loads(json.dumps(segments, default=_json_default))
        if len(json.dumps(serialized_segments[:40], default=_json_default).encode("utf-8")) <= 20000:
            sanitized["segments"] = serialized_segments[:40]
    return sanitized


def _sanitize_repository(repository: Any) -> dict[str, Any] | None:
    if not isinstance(repository, dict):
        return None
    full_name = str(repository.get("fullName") or "").strip()
    owner = str(repository.get("owner") or "").strip()
    name = str(repository.get("name") or "").strip()
    default_branch = str(repository.get("defaultBranch") or "main").strip() or "main"
    url = str(repository.get("url") or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", full_name):
        raise ValueError("repository is invalid")
    return {
        "fullName": full_name,
        "owner": owner or full_name.split("/")[0],
        "name": name or full_name.split("/")[1],
        "defaultBranch": default_branch[:120],
        **({"url": url[:500]} if url else {}),
    }


def _sanitize_session_state_backend(state_backend: Any) -> dict[str, Any] | None:
    if not isinstance(state_backend, dict):
        return None
    backend_id = str(state_backend.get("backendId") or "").strip()
    name = str(state_backend.get("name") or "").strip()
    bucket = str(state_backend.get("bucket") or "").strip()
    key = str(state_backend.get("key") or "").strip()
    region = str(state_backend.get("region") or "").strip()
    service = str(state_backend.get("service") or "s3").strip().lower()
    credential_id = str(state_backend.get("credentialId") or "").strip()
    credential_name = str(state_backend.get("credentialName") or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,120}", backend_id):
        raise ValueError("stateBackend.backendId is invalid")
    if not name or len(name) > 120:
        raise ValueError("stateBackend.name is invalid")
    if not re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", bucket):
        raise ValueError("stateBackend.bucket is invalid")
    if not key or len(key) > 1024:
        raise ValueError("stateBackend.key is invalid")
    if not re.fullmatch(r"[a-z]{2}-[a-z]+-\d", region):
        raise ValueError("stateBackend.region is invalid")
    if service not in {"s3", "ec2", "iam"}:
        raise ValueError("stateBackend.service is invalid")
    if credential_id and not re.fullmatch(r"[A-Za-z0-9_.-]{1,80}", credential_id):
        raise ValueError("stateBackend.credentialId is invalid")
    return {
        "backendId": backend_id,
        "name": name[:120],
        "bucket": bucket,
        "key": key,
        "region": region,
        "service": service,
        **({"credentialId": credential_id} if credential_id else {}),
        **({"credentialName": credential_name[:120]} if credential_name else {}),
        **({"repository": _sanitize_repository(state_backend.get("repository"))} if state_backend.get("repository") else {}),
    }


def _sanitize_pull_request(pull_request: Any) -> dict[str, Any] | None:
    if not isinstance(pull_request, dict):
        return None
    sanitized: dict[str, Any] = {}
    for key in ["url", "headBranch", "baseBranch", "state", "title", "body", "commitTitle", "message", "error"]:
        value = str(pull_request.get(key) or "").strip()
        if value:
            sanitized[key] = value[:1200] if key in {"body", "message", "error"} else value[:500]
    number = pull_request.get("number")
    if number is not None:
        try:
            sanitized["number"] = int(number)
        except (TypeError, ValueError):
            pass
    for key in ["created", "updated", "committed"]:
        if key in pull_request:
            sanitized[key] = bool(pull_request.get(key))
    changed_files = pull_request.get("changedFiles")
    if isinstance(changed_files, list):
        sanitized["changedFiles"] = [str(item)[:500] for item in changed_files[:80]]
    return sanitized or None


def _sanitize_chat_session(session: Any) -> dict[str, Any]:
    if not isinstance(session, dict):
        raise ValueError("session must be an object")
    session_id = _chat_session_id(session.get("id"))
    name = str(session.get("name") or "New chat").strip()[:120] or "New chat"
    history = session.get("history") if isinstance(session.get("history"), list) else []
    repository = _sanitize_repository(session.get("repository"))
    state_backend = _sanitize_session_state_backend(session.get("stateBackend"))
    sanitized = {
        "sessionId": session_id,
        "id": session_id,
        "name": name,
        "history": [_sanitize_message(message) for message in history[-80:]],
        "startDate": str(session.get("startDate") or _now()),
        "endDate": str(session.get("endDate") or _now()),
        "repository": repository,
        "stateBackend": state_backend,
        "pullRequest": _sanitize_pull_request(session.get("pullRequest")),
    }
    while len(json.dumps(sanitized, default=_json_default).encode("utf-8")) > 350000 and sanitized["history"]:
        sanitized["history"].pop(0)
    return sanitized


def _list_chat_sessions(user_id: str) -> dict[str, Any]:
    response = table.query(
        KeyConditionExpression="pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues={":pk": user_id, ":prefix": "SESSION#"},
        ScanIndexForward=False,
    )
    sessions = sorted(response.get("Items", []), key=lambda item: item.get("endDate", ""), reverse=True)
    config = _get_user_config(user_id, "activeChatSessionId")
    return {"sessions": sessions, "activeSessionId": config.get("value") or ""}


def _save_chat_sessions(user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    incoming = payload.get("sessions")
    if not isinstance(incoming, list):
        raise ValueError("sessions must be an array")
    if len(incoming) > 50:
        raise ValueError("A maximum of 50 chat sessions is supported")
    sessions = [_sanitize_chat_session(session) for session in incoming if isinstance(session, dict)]
    timestamp = _now()
    existing = table.query(
        KeyConditionExpression="pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues={":pk": user_id, ":prefix": "SESSION#"},
    ).get("Items", [])
    incoming_ids = {session["sessionId"] for session in sessions}
    with table.batch_writer() as batch:
        for session in sessions:
            batch.put_item(
                Item={
                    **session,
                    "pk": user_id,
                    "sk": f"SESSION#{session['sessionId']}",
                    "type": "chatSession",
                    "updatedAt": timestamp,
                }
            )
        for session in existing:
            session_id = str(session.get("sessionId") or session.get("id") or "")
            if session_id not in incoming_ids:
                batch.delete_item(Key={"pk": user_id, "sk": session["sk"]})
    active_session_id = str(payload.get("activeSessionId") or "").strip()
    if active_session_id:
        _save_user_config(user_id, {"key": "activeChatSessionId", "value": active_session_id})
    return _list_chat_sessions(user_id)


def _delete_agentcore_session_events(user_id: str, session_id: str) -> dict[str, Any]:
    if not MEMORY_ID:
        return {"deletedEvents": 0, "skipped": True}

    deleted_events = 0
    next_token = None
    try:
        agentcore = boto3.client("bedrock-agentcore")
        while True:
            params: dict[str, Any] = {
                "memoryId": MEMORY_ID,
                "actorId": user_id,
                "sessionId": session_id,
                "includePayloads": False,
                "maxResults": 100,
            }
            if next_token:
                params["nextToken"] = next_token
            response = agentcore.list_events(**params)
            events = response.get("events") or response.get("eventSummaries") or []
            for event in events:
                event_id = event.get("eventId") or event.get("id")
                if not event_id:
                    continue
                try:
                    agentcore.delete_event(
                        memoryId=MEMORY_ID,
                        actorId=user_id,
                        sessionId=session_id,
                        eventId=str(event_id),
                    )
                    deleted_events += 1
                except ClientError as exc:
                    code = exc.response.get("Error", {}).get("Code")
                    if code not in {"ResourceNotFoundException", "ValidationException"}:
                        raise
            next_token = response.get("nextToken")
            if not next_token:
                break
    except UnknownServiceError:
        return {"deletedEvents": deleted_events, "skipped": True}
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code")
        if code in {"ResourceNotFoundException", "ValidationException"}:
            return {"deletedEvents": deleted_events, "skipped": False}
        raise
    return {"deletedEvents": deleted_events, "skipped": False}


def _delete_chat_session(user_id: str, session_id_value: Any) -> dict[str, Any]:
    session_id = _chat_session_id(session_id_value)
    table.delete_item(Key={"pk": user_id, "sk": f"SESSION#{session_id}"})
    config = _get_user_config(user_id, "activeChatSessionId")
    if config.get("value") == session_id:
        remaining = _list_chat_sessions(user_id)["sessions"]
        _save_user_config(
            user_id,
            {
                "key": "activeChatSessionId",
                "value": remaining[0].get("sessionId") or remaining[0].get("id") if remaining else "",
            },
        )
    agentcore_cleanup = _delete_agentcore_session_events(user_id, session_id)
    result = _list_chat_sessions(user_id)
    result["deletedSessionId"] = session_id
    result["agentcoreCleanup"] = agentcore_cleanup
    return result


def _config_key(value: Any) -> str:
    key = str(value or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,120}", key):
        raise ValueError("config key is invalid")
    return key


def _sanitize_config_value(value: Any) -> Any:
    serialized = json.dumps(value, default=_json_default)
    if len(serialized.encode("utf-8")) > 20000:
        raise ValueError("config value is too large")
    return json.loads(serialized)


def _get_user_config(user_id: str, key: str) -> dict[str, Any]:
    response = table.get_item(Key={"pk": user_id, "sk": f"CONFIG#{key}"})
    item = response.get("Item") or {}
    return item if item.get("type") == "userConfig" else {}


def _list_user_config(user_id: str) -> dict[str, Any]:
    response = table.query(
        KeyConditionExpression="pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues={":pk": user_id, ":prefix": "CONFIG#"},
    )
    config: dict[str, Any] = {}
    for item in response.get("Items", []):
        key = str(item.get("configKey") or "").strip()
        if key:
            config[key] = item.get("value")
    return {"config": config}


def _save_user_config(user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    key = _config_key(payload.get("key"))
    value = _sanitize_config_value(payload.get("value"))
    timestamp = _now()
    item = {
        "pk": user_id,
        "sk": f"CONFIG#{key}",
        "type": "userConfig",
        "configKey": key,
        "value": value,
        "updatedAt": timestamp,
    }
    table.put_item(Item=item)
    return item


def _iter_state_resources(module_payload: dict[str, Any], module_address: str = ""):
    for resource in module_payload.get("resources", []):
        if not isinstance(resource, dict):
            continue
        if resource.get("mode", "managed") != "managed":
            continue
        resource_type = resource.get("type")
        resource_name = resource.get("name")
        if not resource_type or not resource_name:
            continue
        resource_module = str(resource.get("module") or module_address or "")
        if "values" in resource:
            values = resource.get("values") if isinstance(resource.get("values"), dict) else {}
            yield {
                "address": resource.get("address") or f"{resource_module + '.' if resource_module else ''}{resource_type}.{resource_name}",
                "mode": resource.get("mode") or "managed",
                "type": resource_type,
                "name": resource_name,
                "module": resource_module,
                "values": values,
            }
            continue
        instances = resource.get("instances", [])
        for index, instance in enumerate(instances):
            if not isinstance(instance, dict):
                continue
            attributes = instance.get("attributes")
            if not isinstance(attributes, dict):
                continue
            address = resource.get("address") or f"{resource_module + '.' if resource_module else ''}{resource_type}.{resource_name}"
            if len(instances) > 1:
                address = f"{address}[{index}]"
            yield {
                "address": address,
                "mode": resource.get("mode") or "managed",
                "type": resource_type,
                "name": resource_name,
                "module": resource_module,
                "index": instance.get("index_key", index) if len(instances) > 1 else instance.get("index_key"),
                "values": attributes,
            }
    for child in module_payload.get("child_modules", []):
        if isinstance(child, dict):
            yield from _iter_state_resources(child, str(child.get("address") or module_address))


def _state_show_payload(state_payload: dict[str, Any]) -> dict[str, Any]:
    if isinstance(state_payload.get("values"), dict):
        return state_payload
    if isinstance(state_payload.get("planned_values"), dict):
        return state_payload
    resources = []
    if isinstance(state_payload.get("resources"), list):
        resources = list(_iter_state_resources({"resources": state_payload["resources"]}))
    return {"values": {"root_module": {"resources": resources}}}


def _safe_tf_name(value: Any, fallback: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_]", "_", str(value or fallback))
    cleaned = re.sub(r"_+", "_", cleaned).strip("_")
    if not cleaned or not re.match(r"^[A-Za-z_]", cleaned):
        cleaned = f"resource_{cleaned}"
    return cleaned[:80]


def _module_name_from_address(module_address: str) -> str:
    parts = [part for part in module_address.split(".") if part and part != "module"]
    return _safe_tf_name(parts[-1] if parts else "module", "module")


def _write_terraformgraph_inputs(workdir: Path, state_payload: dict[str, Any]) -> tuple[Path, int]:
    source_dir = workdir / "terraform-src"
    source_dir.mkdir(parents=True, exist_ok=True)
    show_payload = _state_show_payload(state_payload)
    resources = list(_iter_state_resources(show_payload.get("values", {}).get("root_module", {})))
    grouped: dict[tuple[str, str, str], int] = {}
    for index, resource in enumerate(resources):
        resource_type = str(resource.get("type") or "")
        if not resource_type.startswith("aws_"):
            continue
        name = _safe_tf_name(resource.get("name"), f"resource_{index}")
        module_address = str(resource.get("module") or "")
        key = (module_address, resource_type, name)
        grouped[key] = grouped.get(key, 0) + 1
    if not grouped:
        raise ValueError("No AWS managed resources found in state file")
    root_lines: list[str] = []
    module_lines: dict[str, list[str]] = {}
    for (module_address, resource_type, name), count in sorted(grouped.items()):
        block = f'resource "{resource_type}" "{name}" {{\n'
        if count > 1:
            block += f"  count = {count}\n"
        block += "}\n"
        if module_address:
            module_name = _module_name_from_address(module_address)
            module_lines.setdefault(module_name, []).append(block)
        else:
            root_lines.append(block)
    for module_name, lines in sorted(module_lines.items()):
        root_lines.append(f'module "{module_name}" {{\n  source = "./modules/{module_name}"\n}}\n')
        module_dir = source_dir / "modules" / module_name
        module_dir.mkdir(parents=True, exist_ok=True)
        (module_dir / "main.tf").write_text("\n".join(lines), encoding="utf-8")
    (source_dir / "main.tf").write_text("\n".join(root_lines), encoding="utf-8")
    state_file = workdir / "terraformgraph-state.json"
    state_file.write_text(json.dumps(show_payload), encoding="utf-8")
    return state_file, sum(grouped.values())


def _generate_backend_graph(user_id: str, backend: dict[str, Any]) -> dict[str, Any]:
    if not RESOURCE_GRAPH_BUCKET:
        raise ValueError("Resource graph bucket is not configured")
    state_payload = _read_state_backend_payload(user_id, backend)
    with tempfile.TemporaryDirectory(prefix="terraformgraph-") as tmp:
        workdir = Path(tmp)
        state_file, resource_count = _write_terraformgraph_inputs(workdir, state_payload)
        output_file = workdir / "terraformgraph.html"
        command = [
            "terraformgraph",
            "-t",
            str(workdir / "terraform-src"),
            "--state-file",
            str(state_file),
            "-o",
            str(output_file),
        ]
        if Path(AWS_ICONS_PATH).exists():
            command.extend(["--icons", AWS_ICONS_PATH])
        completed = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=120,
        )
        if completed.returncode != 0:
            raise RuntimeError(completed.stderr or completed.stdout or "terraformgraph failed")
        graph_key = f"resource-graphs/{user_id}/{backend['backendId']}/latest.html"
        s3.put_object(
            Bucket=RESOURCE_GRAPH_BUCKET,
            Key=graph_key,
            Body=output_file.read_bytes(),
            ContentType="text/html; charset=utf-8",
        )
    timestamp = _now()
    return {
        "graphBucket": RESOURCE_GRAPH_BUCKET,
        "graphKey": graph_key,
        "graphGeneratedAt": timestamp,
        "graphResourceCount": resource_count,
    }


def _attach_backend_graph(user_id: str, backend: dict[str, Any]) -> dict[str, Any]:
    try:
        graph = _generate_backend_graph(user_id, backend)
        backend.update(graph)
        backend.pop("graphError", None)
        table.update_item(
            Key={"pk": user_id, "sk": f"BACKEND#{backend['backendId']}"},
            UpdateExpression="SET graphBucket = :bucket, graphKey = :key, graphGeneratedAt = :generatedAt, graphResourceCount = :count REMOVE graphError",
            ExpressionAttributeValues={
                ":bucket": graph["graphBucket"],
                ":key": graph["graphKey"],
                ":generatedAt": graph["graphGeneratedAt"],
                ":count": graph["graphResourceCount"],
            },
        )
    except Exception as exc:
        backend["graphError"] = str(exc)[:4000]
        table.update_item(
            Key={"pk": user_id, "sk": f"BACKEND#{backend['backendId']}"},
            UpdateExpression="SET graphError = :error",
            ExpressionAttributeValues={":error": backend["graphError"]},
        )
    return backend


def _create_state_backend(user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    validated = _validate_state_backend(payload, require_repository=True)
    credential = _credential_metadata(user_id, validated.get("credentialId") or None)
    if not credential.get("configured"):
        raise ValueError("Choose a saved AWS credential before creating a state backend")
    backend_id = _state_backend_id()
    timestamp = _now()
    item = {
        "pk": user_id,
        "sk": f"BACKEND#{backend_id}",
        "type": "backend",
        "backendId": backend_id,
        "name": validated["name"],
        "bucket": validated["bucket"],
        "key": validated["key"],
        "region": validated["region"],
        "service": validated["service"],
        "credentialId": credential.get("credentialId"),
        "credentialName": credential.get("name"),
        "repository": validated["repository"],
        "createdAt": timestamp,
        "updatedAt": timestamp,
    }
    table.put_item(Item=item)
    return _attach_backend_graph(user_id, item)


def _get_state_backend(user_id: str, backend_id: str) -> dict[str, Any]:
    response = table.get_item(Key={"pk": user_id, "sk": f"BACKEND#{backend_id}"})
    item = response.get("Item")
    if not item:
        raise LookupError("State backend not found")
    return item


def _list_scans(user_id: str) -> list[dict[str, Any]]:
    response = table.query(
        KeyConditionExpression="pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues={":pk": user_id, ":prefix": "SCAN#"},
        ScanIndexForward=False,
    )
    return sorted(response.get("Items", []), key=lambda item: item.get("startedAt", ""), reverse=True)


def _list_terraform_jobs(user_id: str) -> list[dict[str, Any]]:
    response = table.query(
        KeyConditionExpression="pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues={":pk": user_id, ":prefix": "TFJOB#"},
        ScanIndexForward=False,
    )
    return sorted(response.get("Items", []), key=lambda item: item.get("createdAt", ""), reverse=True)


def _guard_schedule_name(user_id: str, guard_id: str) -> str:
    suffix = re.sub(r"[^A-Za-z0-9_.-]", "-", f"{user_id[:16]}-{guard_id}")[:60]
    return f"{STACK_NAME_BASE}-drift-guard-{suffix}"


def _schedule_expression(frequency: str) -> str | None:
    if frequency == "hourly":
        return "rate(1 hour)"
    if frequency == "daily":
        return "rate(1 day)"
    if frequency == "weekly":
        return "rate(7 days)"
    if frequency == "monthly":
        return "cron(0 0 1 * ? *)"
    return None


def _validate_drift_guard(payload: dict[str, Any]) -> dict[str, Any]:
    name = str(payload.get("name") or "").strip()
    backend_id = str(payload.get("backendId") or "").strip()
    repository = str(payload.get("repository") or "").strip()
    frequency = str(payload.get("frequency") or "manual").strip().lower()
    email = str(payload.get("email") or "").strip()
    enabled = payload.get("enabled", True) is not False

    if not name or len(name) > 80:
        raise ValueError("name is required and must be 80 characters or less")
    if not backend_id:
        raise ValueError("backendId is required")
    if repository and not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise ValueError("repository must use owner/name format")
    if frequency not in {"manual", "hourly", "daily", "weekly", "monthly"}:
        raise ValueError("frequency must be manual, hourly, daily, weekly, or monthly")
    if email and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise ValueError("email is invalid")
    return {
        "name": name,
        "backendId": backend_id,
        "repository": repository,
        "frequency": frequency,
        "email": email,
        "enabled": enabled,
    }


def _list_drift_guards(user_id: str) -> list[dict[str, Any]]:
    response = table.query(
        KeyConditionExpression="pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues={":pk": user_id, ":prefix": "DRIFTGUARD#"},
        ScanIndexForward=False,
    )
    return sorted(response.get("Items", []), key=lambda item: item.get("updatedAt", ""), reverse=True)


def _get_drift_guard(user_id: str, guard_id: str) -> dict[str, Any]:
    response = table.get_item(Key={"pk": user_id, "sk": f"DRIFTGUARD#{guard_id}"})
    item = response.get("Item")
    if not item:
        raise LookupError("Drift guard not found")
    return item


def _ensure_guard_topic(guard: dict[str, Any]) -> str:
    topic_arn = str(guard.get("alertTopicArn") or "")
    if topic_arn:
        return topic_arn
    topic_name = re.sub(r"[^A-Za-z0-9_-]", "-", f"{STACK_NAME_BASE}-drift-guard-{guard['guardId']}")[:256]
    return sns.create_topic(Name=topic_name)["TopicArn"]


def _ensure_email_subscription(topic_arn: str, email: str) -> None:
    if not email:
        return
    paginator = sns.get_paginator("list_subscriptions_by_topic")
    for page in paginator.paginate(TopicArn=topic_arn):
        for subscription in page.get("Subscriptions", []):
            if subscription.get("Protocol") == "email" and subscription.get("Endpoint") == email:
                return
    sns.subscribe(TopicArn=topic_arn, Protocol="email", Endpoint=email)


def _upsert_guard_schedule(user_id: str, guard: dict[str, Any]) -> str:
    schedule_name = _guard_schedule_name(user_id, guard["guardId"])
    expression = _schedule_expression(str(guard.get("frequency") or "manual"))
    if not expression or guard.get("enabled") is False:
        try:
            scheduler.delete_schedule(Name=schedule_name, GroupName="default")
        except scheduler.exceptions.ResourceNotFoundException:
            pass
        return schedule_name
    if not DRIFT_GUARD_SCHEDULER_ROLE_ARN or not RESOURCES_LAMBDA_ARN:
        raise ValueError("Drift Guard scheduler infrastructure is not configured")
    target = {
        "Arn": RESOURCES_LAMBDA_ARN,
        "RoleArn": DRIFT_GUARD_SCHEDULER_ROLE_ARN,
        "Input": json.dumps({"action": "driftGuardRun", "userId": user_id, "guardId": guard["guardId"]}),
        "RetryPolicy": {"MaximumRetryAttempts": 2, "MaximumEventAgeInSeconds": 3600},
    }
    params = {
        "Name": schedule_name,
        "GroupName": "default",
        "ScheduleExpression": expression,
        "FlexibleTimeWindow": {"Mode": "OFF"},
        "State": "ENABLED",
        "Target": target,
        "Description": f"Cloudrift Drift Guard schedule for {guard.get('name')}",
    }
    try:
        scheduler.update_schedule(**params)
    except scheduler.exceptions.ResourceNotFoundException:
        scheduler.create_schedule(**params)
    return schedule_name


def _save_drift_guard(user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    validated = _validate_drift_guard(payload)
    if not validated["email"]:
        metadata = _user_metadata(user_id)
        validated["email"] = metadata.get("email", "")
    _get_state_backend(user_id, validated["backendId"])
    guard_id = str(payload.get("guardId") or "").strip() or str(uuid.uuid4())
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,80}", guard_id):
        raise ValueError("guardId is invalid")
    timestamp = _now()
    existing = {}
    try:
        existing = _get_drift_guard(user_id, guard_id)
    except LookupError:
        pass
    guard = {
        **existing,
        "pk": user_id,
        "sk": f"DRIFTGUARD#{guard_id}",
        "type": "driftGuard",
        "guardId": guard_id,
        "name": validated["name"],
        "backendId": validated["backendId"],
        "repository": validated["repository"],
        "frequency": validated["frequency"],
        "email": validated["email"],
        "enabled": validated["enabled"],
        "createdAt": existing.get("createdAt") or timestamp,
        "updatedAt": timestamp,
    }
    if validated["email"]:
        topic_arn = _ensure_guard_topic(guard)
        _ensure_email_subscription(topic_arn, validated["email"])
        guard["alertTopicArn"] = topic_arn
    schedule_name = _upsert_guard_schedule(user_id, guard)
    guard["scheduleName"] = schedule_name
    table.put_item(Item=guard)
    return guard


def _run_drift_guard(user_id: str, guard_id: str) -> dict[str, Any]:
    guard = _get_drift_guard(user_id, guard_id)
    if guard.get("enabled") is False:
        return {"skipped": True, "reason": "disabled", "guardId": guard_id}
    scan = _start_scan(
        user_id,
        {
            "backendId": guard["backendId"],
            "guardId": guard_id,
            "alertTopicArn": guard.get("alertTopicArn") or "",
            "repository": guard.get("repository") or "",
        },
    )
    table.update_item(
        Key={"pk": user_id, "sk": f"DRIFTGUARD#{guard_id}"},
        UpdateExpression="SET lastScanId = :scanId, lastRunAt = :runAt, updatedAt = :updatedAt",
        ExpressionAttributeValues={":scanId": scan["scanId"], ":runAt": scan["startedAt"], ":updatedAt": _now()},
    )
    return {"skipped": False, "guardId": guard_id, "scan": scan}


def _start_scan(user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    backend_id = str(payload.get("backendId") or "").strip()
    if not backend_id:
        raise ValueError("backendId is required")

    backend = _get_state_backend(user_id, backend_id)
    credential = _credential_metadata(user_id, backend.get("credentialId"))
    if not credential.get("configured"):
        raise ValueError("AWS credentials must be saved before running a drift check")

    credential_region = str(credential.get("region") or "").strip()
    scan_region = backend.get("region") or credential_region
    scan_service = str(backend.get("service") or "s3").lower()
    guard_id = str(payload.get("guardId") or "").strip()
    alert_topic_arn = str(payload.get("alertTopicArn") or "").strip()
    scan_id = str(uuid.uuid4())
    timestamp = _now()
    item = {
        "pk": user_id,
        "sk": f"SCAN#{scan_id}",
        "type": "scan",
        "scanId": scan_id,
        "backendId": backend_id,
        "backendName": backend["name"],
        "stateBucket": backend["bucket"],
        "stateKey": backend["key"],
        "stateRegion": scan_region,
        "service": scan_service,
        "repository": backend.get("repository"),
        "status": "RUNNING",
        "startedAt": timestamp,
        "updatedAt": timestamp,
        "driftAlerts": [],
        "policyAlerts": [],
        "currentResources": [],
    }
    if guard_id:
        item["guardId"] = guard_id
    table.put_item(Item=item)

    env_overrides = [
        {"name": "USER_ID", "value": user_id, "type": "PLAINTEXT"},
        {"name": "BACKEND_ID", "value": backend_id, "type": "PLAINTEXT"},
        {"name": "BACKEND_NAME", "value": backend["name"], "type": "PLAINTEXT"},
        {"name": "SCAN_ID", "value": scan_id, "type": "PLAINTEXT"},
        {"name": "SCAN_STARTED_AT", "value": timestamp, "type": "PLAINTEXT"},
        {"name": "STATE_BUCKET", "value": backend["bucket"], "type": "PLAINTEXT"},
        {"name": "STATE_KEY", "value": backend["key"], "type": "PLAINTEXT"},
        {"name": "STATE_REGION", "value": scan_region, "type": "PLAINTEXT"},
        {"name": "SCAN_SERVICE", "value": scan_service, "type": "PLAINTEXT"},
        {"name": "AWS_CREDENTIAL_SECRET_ID", "value": _secret_name(user_id), "type": "PLAINTEXT"},
        {"name": "AWS_CREDENTIAL_ID", "value": str(backend.get("credentialId") or ""), "type": "PLAINTEXT"},
    ]
    if guard_id:
        env_overrides.append({"name": "DRIFT_GUARD_ID", "value": guard_id, "type": "PLAINTEXT"})
    if alert_topic_arn:
        env_overrides.append({"name": "ALERT_TOPIC_ARN", "value": alert_topic_arn, "type": "PLAINTEXT"})

    build = codebuild.start_build(
        projectName=CODEBUILD_PROJECT_NAME,
        environmentVariablesOverride=env_overrides,
    )
    item["codeBuildBuildId"] = build.get("build", {}).get("id")
    table.update_item(
        Key={"pk": user_id, "sk": f"SCAN#{scan_id}"},
        UpdateExpression="SET codeBuildBuildId = :build_id",
        ExpressionAttributeValues={":build_id": item["codeBuildBuildId"] or ""},
    )
    return item


def _safe_tf_filename(name: str) -> str:
    clean_name = name.strip().replace("\\", "/").split("/")[-1]
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,120}", clean_name):
        raise ValueError("Terraform filenames may contain only letters, numbers, dot, underscore, or hyphen")
    if not (clean_name.endswith(".tf") or clean_name.endswith(".tfvars")):
        raise ValueError("Only .tf and .tfvars files are supported")
    return clean_name


def _decode_file_content(value: Any) -> bytes:
    if not isinstance(value, str):
        raise ValueError("file content must be a string")
    try:
        return base64.b64decode(value, validate=True)
    except Exception:
        return value.encode("utf-8")


def _start_terraform_plan(user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    validated = _validate_state_backend(payload, require_repository=True)
    files = payload.get("files")
    if not isinstance(files, list) or not files:
        raise ValueError("files must include at least one Terraform file")
    if len(files) > 30:
        raise ValueError("A maximum of 30 Terraform files is supported")

    credential = _credential_payload(user_id, validated.get("credentialId") or None)
    session_kwargs = {
        "aws_access_key_id": credential["accessKeyId"],
        "aws_secret_access_key": credential["secretAccessKey"],
        "region_name": validated["region"],
    }
    if credential.get("sessionToken"):
        session_kwargs["aws_session_token"] = credential["sessionToken"]
    target_session = boto3.Session(**session_kwargs)
    s3_client = target_session.client("s3")

    job_id = str(uuid.uuid4())
    backend_id = _state_backend_id()
    timestamp = _now()
    source_prefix = f"cloudrift-terraform-jobs/{job_id}/source"
    uploaded: list[str] = []
    total_bytes = 0
    for file_item in files:
        if not isinstance(file_item, dict):
            raise ValueError("Each file must be an object")
        filename = _safe_tf_filename(str(file_item.get("name") or ""))
        content = _decode_file_content(file_item.get("content"))
        total_bytes += len(content)
        if total_bytes > 2 * 1024 * 1024:
            raise ValueError("Terraform upload must be 2MB or smaller")
        s3_client.put_object(
            Bucket=validated["bucket"],
            Key=f"{source_prefix}/{filename}",
            Body=content,
            ContentType="text/plain",
        )
        uploaded.append(filename)

    backend = {
        "pk": user_id,
        "sk": f"BACKEND#{backend_id}",
        "type": "backend",
        "backendId": backend_id,
        "name": validated["name"],
        "bucket": validated["bucket"],
        "key": validated["key"],
        "region": validated["region"],
        "service": validated["service"],
        "credentialId": credential.get("credentialId"),
        "credentialName": credential.get("name"),
        "repository": validated.get("repository"),
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "sourceType": "terraform",
    }
    table.put_item(Item=backend)

    job = {
        "pk": user_id,
        "sk": f"TFJOB#{job_id}",
        "type": "terraformJob",
        "jobId": job_id,
        "backendId": backend_id,
        "backendName": validated["name"],
        "bucket": validated["bucket"],
        "key": validated["key"],
        "region": validated["region"],
        "service": validated["service"],
        "repository": validated.get("repository"),
        "sourcePrefix": source_prefix,
        "files": uploaded,
        "status": "RUNNING",
        "phase": "queued",
        "createdAt": timestamp,
        "updatedAt": timestamp,
    }
    table.put_item(Item=job)

    build = codebuild.start_build(
        projectName=CODEBUILD_PROJECT_NAME,
        environmentVariablesOverride=[
            {"name": "JOB_MODE", "value": "terraform_plan", "type": "PLAINTEXT"},
            {"name": "USER_ID", "value": user_id, "type": "PLAINTEXT"},
            {"name": "PLAN_JOB_ID", "value": job_id, "type": "PLAINTEXT"},
            {"name": "BACKEND_ID", "value": backend_id, "type": "PLAINTEXT"},
            {"name": "BACKEND_NAME", "value": validated["name"], "type": "PLAINTEXT"},
            {"name": "STATE_BUCKET", "value": validated["bucket"], "type": "PLAINTEXT"},
            {"name": "STATE_KEY", "value": validated["key"], "type": "PLAINTEXT"},
            {"name": "STATE_REGION", "value": validated["region"], "type": "PLAINTEXT"},
            {"name": "SCAN_SERVICE", "value": validated["service"], "type": "PLAINTEXT"},
            {"name": "SOURCE_PREFIX", "value": source_prefix, "type": "PLAINTEXT"},
            {"name": "AWS_CREDENTIAL_SECRET_ID", "value": _secret_name(user_id), "type": "PLAINTEXT"},
            {"name": "AWS_CREDENTIAL_ID", "value": str(credential.get("credentialId") or ""), "type": "PLAINTEXT"},
        ],
    )
    job["codeBuildBuildId"] = build.get("build", {}).get("id") or ""
    table.update_item(
        Key={"pk": user_id, "sk": f"TFJOB#{job_id}"},
        UpdateExpression="SET codeBuildBuildId = :build_id",
        ExpressionAttributeValues={":build_id": job["codeBuildBuildId"]},
    )
    return {"job": job, "backend": backend}


def _scan_logs(user_id: str, scan_id: str, next_token: str | None = None) -> dict[str, Any]:
    scan = table.get_item(Key={"pk": user_id, "sk": f"SCAN#{scan_id}"}).get("Item")
    if not scan:
        raise LookupError("Scan not found")
    build_id = scan.get("codeBuildBuildId")
    if not build_id:
        return {"events": [], "nextForwardToken": None, "logGroupName": None, "logStreamName": None}

    build_response = codebuild.batch_get_builds(ids=[build_id])
    builds = build_response.get("builds", [])
    if not builds:
        return {"events": [], "nextForwardToken": None, "logGroupName": None, "logStreamName": None}

    log_info = builds[0].get("logs") or {}
    log_group_name = log_info.get("groupName")
    log_stream_name = log_info.get("streamName")
    if not log_group_name or not log_stream_name:
        return {
            "events": [],
            "nextForwardToken": None,
            "logGroupName": log_group_name,
            "logStreamName": log_stream_name,
        }

    params: dict[str, Any] = {
        "logGroupName": log_group_name,
        "logStreamName": log_stream_name,
        "startFromHead": True,
        "limit": 200,
    }
    if next_token:
        params["nextToken"] = next_token
    response = cloudwatch_logs.get_log_events(**params)
    events = [
        {"timestamp": event.get("timestamp"), "message": event.get("message", "")}
        for event in response.get("events", [])
    ]
    return {
        "events": events,
        "nextForwardToken": response.get("nextForwardToken"),
        "logGroupName": log_group_name,
        "logStreamName": log_stream_name,
    }


def _backend_graph_url(user_id: str, backend_id: str) -> dict[str, Any]:
    backend = _get_state_backend(user_id, backend_id)
    graph_key = str(backend.get("graphKey") or "")
    graph_bucket = str(backend.get("graphBucket") or RESOURCE_GRAPH_BUCKET)
    if not graph_key or not graph_bucket:
        raise LookupError(backend.get("graphError") or "Resource graph is not available for this backend")
    url = s3.generate_presigned_url(
        "get_object",
        Params={
            "Bucket": graph_bucket,
            "Key": graph_key,
        },
        ExpiresIn=900,
    )
    return {
        "url": url,
        "expiresIn": 900,
        "backendId": backend_id,
        "graphGeneratedAt": backend.get("graphGeneratedAt"),
        "graphResourceCount": backend.get("graphResourceCount"),
    }


def _save_backend_plan(user_id: str, backend_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    backend = _get_state_backend(user_id, backend_id)
    plan = payload.get("plan")
    if isinstance(plan, str):
        try:
            plan = json.loads(plan)
        except json.JSONDecodeError as exc:
            raise ValueError("plan must be valid JSON") from exc
    if not isinstance(plan, dict):
        raise ValueError("plan must be a Terraform plan JSON object")
    if not isinstance(plan.get("resource_changes"), list):
        raise ValueError("plan.resource_changes must be a list")

    body = json.dumps(plan, separators=(",", ":")).encode("utf-8")
    if len(body) > 10 * 1024 * 1024:
        raise ValueError("plan must be 10MB or smaller")

    credential = _credential_payload(user_id, backend.get("credentialId"))
    session_kwargs = {
        "aws_access_key_id": credential["accessKeyId"],
        "aws_secret_access_key": credential["secretAccessKey"],
        "region_name": backend["region"],
    }
    if credential.get("sessionToken"):
        session_kwargs["aws_session_token"] = credential["sessionToken"]
    target_session = boto3.Session(**session_kwargs)
    target_session.client("s3").put_object(
        Bucket=backend["bucket"],
        Key=backend["key"],
        Body=body,
        ContentType="application/json",
    )

    timestamp = _now()
    table.update_item(
        Key={"pk": user_id, "sk": f"BACKEND#{backend_id}"},
        UpdateExpression="SET updatedAt = :updatedAt, planUpdatedAt = :planUpdatedAt",
        ExpressionAttributeValues={":updatedAt": timestamp, ":planUpdatedAt": timestamp},
    )
    backend["updatedAt"] = timestamp
    backend["planUpdatedAt"] = timestamp
    return backend


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    if event.get("action") == "driftGuardRun":
        try:
            return _run_drift_guard(str(event.get("userId") or ""), str(event.get("guardId") or ""))
        except Exception as exc:
            return {"error": str(exc)}

    origin = event.get("headers", {}).get("origin") or event.get("headers", {}).get("Origin")
    if event.get("httpMethod") == "OPTIONS":
        return _response(200, {}, origin)

    try:
        method = event.get("httpMethod")
        path = event.get("path") or ""

        if path.endswith("/github/webhook") and method == "POST":
            return _response(200, _store_github_webhook(event), origin)

        user_id = _user_id(event)
        _store_user_profile(user_id, event)

        if path.endswith("/aws-credential") and method == "GET":
            return _response(200, {"credential": _credential_metadata(user_id)}, origin)
        if path.endswith("/aws-credential") and method == "POST":
            return _response(200, {"credential": _save_aws_credential(user_id, _body(event))}, origin)
        if path.endswith("/aws-credentials") and method == "GET":
            return _response(200, _list_aws_credentials(user_id), origin)
        if path.endswith("/aws-credentials") and method == "POST":
            return _response(200, {"credential": _save_aws_credential(user_id, _body(event))}, origin)
        if path.endswith("/github/webhook-secret") and method == "GET":
            return _response(200, {"webhookSecret": _github_webhook_secret_metadata()}, origin)
        if path.endswith("/github/webhook-secret") and method == "POST":
            return _response(200, {"webhookSecret": _save_github_webhook_secret(_body(event))}, origin)
        if path.endswith("/user/chat-sessions") and method == "GET":
            return _response(200, _list_chat_sessions(user_id), origin)
        if path.endswith("/user/chat-sessions") and method == "POST":
            return _response(200, _save_chat_sessions(user_id, _body(event)), origin)
        chat_session_match = re.search(r"/user/chat-sessions/([^/]+)$", path)
        if chat_session_match and method == "DELETE":
            return _response(200, _delete_chat_session(user_id, chat_session_match.group(1)), origin)
        if path.endswith("/user/config") and method == "GET":
            return _response(200, _list_user_config(user_id), origin)
        if path.endswith("/user/config") and method == "POST":
            return _response(200, {"config": _save_user_config(user_id, _body(event))}, origin)
        if path.endswith("/resources/state-backends") and method == "GET":
            return _response(200, {"backends": _list_state_backends(user_id)}, origin)
        if path.endswith("/resources/state-backends") and method == "POST":
            return _response(200, {"backend": _create_state_backend(user_id, _body(event))}, origin)
        if path.endswith("/resources/s3-buckets") and method == "GET":
            return _response(200, _list_s3_buckets(user_id, event.get("queryStringParameters")), origin)
        if path.endswith("/resources/terraform-plans") and method == "GET":
            return _response(200, {"jobs": _list_terraform_jobs(user_id)}, origin)
        if path.endswith("/resources/terraform-plans") and method == "POST":
            return _response(200, _start_terraform_plan(user_id, _body(event)), origin)
        plan_match = re.search(r"/resources/state-backends/([^/]+)/plan$", path)
        if plan_match and method == "POST":
            return _response(200, {"backend": _save_backend_plan(user_id, plan_match.group(1), _body(event))}, origin)
        backend_resources_match = re.search(r"/resources/state-backends/([^/]+)/resources$", path)
        if backend_resources_match and method == "GET":
            return _response(200, _list_state_backend_resources(user_id, backend_resources_match.group(1)), origin)
        backend_graph_match = re.search(r"/resources/state-backends/([^/]+)/graph$", path)
        if backend_graph_match and method == "GET":
            return _response(200, {"graph": _backend_graph_url(user_id, backend_graph_match.group(1))}, origin)
        if path.endswith("/resources/scans") and method == "GET":
            return _response(200, {"scans": _list_scans(user_id)}, origin)
        if path.endswith("/resources/scans") and method == "POST":
            return _response(200, {"scan": _start_scan(user_id, _body(event))}, origin)
        if path.endswith("/resources/drift-guards") and method == "GET":
            return _response(200, {"guards": _list_drift_guards(user_id)}, origin)
        if path.endswith("/resources/drift-guards") and method == "POST":
            return _response(200, {"guard": _save_drift_guard(user_id, _body(event))}, origin)
        guard_run_match = re.search(r"/resources/drift-guards/([^/]+)/run$", path)
        if guard_run_match and method == "POST":
            return _response(200, _run_drift_guard(user_id, guard_run_match.group(1)), origin)
        logs_match = re.search(r"/resources/scans/([^/]+)/logs$", path)
        if logs_match and method == "GET":
            query = event.get("queryStringParameters") or {}
            return _response(
                200,
                {"logs": _scan_logs(user_id, logs_match.group(1), query.get("nextToken"))},
                origin,
            )
        if path.endswith("/github/pull-requests") and method == "GET":
            query = event.get("queryStringParameters") or {}
            return _response(
                200,
                {
                    "pullRequests": _list_github_pull_requests(
                        str(query.get("repository") or ""),
                        str(query.get("state") or "open"),
                    )
                },
                origin,
            )

        return _response(404, {"error": "Not found"}, origin)
    except PermissionError as exc:
        return _response(401, {"error": str(exc)}, origin)
    except (ValueError, LookupError) as exc:
        return _response(400, {"error": str(exc)}, origin)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "ClientError")
        return _response(500, {"error": code}, origin)
    except Exception:
        return _response(500, {"error": "Internal server error"}, origin)
