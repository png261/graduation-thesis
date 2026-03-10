"""Shared payload serialization for GitHub repository API responses."""
from __future__ import annotations

from typing import Any


def repo_payload(repo: dict[str, Any]) -> dict[str, Any]:
    owner = repo.get("owner") if isinstance(repo.get("owner"), dict) else {}
    return {
        "id": repo.get("id"),
        "name": repo.get("name"),
        "full_name": repo.get("full_name"),
        "private": bool(repo.get("private")),
        "default_branch": repo.get("default_branch"),
        "owner_login": owner.get("login"),
    }
