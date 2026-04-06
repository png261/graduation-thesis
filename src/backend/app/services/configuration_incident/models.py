"""Configuration/incident service ORM models."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, Index, String, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class ConfigurationIncidentBase(DeclarativeBase):
    pass


class IncidentSummary(ConfigurationIncidentBase):
    __tablename__ = "incident_summaries"
    __table_args__ = (
        Index("ix_incident_summaries_project_created_at", "project_id", "created_at"),
        Index("ix_incident_summaries_project_incident_key", "project_id", "incident_key"),
        Index("ix_incident_summaries_project_resolution_quality", "project_id", "resolution_quality"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    project_id: Mapped[str] = mapped_column(String, nullable=False)
    backend_id: Mapped[str | None] = mapped_column(String, nullable=True)
    incident_key: Mapped[str] = mapped_column(String, nullable=False)
    correlation_id: Mapped[str | None] = mapped_column(String, nullable=True)
    severity: Mapped[str] = mapped_column(String, nullable=False, default="medium")
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    recommended_action: Mapped[str | None] = mapped_column(String, nullable=True)
    action_class: Mapped[str] = mapped_column(String, nullable=False, default="safe")
    approval_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="open")
    resolution_quality: Mapped[str | None] = mapped_column(String, nullable=True)
    summary_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


__all__ = ["IncidentSummary"]
