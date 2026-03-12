from __future__ import annotations

import logging
from typing import Any

from app import db
from app.core.config import Settings
from app.models import Project
from app.services.telegram import api as telegram_api
from app.services.telegram.common import TelegramApiError, TelegramProjectError
from app.services.telegram.projects import load_runtime_config

logger = logging.getLogger(__name__)


def _safe_text(value: Any) -> str:
    return str(value or "").strip()


def _status_word(status: str) -> str:
    return "succeeded" if status == "ok" else "failed"


def _project_header(project: Project) -> str:
    return f"[{project.name} | {project.id}]"


def _with_header(project: Project, text: str) -> str:
    header = _project_header(project)
    body = text.strip()
    return body if body.startswith(header) else f"{header}\n{body}"


def _top_modules(results: list[dict[str, Any]], limit: int = 5) -> str:
    labels: list[str] = []
    for row in results[:limit]:
        module = _safe_text(row.get("module")) or "unknown"
        status = _safe_text(row.get("status")) or "unknown"
        labels.append(f"{module}:{status}")
    return ", ".join(labels) if labels else "-"


def _severity_counts(summary: dict[str, Any]) -> str:
    by_severity = summary.get("bySeverity") if isinstance(summary, dict) else {}
    if not isinstance(by_severity, dict):
        return "-"
    order = ("critical", "high", "medium", "low", "unknown")
    return ", ".join(f"{key}:{int(by_severity.get(key, 0) or 0)}" for key in order)


def github_pull_request_text(project: Project, pr: dict[str, Any]) -> str:
    number = _safe_text(pr.get("number")) or "?"
    title = _safe_text(pr.get("title")) or "Untitled"
    repo = _safe_text(pr.get("repo_full_name")) or "-"
    url = _safe_text(pr.get("url")) or "-"
    return (
        f"{_project_header(project)} GitHub PR created\n"
        f"Repo: {repo}\n"
        f"PR #{number}: {title}\n"
        f"{url}"
    )


def opentofu_deploy_text(project: Project, event: dict[str, Any]) -> str:
    status = _safe_text(event.get("status")) or "failed"
    results = event.get("results") if isinstance(event.get("results"), list) else []
    return (
        f"{_project_header(project)} OpenTofu deploy {_status_word(status)}\n"
        f"Status: {status}\n"
        f"Modules: {_top_modules(results)}"
    )


def ansible_run_text(project: Project, event: dict[str, Any]) -> str:
    status = _safe_text(event.get("status")) or "failed"
    attempts = int(event.get("attempts", 1) or 1)
    results = event.get("results") if isinstance(event.get("results"), list) else []
    return (
        f"{_project_header(project)} Ansible run {_status_word(status)}\n"
        f"Status: {status} (attempts: {attempts})\n"
        f"Hosts: {_top_modules(results)}"
    )


def policy_check_text(project: Project, event: dict[str, Any]) -> str:
    summary = event.get("summary") if isinstance(event.get("summary"), dict) else {}
    scan_error = event.get("scanError")
    total = int(summary.get("total", 0) or 0)
    changed_paths = event.get("changedPaths") if isinstance(event.get("changedPaths"), list) else []
    if scan_error:
        message = _safe_text(scan_error.get("message")) if isinstance(scan_error, dict) else "Policy check failed"
        return f"{_project_header(project)} Policy check failed\nReason: {message}"
    return (
        f"{_project_header(project)} Policy check completed\n"
        f"Changed paths: {len(changed_paths)}\n"
        f"Total issues: {total}\n"
        f"Severity: {_severity_counts(summary)}"
    )


def _can_notify(project: Project) -> bool:
    if not project.telegram_connected_at:
        return False
    if project.telegram_chat_id and not project.telegram_topic_id:
        return False
    return bool(_safe_text(project.telegram_chat_id) and _safe_text(project.telegram_topic_id))


async def _send_text(project: Project, settings: Settings, text: str) -> bool:
    if not _can_notify(project):
        return False
    try:
        runtime = load_runtime_config(settings)
        await telegram_api.send_message(
            runtime.bot_token,
            str(project.telegram_chat_id),
            _with_header(project, text),
            message_thread_id=str(project.telegram_topic_id),
        )
        return True
    except (TelegramProjectError, TelegramApiError) as exc:
        logger.warning("telegram notify skipped for project %s: %s", project.id, str(exc))
        return False
    except Exception:
        logger.exception("telegram notify failed for project %s", project.id)
        return False


async def notify_project(project: Project, settings: Settings, text: str) -> bool:
    return await _send_text(project, settings, text)


async def _load_project(project_id: str) -> Project | None:
    async with db.get_session() as session:
        return await session.get(Project, project_id)


async def notify_by_project_id(project_id: str, settings: Settings, text: str) -> bool:
    project = await _load_project(project_id)
    if project is None:
        return False
    return await _send_text(project, settings, text)


async def notify_policy_check_by_project_id(project_id: str, settings: Settings, event: dict[str, Any]) -> bool:
    project = await _load_project(project_id)
    if project is None:
        return False
    return await _send_text(project, settings, policy_check_text(project, event))
