"""Project memory, skills, files, and template-init endpoints."""
from __future__ import annotations

import io
import re
import zipfile
from pathlib import PurePosixPath

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.models import Project
from app.routers import auth_dependencies as auth_deps
from app.services.agent import _DEFAULT_AGENT_MD, invalidate_agent
from app.services.project import files as project_files

from . import project_templates
from .common import parse_skill_frontmatter, safe_skill_name

router = APIRouter()
KNOWN_TEMPLATES = project_templates.KNOWN_TEMPLATES


def _normalise_zip_name(raw_name: str) -> str:
    name = (raw_name or "").replace("\\", "/").strip()
    if not name:
        raise ValueError("Zip contains an invalid empty entry")
    if name.startswith("/"):
        raise ValueError(f"Zip contains absolute path '{name}'")
    posix = PurePosixPath(name)
    if any(part in {"", ".", ".."} for part in posix.parts):
        raise ValueError(f"Zip contains unsafe path '{name}'")
    return posix.as_posix()


@router.get("/{project_id}/memory")
async def get_memory(project: Project = Depends(auth_deps.get_owned_project_or_404)) -> dict:
    try:
        content = project_files.read_text(project.id, "/AGENT.md")
    except FileNotFoundError:
        content = _DEFAULT_AGENT_MD
    return {"content": content}


class MemoryUpdate(BaseModel):
    content: str


@router.put("/{project_id}/memory")
async def update_memory(
    body: MemoryUpdate,
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    project_files.write_text(project.id, "/AGENT.md", body.content)
    invalidate_agent(project.id)
    return {"ok": True}


@router.get("/{project_id}/skills")
async def list_skills(project: Project = Depends(auth_deps.get_owned_project_or_404)) -> dict:
    skills = []
    for skill_name, content in project_files.iter_skill_files(project.id):
        description = parse_skill_frontmatter(content)
        skills.append({"name": skill_name, "description": description, "content": content})
    skills.sort(key=lambda skill: skill["name"])
    return {"skills": skills}


class SkillUpsert(BaseModel):
    description: str = ""
    content: str


@router.put("/{project_id}/skills/{skill_name}")
async def upsert_skill(
    skill_name: str,
    body: SkillUpsert,
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    try:
        name = safe_skill_name(skill_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    project_files.write_text(project.id, f"/skills/{name}/SKILL.md", body.content)
    invalidate_agent(project.id)
    return {"ok": True, "name": name}


@router.delete("/{project_id}/skills/{skill_name}")
async def delete_skill(
    skill_name: str,
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    try:
        name = safe_skill_name(skill_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    key = f"/skills/{name}/SKILL.md"
    try:
        project_files.delete_file(project.id, key)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Skill not found")
    invalidate_agent(project.id)
    return {"ok": True}


class FileWriteBody(BaseModel):
    path: str
    content: str


@router.get("/{project_id}/files")
async def list_files(
    response: Response,
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    response.headers["Cache-Control"] = "no-store"
    return {"files": project_files.list_files(project.id)}


@router.get("/{project_id}/files/content")
async def read_file_content(
    path: str,
    response: Response,
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    try:
        normalised = project_files.normalize_virtual_path(path)
        content = project_files.read_text(project.id, normalised)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"File '{path}' not found")
    response.headers["Cache-Control"] = "no-store"
    return {"path": normalised, "content": content}


@router.put("/{project_id}/files/content")
async def write_file_content(
    body: FileWriteBody,
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    try:
        path = project_files.write_text(project.id, body.path, body.content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    invalidate_agent(project.id)
    return {"ok": True, "path": path}


@router.delete("/{project_id}/files/content")
async def delete_file_content(
    path: str,
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    try:
        normalised = project_files.delete_file(project.id, path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"File '{path}' not found")
    invalidate_agent(project.id)
    return {"ok": True, "path": normalised}


@router.post("/{project_id}/files/import-zip")
async def import_zip_file(
    file: UploadFile = File(...),
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    existing = project_files.list_files(project.id)
    if existing:
        raise HTTPException(
            status_code=409,
            detail={"code": "project_not_empty", "message": "Project already has files"},
        )

    archive_bytes = await file.read()
    try:
        with zipfile.ZipFile(io.BytesIO(archive_bytes), mode="r") as zf:
            raw_file_entries = [
                info
                for info in zf.infolist()
                if not info.is_dir() and info.filename and not info.filename.endswith("/")
            ]

            normalised_paths: list[str] = []
            for info in raw_file_entries:
                normalised_paths.append(_normalise_zip_name(info.filename))

            if not normalised_paths:
                raise HTTPException(
                    status_code=400,
                    detail={"code": "zip_empty", "message": "Zip archive has no importable files"},
                )

            # Validate/decode everything first so import is all-or-nothing.
            decoded_entries: list[tuple[str, str]] = []
            for info, rel_path in zip(raw_file_entries, normalised_paths, strict=True):
                try:
                    text = zf.read(info).decode("utf-8")
                except UnicodeDecodeError as exc:
                    raise HTTPException(
                        status_code=400,
                        detail={
                            "code": "zip_non_utf8",
                            "message": f"File '{rel_path}' is not valid UTF-8 text",
                        },
                    ) from exc
                decoded_entries.append((f"/{rel_path}", text))
    except zipfile.BadZipFile as exc:
        raise HTTPException(
            status_code=400,
            detail={"code": "zip_invalid", "message": "Uploaded file is not a valid zip archive"},
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail={"code": "zip_invalid_path", "message": str(exc)},
        ) from exc

    for path, content in decoded_entries:
        project_files.write_text(project.id, path, content)
    invalidate_agent(project.id)
    return {"ok": True, "imported_files": len(decoded_entries)}


@router.get("/{project_id}/files/export.zip")
async def export_project_zip(project: Project = Depends(auth_deps.get_owned_project_or_404)) -> StreamingResponse:
    root = project_files.ensure_project_dir(project.id)
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for file_path in root.rglob("*"):
            if not file_path.is_file():
                continue
            rel = file_path.relative_to(root).as_posix()
            if rel.startswith(".git/"):
                continue
            zf.write(file_path, arcname=rel)
    archive.seek(0)

    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "-", (project.name or "").strip()).strip("-")
    if not safe_name:
        safe_name = project.id

    headers = {
        "Content-Disposition": f'attachment; filename="{safe_name}.zip"',
        "Cache-Control": "no-store",
    }
    return StreamingResponse(archive, media_type="application/zip", headers=headers)


@router.post("/{project_id}/init/{template_name}")
async def init_project_template(
    template_name: str,
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    result = project_templates.init_project_template(project.id, template_name)
    if not result.get("ok"):
        raise HTTPException(
            status_code=404,
            detail=result["error"],
        )
    return {
        "ok": True,
        "template": result["template"],
        "skills_added": result["skills_added"],
    }
