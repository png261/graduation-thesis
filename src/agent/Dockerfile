FROM golang:1.24-bookworm AS awsdac

RUN go install github.com/awslabs/diagram-as-code/cmd/awsdac-mcp-server@latest

FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

WORKDIR /app

ENV UV_SYSTEM_PYTHON=1 \
    UV_COMPILE_BYTECODE=1 \
    DOCKER_CONTAINER=1 \
    OTEL_PYTHON_LOG_CORRELATION=true \
    PYTHONUNBUFFERED=1

COPY agent/requirements.txt requirements.txt
RUN uv pip install --no-cache -r requirements.txt && \
    uv pip install --no-cache aws-opentelemetry-distro==0.16.0

RUN uv pip install --no-cache requests>=2.31.0

RUN apt-get update && \
    apt-get install -y --no-install-recommends bash ca-certificates curl gnupg jq unzip && \
    curl --proto '=https' --tlsv1.2 -fsSL https://get.opentofu.org/install-opentofu.sh -o install-opentofu.sh && \
    chmod +x install-opentofu.sh && \
    ./install-opentofu.sh --install-method deb && \
    rm -f install-opentofu.sh && \
    curl -s https://raw.githubusercontent.com/terraform-linters/tflint/master/install_linux.sh | bash && \
    curl -fsSL https://raw.githubusercontent.com/infracost/cli/master/scripts/install.sh | sh && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

RUN uv pip install --no-cache checkov && \
    uv pip install --no-cache boto3==1.43.7 botocore==1.43.7 s3transfer==0.17.0

COPY --from=awsdac /go/bin/awsdac-mcp-server /usr/local/bin/awsdac-mcp-server

RUN useradd -m -u 1000 bedrock_agentcore
USER bedrock_agentcore

EXPOSE 8080

COPY agent/main.py .
COPY agent/agents/ agents/
COPY agent/utils/ utils/

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/ping', timeout=2)" || exit 1

CMD ["opentelemetry-instrument", "python", "-m", "main"]
