from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Mapping

from app.services.project_execution.contracts import ProjectExecutionRequest

_SAVED_CREDENTIALS_MESSAGE = "Saved AWS credentials are incomplete."
_GENERATION_READINESS_MESSAGE = "Generate Terraform and Ansible artifacts before continuing."
_PLAN_REVIEW_MESSAGE = "Review the latest plan in this session before continuing."
_DESTROY_REVIEW_MESSAGE = "Run and review a destroy plan in this session before continuing."
_DRIFT_REFRESH_MESSAGE = "Refresh drift on the primary state backend before continuing."
_DRIFT_OVERRIDE_MESSAGE = "Refresh drift on the primary state backend before continuing, or explicitly allow partial apply for the selected scope."
_PARTIAL_SCOPE_MESSAGE = "Acknowledge the advanced partial-scope warning before continuing."
_DESTROY_CONFIRMATION_MESSAGE = "Type the project name and destroy before starting destroy."


def gate_error(code: str, message: str, **extra: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {"type": "error", "stage": "preflight", "code": code, "message": message}
    payload.update(extra)
    return payload


def _parse_iso_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def terraform_generation_ready(opentofu_status: Mapping[str, Any]) -> bool:
    return bool(opentofu_status.get("project_found") and opentofu_status.get("modules"))


def target_contract_ready(target_contract: Mapping[str, Any]) -> bool:
    return str(target_contract.get("status") or "") == "valid" and not bool(target_contract.get("stale"))


def build_generation_gate(
    opentofu_status: Mapping[str, Any],
    ansible_status: Mapping[str, Any],
    target_contract: Mapping[str, Any],
) -> dict[str, Any]:
    terraform_generated = terraform_generation_ready(opentofu_status)
    target_ready = target_contract_ready(target_contract)
    target_stale = bool(target_contract.get("stale"))
    ansible_required = bool(ansible_status.get("configurationRequired", True))
    ansible_ready = (not ansible_required) or bool(ansible_status.get("generationReady"))
    return {
        "terraform_generated": terraform_generated,
        "terraform_ready": terraform_generated and target_ready,
        "ansible_required": ansible_required,
        "ansible_ready": ansible_ready,
        "target_contract_ready": target_ready,
        "target_contract_stale": target_stale,
        "blocking": not (terraform_generated and target_ready and ansible_ready),
    }


def build_credential_gate(opentofu_status: Mapping[str, Any]) -> dict[str, Any]:
    missing_fields = [str(item) for item in opentofu_status.get("missing_credentials", [])]
    ready = bool(opentofu_status.get("credential_ready"))
    return {
        "status": "ready" if ready else "missing_credentials",
        "blocking": not ready,
        "missing_fields": missing_fields,
    }


def _review_message(status: str) -> str:
    messages = {
        "fresh": "Current plan review is valid for deploy.",
        "missing": "Run plan and review it before deploy.",
        "session_required": "Review the current plan in this session before deploy.",
        "session_mismatch": "Plan review belongs to a different session.",
        "workspace_changed": "Workspace changed since the reviewed plan.",
        "stale": "Plan review expired. Review a fresh plan before deploy.",
        "scope_mismatch": "Plan review does not match the requested deploy scope.",
    }
    return messages.get(status, "Plan review is not valid for deploy.")


def build_review_gate_payload(
    *,
    resolved_review: Mapping[str, Any] | None,
    request: ProjectExecutionRequest,
    review_target: str,
    last_failed_destroy_at: datetime | None = None,
) -> dict[str, Any]:
    payload = dict(resolved_review or {})
    status = str(payload.get("status") or "missing")
    if request.review_session_id is None:
        status = "session_required"
    if status == "fresh" and review_target == "destroy" and last_failed_destroy_at is not None:
        reviewed_at = _parse_iso_datetime(payload.get("reviewed_at"))
        if reviewed_at is None or reviewed_at <= last_failed_destroy_at:
            status = "missing"
    return {
        **payload,
        "status": status,
        "blocking": status != "fresh",
        "message": _review_message(status),
    }


def checklist_item(name: str, ready: bool, code: str, message: str) -> dict[str, Any]:
    return {"name": name, "ready": ready, "code": code, "message": message}


def generated_terraform_checklist_item(
    generation_gate: Mapping[str, Any],
    target_contract: Mapping[str, Any],
) -> dict[str, Any]:
    if not generation_gate["terraform_generated"]:
        return checklist_item(
            "Generated Terraform",
            False,
            "terraform_generation_missing",
            "Generated Terraform is not ready for deploy.",
        )
    if generation_gate["target_contract_stale"]:
        return checklist_item(
            "Generated Terraform",
            False,
            "terraform_target_contract_stale",
            "Terraform target preview is stale. Refresh Target Preview before deploy.",
        )
    if not generation_gate["target_contract_ready"]:
        if str(target_contract.get("status") or "") == "invalid":
            errors = [str(item) for item in target_contract.get("validation_errors", [])]
            detail = errors[0] if errors else "Terraform target preview is invalid."
            return checklist_item(
                "Generated Terraform",
                False,
                "terraform_target_contract_invalid",
                detail,
            )
        return checklist_item(
            "Generated Terraform",
            False,
            "terraform_target_contract_missing",
            "No validated Terraform target preview is available yet.",
        )
    return checklist_item(
        "Generated Terraform",
        True,
        "terraform_ready",
        "Generated Terraform is ready.",
    )


def build_checklist(
    *,
    credential_gate: Mapping[str, Any],
    generation_gate: Mapping[str, Any],
    target_contract: Mapping[str, Any],
    review_gate: Mapping[str, Any],
    drift_refresh: Mapping[str, Any],
) -> list[dict[str, Any]]:
    return [
        checklist_item(
            "Saved AWS credentials",
            not credential_gate["blocking"],
            "credentials_missing",
            (
                "Saved AWS credentials are ready."
                if not credential_gate["blocking"]
                else f"Missing saved AWS credentials: {', '.join(credential_gate['missing_fields'])}"
            ),
        ),
        generated_terraform_checklist_item(generation_gate, target_contract),
        checklist_item(
            "Generated Ansible",
            bool(generation_gate["ansible_ready"]),
            "ansible_not_required" if not generation_gate["ansible_required"] else "ansible_generation_missing",
            (
                "Generated Ansible is not required for this deploy scope."
                if not generation_gate["ansible_required"]
                else (
                    "Generated Ansible is ready."
                    if generation_gate["ansible_ready"]
                    else "Generated Ansible is not ready for deploy."
                )
            ),
        ),
        checklist_item(
            "Reviewed plan",
            not review_gate["blocking"],
            str(review_gate["status"]),
            str(review_gate["message"]),
        ),
        checklist_item(
            "Primary backend drift refresh",
            not bool(drift_refresh.get("blocking")),
            str(drift_refresh.get("status") or "drift_refresh_required"),
            str(drift_refresh.get("reason") or _DRIFT_REFRESH_MESSAGE),
        ),
    ]


def primary_blocker(checklist: list[dict[str, Any]]) -> tuple[str | None, str]:
    blocker = next((item for item in checklist if not item["ready"]), None)
    if blocker is None:
        return None, ""
    return str(blocker["code"]), str(blocker["message"])


@dataclass(frozen=True)
class DeployPreflightState:
    credential_gate: dict[str, Any]
    generation_gate: dict[str, Any]
    target_contract: dict[str, Any]
    review_gate: dict[str, Any]
    drift_refresh: dict[str, Any]
    ssm_readiness: dict[str, Any]
    checklist: list[dict[str, Any]]
    primary_blocker_code: str | None
    primary_blocker_message: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "primary_blocker_code": self.primary_blocker_code,
            "primary_blocker_message": self.primary_blocker_message,
            "generation_gate": self.generation_gate,
            "target_contract": self.target_contract,
            "ssm_readiness": self.ssm_readiness,
            "credential_gate": self.credential_gate,
            "review_gate": self.review_gate,
            "drift_refresh": self.drift_refresh,
            "checklist": self.checklist,
        }


def build_deploy_preflight_state(
    *,
    request: ProjectExecutionRequest,
    opentofu_status: Mapping[str, Any],
    ansible_status: Mapping[str, Any],
    target_contract: Mapping[str, Any],
    resolved_review: Mapping[str, Any] | None,
    drift_refresh: Mapping[str, Any],
    ssm_readiness: Mapping[str, Any],
    last_failed_destroy_at: datetime | None = None,
) -> DeployPreflightState:
    generation = build_generation_gate(opentofu_status, ansible_status, target_contract)
    credential = build_credential_gate(opentofu_status)
    review = build_review_gate_payload(
        resolved_review=resolved_review,
        request=request,
        review_target=request.resolved_review_target(),
        last_failed_destroy_at=last_failed_destroy_at,
    )
    checklist = build_checklist(
        credential_gate=credential,
        generation_gate=generation,
        target_contract=target_contract,
        review_gate=review,
        drift_refresh=drift_refresh,
    )
    blocker_code, blocker_message = primary_blocker(checklist)
    if (
        blocker_code is None
        and generation["terraform_ready"]
        and generation["ansible_ready"]
        and bool(ssm_readiness.get("blocking"))
    ):
        blocker_code = str(ssm_readiness.get("blocker_code") or "")
        blocker_message = str(ssm_readiness.get("blocker_message") or "")
    return DeployPreflightState(
        credential_gate=dict(credential),
        generation_gate=dict(generation),
        target_contract=dict(target_contract),
        review_gate=dict(review),
        drift_refresh=dict(drift_refresh),
        ssm_readiness=dict(ssm_readiness),
        checklist=checklist,
        primary_blocker_code=blocker_code,
        primary_blocker_message=blocker_message,
    )


def resolve_generation_gate_error(
    generation_gate: Mapping[str, Any],
    target_contract: Mapping[str, Any],
) -> dict[str, Any] | None:
    if not generation_gate["blocking"]:
        return None
    extra: dict[str, Any] = {}
    if generation_gate["target_contract_stale"]:
        extra["target_contract_status"] = "stale"
    elif not generation_gate["target_contract_ready"]:
        extra["target_contract_status"] = str(target_contract.get("status") or "missing")
        validation_errors = [str(item) for item in target_contract.get("validation_errors", [])]
        if validation_errors:
            extra["validation_errors"] = validation_errors
    return gate_error("generation_readiness_required", _GENERATION_READINESS_MESSAGE, **extra)


def resolve_review_gate_error(
    review_gate: Mapping[str, Any],
    *,
    review_target: str,
) -> dict[str, Any] | None:
    if not review_gate.get("blocking"):
        return None
    status = str(review_gate.get("status") or "missing")
    if review_target == "destroy":
        return gate_error(
            "destroy_plan_review_required",
            _DESTROY_REVIEW_MESSAGE,
            review_status=status,
        )
    code = "plan_review_stale" if status in {"stale", "workspace_changed"} else "plan_review_required"
    return gate_error(code, _PLAN_REVIEW_MESSAGE, review_status=status)


def resolve_drift_gate_error(
    *,
    request: ProjectExecutionRequest,
    drift_refresh: Mapping[str, Any],
) -> dict[str, Any] | None:
    scope_mode = request.effective_scope_mode()
    if scope_mode == "partial" and not request.option_enabled("confirm_partial_scope"):
        return gate_error("partial_scope_confirmation_required", _PARTIAL_SCOPE_MESSAGE)

    status = str(drift_refresh.get("status") or "")
    source = str(drift_refresh.get("source") or "")
    if (
        scope_mode == "partial"
        and status == "drift_detected"
        and not request.option_enabled("confirm_partial_drift_override")
    ):
        return gate_error("drift_detected", _DRIFT_OVERRIDE_MESSAGE, drift_status=status)

    if source == "primary_backend" and status in {"in_sync", "ready"} and not bool(drift_refresh.get("blocking")):
        return None
    if scope_mode == "partial" and source == "primary_backend" and status == "drift_detected":
        return None
    if status == "drift_detected":
        return gate_error("drift_detected", _DRIFT_OVERRIDE_MESSAGE, drift_status=status)
    return gate_error("drift_refresh_required", _DRIFT_REFRESH_MESSAGE, drift_status=status or "refresh_required")


def resolve_destroy_confirmation_error(
    *,
    project_name: str,
    request: ProjectExecutionRequest,
) -> dict[str, Any] | None:
    scope_mode = request.effective_scope_mode()
    if scope_mode == "partial" and not request.option_enabled("confirm_partial_scope"):
        return gate_error("partial_scope_confirmation_required", _PARTIAL_SCOPE_MESSAGE)

    confirmation = request.confirmation
    if confirmation is None or confirmation.project_name != project_name or confirmation.keyword != "destroy":
        return gate_error("destroy_confirmation_required", _DESTROY_CONFIRMATION_MESSAGE)
    if scope_mode == "partial" and tuple(request.selected_modules) != confirmation.selected_modules:
        return gate_error("destroy_confirmation_required", _DESTROY_CONFIRMATION_MESSAGE)
    return None


def pipeline_missing_requirements(status: Mapping[str, Any]) -> list[str]:
    missing = [str(item) for item in status.get("missing_requirements", [])]
    ignored = {"ansible_hosts_missing", "invalid_ansible_hosts_output"}
    ssm_readiness = status.get("ssm_readiness") if isinstance(status.get("ssm_readiness"), dict) else {}
    if str(ssm_readiness.get("blocker_code") or "") == "ssm_target_not_ready":
        ignored.add("ssm_target_not_ready")
    return [item for item in missing if item not in ignored]


def pipeline_preflight_message(status: Mapping[str, Any], apply_modules: list[str]) -> str:
    missing = pipeline_missing_requirements(status)
    output_errors = status.get("output_errors") if isinstance(status.get("output_errors"), list) else []
    target_modules = [str(module) for module in status.get("targetModules", [])]
    ssm_readiness = status.get("ssm_readiness") if isinstance(status.get("ssm_readiness"), dict) else {}
    blocker_code = str(ssm_readiness.get("blocker_code") or "")
    if missing:
        if blocker_code and blocker_code in missing:
            failed_targets = ssm_readiness.get("failed_targets")
            target_rows = (
                failed_targets if isinstance(failed_targets, list) and failed_targets else ssm_readiness.get("targets")
            )
            target_ids = [
                str(item.get("execution_id") or "")
                for item in target_rows
                if isinstance(item, dict) and str(item.get("execution_id") or "")
            ]
            message = str(ssm_readiness.get("blocker_message") or blocker_code)
            if target_ids:
                return f"Pipeline preflight failed: {message} Targets: {', '.join(target_ids)}"
            return f"Pipeline preflight failed: {message}"
        return f"Pipeline preflight failed: {', '.join(str(item) for item in missing)}"
    if output_errors:
        return f"Pipeline preflight failed: {'; '.join(str(item) for item in output_errors)}"
    if not target_modules:
        return "Pipeline preflight failed: generated Ansible has no target modules"
    uncovered = [module for module in target_modules if module not in apply_modules]
    if uncovered:
        return f"Pipeline preflight failed: apply scope excludes configuration targets {', '.join(uncovered)}"
    return "Pipeline preflight failed: configuration readiness is not satisfied"
