"""Shared helpers for /api/projects route modules."""

from __future__ import annotations

from app.models import Project, Thread
from app.services.project import credentials as project_credentials


def mask_credentials(creds: dict) -> dict:
    """Return a copy of credentials with secret values masked."""
    return project_credentials.mask_credentials(creds)


def merge_credentials(existing: dict[str, str], patch: dict[str, str]) -> dict[str, str]:
    """Merge credential patch into existing values.

    Empty-string / null values remove keys; omitted keys are preserved.
    """
    return project_credentials.merge_credentials(existing, patch)


def project_to_dict(project: Project) -> dict:
    return {
        "id": project.id,
        "name": project.name,
        "provider": project.provider,
        "createdAt": project.created_at.isoformat(),
    }


def thread_to_dict(thread: Thread) -> dict:
    return {"id": thread.id, "title": thread.title, "createdAt": thread.created_at.isoformat()}
