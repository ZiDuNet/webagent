"""Mock business system with authentication, RBAC, audit and an Agent proxy."""

from __future__ import annotations

import asyncio
import json
import sqlite3
from typing import Any, Literal

import httpx2
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from webagent.business.auth import (
    authenticate,
    create_session,
    destroy_session,
    request_source,
    request_token,
    require_admin,
    require_permission,
    require_user,
    resolve_session,
)
from webagent.business.db import (
    connect,
    init_db,
    log_audit,
    row_to_dict,
    user_to_public,
    utc_now,
)
from webagent.config import (
    AGENT_URL,
    BUSINESS_PORT,
    INTERNAL_SECRET,
    MCP_PORT,
    SESSION_COOKIE,
    SESSION_HOURS,
    WEB_DIR,
)


STATUSES = {"在线", "离线", "维护中"}


class LoginBody(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class DeviceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    device_type: str = Field(min_length=1, max_length=60)
    serial_no: str = Field(min_length=1, max_length=80)
    location: str = Field(default="", max_length=120)
    status: Literal["在线", "离线", "维护中"] = "在线"
    owner: str = Field(default="", max_length=80)
    remark: str = Field(default="", max_length=500)


class DeviceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    device_type: str | None = Field(default=None, min_length=1, max_length=60)
    serial_no: str | None = Field(default=None, min_length=1, max_length=80)
    location: str | None = Field(default=None, max_length=120)
    status: Literal["在线", "离线", "维护中"] | None = None
    owner: str | None = Field(default=None, max_length=80)
    remark: str | None = Field(default=None, max_length=500)


app = FastAPI(title="WebAgent Demo Business System", version="1.0.0")


@app.on_event("startup")
def startup() -> None:
    init_db()


def _device_or_404(device_id: int) -> dict[str, Any]:
    with connect() as conn:
        row = conn.execute("SELECT * FROM devices WHERE id = ?", (device_id,)).fetchone()
    device = row_to_dict(row)
    if not device:
        raise HTTPException(status_code=404, detail="设备不存在")
    return device


def _audit(
    request: Request,
    user: dict[str, Any],
    action: str,
    resource: str,
    detail: str | dict[str, Any] = "",
) -> None:
    log_audit(
        user_id=user["id"],
        username=user["username"],
        source=request_source(request),
        action=action,
        resource=resource,
        detail=detail,
    )


@app.get("/health", include_in_schema=False)
@app.get("/api/health")
async def health() -> dict[str, Any]:
    async def probe(name: str, url: str) -> tuple[str, dict[str, Any]]:
        try:
            async with httpx2.AsyncClient(timeout=2.0) as client:
                response = await client.get(url)
                return name, {
                    "ok": response.status_code < 400,
                    "status": response.status_code,
                }
        except Exception as exc:  # noqa: BLE001 - health probe must never fail
            return name, {"ok": False, "error": str(exc)}

    results = await asyncio.gather(
        probe("agent", f"{AGENT_URL}/health"),
        probe("mcp", f"http://127.0.0.1:{MCP_PORT}/health"),
    )
    services = dict(results)
    return {
        "ok": True,
        "service": "business",
        "port": BUSINESS_PORT,
        "services": services,
    }


@app.post("/api/login")
async def login(body: LoginBody, request: Request, response: Response) -> dict[str, Any]:
    user = authenticate(body.username, body.password)
    if not user:
        log_audit(
            user_id=None,
            username=body.username,
            source="web",
            action="auth.login.failed",
            resource="session",
            detail={"reason": "invalid_credentials"},
        )
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    token = create_session(user["id"])
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_HOURS * 3600,
        httponly=True,
        samesite="lax",
        secure=False,
        path="/",
    )
    log_audit(
        user_id=user["id"],
        username=user["username"],
        source="web",
        action="auth.login",
        resource="session",
        detail={"role": user["role"]},
    )
    return {"user": user}


@app.post("/api/logout")
async def logout(request: Request, response: Response) -> dict[str, bool]:
    token = request_token(request)
    user = resolve_session(token)
    destroy_session(token)
    response.delete_cookie(SESSION_COOKIE, path="/")
    if user:
        log_audit(
            user_id=user["id"],
            username=user["username"],
            source="web",
            action="auth.logout",
            resource="session",
        )
    return {"ok": True}


@app.get("/api/me")
async def me(request: Request) -> dict[str, Any]:
    user = require_user(request)
    return {"user": user}


@app.get("/api/devices")
async def list_devices(
    request: Request,
    q: str = Query(default="", max_length=100),
    status: str = Query(default="", max_length=20),
    limit: int = Query(default=100, ge=1, le=200),
) -> dict[str, Any]:
    user = require_user(request)
    require_permission(user, "device:read")

    sql = "SELECT * FROM devices WHERE 1=1"
    params: list[Any] = []
    if q:
        sql += (
            " AND (name LIKE ? OR serial_no LIKE ? OR location LIKE ?"
            " OR owner LIKE ? OR device_type LIKE ?)"
        )
        like = f"%{q}%"
        params.extend([like, like, like, like, like])
    if status:
        sql += " AND status = ?"
        params.append(status)
    sql += " ORDER BY id ASC LIMIT ?"
    params.append(limit)

    with connect() as conn:
        rows = conn.execute(sql, params).fetchall()
    items = [dict(row) for row in rows]
    _audit(
        request,
        user,
        "device.list",
        "devices",
        {"count": len(items), "q": q, "status": status},
    )
    return {"items": items, "total": len(items)}


@app.get("/api/devices/stats")
async def device_stats(request: Request) -> dict[str, Any]:
    user = require_user(request)
    require_permission(user, "device:read")
    with connect() as conn:
        total = conn.execute("SELECT COUNT(*) AS n FROM devices").fetchone()["n"]
        rows = conn.execute(
            "SELECT status, COUNT(*) AS n FROM devices GROUP BY status"
        ).fetchall()
        type_rows = conn.execute(
            "SELECT device_type, COUNT(*) AS n FROM devices GROUP BY device_type"
        ).fetchall()
    counts = {row["status"]: row["n"] for row in rows}
    stats = {
        "total": total,
        "online": counts.get("在线", 0),
        "offline": counts.get("离线", 0),
        "maintenance": counts.get("维护中", 0),
        "by_type": {row["device_type"]: row["n"] for row in type_rows},
    }
    _audit(request, user, "device.stats", "devices", stats)
    return stats


@app.get("/api/devices/{device_id}")
async def get_device(device_id: int, request: Request) -> dict[str, Any]:
    user = require_user(request)
    require_permission(user, "device:read")
    device = _device_or_404(device_id)
    _audit(request, user, "device.get", f"device:{device_id}", device.get("name", ""))
    return {"device": device}


@app.post("/api/devices", status_code=201)
async def create_device(body: DeviceCreate, request: Request) -> dict[str, Any]:
    user = require_user(request)
    require_permission(user, "device:create")
    if body.status not in STATUSES:
        raise HTTPException(status_code=422, detail="设备状态不合法")
    now = utc_now()
    try:
        with connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO devices
                    (name, device_type, serial_no, location, status, owner, remark, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    body.name.strip(),
                    body.device_type.strip(),
                    body.serial_no.strip(),
                    body.location.strip(),
                    body.status,
                    body.owner.strip(),
                    body.remark.strip(),
                    now,
                    now,
                ),
            )
            device_id = int(cursor.lastrowid)
    except sqlite3.IntegrityError as exc:
        raise HTTPException(status_code=409, detail="设备编号已存在") from exc
    device = _device_or_404(device_id)
    _audit(request, user, "device.create", f"device:{device_id}", device)
    return {"device": device}


@app.patch("/api/devices/{device_id}")
async def update_device(
    device_id: int, body: DeviceUpdate, request: Request
) -> dict[str, Any]:
    user = require_user(request)
    require_permission(user, "device:update")
    existing = _device_or_404(device_id)
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=422, detail="没有需要更新的字段")
    if "status" in updates and updates["status"] not in STATUSES:
        raise HTTPException(status_code=422, detail="设备状态不合法")

    cleaned = {
        key: (value.strip() if isinstance(value, str) else value)
        for key, value in updates.items()
    }
    cleaned["updated_at"] = utc_now()
    assignments = ", ".join(f"{key} = ?" for key in cleaned)
    try:
        with connect() as conn:
            conn.execute(
                f"UPDATE devices SET {assignments} WHERE id = ?",
                [*cleaned.values(), device_id],
            )
    except sqlite3.IntegrityError as exc:
        raise HTTPException(status_code=409, detail="设备编号已存在") from exc

    device = _device_or_404(device_id)
    _audit(
        request,
        user,
        "device.update",
        f"device:{device_id}",
        {"before": existing, "after": device},
    )
    return {"device": device}


@app.delete("/api/devices/{device_id}")
async def delete_device(device_id: int, request: Request) -> dict[str, Any]:
    user = require_user(request)
    require_permission(user, "device:delete")
    device = _device_or_404(device_id)
    with connect() as conn:
        conn.execute("DELETE FROM devices WHERE id = ?", (device_id,))
    _audit(request, user, "device.delete", f"device:{device_id}", device)
    return {"ok": True, "deleted": device}


@app.get("/api/users")
async def list_users(request: Request) -> dict[str, Any]:
    user = require_user(request)
    require_admin(user)
    with connect() as conn:
        rows = conn.execute("SELECT * FROM users ORDER BY id ASC").fetchall()
    return {"items": [user_to_public(row) for row in rows]}


@app.delete("/api/users/{user_id}")
async def delete_user(user_id: int, request: Request) -> dict[str, Any]:
    actor = require_user(request)
    require_admin(actor)
    if user_id == actor["id"]:
        raise HTTPException(status_code=400, detail="不能删除当前登录账号")
    with connect() as conn:
        target = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not target:
            raise HTTPException(status_code=404, detail="用户不存在")
        if target["is_admin"]:
            raise HTTPException(status_code=400, detail="不能删除管理员账号")
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
    _audit(
        request,
        actor,
        "user.delete",
        f"user:{user_id}",
        {"username": target["username"], "display_name": target["display_name"]},
    )
    return {"ok": True}


@app.get("/api/audit")
async def audit_log(
    request: Request, limit: int = Query(default=200, ge=1, le=1000)
) -> dict[str, Any]:
    user = require_user(request)
    require_admin(user)
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM audit_log ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    return {"items": [dict(row) for row in rows]}


@app.api_route(
    "/api/agent/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
)
async def proxy_agent(path: str, request: Request) -> Response:
    """Same-origin proxy: the browser never talks to the Agent service directly."""
    user = require_user(request)
    token = request_token(request)
    target = f"{AGENT_URL}/api/{path}"
    if request.url.query:
        target = f"{target}?{request.url.query}"

    headers = {
        "Authorization": f"Bearer {token}",
        "X-Internal-Token": INTERNAL_SECRET,
        "X-WebAgent-User": user["username"],
    }
    content_type = request.headers.get("content-type")
    if content_type:
        headers["Content-Type"] = content_type
    accept = request.headers.get("accept")
    if accept:
        headers["Accept"] = accept

    body = await request.body()
    try:
        async with httpx2.AsyncClient(timeout=180.0) as client:
            upstream = await client.request(
                request.method,
                target,
                headers=headers,
                content=body if body else None,
            )
    except httpx2.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Agent 服务不可用，请确认 8010 端口已启动：{exc}",
        ) from exc

    media_type = upstream.headers.get("content-type", "application/json").split(";")[0]
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        media_type=media_type,
    )


app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


@app.get("/favicon.ico", include_in_schema=False)
async def favicon() -> Response:
    return Response(status_code=204)
