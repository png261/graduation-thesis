"""SQLAlchemy ORM models for users, projects, jobs, and state backends."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, Integer, String, Text, func, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class User(Base):
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

    projects: Mapped[list[Project]] = relationship("Project", back_populates="user")
    jobs: Mapped[list[ProjectJob]] = relationship("ProjectJob", back_populates="user")
    credential_profiles: Mapped[list[CredentialProfile]] = relationship(
        "CredentialProfile",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    gitlab_oauth_tokens: Mapped[list[GitLabOAuthToken]] = relationship(
        "GitLabOAuthToken",
        back_populates="user",
        cascade="all, delete-orphan",
    )


class Project(Base):
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
    github_base_branch: Mapped[str | None] = mapped_column(String, nullable=True)
    github_working_branch: Mapped[str | None] = mapped_column(String, nullable=True)
    github_connected_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    telegram_chat_id: Mapped[str | None] = mapped_column(String, nullable=True)
    telegram_topic_id: Mapped[str | None] = mapped_column(String, nullable=True)
    telegram_topic_title: Mapped[str | None] = mapped_column(String, nullable=True)
    telegram_connected_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    telegram_pending_code_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    telegram_pending_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    threads: Mapped[list[Thread]] = relationship(
        "Thread",
        back_populates="project",
        cascade="all, delete-orphan",
    )
    user: Mapped[User | None] = relationship("User", back_populates="projects")
    jobs: Mapped[list[ProjectJob]] = relationship(
        "ProjectJob",
        back_populates="project",
        cascade="all, delete-orphan",
    )
    state_backends: Mapped[list[StateBackend]] = relationship(
        "StateBackend",
        back_populates="project",
        cascade="all, delete-orphan",
    )


class Thread(Base):
    __tablename__ = "threads"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    project_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    project: Mapped[Project] = relationship("Project", back_populates="threads")


class ProjectJob(Base):
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
                "kind IN ('apply','ansible','pipeline') AND status IN ('queued','running')"
            ),
        ),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    project_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
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
        server_default=func.now(),
        nullable=False,
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancel_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    project: Mapped[Project] = relationship("Project", back_populates="jobs")
    user: Mapped[User] = relationship("User", back_populates="jobs")


class CredentialProfile(Base):
    __tablename__ = "credential_profiles"
    __table_args__ = (
        Index("ix_credential_profiles_user_provider", "user_id", "provider"),
        Index("ux_credential_profiles_user_name", "user_id", "name", unique=True),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    provider: Mapped[str] = mapped_column(String, nullable=False)
    credentials_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    meta_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
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

    user: Mapped[User] = relationship("User", back_populates="credential_profiles")
    state_backends: Mapped[list[StateBackend]] = relationship(
        "StateBackend",
        back_populates="credential_profile",
    )


class StateBackend(Base):
    __tablename__ = "state_backends"
    __table_args__ = (
        Index("ix_state_backends_project_provider", "project_id", "provider"),
        Index("ix_state_backends_project_status", "project_id", "status"),
        Index("ix_state_backends_project_name", "project_id", "name", unique=True),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    project_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    credential_profile_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("credential_profiles.id", ondelete="SET NULL"),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    source_type: Mapped[str] = mapped_column(String, nullable=False)
    provider: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="connected")
    bucket_name: Mapped[str | None] = mapped_column(String, nullable=True)
    object_key: Mapped[str | None] = mapped_column(String, nullable=True)
    object_prefix: Mapped[str | None] = mapped_column(String, nullable=True)
    repository: Mapped[str | None] = mapped_column(String, nullable=True)
    branch: Mapped[str | None] = mapped_column(String, nullable=True)
    path: Mapped[str | None] = mapped_column(String, nullable=True)
    schedule_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    retention_days: Mapped[int] = mapped_column(Integer, nullable=False, default=90)
    versioning_enabled: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    warning: Mapped[str | None] = mapped_column(Text, nullable=True)
    settings_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
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

    project: Mapped[Project] = relationship("Project", back_populates="state_backends")
    credential_profile: Mapped[CredentialProfile | None] = relationship(
        "CredentialProfile",
        back_populates="state_backends",
    )
    snapshots: Mapped[list[StateSnapshot]] = relationship(
        "StateSnapshot",
        back_populates="backend",
        cascade="all, delete-orphan",
    )
    resources: Mapped[list[StateResource]] = relationship(
        "StateResource",
        back_populates="backend",
        cascade="all, delete-orphan",
    )
    drift_alerts: Mapped[list[DriftAlert]] = relationship(
        "DriftAlert",
        back_populates="backend",
        cascade="all, delete-orphan",
    )
    policy_alerts: Mapped[list[PolicyAlert]] = relationship(
        "PolicyAlert",
        back_populates="backend",
        cascade="all, delete-orphan",
    )
    sync_runs: Mapped[list[StateSyncRun]] = relationship(
        "StateSyncRun",
        back_populates="backend",
        cascade="all, delete-orphan",
    )


class StateSnapshot(Base):
    __tablename__ = "state_snapshots"
    __table_args__ = (
        Index("ix_state_snapshots_backend_created_at", "backend_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    backend_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("state_backends.id", ondelete="CASCADE"),
        nullable=False,
    )
    source_version: Mapped[str | None] = mapped_column(String, nullable=True)
    source_generation: Mapped[str | None] = mapped_column(String, nullable=True)
    source_etag: Mapped[str | None] = mapped_column(String, nullable=True)
    source_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resource_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    summary_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    state_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    backend: Mapped[StateBackend] = relationship("StateBackend", back_populates="snapshots")
    resources: Mapped[list[StateResource]] = relationship(
        "StateResource",
        back_populates="snapshot",
        cascade="all, delete-orphan",
    )


class StateResource(Base):
    __tablename__ = "state_resources"
    __table_args__ = (
        Index("ix_state_resources_backend_status", "backend_id", "status"),
        Index("ix_state_resources_backend_address", "backend_id", "address", unique=True),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    backend_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("state_backends.id", ondelete="CASCADE"),
        nullable=False,
    )
    snapshot_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("state_snapshots.id", ondelete="CASCADE"),
        nullable=False,
    )
    address: Mapped[str] = mapped_column(String, nullable=False)
    resource_type: Mapped[str] = mapped_column(String, nullable=False)
    resource_name: Mapped[str] = mapped_column(String, nullable=False)
    provider: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="active")
    cloud_id: Mapped[str | None] = mapped_column(String, nullable=True)
    console_url: Mapped[str | None] = mapped_column(String, nullable=True)
    attributes_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    sensitive_fields_json: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    last_updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    backend: Mapped[StateBackend] = relationship("StateBackend", back_populates="resources")
    snapshot: Mapped[StateSnapshot] = relationship("StateSnapshot", back_populates="resources")


class DriftAlert(Base):
    __tablename__ = "drift_alerts"
    __table_args__ = (
        Index("ix_drift_alerts_backend_status", "backend_id", "status"),
        Index("ix_drift_alerts_backend_resource", "backend_id", "resource_address", unique=True),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    backend_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("state_backends.id", ondelete="CASCADE"),
        nullable=False,
    )
    resource_address: Mapped[str] = mapped_column(String, nullable=False)
    severity: Mapped[str] = mapped_column(String, nullable=False, default="medium")
    status: Mapped[str] = mapped_column(String, nullable=False, default="active")
    details_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    remediation_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    first_detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    last_detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    backend: Mapped[StateBackend] = relationship("StateBackend", back_populates="drift_alerts")


class PolicyAlert(Base):
    __tablename__ = "policy_alerts"
    __table_args__ = (
        Index("ix_policy_alerts_backend_status", "backend_id", "status"),
        Index("ix_policy_alerts_backend_rule_resource", "backend_id", "rule_id", "resource_address", unique=True),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    backend_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("state_backends.id", ondelete="CASCADE"),
        nullable=False,
    )
    rule_id: Mapped[str] = mapped_column(String, nullable=False)
    resource_address: Mapped[str] = mapped_column(String, nullable=False)
    severity: Mapped[str] = mapped_column(String, nullable=False, default="medium")
    status: Mapped[str] = mapped_column(String, nullable=False, default="active")
    details_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    first_detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    last_detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    backend: Mapped[StateBackend] = relationship("StateBackend", back_populates="policy_alerts")


class StateSyncRun(Base):
    __tablename__ = "state_sync_runs"
    __table_args__ = (
        Index("ix_state_sync_runs_backend_created_at", "backend_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    backend_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("state_backends.id", ondelete="CASCADE"),
        nullable=False,
    )
    triggered_by: Mapped[str] = mapped_column(String, nullable=False, default="manual")
    status: Mapped[str] = mapped_column(String, nullable=False, default="queued")
    summary_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    backend: Mapped[StateBackend] = relationship("StateBackend", back_populates="sync_runs")


class GitLabOAuthToken(Base):
    __tablename__ = "gitlab_oauth_tokens"
    __table_args__ = (
        Index("ux_gitlab_oauth_tokens_user", "user_id", unique=True),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    access_token_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    refresh_token_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    scope: Mapped[str | None] = mapped_column(String, nullable=True)
    provider_user_id: Mapped[str | None] = mapped_column(String, nullable=True)
    username: Mapped[str | None] = mapped_column(String, nullable=True)
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

    user: Mapped[User] = relationship("User", back_populates="gitlab_oauth_tokens")
