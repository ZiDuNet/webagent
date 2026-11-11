"""Session authentication and permission checks for the business system."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException, Request

from webagent.business.db import connect, user_to_public, utc_now
from webagent.common.security import (
    new_session_token,
    token_digest,
    verify_password,
)
from webagent.config import SESSION_COOKIE, SESSION_HOURS


def authenticate(username: str, password: str) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE username = ?", (username.strip(),)
        ).fetchone()
    if row is None or not verify_password(password, row["password_hash"]):
        return None
    return user_to_public(row)


def create_session(user_id: int) -> str:
    token = new_session_token()
    now = datetime.now(timezone.utc)
    expires = now + timedelta(hours=SESSION_HOURS)
    with connect() as conn:
        conn.execute(
            "DELETE FROM sessions WHERE expires_at < ?", (now.isoformat(timespec="seconds"),)
        )
        conn.execute(
            """
            INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
            VALUES (?, ?, ?, ?)
            """,
            (
                token_digest(token),
                user_id,
                now.isoformat(timespec="seconds"),
                expires.isoformat(timespec="seconds"),
            ),
        )
    return token


def destroy_session(token: str | None) -> None:
    if not token:
        return
    with connect() as conn:
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_digest(token),))


def resolve_session(token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    now = utc_now()
    with connect() as conn:
        row = conn.execute(
            """
            SELECT u.*
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = ? AND s.expires_at > ?
            """,
            (token_digest(token), now),
        ).fetchone()
    return user_to_public(row) if row else None


def request_token(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return request.cookies.get(SESSION_COOKIE)


def require_user(request: Request) -> dict[str, Any]:
    token = request_token(request)
    user = resolve_session(token)
    if not user:
        raise HTTPException(status_code=401, detail="登录已失效，请重新登录")
    request.state.user = user
    request.state.token = token
    return user


def require_permission(user: dict[str, Any], permission: str) -> None:
    if permission not in user.get("permissions", []):
        raise HTTPException(
            status_code=403,
            detail=f"当前账号缺少权限：{permission}",
        )


def require_admin(user: dict[str, Any]) -> None:
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="仅管理员可执行此操作")


def request_source(request: Request) -> str:
    if request.headers.get("x-webagent-source") == "agent-mcp":
        return "agent-mcp"
    return "web"

