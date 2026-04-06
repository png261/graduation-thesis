"""Workflow service ORM models."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Index, String, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class WorkflowBase(DeclarativeBase):
    pass


class ProjectJob(WorkflowBase):
    __tablename__ = "project_jobs"
    __table_args__ = (
        Index("ix_project_jobs_project_created_at", "project_id", "created_at"),
        Index("ix_project_jobs_project_status_created_at", "project_id", "status", "created_at"),
        Index("ix_project_jobs_created_at", "created_at"),
        Index(
            "uq_project_jobs_active_mutating_per_project",
            "project_id",
            unique=True,
            postgresql_where=text(
                "kind IN ('apply','destroy','ansible','pipeline') AND status IN ('queued','running')"
            ),
        ),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    project_id: Mapped[str] = mapped_column(String, nullable=False)
    user_id: Mapped[str] = mapped_column(String, nullable=False)
    kind: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="queued")
    params_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    result_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    event_tail_json: Mapped[list[dict]] = mapped_column(JSON, nullable=False, default=list)
    celery_task_id: Mapped[str | None] = mapped_column(String, nullable=True)
    rerun_of_job_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("project_jobs.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=text("CURRENT_TIMESTAMP"),
        nullable=False,
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancel_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


__all__ = ["ProjectJob"]
