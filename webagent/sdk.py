"""WebAgent 接入 SDK：把业务系统已有接口注册成 Agent 工具。

业务系统有两种接入方式，都由本 SDK 提供一致入口：

1. 直连 Tool（推荐给已经有一堆 REST/内部函数、不想起 MCP 的场景）：
   把函数/接口声明为 ToolSpec，注册成「动态 HTTP 工具」。Agent 每次调用都会
   携带当前登录用户的业务 Token（透传），业务系统仍需做最终鉴权。

2. MCP（已有 FastMCP/streamable HTTP 能力时）：
   通过 WEBAGENT_MCP_URL 配置服务地址，不需要 SDK。

SDK 不要求业务系统引入 FastAPI，但提供 `serve_tools` 帮助函数给 FastAPI 用户
一键把 ToolSpec 列表变成 /tools 元数据接口 + 调用入口。非 FastAPI 框架只需要
实现同样的两个约定端点即可。
"""

from __future__ import annotations

import os
import inspect
from dataclasses import dataclass, field
from typing import Any, Callable

import httpx2


@dataclass
class ToolSpec:
    name: str
    description: str
    input_schema: dict[str, Any]
    risk: str = "read"
    permission: str = ""
    category: str = "业务连接器"
    method: str = "POST"
    url_template: str = ""
    headers: dict[str, str] = field(default_factory=dict)
    enabled: bool = True

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "display_name": self.name,
            "description": self.description,
            "input_schema": self.input_schema,
            "risk": self.risk,
            "permission": self.permission,
            "category": self.category,
            "method": self.method,
            "url_template": self.url_template,
            "headers": self.headers,
            "enabled": self.enabled,
        }


class AgentAdminClient:
    """用于脚本/启动阶段把工具注册进 Agent 后台。"""

    def __init__(
        self,
        *,
        agent_url: str = "http://127.0.0.1:8010",
        business_url: str = "http://127.0.0.1:8000",
        internal_secret: str | None = None,
        session_cookie_name: str | None = None,
    ) -> None:
        self.agent_url = agent_url.rstrip("/")
        self.business_url = business_url.rstrip("/")
        self.session_cookie_name = session_cookie_name or os.getenv("WEBAGENT_SESSION_COOKIE", "wa_session")
        self.internal_secret = internal_secret or os.getenv(
            "WEBAGENT_INTERNAL_SECRET", "webagent-demo-internal-secret-change-me"
        )

    def login(self, username: str, password: str) -> str:
        response = httpx2.post(
            f"{self.business_url}/api/login",
            json={"username": username, "password": password},
            timeout=30,
        )
        response.raise_for_status()
        token = response.json().get("token") or response.json().get("access_token")
        if not token:
            token = response.cookies.get(self.session_cookie_name)
        if not token:
            raise RuntimeError("登录响应缺少 token 或配置的业务会话 Cookie，请检查 session_cookie_name")
        return str(token)

    def _headers(self, token: str) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {token}",
            "X-Internal-Token": self.internal_secret,
        }

    def upsert_tool(self, token: str, spec: ToolSpec) -> dict[str, Any]:
        existing = self.list_tools(token)
        current = next(
            (item for item in existing if item.get("name") == spec.name), None
        )
        payload = spec.as_dict()
        if current:
            response = httpx2.put(
                f"{self.agent_url}/api/admin/dynamic-tools/{current['id']}",
                headers=self._headers(token),
                json=payload,
                timeout=30,
            )
        else:
            response = httpx2.post(
                f"{self.agent_url}/api/admin/dynamic-tools",
                headers=self._headers(token),
                json=payload,
                timeout=30,
            )
        response.raise_for_status()
        return response.json()["tool"]

    def list_tools(self, token: str) -> list[dict[str, Any]]:
        response = httpx2.get(
            f"{self.agent_url}/api/admin/dynamic-tools",
            headers=self._headers(token),
            timeout=30,
        )
        response.raise_for_status()
        return response.json().get("items", [])

    def remove_tool(self, token: str, name: str) -> bool:
        existing = self.list_tools(token)
        current = next((item for item in existing if item.get("name") == name), None)
        if not current:
            return False
        response = httpx2.delete(
            f"{self.agent_url}/api/admin/dynamic-tools/{current['id']}",
            headers=self._headers(token),
            timeout=30,
        )
        response.raise_for_status()
        return True


class SpeechClient(AgentAdminClient):
    """Use the authenticated business user's configured speech capabilities."""

    def synthesize(
        self, token: str, text: str, *, voice: str | None = None,
        response_format: str | None = None, speed: float | None = None,
        model_row_id: int | None = None,
    ) -> tuple[bytes, str]:
        payload: dict[str, Any] = {"text": text}
        for key, value in (("voice", voice), ("response_format", response_format), ("speed", speed), ("model_row_id", model_row_id)):
            if value is not None:
                payload[key] = value
        response = httpx2.post(
            f"{self.agent_url}/api/audio/speech", headers=self._headers(token),
            json=payload, timeout=100,
        )
        response.raise_for_status()
        return response.content, response.headers.get("content-type", "application/octet-stream")


class PagePilotClient(AgentAdminClient):
    """Server-side, business-user-scoped access to local PagePilot records."""

    def list_publications(
        self,
        token: str,
        *,
        q: str = "",
        session_id: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict[str, Any]:
        parameters: dict[str, Any] = {"q": q, "limit": limit, "offset": offset}
        if session_id:
            parameters["session_id"] = session_id
        response = httpx2.get(
            f"{self.agent_url}/api/pagepilot/publications",
            params=parameters, headers=self._headers(token), timeout=30,
        )
        response.raise_for_status()
        return response.json()

    def get_publication(self, token: str, publication_id: int) -> dict[str, Any]:
        response = httpx2.get(
            f"{self.agent_url}/api/pagepilot/publications/{int(publication_id)}",
            headers=self._headers(token), timeout=30,
        )
        response.raise_for_status()
        return response.json()["publication"]

    def get_version(self, token: str, publication_id: int, version_id: int) -> dict[str, Any]:
        response = httpx2.get(
            f"{self.agent_url}/api/pagepilot/publications/{int(publication_id)}/versions/{int(version_id)}",
            headers=self._headers(token), timeout=30,
        )
        response.raise_for_status()
        return response.json()["version"]

    def publish_html(
        self,
        token: str,
        *,
        html: str,
        access_password: str,
        visibility: str,
        title: str = "",
        description: str = "",
        publication_id: int | None = None,
        session_id: str | None = None,
    ) -> dict[str, Any]:
        response = httpx2.post(
            f"{self.agent_url}/api/pagepilot/publish",
            headers=self._headers(token),
            json={
                "html": html, "title": title, "description": description,
                "access_password": access_password, "visibility": visibility,
                "publication_id": publication_id, "session_id": session_id,
            },
            timeout=300,
        )
        response.raise_for_status()
        return response.json()


def serve_tools(
    specs: list[ToolSpec],
    handler: Callable[[str, dict[str, Any], Any], Any],
    *,
    authorize: Callable[[Any, ToolSpec | None], Any],
):
    """返回 FastAPI 路由注册函数，执行前必须调用业务鉴权回调。

    register_routes(app, prefix="/agent-tools") 会挂上元数据与调用端点；
    authorize(request, spec) 校验业务身份和权限，返回可信用户对象。
    handler(name, arguments, user) 由业务方实现，返回 JSON 可序列化结果。
    无论是否使用本帮助函数，Agent 只需要两个约定：
      GET  /agent-tools          -> {"items": [ToolSpec...]}
      POST /agent-tools/{name}   -> 执行结果，鉴权由业务系统负责
    """

    def register_routes(app: Any, prefix: str = "/agent-tools") -> None:
        try:
            from fastapi import FastAPI, HTTPException, Request
            from starlette.concurrency import run_in_threadpool

            if not isinstance(app, FastAPI):
                raise TypeError("register_routes 只支持 FastAPI 实例")
        except ImportError as exc:
            raise RuntimeError("serve_tools 需要安装 fastapi") from exc

        async def invoke(function: Callable, *arguments: Any) -> Any:
            if inspect.iscoroutinefunction(function):
                return await function(*arguments)
            result = await run_in_threadpool(function, *arguments)
            return await result if inspect.isawaitable(result) else result

        async def _list_tools(request: Any) -> dict[str, Any]:
            user = await invoke(authorize, request, None)
            if user is None:
                raise HTTPException(status_code=401, detail="业务身份校验失败")
            return {"items": [spec.as_dict() for spec in specs]}

        async def _call_tool(name: str, body: dict[str, Any], request: Any) -> Any:
            spec = next((item for item in specs if item.name == name), None)
            if spec is None:
                raise HTTPException(status_code=404, detail="工具未注册")
            user = await invoke(authorize, request, spec)
            if user is None:
                raise HTTPException(status_code=401, detail="业务身份校验失败")
            return await invoke(handler, name, body, user)

        _list_tools.__annotations__["request"] = Request
        _call_tool.__annotations__["request"] = Request
        app.add_api_route(prefix, _list_tools, methods=["GET"])
        app.add_api_route(f"{prefix}/{{name}}", _call_tool, methods=["POST"])

    return register_routes
