"""OpenTofu module selector logic."""
from __future__ import annotations

import json
from typing import Any

from fastapi.concurrency import run_in_threadpool

from app.core.config import Settings
from app.services.model.factory import create_chat_model

from .shared import parse_selector_json


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
        return {
            "selected_modules": [],
            "reason": "No OpenTofu modules found under /modules.",
            "selector": "fallback",
        }

    if not settings.google_api_key:
        return {
            "selected_modules": modules,
            "reason": "Selector model unavailable, falling back to all discovered modules.",
            "selector": "fallback",
        }

    model = create_chat_model(settings)
    prompt = (
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

    message = await run_in_threadpool(model.invoke, prompt)
    content = getattr(message, "content", "")
    if isinstance(content, list):
        text = "".join(str(part.get("text", "")) for part in content if isinstance(part, dict))
    else:
        text = str(content)
    parsed = parse_selector_json(text)
    if parsed is None:
        return {
            "selected_modules": modules,
            "reason": "Selector output could not be parsed, using all modules.",
            "selector": "fallback",
        }

    raw_selected = parsed.get("selected_modules", [])
    selected = [module for module in raw_selected if isinstance(module, str) and module in modules]
    if not selected:
        selected = modules
    return {
        "selected_modules": selected,
        "reason": str(parsed.get("reason", "")).strip() or "Selected modules based on project context.",
        "selector": "llm",
    }
