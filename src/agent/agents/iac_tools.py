"""Scoped infrastructure command tools for specialist agents."""

import json
import os
from pathlib import Path
import shutil
import subprocess

from strands import tool


MAX_OUTPUT_CHARS = 12000


def _workspace_path(path: str | None) -> Path:
    root = Path.cwd().resolve()
    requested = (path or ".").strip() or "."
    candidate = (root / requested).resolve()
    if candidate != root and root not in candidate.parents:
        raise ValueError("path must stay inside the current session workspace")
    return candidate


def _which(first_choice: str, *fallbacks: str) -> str | None:
    for command in (first_choice, *fallbacks):
        if shutil.which(command):
            return command
    return None


def _run(command: list[str], cwd: Path, timeout: int = 180) -> str:
    if not command or not shutil.which(command[0]):
        return json.dumps(
            {
                "ok": False,
                "error": "not_installed",
                "command": command[0] if command else "",
            }
        )
    try:
        completed = subprocess.run(
            command,
            cwd=str(cwd),
            env={**os.environ, "TF_INPUT": "0", "TOFU_INPUT": "0"},
            capture_output=True,
            check=False,
            text=True,
            timeout=timeout,
        )
        stdout = completed.stdout[-MAX_OUTPUT_CHARS:]
        stderr = completed.stderr[-MAX_OUTPUT_CHARS:]
        return json.dumps(
            {
                "ok": completed.returncode == 0,
                "returncode": completed.returncode,
                "cwd": str(cwd),
                "command": command,
                "stdout": stdout,
                "stderr": stderr,
                "truncated": len(completed.stdout) > MAX_OUTPUT_CHARS or len(completed.stderr) > MAX_OUTPUT_CHARS,
            }
        )
    except subprocess.TimeoutExpired as exc:
        return json.dumps(
            {
                "ok": False,
                "error": "timeout",
                "cwd": str(cwd),
                "command": command,
                "stdout": (exc.stdout or "")[-MAX_OUTPUT_CHARS:] if isinstance(exc.stdout, str) else "",
                "stderr": (exc.stderr or "")[-MAX_OUTPUT_CHARS:] if isinstance(exc.stderr, str) else "",
            }
        )
    except Exception as exc:
        return json.dumps(
            {
                "ok": False,
                "error": type(exc).__name__,
                "message": str(exc),
                "cwd": str(cwd),
                "command": command,
            }
        )


@tool
def terraform_init(path: str = ".", upgrade: bool = False) -> str:
    """Run Terraform/OpenTofu init in a workspace-relative directory.

    Args:
        path: Directory containing Terraform/OpenTofu files. Must be inside the session workspace.
        upgrade: Whether to pass -upgrade.

    Returns:
        JSON string with command, cwd, return code, stdout, and stderr.
    """
    cwd = _workspace_path(path)
    command = _which("tofu", "terraform")
    args = [command or "tofu", "init", "-input=false"]
    if upgrade:
        args.append("-upgrade")
    return _run(args, cwd, timeout=240)


@tool
def terraform_plan(path: str = ".", var_file: str = "") -> str:
    """Run Terraform/OpenTofu plan in a workspace-relative directory.

    Args:
        path: Directory containing Terraform/OpenTofu files. Must be inside the session workspace.
        var_file: Optional workspace-relative tfvars file passed as -var-file.

    Returns:
        JSON string with command, cwd, return code, stdout, and stderr.
    """
    cwd = _workspace_path(path)
    command = _which("tofu", "terraform")
    args = [command or "tofu", "plan", "-input=false", "-no-color"]
    if var_file.strip():
        var_path = _workspace_path(var_file)
        args.append(f"-var-file={var_path}")
    return _run(args, cwd, timeout=300)


@tool
def terraform_validate(path: str = ".") -> str:
    """Run Terraform/OpenTofu validate in a workspace-relative directory."""
    cwd = _workspace_path(path)
    command = _which("tofu", "terraform")
    return _run([command or "tofu", "validate", "-no-color"], cwd, timeout=180)


@tool
def tflint_scan(path: str = ".") -> str:
    """Run tflint in a workspace-relative directory."""
    cwd = _workspace_path(path)
    return _run(["tflint", "--no-color"], cwd, timeout=180)


@tool
def infracost_breakdown(path: str = ".") -> str:
    """Run infracost breakdown for Terraform/OpenTofu code in a workspace-relative directory."""
    cwd = _workspace_path(path)
    return _run(["infracost", "breakdown", "--path", str(cwd), "--format", "json"], cwd, timeout=300)


@tool
def checkov_scan(path: str = ".") -> str:
    """Run checkov against a workspace-relative directory."""
    cwd = _workspace_path(path)
    return _run(["checkov", "-d", str(cwd), "--quiet", "--compact"], cwd, timeout=300)
