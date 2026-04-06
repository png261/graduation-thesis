/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_COGNITO_CLIENT_ID?: string;
  readonly VITE_COGNITO_DOMAIN?: string;
  readonly VITE_COGNITO_ISSUER?: string;
  readonly VITE_COGNITO_REDIRECT_URI?: string;
  readonly VITE_COGNITO_REGION?: string;
  readonly VITE_COGNITO_SCOPE?: string;
  readonly VITE_COGNITO_SCOPES?: string;
  readonly VITE_COGNITO_USER_POOL_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
