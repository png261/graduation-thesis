"""OpenTofu module selector logic."""
from __future__ import annotations

import json
from typing import Any

from fastapi.concurrency import run_in_threadpool

from app.core.config import Settings
from app.services.model.factory import create_chat_model

from .shared import parse_selector_json


def _fallback_selection(modules: list[str], reason: str) -> dict[str, Any]:
    return {
        "selected_modules": modules,
        "reason": reason,
        "selector": "fallback",
    }


def _selector_prompt(
    *,
    project_id: str,
    provider: str | None,
    modules: list[str],
    intent: str | None,
) -> str:
    return (
        "You are an OpenTofu deploy selector. Choose which module folders should be applied.\n"
        "Return strict JSON only with keys:\n"
        "selected_modules: array of module names ordered for apply\n"
        "reason: short text\n\n"
        f"project_id: {project_id}\n"
        f"provider: {provider or 'unknown'}\n"
        f"discovered_modules: {json.dumps(modules)}\n"
        f"user_intent: {intent or ''}\n"
        "Rules:\n"
        "- selected_modules must be subset of discovered_modules\n"
        "- If unsure, choose all discovered modules in their current order\n"
        "- Output JSON only, no markdown."
    )


def _message_text(message: Any) -> str:
    content = getattr(message, "content", "")
    if isinstance(content, list):
        return "".join(str(part.get("text", "")) for part in content if isinstance(part, dict))
    return str(content)


def _selection_from_parsed(parsed: dict[str, Any] | None, modules: list[str]) -> dict[str, Any]:
    if parsed is None:
        return _fallback_selection(modules, "Selector output could not be parsed, using all modules.")
    raw_selected = parsed.get("selected_modules", [])
    selected = [module for module in raw_selected if isinstance(module, str) and module in modules]
    return {
        "selected_modules": selected or modules,
        "reason": str(parsed.get("reason", "")).strip() or "Selected modules based on project context.",
        "selector": "llm",
    }


async def select_modules_for_deploy(
    *,
    project_id: str,
    settings: Settings,
    provider: str | None,
    modules: list[str],
    intent: str | None,
) -> dict[str, Any]:
    """Return selected module order and rationale."""
    if not modules:
        return _fallback_selection([], "No OpenTofu modules found under /modules.")

    if not settings.llm_api_key or not settings.llm_model:
        return _fallback_selection(modules, "Selector model unavailable, falling back to all discovered modules.")

    model = create_chat_model(settings)
    prompt = _selector_prompt(project_id=project_id, provider=provider, modules=modules, intent=intent)
    message = await run_in_threadpool(model.invoke, prompt)
    parsed = parse_selector_json(_message_text(message))
    return _selection_from_parsed(parsed, modules)
