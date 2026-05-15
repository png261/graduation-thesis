"""Repository-safe wrapper for the generic strands diagram tool."""

from __future__ import annotations

import os
import json
import mimetypes
import re
from pathlib import Path
from typing import Any, Dict, List, Union

from strands import tool
from strands_tools.diagram import diagram as strands_diagram

from agents.artifacts import session_artifact_dir


def _shared_files_object_key(file_path: Path) -> str:
    mount_path = Path(
        os.environ.get("SHARED_FILES_ACTIVE_PATH")
        or os.environ.get("SHARED_FILES_MOUNT_PATH", "/mnt/s3")
    ).resolve()
    bucket_prefix = os.environ.get("SHARED_FILES_BUCKET_PREFIX", "").strip("/")
    root_directory = os.environ.get("SHARED_FILES_ROOT_DIRECTORY", "").strip("/")
    resolved_path = file_path.resolve()
    try:
        relative_path = resolved_path.relative_to(mount_path)
    except ValueError:
        return ""
    relative_key = relative_path.as_posix().lstrip("/")
    if root_directory:
        relative_key = f"{root_directory}/{relative_key}".strip("/")
    return f"{bucket_prefix}/{relative_key}".strip("/") if bucket_prefix else relative_key


def _presigned_image_url(file_path: Path, mime_type: str | None) -> tuple[str, str, int | None]:
    bucket_name = os.environ.get("SHARED_FILES_BUCKET_NAME", "").strip()
    if not bucket_name:
        return "", "", None

    object_key = _shared_files_object_key(file_path)
    if not object_key:
        return "", "", None

    try:
        import boto3

        expires_in = int(os.environ.get("DIAGRAM_URL_EXPIRES_IN", "3600"))
        s3_client = boto3.client("s3")
        extra_args: dict[str, Any] | None = {"ContentType": mime_type} if mime_type else None
        if extra_args:
            s3_client.upload_file(str(file_path), bucket_name, object_key, ExtraArgs=extra_args)
        else:
            s3_client.upload_file(str(file_path), bucket_name, object_key)
        params: dict[str, Any] = {"Bucket": bucket_name, "Key": object_key}
        if mime_type:
            params["ResponseContentType"] = mime_type
        url = s3_client.generate_presigned_url("get_object", Params=params, ExpiresIn=expires_in)
        return url, object_key, expires_in
    except Exception:
        return "", object_key, None


def _diagram_output_dir() -> Path:
    return session_artifact_dir(os.environ.get("SHARED_FILES_SESSION_ID", "agentcore"), "generic-diagrams")


def _diagram_path_from_result(result: str) -> Path | None:
    match = re.search(r":\s*(/[^\\n]+)$", result.strip())
    if not match:
        return None
    path = Path(match.group(1).strip())
    return path if path.exists() and path.is_file() else None


@tool
def diagram(
    diagram_type: str,
    nodes: List[Dict[str, str]] = None,
    edges: List[Dict[str, Union[str, int]]] = None,
    output_format: str = "png",
    title: str = "diagram",
    style: Dict[str, str] = None,
    elements: List[Dict[str, str]] = None,
    relationships: List[Dict[str, Union[str, int]]] = None,
    open_diagram_flag: bool = False,
) -> str:
    """Create a generic diagram while keeping generated files outside the repository."""
    previous_cwd = os.getcwd()
    workdir = _diagram_output_dir()
    try:
        os.chdir(workdir)
        result = strands_diagram(
            diagram_type=diagram_type,
            nodes=nodes,
            edges=edges,
            output_format=output_format,
            title=title,
            style=style,
            elements=elements,
            relationships=relationships,
            open_diagram_flag=open_diagram_flag,
        )
        image_path = _diagram_path_from_result(str(result))
        if not image_path:
            return str(result)
        mime_type = mimetypes.guess_type(image_path.name)[0] or f"image/{output_format}"
        public_url, object_key, expires_in = _presigned_image_url(image_path, mime_type)
        return json.dumps(
            {
                "ok": True,
                "public_url": public_url,
                "public_url_expires_in": expires_in,
                "image_key": object_key,
                "image_path": str(image_path),
                "mime_type": mime_type,
                "result": str(result),
            },
            indent=2,
        )
    finally:
        os.chdir(previous_cwd)
