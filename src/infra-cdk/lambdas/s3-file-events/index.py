"""Publish S3 object change notifications into AppSync."""

import json
import os
from datetime import datetime, timezone
from urllib.parse import unquote_plus, urlparse
from urllib.request import Request, urlopen

import boto3
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest

SESSION = boto3.Session()
CREDENTIALS = SESSION.get_credentials()
REGION = os.environ.get("AWS_REGION", "us-east-1")
APPSYNC_API_URL = os.environ["APPSYNC_API_URL"]

MUTATION = """
mutation PublishFileEvent($input: FileEventInput!) {
  publishFileEvent(input: $input) {
    bucket
    key
    eventName
    eventTime
    size
    eTag
    sequencer
  }
}
"""


def _aws_datetime(value: str | None) -> str:
    if value:
        return value
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _publish(input_value: dict) -> None:
    body = json.dumps({"query": MUTATION, "variables": {"input": input_value}}).encode()
    host = urlparse(APPSYNC_API_URL).netloc
    headers = {
        "Content-Type": "application/json",
        "Host": host,
    }
    aws_request = AWSRequest(
        method="POST",
        url=APPSYNC_API_URL,
        data=body,
        headers=headers,
    )
    SigV4Auth(CREDENTIALS.get_frozen_credentials(), "appsync", REGION).add_auth(aws_request)
    signed_headers = dict(aws_request.headers.items())

    request = Request(APPSYNC_API_URL, data=body, headers=signed_headers, method="POST")
    with urlopen(request, timeout=10) as response:
        response_body = response.read()
        payload = json.loads(response_body)
        if payload.get("errors"):
            raise RuntimeError(json.dumps(payload["errors"]))


def handler(event, _context):
    published = 0
    for record in event.get("Records", []):
        s3_record = record.get("s3", {})
        bucket = s3_record.get("bucket", {}).get("name")
        obj = s3_record.get("object", {})
        key = unquote_plus(obj.get("key", ""))
        if not bucket or not key:
            continue

        _publish(
            {
                "bucket": bucket,
                "key": key,
                "eventName": record.get("eventName", "ObjectChanged"),
                "eventTime": _aws_datetime(record.get("eventTime")),
                "size": obj.get("size"),
                "eTag": obj.get("eTag"),
                "sequencer": obj.get("sequencer"),
            }
        )
        published += 1

    return {"published": published}
