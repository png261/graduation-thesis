from __future__ import annotations

from .backend import (
    invalidate_agent,
    project_credentials,
    project_files,
    required_credential_fields_impl,
)

MoveConflictError = project_files.MoveConflictError


def invalidate_project_agent(project_id: str) -> None:
    invalidate_agent(project_id)


def required_credential_fields(provider: str | None) -> list[str]:
    return required_credential_fields_impl(provider)


def parse_credentials(serialized: str | None) -> dict[str, str]:
    return project_credentials.parse_credentials(serialized)


def mask_credentials(credentials: dict) -> dict:
    return project_credentials.mask_credentials(credentials)


def merge_credentials(existing: dict[str, str], patch: dict[str, str]) -> dict[str, str]:
    return project_credentials.merge_credentials(existing, patch)


def delete_project_dir(project_id: str) -> None:
    project_files.delete_project_dir(project_id)


def write_text(project_id: str, path: str, content: str) -> str:
    return project_files.write_text(project_id, path, content)


def read_text(project_id: str, path: str) -> str:
    return project_files.read_text(project_id, path)


def delete_file(project_id: str, path: str) -> str:
    return project_files.delete_file(project_id, path)


def normalize_virtual_path(path: str) -> str:
    return project_files.normalize_virtual_path(path)


def read_bytes(project_id: str, path: str) -> bytes:
    return project_files.read_bytes(project_id, path)


def list_files(project_id: str) -> list[str]:
    return project_files.list_files(project_id)


def move_paths(project_id: str, source_paths: list[str], destination_dir: str) -> list[dict[str, str]]:
    return project_files.move_paths(project_id, source_paths, destination_dir)


def rename_path(project_id: str, path: str, new_name: str) -> dict[str, str]:
    return project_files.rename_path(project_id, path, new_name)


def ensure_project_dir(project_id: str):
    return project_files.ensure_project_dir(project_id)
