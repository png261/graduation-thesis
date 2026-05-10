#!/usr/bin/env python3
"""Smoke test the AgentCore runtime's mounted S3 Files filesystem."""

from __future__ import annotations

import json
import secrets
import string
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import boto3


REGION = "us-east-2"
USER_POOL_ID = "us-east-2_GLShYmuZS"
CLIENT_ID = "5rtllh3bv2v6gaj3o5spefjdot"
RUNTIME_ARN = "arn:aws:bedrock-agentcore:us-east-2:649519997247:runtime/FAST_stack_FASTAgent-59JW3n32BN"


def password() -> str:
    alphabet = string.ascii_letters + string.digits
    return "Aa1!" + "".join(secrets.choice(alphabet) for _ in range(24))


def invoke_runtime(id_token: str) -> tuple[int, str]:
    session_id = "agentcore-s3files-smoke-" + secrets.token_hex(16)
    payload = {
        "prompt": "Run the authenticated filesystem smoke test.",
        "runtimeSessionId": session_id,
        "filesystemSmokeTest": True,
    }
    url = (
        "https://bedrock-agentcore."
        + REGION
        + ".amazonaws.com/runtimes/"
        + urllib.parse.quote(RUNTIME_ARN, safe="")
        + "/invocations"
    )
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {id_token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": session_id,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            return response.status, response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", errors="replace")


def main() -> int:
    cognito = boto3.client("cognito-idp", region_name=REGION)
    username = f"agentcore-smoke-{int(time.time())}@example.com"
    temp_password = password()
    created = False
    try:
        cognito.admin_create_user(
            UserPoolId=USER_POOL_ID,
            Username=username,
            UserAttributes=[
                {"Name": "email", "Value": username},
                {"Name": "email_verified", "Value": "true"},
            ],
            MessageAction="SUPPRESS",
        )
        created = True
        cognito.admin_set_user_password(
            UserPoolId=USER_POOL_ID,
            Username=username,
            Password=temp_password,
            Permanent=True,
        )
        auth = cognito.initiate_auth(
            ClientId=CLIENT_ID,
            AuthFlow="USER_PASSWORD_AUTH",
            AuthParameters={"USERNAME": username, "PASSWORD": temp_password},
        )
        access_token = auth["AuthenticationResult"]["AccessToken"]
        status, body = invoke_runtime(access_token)
        print(json.dumps({"status": status, "body": body[:4000]}, indent=2))
        return 0 if status == 200 and "Shared AgentCore filesystem initialized" in body else 1
    finally:
        if created:
            try:
                cognito.admin_delete_user(UserPoolId=USER_POOL_ID, Username=username)
            except Exception:
                pass


if __name__ == "__main__":
    sys.exit(main())
