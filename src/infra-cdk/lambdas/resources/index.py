"""Resources API Lambda handler."""

import json
import os
import re
import time
import uuid
import base64
import hashlib
import hmac
from decimal import Decimal
from typing import Any

import boto3
from botocore.exceptions import ClientError

TABLE_NAME = os.environ["TABLE_NAME"]
CODEBUILD_PROJECT_NAME = os.environ["CODEBUILD_PROJECT_NAME"]
STACK_NAME_BASE = os.environ["STACK_NAME_BASE"]
DRIFT_GUARD_SCHEDULER_ROLE_ARN = os.environ.get("DRIFT_GUARD_SCHEDULER_ROLE_ARN", "")
RESOURCES_LAMBDA_ARN = os.environ.get("RESOURCES_LAMBDA_ARN", "")
GITHUB_APP_SECRET_NAME = os.environ.get("GITHUB_APP_SECRET_NAME", f"/{STACK_NAME_BASE}/github_app")
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


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _cors_headers(origin: str | None) -> dict[str, str]:
    allow_origin = CORS_ALLOWED_ORIGINS[0] if CORS_ALLOWED_ORIGINS else "*"
    if origin and (origin in CORS_ALLOWED_ORIGINS or "*" in CORS_ALLOWED_ORIGINS):
        allow_origin = origin
    return {
        "Access-Control-Allow-Origin": allow_origin,
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
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

    if not re.fullmatch(r"\d{12}", account_id):
        raise ValueError("accountId must be a 12 digit AWS account ID")
    if not re.fullmatch(r"[a-z]{2}-[a-z]+-\d", region):
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
    credential_name = str(payload.get("name") or "").strip() or f"{account_id} {region}"
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


def _github_app_bot_login() -> str:
    try:
        payload = _github_secret_payload()
    except PermissionError:
        return ""
    app_slug = str(payload.get("app_slug") or payload.get("appSlug") or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9-]+", app_slug):
        return ""
    return f"{app_slug}[bot]"


def _is_github_app_pull_request(
    author: Any,
    head_branch: Any,
    created_by_github_app: Any = False,
    bot_login: str | None = None,
) -> bool:
    if created_by_github_app is True:
        return True
    if str(head_branch or "").startswith("agentcore/"):
        return True
    if bot_login is None:
        bot_login = _github_app_bot_login()
    return bool(bot_login and str(author or "") == bot_login)


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
        "draft": bool(pr.get("draft")),
        "url": pr.get("html_url") or "",
        "author": author,
        "headBranch": head_branch,
        "baseBranch": base.get("ref") if isinstance(base, dict) else "",
        "headSha": head.get("sha") if isinstance(head, dict) else "",
        "labels": [label.get("name") for label in labels if isinstance(label, dict) and label.get("name")],
        "createdByGitHubApp": _is_github_app_pull_request(author, head_branch),
        "createdAt": pr.get("created_at") or timestamp,
        "githubUpdatedAt": pr.get("updated_at") or timestamp,
        "updatedAt": timestamp,
        "lastEvent": event_name,
        "lastAction": action,
        "lastDelivery": delivery,
    }


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
    response = table.query(
        KeyConditionExpression="pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues={":pk": f"GITHUB#{repo}", ":prefix": "PR#"},
        ScanIndexForward=False,
    )
    items = response.get("Items", [])
    bot_login = _github_app_bot_login()
    items = [
        item
        for item in items
        if _is_github_app_pull_request(
            item.get("author"),
            item.get("headBranch"),
            item.get("createdByGitHubApp"),
            bot_login,
        )
    ]
    if state in {"open", "closed", "merged"}:
        items = [item for item in items if item.get("state") == state]
    return sorted(items, key=lambda item: item.get("githubUpdatedAt") or item.get("updatedAt", ""), reverse=True)


def _state_backend_id() -> str:
    return str(uuid.uuid4())


def _validate_state_backend(payload: dict[str, Any]) -> dict[str, str]:
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
    return {
        "name": name,
        "bucket": bucket,
        "key": key,
        "region": region,
        "service": service,
        "credentialId": credential_id,
    }


def _list_state_backends(user_id: str) -> list[dict[str, Any]]:
    response = table.query(
        KeyConditionExpression="pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues={":pk": user_id, ":prefix": "BACKEND#"},
        ScanIndexForward=False,
    )
    return sorted(response.get("Items", []), key=lambda item: item.get("updatedAt", ""), reverse=True)


def _create_state_backend(user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    validated = _validate_state_backend(payload)
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
        "createdAt": timestamp,
        "updatedAt": timestamp,
    }
    table.put_item(Item=item)
    return item


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
    validated = _validate_state_backend(payload)
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
        if path.endswith("/resources/state-backends") and method == "GET":
            return _response(200, {"backends": _list_state_backends(user_id)}, origin)
        if path.endswith("/resources/state-backends") and method == "POST":
            return _response(200, {"backend": _create_state_backend(user_id, _body(event))}, origin)
        if path.endswith("/resources/terraform-plans") and method == "GET":
            return _response(200, {"jobs": _list_terraform_jobs(user_id)}, origin)
        if path.endswith("/resources/terraform-plans") and method == "POST":
            return _response(200, _start_terraform_plan(user_id, _body(event)), origin)
        plan_match = re.search(r"/resources/state-backends/([^/]+)/plan$", path)
        if plan_match and method == "POST":
            return _response(200, {"backend": _save_backend_plan(user_id, plan_match.group(1), _body(event))}, origin)
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
