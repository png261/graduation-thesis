FROM inayathulla/cloudrift:v1.0.0 AS cloudrift

FROM public.ecr.aws/docker/library/python:3.12-slim

COPY --from=cloudrift /cloudrift /usr/local/bin/cloudrift

ARG TERRAFORM_VERSION=1.14.5

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl unzip \
  && curl -fsSL "https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_amd64.zip" -o /tmp/terraform.zip \
  && unzip /tmp/terraform.zip -d /usr/local/bin \
  && rm -rf /var/lib/apt/lists/* /tmp/terraform.zip \
  && pip install --no-cache-dir boto3 \
  && cloudrift --help >/dev/null
