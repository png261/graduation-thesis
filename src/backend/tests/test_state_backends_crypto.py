from __future__ import annotations

import pytest

from app.services.state_backends.crypto import decrypt_json, decrypt_text, encrypt_text


def test_encrypt_decrypt_text_round_trip() -> None:
    token = encrypt_text(secret="secret-1", value="hello")
    assert token.startswith("enc:v1:")
    assert decrypt_text(secret="secret-1", value=token) == "hello"


def test_decrypt_text_passthrough_for_plain_value() -> None:
    assert decrypt_text(secret="secret-1", value="plain-text") == "plain-text"


def test_decrypt_text_rejects_invalid_token() -> None:
    token = encrypt_text(secret="secret-1", value="hello")
    with pytest.raises(ValueError, match="invalid_encrypted_payload"):
        decrypt_text(secret="secret-2", value=token)


def test_encrypt_decrypt_json_round_trip_and_string_cast() -> None:
    encrypted = encrypt_text(secret="secret-1", value='{"aws_access_key_id":"ak","number":123}')
    assert decrypt_json(secret="secret-1", value=encrypted) == {
        "aws_access_key_id": "ak",
        "number": "123",
    }


def test_decrypt_json_rejects_non_object_payload() -> None:
    encrypted = encrypt_text(secret="secret-1", value='["not","object"]')
    with pytest.raises(ValueError, match="invalid_encrypted_json_shape"):
        decrypt_json(secret="secret-1", value=encrypted)
