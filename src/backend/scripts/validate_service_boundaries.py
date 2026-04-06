from __future__ import annotations

import importlib
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from app.service_boundaries import SERVICE_BOUNDARIES  # noqa: E402


def _importable_module_prefix(reference: str) -> tuple[object, list[str]] | None:
    parts = reference.split(".")
    for index in range(len(parts), 0, -1):
        module_name = ".".join(parts[:index])
        try:
            module = importlib.import_module(module_name)
        except Exception:
            continue
        return module, parts[index:]
    return None


def _reference_exists(reference: str) -> bool:
    resolved = _importable_module_prefix(reference)
    if resolved is None:
        return False
    module, attributes = resolved
    current = module
    for attribute in attributes:
        if not hasattr(current, attribute):
            return False
        current = getattr(current, attribute)
    return True


def _duplicates(values: list[str]) -> list[str]:
    seen: set[str] = set()
    repeated: list[str] = []
    for value in values:
        if value in seen and value not in repeated:
            repeated.append(value)
        seen.add(value)
    return repeated


def _prefix_overlaps(values: list[str]) -> list[str]:
    overlaps: list[str] = []
    ordered = sorted(values)
    for index, value in enumerate(ordered):
        for candidate in ordered[index + 1 :]:
            if not candidate.startswith(f"{value}."):
                continue
            overlaps.append(f"{value} overlaps {candidate}")
    return overlaps


def validate() -> list[str]:
    errors: list[str] = []
    names = [boundary.name for boundary in SERVICE_BOUNDARIES]
    duplicate_names = _duplicates(names)
    if duplicate_names:
        errors.append(f"duplicate service names: {', '.join(duplicate_names)}")

    claimed_references: list[str] = []
    for boundary in SERVICE_BOUNDARIES:
        if not boundary.owned_data:
            if boundary.name != "gateway":
                errors.append(f"{boundary.name} must declare owned_data entries")
        for reference in boundary.current_references:
            claimed_references.append(reference)
            if not _reference_exists(reference):
                errors.append(f"{boundary.name} references missing module or symbol: {reference}")

    duplicate_references = _duplicates(claimed_references)
    if duplicate_references:
        errors.append(f"references claimed by multiple services: {', '.join(duplicate_references)}")

    prefix_overlaps = _prefix_overlaps(claimed_references)
    if prefix_overlaps:
        errors.append(f"reference overlaps detected: {', '.join(prefix_overlaps)}")

    return errors


def main() -> int:
    errors = validate()
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1
    print("Service boundary manifest is valid.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
