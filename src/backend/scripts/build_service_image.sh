#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "usage: $0 <service-name> [image-tag]" >&2
  exit 1
fi

service_name="$1"
image_tag="${2:-deepagents/${service_name}:latest}"

case "$service_name" in
  gateway)
    service_dir="gateway"
    service_package="gateway_service"
    ;;
  identity-project)
    service_dir="identity-project"
    service_package="identity_project_service"
    ;;
  conversation)
    service_dir="conversation"
    service_package="conversation_service"
    ;;
  workflow)
    service_dir="workflow"
    service_package="workflow_service"
    ;;
  provisioning)
    service_dir="provisioning"
    service_package="provisioning_service"
    ;;
  configuration-incident)
    service_dir="configuration-incident"
    service_package="configuration_incident_service"
    ;;
  scm)
    service_dir="scm"
    service_package="scm_service"
    ;;
  *)
    echo "unknown service: $service_name" >&2
    exit 1
    ;;
esac

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
backend_root="$(cd "${script_dir}/.." && pwd)"

docker build \
  -f "${backend_root}/services/Dockerfile.service" \
  --build-arg "SERVICE_DIR=${service_dir}" \
  --build-arg "SERVICE_PACKAGE=${service_package}" \
  -t "${image_tag}" \
  "${backend_root}"

echo "built ${image_tag}"
