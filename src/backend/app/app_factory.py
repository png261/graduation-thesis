from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from http import HTTPStatus
from typing import Any, Sequence

from fastapi import APIRouter, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core import cache as runtime_cache
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.persistence.runtime import ServiceDatabaseRuntime

settings = get_settings()
configure_logging(settings.log_level)
logger = logging.getLogger(__name__)

_STATUS_ERROR_CODES: dict[int, str] = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    413: "payload_too_large",
    415: "unsupported_media_type",
    422: "validation_error",
    429: "too_many_requests",
    500: "internal_error",
    503: "service_unavailable",
}


def _default_error_code(status_code: int) -> str:
    if status_code in _STATUS_ERROR_CODES:
        return _STATUS_ERROR_CODES[status_code]
    if status_code >= 500:
        return "server_error"
    if status_code >= 400:
        return "request_error"
    return "error"


def _default_error_message(status_code: int) -> str:
    try:
        return HTTPStatus(status_code).phrase
    except ValueError:
        return "Request failed"


def _extract_http_error_payload(exc: StarletteHTTPException) -> tuple[str, str, dict[str, Any] | None]:
    default_code = _default_error_code(exc.status_code)
    default_message = _default_error_message(exc.status_code)
    detail = exc.detail
    if isinstance(detail, dict):
        raw_code = detail.get("code")
        raw_message = detail.get("message")
        code = str(raw_code).strip() if raw_code is not None else default_code
        message = str(raw_message).strip() if raw_message is not None else default_message
        raw_details = detail.get("details")
        if isinstance(raw_details, dict):
            details = raw_details
        else:
            extras = {k: v for k, v in detail.items() if k not in {"code", "message", "details"}}
            details = extras or None
        return code or default_code, message or default_message, details
    if isinstance(detail, str):
        message = detail.strip() or default_message
        return default_code, message, None
    if detail is None:
        return default_code, default_message, None
    return default_code, str(detail), None


def _error_response(
    *,
    status_code: int,
    code: str,
    message: str,
    details: dict[str, Any] | None = None,
) -> JSONResponse:
    payload: dict[str, Any] = {"code": code, "message": message}
    if details:
        payload["details"] = details
    return JSONResponse(status_code=status_code, content=payload)


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def handle_http_exception(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code, message, details = _extract_http_error_payload(exc)
        return _error_response(status_code=exc.status_code, code=code, message=message, details=details)

    @app.exception_handler(RequestValidationError)
    async def handle_request_validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
        return _error_response(
            status_code=422,
            code="validation_error",
            message="Validation failed",
            details={"errors": exc.errors()},
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_exception(_request: Request, exc: Exception) -> JSONResponse:
        logger.exception("unhandled server error", exc_info=exc)
        return _error_response(status_code=500, code="internal_error", message="Internal server error")


def create_service_app(
    *,
    title: str,
    router: APIRouter,
    database_url: str,
    service_runtimes: Sequence[ServiceDatabaseRuntime] = (),
    enable_cors: bool = False,
) -> FastAPI:
    @asynccontextmanager
    async def service_lifespan(_app: FastAPI):
        for runtime in service_runtimes:
            await runtime.init(database_url=database_url)
        logger.info("Database initialised")
        yield
        for runtime in reversed(service_runtimes):
            await runtime.close()
        await runtime_cache.close_redis()
        logger.info("Database closed")

    app = FastAPI(title=title, version="0.1.0", lifespan=service_lifespan)
    app.include_router(router)

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    if enable_cors:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins_list(),
            allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?$",
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    register_exception_handlers(app)
    return app
