# DeepAgents Backend

FastAPI backend for project workspace, GitHub integration, OpenTofu workflows, and agent chat.

## Quick Start (Local)

```bash
cd src/backend
cp .env.example .env
python3 -m venv .venv
source .venv/bin/activate
pip install -e .[dev]
```

Set a working `DATABASE_URL` in `.env` before starting the API.

- If you run PostgreSQL directly on your machine: use `postgresql://<your_db_user>@localhost:5432/postgres` (or your own DB name/credentials).
- If you run services with Docker Compose: start dependencies first and use the compose DB URL.

Start API:

```bash
cd src/backend
source .venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Prerequisites

- Python 3.11+
- PostgreSQL 14+
- OpenTofu CLI (`tofu`) for infrastructure workflows
- Ansible CLI (`ansible-playbook`) for post-provision configuration workflows
- Optional: Docker (for local Postgres/Redis orchestration)

## Environment

Copy `.env.example` to `.env` and set required values:

- `DATABASE_URL`
- `DATABASE_URL_DOCKER` (optional compose-only DB URL override, default uses `postgres` service)
- `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` (optional compose postgres defaults)
- `COGNITO_REGION` / `COGNITO_USER_POOL_ID` / `COGNITO_CLIENT_ID`
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` / `GITHUB_REDIRECT_URI` (required for GitHub OAuth)
- `GOOGLE_API_KEY`
- `ANSIBLE_SSH_KEY_PATH` (required to run Ansible configuration stage)
- `ANSIBLE_PLAYBOOK_PATH` (optional, default `playbooks/site.yml`)
- `ANSIBLE_SSH_COMMON_ARGS` (optional)
- `ANSIBLE_HOST_KEY_CHECKING` (optional, default `True`)
- `REDIS_URL` (Redis cache)
- `RUNTIME_CACHE_TTL_SECONDS` (Graph/cost cache TTL, default `300`)
- `ZIP_IMPORT_MAX_BYTES` (optional max upload bytes for `/files/import-zip`, default 20MB)
- `ZIP_IMPORT_MAX_FILES` (optional max file count for ZIP import, default 2000)
- `ZIP_IMPORT_MAX_UNCOMPRESSED_BYTES` (optional max uncompressed ZIP bytes, default 80MB)
- `PROJECTS_ROOT` (optional project files root path; default is `src/backend/projects`)
- `STATE_ENCRYPTION_KEY` (required for encrypting credential profiles and Git provider OAuth tokens)
- `STATE_SYNC_SCAN_INTERVAL_MINUTES` (optional scheduler interval for background state sync)
- `STATE_SYNC_MAX_BACKENDS_PER_TICK` (optional scheduler batch size)

## Install

```bash
cd src/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e .[dev]
```

## Run

```bash
cd src/backend
source .venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Docker Persisted Project Files

When running with `src/backend/docker-compose.yml`, project files are stored outside container:
- host path: `src/backend/projects-data` (default)
- container path: `/data/projects`

Compose includes `postgres`, `redis`, and `backend` by default. `backend` uses
`DATABASE_URL_DOCKER` (or default `postgresql://postgres:postgres@postgres:5432/postgres`).

To change host path:

```bash
PROJECTS_HOST_PATH=/absolute/path docker compose -f src/backend/docker-compose.yml up --build
```

## Legacy Auth Schema Cleanup

This codebase uses Cognito for app login and direct OAuth for Git providers. Legacy auth/session tables and columns can be dropped with:

```bash
cd src/backend
source .venv/bin/activate
python scripts/migrate_drop_legacy_auth_schema.py --database-url "$DATABASE_URL"
```

The migration is destructive for legacy auth data by design.

## Lint & Format

```bash
cd src/backend
source .venv/bin/activate
ruff check \
  app/schemas/chat.py \
  app/schemas/stream_events.py \
  app/main.py \
  app/routers/projects_routes/project_workspace.py \
  app/routers/projects_routes/project_opentofu.py \
  app/routers/http_errors.py \
  app/services/opentofu/runtime/runner.py \
  app/services/opentofu/runtime/shared.py \
  app/services/ansible/runtime/runner.py \
  app/services/agent/runtime/tools.py
black --check \
  app/schemas/chat.py \
  app/schemas/stream_events.py \
  app/main.py \
  app/routers/projects_routes/project_workspace.py \
  app/routers/projects_routes/project_opentofu.py \
  app/routers/http_errors.py \
  app/services/opentofu/runtime/runner.py \
  app/services/opentofu/runtime/shared.py \
  app/services/ansible/runtime/runner.py \
  app/services/agent/runtime/tools.py
```

Auto-format:

```bash
cd src/backend
source .venv/bin/activate
ruff check --fix \
  app/schemas/chat.py \
  app/schemas/stream_events.py \
  app/main.py \
  app/routers/projects_routes/project_workspace.py \
  app/routers/projects_routes/project_opentofu.py \
  app/routers/http_errors.py \
  app/services/opentofu/runtime/runner.py \
  app/services/opentofu/runtime/shared.py \
  app/services/ansible/runtime/runner.py \
  app/services/agent/runtime/tools.py
black \
  app/schemas/chat.py \
  app/schemas/stream_events.py \
  app/main.py \
  app/routers/projects_routes/project_workspace.py \
  app/routers/projects_routes/project_opentofu.py \
  app/routers/http_errors.py \
  app/services/opentofu/runtime/runner.py \
  app/services/opentofu/runtime/shared.py \
  app/services/ansible/runtime/runner.py \
  app/services/agent/runtime/tools.py
```

Compile modules:

```bash
cd src/backend
source .venv/bin/activate
python -m compileall app
```
