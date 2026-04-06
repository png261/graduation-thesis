from __future__ import annotations

from pathlib import Path

WORKTREE = Path(__file__).resolve().parents[1]
APP_ROOT = WORKTREE / "app"
ALLOWLIST = {
    APP_ROOT / "db.py",
    APP_ROOT / "models.py",
}
FORBIDDEN_PATTERNS = (
    "from app import db",
    "from app.models import",
    "import app.models",
)


def main() -> int:
    violations: list[str] = []
    for path in APP_ROOT.rglob("*.py"):
        if path in ALLOWLIST:
            continue
        content = path.read_text(encoding="utf-8")
        for pattern in FORBIDDEN_PATTERNS:
            if pattern in content:
                violations.append(f"{path.relative_to(WORKTREE)}: contains '{pattern}'")

    if violations:
        for line in violations:
            print(f"ERROR: {line}")
        return 1
    print("No forbidden shared-root imports found outside compatibility modules.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
