from __future__ import annotations

from typing import Literal

ProjectJobKind = Literal["pipeline", "apply", "plan", "destroy", "ansible", "graph", "cost", "chat"]
ProjectJobStatus = Literal["queued", "running", "succeeded", "failed", "canceled"]

JOB_KINDS: tuple[ProjectJobKind, ...] = ("pipeline", "apply", "plan", "destroy", "ansible", "graph", "cost", "chat")
JOB_STATUSES: tuple[ProjectJobStatus, ...] = ("queued", "running", "succeeded", "failed", "canceled")
ACTIVE_JOB_STATUSES = {"queued", "running"}
FINAL_JOB_STATUSES = {"succeeded", "failed", "canceled"}
MUTATING_JOB_KINDS = {"apply", "destroy", "ansible", "pipeline"}
READONLY_JOB_KINDS = {"plan", "graph", "cost"}
