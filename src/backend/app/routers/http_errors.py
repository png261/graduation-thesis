"""Shared HTTP error helpers for router dependencies."""
from __future__ import annotations

from fastapi import HTTPException


def error_detail(code: str, message: str) -> dict[str, str]:
    return {"code": code, "message": message}


def raise_http_error(status_code: int, *, code: str, message: str) -> None:
    raise HTTPException(status_code=status_code, detail=error_detail(code, message))
