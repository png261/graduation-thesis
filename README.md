# Hướng dẫn cài đặt và triển khai InfraQ
## Yêu cầu môi trường

- Node.js và npm (dùng cho CDK và frontend)
- Python 3.8+ (dùng cho một số script triển khai)
- AWS CLI đã cấu hình credential hợp lệ
- Docker (chỉ cần nếu `backend.deployment_type` trong `config.yaml` = `docker`)

Kiểm tra nhanh:

```bash
node --version
npm --version
python3 --version
aws --version
docker --version  # nếu cần
```

Thiết lập vùng mặc định (ví dụ `us-east-2`):

```bash
export AWS_REGION=us-east-2
export AWS_DEFAULT_REGION=us-east-2
```

---

## Cấu trúc chính liên quan

- `src/infra-cdk/`: mã nguồn AWS CDK (TypeScript)
- `src/agent/`: runtime Python cho AgentCore
- `src/frontend/`: ứng dụng React/Vite (được host bởi Amplify)
- `src/scripts/deploy-frontend.py`: script build và đẩy frontend lên S3/Amplify
- `src/infra-cdk/config.yaml`: cấu hình stack, backend, GitHub App, VPC, S3 files

File cấu hình mặc định xác định tên stack:

```yaml
stack_name_base: InfraQ
```

---

## Cài đặt phụ thuộc

Từ thư mục gốc:

```bash
cd src/infra-cdk
npm install

cd ../frontend
npm install

cd ../infra-cdk
```

---

## Cấu hình trước khi triển khai

Chỉnh `infra-cdk/config.yaml` theo nhu cầu. Các mục quan trọng thường là:

- `stack_name_base`
- `admin_user_email` (người quản trị Cognito)
- `backend.deployment_type` (ví dụ `zip` hoặc `docker`)
- `backend.network_mode` (ví dụ `VPC`)
- `backend.openai.base_url` và `backend.openai.model_id`
- `backend.s3_files` (nếu sử dụng mount S3)

Ví dụ:

```yaml
backend:
  deployment_type: zip
  network_mode: VPC
  use_long_term_memory: false
  openai:
    base_url: https://llm.example.com/v1
    model_id: gpt-5
  s3_files:
    enabled: true
    mount_path: /mnt/s3
```

Trước khi chạy `cdk deploy`, tạo file `.env` từ `.env.example` và điền các biến cần thiết (không commit `.env`):

```bash
cp .env.example .env
```

Biến quan trọng:

- `DOMAIN`
- `OPENAI_API_KEY`
- `GITHUB_APP_PRIVATE_KEY` (PEM, escape newline `\\n` nếu cần)
- `GITHUB_APP_ID` và `GITHUB_APP_SLUG`

---

## Bootstrap CDK (nếu chưa thực hiện)

```bash
npx cdk bootstrap
# hoặc cho tài khoản/vùng cụ thể:
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
npx cdk bootstrap aws://$ACCOUNT_ID/us-east-2
```

---

## Build & kiểm tra hạ tầng

Build TypeScript và (nếu có) chạy test:

```bash
npm run build
npm test
```

Sinh template CloudFormation để kiểm tra:

```bash
npx cdk synth InfraQ
npx cdk diff InfraQ
```

---

## Triển khai backend (CDK)

```bash
npx cdk deploy InfraQ --require-approval never
```

Sau khi deploy thành công, lấy outputs quan trọng:

```bash
aws cloudformation describe-stacks \
  --stack-name InfraQ \
  --region $AWS_REGION \
  --query 'Stacks[0].Outputs' \
  --output table
```

Outputs quan trọng: `AmplifyAppId`, `AmplifyUrl`, `CognitoUserPoolId`, `CognitoClientId`, `RuntimeArn`, `StagingBucketName`, `SharedBrainBucketName`, `ResourcesApiUrl`, `FeedbackApiUrl`.

---

## Triển khai frontend (Amplify)

Script `scripts/deploy-frontend.py` sẽ:

- Sinh `frontend/public/aws-exports.json`
- Build frontend
- Upload gói build lên S3 staging bucket
- Kích hoạt job triển khai Amplify

Chạy từ thư mục `infra-cdk`:

```bash
python3 ../scripts/deploy-frontend.py InfraQ
```

Kiểm tra job Amplify:

```bash
APP_ID=$(aws cloudformation describe-stacks \
  --stack-name InfraQ \
  --region $AWS_REGION \
  --query "Stacks[0].Outputs[?OutputKey=='AmplifyAppId'].OutputValue" \
  --output text)

aws amplify list-jobs --app-id "$APP_ID" --branch-name main --region $AWS_REGION --max-results 5 --output table
```

Lấy URL frontend:

```bash
aws cloudformation describe-stacks \
  --stack-name InfraQ \
  --region $AWS_REGION \
  --query "Stacks[0].Outputs[?OutputKey=='AmplifyUrl'].OutputValue" \
  --output text
```

---

## Kiểm thử sau triển khai

Kiểm tra build frontend cục bộ và test:

```bash
cd ../frontend
npm run build
npm test
```

Kiểm tra trạng thái stack:

```bash
aws cloudformation describe-stacks --stack-name InfraQ --region $AWS_REGION --query 'Stacks[0].StackStatus' --output text
```

Thực hiện smoke test Resources API (yêu cầu user Cognito):

```bash
python3 ../scripts/smoke-resources-api.py --stack-name InfraQ --region $AWS_REGION --username "admin@example.com" --password "REPLACE_WITH_COGNITO_PASSWORD"
```

---

## Vận hành cơ bản

- Xem logs Lambda:

```bash
aws logs describe-log-groups --region $AWS_REGION --log-group-name-prefix /aws/lambda/InfraQ --output table
```

- Theo dõi sự kiện CloudFormation:

```bash
aws cloudformation describe-stack-events --stack-name InfraQ --region $AWS_REGION --query 'StackEvents[0:20].[Timestamp,LogicalResourceId,ResourceStatus,ResourceStatusReason]' --output table
```

- Lấy SSM parameters:

```bash
aws ssm get-parameters-by-path --path /InfraQ --region $AWS_REGION --recursive --with-decryption --output table
```

---

## Hủy triển khai

```bash
cd infra-cdk
npx cdk destroy InfraQ --force
```

Nếu CloudFormation không xóa được vì bucket có versioning, cần xoá các phiên bản object trước khi retry.

---

## Sự cố thường gặp & khắc phục nhanh

- `No credentials found` → chạy `aws configure` và kiểm tra `aws sts get-caller-identity`.
- `CDK bootstrap stack not found` → chạy `npx cdk bootstrap` cho account/region đúng.
- `Amplify deployment failed` → kiểm tra `AmplifyAppId`, staging bucket và quyền S3.
- `Frontend đăng nhập thất bại` → kiểm tra `frontend/public/aws-exports.json`, callback URLs Cognito, và `AmplifyUrl`.
- `Agent không gọi được model` → xác minh các biến môi trường (`OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL_ID`) và secrets trong Secrets Manager.

---

## Tiêu chí hoàn tất

Triển khai được coi là thành công khi:

- `npx cdk deploy InfraQ` kết thúc thành công.
- Stack CloudFormation ở trạng thái `CREATE_COMPLETE` hoặc `UPDATE_COMPLETE`.
- Amplify job đầu branch `main` báo `SUCCEED`.
- Frontend build & test tại `frontend` chạy thành công.
- Người dùng Cognito có thể đăng nhập vào `AmplifyUrl` và frontend giao tiếp được với backend.
