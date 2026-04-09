# Backend Service Layout

This directory contains service-specific source trees that wrap the current
service shells under `src/backend/app/`.

## Services

- `gateway/` -> `app.main:app`
- `identity-project/` -> `app.identity_project_main:app`
- `conversation/` -> `app.conversation_main:app`
- `workflow/` -> `app.workflow_main:app`
- `provisioning/` -> `app.provisioning_main:app`
- `configuration-incident/` -> `app.configuration_incident_main:app`
- `scm/` -> `app.scm_main:app`

## Shared Package

`../shared/pyproject.toml` packages the existing shared backend code under the
`app` package. Each service package is intentionally thin and imports one of
the service shells from that shared package.

## AWS Deployment Direction

For AWS App Runner / ECS / EKS, each service directory can become its own
deployment unit and image entrypoint while using `src/backend/` as the Docker
build context:

- build/install `deepagents-backend-shared`
- build/install the service package
- run `uvicorn <service_package>.asgi:app --host 0.0.0.0 --port 8000`

This is a deployment-oriented source separation step, not a full elimination of
shared code.

## Container Build

Use the generic service Dockerfile from the backend root:

```bash
cd src/backend
./scripts/build_service_image.sh gateway
./scripts/build_service_image.sh workflow
```

The script uses:

- `services/Dockerfile.service`
- `services/services.json`

The Docker build context is `src/backend/`, so each image gets:

- `shared/` for the shared backend package
- `app/` for the current split service internals
- `services/<service>/` for the service-specific wrapper package

Example AWS target mapping:

- App Runner: one image per service, one service per ASGI entrypoint
- ECS/Fargate: one task definition per service image
- EKS: one Deployment per service image

App Runner helpers live in [services/aws/README.md](/Users/png/01.%20Project/infra/src/backend/services/aws/README.md)
and [scripts/render_apprunner_manifest.py](/Users/png/01.%20Project/infra/src/backend/scripts/render_apprunner_manifest.py).

Recommended starting deploy order:

1. gateway
2. identity-project
3. workflow
4. conversation
5. provisioning
6. configuration-incident
7. scm
