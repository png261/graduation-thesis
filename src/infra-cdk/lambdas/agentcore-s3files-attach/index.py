"""Attach an S3 Files access point to an AgentCore Runtime.

CloudFormation and some botocore models can lag the public AgentCore Runtime
filesystem API. This custom resource sends the documented REST request shape
directly so deployments can use S3 Files as soon as the service supports it.
"""

import json
import os
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse

import boto3
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest


REGION = os.environ.get("AWS_REGION", "ap-southeast-1")
SESSION = boto3.Session(region_name=REGION)
CLIENT = SESSION.client("bedrock-agentcore-control", region_name=REGION)


def _runtime_id(runtime_arn: str) -> str:
    return runtime_arn.rsplit("/", 1)[-1]


def _signed_json_request(method: str, url: str, body: dict | None = None) -> tuple[int, str]:
    credentials = SESSION.get_credentials()
    if credentials is None:
        raise RuntimeError("AWS credentials are not available")

    payload = None if body is None else json.dumps(body, separators=(",", ":")).encode("utf-8")
    request = AWSRequest(
        method=method,
        url=url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Host": urlparse(url).netloc,
        },
    )
    SigV4Auth(credentials.get_frozen_credentials(), "bedrock-agentcore", REGION).add_auth(request)
    prepared = request.prepare()
    http_request = urllib.request.Request(prepared.url, headers=dict(prepared.headers), method=method)
    if payload is not None:
        http_request.data = payload
    try:
        with urllib.request.urlopen(http_request, timeout=60) as response:
            return response.status, response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8")


def _compact(value):
    if isinstance(value, dict):
        return {key: _compact(item) for key, item in value.items() if item not in (None, {}, [])}
    if isinstance(value, list):
        return [_compact(item) for item in value if item not in (None, {}, [])]
    return value


def _artifact_union(runtime: dict) -> dict:
    artifact = _compact(runtime["agentRuntimeArtifact"])
    for member in ("codeConfiguration", "containerConfiguration"):
        if artifact.get(member):
            return {member: artifact[member]}
    raise RuntimeError("Agent runtime artifact has no supported configuration")


def _get_runtime(runtime_id: str) -> dict:
    url = f"https://bedrock-agentcore-control.{REGION}.amazonaws.com/runtimes/{runtime_id}/"
    status, text = _signed_json_request("GET", url)
    if status < 200 or status >= 300:
        raise RuntimeError(f"GetAgentRuntime failed with HTTP {status}: {text}")
    return json.loads(text)


def _attach(runtime_id: str, access_point_arn: str, mount_path: str) -> None:
    runtime = _get_runtime(runtime_id)
    body = {
        "agentRuntimeArtifact": _artifact_union(runtime),
        "roleArn": runtime["roleArn"],
        "networkConfiguration": runtime["networkConfiguration"],
        "description": runtime.get("description"),
        "authorizerConfiguration": runtime.get("authorizerConfiguration"),
        "requestHeaderConfiguration": runtime.get("requestHeaderConfiguration"),
        "protocolConfiguration": runtime.get("protocolConfiguration"),
        "lifecycleConfiguration": runtime.get("lifecycleConfiguration"),
        "metadataConfiguration": runtime.get("metadataConfiguration"),
        "environmentVariables": runtime.get("environmentVariables"),
        "filesystemConfigurations": [
            {
                "s3FilesAccessPoint": {
                    "accessPointArn": access_point_arn,
                    "mountPath": mount_path,
                }
            }
        ],
    }
    body = _compact(body)

    url = f"https://bedrock-agentcore-control.{REGION}.amazonaws.com/runtimes/{runtime_id}/"
    status, text = _signed_json_request("PUT", url, body)
    if status < 200 or status >= 300:
        raise RuntimeError(f"UpdateAgentRuntime failed with HTTP {status}: {text}")

    deadline = time.time() + 110
    while time.time() < deadline:
        current = CLIENT.get_agent_runtime(agentRuntimeId=runtime_id)
        state = current.get("status")
        if state == "READY":
            return
        if state in {"CREATE_FAILED", "UPDATE_FAILED", "DELETING", "DELETE_FAILED"}:
            raise RuntimeError(f"Agent runtime entered {state}")
        time.sleep(5)
    raise TimeoutError("Timed out waiting for AgentCore Runtime to become READY")


def handler(event, _context):
    request_type = event.get("RequestType")
    props = event.get("ResourceProperties", {})
    runtime_arn = props["RuntimeArn"]
    runtime_id = _runtime_id(runtime_arn)

    if request_type in {"Create", "Update"}:
        _attach(runtime_id, props["AccessPointArn"], props["MountPath"])

    return {
        "PhysicalResourceId": f"{runtime_id}:s3files:{props.get('MountPath', '')}",
        "Data": {
            "RuntimeId": runtime_id,
            "MountPath": props.get("MountPath", ""),
        },
    }
