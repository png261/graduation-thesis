# AWS Service Deployment Notes

Use the monorepo service metadata in [services.json](/Users/png/01.%20Project/infra/src/backend/services/services.json)
with the generic Dockerfile in [Dockerfile.service](/Users/png/01.%20Project/infra/src/backend/services/Dockerfile.service)
to build one image per service.

## Build

```bash
cd src/backend
./scripts/build_service_image.sh gateway
./scripts/build_service_image.sh workflow
```

## Render App Runner Manifest

```bash
cd src/backend
python scripts/render_apprunner_manifest.py gateway > /tmp/gateway-apprunner.yaml
python scripts/render_apprunner_manifest.py workflow > /tmp/workflow-apprunner.yaml
```

The rendered manifest:

- uses `services/Dockerfile.service`
- builds from the backend root as context
- injects the service wrapper package name
- expects split-database deployment by default

Replace placeholder values before deploying:

- per-service database URL
- Redis URL
- Celery broker URL
- Celery result backend

## Recommended AWS Rollout Order

1. gateway
2. identity-project
3. workflow
4. conversation
5. provisioning
6. configuration-incident
7. scm
