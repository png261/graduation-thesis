from __future__ import annotations

from fastapi import APIRouter

from app.routers.projects_routes.project_crud import router as project_crud_router
from app.routers.projects_routes.project_workspace import router as project_workspace_router

router = APIRouter()
router.include_router(project_crud_router, prefix="/api/projects", tags=["identity-project"])
router.include_router(project_workspace_router, prefix="/api/projects", tags=["identity-project"])

__all__ = ["router"]
