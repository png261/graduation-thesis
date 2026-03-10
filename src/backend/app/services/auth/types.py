from __future__ import annotations

from dataclasses import dataclass

from app.models import User, UserSession


class AuthError(Exception):
    pass


@dataclass(slots=True)
class AuthSessionContext:
    session_id: str | None
    session: UserSession | None
    user: User | None
