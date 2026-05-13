FROM public.ecr.aws/lambda/python:3.12

RUN pip install --no-cache-dir boto3 terraformgraph==1.0.4

COPY index.py ${LAMBDA_TASK_ROOT}/index.py

CMD ["index.handler"]
