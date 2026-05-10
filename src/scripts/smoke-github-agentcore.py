#!/usr/bin/env python3
"""Smoke test deployed AgentCore GitHub App workspace setup."""

from __future__ import annotations

import getpass
import json
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request

import boto3


REGION = "us-east-2"
CLIENT_ID = "7jlejvkicb7p0vmcalhb3mc4p9"
RUNTIME_ARN = (
    "arn:aws:bedrock-agentcore:us-east-2:649519997247:"
    "runtime/Infrastructure_agent_stack_FASTAgent-L1eZxNEorS"
)


def invoke_runtime(access_token: str, action: str = "preview") -> tuple[int, str]:
    session_id = f"github-{action}-" + secrets.token_hex(16)
    payload = {"prompt": action, "runtimeSessionId": session_id}
    if action == "diagnostic":
        payload["filesystemDiagnostic"] = True
    else:
        github_action = "createPullRequest" if action == "create" else "previewPullRequest"
        payload.update(
            {
                "prompt": github_action,
                "githubAction": github_action,
                "repository": {
                    "owner": "png261",
                    "name": "hcp-terraform",
                    "fullName": "png261/hcp-terraform",
                    "defaultBranch": "main",
                },
            }
        )
        if action == "create":
            payload["pullRequest"] = {
                "title": "AgentCore smoke pull request",
                "body": "Smoke test from AgentCore.",
            }
    url = (
        "https://bedrock-agentcore."
        + REGION
        + ".amazonaws.com/runtimes/"
        + urllib.parse.quote(RUNTIME_ARN, safe="")
        + "/invocations?qualifier=DEFAULT"
    )
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": session_id,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=240) as response:
            return response.status, response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", errors="replace")


def summarize(status: int, body: str) -> dict:
    lines = [line for line in body.splitlines() if line.startswith("data: ")]
    if not lines:
        return {"status": status, "body": body[:4000]}
    try:
        payload = json.loads(lines[-1][6:])
    except json.JSONDecodeError:
        return {"status": status, "body": body[:4000]}
    preview = payload.get("preview") or {}
    if payload.get("pullRequest") is not None:
        return {"status": status, "resultStatus": payload.get("status"), "pullRequest": payload.get("pullRequest")}
    if payload.get("mountPath"):
        return {"status": status, **payload}
    return {
        "status": status,
        "resultStatus": payload.get("status"),
        "error": payload.get("error"),
        "repository": preview.get("repository"),
        "baseBranch": preview.get("baseBranch"),
        "headBranch": preview.get("headBranch"),
        "hasChanges": preview.get("hasChanges"),
        "changedFilesCount": len(preview.get("changedFiles") or []),
    }


def main() -> int:
    username = input("Cognito username: ")
    password = getpass.getpass("Cognito password: ")
    auth = boto3.client("cognito-idp", region_name=REGION).initiate_auth(
        ClientId=CLIENT_ID,
        AuthFlow="USER_PASSWORD_AUTH",
        AuthParameters={"USERNAME": username, "PASSWORD": password},
    )
    access_token = auth["AuthenticationResult"]["AccessToken"]
    action = sys.argv[1] if len(sys.argv) > 1 else "preview"
    status, body = invoke_runtime(access_token, action)
    summary = summarize(status, body)
    print(json.dumps(summary, indent=2))
    ok = status == 200 and (
        summary.get("resultStatus") == "ok" or summary.get("status") == "ok"
    )
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
