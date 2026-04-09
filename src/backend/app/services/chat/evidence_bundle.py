from __future__ import annotations

from typing import TypedDict

SECTION_KEYS = {
    "changed files": "changedFiles",
    "validations run": "validationsRun",
    "pass/fail evidence": "passFailEvidence",
    "unresolved risks": "unresolvedRisks",
    "completion rationale": "completionRationale",
}


class EvidenceBundleEvent(TypedDict):
    type: str
    schemaVersion: int
    changedFiles: list[str]
    validationsRun: list[str]
    passFailEvidence: list[str]
    unresolvedRisks: list[str]
    completionRationale: list[str]


def _clean_heading(value: str) -> str:
    return value.lstrip("#*- >").rstrip(":* ").strip().lower()


def _normalize_item(line: str) -> str:
    return line.lstrip("*-0123456789. ").strip()


def extract_evidence_bundle_event(text: str) -> EvidenceBundleEvent | None:
    sections: dict[str, list[str]] = {}
    current: str | None = None

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        section_key = SECTION_KEYS.get(_clean_heading(line))
        if section_key is not None:
            current = section_key
            sections.setdefault(section_key, [])
            continue
        if current is None:
            continue
        sections.setdefault(current, []).append(_normalize_item(line))

    if len(sections) < 3:
        return None

    return {
        "type": "evidence.bundle",
        "schemaVersion": 1,
        "changedFiles": sections.get("changedFiles", []),
        "validationsRun": sections.get("validationsRun", []),
        "passFailEvidence": sections.get("passFailEvidence", []),
        "unresolvedRisks": sections.get("unresolvedRisks", []),
        "completionRationale": sections.get("completionRationale", []),
    }
