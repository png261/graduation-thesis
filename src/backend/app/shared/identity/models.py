from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class IdentitySharedBase(DeclarativeBase):
    pass


class User(IdentitySharedBase):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    projects: Mapped[list["Project"]] = relationship("Project", back_populates="user")


class Project(IdentitySharedBase):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    provider: Mapped[str | None] = mapped_column(String, nullable=True)
    credentials: Mapped[str | None] = mapped_column(Text, nullable=True)
    github_repo_full_name: Mapped[str | None] = mapped_column(String, nullable=True)
    github_repository_id: Mapped[str | None] = mapped_column(String, nullable=True)
    github_repository_owner: Mapped[str | None] = mapped_column(String, nullable=True)
    github_base_branch: Mapped[str | None] = mapped_column(String, nullable=True)
    github_working_branch: Mapped[str | None] = mapped_column(String, nullable=True)
    github_installation_id: Mapped[str | None] = mapped_column(String, nullable=True)
    github_installation_account_id: Mapped[str | None] = mapped_column(String, nullable=True)
    github_installation_account_login: Mapped[str | None] = mapped_column(String, nullable=True)
    github_installation_target_type: Mapped[str | None] = mapped_column(String, nullable=True)
    github_permissions_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    github_connected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    user: Mapped[User | None] = relationship("User", back_populates="projects")


__all__ = ["Project", "User"]
