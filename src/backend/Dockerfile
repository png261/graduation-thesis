FROM python:3.11-slim-bookworm

ARG INFRACOST_VERSION=latest

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PROJECTS_ROOT=/data/projects

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git gpg \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://packages.opentofu.org/opentofu/tofu/gpgkey | gpg --dearmor -o /etc/apt/keyrings/opentofu.gpg \
    && chmod a+r /etc/apt/keyrings/opentofu.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/opentofu.gpg] https://packages.opentofu.org/opentofu/tofu/any/ any main" > /etc/apt/sources.list.d/opentofu.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends ansible tofu \
    && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
      amd64) infracost_arch="amd64" ;; \
      arm64) infracost_arch="arm64" ;; \
      *) echo "Unsupported architecture: $arch" >&2; exit 1 ;; \
    esac; \
    if [ "$INFRACOST_VERSION" = "latest" ]; then \
      base_url="https://github.com/infracost/infracost/releases/latest/download"; \
    else \
      base_url="https://github.com/infracost/infracost/releases/download/v${INFRACOST_VERSION}"; \
    fi; \
    curl -fsSL -o /tmp/infracost.tar.gz "${base_url}/infracost-linux-${infracost_arch}.tar.gz"; \
    tar -xzf /tmp/infracost.tar.gz -C /tmp; \
    install -m 0755 "/tmp/infracost-linux-${infracost_arch}" /usr/local/bin/infracost; \
    rm -f "/tmp/infracost-linux-${infracost_arch}" /tmp/infracost.tar.gz; \
    infracost --version

COPY . .

RUN pip install --upgrade pip \
    && pip install .

RUN mkdir -p /data/projects

VOLUME ["/data/projects"]

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
