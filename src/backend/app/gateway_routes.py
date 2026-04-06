from __future__ import annotations

from fastapi import APIRouter

from app.blueprint_routes import router as blueprint_router
from app.configuration_incident_routes import router as configuration_incident_router
from app.conversation_routes import router as conversation_router
from app.identity_project_routes import router as identity_project_router
from app.provisioning_routes import router as provisioning_router
from app.scm_routes import router as scm_router
from app.workflow_routes import router as workflow_router

router = APIRouter()
router.include_router(conversation_router)
router.include_router(identity_project_router)
router.include_router(workflow_router)
router.include_router(blueprint_router)
router.include_router(provisioning_router)
router.include_router(configuration_incident_router)
router.include_router(scm_router)


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
