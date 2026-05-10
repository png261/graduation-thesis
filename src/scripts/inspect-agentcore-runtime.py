#!/usr/bin/env python3
"""Inspect deployed AgentCore runtime filesystem from the command API."""

from __future__ import annotations

import json
import secrets
import sys

import boto3


REGION = "us-east-2"
RUNTIME_ARN = (
    "arn:aws:bedrock-agentcore:us-east-2:649519997247:"
    "runtime/Infrastructure_agent_stack_FASTAgent-L1eZxNEorS"
)


def main() -> int:
    client = boto3.client("bedrock-agentcore", region_name=REGION)
    session_id = "cmd-smoke-" + secrets.token_hex(16)
    command = " && ".join(
        [
            "id",
            "pwd",
            "ls -ld /mnt /mnt/s3 || true",
            "stat -c '%a %u %g %n' /mnt /mnt/s3 || true",
            "touch /mnt/s3/probe.txt || true",
            "mkdir -p /mnt/s3/repos/probe || true",
            "ls -la /mnt/s3 || true",
        ]
    )
    response = client.invoke_agent_runtime_command(
        agentRuntimeArn=RUNTIME_ARN,
        qualifier="DEFAULT",
        runtimeSessionId=session_id,
        body={"command": command, "timeout": 30},
    )
    output: list[str] = []
    for event in response["stream"]:
        if "chunk" in event:
            chunk = event["chunk"].get("bytes", b"")
            output.append(chunk.decode("utf-8", "replace") if isinstance(chunk, bytes) else str(chunk))
        else:
            output.append(json.dumps(event, default=str))
    print("".join(output))
    return 0


if __name__ == "__main__":
    sys.exit(main())
