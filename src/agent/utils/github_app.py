"""GitHub App workspace helpers for AgentCore Runtime."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import zipfile
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

import jwt

from utils.auth import get_github_app_credentials

GITHUB_API = "https://api.github.com"
DEFAULT_SHARED_FILES_MOUNT_PATH = "/tmp/agentcore-runtime-files"
DEFAULT_SHARED_FILES_FALLBACK_PATH = "/tmp/agentcore-runtime-files"


def _repo_parts(repository: dict) -> tuple[str, str, str]:
    full_name = repository.get("fullName") or repository.get("full_name") or ""
    if not full_name and repository.get("owner") and repository.get("name"):
        full_name = f"{repository['owner']}/{repository['name']}"
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", full_name):
        raise ValueError("Repository must be in owner/name format")
    owner, name = full_name.split("/", 1)
    default_branch = repository.get("defaultBranch") or repository.get("default_branch") or "main"
    return owner, name, default_branch


def _run_git(args: list[str], cwd: Path | None = None, timeout: int = 120) -> str:
    command = ["git"]
    if cwd is not None:
        command.extend(["-c", f"safe.directory={cwd}"])
    command.extend(args)
    result = subprocess.run(
        command,
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        message = f"{' '.join(command)} failed with {result.returncode}: {detail}"
        message = re.sub(r"x-access-token:[^@\\s]+@", "x-access-token:REDACTED@", message)
        raise RuntimeError(message)
    return result.stdout.strip()


def _github_request(method: str, path: str, token: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = Request(
        f"{GITHUB_API}{path}",
        data=data,
        method=method,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "agentcore-github-app",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urlopen(request, timeout=30) as response:
            raw = response.read()
            return json.loads(raw.decode("utf-8")) if raw else {}
    except HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GitHub API {method} {path} failed: {exc.code} {details}") from exc


def _app_jwt(credentials: dict[str, str]) -> str:
    now = int(time.time())
    app_id = credentials["app_id"]
    private_key = credentials["private_key"]
    if not app_id or not private_key:
        raise ValueError("GitHub App credentials require app_id and private_key")
    return jwt.encode({"iat": now - 60, "exp": now + 540, "iss": app_id}, private_key, algorithm="RS256")


def get_installation_token(owner: str, repo: str) -> str:
    credentials = get_github_app_credentials()
    app_token = _app_jwt(credentials)
    try:
        installation = _github_request("GET", f"/repos/{owner}/{repo}/installation", app_token)
        installation_id = installation["id"]
        token_response = _github_request(
            "POST",
            f"/app/installations/{installation_id}/access_tokens",
            app_token,
            {"repositories": [repo]},
        )
        return token_response["token"]
    except RuntimeError as exc:
        if " failed: 404 " not in str(exc):
            raise

    target = f"{owner}/{repo}".lower()
    installations = _github_request("GET", "/app/installations", app_token)
    if not isinstance(installations, list):
        raise RuntimeError("GitHub API did not return an installation list")

    seen: list[str] = []
    for installation in installations:
        installation_id = installation.get("id")
        if not installation_id:
            continue
        token_response = _github_request(
            "POST",
            f"/app/installations/{installation_id}/access_tokens",
            app_token,
            {},
        )
        installation_token = token_response["token"]
        repositories = _github_request("GET", "/installation/repositories", installation_token)
        for repository in repositories.get("repositories", []):
            full_name = repository.get("full_name", "")
            if full_name:
                seen.append(full_name)
            if full_name.lower() == target:
                return installation_token

    accounts = [((installation.get("account") or {}).get("login") or "unknown") for installation in installations]
    raise RuntimeError(
        f"GitHub App installation for {owner}/{repo} was not found. "
        f"Visible installation accounts: {accounts}. Visible repositories: {seen}."
    )


def _safe_session_id(session_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]", "-", session_id or "agentcore")


def _ensure_writable_directory(path: Path) -> bool:
    try:
        path.mkdir(parents=True, exist_ok=True)
        probe = path / ".agentcore-write-probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
        return True
    except OSError:
        return False


def shared_files_base_path() -> Path:
    mount_path = Path(os.environ.get("SHARED_FILES_MOUNT_PATH", DEFAULT_SHARED_FILES_MOUNT_PATH))
    if _ensure_writable_directory(mount_path):
        os.environ["SHARED_FILES_ACTIVE_PATH"] = str(mount_path)
        return mount_path

    fallback_path = Path(os.environ.get("SHARED_FILES_FALLBACK_PATH", DEFAULT_SHARED_FILES_FALLBACK_PATH))
    if _ensure_writable_directory(fallback_path):
        os.environ["SHARED_FILES_ACTIVE_PATH"] = str(fallback_path)
        return fallback_path

    raise PermissionError(f"No writable shared files directory found at {mount_path} or {fallback_path}")


def _session_root(session_id: str) -> Path:
    safe_session = _safe_session_id(session_id)
    return shared_files_base_path() / "sessions" / safe_session


def scratch_workspace_path(session_id: str) -> Path:
    path = _session_root(session_id) / "files"
    path.mkdir(parents=True, exist_ok=True)
    return path


def workspace_path(repository: dict, session_id: str = "agentcore") -> Path:
    owner, name, _ = _repo_parts(repository)
    return _session_root(session_id) / "repos" / owner / name


def _session_branch_name(session_id: str) -> str:
    safe_session = re.sub(r"[^A-Za-z0-9_.-]", "-", session_id or "agentcore")
    return f"agentcore/{safe_session[:8]}"


def setup_repository_workspace(repository: dict, session_id: str) -> Path:
    owner, name, default_branch = _repo_parts(repository)
    token = get_installation_token(owner, name)
    repo_path = workspace_path(repository, session_id)
    repo_path.parent.mkdir(parents=True, exist_ok=True)
    remote = f"https://x-access-token:{quote(token)}@github.com/{owner}/{name}.git"
    safe_remote = f"https://github.com/{owner}/{name}.git"
    branch_name = _session_branch_name(session_id)

    if (repo_path / ".git").exists():
        _run_git(["remote", "set-url", "origin", remote], repo_path)
        _run_git(["fetch", "origin", default_branch], repo_path)
        current_branch = _run_git(["branch", "--show-current"], repo_path)
        if current_branch != branch_name:
            branches = _run_git(["branch", "--list", branch_name], repo_path)
            if branches:
                _run_git(["checkout", branch_name], repo_path)
            else:
                _run_git(["checkout", "-B", branch_name, f"origin/{default_branch}"], repo_path)
    else:
        _run_git(["clone", remote, str(repo_path)], timeout=300)
        _run_git(["checkout", "-B", branch_name, f"origin/{default_branch}"], repo_path)

    _run_git(["config", "user.name", "AgentCore GitHub App"], repo_path)
    _run_git(["config", "user.email", "agentcore-github-app@users.noreply.github.com"], repo_path)
    _run_git(["remote", "set-url", "origin", safe_remote], repo_path)
    return repo_path


def list_installed_repositories() -> dict:
    credentials = get_github_app_credentials()
    app_token = _app_jwt(credentials)
    installations = _github_request("GET", "/app/installations", app_token)
    if not isinstance(installations, list):
        raise RuntimeError("GitHub API did not return an installation list")

    accounts: list[dict] = []
    repositories: list[dict] = []
    for installation in installations:
        installation_id = installation.get("id")
        if not installation_id:
            continue
        account = installation.get("account") or {}
        account_login = account.get("login") or ""
        account_type = account.get("type") or ""
        if account_login:
            accounts.append(
                {
                    "login": account_login,
                    "type": account_type,
                    "canCreateRepositories": account_type == "Organization",
                }
            )
        token_response = _github_request(
            "POST",
            f"/app/installations/{installation_id}/access_tokens",
            app_token,
            {},
        )
        installation_token = token_response["token"]
        response = _github_request("GET", "/installation/repositories?per_page=100", installation_token)
        for repository in response.get("repositories", []):
            full_name = repository.get("full_name") or ""
            if not full_name or "/" not in full_name:
                continue
            owner, name = full_name.split("/", 1)
            repositories.append(
                {
                    "fullName": full_name,
                    "owner": owner,
                    "name": name,
                    "defaultBranch": repository.get("default_branch") or "main",
                    "url": repository.get("html_url") or "",
                    "private": bool(repository.get("private")),
                }
            )

    accounts.sort(key=lambda item: item["login"].lower())
    repositories.sort(key=lambda item: item["fullName"].lower())
    return {"accounts": accounts, "repositories": repositories}


def _find_open_pull_request(owner: str, name: str, token: str, branch_name: str, base_branch: str) -> dict | None:
    query = urlencode(
        {
            "state": "open",
            "head": f"{owner}:{branch_name}",
            "base": base_branch,
            "per_page": "1",
        }
    )
    pulls = _github_request("GET", f"/repos/{owner}/{name}/pulls?{query}", token)
    if isinstance(pulls, list) and pulls:
        return pulls[0]
    return None


def _pull_request_summary(
    pr: dict | None,
    branch_name: str,
    base_branch: str,
    *,
    created: bool = False,
    updated: bool = False,
    committed: bool = False,
    changed_files: list[str] | None = None,
    message: str | None = None,
) -> dict:
    summary = {
        "created": created,
        "updated": updated,
        "committed": committed,
        "headBranch": branch_name,
        "baseBranch": base_branch,
        "changedFiles": changed_files or [],
    }
    if message:
        summary["message"] = message
    if pr:
        summary.update(
            {
                "number": pr.get("number"),
                "url": pr.get("html_url"),
                "state": pr.get("state"),
                "title": pr.get("title"),
                "body": pr.get("body") or "",
            }
        )
    return summary


def _commit_title_from_staged(staged_status: str, fallback: str) -> str:
    changes: list[tuple[str, str]] = []
    for line in staged_status.splitlines():
        if not line.strip():
            continue
        status, _, path = line.partition("\t")
        if not path:
            path = line[3:].strip()
        changes.append((status.strip(), path.strip()))

    if not changes:
        return fallback[:72]

    action = "Update"
    statuses = {status[:1] for status, _ in changes}
    if statuses == {"A"}:
        action = "Add"
    elif statuses == {"D"}:
        action = "Remove"

    names = [Path(path).name or path for _, path in changes[:3]]
    if len(changes) == 1:
        title = f"{action} {names[0]}"
    else:
        title = f"{action} {len(changes)} files: {', '.join(names)}"
    return title[:72]


def _short_status_from_name_status(name_status: str) -> list[str]:
    changed: list[str] = []
    for line in name_status.splitlines():
        if not line.strip():
            continue
        status, _, path = line.partition("\t")
        if not path:
            path = line[2:].strip()
        if "R" in status and "\t" in path:
            path = path.split("\t")[-1]
        code = "D" if "D" in status else "A" if "A" in status else "M"
        changed.append(f"{code}  {path}")
    return changed


def _merge_changed_files(*groups: list[str]) -> list[str]:
    merged: dict[str, str] = {}
    for group in groups:
        for line in group:
            path = line[3:].strip()
            if path:
                merged[path] = line
    return list(merged.values())


def preview_pull_request(repository: dict, session_id: str) -> dict:
    repo_path = setup_repository_workspace(repository, session_id)
    owner, name, default_branch = _repo_parts(repository)
    branch_name = _session_branch_name(session_id)
    token = get_installation_token(owner, name)
    status = _run_git(["status", "--short"], repo_path)
    branch_name_status = _run_git(["diff", "--name-status", f"origin/{default_branch}...HEAD"], repo_path)
    diff_stat = _run_git(["diff", "--stat", f"origin/{default_branch}...HEAD", "--", "."], repo_path)
    worktree_diff_stat = _run_git(["diff", "--stat"], repo_path)
    diff = _run_git(["diff", f"origin/{default_branch}...HEAD", "--", "."], repo_path)
    worktree_diff = _run_git(["diff", "--", "."], repo_path)
    untracked = _run_git(["ls-files", "--others", "--exclude-standard"], repo_path)
    branch_changed_files = _short_status_from_name_status(branch_name_status)
    worktree_changed_files = [line.strip() for line in status.splitlines() if line.strip()]
    changed_files = _merge_changed_files(branch_changed_files, worktree_changed_files)
    existing_pr = _find_open_pull_request(owner, name, token, branch_name, default_branch)
    return {
        "repository": f"{owner}/{name}",
        "baseBranch": default_branch,
        "headBranch": branch_name,
        "title": f"AgentCore changes for {owner}/{name}",
        "body": "Created by AgentCore from the selected workspace.",
        "created": False,
        "number": existing_pr.get("number") if existing_pr else None,
        "url": existing_pr.get("html_url") if existing_pr else None,
        "state": existing_pr.get("state") if existing_pr else None,
        "hasChanges": bool(changed_files),
        "changedFiles": changed_files,
        "diffStat": "\n".join(part for part in [diff_stat, worktree_diff_stat] if part),
        "diff": "\n".join(part for part in [diff, worktree_diff] if part)[:20000],
        "untrackedFiles": [line for line in untracked.splitlines() if line],
    }


def _safe_repo_file_path(path_value: str) -> str:
    file_path = str(path_value or "").strip().replace("\\", "/")
    if not file_path or file_path.startswith("/") or ".." in file_path.split("/"):
        raise ValueError("filePath is invalid")
    return file_path


def _git_file_status(repo_path: Path, file_path: str, base_ref: str | None = None) -> str:
    status = _run_git(["status", "--short", "--", file_path], repo_path)
    code = status[:2].strip() if status else ""
    if not code and base_ref:
        branch_status = _run_git(["diff", "--name-status", f"{base_ref}...HEAD", "--", file_path], repo_path)
        code = branch_status[:2].strip() if branch_status else ""
    if not code:
        return "unchanged"
    if "D" in code:
        return "deleted"
    if "A" in code or "?" in code:
        return "added"
    return "modified"


def get_file_diff(repository: dict, session_id: str, file_path: str) -> dict:
    repo_path = setup_repository_workspace(repository, session_id)
    _, _, default_branch = _repo_parts(repository)
    base_ref = f"origin/{default_branch}"
    safe_path = _safe_repo_file_path(file_path)
    status = _git_file_status(repo_path, safe_path, base_ref)

    try:
        original = _run_git(["show", f"{base_ref}:{safe_path}"], repo_path)
    except RuntimeError:
        original = ""

    if status == "deleted":
        current = ""
    else:
        try:
            current = (repo_path / safe_path).read_text(encoding="utf-8")
        except FileNotFoundError:
            try:
                current = _run_git(["show", f"HEAD:{safe_path}"], repo_path)
            except RuntimeError:
                current = ""
        except UnicodeDecodeError:
            current = "[Binary file preview is not available]"
        except IsADirectoryError:
            current = ""

    return {
        "path": safe_path,
        "status": status,
        "originalContent": original,
        "currentContent": current,
    }


def _safe_repo_dir_path(path_value: str) -> str:
    directory = str(path_value or ".").strip().replace("\\", "/") or "."
    if directory.startswith("/") or ".." in directory.split("/"):
        raise ValueError("terraformPath is invalid")
    return "." if directory in {"", "."} else directory.rstrip("/")


def _terraform_backend_args(state_backend: dict | None) -> list[str]:
    if not isinstance(state_backend, dict):
        return []
    args = []
    for backend_key, tf_key in (("bucket", "bucket"), ("key", "key"), ("region", "region")):
        value = str(state_backend.get(backend_key) or "").strip()
        if value:
            args.append(f"-backend-config={tf_key}={value}")
    if args:
        args.insert(0, "-reconfigure")
    return args


def _run_process(command: list[str], cwd: Path, timeout: int = 300) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(
        command,
        cwd=str(cwd),
        env={**os.environ, "TF_INPUT": "0", "TOFU_INPUT": "0"},
        capture_output=True,
        check=False,
        text=True,
        timeout=timeout,
    )
    if completed.returncode != 0:
        output = (completed.stderr or completed.stdout or "").strip()
        raise RuntimeError(f"{' '.join(command)} failed with {completed.returncode}: {output[-4000:]}")
    return completed


def _parse_rover_graph_js(content: str) -> dict:
    match = re.search(r"^\s*const\s+graph\s*=\s*(\{.*\})\s*$", content, re.DOTALL)
    if not match:
        raise RuntimeError("Rover graph asset did not contain graph JSON")
    graph = json.loads(match.group(1))
    if not isinstance(graph, dict) or not isinstance(graph.get("nodes"), list) or not isinstance(graph.get("edges"), list):
        raise RuntimeError("Rover graph JSON has an unexpected shape")
    return graph


def _plan_change_summary(plan: dict) -> dict:
    counts = {"create": 0, "update": 0, "delete": 0, "replace": 0, "no-op": 0}
    for change in plan.get("resource_changes") or []:
        actions = ((change.get("change") or {}).get("actions") or [])
        if actions == ["no-op"]:
            counts["no-op"] += 1
        elif actions == ["create"]:
            counts["create"] += 1
        elif actions == ["update"]:
            counts["update"] += 1
        elif actions == ["delete"]:
            counts["delete"] += 1
        elif "delete" in actions and "create" in actions:
            counts["replace"] += 1
    counts["total"] = sum(counts.values())
    return counts


def generate_terraform_plan_graph(
    repository: dict,
    session_id: str,
    terraform_path: str = ".",
    state_backend: dict | None = None,
) -> dict:
    repo_path = setup_repository_workspace(repository, session_id)
    safe_path = _safe_repo_dir_path(terraform_path)
    workdir = (repo_path / safe_path).resolve()
    try:
        workdir.relative_to(repo_path.resolve())
    except ValueError as exc:
        raise ValueError("terraformPath escapes repository workspace") from exc
    if not workdir.exists() or not workdir.is_dir():
        raise FileNotFoundError(f"terraformPath does not exist: {safe_path}")

    terraform = shutil.which("tofu") or shutil.which("terraform")
    if not terraform:
        raise RuntimeError("OpenTofu or Terraform is not installed in the agent runtime")
    rover = shutil.which("rover")
    if not rover:
        raise RuntimeError("Rover is not installed in the agent runtime")

    with tempfile.TemporaryDirectory(prefix="agentcore-rover-") as tmp:
        tmp_path = Path(tmp)
        plan_out = tmp_path / "plan.out"
        plan_json = tmp_path / "plan.json"
        rover_zip_base = tmp_path / "rover"
        rover_zip = tmp_path / "rover.zip"

        _run_process([terraform, "init", "-input=false", *_terraform_backend_args(state_backend)], workdir, timeout=300)
        _run_process([terraform, "plan", "-input=false", "-no-color", "-out", str(plan_out)], workdir, timeout=420)
        plan = json.loads(_run_process([terraform, "show", "-json", str(plan_out)], workdir, timeout=180).stdout)
        plan_json.write_text(json.dumps(plan), encoding="utf-8")
        _run_process(
            [
                rover,
                "-standalone",
                "true",
                "-planJSONPath",
                str(plan_json),
                "-zipFileName",
                str(rover_zip_base),
                "-tfPath",
                terraform,
            ],
            workdir,
            timeout=240,
        )
        if not rover_zip.exists():
            raise RuntimeError("Rover did not create the expected standalone graph bundle")
        with zipfile.ZipFile(rover_zip) as archive:
            graph = _parse_rover_graph_js(archive.read("graph.js").decode("utf-8"))

    return {
        "terraformPath": safe_path,
        "tool": "rover",
        "summary": _plan_change_summary(plan),
        "graph": graph,
    }


def sync_pull_request(repository: dict, session_id: str, title: str, body: str) -> dict:
    repo_path = setup_repository_workspace(repository, session_id)
    owner, name, default_branch = _repo_parts(repository)
    branch_name = _session_branch_name(session_id)
    token = get_installation_token(owner, name)

    _run_git(["add", "-A"], repo_path)
    staged = _run_git(["diff", "--cached", "--name-only"], repo_path)
    staged_status = _run_git(["diff", "--cached", "--name-status"], repo_path)
    changed_files = [line.strip() for line in staged.splitlines() if line.strip()]
    commit_title = _commit_title_from_staged(staged_status, title or "AgentCore chat update")
    committed = False
    if staged:
        _run_git(["commit", "-m", commit_title], repo_path)
        committed = True
        push_remote = f"https://x-access-token:{quote(token)}@github.com/{owner}/{name}.git"
        _run_git(["push", push_remote, f"HEAD:{branch_name}", "--force-with-lease"], repo_path, timeout=300)

    existing_pr = _find_open_pull_request(owner, name, token, branch_name, default_branch)
    if existing_pr:
        if committed or title != existing_pr.get("title") or body != (existing_pr.get("body") or ""):
            existing_pr = _github_request(
                "PATCH",
                f"/repos/{owner}/{name}/pulls/{existing_pr.get('number')}",
                token,
                {"title": title, "body": body},
            )
        summary = _pull_request_summary(
            existing_pr,
            branch_name,
            default_branch,
            updated=committed,
            committed=committed,
            changed_files=changed_files,
            message="Pull request branch is up to date." if not committed else None,
        )
        summary["commitTitle"] = commit_title if committed else ""
        return summary

    if not committed:
        summary = _pull_request_summary(
            None,
            branch_name,
            default_branch,
            committed=False,
            message="No repository changes to commit.",
        )
        summary["commitTitle"] = ""
        return summary

    pr = _github_request(
        "POST",
        f"/repos/{owner}/{name}/pulls",
        token,
        {"title": title, "body": body, "head": branch_name, "base": default_branch},
    )
    summary = _pull_request_summary(
        pr,
        branch_name,
        default_branch,
        created=True,
        updated=True,
        committed=True,
        changed_files=changed_files,
    )
    summary["commitTitle"] = commit_title
    return summary


def create_pull_request(repository: dict, session_id: str, title: str, body: str) -> dict:
    return sync_pull_request(repository, session_id, title, body)


def _check_summary(check_runs: list[dict], combined_state: str) -> dict:
    counts: dict[str, int] = {}
    for run in check_runs:
        key = run.get("conclusion") or run.get("status") or "unknown"
        counts[key] = counts.get(key, 0) + 1

    if any(run.get("status") != "completed" for run in check_runs):
        state = "pending"
    elif any(run.get("conclusion") in {"failure", "timed_out", "cancelled", "action_required"} for run in check_runs):
        state = "failure"
    elif check_runs:
        state = "success"
    else:
        state = combined_state or "unknown"

    return {
        "state": state,
        "total": len(check_runs),
        "counts": counts,
    }


def list_pull_requests(repository: dict, state: str = "open") -> dict:
    owner, name, _ = _repo_parts(repository)
    token = get_installation_token(owner, name)
    normalized_state = state if state in {"open", "closed", "all"} else "open"
    pulls = _github_request(
        "GET",
        f"/repos/{owner}/{name}/pulls?state={normalized_state}&per_page=50&sort=updated&direction=desc",
        token,
    )
    if not isinstance(pulls, list):
        raise RuntimeError("GitHub API did not return a pull request list")

    items = []
    for pr in pulls:
        head = pr.get("head") or {}
        base = pr.get("base") or {}
        user = pr.get("user") or {}
        sha = head.get("sha") or ""
        combined = _github_request("GET", f"/repos/{owner}/{name}/commits/{sha}/status", token) if sha else {}
        checks = _github_request("GET", f"/repos/{owner}/{name}/commits/{sha}/check-runs", token) if sha else {}
        check_runs = checks.get("check_runs", []) if isinstance(checks, dict) else []
        labels = pr.get("labels") or []
        items.append(
            {
                "number": pr.get("number"),
                "title": pr.get("title"),
                "state": pr.get("state"),
                "draft": pr.get("draft", False),
                "url": pr.get("html_url"),
                "createdAt": pr.get("created_at"),
                "updatedAt": pr.get("updated_at"),
                "author": user.get("login"),
                "headBranch": head.get("ref"),
                "baseBranch": base.get("ref"),
                "headSha": sha,
                "labels": [label.get("name") for label in labels if label.get("name")],
                "mergeableState": pr.get("mergeable_state"),
                "combinedStatus": combined.get("state", "unknown") if isinstance(combined, dict) else "unknown",
                "checkSummary": _check_summary(check_runs, combined.get("state", "unknown") if isinstance(combined, dict) else "unknown"),
                "checks": [
                    {
                        "name": run.get("name"),
                        "status": run.get("status"),
                        "conclusion": run.get("conclusion"),
                        "url": run.get("html_url"),
                        "startedAt": run.get("started_at"),
                        "completedAt": run.get("completed_at"),
                    }
                    for run in check_runs
                ],
            }
        )

    return {
        "repository": f"{owner}/{name}",
        "state": normalized_state,
        "pullRequests": items,
    }
