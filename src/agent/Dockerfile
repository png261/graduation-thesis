FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

WORKDIR /app

ENV UV_SYSTEM_PYTHON=1 \
    UV_COMPILE_BYTECODE=1 \
    DOCKER_CONTAINER=1 \
    OTEL_PYTHON_LOG_CORRELATION=true \
    PYTHONUNBUFFERED=1 \
    PATH="/usr/local/go/bin:${PATH}"

COPY agent/requirements.txt requirements.txt
RUN uv pip install --no-cache -r requirements.txt && \
    uv pip install --no-cache aws-opentelemetry-distro==0.16.0

RUN uv pip install --no-cache requests>=2.31.0

RUN apt-get update && \
    apt-get install -y --no-install-recommends bash ca-certificates curl git gnupg jq unzip && \
    go_arch="$(dpkg --print-architecture)" && \
    case "$go_arch" in \
      amd64) go_arch="amd64"; go_sha256="2b2cfc7148493da5e73981bffbf3353af381d5f93e789c82c79aff64962eb556" ;; \
      arm64) go_arch="arm64"; go_sha256="9d89a3ea57d141c2b22d70083f2c8459ba3890f2d9e818e7e933b75614936565" ;; \
      *) echo "Unsupported Go architecture: $go_arch" >&2; exit 1 ;; \
    esac && \
    curl -fsSL "https://go.dev/dl/go1.26.3.linux-${go_arch}.tar.gz" -o /tmp/go.tar.gz && \
    echo "${go_sha256}  /tmp/go.tar.gz" | sha256sum -c - && \
    tar -C /usr/local -xzf /tmp/go.tar.gz && \
    rm -f /tmp/go.tar.gz && \
    curl --proto '=https' --tlsv1.2 -fsSL https://get.opentofu.org/install-opentofu.sh -o install-opentofu.sh && \
    chmod +x install-opentofu.sh && \
    ./install-opentofu.sh --install-method deb && \
    rm -f install-opentofu.sh && \
    curl -s https://raw.githubusercontent.com/terraform-linters/tflint/master/install_linux.sh | bash && \
    curl -fsSL https://raw.githubusercontent.com/infracost/cli/master/scripts/install.sh | sh && \
    rover_arch="$(uname -m)" && \
    case "$rover_arch" in \
      x86_64) rover_arch="amd64" ;; \
      aarch64|arm64) rover_arch="arm64" ;; \
      *) echo "Unsupported Rover architecture: $rover_arch" >&2; exit 1 ;; \
    esac && \
    curl -fsSL "https://github.com/im2nguyen/rover/releases/download/v0.3.3/rover_0.3.3_linux_${rover_arch}.zip" -o /tmp/rover.zip && \
    unzip -q /tmp/rover.zip -d /tmp/rover && \
    install /tmp/rover/rover_v0.3.3 /usr/local/bin/rover && \
    rm -rf /tmp/rover /tmp/rover.zip && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

RUN uv pip install --no-cache checkov && \
    uv pip install --no-cache boto3==1.43.7 botocore==1.43.7 s3transfer==0.17.0 && \
    uv pip install --no-cache ministack==1.3.39

RUN useradd -m -u 1000 bedrock_agentcore
USER bedrock_agentcore

EXPOSE 8080

COPY agent/main.py .
COPY agent/agents/ agents/
COPY agent/utils/ utils/

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/ping', timeout=2)" || exit 1

CMD ["opentelemetry-instrument", "python", "-m", "main"]
