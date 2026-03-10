from __future__ import annotations

from typing import Any

from langchain_core.messages import BaseMessage

_CONTEXT_WINDOW_FALLBACKS: dict[str, int] = {
    "gemini-2.5-flash": 1_048_576,
    "gemini-2.5-pro": 1_048_576,
    "gemini-2.0-flash": 1_048_576,
    "gpt-4o": 128_000,
    "gpt-4o-mini": 128_000,
    "claude-3-5-sonnet-latest": 200_000,
    "claude-3-7-sonnet-latest": 200_000,
    "claude-sonnet-4-5-20250929": 200_000,
}


def to_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            return int(stripped)
        except ValueError:
            return None
    return None


def extract_usage_pair(payload: object) -> tuple[int | None, int | None]:
    if not isinstance(payload, dict):
        return (None, None)

    prompt_keys = (
        "input_tokens",
        "prompt_tokens",
        "inputTokenCount",
        "promptTokenCount",
    )
    completion_keys = (
        "output_tokens",
        "completion_tokens",
        "outputTokenCount",
        "candidates_token_count",
        "completionTokenCount",
        "candidatesTokenCount",
    )

    def first_int_value(keys: tuple[str, ...]) -> int | None:
        for key in keys:
            parsed = to_int(payload.get(key))
            if parsed is not None:
                return parsed
        return None

    prompt_tokens = first_int_value(prompt_keys)
    completion_tokens = first_int_value(completion_keys)

    if prompt_tokens is None and completion_tokens is None:
        return (None, None)
    return (prompt_tokens or 0, completion_tokens or 0)


def extract_usage_from_message(message: BaseMessage) -> tuple[int, int] | None:
    usage_metadata = getattr(message, "usage_metadata", None)
    prompt_tokens, completion_tokens = extract_usage_pair(usage_metadata)
    if prompt_tokens is not None or completion_tokens is not None:
        return (prompt_tokens or 0, completion_tokens or 0)

    response_metadata = getattr(message, "response_metadata", None)
    if isinstance(response_metadata, dict):
        for key in ("token_usage", "usage", "usage_metadata"):
            prompt_tokens, completion_tokens = extract_usage_pair(response_metadata.get(key))
            if prompt_tokens is not None or completion_tokens is not None:
                return (prompt_tokens or 0, completion_tokens or 0)

        prompt_tokens, completion_tokens = extract_usage_pair(response_metadata)
        if prompt_tokens is not None or completion_tokens is not None:
            return (prompt_tokens or 0, completion_tokens or 0)

    additional_kwargs = getattr(message, "additional_kwargs", None)
    if isinstance(additional_kwargs, dict):
        for key in ("usage_metadata", "token_usage", "usage"):
            prompt_tokens, completion_tokens = extract_usage_pair(additional_kwargs.get(key))
            if prompt_tokens is not None or completion_tokens is not None:
                return (prompt_tokens or 0, completion_tokens or 0)

    return None


def normalize_model_id(raw_model_id: str | None) -> str | None:
    if not raw_model_id:
        return None
    model_id = raw_model_id.strip().strip('"').strip("'")
    if not model_id:
        return None
    if ":" in model_id:
        _, _, candidate = model_id.partition(":")
        if candidate.strip():
            model_id = candidate.strip()

    if model_id.startswith("models/"):
        model_id = model_id.removeprefix("models/").strip()

    return model_id or None


def max_input_tokens_from_profile(profile: object) -> int | None:
    if profile is None:
        return None

    if isinstance(profile, dict):
        for key in ("max_input_tokens", "context_window", "max_context_tokens"):
            value = to_int(profile.get(key))
            if value is not None:
                return value
        return None

    for key in ("max_input_tokens", "context_window", "max_context_tokens"):
        value = to_int(getattr(profile, key, None))
        if value is not None:
            return value
    return None


def context_window_fallback(model_id: str | None) -> int | None:
    if not model_id:
        return None
    return _CONTEXT_WINDOW_FALLBACKS.get(model_id.lower())


def text_from_content(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(str(item.get("text", "")))
        return "".join(parts)
    return ""
