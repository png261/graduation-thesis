FROM golang:1.24-bookworm AS awsdac

RUN go install github.com/awslabs/diagram-as-code/cmd/awsdac-mcp-server@latest

FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

WORKDIR /app

ENV UV_SYSTEM_PYTHON=1 \
    UV_COMPILE_BYTECODE=1 \
    DOCKER_CONTAINER=1 \
    OTEL_PYTHON_LOG_CORRELATION=true \
    PYTHONUNBUFFERED=1

COPY tools/ agentcore_tools/

COPY agent/requirements.txt requirements.txt
RUN uv pip install --no-cache -r requirements.txt && \
    uv pip install --no-cache aws-opentelemetry-distro==0.16.0

RUN uv pip install --no-cache requests>=2.31.0

COPY --from=awsdac /go/bin/awsdac-mcp-server /usr/local/bin/awsdac-mcp-server

RUN useradd -m -u 1000 bedrock_agentcore
USER bedrock_agentcore

EXPOSE 8080

COPY agent/basic_agent.py .
COPY agent/skills/ skills/
COPY agent/tools/ tools/
COPY agent/utils/ utils/

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/ping', timeout=2)" || exit 1

CMD ["opentelemetry-instrument", "python", "-m", "basic_agent"]
