from __future__ import annotations

from fastapi import APIRouter

from app.routers.projects_routes.project_jobs import router as project_jobs_router

router = APIRouter()
router.include_router(project_jobs_router, prefix="/api/projects", tags=["workflow"])

__all__ = ["router"]
