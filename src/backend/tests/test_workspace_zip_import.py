from __future__ import annotations

import io
import zipfile

import pytest
from fastapi import HTTPException

from app.routers.projects_routes import project_workspace


def make_zip(entries: dict[str, str]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path, content in entries.items():
            zf.writestr(path, content)
    return buffer.getvalue()


def test_extract_zip_entries_rejects_too_many_files() -> None:
    archive = make_zip({"a.txt": "a", "b.txt": "b"})
    with pytest.raises(HTTPException) as exc:
        project_workspace._extract_zip_entries(
            archive,
            max_files=1,
            max_uncompressed_bytes=1024,
        )
    assert exc.value.status_code == 413
    assert exc.value.detail["code"] == "zip_too_many_files"


def test_extract_zip_entries_rejects_uncompressed_limit() -> None:
    archive = make_zip({"big.txt": "x" * 40})
    with pytest.raises(HTTPException) as exc:
        project_workspace._extract_zip_entries(
            archive,
            max_files=10,
            max_uncompressed_bytes=10,
        )
    assert exc.value.status_code == 413
    assert exc.value.detail["code"] == "zip_uncompressed_too_large"
