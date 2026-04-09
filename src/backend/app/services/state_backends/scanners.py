from __future__ import annotations

import re
from typing import Iterable

import hcl2

_BACKEND_BLOCK_RE = re.compile(r'backend\s+"(?P<kind>s3|gcs)"\s*\{(?P<body>.*?)\}', re.DOTALL)
_ASSIGN_RE = re.compile(r"(?P<key>[A-Za-z_][A-Za-z0-9_]*)\s*=\s*\"?(?P<val>[^\"\n]+)\"?")

_ENV_KEYS = {
    "TF_STATE_BUCKET": "bucket",
    "TERRAFORM_STATE_BUCKET": "bucket",
    "TF_STATE_KEY": "key",
    "TERRAFORM_STATE_KEY": "key",
    "TF_STATE_PREFIX": "prefix",
    "TERRAFORM_STATE_PREFIX": "prefix",
}


def _normalized_backend_value(raw: object) -> str:
    if isinstance(raw, list):
        if not raw:
            return ""
        first = raw[0]
        return str(first or "").strip()
    return str(raw or "").strip()


def _parse_backend_body(kind: str, body: str) -> dict[str, str]:
    parsed: dict[str, str] = {}
    for match in _ASSIGN_RE.finditer(body):
        parsed[match.group("key")] = match.group("val").strip()
    provider = "aws" if kind == "s3" else "gcs"
    return {
        "provider": provider,
        "bucket": parsed.get("bucket", ""),
        "key": parsed.get("key", ""),
        "prefix": parsed.get("prefix", ""),
    }


def _extract_with_regex(content: str) -> list[dict[str, str]]:
    candidates: list[dict[str, str]] = []
    for match in _BACKEND_BLOCK_RE.finditer(content):
        kind = match.group("kind")
        body = match.group("body")
        candidates.append(_parse_backend_body(kind, body))
    return candidates


def _extract_with_hcl(content: str) -> list[dict[str, str]]:
    try:
        payload = hcl2.loads(content)
    except Exception:
        return []
    terraform_blocks = payload.get("terraform") if isinstance(payload, dict) else []
    if not isinstance(terraform_blocks, list):
        return []
    candidates: list[dict[str, str]] = []
    for tf_block in terraform_blocks:
        if not isinstance(tf_block, dict):
            continue
        backend_blocks = tf_block.get("backend")
        if not isinstance(backend_blocks, list):
            continue
        for backend in backend_blocks:
            if not isinstance(backend, dict):
                continue
            for kind, body in backend.items():
                if kind not in {"s3", "gcs"}:
                    continue
                if not isinstance(body, dict):
                    continue
                provider = "aws" if kind == "s3" else "gcs"
                candidates.append(
                    {
                        "provider": provider,
                        "bucket": _normalized_backend_value(body.get("bucket")),
                        "key": _normalized_backend_value(body.get("key")),
                        "prefix": _normalized_backend_value(body.get("prefix")),
                    }
                )
    return candidates


def _extract_ci_vars(content: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for line in content.splitlines():
        text = line.strip()
        if not text or text.startswith("#"):
            continue
        normalized = text.replace(":", "=")
        if "=" not in normalized:
            continue
        left, right = normalized.split("=", 1)
        key = left.strip().strip("'\"")
        value = right.strip().strip("'\" ")
        mapped = _ENV_KEYS.get(key)
        if mapped and value:
            result[mapped] = value
    return result


def _candidate_name(provider: str, bucket: str, key: str, prefix: str) -> str:
    target = key or prefix or "state"
    short = target.replace("/", "-").strip("-")
    if not short:
        short = "state"
    return f"{provider}:{bucket}:{short}"[:120]


def scan_backend_candidates(files: Iterable[tuple[str, str]]) -> list[dict[str, str]]:
    candidates: list[dict[str, str]] = []
    ci_hints: dict[str, str] = {}

    for path, content in files:
        path_lower = path.lower()
        if path_lower.endswith(".tf"):
            parsed = _extract_with_hcl(content)
            if not parsed:
                parsed = _extract_with_regex(content)
            for row in parsed:
                row["source_path"] = path
                candidates.append(row)
            continue
        if any(token in path_lower for token in (".github/workflows", ".env", "terraform")):
            ci_hints.update(_extract_ci_vars(content))

    if ci_hints.get("bucket"):
        inferred_provider = "aws"
        bucket = ci_hints.get("bucket", "")
        if "gcs" in bucket or "gcp" in bucket:
            inferred_provider = "gcs"
        candidates.append(
            {
                "provider": inferred_provider,
                "bucket": bucket,
                "key": ci_hints.get("key", ""),
                "prefix": ci_hints.get("prefix", ""),
                "source_path": "ci_vars",
            }
        )

    seen: set[tuple[str, str, str, str]] = set()
    output: list[dict[str, str]] = []
    for row in candidates:
        provider = str(row.get("provider") or "").strip().lower()
        bucket = str(row.get("bucket") or "").strip()
        key = str(row.get("key") or "").strip()
        prefix = str(row.get("prefix") or "").strip()
        if provider not in {"aws", "gcs"} or not bucket:
            continue
        identity = (provider, bucket, key, prefix)
        if identity in seen:
            continue
        seen.add(identity)
        output.append(
            {
                "provider": provider,
                "bucket": bucket,
                "key": key,
                "prefix": prefix,
                "source_path": str(row.get("source_path") or "unknown"),
                "name": _candidate_name(provider, bucket, key, prefix),
            }
        )
    return output
