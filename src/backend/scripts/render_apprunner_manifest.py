from __future__ import annotations

import json
import sys
from pathlib import Path

SERVICES_PATH = Path(__file__).resolve().parents[1] / "services" / "services.json"


def _load_services() -> dict[str, dict[str, object]]:
    return json.loads(SERVICES_PATH.read_text(encoding="utf-8"))


def _database_env_name(service_name: str) -> str:
    token = service_name.upper().replace("-", "_")
    if token == "GATEWAY":
        return "GATEWAY_DATABASE_URL"
    if token == "SCM":
        return "SCM_DATABASE_URL"
    return f"{token}_DATABASE_URL"


def _manifest(service_name: str, metadata: dict[str, object]) -> str:
    service_dir = str(metadata["service_dir"])
    service_package = str(metadata["python_package"])
    port = int(metadata.get("default_port", 8000))
    database_env = _database_env_name(service_name)
    return f"""version: 1.0
runtime: docker
build:
  dockerfile: services/Dockerfile.service
  buildContext: .
  args:
    - name: SERVICE_DIR
      value: {service_dir}
    - name: SERVICE_PACKAGE
      value: {service_package}
run:
  command: uvicorn {service_package}.asgi:app --host 0.0.0.0 --port {port}
  network:
    port: {port}
    env: PORT
  env:
    - name: SERVICE_DATABASE_MODE
      value: split
    - name: {database_env}
      value: REPLACE_ME
    - name: REDIS_URL
      value: REPLACE_ME
    - name: CELERY_BROKER_URL
      value: REPLACE_ME
    - name: CELERY_RESULT_BACKEND
      value: REPLACE_ME
"""


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: python scripts/render_apprunner_manifest.py <service-name>", file=sys.stderr)
        return 1
    service_name = argv[1]
    services = _load_services()
    metadata = services.get(service_name)
    if metadata is None:
        print(f"unknown service: {service_name}", file=sys.stderr)
        return 1
    print(_manifest(service_name, metadata))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
