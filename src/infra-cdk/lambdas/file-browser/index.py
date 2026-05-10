"""List and preview S3 objects for the AppSync file explorer."""

import base64
import os

import boto3

s3 = boto3.client("s3")
BUCKET_NAME = os.environ["BUCKET_NAME"]
MAX_PREVIEW_BYTES = int(os.environ.get("MAX_PREVIEW_BYTES", str(1024 * 1024)))


def _list_files(prefix: str):
    paginator = s3.get_paginator("list_objects_v2")
    entries = []
    for page in paginator.paginate(Bucket=BUCKET_NAME, Prefix=prefix):
        for obj in page.get("Contents", []):
            entries.append(
                {
                    "key": obj["Key"],
                    "size": obj.get("Size"),
                    "lastModified": obj["LastModified"].isoformat().replace("+00:00", "Z"),
                    "eTag": obj.get("ETag", "").strip('"'),
                }
            )

    return entries


def _get_file_content(key: str):
    head = s3.head_object(Bucket=BUCKET_NAME, Key=key)
    size = head.get("ContentLength", 0)
    get_kwargs = {"Bucket": BUCKET_NAME, "Key": key}
    if size > MAX_PREVIEW_BYTES:
        get_kwargs["Range"] = f"bytes=0-{MAX_PREVIEW_BYTES - 1}"

    obj = s3.get_object(**get_kwargs)
    content_bytes = obj["Body"].read()
    content_type = obj.get("ContentType") or head.get("ContentType")

    try:
        content = content_bytes.decode("utf-8")
        encoding = "utf-8"
    except UnicodeDecodeError:
        content = base64.b64encode(content_bytes).decode("ascii")
        encoding = "base64"

    if size > MAX_PREVIEW_BYTES and encoding == "utf-8":
        content += f"\n\n[Preview truncated to {MAX_PREVIEW_BYTES} bytes of {size} bytes]"

    return {
        "key": key,
        "content": content,
        "contentType": content_type,
        "encoding": encoding,
        "size": size,
        "lastModified": head.get("LastModified").isoformat().replace("+00:00", "Z"),
    }


def handler(event, _context):
    arguments = event.get("arguments", {})
    field_name = event.get("info", {}).get("fieldName")
    if field_name == "getFileContent":
        return _get_file_content(arguments["key"])

    return _list_files(arguments.get("prefix") or "")
