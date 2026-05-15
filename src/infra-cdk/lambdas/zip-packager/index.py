"""
Lambda function to package agent code for ZIP deployment.

Downloads ARM64 wheels, extracts them, bundles with agent code,
and uploads to S3. Triggered as a CloudFormation Custom Resource.
"""

import json
import logging
import os
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile
from pathlib import Path

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3 = boto3.client("s3")

GITHUB_API = "https://api.github.com/repos"


def send_response(
    event: dict,
    context,
    status: str,
    reason: str = "",
    physical_resource_id: str = None,
) -> None:
    """
    Send response to CloudFormation.

    Args:
        event: CloudFormation event.
        context: Lambda context.
        status: SUCCESS or FAILED.
        reason: Reason for failure.
        physical_resource_id: Physical resource ID.
    """
    response_body = json.dumps(
        {
            "Status": status,
            "Reason": reason or f"See CloudWatch Log Stream: {context.log_stream_name}",
            "PhysicalResourceId": physical_resource_id or context.log_stream_name,
            "StackId": event["StackId"],
            "RequestId": event["RequestId"],
            "LogicalResourceId": event["LogicalResourceId"],
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        event["ResponseURL"],
        data=response_body,
        headers={"Content-Type": "application/json"},
        method="PUT",
    )
    urllib.request.urlopen(  # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected  # nosec B310 B113 — URL is the CloudFormation pre-signed ResponseURL, not user-controlled
        req
    )


def download_wheels(requirements: list[str], download_dir: Path) -> None:
    """
    Download ARM64 Linux wheels for the given requirements.

    Args:
        requirements: List of package specifiers.
        download_dir: Directory to download wheels to.
    """
    logger.info(f"Downloading wheels for: {requirements}")

    # Write requirements to temp file
    req_file = download_dir / "requirements.txt"
    req_file.write_text("\n".join(requirements))

    subprocess.run(
        [
            sys.executable,
            "-m",
            "pip",
            "download",
            "-r",
            str(req_file),
            "--platform",
            "manylinux2014_aarch64",
            "--python-version",
            "312",
            "--only-binary=:all:",
            "-d",
            str(download_dir),
            "--quiet",
        ],
        check=True,
    )

    # Also download OpenTelemetry
    subprocess.run(
        [
            sys.executable,
            "-m",
            "pip",
            "download",
            "aws-opentelemetry-distro",
            "--platform",
            "manylinux2014_aarch64",
            "--python-version",
            "312",
            "--only-binary=:all:",
            "-d",
            str(download_dir),
            "--quiet",
        ],
        check=True,
    )


def extract_wheels(download_dir: Path, package_dir: Path) -> None:
    """
    Extract all wheel files to the package directory.

    Args:
        download_dir: Directory containing wheel files.
        package_dir: Directory to extract to.
    """
    for wheel in download_dir.glob("*.whl"):
        logger.info(f"Extracting: {wheel.name}")
        with zipfile.ZipFile(wheel, "r") as whl:
            whl.extractall(package_dir)


def create_otel_wrapper(package_dir: Path) -> None:
    """
    Create the opentelemetry-instrument wrapper script.

    Args:
        package_dir: Root package directory.
    """
    bin_dir = package_dir / "bin"
    bin_dir.mkdir(exist_ok=True)

    script = bin_dir / "opentelemetry-instrument"
    script.write_text(
        "#!/usr/bin/env python3\n"
        "from opentelemetry.instrumentation.auto_instrumentation import run\n"
        "run()\n"
    )


def create_python_console_wrapper(package_dir: Path, command_name: str, module_name: str, function_name: str) -> None:
    """
    Create a console script wrapper for a Python module entry point.

    Wheels are extracted directly into the runtime ZIP, so pip-generated console
    scripts are not available unless we create the specific wrappers we need.
    """
    bin_dir = package_dir / "bin"
    bin_dir.mkdir(exist_ok=True)

    script = bin_dir / command_name
    script.write_text(
        "#!/usr/bin/env python3\n"
        f"from {module_name} import {function_name}\n"
        f"{function_name}()\n"
    )
    script.chmod(0o755)


def latest_github_asset_url(repo: str, asset_fragments: list[str]) -> str:
    url = f"{GITHUB_API}/{repo}/releases/latest"
    request = urllib.request.Request(url, headers={"User-Agent": "infraq-zip-packager"})
    with urllib.request.urlopen(request) as response:  # nosec B310 - fixed GitHub API URL
        payload = json.loads(response.read().decode("utf-8"))
    for asset in payload.get("assets", []):
        name = asset.get("name", "")
        if all(fragment in name for fragment in asset_fragments):
            download_url = asset.get("browser_download_url")
            if download_url:
                return download_url
    raise RuntimeError(f"No release asset found for {repo} matching {asset_fragments}")


def install_zip_binary(download_url: str, binary_name: str, package_dir: Path, download_dir: Path) -> None:
    archive_path = download_dir / f"{binary_name}.zip"
    logger.info(f"Downloading {binary_name} from {download_url}")
    urllib.request.urlretrieve(download_url, archive_path)  # nosec B310 - URL comes from GitHub release metadata

    bin_dir = package_dir / "bin"
    bin_dir.mkdir(exist_ok=True)
    target_path = bin_dir / binary_name

    with zipfile.ZipFile(archive_path, "r") as archive:
        candidates = [
            name
            for name in archive.namelist()
            if Path(name).name == binary_name and not name.endswith("/")
        ]
        if not candidates:
            raise RuntimeError(f"{binary_name} binary not found in release archive")
        target_path.write_bytes(archive.read(candidates[0]))

    target_path.chmod(0o755)


def install_tar_binary(download_url: str, binary_name: str, package_dir: Path, download_dir: Path) -> None:
    archive_path = download_dir / f"{binary_name}.tar.gz"
    logger.info(f"Downloading {binary_name} from {download_url}")
    urllib.request.urlretrieve(download_url, archive_path)  # nosec B310 - URL comes from GitHub release metadata

    bin_dir = package_dir / "bin"
    bin_dir.mkdir(exist_ok=True)
    target_path = bin_dir / binary_name

    with tarfile.open(archive_path, "r:gz") as archive:
        candidates = [
            member
            for member in archive.getmembers()
            if member.isfile() and Path(member.name).name.startswith(binary_name)
        ]
        if not candidates:
            raise RuntimeError(f"{binary_name} binary not found in release archive")
        source = archive.extractfile(candidates[0])
        if source is None:
            raise RuntimeError(f"Could not extract {binary_name} from release archive")
        target_path.write_bytes(source.read())

    target_path.chmod(0o755)


def install_infra_cli_tools(package_dir: Path, download_dir: Path) -> None:
    install_zip_binary(
        latest_github_asset_url("opentofu/opentofu", ["linux_arm64", ".zip"]),
        "tofu",
        package_dir,
        download_dir,
    )
    install_zip_binary(
        latest_github_asset_url("terraform-linters/tflint", ["linux_arm64", ".zip"]),
        "tflint",
        package_dir,
        download_dir,
    )
    install_tar_binary(
        latest_github_asset_url("infracost/infracost", ["linux-arm64", ".tar.gz"]),
        "infracost",
        package_dir,
        download_dir,
    )


def create_deployment_zip(package_dir: Path, output_path: Path) -> None:
    """
    Create the deployment ZIP file with proper permissions.

    Args:
        package_dir: Directory to zip.
        output_path: Output ZIP file path.
    """
    logger.info(f"Creating deployment ZIP: {output_path}")

    with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(package_dir):
            # Add directories
            for dir_name in dirs:
                dir_path = Path(root) / dir_name
                arcname = str(dir_path.relative_to(package_dir)) + "/"
                info = zipfile.ZipInfo(arcname)
                info.external_attr = 0o755 << 16
                zipf.writestr(info, "")

            # Add files
            for file_name in files:
                file_path = Path(root) / file_name
                arcname = str(file_path.relative_to(package_dir))
                info = zipfile.ZipInfo(arcname)
                # Executables in bin/ get 755, others get 644
                if arcname.startswith("bin/"):
                    info.external_attr = 0o755 << 16
                else:
                    info.external_attr = 0o644 << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                zipf.writestr(info, file_path.read_bytes())


def handler(event: dict, context) -> None:
    """
    Lambda handler for Custom Resource.

    Args:
        event: CloudFormation Custom Resource event.
        context: Lambda context.
    """
    logger.info(f"Event: {json.dumps(event)}")

    request_type = event["RequestType"]
    props = event["ResourceProperties"]

    # On Delete, just succeed since there's nothing to clean up. The bucket handles its own cleanup.
    if request_type == "Delete":
        send_response(event, context, "SUCCESS")
        return

    try:
        bucket_name = props["BucketName"]
        object_key = props["ObjectKey"]
        requirements = props["Requirements"]
        agent_code = props["AgentCode"]

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            download_dir = tmp_path / "wheels"
            package_dir = tmp_path / "package"
            download_dir.mkdir()
            package_dir.mkdir()

            # Download and extract wheels
            download_wheels(requirements, download_dir)
            extract_wheels(download_dir, package_dir)

            # Create OpenTelemetry wrapper
            create_otel_wrapper(package_dir)

            # Install CLI tools used by specialized infrastructure agents
            install_infra_cli_tools(package_dir, download_dir)

            # Write agent code files
            import base64

            for filename, content_b64 in agent_code.items():
                file_path = package_dir / filename
                file_path.parent.mkdir(parents=True, exist_ok=True)
                file_path.write_bytes(base64.b64decode(content_b64))

            # Create ZIP
            zip_path = tmp_path / "deployment_package.zip"
            create_deployment_zip(package_dir, zip_path)

            # Upload to S3
            logger.info(f"Uploading to s3://{bucket_name}/{object_key}")
            s3.upload_file(str(zip_path), bucket_name, object_key)

        send_response(
            event,
            context,
            "SUCCESS",
            physical_resource_id=f"{bucket_name}/{object_key}",
        )

    except Exception as e:
        logger.exception("Failed to package agent")
        send_response(event, context, "FAILED", reason=str(e))
