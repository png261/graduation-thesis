#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export the backend OpenAPI schema to JSON.")
    parser.add_argument("--output", required=True, help="Output path for the generated OpenAPI schema JSON file.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repo_root = Path(__file__).resolve().parents[1]
    backend_root = repo_root / "src" / "backend"
    backend_venv_site_packages = sorted((backend_root / ".venv" / "lib").glob("python*/site-packages"))
    for site_packages in backend_venv_site_packages:
        sys.path.insert(0, str(site_packages))
    sys.path.insert(0, str(backend_root))

    from app.main import app  # noqa: PLC0415

    output_path = (repo_root / args.output).resolve() if not Path(args.output).is_absolute() else Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    schema = app.openapi()
    output_path.write_text(json.dumps(schema, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
