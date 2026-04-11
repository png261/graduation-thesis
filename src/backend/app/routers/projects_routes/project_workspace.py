"""Project memory and project file endpoints."""

from __future__ import annotations

import hashlib
import hmac
import io
import mimetypes
import re
import time
import zipfile
from pathlib import PurePosixPath
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from app.core.config import get_settings
from app.models import Project
from app.routers import auth_dependencies as auth_deps
from app.services.agent import invalidate_agent
from app.services.project import files as project_files

router = APIRouter()
settings = get_settings()
_UPLOAD_CHUNK_SIZE = 1024 * 1024


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
                ("Zip archive exceeds maximum uncompressed size " f"({max_uncompressed_bytes} bytes)"),
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
        project_files.write_text(project_id, path, content)


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


class FileWriteBody(BaseModel):
    path: str
    content: str


class FileMoveBody(BaseModel):
    source_paths: list[str]
    destination_dir: str


class FileRenameBody(BaseModel):
    path: str
    new_name: str


@router.get("/{project_id}/files/signed-url")
async def create_file_signed_url(
    path: str,
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    try:
        normalised = project_files.normalize_virtual_path(path)
        project_files.read_bytes(project.id, normalised)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"File '{path}' not found")

    expires_at = int(time.time()) + max(settings.file_url_ttl_seconds, 30)
    sig = _file_url_signature(project.id, normalised, expires_at)
    query = urlencode({"path": normalised, "expires": expires_at, "sig": sig})
    return {"url": f"/api/projects/{project.id}/files/public?{query}", "expires_at": expires_at}


@router.get("/{project_id}/files/public")
async def read_file_public(
    project_id: str,
    path: str,
    expires: int,
    sig: str,
) -> Response:
    if expires < int(time.time()):
        raise HTTPException(status_code=403, detail="Signed URL expired")
    try:
        normalised = project_files.normalize_virtual_path(path)
        if not _verify_file_url_signature(project_id, normalised, expires, sig):
            raise HTTPException(status_code=403, detail="Invalid signed URL")
        content = project_files.read_bytes(project_id, normalised)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"File '{path}' not found")

    media_type = mimetypes.guess_type(normalised)[0] or "application/octet-stream"
    return Response(content=content, media_type=media_type, headers={"Cache-Control": "no-store"})


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
    raw: bool = False,
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> Response:
    try:
        normalised = project_files.normalize_virtual_path(path)
        if raw:
            content = project_files.read_bytes(project.id, normalised)
        else:
            content = project_files.read_text(project.id, normalised)
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


@router.get("/{project_id}/files/raw")
async def read_file_raw(
    path: str,
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> Response:
    try:
        normalised = project_files.normalize_virtual_path(path)
        content = project_files.read_bytes(project.id, normalised)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"File '{path}' not found")

    media_type = mimetypes.guess_type(normalised)[0] or "application/octet-stream"
    return Response(content=content, media_type=media_type, headers={"Cache-Control": "no-store"})


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


@router.post("/{project_id}/files/move")
async def move_file_paths(
    body: FileMoveBody,
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    try:
        moved = project_files.move_paths(project.id, body.source_paths, body.destination_dir)
    except project_files.MoveConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    invalidate_agent(project.id)
    return {"ok": True, "moved": moved}


@router.post("/{project_id}/files/rename")
async def rename_file_path(
    body: FileRenameBody,
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    try:
        moved = project_files.rename_path(project.id, body.path, body.new_name)
    except project_files.MoveConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    invalidate_agent(project.id)
    return {"ok": True, "moved": moved}


@router.post("/{project_id}/files/import-zip")
async def import_zip_file(
    file: UploadFile = File(...),
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    if project_files.list_files(project.id):
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
