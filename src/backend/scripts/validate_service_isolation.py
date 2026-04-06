from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ACTIVE_APP_DIR = ROOT / "app"
SERVICE_PACKAGE_DIR = ROOT / "services"
SERVICE_PACKAGE_SEAM_FILES = {
    "api.py",
    "backend.py",
    "db.py",
    "models.py",
    "persistence.py",
    "policy.py",
    "runtime.py",
    "streaming.py",
    "types.py",
}
SERVICE_PACKAGE_BOOTSTRAP_FILES = {"api.py", "db.py", "runtime.py"}
ALLOWED_IMPORT_FILES = {
    ROOT / "app" / "db.py",
    ROOT / "app" / "models.py",
}
FORBIDDEN_PATTERNS = (
    r"from app\.models import",
    r"from app import db",
    r"\bdb\.get_session\(",
    r"\bdb\.init_db\(",
    r"\bdb\.close_db\(",
    r"\bdb\.get_checkpointer\(",
)
SERVICE_PACKAGE_FORBIDDEN_PATTERNS = (
    r"from app\.routers(?:\.|\s+import\s+)",
    r"from app\.core\.sse import",
    r"from app\.schemas\.chat import",
    r"from app\.services\.jobs\.errors import",
    r"from app\.services\.project_execution\.contracts import",
)
SERVICE_PACKAGE_RUNTIME_ONLY_PATTERNS = (r"from app\.services\.", r"import app\.services")
SERVICE_PACKAGE_BOOTSTRAP_ONLY_PATTERNS = (
    r"from app\.app_factory import",
    r"from app\.core\.config import",
    r"from app\.core\.service_settings import",
)


def _python_files() -> list[Path]:
    return sorted(path for path in ACTIVE_APP_DIR.rglob("*.py") if path not in ALLOWED_IMPORT_FILES)


def _violations(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    return [pattern for pattern in FORBIDDEN_PATTERNS if re.search(pattern, text)]


def _service_package_python_files() -> list[Path]:
    return sorted(SERVICE_PACKAGE_DIR.rglob("*.py"))


def _service_package_violations(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    return [pattern for pattern in SERVICE_PACKAGE_FORBIDDEN_PATTERNS if re.search(pattern, text)]


def _service_package_runtime_only_violations(path: Path) -> list[str]:
    if path.name in SERVICE_PACKAGE_SEAM_FILES:
        return []
    text = path.read_text(encoding="utf-8")
    return [pattern for pattern in SERVICE_PACKAGE_RUNTIME_ONLY_PATTERNS if re.search(pattern, text)]


def _service_package_bootstrap_only_violations(path: Path) -> list[str]:
    if path.name in SERVICE_PACKAGE_BOOTSTRAP_FILES:
        return []
    text = path.read_text(encoding="utf-8")
    return [pattern for pattern in SERVICE_PACKAGE_BOOTSTRAP_ONLY_PATTERNS if re.search(pattern, text)]


def _shared_base_violations() -> list[Path]:
    service_models = (ROOT / "app" / "services").rglob("models.py")
    return sorted(
        path for path in service_models if "from app.persistence.base import Base" in path.read_text(encoding="utf-8")
    )


def main() -> int:
    failed = False
    for path in _python_files():
        hits = _violations(path)
        if not hits:
            continue
        failed = True
        relative = path.relative_to(ROOT)
        print(f"ERROR: {relative} contains legacy import/use patterns: {', '.join(hits)}")
    for path in _shared_base_violations():
        failed = True
        relative = path.relative_to(ROOT)
        print(f"ERROR: {relative} still depends on shared app.persistence.base")
    for path in _service_package_python_files():
        hits = _service_package_violations(path)
        if not hits:
            hits = _service_package_runtime_only_violations(path)
            if not hits:
                hits = _service_package_bootstrap_only_violations(path)
                if not hits:
                    continue
                failed = True
                relative = path.relative_to(ROOT)
                print(f"ERROR: {relative} contains bootstrap imports outside runtime seam: {', '.join(hits)}")
                continue
            failed = True
            relative = path.relative_to(ROOT)
            print(f"ERROR: {relative} contains app.services imports outside runtime seam: {', '.join(hits)}")
            continue
        failed = True
        relative = path.relative_to(ROOT)
        print(f"ERROR: {relative} contains shared router imports: {', '.join(hits)}")
    if failed:
        return 1
    print("Active service codepaths are isolated from legacy app.models/app.db shims.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
