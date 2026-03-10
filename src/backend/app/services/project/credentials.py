"""Shared credential parsing/merge/masking helpers for Project credentials JSON."""
from __future__ import annotations

import json

_SECRET_KEYS = {"aws_secret_access_key", "gcp_credentials_json"}


def parse_credentials(value: str | None) -> dict[str, str]:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return {}
    if not isinstance(parsed, dict):
        return {}
    return {str(k): str(v) for k, v in parsed.items() if v is not None}


def merge_credentials(existing: dict[str, str], patch: dict[str, str]) -> dict[str, str]:
    merged = dict(existing)
    for key, value in patch.items():
        if value in ("", None):
            merged.pop(str(key), None)
        else:
            merged[str(key)] = str(value)
    return merged


def mask_credentials(creds: dict[str, str]) -> dict[str, str]:
    return {k: ("****" if k in _SECRET_KEYS and v else v) for k, v in creds.items()}
