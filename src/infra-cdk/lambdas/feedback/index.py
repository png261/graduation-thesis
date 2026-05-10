"""Feedback API Lambda handler."""

import json
import os
import time
import uuid
from typing import Any

import boto3
from botocore.exceptions import ClientError

TABLE_NAME = os.environ["TABLE_NAME"]
CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("CORS_ALLOWED_ORIGINS", "*").split(",")
    if origin.strip()
]
MAX_SESSION_ID_LENGTH = 100
MAX_MESSAGE_LENGTH = 5000

dynamodb = boto3.client("dynamodb")


def _cors_headers(origin: str | None) -> dict[str, str]:
    allow_origin = CORS_ALLOWED_ORIGINS[0] if CORS_ALLOWED_ORIGINS else "*"
    if origin and (origin in CORS_ALLOWED_ORIGINS or "*" in CORS_ALLOWED_ORIGINS):
        allow_origin = origin

    return {
        "Access-Control-Allow-Origin": allow_origin,
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
        "Access-Control-Allow-Credentials": "true",
        "Content-Type": "application/json",
    }


def _response(status_code: int, body: dict[str, Any], origin: str | None) -> dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": _cors_headers(origin),
        "body": json.dumps(body),
    }


def _validate_payload(payload: dict[str, Any]) -> tuple[dict[str, str], str | None]:
    session_id = payload.get("sessionId")
    message = payload.get("message")
    feedback_type = payload.get("feedbackType")
    comment = payload.get("comment")

    if not isinstance(session_id, str) or not session_id:
        return {}, "sessionId is required"
    if len(session_id) > MAX_SESSION_ID_LENGTH:
        return {}, "sessionId is too long"
    if not session_id.replace("-", "").replace("_", "").isalnum():
        return {}, "sessionId must contain only alphanumeric characters, hyphens, and underscores"
    if not isinstance(message, str) or not message:
        return {}, "message is required"
    if len(message) > MAX_MESSAGE_LENGTH:
        return {}, "message is too long"
    if feedback_type not in ("positive", "negative"):
        return {}, "feedbackType must be positive or negative"
    if comment is not None and (not isinstance(comment, str) or len(comment) > MAX_MESSAGE_LENGTH):
        return {}, "comment is invalid"

    validated = {
        "sessionId": session_id,
        "message": message,
        "feedbackType": feedback_type,
    }
    if comment:
        validated["comment"] = comment
    return validated, None


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    origin = event.get("headers", {}).get("origin") or event.get("headers", {}).get("Origin")
    if event.get("httpMethod") == "OPTIONS":
        return _response(200, {}, origin)

    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _response(400, {"error": "Invalid JSON body"}, origin)

    payload, validation_error = _validate_payload(body)
    if validation_error:
        return _response(400, {"error": validation_error}, origin)

    authorizer = event.get("requestContext", {}).get("authorizer", {})
    claims = authorizer.get("claims", {}) if isinstance(authorizer, dict) else {}
    if not claims:
        return _response(401, {"error": "Unauthorized"}, origin)

    feedback_id = str(uuid.uuid4())
    timestamp = int(time.time() * 1000)
    item = {
        "feedbackId": {"S": feedback_id},
        "sessionId": {"S": payload["sessionId"]},
        "message": {"S": payload["message"]},
        "userId": {"S": claims.get("sub") or "unknown"},
        "feedbackType": {"S": payload["feedbackType"]},
        "timestamp": {"N": str(timestamp)},
    }
    if payload.get("comment"):
        item["comment"] = {"S": payload["comment"]}

    try:
        dynamodb.put_item(TableName=TABLE_NAME, Item=item)
    except ClientError:
        return _response(500, {"error": "Internal server error"}, origin)

    return _response(200, {"success": True, "feedbackId": feedback_id}, origin)
