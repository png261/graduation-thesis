"""Shared HTTP error helpers."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException


def error_detail(code: str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"code": code, "message": message}
    if details is not None:
        payload["details"] = details
    return payload


def raise_http_error(
    status_code: int,
    *,
    code: str,
    message: str,
    details: dict[str, Any] | None = None,
) -> None:
    raise HTTPException(status_code=status_code, detail=error_detail(code, message, details))
