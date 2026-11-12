"""Small secret-encryption helper for provider credentials at rest."""

from __future__ import annotations

import base64
import hashlib
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from webagent.config import SECRET_KEY


PREFIX = "enc:v1:"


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    digest = hashlib.sha256(SECRET_KEY.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def is_encrypted(value: str) -> bool:
    return str(value or "").startswith(PREFIX)


def encrypt_secret(value: str) -> str:
    text = str(value or "").strip()
    if not text or is_encrypted(text):
        return text
    token = _fernet().encrypt(text.encode("utf-8")).decode("ascii")
    return f"{PREFIX}{token}"


def decrypt_secret(value: str) -> str:
    text = str(value or "")
    if not text:
        return ""
    if not is_encrypted(text):
        return text
    try:
        return _fernet().decrypt(text[len(PREFIX) :].encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError):
        return ""
