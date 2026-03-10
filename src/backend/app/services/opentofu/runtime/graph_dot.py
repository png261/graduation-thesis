from __future__ import annotations

import re
from typing import Any

_NODE_RE = re.compile(r'^\s*"(?P<id>.+?)"\s*\[(?P<attrs>.+)\]\s*;?\s*$')
_EDGE_RE = re.compile(
    r'^\s*"(?P<source>.+?)"\s*->\s*"(?P<target>.+?)"(?:\s*\[(?P<attrs>.+)\])?\s*;?\s*$'
)
_ATTR_RE = re.compile(r'(\w+)\s*=\s*("(?:\\.|[^"])*"|[^,\]]+)')
_ADDRESS_RE = re.compile(r'((?:module\.[A-Za-z0-9_-]+\.)*[A-Za-z0-9_]+\.[A-Za-z0-9_-]+)')


def parse_attrs(raw_attrs: str) -> dict[str, str]:
    attrs: dict[str, str] = {}
    for match in _ATTR_RE.finditer(raw_attrs):
        key = match.group(1)
        raw_value = match.group(2).strip()
        if raw_value.startswith('"') and raw_value.endswith('"'):
            raw_value = raw_value[1:-1]
        attrs[key] = raw_value.replace("\\n", "\n")
    return attrs


def clean_label(value: str) -> str:
    cleaned = value.replace("[root] ", "").replace("\n", " ").strip()
    return cleaned or value


def extract_address(text: str) -> str | None:
    match = _ADDRESS_RE.search(text)
    if not match:
        return None
    return match.group(1)


def derive_node_metadata(raw_id: str, label: str) -> tuple[str, str | None, str | None, str | None]:
    haystack = f"{raw_id}\n{label}"
    if "provider[" in haystack:
        return "provider", None, None, None

    address = extract_address(haystack)
    if address:
        parts = address.split(".")
        if len(parts) >= 2:
            resource_type = parts[-2]
            resource_name = parts[-1]
            return "resource", resource_type, resource_name, address

    if "module." in haystack:
        return "module", None, None, None

    return "other", None, None, None


def parse_dot(content: str) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, str]] = []

    for line in content.splitlines():
        if "->" in line:
            edge_match = _EDGE_RE.match(line)
            if not edge_match:
                continue
            edges.append(
                {
                    "source": edge_match.group("source"),
                    "target": edge_match.group("target"),
                }
            )
            continue

        node_match = _NODE_RE.match(line)
        if not node_match:
            continue

        raw_id = node_match.group("id")
        attrs = parse_attrs(node_match.group("attrs"))
        label = clean_label(attrs.get("label") or raw_id)
        nodes.append(
            {
                "raw_id": raw_id,
                "label": label,
            }
        )

    return nodes, edges
