from __future__ import annotations

TELEGRAM_API_URL = "https://api.telegram.org"


class TelegramError(Exception):
    pass


class TelegramApiError(TelegramError):
    pass


class TelegramProjectError(TelegramError):
    def __init__(self, message: str, *, status_code: int = 400, code: str = "telegram_error") -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code
