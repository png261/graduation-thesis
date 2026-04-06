from __future__ import annotations

from fastapi import APIRouter

from app.routers.projects_routes.project_opentofu import router as project_opentofu_router

router = APIRouter()
router.include_router(project_opentofu_router, prefix="/api/projects", tags=["provisioning"])

__all__ = ["router"]
