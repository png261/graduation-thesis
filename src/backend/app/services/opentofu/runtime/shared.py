"""Shared OpenTofu deploy helpers."""
from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
from pathlib import Path
from typing import Any

from sqlalchemy import select

from app import db
from app.models import Project
from app.services.project import files as project_files

_PROJECT_LOCKS: dict[str, asyncio.Lock] = {}
_VAR_FILE_NAMES: tuple[str, ...] = (
    "terraform.tfvars",
    "terraform.tfvars.json",
    "tofu.tfvars",
    "tofu.tfvars.json",
)
_TOFU_ENV_BLOCKLIST: tuple[str, ...] = (
    "TF_WORKSPACE",
    "TF_CLI_ARGS",
    "TF_CLI_ARGS_init",
    "TF_CLI_ARGS_plan",
    "TF_CLI_ARGS_apply",
    "TF_CLI_ARGS_graph",
)


def required_credential_fields(provider: str | None) -> list[str]:
    if provider == "aws":
        return ["aws_access_key_id", "aws_secret_access_key", "aws_region"]
    if provider == "gcloud":
        return ["gcp_project_id", "gcp_region", "gcp_credentials_json"]
    return []


def opentofu_available() -> bool:
    return shutil.which("tofu") is not None


def project_lock(project_id: str) -> asyncio.Lock:
    if project_id not in _PROJECT_LOCKS:
        _PROJECT_LOCKS[project_id] = asyncio.Lock()
    return _PROJECT_LOCKS[project_id]


def _is_tf_var_name(name: str) -> bool:
    return bool(re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", name))


def _inject_tf_var_env(env: dict[str, str], values: dict[str, str]) -> None:
    for key, value in values.items():
        if not value:
            continue
        if _is_tf_var_name(key):
            env[f"TF_VAR_{key}"] = value


def opentofu_env(provider: str, creds: dict[str, str]) -> dict[str, str]:
    env: dict[str, str] = {
        "TF_IN_AUTOMATION": "1",
    }
    if provider == "aws":
        env.update(
            {
                "AWS_ACCESS_KEY_ID": creds.get("aws_access_key_id", ""),
                "AWS_SECRET_ACCESS_KEY": creds.get("aws_secret_access_key", ""),
                "AWS_REGION": creds.get("aws_region", ""),
                "AWS_DEFAULT_REGION": creds.get("aws_region", ""),
            }
        )
        _inject_tf_var_env(env, creds)
        return env

    if provider == "gcloud":
        env.update(
            {
                "GOOGLE_PROJECT": creds.get("gcp_project_id", ""),
                "GOOGLE_REGION": creds.get("gcp_region", ""),
                "GOOGLE_CREDENTIALS": creds.get("gcp_credentials_json", ""),
            }
        )
        _inject_tf_var_env(env, creds)
        return env

    raise ValueError(f"Unsupported provider '{provider}'")


def collect_module_var_files(*, project_root: Path, module_dir: Path, module: str) -> list[Path]:
    candidates: list[Path] = []

    def _add_defaults(base: Path) -> None:
        for name in _VAR_FILE_NAMES:
            candidates.append(base / name)
        candidates.extend(sorted(base.glob("*.auto.tfvars")))
        candidates.extend(sorted(base.glob("*.auto.tfvars.json")))

    _add_defaults(project_root)
    for suffix in (".tfvars", ".tfvars.json", ".auto.tfvars", ".auto.tfvars.json"):
        candidates.append(project_root / f"{module}{suffix}")

    env_root = project_root / "environments"
    _add_defaults(env_root)
    for suffix in (".tfvars", ".tfvars.json", ".auto.tfvars", ".auto.tfvars.json"):
        candidates.append(env_root / f"{module}{suffix}")

    if env_root.exists():
        for env_dir in sorted(path for path in env_root.iterdir() if path.is_dir()):
            _add_defaults(env_dir)
            for suffix in (".tfvars", ".tfvars.json", ".auto.tfvars", ".auto.tfvars.json"):
                candidates.append(env_dir / f"{module}{suffix}")

    _add_defaults(module_dir)

    seen: set[Path] = set()
    result: list[Path] = []
    for path in candidates:
        if not path.is_file():
            continue
        resolved = path.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        result.append(resolved)
    return result


def parse_selector_json(content: str) -> dict[str, Any] | None:
    if not content:
        return None

    try:
        parsed = json.loads(content)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    start = content.find("{")
    end = content.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        parsed = json.loads(content[start : end + 1])
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


async def load_project(project_id: str) -> Project | None:
    async with db.get_session() as session:
        result = await session.execute(select(Project).where(Project.id == project_id))
        return result.scalar_one_or_none()


def discover_modules_from_project_dir(project_id: str) -> list[str]:
    root = project_files.ensure_project_dir(project_id)
    modules_root = root / "modules"
    if not modules_root.exists():
        return []
    modules: list[str] = []
    for candidate in modules_root.iterdir():
        if not candidate.is_dir():
            continue
        if any(candidate.rglob("*.tf")):
            modules.append(candidate.name)
    modules.sort()
    return modules


def merge_run_env(tf_env: dict[str, str]) -> dict[str, str]:
    env = {**os.environ, **tf_env}
    for key in _TOFU_ENV_BLOCKLIST:
        env.pop(key, None)
    return env
