from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from google.api_core.exceptions import GoogleAPIError
from google.cloud import storage


@dataclass(slots=True)
class CloudObject:
    key: str
    size: int
    updated_at: str | None


@dataclass(slots=True)
class CloudObjectVersion:
    version: str
    generation: str | None
    etag: str | None
    updated_at: str | None
    key: str


@dataclass(slots=True)
class CloudReadResult:
    payload: bytes
    version: str | None
    generation: str | None
    etag: str | None
    updated_at: str | None


class CloudAdapter:
    provider: str

    def list_buckets(self) -> list[str]:
        raise NotImplementedError

    def list_objects(self, *, bucket: str, prefix: str = "", limit: int = 300) -> list[CloudObject]:
        raise NotImplementedError

    def read_object(self, *, bucket: str, key: str) -> CloudReadResult:
        raise NotImplementedError

    def list_versions(self, *, bucket: str, key: str, limit: int = 100) -> list[CloudObjectVersion]:
        raise NotImplementedError

    def is_versioning_enabled(self, *, bucket: str) -> bool | None:
        raise NotImplementedError


class AwsS3Adapter(CloudAdapter):
    provider = "aws"

    def __init__(self, credentials: dict[str, str]) -> None:
        kwargs = {
            "aws_access_key_id": credentials.get("aws_access_key_id"),
            "aws_secret_access_key": credentials.get("aws_secret_access_key"),
            "aws_session_token": credentials.get("aws_session_token"),
            "region_name": credentials.get("aws_region"),
        }
        filtered = {key: val for key, val in kwargs.items() if val}
        self._client = boto3.client("s3", **filtered)

    def list_buckets(self) -> list[str]:
        try:
            payload = self._client.list_buckets()
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(str(exc)) from exc
        buckets = payload.get("Buckets") if isinstance(payload, dict) else []
        if not isinstance(buckets, list):
            return []
        result: list[str] = []
        for row in buckets:
            if isinstance(row, dict):
                name = str(row.get("Name") or "").strip()
                if name:
                    result.append(name)
        return sorted(result)

    def list_objects(self, *, bucket: str, prefix: str = "", limit: int = 300) -> list[CloudObject]:
        try:
            payload = self._client.list_objects_v2(Bucket=bucket, Prefix=prefix, MaxKeys=max(1, min(limit, 1000)))
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(str(exc)) from exc
        rows = payload.get("Contents") if isinstance(payload, dict) else []
        if not isinstance(rows, list):
            return []
        objects: list[CloudObject] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            key = str(row.get("Key") or "").strip()
            if not key:
                continue
            last_modified = row.get("LastModified")
            updated_at = last_modified.isoformat() if isinstance(last_modified, datetime) else None
            objects.append(
                CloudObject(
                    key=key,
                    size=int(row.get("Size") or 0),
                    updated_at=updated_at,
                )
            )
        return objects

    def read_object(self, *, bucket: str, key: str) -> CloudReadResult:
        try:
            payload = self._client.get_object(Bucket=bucket, Key=key)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(str(exc)) from exc
        body = payload.get("Body")
        if body is None:
            raise RuntimeError("missing_object_body")
        data = body.read()
        updated = payload.get("LastModified")
        return CloudReadResult(
            payload=data,
            version=str(payload.get("VersionId") or "") or None,
            generation=None,
            etag=str(payload.get("ETag") or "").strip('"') or None,
            updated_at=updated.isoformat() if isinstance(updated, datetime) else None,
        )

    def list_versions(self, *, bucket: str, key: str, limit: int = 100) -> list[CloudObjectVersion]:
        try:
            payload = self._client.list_object_versions(Bucket=bucket, Prefix=key, MaxKeys=max(1, min(limit, 1000)))
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(str(exc)) from exc
        rows = payload.get("Versions") if isinstance(payload, dict) else []
        if not isinstance(rows, list):
            return []
        versions: list[CloudObjectVersion] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            row_key = str(row.get("Key") or "")
            if row_key != key:
                continue
            updated = row.get("LastModified")
            versions.append(
                CloudObjectVersion(
                    version=str(row.get("VersionId") or "") or "null",
                    generation=None,
                    etag=str(row.get("ETag") or "").strip('"') or None,
                    updated_at=updated.isoformat() if isinstance(updated, datetime) else None,
                    key=row_key,
                )
            )
        return versions

    def is_versioning_enabled(self, *, bucket: str) -> bool | None:
        try:
            payload = self._client.get_bucket_versioning(Bucket=bucket)
        except (ClientError, BotoCoreError):
            return None
        status = str(payload.get("Status") or "").strip().lower()
        if not status:
            return False
        return status == "enabled"


class GcsAdapter(CloudAdapter):
    provider = "gcs"

    def __init__(self, credentials: dict[str, str]) -> None:
        raw = credentials.get("gcp_credentials_json")
        if raw:
            info = json.loads(raw)
            self._client = storage.Client.from_service_account_info(info)
        else:
            self._client = storage.Client()

    def list_buckets(self) -> list[str]:
        try:
            buckets = list(self._client.list_buckets())
        except GoogleAPIError as exc:
            raise RuntimeError(str(exc)) from exc
        return sorted([bucket.name for bucket in buckets if bucket.name])

    def list_objects(self, *, bucket: str, prefix: str = "", limit: int = 300) -> list[CloudObject]:
        try:
            blobs = list(self._client.list_blobs(bucket, prefix=prefix, max_results=max(1, limit)))
        except GoogleAPIError as exc:
            raise RuntimeError(str(exc)) from exc
        return [
            CloudObject(
                key=blob.name,
                size=int(blob.size or 0),
                updated_at=blob.updated.isoformat() if blob.updated else None,
            )
            for blob in blobs
            if blob.name
        ]

    def read_object(self, *, bucket: str, key: str) -> CloudReadResult:
        blob = self._client.bucket(bucket).blob(key)
        try:
            data = blob.download_as_bytes()
            blob.reload()
        except GoogleAPIError as exc:
            raise RuntimeError(str(exc)) from exc
        return CloudReadResult(
            payload=data,
            version=str(blob.generation) if blob.generation is not None else None,
            generation=str(blob.generation) if blob.generation is not None else None,
            etag=blob.etag,
            updated_at=blob.updated.isoformat() if blob.updated else None,
        )

    def list_versions(self, *, bucket: str, key: str, limit: int = 100) -> list[CloudObjectVersion]:
        try:
            blobs = list(
                self._client.list_blobs(
                    bucket,
                    prefix=key,
                    versions=True,
                    max_results=max(1, limit),
                )
            )
        except GoogleAPIError as exc:
            raise RuntimeError(str(exc)) from exc
        versions: list[CloudObjectVersion] = []
        for blob in blobs:
            if blob.name != key:
                continue
            generation = str(blob.generation) if blob.generation is not None else None
            versions.append(
                CloudObjectVersion(
                    version=generation or "null",
                    generation=generation,
                    etag=blob.etag,
                    updated_at=blob.updated.isoformat() if blob.updated else None,
                    key=blob.name,
                )
            )
        return versions

    def is_versioning_enabled(self, *, bucket: str) -> bool | None:
        try:
            item = self._client.bucket(bucket)
            item.reload()
        except GoogleAPIError:
            return None
        return bool(item.versioning_enabled)


def get_cloud_adapter(provider: str, credentials: dict[str, str]) -> CloudAdapter:
    normalized = (provider or "").strip().lower()
    if normalized == "aws":
        return AwsS3Adapter(credentials)
    if normalized in {"gcs", "gcloud", "google", "google_cloud"}:
        return GcsAdapter(credentials)
    raise ValueError("unsupported_cloud_provider")


def likely_state_objects(items: list[CloudObject]) -> list[CloudObject]:
    results = [item for item in items if item.key.endswith(".tfstate")]
    return sorted(results, key=lambda item: item.key)


def normalize_cloud_provider(value: str) -> str:
    normalized = (value or "").strip().lower()
    if normalized in {"gcs", "gcloud", "google", "google_cloud"}:
        return "gcs"
    if normalized == "aws":
        return "aws"
    raise ValueError("unsupported_cloud_provider")


def parse_state_payload(raw: bytes) -> dict[str, Any]:
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except Exception as exc:
        raise ValueError("invalid_state_json") from exc
    if not isinstance(parsed, dict):
        raise ValueError("invalid_state_shape")
    return parsed
