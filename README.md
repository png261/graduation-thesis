# DeepAgents Infrastructure Workspace

Monorepo gồm frontend React/Vite và backend FastAPI cho workflow hạ tầng (OpenTofu), GitHub integration, và agent chat.

## Structure

- `src/frontend`: React + Vite UI, Cognito auth client, assistant runtime adapters
- `src/backend`: FastAPI API, Cognito bearer auth, project/git/opentofu services

## Prerequisites

- Node.js 18+
- Python 3.11+
- PostgreSQL 14+
- Docker (optional, cho local service orchestration)

## Frontend (local)

```bash
cd src/frontend
npm install
npm run dev
```

## Backend (local)

```bash
cd src/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e .[dev]
uvicorn app.main:app --reload
```

## Environment

- Frontend: `src/frontend/.env.example`
- Backend: `src/backend/.env.example`

Auth flow dùng Cognito bearer tokens cho app login và GitHub OAuth cho repository operations. Legacy `/api/auth/*` đã bị loại bỏ.

## Legacy Auth Schema Migration

Để drop legacy auth tables/columns sau khi chuyển sang Cognito-only app login:

```bash
cd src/backend
source .venv/bin/activate
python scripts/migrate_drop_legacy_auth_schema.py --database-url "$DATABASE_URL"
```

## Quality Gates

```bash
# Frontend full verify
cd src/frontend && npm run verify

# Frontend lint/format
cd src/frontend && npm run lint && npm run format:check

# Backend incremental lint/format gate + compile
cd src/backend && source .venv/bin/activate && ruff check app/schemas/chat.py app/schemas/stream_events.py app/main.py app/routers/projects_routes/project_workspace.py app/routers/projects_routes/project_opentofu.py app/routers/http_errors.py app/services/opentofu/runtime/runner.py app/services/opentofu/runtime/shared.py app/services/ansible/runtime/runner.py app/services/jobs/tasks.py app/services/jobs/service.py app/services/agent/runtime/tools.py && black --check app/schemas/chat.py app/schemas/stream_events.py app/main.py app/routers/projects_routes/project_workspace.py app/routers/projects_routes/project_opentofu.py app/routers/http_errors.py app/services/opentofu/runtime/runner.py app/services/opentofu/runtime/shared.py app/services/ansible/runtime/runner.py app/services/jobs/tasks.py app/services/jobs/service.py app/services/agent/runtime/tools.py && python -m compileall app
```

## Docker

Frontend (production build + Nginx):

```bash
docker compose -f src/frontend/docker-compose.yml up --build
```

Backend (external PostgreSQL required via `src/backend/.env`):

```bash
docker compose -f src/backend/docker-compose.yml up --build
```

If PostgreSQL runs on your host machine, use `host.docker.internal` instead of `localhost` in `DATABASE_URL`.
Backend project files are persisted on host via bind mount:
- default host path: `src/backend/projects-data`
- container path: `/data/projects`
- override host path with `PROJECTS_HOST_PATH=/absolute/path` when running compose

Build images directly:

```bash
docker build -t deepagents-frontend:local src/frontend
docker build -t deepagents-backend:local src/backend
```

## CI/CD Docker Publish (GHCR)

Workflows:
- `.github/workflows/docker-frontend.yml`
- `.github/workflows/docker-backend.yml`

Behavior:
- `pull_request`: build-only validation (no registry push)
- `push` to `main`: build + push `latest` and commit SHA tags
- `push` tag `v*`: build + push ref and semver tags

Published images:
- `ghcr.io/<owner>/<repo>-frontend`
- `ghcr.io/<owner>/<repo>-backend`
