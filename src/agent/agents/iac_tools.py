"""Scoped infrastructure command tools for specialist agents."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

from strands import tool


MAX_OUTPUT_CHARS = 12000
MINISTACK_DEFAULT_ENDPOINT = "http://127.0.0.1:4566"
_MINISTACK_PROCESS: subprocess.Popen | None = None


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


def _ministack_env(endpoint: str, region: str = "us-east-1") -> dict[str, str]:
    return {
        **os.environ,
        "AWS_ACCESS_KEY_ID": os.environ.get("AWS_ACCESS_KEY_ID", "test"),
        "AWS_SECRET_ACCESS_KEY": os.environ.get("AWS_SECRET_ACCESS_KEY", "test"),
        "AWS_DEFAULT_REGION": region,
        "AWS_REGION": region,
        "AWS_ENDPOINT_URL": endpoint,
        "MINISTACK_ENDPOINT_URL": endpoint,
        "TF_INPUT": "0",
        "TOFU_INPUT": "0",
    }


def _ministack_health_url(endpoint: str) -> str:
    return urllib.parse.urljoin(endpoint.rstrip("/") + "/", "_ministack/health")


def _ministack_reset_url(endpoint: str) -> str:
    return urllib.parse.urljoin(endpoint.rstrip("/") + "/", "_ministack/reset")


def _ministack_is_healthy(endpoint: str) -> bool:
    try:
        with urllib.request.urlopen(_ministack_health_url(endpoint), timeout=2) as response:
            return 200 <= response.status < 300
    except (urllib.error.URLError, TimeoutError, ValueError):
        return False


def _ensure_ministack(endpoint: str, services: str = "", timeout_seconds: int = 30) -> dict:
    global _MINISTACK_PROCESS

    if _ministack_is_healthy(endpoint):
        return {"ok": True, "endpoint": endpoint, "started": False}

    parsed = urllib.parse.urlparse(endpoint)
    if parsed.hostname not in {"127.0.0.1", "localhost"}:
        return {
            "ok": False,
            "error": "ministack_unreachable",
            "endpoint": endpoint,
            "message": "Configured MiniStack endpoint is not healthy and cannot be auto-started because it is not local.",
        }

    command = shutil.which("ministack")
    if not command:
        return {
            "ok": False,
            "error": "not_installed",
            "command": "ministack",
            "endpoint": endpoint,
        }

    port = str(parsed.port or 4566)
    env = {
        **os.environ,
        "GATEWAY_PORT": port,
        "MINISTACK_HOST": parsed.hostname or "127.0.0.1",
        "AWS_ACCESS_KEY_ID": "test",
        "AWS_SECRET_ACCESS_KEY": "test",
        "AWS_DEFAULT_REGION": "us-east-1",
        "AWS_ENDPOINT_URL": endpoint,
    }
    if services.strip():
        env["SERVICES"] = services.strip()

    if _MINISTACK_PROCESS is None or _MINISTACK_PROCESS.poll() is not None:
        _MINISTACK_PROCESS = subprocess.Popen(
            [command],
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            text=True,
        )

    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if _ministack_is_healthy(endpoint):
            return {
                "ok": True,
                "endpoint": endpoint,
                "started": True,
                "pid": _MINISTACK_PROCESS.pid if _MINISTACK_PROCESS else None,
            }
        if _MINISTACK_PROCESS and _MINISTACK_PROCESS.poll() is not None:
            return {
                "ok": False,
                "error": "ministack_exited",
                "returncode": _MINISTACK_PROCESS.returncode,
                "endpoint": endpoint,
            }
        time.sleep(0.5)

    return {
        "ok": False,
        "error": "ministack_start_timeout",
        "endpoint": endpoint,
        "timeoutSeconds": timeout_seconds,
    }


def _reset_ministack(endpoint: str) -> dict:
    request = urllib.request.Request(_ministack_reset_url(endpoint), method="POST")
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return {"ok": 200 <= response.status < 300, "status": response.status}
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        return {"ok": False, "error": type(exc).__name__, "message": str(exc)}


def _go_test_args(test_pattern: str, timeout_seconds: int) -> list[str]:
    args = ["go", "test", "./...", "-timeout", f"{max(1, timeout_seconds)}s"]
    if test_pattern.strip():
        args.extend(["-run", test_pattern.strip()])
    return args


def _run_ministack_terratest(
    cwd: Path,
    endpoint: str,
    test_pattern: str,
    timeout_seconds: int,
    reset_before: bool,
) -> str:
    args = _go_test_args(test_pattern, timeout_seconds)
    if not shutil.which(args[0]):
        return json.dumps(
            {
                "ok": False,
                "error": "not_installed",
                "command": args[0],
                "endpoint": endpoint,
            }
        )
    reset_result = _reset_ministack(endpoint) if reset_before else {"ok": True, "skipped": True}
    if not reset_result.get("ok"):
        return json.dumps(
            {
                "ok": False,
                "error": "ministack_reset_failed",
                "endpoint": endpoint,
                "reset": reset_result,
            }
        )
    try:
        completed = subprocess.run(
            args,
            cwd=str(cwd),
            env=_ministack_env(endpoint),
            capture_output=True,
            check=False,
            text=True,
            timeout=max(1, timeout_seconds + 30),
        )
        stdout = completed.stdout[-MAX_OUTPUT_CHARS:]
        stderr = completed.stderr[-MAX_OUTPUT_CHARS:]
        return json.dumps(
            {
                "ok": completed.returncode == 0,
                "returncode": completed.returncode,
                "cwd": str(cwd),
                "endpoint": endpoint,
                "command": args,
                "reset": reset_result,
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
                "endpoint": endpoint,
                "command": args,
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
                "endpoint": endpoint,
                "command": args,
            }
        )


def _configure_infracost_api_key(cwd: Path) -> dict | None:
    api_key = os.environ.get("INFRACOST_API_KEY", "").strip()
    command = ["infracost", "configure", "set", "api_key", "<redacted>"]
    if not api_key:
        return {
            "ok": False,
            "error": "missing_api_key",
            "cwd": str(cwd),
            "command": command,
            "message": "INFRACOST_API_KEY is not configured in the runtime environment.",
        }
    if not shutil.which("infracost"):
        return {
            "ok": False,
            "error": "not_installed",
            "cwd": str(cwd),
            "command": "infracost",
        }
    try:
        completed = subprocess.run(
            ["infracost", "configure", "set", "api_key", api_key],
            cwd=str(cwd),
            env={**os.environ, "TF_INPUT": "0", "TOFU_INPUT": "0"},
            capture_output=True,
            check=False,
            text=True,
            timeout=60,
        )
    except subprocess.TimeoutExpired as exc:
        return {
            "ok": False,
            "error": "timeout",
            "cwd": str(cwd),
            "command": command,
            "stdout": (exc.stdout or "")[-MAX_OUTPUT_CHARS:] if isinstance(exc.stdout, str) else "",
            "stderr": (exc.stderr or "")[-MAX_OUTPUT_CHARS:] if isinstance(exc.stderr, str) else "",
        }
    except Exception as exc:
        return {
            "ok": False,
            "error": type(exc).__name__,
            "message": str(exc),
            "cwd": str(cwd),
            "command": command,
        }

    if completed.returncode != 0:
        return {
            "ok": False,
            "returncode": completed.returncode,
            "cwd": str(cwd),
            "command": command,
            "stdout": completed.stdout[-MAX_OUTPUT_CHARS:],
            "stderr": completed.stderr[-MAX_OUTPUT_CHARS:],
            "truncated": len(completed.stdout) > MAX_OUTPUT_CHARS or len(completed.stderr) > MAX_OUTPUT_CHARS,
        }
    return None


@tool
def terraform_init(
    path: str = ".",
    upgrade: bool = False,
    backend_bucket: str = "",
    backend_key: str = "",
    backend_region: str = "",
) -> str:
    """Run Terraform/OpenTofu init in a workspace-relative directory.

    Args:
        path: Directory containing Terraform/OpenTofu files. Must be inside the session workspace.
        upgrade: Whether to pass -upgrade.
        backend_bucket: Optional S3 backend bucket to pass as -backend-config=bucket=...
        backend_key: Optional S3 backend key to pass as -backend-config=key=...
        backend_region: Optional S3 backend region to pass as -backend-config=region=...

    Returns:
        JSON string with command, cwd, return code, stdout, and stderr.
    """
    cwd = _workspace_path(path)
    command = _which("tofu", "terraform")
    args = [command or "tofu", "init", "-input=false"]
    if upgrade:
        args.append("-upgrade")
    if backend_bucket.strip():
        args.append(f"-backend-config=bucket={backend_bucket.strip()}")
    if backend_key.strip():
        args.append(f"-backend-config=key={backend_key.strip()}")
    if backend_region.strip():
        args.append(f"-backend-config=region={backend_region.strip()}")
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
def ministack_terratest(
    path: str = ".",
    test_pattern: str = "",
    endpoint: str = "",
    services: str = "",
    timeout_seconds: int = 1800,
    reset_before: bool = True,
) -> str:
    """Run Go Terratest tests against a local MiniStack AWS emulator.

    The tool starts MiniStack in the AgentCore runtime when the endpoint is local and not already
    healthy, then runs `go test ./...` from the workspace-relative path. Tests receive dummy AWS
    credentials plus `AWS_ENDPOINT_URL`, `MINISTACK_ENDPOINT_URL`, `AWS_REGION`, and
    `AWS_DEFAULT_REGION` pointed at MiniStack. Terraform providers should use endpoint overrides
    or read `AWS_ENDPOINT_URL`/`MINISTACK_ENDPOINT_URL` from the test code.

    Args:
        path: Directory containing Go Terratest files. Must be inside the session workspace.
        test_pattern: Optional Go `-run` regex for selecting tests.
        endpoint: MiniStack endpoint. Defaults to MINISTACK_ENDPOINT_URL, MINISTACK_ENDPOINT, or http://127.0.0.1:4566.
        services: Optional MiniStack SERVICES filter used when the tool auto-starts MiniStack.
        timeout_seconds: Go test timeout in seconds.
        reset_before: Whether to call `/_ministack/reset` before running tests.

    Returns:
        JSON string with command, cwd, MiniStack endpoint, reset result, return code, stdout, and stderr.
    """
    cwd = _workspace_path(path)
    selected_endpoint = (
        endpoint.strip()
        or os.environ.get("MINISTACK_ENDPOINT_URL", "").strip()
        or os.environ.get("MINISTACK_ENDPOINT", "").strip()
        or MINISTACK_DEFAULT_ENDPOINT
    )
    startup = _ensure_ministack(selected_endpoint, services=services)
    if not startup.get("ok"):
        return json.dumps(startup)
    result = json.loads(
        _run_ministack_terratest(
            cwd,
            selected_endpoint,
            test_pattern,
            max(1, int(timeout_seconds)),
            reset_before,
        )
    )
    result["ministack"] = startup
    return json.dumps(result)


@tool
def tflint_scan(path: str = ".") -> str:
    """Run tflint in a workspace-relative directory."""
    cwd = _workspace_path(path)
    return _run(["tflint", "--no-color"], cwd, timeout=180)


@tool
def infracost_breakdown(path: str = ".") -> str:
    """Run infracost breakdown for Terraform/OpenTofu code in a workspace-relative directory."""
    cwd = _workspace_path(path)
    configure_error = _configure_infracost_api_key(cwd)
    if configure_error:
        return json.dumps(configure_error)
    return _run(["infracost", "breakdown", "--path", str(cwd), "--format", "json"], cwd, timeout=300)


@tool
def checkov_scan(path: str = ".") -> str:
    """Run checkov against a workspace-relative directory."""
    cwd = _workspace_path(path)
    return _run(["checkov", "-d", str(cwd), "--quiet", "--compact"], cwd, timeout=300)
