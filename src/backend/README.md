# DeepAgents Backend

FastAPI backend for project workspace, GitHub integration, OpenTofu workflows, and agent chat.

## Prerequisites

- Python 3.11+
- PostgreSQL 14+
- Optional: Docker (for integration migration test)

## Environment

Copy `.env.example` to `.env` and set required values:

- `DATABASE_URL`
- `CLERK_SECRET_KEY`
- `CLERK_JWT_KEY` (if required by your Clerk setup)
- `CLERK_AUTHORIZED_PARTIES` (comma-separated origins)
- `GOOGLE_API_KEY`

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
uvicorn app.main:app --reload
```

## Legacy Auth Schema Cleanup

This codebase is Clerk-only. Legacy auth/session tables and columns can be dropped with:

```bash
cd src/backend
source .venv/bin/activate
python scripts/migrate_drop_legacy_auth_schema.py --database-url "$DATABASE_URL"
```

The migration is destructive for legacy auth data by design.

## Tests

```bash
cd src/backend
source .venv/bin/activate
PYTHONPATH=. pytest -q
```

Integration migration test (requires Docker):

```bash
cd src/backend
source .venv/bin/activate
PYTHONPATH=. pytest -q -m integration
```
