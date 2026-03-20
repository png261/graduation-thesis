from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, TypedDict
from uuid import uuid4

from sqlalchemy import select

from app import db
from app.core.config import Settings, get_settings
from app.models import DriftAlert, IncidentSummary, PolicyAlert, ProjectJob, StateBackend
from app.services.jobs import redis_bus

ACTION_SAFE = "safe"
ACTION_APPROVAL_REQUIRED = "approval_required"
ACTION_BLOCKED = "blocked"

_SEVERITY_RANK = {"low": 1, "medium": 2, "high": 3, "critical": 4}


class IncidentDecision(TypedDict):
    incident_key: str
    severity: str
    confidence: float
    evidence: list[dict[str, Any]]
    recommended_action: str
    approval_required: bool
    action_class: str
    analysis_only: bool


class IncidentMetrics(TypedDict):
    false_positive_ratio: float
    low_confidence_rate: float
    approval_execution_rate: float
    action_rollback_rate: float
    total_incidents: int


@dataclass(frozen=True)
class IncidentCase:
    project_id: str
    backend_id: str
    provider: str
    incident_key: str
    drift_count: int
    policy_count: int
    max_severity: str
    rule_ids: tuple[str, ...]
    resources: tuple[str, ...]
    failed_jobs: int


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def classify_action_class(action: str) -> str:
    lower = (action or "").strip().lower()
    if not lower:
        return ACTION_SAFE
    blocked = ("delete", "destroy", "drop", "terminate")
    approvals = ("apply", "restart", "reboot", "remediate")
    if any(word in lower for word in blocked):
        return ACTION_BLOCKED
    if any(word in lower for word in approvals):
        return ACTION_APPROVAL_REQUIRED
    return ACTION_SAFE


def validate_incident_decision(decision: dict[str, Any]) -> IncidentDecision:
    required = ("severity", "confidence", "evidence", "recommended_action", "approval_required", "action_class")
    for key in required:
        if key not in decision:
            raise ValueError(f"incident_decision_missing_{key}")
    evidence = decision["evidence"]
    if not isinstance(evidence, list) or len(evidence) < 1:
        raise ValueError("incident_decision_missing_evidence")
    confidence = float(decision["confidence"])
    if confidence < 0 or confidence > 1:
        raise ValueError("incident_decision_confidence_out_of_range")
    action_class = str(decision["action_class"])
    if action_class not in {ACTION_SAFE, ACTION_APPROVAL_REQUIRED, ACTION_BLOCKED}:
        raise ValueError("incident_decision_invalid_action_class")
    severity = str(decision["severity"]).strip().lower() or "medium"
    return {
        "incident_key": str(decision.get("incident_key") or ""),
        "severity": severity,
        "confidence": confidence,
        "evidence": evidence,
        "recommended_action": str(decision["recommended_action"]),
        "approval_required": bool(decision["approval_required"]),
        "action_class": action_class,
        "analysis_only": bool(decision.get("analysis_only", False)),
    }


def _norm_severity(raw: str) -> str:
    value = (raw or "").strip().lower()
    return value if value in _SEVERITY_RANK else "medium"


def _max_severity(*values: str) -> str:
    selected = "low"
    for value in values:
        current = _norm_severity(value)
        if _SEVERITY_RANK[current] > _SEVERITY_RANK[selected]:
            selected = current
    return selected


def _alert_severity(raw: object) -> str:
    return _norm_severity(str(raw or "medium"))


def _severity_from_alerts(drift_alerts: list[DriftAlert], policy_alerts: list[PolicyAlert]) -> str:
    value = "low"
    for row in [*drift_alerts, *policy_alerts]:
        value = _max_severity(value, _alert_severity(row.severity))
    return value


def _score_confidence(case: IncidentCase, memory_hits: int) -> float:
    score = 0.35
    if case.drift_count > 0:
        score += min(0.2, case.drift_count * 0.03)
    if case.policy_count > 0:
        score += min(0.2, case.policy_count * 0.03)
    if case.failed_jobs > 0:
        score += min(0.15, case.failed_jobs * 0.05)
    if memory_hits > 0:
        score += min(0.2, memory_hits * 0.08)
    return max(0.0, min(1.0, round(score, 3)))


def _build_recommended_action(case: IncidentCase, *, confidence: float, threshold: float) -> tuple[str, bool, bool]:
    if confidence < threshold:
        return ("analysis_only", False, True)
    severe = _SEVERITY_RANK[case.max_severity] >= _SEVERITY_RANK["high"]
    if severe and case.drift_count > 0:
        return ("apply_remediation_plan", True, False)
    if severe and case.policy_count > 0:
        return ("run_policy_fix_after_review", True, False)
    return ("monitor_and_review", False, False)


def _incident_key(backend: StateBackend, drift_alerts: list[DriftAlert], policy_alerts: list[PolicyAlert]) -> str:
    top_rules = sorted({row.rule_id for row in policy_alerts[:5] if row.rule_id})
    top_resources = sorted({row.resource_address for row in [*drift_alerts[:5], *policy_alerts[:5]] if row.resource_address})
    rule_part = ",".join(top_rules) or "-"
    resource_part = ",".join(top_resources) or "-"
    return f"{backend.id}:{rule_part}:{resource_part}"


def build_incident_case(
    *,
    backend: StateBackend,
    drift_alerts: list[DriftAlert],
    policy_alerts: list[PolicyAlert],
    recent_jobs: list[dict[str, Any]],
) -> IncidentCase:
    failed_jobs = len([row for row in recent_jobs if str(row.get("status") or "").lower() == "failed"])
    return IncidentCase(
        project_id=backend.project_id,
        backend_id=backend.id,
        provider=str(backend.provider or ""),
        incident_key=_incident_key(backend, drift_alerts, policy_alerts),
        drift_count=len(drift_alerts),
        policy_count=len(policy_alerts),
        max_severity=_severity_from_alerts(drift_alerts, policy_alerts),
        rule_ids=tuple(sorted({row.rule_id for row in policy_alerts if row.rule_id})),
        resources=tuple(sorted({row.resource_address for row in [*drift_alerts, *policy_alerts] if row.resource_address})),
        failed_jobs=failed_jobs,
    )


def _memory_score(summary: IncidentSummary, case: IncidentCase) -> int:
    score = 0
    if summary.backend_id and summary.backend_id == case.backend_id:
        score += 3
    payload = summary.summary_json if isinstance(summary.summary_json, dict) else {}
    rule_ids = payload.get("rule_ids") if isinstance(payload.get("rule_ids"), list) else []
    resources = payload.get("resources") if isinstance(payload.get("resources"), list) else []
    score += len(set([str(item) for item in rule_ids]) & set(case.rule_ids))
    score += len(set([str(item) for item in resources]) & set(case.resources))
    return score


async def list_relevant_memories(
    *,
    project_id: str,
    case: IncidentCase,
    settings: Settings | None = None,
) -> list[dict[str, Any]]:
    cfg = settings or get_settings()
    async with db.get_session() as session:
        rows = await session.execute(
            select(IncidentSummary)
            .where(IncidentSummary.project_id == project_id)
            .order_by(IncidentSummary.created_at.desc())
            .limit(150)
        )
        summaries = rows.scalars().all()
    ranked = sorted(summaries, key=lambda row: (_memory_score(row, case), row.created_at), reverse=True)
    selected = [row for row in ranked if _memory_score(row, case) > 0][: max(1, int(cfg.incident_memory_top_k or 5))]
    return [
        {
            "id": row.id,
            "incident_key": row.incident_key,
            "severity": row.severity,
            "confidence": row.confidence,
            "recommended_action": row.recommended_action,
            "resolution_quality": row.resolution_quality,
            "summary": row.summary_json if isinstance(row.summary_json, dict) else {},
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in selected
    ]


async def should_emit_alert(
    *,
    project_id: str,
    incident_key: str,
    settings: Settings | None = None,
) -> bool:
    cfg = settings or get_settings()
    key = f"{project_id}:{incident_key}"
    cached = await redis_bus.cache_get_json(settings=cfg, namespace="incident_notify", key=key)
    if cached:
        return False
    await redis_bus.cache_set_json(
        settings=cfg,
        namespace="incident_notify",
        key=key,
        payload={"at": _now_iso()},
        ttl_seconds=max(1, int(cfg.alert_cooldown_seconds or 300)),
    )
    return True


async def build_decision(
    *,
    backend: StateBackend,
    drift_alerts: list[DriftAlert],
    policy_alerts: list[PolicyAlert],
    recent_jobs: list[dict[str, Any]],
    correlation_id: str,
    settings: Settings | None = None,
) -> tuple[IncidentDecision, list[dict[str, Any]], list[dict[str, Any]]]:
    cfg = settings or get_settings()
    case = build_incident_case(backend=backend, drift_alerts=drift_alerts, policy_alerts=policy_alerts, recent_jobs=recent_jobs)
    memories = await list_relevant_memories(project_id=backend.project_id, case=case, settings=cfg)
    confidence = _score_confidence(case, len(memories))
    action, approval_required, analysis_only = _build_recommended_action(
        case,
        confidence=confidence,
        threshold=float(cfg.incident_confidence_threshold or 0.7),
    )
    action_class = classify_action_class(action)
    if action_class == ACTION_BLOCKED:
        approval_required = False
        analysis_only = True
        action = "analysis_only"
    evidence: list[dict[str, Any]] = [
        {"type": "drift_alerts", "count": case.drift_count},
        {"type": "policy_alerts", "count": case.policy_count},
        {"type": "failed_jobs", "count": case.failed_jobs},
    ]
    decision = validate_incident_decision(
        {
            "incident_key": case.incident_key,
            "severity": case.max_severity,
            "confidence": confidence,
            "evidence": evidence,
            "recommended_action": action,
            "approval_required": approval_required,
            "action_class": action_class,
            "analysis_only": analysis_only,
        }
    )
    events = [
        {
            "type": "incident.classified",
            "correlationId": correlation_id,
            "incidentKey": case.incident_key,
            "severity": decision["severity"],
            "confidence": decision["confidence"],
            "evidence": decision["evidence"],
        }
    ]
    if memories:
        events.append(
            {
                "type": "incident.memory.hit",
                "correlationId": correlation_id,
                "incidentKey": case.incident_key,
                "count": len(memories),
                "incidentIds": [row["id"] for row in memories],
            }
        )
    if action_class == ACTION_BLOCKED:
        events.append(
            {
                "type": "incident.action.blocked",
                "correlationId": correlation_id,
                "incidentKey": case.incident_key,
                "recommendedAction": action,
            }
        )
    events.append(
        {
            "type": "incident.recommendation",
            "correlationId": correlation_id,
            "incidentKey": case.incident_key,
            "severity": decision["severity"],
            "confidence": decision["confidence"],
            "recommendedAction": decision["recommended_action"],
            "approvalRequired": decision["approval_required"],
            "actionClass": decision["action_class"],
            "analysisOnly": decision["analysis_only"],
        }
    )
    return decision, memories, events


async def store_incident_summary(
    *,
    project_id: str,
    backend_id: str | None,
    decision: IncidentDecision,
    memories: list[dict[str, Any]],
    correlation_id: str,
    status: str = "open",
) -> dict[str, Any]:
    record = IncidentSummary(
        id=str(uuid4()),
        project_id=project_id,
        backend_id=backend_id,
        incident_key=decision["incident_key"] or str(uuid4()),
        correlation_id=correlation_id,
        severity=decision["severity"],
        confidence=decision["confidence"],
        recommended_action=decision["recommended_action"],
        action_class=decision["action_class"],
        approval_required=decision["approval_required"],
        status=status,
        summary_json={
            "evidence": decision["evidence"],
            "analysis_only": decision["analysis_only"],
            "rule_ids": [],
            "resources": [],
            "memory_hits": [row.get("id") for row in memories],
        },
    )
    async with db.get_session() as session:
        session.add(record)
        await session.flush()
    return serialize_summary(record)


def serialize_summary(row: IncidentSummary) -> dict[str, Any]:
    return {
        "id": row.id,
        "project_id": row.project_id,
        "backend_id": row.backend_id,
        "incident_key": row.incident_key,
        "correlation_id": row.correlation_id,
        "severity": row.severity,
        "confidence": row.confidence,
        "recommended_action": row.recommended_action,
        "action_class": row.action_class,
        "approval_required": row.approval_required,
        "status": row.status,
        "resolution_quality": row.resolution_quality,
        "summary": row.summary_json if isinstance(row.summary_json, dict) else {},
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


async def list_summaries(*, project_id: str, limit: int = 50) -> list[dict[str, Any]]:
    async with db.get_session() as session:
        rows = await session.execute(
            select(IncidentSummary)
            .where(IncidentSummary.project_id == project_id)
            .order_by(IncidentSummary.created_at.desc())
            .limit(max(1, min(limit, 200)))
        )
        summaries = rows.scalars().all()
    return [serialize_summary(row) for row in summaries]


async def get_summary(*, project_id: str, incident_id: str) -> dict[str, Any]:
    async with db.get_session() as session:
        row = await session.get(IncidentSummary, incident_id)
    if row is None or row.project_id != project_id:
        raise ValueError("incident_not_found")
    return serialize_summary(row)


async def mark_resolution_quality(*, project_id: str, incident_id: str, quality: str) -> dict[str, Any]:
    quality_value = (quality or "").strip().lower()
    if quality_value not in {"true_positive", "false_positive", "needs_review"}:
        raise ValueError("invalid_resolution_quality")
    async with db.get_session() as session:
        row = await session.get(IncidentSummary, incident_id)
        if row is None or row.project_id != project_id:
            raise ValueError("incident_not_found")
        row.resolution_quality = quality_value
        await session.flush()
    return {"id": incident_id, "resolution_quality": quality_value}


async def get_metrics(*, project_id: str) -> IncidentMetrics:
    async with db.get_session() as session:
        rows = await session.execute(select(IncidentSummary).where(IncidentSummary.project_id == project_id))
        summaries = rows.scalars().all()
    total = len(summaries)
    if total < 1:
        return {
            "false_positive_ratio": 0.0,
            "low_confidence_rate": 0.0,
            "approval_execution_rate": 0.0,
            "action_rollback_rate": 0.0,
            "total_incidents": 0,
        }
    false_positive = len([row for row in summaries if row.resolution_quality == "false_positive"])
    low_confidence = len([row for row in summaries if float(row.confidence or 0.0) < 0.7])
    approval_total = len([row for row in summaries if bool(row.approval_required)])
    approval_executed = len([row for row in summaries if bool(row.approval_required) and row.status == "resolved"])
    rollbacks = len([row for row in summaries if str(row.status or "") == "rolled_back"])
    return {
        "false_positive_ratio": round(false_positive / total, 4),
        "low_confidence_rate": round(low_confidence / total, 4),
        "approval_execution_rate": round((approval_executed / approval_total), 4) if approval_total > 0 else 0.0,
        "action_rollback_rate": round(rollbacks / total, 4),
        "total_incidents": total,
    }


async def recent_project_jobs(*, project_id: str, limit: int = 20) -> list[dict[str, Any]]:
    async with db.get_session() as session:
        rows = await session.execute(
            select(ProjectJob)
            .where(ProjectJob.project_id == project_id)
            .order_by(ProjectJob.created_at.desc())
            .limit(max(1, min(limit, 100)))
        )
        jobs = rows.scalars().all()
    return [
        {
            "id": row.id,
            "kind": row.kind,
            "status": row.status,
            "error": row.error_json if isinstance(row.error_json, dict) else None,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in jobs
    ]
