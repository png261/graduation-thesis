#!/usr/bin/env python3
"""Smoke-test AgentCore chat with a pasted-image style attachment."""

from __future__ import annotations

import base64
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

import boto3

from utils import get_stack_config


PNG_1X1 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
)


def decode_jwt_claims(token: str) -> dict:
    payload = token.split(".")[1]
    payload += "=" * (-len(payload) % 4)
    return json.loads(base64.urlsafe_b64decode(payload.encode("utf-8")))


def authenticate(client_id: str, region: str, username: str, password: str) -> dict[str, str]:
    cognito = boto3.client("cognito-idp", region_name=region)
    auth = cognito.initiate_auth(
        AuthFlow="USER_PASSWORD_AUTH",
        ClientId=client_id,
        AuthParameters={"USERNAME": username, "PASSWORD": password},
    )
    tokens = auth["AuthenticationResult"]
    return {
        "accessToken": tokens["AccessToken"],
        "idToken": tokens["IdToken"],
        "userId": decode_jwt_claims(tokens["IdToken"])["sub"],
    }


def runtime_url(runtime_arn: str, region: str) -> str:
    escaped = urllib.parse.quote(runtime_arn, safe="")
    return f"https://bedrock-agentcore.{region}.amazonaws.com/runtimes/{escaped}/invocations?qualifier=DEFAULT"


def invoke(runtime_arn: str, region: str, access_token: str, payload: dict) -> list[dict]:
    session_id = payload["runtimeSessionId"]
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
        raise RuntimeError(exc.read().decode("utf-8", "replace")) from exc

    events = []
    for line in text.splitlines():
        if not line.startswith("data:"):
            continue
        raw = line.split("data:", 1)[1].strip()
        if raw:
            events.append(json.loads(raw))
    for event in events:
        if event.get("status") == "error":
            raise RuntimeError(event.get("error") or "AgentCore returned an error")
    return events


def main() -> int:
    username = os.environ["SMOKE_COGNITO_USERNAME"]
    password = os.environ["SMOKE_COGNITO_PASSWORD"]
    stack = get_stack_config(os.environ.get("STACK_NAME"))
    outputs = stack["outputs"]
    region = stack["region"]
    auth = authenticate(outputs["CognitoClientId"], region, username, password)
    session_id = str(uuid.uuid4())
    events = invoke(
        outputs["RuntimeArn"],
        region,
        auth["accessToken"],
        {
            "prompt": "Describe the pasted image in one short sentence. Do not modify files.",
            "runtimeSessionId": session_id,
            "attachments": [
                {
                    "id": "pasted-image-smoke",
                    "name": "pasted-image.png",
                    "type": "image/png",
                    "size": len(PNG_1X1),
                    "dataUrl": f"data:image/png;base64,{PNG_1X1}",
                }
            ],
        },
    )
    text = "".join(str(event.get("data") or "") for event in events)
    if not text.strip():
        for event in events:
            message = event.get("message")
            if isinstance(message, dict):
                content = message.get("content")
                if isinstance(content, list):
                    text = "".join(str(item.get("text") or "") for item in content if isinstance(item, dict))
                elif isinstance(content, str):
                    text = content
            if text.strip():
                break
    if not text.strip():
        raise RuntimeError(
            "image attachment smoke returned no assistant text; "
            f"events={json.dumps(events[-5:], default=str)[:2000]}"
        )
    print(
        json.dumps(
            {
                "sessionId": session_id,
                "eventCount": len(events),
                "responsePreview": text[:500],
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
