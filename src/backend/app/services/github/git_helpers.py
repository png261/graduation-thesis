from __future__ import annotations

import shutil
import tempfile
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import quote, urlsplit, urlunsplit


def slugify(name: str) -> str:
    value = "".join(c.lower() if (c.isalnum() or c in "-_") else "-" for c in name.strip())
    while "--" in value:
        value = value.replace("--", "-")
    return value.strip("-_") or "project"


def sanitize_error_message(message: str, access_token: str | None = None) -> str:
    cleaned = (message or "").strip()
    if access_token:
        cleaned = cleaned.replace(access_token, "***")
        cleaned = cleaned.replace(quote(access_token, safe=""), "***")
    return cleaned


def clone_auth_url(repo_full_name: str, access_token: str) -> str:
    token = quote(access_token, safe="")
    return f"https://x-access-token:{token}@github.com/{repo_full_name}.git"


def public_repo_url(repo_full_name: str) -> str:
    return f"https://github.com/{repo_full_name}.git"


def inject_auth_into_https_url(url: str, access_token: str, error_cls: type[Exception]) -> str:
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"}:
        raise error_cls("Only HTTP/HTTPS remotes are supported for authenticated operations")
    host = parsed.netloc.split("@")[-1]
    token = quote(access_token, safe="")
    return urlunsplit((parsed.scheme, f"x-access-token:{token}@{host}", parsed.path, parsed.query, parsed.fragment))


@contextmanager
def origin_with_auth(repo, access_token: str, error_cls: type[Exception]):
    if not repo.remotes:
        raise error_cls("Git remote 'origin' is not configured")

    try:
        remote = repo.remotes.origin
    except AttributeError as exc:
        raise error_cls("Git remote 'origin' is not configured") from exc

    original_url = next(remote.urls, "")
    if not original_url:
        raise error_cls("Git remote 'origin' URL is empty")

    authed_url = inject_auth_into_https_url(original_url, access_token, error_cls)
    try:
        remote.set_url(authed_url)
        yield remote
    finally:
        remote.set_url(original_url)


def move_all_entries_to_temp(project_root: Path) -> tuple[tempfile.TemporaryDirectory[str], list[str]]:
    tmp = tempfile.TemporaryDirectory(prefix="deepagents-gh-connect-")
    moved: list[str] = []
    for src in project_root.iterdir():
        name = src.name
        dst = Path(tmp.name) / name
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dst))
        moved.append(name)
    return tmp, moved


def _remove_entry(path: Path) -> None:
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path)
        return
    path.unlink()


def restore_entry_tree_without_overwrite(src: Path, dst: Path) -> None:
    if src.is_dir():
        if dst.exists() and not dst.is_dir():
            return
        dst.mkdir(parents=True, exist_ok=True)
        for child in src.iterdir():
            restore_entry_tree_without_overwrite(child, dst / child.name)
        return

    if dst.exists():
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(src), str(dst))


def restore_all_entries(project_root: Path, tmp_dir: str, moved: list[str]) -> None:
    for entry in list(project_root.iterdir()):
        _remove_entry(entry)
    for name in moved:
        src = Path(tmp_dir) / name
        dst = project_root / name
        if not src.exists():
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dst))


def restore_entries_without_overwrite(project_root: Path, tmp_dir: str, moved: list[str]) -> None:
    for name in moved:
        src = Path(tmp_dir) / name
        dst = project_root / name
        if not src.exists():
            continue
        if name == ".git" and dst.exists():
            continue
        restore_entry_tree_without_overwrite(src, dst)


def workspace_has_non_system_entries(project_root: Path) -> bool:
    if not project_root.exists():
        return False
    for entry in project_root.iterdir():
        name = entry.name
        if name in {".git", "AGENTS.md", ".opentofu-runtime"}:
            continue
        return True
    return False


def restore_repo_managed_entries(project_root: Path, tmp_dir: str) -> None:
    entries = [
        ("AGENTS.md", "AGENTS.md"),
        (".opentofu-runtime", ".opentofu-runtime"),
    ]
    for relative_src, relative_dst in entries:
        src = Path(tmp_dir) / relative_src
        dst = project_root / relative_dst
        if not src.exists():
            continue
        restore_entry_tree_without_overwrite(src, dst)


GITIGNORE_LINES = [
    "AGENTS.md",
    ".opentofu-runtime/",
]


def ensure_system_gitignore(project_root: Path) -> None:
    gitignore = project_root / ".gitignore"
    existing: list[str] = []
    if gitignore.exists():
        existing = [line.rstrip("\n") for line in gitignore.read_text().splitlines()]
    changed = False
    for line in GITIGNORE_LINES:
        if line not in existing:
            existing.append(line)
            changed = True
    if changed or not gitignore.exists():
        content = "\n".join(existing).rstrip() + "\n"
        gitignore.write_text(content)
