from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Index, String, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class BlueprintBase(DeclarativeBase):
    pass


class ProjectBlueprintRun(BlueprintBase):
    __tablename__ = "project_blueprint_runs"
    __table_args__ = (
        Index("ix_project_blueprint_runs_project_created_at", "project_id", "created_at"),
        Index("ix_project_blueprint_runs_project_thread_created_at", "project_id", "thread_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    project_id: Mapped[str] = mapped_column(String, nullable=False)
    thread_id: Mapped[str] = mapped_column(String, nullable=False)
    kind: Mapped[str] = mapped_column(String, nullable=False)
    blueprint_id: Mapped[str] = mapped_column(String, nullable=False)
    blueprint_version: Mapped[str] = mapped_column(String, nullable=False)
    blueprint_name: Mapped[str] = mapped_column(String, nullable=False)
    inputs_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    snapshot_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )


class ProjectTerraformGeneration(BlueprintBase):
    __tablename__ = "project_terraform_generations"
    __table_args__ = (Index("ix_project_terraform_generations_project_created_at", "project_id", "created_at"),)

    id: Mapped[str] = mapped_column(String, primary_key=True)
    project_id: Mapped[str] = mapped_column(String, nullable=False)
    blueprint_run_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("project_blueprint_runs.id", ondelete="CASCADE"),
        nullable=False,
    )
    stack_path: Mapped[str] = mapped_column(String, nullable=False)
    generated_paths_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    module_names_json: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    summary_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    provenance_report_path: Mapped[str] = mapped_column(String, nullable=False)
    replaces_generation_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("project_terraform_generations.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    blueprint_run = relationship("ProjectBlueprintRun")


class ProjectAnsibleGeneration(BlueprintBase):
    __tablename__ = "project_ansible_generations"
    __table_args__ = (Index("ix_project_ansible_generations_project_created_at", "project_id", "created_at"),)

    id: Mapped[str] = mapped_column(String, primary_key=True)
    project_id: Mapped[str] = mapped_column(String, nullable=False)
    blueprint_run_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("project_blueprint_runs.id", ondelete="CASCADE"),
        nullable=False,
    )
    playbook_path: Mapped[str] = mapped_column(String, nullable=False)
    target_modules_json: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    skipped_modules_json: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    generated_paths_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    summary_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    provenance_report_path: Mapped[str] = mapped_column(String, nullable=False)
    replaces_generation_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("project_ansible_generations.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    blueprint_run = relationship("ProjectBlueprintRun")


__all__ = [
    "ProjectAnsibleGeneration",
    "ProjectBlueprintRun",
    "ProjectTerraformGeneration",
]
