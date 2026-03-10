"""Project CRUD, credentials, and threads endpoints."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select

from app import db
from app.models import Project, Thread, User
from app.routers import auth_dependencies as auth_deps
from app.services.agent import invalidate_agent
from app.services.project import credentials as project_credentials
from app.services.project import files as project_files

from .common import mask_credentials, merge_credentials, project_to_dict, thread_to_dict

router = APIRouter()


class ProjectCreate(BaseModel):
    name: str
    provider: Literal["aws", "gcloud"] = "aws"


@router.get("")
async def list_projects(user: User = Depends(auth_deps.require_current_user)) -> dict:
    async with db.get_session() as session:
        result = await session.execute(
            select(Project).where(Project.user_id == user.id).order_by(Project.created_at)
        )
        projects = result.scalars().all()
    return {"projects": [project_to_dict(project) for project in projects]}


@router.post("")
async def create_project(
    body: ProjectCreate,
    user: User = Depends(auth_deps.require_current_user),
) -> dict:
    project_id = str(uuid.uuid4())
    project = Project(
        id=project_id,
        user_id=user.id,
        name=body.name.strip() or "Untitled Project",
        provider=body.provider,
    )
    async with db.get_session() as session:
        session.add(project)

    return {
        "id": project_id,
        "name": project.name,
        "provider": project.provider,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }


@router.delete("/{project_id}")
async def delete_project(
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    async with db.get_session() as session:
        owned = await session.get(Project, project.id)
        if owned is None:
            raise HTTPException(status_code=404, detail="Project not found")
        await session.delete(owned)
    project_files.delete_project_dir(project.id)
    invalidate_agent(project.id)
    return {"ok": True}


class CredentialsUpdate(BaseModel):
    credentials: dict


@router.get("/{project_id}/credentials")
async def get_credentials(project: Project = Depends(auth_deps.get_owned_project_or_404)) -> dict:
    creds = project_credentials.parse_credentials(project.credentials)

    return {
        "provider": project.provider,
        "credentials": mask_credentials(creds),
    }


@router.put("/{project_id}/credentials")
async def update_credentials(
    body: CredentialsUpdate,
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    async with db.get_session() as session:
        owned = await session.get(Project, project.id)
        if owned is None:
            raise HTTPException(status_code=404, detail="Project not found")
        existing = project_credentials.parse_credentials(owned.credentials)
        merged = merge_credentials(existing, body.credentials)
        owned.credentials = json.dumps(merged)

    invalidate_agent(project.id)
    return {"ok": True, "credentials": mask_credentials(merged)}


class ThreadCreate(BaseModel):
    id: str
    title: str = ""


@router.get("/{project_id}/threads")
async def list_threads(project: Project = Depends(auth_deps.get_owned_project_or_404)) -> dict:
    async with db.get_session() as session:
        result = await session.execute(
            select(Thread)
            .where(Thread.project_id == project.id)
            .order_by(Thread.created_at)
        )
        threads = result.scalars().all()
    return {"threads": [thread_to_dict(thread) for thread in threads]}


@router.post("/{project_id}/threads")
async def create_thread(
    body: ThreadCreate,
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    response_title = body.title
    async with db.get_session() as session:
        existing = await session.get(Thread, body.id)
        if existing is None:
            thread = Thread(id=body.id, project_id=project.id, title=body.title)
            session.add(thread)
        else:
            if existing.project_id != project.id:
                raise HTTPException(
                    status_code=409,
                    detail="Thread ID already exists for another project",
                )
            if body.title and body.title != existing.title:
                existing.title = body.title
            response_title = existing.title
    return {
        "id": body.id,
        "title": response_title,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }


@router.delete("/{project_id}/threads/{thread_id}")
async def delete_thread(
    thread_id: str,
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    async with db.get_session() as session:
        await session.execute(
            delete(Thread).where(Thread.id == thread_id, Thread.project_id == project.id)
        )
    return {"ok": True}


class GuestFileImport(BaseModel):
    path: str
    content: str


class GuestThreadImport(BaseModel):
    id: str
    title: str = ""


class GuestProjectImport(BaseModel):
    name: str = "Imported Guest Session"
    provider: Literal["aws", "gcloud"] = "aws"
    files: list[GuestFileImport] = []
    threads: list[GuestThreadImport] = []


@router.post("/import-guest")
async def import_guest_project(
    body: GuestProjectImport,
    user: User = Depends(auth_deps.require_current_user),
) -> dict:
    project_id = str(uuid.uuid4())
    project = Project(
        id=project_id,
        user_id=user.id,
        name=body.name.strip() or "Imported Guest Session",
        provider=body.provider,
    )
    async with db.get_session() as session:
        session.add(project)
        for thread in body.threads:
            session.add(
                Thread(
                    id=thread.id,
                    project_id=project_id,
                    title=thread.title.strip() or "",
                )
            )

    for file in body.files:
        project_files.write_text(project_id, file.path, file.content)

    invalidate_agent(project_id)
    return {
        "id": project_id,
        "name": project.name,
        "provider": project.provider,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
