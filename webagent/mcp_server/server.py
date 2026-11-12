"""MCP server exposing business capabilities as governed tools.

The MCP process never reads the business database. Every tool call is an HTTP
request to the business REST API carrying the current end user's token.
"""

from __future__ import annotations

import hmac
import json
from typing import Any
from urllib.parse import urlsplit

import httpx2
from mcp.server.mcpserver import Context, MCPServer
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp, Receive, Scope, Send

from webagent.config import BUSINESS_URL, INTERNAL_SECRET, MCP_URL


mcp = MCPServer(
    "webagent-device-tools",
    instructions=(
        "这是 WebAgent Demo 的设备管理工具层。所有操作都通过业务系统 REST API "
        "执行，并继承当前登录用户的 Bearer Token 权限。"
    ),
)


def _meta(permission: str, risk: str, category: str) -> str:
    return f"\n\n[META] permission={permission}; risk={risk}; category={category} [/META]"


def _header(ctx: Context, name: str) -> str:
    headers = {str(key).lower(): value for key, value in (ctx.headers or {}).items()}
    return str(headers.get(name.lower(), "")).strip()


def _user_token(ctx: Context) -> str:
    auth = _header(ctx, "authorization")
    if not auth.lower().startswith("bearer "):
        raise ValueError("缺少当前用户凭证，无法调用业务系统")
    return auth[7:].strip()


async def _business(
    ctx: Context,
    method: str,
    path: str,
    *,
    json_body: dict[str, Any] | None = None,
    params: dict[str, Any] | None = None,
) -> Any:
    token = _user_token(ctx)
    headers = {
        "Authorization": f"Bearer {token}",
        "X-WebAgent-Source": "agent-mcp",
    }
    async with httpx2.AsyncClient(timeout=30.0) as client:
        response = await client.request(
            method,
            f"{BUSINESS_URL}{path}",
            headers=headers,
            json=json_body,
            params=params,
        )
    if response.status_code >= 400:
        try:
            detail = response.json().get("detail", response.text)
        except Exception:  # noqa: BLE001
            detail = response.text
        raise ValueError(f"业务系统拒绝请求（{response.status_code}）：{detail}")
    if not response.content:
        return {"ok": True}
    return response.json()


def _json(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False)


@mcp.custom_route("/health", methods=["GET"])
async def health(_request: Any) -> JSONResponse:
    return JSONResponse({"ok": True, "service": "mcp"})


@mcp.tool(
    name="get_my_profile",
    description=(
        "读取当前登录用户的身份、角色和权限列表。"
        "在回答涉及权限的问题前应先调用此工具。"
        + _meta("profile:read", "read", "身份")
    ),
    annotations=ToolAnnotations(read_only_hint=True, destructive_hint=False),
)
async def get_my_profile(ctx: Context) -> str:
    return _json(await _business(ctx, "GET", "/api/me"))


@mcp.tool(
    name="list_devices",
    description=(
        "查询设备信息表。返回设备 ID、名称、类型、编号、位置、状态和负责人。"
        "可按关键字 q 搜索，或用 status 筛选：在线 / 离线 / 维护中。"
        + _meta("device:read", "read", "设备")
    ),
    annotations=ToolAnnotations(read_only_hint=True, destructive_hint=False),
)
async def list_devices(
    ctx: Context,
    q: str = "",
    status: str = "",
    limit: int = 50,
) -> str:
    params: dict[str, Any] = {"limit": max(1, min(limit, 100))}
    if q:
        params["q"] = q
    if status:
        params["status"] = status
    return _json(await _business(ctx, "GET", "/api/devices", params=params))


@mcp.tool(
    name="get_device",
    description=(
        "按设备 ID 查询单台设备的完整信息。"
        + _meta("device:read", "read", "设备")
    ),
    annotations=ToolAnnotations(read_only_hint=True, destructive_hint=False),
)
async def get_device(ctx: Context, device_id: int) -> str:
    return _json(await _business(ctx, "GET", f"/api/devices/{device_id}"))


@mcp.tool(
    name="get_device_stats",
    description=(
        "统计设备总数、在线数、离线数、维护中数量以及按设备类型的分布。"
        + _meta("device:read", "read", "设备")
    ),
    annotations=ToolAnnotations(read_only_hint=True, destructive_hint=False),
)
async def get_device_stats(ctx: Context) -> str:
    return _json(await _business(ctx, "GET", "/api/devices/stats"))


@mcp.tool(
    name="create_device",
    description=(
        "新增一台设备。serial_no 必须唯一。执行前需要用户审批。"
        + _meta("device:create", "write", "设备")
    ),
    annotations=ToolAnnotations(
        read_only_hint=False, destructive_hint=False, idempotent_hint=False
    ),
)
async def create_device(
    ctx: Context,
    name: str,
    device_type: str,
    serial_no: str,
    location: str = "",
    status: str = "在线",
    owner: str = "",
    remark: str = "",
) -> str:
    payload = {
        "name": name,
        "device_type": device_type,
        "serial_no": serial_no,
        "location": location,
        "status": status,
        "owner": owner,
        "remark": remark,
    }
    return _json(await _business(ctx, "POST", "/api/devices", json_body=payload))


@mcp.tool(
    name="update_device",
    description=(
        "修改指定 ID 的设备。只传需要变更的字段。执行前需要用户审批。"
        + _meta("device:update", "write", "设备")
    ),
    annotations=ToolAnnotations(
        read_only_hint=False, destructive_hint=False, idempotent_hint=True
    ),
)
async def update_device(
    ctx: Context,
    device_id: int,
    name: str | None = None,
    device_type: str | None = None,
    serial_no: str | None = None,
    location: str | None = None,
    status: str | None = None,
    owner: str | None = None,
    remark: str | None = None,
) -> str:
    payload = {
        "name": name,
        "device_type": device_type,
        "serial_no": serial_no,
        "location": location,
        "status": status,
        "owner": owner,
        "remark": remark,
    }
    payload = {key: value for key, value in payload.items() if value is not None}
    return _json(
        await _business(
            ctx, "PATCH", f"/api/devices/{device_id}", json_body=payload
        )
    )


@mcp.tool(
    name="delete_device",
    description=(
        "删除指定 ID 的设备，该操作不可恢复，必须由用户明确审批。"
        + _meta("device:delete", "delete", "设备")
    ),
    annotations=ToolAnnotations(
        read_only_hint=False, destructive_hint=True, idempotent_hint=False
    ),
)
async def delete_device(ctx: Context, device_id: int) -> str:
    return _json(await _business(ctx, "DELETE", f"/api/devices/{device_id}"))


@mcp.tool(
    name="list_users",
    description=(
        "列出系统用户及其权限，仅管理员可用。"
        + _meta("user:manage", "read", "用户")
    ),
    annotations=ToolAnnotations(read_only_hint=True, destructive_hint=False),
)
async def list_users(ctx: Context) -> str:
    return _json(await _business(ctx, "GET", "/api/users"))


class InternalTokenMiddleware:
    """Require the service-to-service secret for every MCP HTTP request."""

    def __init__(self, app: ASGIApp, secret: str) -> None:
        self.app = app
        self.secret = secret

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("path") == "/health":
            await self.app(scope, receive, send)
            return
        headers = {
            key.decode("latin-1").lower(): value.decode("latin-1")
            for key, value in scope.get("headers", [])
        }
        token = headers.get("x-internal-token", "")
        if not hmac.compare_digest(token, self.secret):
            response = Response(
                content=json.dumps({"detail": "invalid internal token"}),
                status_code=401,
                media_type="application/json",
            )
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)


def transport_security(url: str) -> TransportSecuritySettings:
    origin = urlsplit(url)
    return TransportSecuritySettings(
        allowed_hosts=["127.0.0.1:*", "localhost:*", "[::1]:*", origin.netloc],
        allowed_origins=[
            "http://127.0.0.1:*", "http://localhost:*", "http://[::1]:*",
            f"{origin.scheme}://{origin.netloc}",
        ],
    )


app = mcp.streamable_http_app(
    json_response=True, stateless_http=True,
    transport_security=transport_security(MCP_URL),
)
app.add_middleware(InternalTokenMiddleware, secret=INTERNAL_SECRET)
