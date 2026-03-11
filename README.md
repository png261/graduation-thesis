# DeepAgents Infrastructure Workspace

Monorepo gồm frontend React/Vite và backend FastAPI cho workflow hạ tầng (OpenTofu), GitHub integration, và agent chat.

## Structure

- `src/frontend`: React + Vite UI, Clerk auth client, assistant runtime adapters
- `src/backend`: FastAPI API, Clerk bearer auth, project/git/opentofu services
- `scripts`: repo-level quality checks (bao gồm function-length checker)

## Prerequisites

- Node.js 18+
- Python 3.11+
- PostgreSQL 14+
- Docker (optional, cho integration migration tests)

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

Auth flow là Clerk-only (GitHub OAuth qua Clerk). Legacy `/api/auth/*` đã bị loại bỏ.

## Legacy Auth Schema Migration

Để drop legacy auth tables/columns sau khi chuyển Clerk-only:

```bash
cd src/backend
source .venv/bin/activate
python scripts/migrate_drop_legacy_auth_schema.py --database-url "$DATABASE_URL"
```

## Quality Gates

```bash
# Function length (backend + frontend)
python3 scripts/check_function_lengths.py --target all

# Frontend
cd src/frontend && npm run verify

# Backend
cd src/backend && PYTHONPATH=. .venv/bin/pytest -q
```
