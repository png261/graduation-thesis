from __future__ import annotations

from fastapi import APIRouter

from app.routers.projects_routes.project_github import router as project_github_router

router = APIRouter()
router.include_router(project_github_router, prefix="/api/projects", tags=["scm"])

__all__ = ["router"]
