from __future__ import annotations

import hashlib
import hmac
import io
import json
import mimetypes
import re
import time
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import PurePosixPath
from typing import Any, Literal
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import delete, select

from app.shared.auth import dependencies as auth_deps

from .runtime import conversation_persistence, identity_project_persistence, identity_project_service, settings
from .serializers import (
    mask_credentials,
    merge_credentials,
    project_to_dict,
    thread_to_dict,
)

router = APIRouter()
_UPLOAD_CHUNK_SIZE = 1024 * 1024


class ProjectCreate(BaseModel):
    name: str
    provider: Literal["aws", "gcloud"] = "aws"


class CredentialsUpdate(BaseModel):
    credentials: dict


class ThreadCreate(BaseModel):
    id: str
    title: str = ""


class ThreadMessageUpsert(BaseModel):
    item: dict[str, Any]


class MemoryUpdate(BaseModel):
    content: str


class FileWriteBody(BaseModel):
    path: str
    content: str


class FileMoveBody(BaseModel):
    source_paths: list[str]
    destination_dir: str


class FileRenameBody(BaseModel):
    path: str
    new_name: str


def _credentials_payload(project: identity_project_persistence.Project, creds: dict[str, str]) -> dict[str, Any]:
    required_fields = identity_project_service.required_credential_fields(project.provider)
    missing_fields = [field for field in required_fields if not creds.get(field)]
    return {
        "provider": project.provider,
        "credentials": mask_credentials(creds),
        "required_fields": required_fields,
        "missing_fields": missing_fields,
        "apply_ready": len(required_fields) > 0 and len(missing_fields) == 0,
    }


def _extract_message_id(item: dict[str, Any]) -> str:
    message = item.get("message")
    if not isinstance(message, dict):
        raise HTTPException(status_code=400, detail="message payload is required")
    raw_id = message.get("id")
    if not isinstance(raw_id, str) or not raw_id.strip():
        raise HTTPException(status_code=400, detail="message.id is required")
    return raw_id.strip()


async def _load_owned_thread(project_id: str, thread_id: str) -> conversation_persistence.Thread | None:
    async with conversation_persistence.get_session() as session:
        result = await session.execute(
            select(conversation_persistence.Thread).where(
                conversation_persistence.Thread.id == thread_id,
                conversation_persistence.Thread.project_id == project_id,
            )
        )
        return result.scalar_one_or_none()


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


def _project_not_empty_error() -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={"code": "project_not_empty", "message": "Project already has files"},
    )


def _zip_http_error(code: str, message: str, status_code: int = 400) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


def _normalised_zip_paths(entries: list[zipfile.ZipInfo], *, max_files: int) -> list[str]:
    if len(entries) > max_files:
        raise _zip_http_error(
            "zip_too_many_files",
            f"Zip archive exceeds maximum file count ({max_files})",
            status_code=413,
        )
    paths = [_normalise_zip_name(info.filename) for info in entries]
    if paths:
        return paths
    raise _zip_http_error("zip_empty", "Zip archive has no importable files")


def _decode_zip_entries(
    zf: zipfile.ZipFile,
    raw_entries: list[zipfile.ZipInfo],
    relative_paths: list[str],
    *,
    max_uncompressed_bytes: int,
) -> list[tuple[str, str]]:
    decoded: list[tuple[str, str]] = []
    total_uncompressed = 0
    for info, rel_path in zip(raw_entries, relative_paths, strict=True):
        total_uncompressed += max(int(info.file_size or 0), 0)
        if total_uncompressed > max_uncompressed_bytes:
            raise _zip_http_error(
                "zip_uncompressed_too_large",
                f"Zip archive exceeds maximum uncompressed size ({max_uncompressed_bytes} bytes)",
                status_code=413,
            )
        try:
            text = zf.read(info).decode("utf-8")
        except UnicodeDecodeError as exc:
            raise _zip_http_error("zip_non_utf8", f"File '{rel_path}' is not valid UTF-8 text") from exc
        decoded.append((f"/{rel_path}", text))
    return decoded


def _extract_zip_entries(
    archive_bytes: bytes,
    *,
    max_files: int,
    max_uncompressed_bytes: int,
) -> list[tuple[str, str]]:
    try:
        with zipfile.ZipFile(io.BytesIO(archive_bytes), mode="r") as zf:
            raw_entries = [
                info
                for info in zf.infolist()
                if not info.is_dir() and info.filename and not info.filename.endswith("/")
            ]
            return _decode_zip_entries(
                zf,
                raw_entries,
                _normalised_zip_paths(raw_entries, max_files=max_files),
                max_uncompressed_bytes=max_uncompressed_bytes,
            )
    except zipfile.BadZipFile as exc:
        raise _zip_http_error("zip_invalid", "Uploaded file is not a valid zip archive") from exc
    except ValueError as exc:
        raise _zip_http_error("zip_invalid_path", str(exc)) from exc


def _write_imported_files(project_id: str, decoded_entries: list[tuple[str, str]]) -> None:
    for path, content in decoded_entries:
        identity_project_service.write_text(project_id, path, content)


async def _read_upload_bytes_limited(file: UploadFile, *, max_bytes: int) -> bytes:
    total = 0
    chunks: list[bytes] = []
    while True:
        chunk = await file.read(_UPLOAD_CHUNK_SIZE)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise _zip_http_error(
                "zip_too_large",
                f"Zip archive exceeds maximum size ({max_bytes} bytes)",
                status_code=413,
            )
        chunks.append(chunk)
    return b"".join(chunks)


def _file_url_signature(project_id: str, virtual_path: str, expires: int) -> str:
    payload = f"{project_id}:{virtual_path}:{expires}".encode("utf-8")
    secret = settings.file_url_signing_secret.encode("utf-8")
    return hmac.new(secret, payload, hashlib.sha256).hexdigest()


def _verify_file_url_signature(project_id: str, virtual_path: str, expires: int, sig: str) -> bool:
    expected = _file_url_signature(project_id, virtual_path, expires)
    return hmac.compare_digest(expected, sig)


@router.get("/api/projects")
async def list_projects(
    user: identity_project_persistence.User = Depends(auth_deps.require_current_user),
) -> dict:
    async with identity_project_persistence.get_session() as session:
        result = await session.execute(
            select(identity_project_persistence.Project)
            .where(identity_project_persistence.Project.user_id == user.id)
            .order_by(identity_project_persistence.Project.created_at)
        )
        projects = result.scalars().all()
    return {"projects": [project_to_dict(project) for project in projects]}


@router.post("/api/projects")
async def create_project(
    body: ProjectCreate,
    user: identity_project_persistence.User = Depends(auth_deps.require_current_user),
) -> dict:
    project_id = str(uuid.uuid4())
    project = identity_project_persistence.Project(
        id=project_id,
        user_id=user.id,
        name=body.name.strip() or "Untitled Project",
        provider=body.provider,
    )
    async with identity_project_persistence.get_session() as session:
        session.add(project)

    return {
        "id": project_id,
        "name": project.name,
        "provider": project.provider,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }


@router.delete("/api/projects/{project_id}")
async def delete_project(
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    async with identity_project_persistence.get_session() as session:
        owned = await session.get(identity_project_persistence.Project, project.id)
        if owned is None:
            raise HTTPException(status_code=404, detail="Project not found")
        await session.delete(owned)
    identity_project_service.delete_project_dir(project.id)
    identity_project_service.invalidate_project_agent(project.id)
    return {"ok": True}


@router.get("/api/projects/{project_id}/credentials")
async def get_credentials(
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    creds = identity_project_service.parse_credentials(project.credentials)
    return _credentials_payload(project, creds)


@router.put("/api/projects/{project_id}/credentials")
async def update_credentials(
    body: CredentialsUpdate,
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    async with identity_project_persistence.get_session() as session:
        owned = await session.get(identity_project_persistence.Project, project.id)
        if owned is None:
            raise HTTPException(status_code=404, detail="Project not found")
        existing = identity_project_service.parse_credentials(owned.credentials)
        merged = merge_credentials(existing, body.credentials)
        owned.credentials = json.dumps(merged)

    identity_project_service.invalidate_project_agent(project.id)
    return _credentials_payload(project, merged)


@router.get("/api/projects/{project_id}/threads")
async def list_threads(
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    async with conversation_persistence.get_session() as session:
        result = await session.execute(
            select(conversation_persistence.Thread)
            .where(conversation_persistence.Thread.project_id == project.id)
            .order_by(conversation_persistence.Thread.created_at)
        )
        threads = result.scalars().all()
    return {"threads": [thread_to_dict(thread) for thread in threads]}


@router.post("/api/projects/{project_id}/threads")
async def create_thread(
    body: ThreadCreate,
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    response_title = body.title
    async with conversation_persistence.get_session() as session:
        existing = await session.get(conversation_persistence.Thread, body.id)
        if existing is None:
            thread = conversation_persistence.Thread(id=body.id, project_id=project.id, title=body.title)
            session.add(thread)
        else:
            if existing.project_id != project.id:
                raise HTTPException(status_code=409, detail="Thread ID already exists for another project")
            if body.title and body.title != existing.title:
                existing.title = body.title
            response_title = existing.title
    return {
        "id": body.id,
        "title": response_title,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }


@router.delete("/api/projects/{project_id}/threads/{thread_id}")
async def delete_thread(
    thread_id: str,
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    async with conversation_persistence.get_session() as session:
        await session.execute(
            delete(conversation_persistence.Thread).where(
                conversation_persistence.Thread.id == thread_id,
                conversation_persistence.Thread.project_id == project.id,
            )
        )
    return {"ok": True}


@router.get("/api/projects/{project_id}/threads/{thread_id}/messages")
async def list_thread_messages(
    thread_id: str,
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    thread = await _load_owned_thread(project.id, thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail="Thread not found")
    async with conversation_persistence.get_session() as session:
        result = await session.execute(
            select(conversation_persistence.ThreadMessage)
            .where(conversation_persistence.ThreadMessage.thread_id == thread_id)
            .order_by(conversation_persistence.ThreadMessage.created_at)
        )
        rows = result.scalars().all()
    messages = [row.payload_json for row in rows if isinstance(row.payload_json, dict)]
    head_id = rows[-1].message_id if rows else None
    return {"headId": head_id, "messages": messages}


@router.post("/api/projects/{project_id}/threads/{thread_id}/messages")
async def append_thread_message(
    thread_id: str,
    body: ThreadMessageUpsert,
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    thread = await _load_owned_thread(project.id, thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail="Thread not found")
    message_id = _extract_message_id(body.item)
    async with conversation_persistence.get_session() as session:
        result = await session.execute(
            select(conversation_persistence.ThreadMessage).where(
                conversation_persistence.ThreadMessage.thread_id == thread_id,
                conversation_persistence.ThreadMessage.message_id == message_id,
            )
        )
        existing = result.scalar_one_or_none()
        if existing is None:
            session.add(
                conversation_persistence.ThreadMessage(
                    id=str(uuid.uuid4()),
                    thread_id=thread_id,
                    message_id=message_id,
                    payload_json=body.item,
                )
            )
        else:
            existing.payload_json = body.item
    return {"ok": True}


@router.get("/api/projects/{project_id}/memory")
async def get_memory(
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    try:
        content = identity_project_service.read_text(project.id, "/AGENT.md")
    except FileNotFoundError:
        content = identity_project_service.DEFAULT_AGENT_MD
    return {"content": content}


@router.put("/api/projects/{project_id}/memory")
async def update_memory(
    body: MemoryUpdate,
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    identity_project_service.write_text(project.id, "/AGENT.md", body.content)
    identity_project_service.invalidate_project_agent(project.id)
    return {"ok": True}


@router.get("/api/projects/{project_id}/files/signed-url")
async def create_file_signed_url(
    path: str,
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    try:
        normalised = identity_project_service.normalize_virtual_path(path)
        identity_project_service.read_bytes(project.id, normalised)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"File '{path}' not found")

    expires_at = int(time.time()) + max(settings.file_url_ttl_seconds, 30)
    sig = _file_url_signature(project.id, normalised, expires_at)
    query = urlencode({"path": normalised, "expires": expires_at, "sig": sig})
    return {"url": f"/api/projects/{project.id}/files/public?{query}", "expires_at": expires_at}


@router.get("/api/projects/{project_id}/files/public")
async def read_file_public(
    project_id: str,
    path: str,
    expires: int,
    sig: str,
) -> Response:
    if expires < int(time.time()):
        raise HTTPException(status_code=403, detail="Signed URL expired")
    try:
        normalised = identity_project_service.normalize_virtual_path(path)
        if not _verify_file_url_signature(project_id, normalised, expires, sig):
            raise HTTPException(status_code=403, detail="Invalid signed URL")
        content = identity_project_service.read_bytes(project_id, normalised)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"File '{path}' not found")

    media_type = mimetypes.guess_type(normalised)[0] or "application/octet-stream"
    return Response(content=content, media_type=media_type, headers={"Cache-Control": "no-store"})


@router.get("/api/projects/{project_id}/files")
async def list_files(
    response: Response,
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    response.headers["Cache-Control"] = "no-store"
    return {"files": identity_project_service.list_files(project.id)}


@router.get("/api/projects/{project_id}/files/content")
async def read_file_content(
    path: str,
    response: Response,
    raw: bool = False,
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> Response:
    try:
        normalised = identity_project_service.normalize_virtual_path(path)
        if raw:
            content = identity_project_service.read_bytes(project.id, normalised)
        else:
            content = identity_project_service.read_text(project.id, normalised)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"File '{path}' not found")
    except UnicodeDecodeError:
        raise HTTPException(status_code=415, detail=f"File '{path}' is binary. Use raw=true.")

    if raw:
        media_type = mimetypes.guess_type(normalised)[0] or "application/octet-stream"
        return Response(content=content, media_type=media_type, headers={"Cache-Control": "no-store"})

    return JSONResponse(content={"path": normalised, "content": content}, headers={"Cache-Control": "no-store"})


@router.get("/api/projects/{project_id}/files/raw")
async def read_file_raw(
    path: str,
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> Response:
    try:
        normalised = identity_project_service.normalize_virtual_path(path)
        content = identity_project_service.read_bytes(project.id, normalised)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"File '{path}' not found")

    media_type = mimetypes.guess_type(normalised)[0] or "application/octet-stream"
    return Response(content=content, media_type=media_type, headers={"Cache-Control": "no-store"})


@router.put("/api/projects/{project_id}/files/content")
async def write_file_content(
    body: FileWriteBody,
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    try:
        path = identity_project_service.write_text(project.id, body.path, body.content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    identity_project_service.invalidate_project_agent(project.id)
    return {"ok": True, "path": path}


@router.delete("/api/projects/{project_id}/files/content")
async def delete_file_content(
    path: str,
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    try:
        normalised = identity_project_service.delete_file(project.id, path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"File '{path}' not found")
    identity_project_service.invalidate_project_agent(project.id)
    return {"ok": True, "path": normalised}


@router.post("/api/projects/{project_id}/files/move")
async def move_file_paths(
    body: FileMoveBody,
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    try:
        moved = identity_project_service.move_paths(project.id, body.source_paths, body.destination_dir)
    except identity_project_service.MoveConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    identity_project_service.invalidate_project_agent(project.id)
    return {"ok": True, "moved": moved}


@router.post("/api/projects/{project_id}/files/rename")
async def rename_file_path(
    body: FileRenameBody,
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    try:
        moved = identity_project_service.rename_path(project.id, body.path, body.new_name)
    except identity_project_service.MoveConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    identity_project_service.invalidate_project_agent(project.id)
    return {"ok": True, "moved": moved}


@router.post("/api/projects/{project_id}/files/import-zip")
async def import_zip_file(
    file: UploadFile = File(...),
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    if identity_project_service.list_files(project.id):
        raise _project_not_empty_error()
    archive_bytes = await _read_upload_bytes_limited(
        file,
        max_bytes=max(settings.zip_import_max_bytes, 1),
    )
    decoded_entries = _extract_zip_entries(
        archive_bytes,
        max_files=max(settings.zip_import_max_files, 1),
        max_uncompressed_bytes=max(settings.zip_import_max_uncompressed_bytes, 1),
    )
    _write_imported_files(project.id, decoded_entries)
    identity_project_service.invalidate_project_agent(project.id)
    return {"ok": True, "imported_files": len(decoded_entries)}


@router.get("/api/projects/{project_id}/files/export.zip")
async def export_project_zip(
    project: identity_project_persistence.Project = Depends(auth_deps.get_owned_project_or_404),
) -> StreamingResponse:
    root = identity_project_service.ensure_project_dir(project.id)
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
