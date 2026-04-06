from __future__ import annotations

from fastapi import APIRouter

from app.routers.projects_routes.project_ansible import router as project_ansible_router
from app.routers.projects_routes.project_incidents import router as project_incidents_router

router = APIRouter()
router.include_router(project_ansible_router, prefix="/api/projects", tags=["configuration-incident"])
router.include_router(project_incidents_router, prefix="/api/projects", tags=["configuration-incident"])

__all__ = ["router"]
