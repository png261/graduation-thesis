"""Tools for rendering AWS architecture diagrams with awsdac MCP."""

from __future__ import annotations

import json
import os
import re
import shlex
import uuid
from collections.abc import Callable
from datetime import timedelta
from pathlib import Path
from typing import Any

from mcp.client.stdio import StdioServerParameters, stdio_client
from strands import tool
from strands.tools.mcp import MCPClient


def _safe_stem(value: str) -> str:
    stem = re.sub(r"[^a-zA-Z0-9._-]+", "-", value.strip()).strip(".-")
    return stem[:80] or "architecture-diagram"


def _collect_text(value: Any) -> list[str]:
    chunks: list[str] = []
    if isinstance(value, str):
        chunks.append(value)
    elif isinstance(value, dict):
        for key in ("stdout", "stderr", "text"):
            if isinstance(value.get(key), str):
                chunks.append(value[key])
        for item in value.values():
            chunks.extend(_collect_text(item))
    elif isinstance(value, list):
        for item in value:
            chunks.extend(_collect_text(item))
    return chunks


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
        extra_args = {"ContentType": mime_type} if mime_type else None
        if extra_args:
            s3_client.upload_file(str(file_path), bucket_name, object_key, ExtraArgs=extra_args)
        else:
            s3_client.upload_file(str(file_path), bucket_name, object_key)
        params: dict[str, Any] = {"Bucket": bucket_name, "Key": object_key}
        if mime_type:
            params["ResponseContentType"] = mime_type
        url = s3_client.generate_presigned_url(
            "get_object",
            Params=params,
            ExpiresIn=expires_in,
        )
        return url, object_key, expires_in
    except Exception:
        return "", object_key, None


def _default_awsdac_mcp_client() -> MCPClient:
    bundled_command = Path(__file__).resolve().parents[1] / "bin" / "awsdac-mcp-server"
    command = os.environ.get(
        "AWSDAC_MCP_SERVER_COMMAND",
        str(bundled_command) if bundled_command.exists() else "awsdac-mcp-server",
    )
    args = shlex.split(os.environ.get("AWSDAC_MCP_SERVER_ARGS", ""))
    return MCPClient(
        lambda: stdio_client(
            StdioServerParameters(
                command=command,
                args=args,
            )
        ),
        prefix="awsdac",
    )


def _mcp_result_text(result: Any) -> str:
    return "\n".join(_collect_text(result)).strip()


def _call_generate_diagram_to_file(
    mcp_client_factory: Callable[[], MCPClient],
    yaml_content: str,
    output_file_path: Path,
) -> None:
    with mcp_client_factory() as client:
        result = client.call_tool_sync(
            tool_use_id=f"render-architecture-diagram-{uuid.uuid4().hex}",
            name="generateDiagramToFile",
            arguments={
                "yamlContent": yaml_content,
                "outputFilePath": str(output_file_path),
            },
            read_timeout_seconds=timedelta(seconds=int(os.environ.get("AWSDAC_MCP_TIMEOUT_SECONDS", "120"))),
        )

    if result.get("status") == "error" or result.get("isError"):
        detail = _mcp_result_text(result) or "awsdac MCP generateDiagramToFile failed"
        raise RuntimeError(detail)


def create_architecture_diagram_tool(
    mcp_client_factory: Callable[[], MCPClient] | None = None,
):
    """Create a tool that renders Diagram-as-Code YAML through awsdac MCP."""

    client_factory = mcp_client_factory or _default_awsdac_mcp_client

    @tool
    def render_architecture_diagram(
        diagram_yaml: str,
        output_basename: str = "architecture-diagram",
    ) -> str:
        """
        Render an AWS architecture diagram using awsdac Diagram-as-Code YAML.

        The YAML must follow the awslabs diagram-as-code format from
        https://github.com/awslabs/diagram-as-code/blob/main/doc/mcp-server.md:
        include a `Diagram:` root, `DefinitionFiles`, `Resources`, and a Canvas
        resource reachable from the root. Use AWS icon definitions such as
        https://raw.githubusercontent.com/awslabs/diagram-as-code/main/definitions/definition-for-aws-icons-light.yaml.
        The required structure is:

        Diagram:
          DefinitionFiles:
            - Type: URL
              Url: https://raw.githubusercontent.com/awslabs/diagram-as-code/main/definitions/definition-for-aws-icons-light.yaml
          Resources:
            Canvas:
              Type: AWS::Diagram::Canvas
              Children:
                - AWSCloud
            AWSCloud:
              Type: AWS::Diagram::Cloud
              Preset: AWSCloudNoLogo
              Children:
                - VPC
            VPC:
              Type: AWS::EC2::VPC
              Children:
                - PrivateSubnet
                - PublicSubnet
            PrivateSubnet:
              Type: AWS::EC2::Subnet
              Children:
                - EC2Instance
            PublicSubnet:
              Type: AWS::EC2::Subnet
            EC2Instance:
              Type: AWS::EC2::Instance
          Links: []

        Keep each resource reachable from exactly one parent. Do not include a Region
        resource unless it is a real resource defined in the diagram, and do not list
        the same child in both a VPC and one of its subnets.

        Args:
            diagram_yaml: Complete Diagram-as-Code YAML to pass to awsdac MCP.
            output_basename: Base filename to use when saving the YAML source and PNG image.

        Returns:
            JSON with saved file paths and a public HTTPS URL for chat visualization.
        """
        if "Diagram:" not in diagram_yaml or "Resources:" not in diagram_yaml:
            raise ValueError("diagram_yaml must be a complete diagram-as-code YAML document")

        stem = _safe_stem(output_basename)
        output_dir = Path.cwd() / "architecture-diagrams"
        output_dir.mkdir(parents=True, exist_ok=True)
        source_path = output_dir / f"{stem}.yaml"
        image_path = output_dir / f"{stem}.png"
        source_path.write_text(diagram_yaml, encoding="utf-8")
        try:
            if image_path.exists():
                image_path.unlink()
        except OSError:
            pass

        render_warning = ""
        try:
            _call_generate_diagram_to_file(client_factory, diagram_yaml, image_path)
        except Exception as exc:
            if not image_path.exists() or image_path.stat().st_size <= 0:
                return json.dumps(
                    {
                        "ok": False,
                        "error": f"{type(exc).__name__}: {exc}",
                        "source_path": str(source_path),
                    },
                    indent=2,
                )
            render_warning = f"{type(exc).__name__}: {exc}"

        if not image_path.exists() or image_path.stat().st_size <= 0:
            return json.dumps(
                {
                    "ok": False,
                    "error": "awsdac MCP did not create a non-empty diagram image",
                    "source_path": str(source_path),
                    "image_path": str(image_path),
                },
                indent=2,
            )

        mime_type = "image/png"
        public_url, object_key, expires_in = _presigned_image_url(image_path, mime_type)
        saved_files = [
            {"path": str(source_path), "type": "source", "mime_type": "application/x-yaml"},
            {"path": str(image_path), "type": "image", "mime_type": mime_type},
        ]

        return json.dumps(
            {
                "ok": True,
                "source_path": str(source_path),
                "image_path": str(image_path),
                "image_key": object_key,
                "mime_type": mime_type,
                "public_url": public_url,
                "public_url_expires_in": expires_in,
                "warning": render_warning,
                "saved_files": saved_files,
            },
            indent=2,
        )

    return render_architecture_diagram
