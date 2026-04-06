from __future__ import annotations

from fastapi import APIRouter

from app.routers.projects_routes.project_blueprints import router as project_blueprints_router

router = APIRouter()
router.include_router(project_blueprints_router, prefix="/api/projects", tags=["blueprints"])

__all__ = ["router"]
