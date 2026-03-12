"""Facade router for project-related endpoints.

This module preserves existing import paths while delegating route handlers to
smaller domain modules.
"""
from __future__ import annotations

from fastapi import APIRouter

from app.routers.projects_routes.project_ansible import router as project_ansible_router
from app.routers.projects_routes.project_crud import router as project_crud_router
from app.routers.projects_routes.project_github import router as project_github_router
from app.routers.projects_routes.project_jobs import router as project_jobs_router
from app.routers.projects_routes.project_opentofu import router as project_opentofu_router
from app.routers.projects_routes.project_state_backends import router as project_state_backends_router
from app.routers.projects_routes.project_telegram import router as project_telegram_router
from app.routers.projects_routes.project_workspace import router as project_workspace_router

router = APIRouter()
router.include_router(project_crud_router,
                      prefix="/api/projects", tags=["projects"])
router.include_router(project_github_router,
                      prefix="/api/projects", tags=["projects"])
router.include_router(project_telegram_router,
                      prefix="/api/projects", tags=["projects"])
router.include_router(project_jobs_router,
                      prefix="/api/projects", tags=["projects"])
router.include_router(project_ansible_router,
                      prefix="/api/projects", tags=["projects"])
router.include_router(project_opentofu_router,
                      prefix="/api/projects", tags=["projects"])
router.include_router(project_state_backends_router,
                      prefix="/api/projects", tags=["projects"])
router.include_router(project_workspace_router,
                      prefix="/api/projects", tags=["projects"])

__all__ = ["router"]
