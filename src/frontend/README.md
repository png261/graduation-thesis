# DeepAgents Frontend

React + Vite client for the DeepAgents UI.

## Prerequisites

- Node.js 20+
- npm 10+
- Backend API running (default: `http://localhost:8000`)

## Environment

```bash
cd src/frontend
cp .env.example .env
```

Important variables:

- `VITE_API_URL` (default in example: `http://localhost:8000`)
- `VITE_CLERK_PUBLISHABLE_KEY`

## Install

```bash
cd src/frontend
npm install
```

## Run (Development)

```bash
cd src/frontend
npm run dev -- --host 0.0.0.0 --port 5173
```

Open `http://localhost:5173`.

## Build

```bash
cd src/frontend
npm run build
```

## Verify

```bash
cd src/frontend
npm run verify
```
