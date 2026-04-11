"""Shared credential parsing/merge/masking helpers for Project credentials JSON."""

from __future__ import annotations

import json

_SECRET_KEYS = {"aws_secret_access_key", "gcp_credentials_json"}
_SELECTION_KEY = "__credential_profile_id"


def _parse_payload(value: str | None) -> dict[str, str]:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return {}
    if not isinstance(parsed, dict):
        return {}
    return {str(k): str(v) for k, v in parsed.items() if v is not None}


def parse_credentials(value: str | None) -> dict[str, str]:
    payload = _parse_payload(value)
    return {key: item for key, item in payload.items() if key != _SELECTION_KEY}


def parse_selected_profile_id(value: str | None) -> str | None:
    payload = _parse_payload(value)
    selected = payload.get(_SELECTION_KEY)
    return selected or None


def serialize_credentials(
    credentials: dict[str, str],
    *,
    selected_profile_id: str | None = None,
) -> str:
    payload = {str(key): str(value) for key, value in credentials.items() if value not in (None, "")}
    if selected_profile_id:
        payload[_SELECTION_KEY] = selected_profile_id
    return json.dumps(payload)


def merge_credentials(existing: dict[str, str], patch: dict[str, str]) -> dict[str, str]:
    merged = dict(existing)
    for key, value in patch.items():
        if value in ("", None):
            merged.pop(str(key), None)
            continue
        merged[str(key)] = str(value)
    return merged


def mask_credentials(creds: dict[str, str]) -> dict[str, str]:
    return {key: ("****" if key in _SECRET_KEYS and value else value) for key, value in creds.items()}
