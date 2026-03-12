from __future__ import annotations

from typing import Any

import httpx

from .common import TELEGRAM_API_URL, TelegramApiError


def _api_url(bot_token: str, method: str) -> str:
    return f"{TELEGRAM_API_URL}/bot{bot_token}/{method}"


def _error_message(payload: Any, status_code: int) -> str:
    if isinstance(payload, dict):
        error_code = payload.get("error_code")
        description = str(payload.get("description", "")).strip()
        if error_code and description:
            return f"Telegram API error ({error_code}): {description}"
        if description:
            return f"Telegram API error: {description}"
    return f"Telegram API request failed ({status_code})"


def _response_payload(response: httpx.Response) -> Any:
    try:
        return response.json()
    except Exception:
        return None


async def _post(bot_token: str, method: str, payload: dict[str, Any]) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=25) as client:
        response = await client.post(_api_url(bot_token, method), json=payload)
    data = _response_payload(response)
    if response.status_code >= 400:
        raise TelegramApiError(_error_message(data, response.status_code))
    if not isinstance(data, dict):
        raise TelegramApiError("Invalid Telegram response")
    if not bool(data.get("ok")):
        raise TelegramApiError(_error_message(data, response.status_code))
    result = data.get("result")
    return result if isinstance(result, dict) else {}


async def set_webhook(bot_token: str, webhook_url: str, webhook_secret: str) -> dict[str, Any]:
    return await _post(
        bot_token,
        "setWebhook",
        {
            "url": webhook_url,
            "secret_token": webhook_secret,
            "drop_pending_updates": False,
        },
    )


async def get_me(bot_token: str) -> dict[str, Any]:
    return await _post(bot_token, "getMe", {})


async def get_chat(bot_token: str, chat_id: str) -> dict[str, Any]:
    return await _post(
        bot_token,
        "getChat",
        {
            "chat_id": chat_id,
        },
    )


async def create_forum_topic(bot_token: str, chat_id: str, name: str) -> dict[str, Any]:
    return await _post(
        bot_token,
        "createForumTopic",
        {
            "chat_id": chat_id,
            "name": name,
        },
    )


async def send_message(
    bot_token: str,
    chat_id: str,
    text: str,
    *,
    message_thread_id: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "text": text,
    }
    if message_thread_id:
        payload["message_thread_id"] = int(message_thread_id)
    return await _post(bot_token, "sendMessage", payload)
