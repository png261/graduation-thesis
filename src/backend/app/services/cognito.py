from __future__ import annotations

import base64
import json
import time
from dataclasses import dataclass
from typing import Any

import httpx
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicNumbers
from starlette.datastructures import Headers

from app.core.config import Settings

_JWKS_CACHE_SECONDS = 300
_jwks_cache: dict[str, tuple[float, dict[str, Any]]] = {}


class CognitoError(Exception):
    pass


class CognitoConfigError(CognitoError):
    pass


class CognitoTokenError(CognitoError):
    pass


@dataclass(slots=True)
class CognitoSession:
    user_id: str
    claims: dict[str, Any]


def _require(value: str, *, name: str) -> str:
    text = value.strip()
    if not text:
        raise CognitoConfigError(f"Missing {name}")
    return text


def cognito_issuer(settings: Settings) -> str:
    region = _require(settings.cognito_region, name="COGNITO_REGION")
    pool_id = _require(settings.cognito_user_pool_id, name="COGNITO_USER_POOL_ID")
    return f"https://cognito-idp.{region}.amazonaws.com/{pool_id}"


def _base64url_decode(value: str) -> bytes:
    padding_len = (-len(value)) % 4
    return base64.urlsafe_b64decode(value + ("=" * padding_len))


def _decode_jwt(token: str) -> tuple[dict[str, Any], dict[str, Any], bytes, bytes]:
    parts = token.split(".")
    if len(parts) != 3:
        raise CognitoTokenError("Invalid JWT")
    header = json.loads(_base64url_decode(parts[0]))
    payload = json.loads(_base64url_decode(parts[1]))
    signing_input = f"{parts[0]}.{parts[1]}".encode("utf-8")
    signature = _base64url_decode(parts[2])
    if not isinstance(header, dict) or not isinstance(payload, dict):
        raise CognitoTokenError("Invalid JWT payload")
    return header, payload, signing_input, signature


async def _load_jwks(settings: Settings) -> dict[str, Any]:
    issuer = cognito_issuer(settings)
    now = time.time()
    cached = _jwks_cache.get(issuer)
    if cached and now - cached[0] < _JWKS_CACHE_SECONDS:
        return cached[1]
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            response = await client.get(f"{issuer}/.well-known/jwks.json")
            response.raise_for_status()
            payload = response.json()
        except Exception as exc:
            raise CognitoConfigError("Unable to load Cognito JWKS") from exc
    if not isinstance(payload, dict):
        raise CognitoConfigError("Invalid Cognito JWKS payload")
    _jwks_cache[issuer] = (now, payload)
    return payload


def _jwk_public_key(jwk: dict[str, Any]) -> rsa.RSAPublicKey:
    n = str(jwk.get("n") or "")
    e = str(jwk.get("e") or "")
    if not n or not e:
        raise CognitoConfigError("Invalid Cognito signing key")
    numbers = RSAPublicNumbers(
        int.from_bytes(_base64url_decode(e), byteorder="big"),
        int.from_bytes(_base64url_decode(n), byteorder="big"),
    )
    return numbers.public_key()


def _verify_claims(settings: Settings, payload: dict[str, Any]) -> None:
    now = int(time.time())
    issuer = cognito_issuer(settings)
    if str(payload.get("iss") or "") != issuer:
        raise CognitoTokenError("Invalid token issuer")
    exp = int(payload.get("exp") or 0)
    if exp <= now:
        raise CognitoTokenError("Token expired")
    token_use = str(payload.get("token_use") or "")
    if token_use not in {"access", "id"}:
        raise CognitoTokenError("Unsupported token type")
    client_id = _require(settings.cognito_client_id, name="COGNITO_CLIENT_ID")
    audience = str(payload.get("client_id") or payload.get("aud") or "")
    if audience != client_id:
        raise CognitoTokenError("Invalid token audience")


async def verify_token(settings: Settings, token: str) -> CognitoSession:
    header, payload, signing_input, signature = _decode_jwt(token)
    kid = str(header.get("kid") or "")
    alg = str(header.get("alg") or "")
    if alg != "RS256" or not kid:
        raise CognitoTokenError("Unsupported JWT header")
    jwks = await _load_jwks(settings)
    keys = jwks.get("keys")
    if not isinstance(keys, list):
        raise CognitoConfigError("Invalid Cognito JWKS")
    jwk = next((row for row in keys if isinstance(row, dict) and row.get("kid") == kid), None)
    if jwk is None:
        raise CognitoTokenError("Unknown signing key")
    public_key = _jwk_public_key(jwk)
    try:
        public_key.verify(signature, signing_input, padding.PKCS1v15(), hashes.SHA256())
    except Exception as exc:
        raise CognitoTokenError("Invalid token signature") from exc
    _verify_claims(settings, payload)
    user_id = str(payload.get("sub") or payload.get("username") or payload.get("cognito:username") or "")
    if not user_id:
        raise CognitoTokenError("Missing subject claim")
    return CognitoSession(user_id=user_id, claims=payload)


async def authenticate_bearer(settings: Settings, headers: Headers) -> CognitoSession | None:
    authorization = headers.get("Authorization") or headers.get("authorization") or ""
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    try:
        return await verify_token(settings, token.strip())
    except CognitoTokenError:
        return None
