"""Agent gateway API consumed only through the business system's same-origin proxy."""

from __future__ import annotations

import hmac
from typing import Any, Literal

import httpx2
from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from webagent.agent import db, runtime, sessions
from webagent.agent.llm import runtime_config, test_llm
from webagent.agent.mcp_client import list_tools
from webagent.agent.providers import (
    ProviderError,
    list_remote_models,
    suggest_model_defaults,
    validate_base_url,
    validate_headers,
)
from webagent.agent.runtime import AgentError
from webagent.config import AGENT_PORT, INTERNAL_SECRET, MCP_PORT


class ChatAttachment(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    mime_type: Literal["image/png", "image/jpeg", "image/webp", "image/gif"]
    data_url: str = Field(min_length=32, max_length=8_000_000)


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=20000)


class ChatBody(BaseModel):
    message: str | None = Field(default=None, max_length=20000)
    messages: list[ChatMessage] | None = Field(default=None, max_length=40)
    session_id: str | None = Field(default=None, max_length=80)
    assistant_id: int | None = None
    model_row_id: int | None = None
    enabled_tools: list[str] | None = None
    attachments: list[ChatAttachment] = Field(default_factory=list, max_length=4)


class ProviderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    provider_type: Literal["openai_compatible"] = "openai_compatible"
    base_url: str = Field(min_length=8, max_length=500)
    api_key: str = Field(default="", max_length=800)
    extra_headers: dict[str, str] = Field(default_factory=dict)
    timeout_seconds: float = Field(default=90, ge=3, le=180)
    enabled: bool = True


class ProviderUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    provider_type: Literal["openai_compatible"] | None = None
    base_url: str | None = Field(default=None, min_length=8, max_length=500)
    api_key: str | None = Field(default=None, max_length=800)
    clear_api_key: bool = False
    extra_headers: dict[str, str] | None = None
    timeout_seconds: float | None = Field(default=None, ge=3, le=180)
    enabled: bool | None = None


class ImportModelsBody(BaseModel):
    model_ids: list[str] = Field(min_length=1, max_length=100)


class TestModelBody(BaseModel):
    model_row_id: int | None = None


class ModelCreate(BaseModel):
    provider_id: int
    name: str = Field(min_length=1, max_length=80)
    model_id: str = Field(min_length=1, max_length=160)
    enabled: bool = True
    is_default: bool = False
    capabilities: list[Literal["text", "image"]] = Field(
        default_factory=lambda: ["text"]
    )
    supports_tools: bool = True
    context_window: int = Field(default=0, ge=0, le=10_000_000)
    max_output_tokens: int = Field(default=0, ge=0, le=1_000_000)
    temperature: float = Field(default=0.3, ge=0, le=2)
    top_p: float = Field(default=1.0, ge=0, le=1)
    extra_params: dict[str, Any] = Field(default_factory=dict)


class ModelUpdate(BaseModel):
    provider_id: int | None = None
    name: str | None = Field(default=None, min_length=1, max_length=80)
    model_id: str | None = Field(default=None, min_length=1, max_length=160)
    enabled: bool | None = None
    is_default: bool | None = None
    capabilities: list[Literal["text", "image"]] | None = None
    supports_tools: bool | None = None
    context_window: int | None = Field(default=None, ge=0, le=10_000_000)
    max_output_tokens: int | None = Field(default=None, ge=0, le=1_000_000)
    temperature: float | None = Field(default=None, ge=0, le=2)
    top_p: float | None = Field(default=None, ge=0, le=1)
    extra_params: dict[str, Any] | None = None


class ToolToggle(BaseModel):
    enabled: bool


class SkillCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=300)
    content: str = Field(min_length=1, max_length=20000)
    enabled: bool = True


class SkillUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=300)
    content: str | None = Field(default=None, min_length=1, max_length=20000)
    enabled: bool | None = None


class ConfigUpdate(BaseModel):
    llm_temperature: float | None = Field(default=None, ge=0, le=2)
    max_iterations: int | None = Field(default=None, ge=1, le=12)
    max_tool_calls: int | None = Field(default=None, ge=1, le=50)
    max_run_seconds: int | None = Field(default=None, ge=10, le=900)
    context_max_tokens: int | None = Field(default=None, ge=4096, le=1_000_000)
    context_compression: bool | None = None
    memory_enabled: bool | None = None
    system_prompt_extra: str | None = Field(default=None, max_length=4000)
    demo_mode: bool | None = None


class SessionCreate(BaseModel):
    assistant_id: int | None = None
    title: str = Field(default="新对话", max_length=120)


class SessionUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    assistant_id: int | None = None


class MemoryCreate(BaseModel):
    content: str = Field(min_length=1, max_length=2000)
    kind: str = Field(default="fact", max_length=20)


class MemoryUpdate(BaseModel):
    content: str | None = Field(default=None, min_length=1, max_length=2000)
    enabled: bool | None = None


class AssistantCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    icon: str = Field(default="✦", max_length=8)
    description: str = Field(default="", max_length=300)
    greeting: str = Field(default="", max_length=500)
    system_prompt: str = Field(default="", max_length=20000)
    mode: Literal["agent", "report"] = "agent"
    model_row_id: int | None = None
    allow_model_switch: bool = True
    prefetch_tools: list[str] = Field(default_factory=list, max_length=20)
    tool_names: list[str] = Field(default_factory=list, max_length=50)
    skill_ids: list[int] = Field(default_factory=list, max_length=50)
    max_steps: int = Field(default=0, ge=0, le=12)
    max_tool_calls: int = Field(default=0, ge=0, le=50)
    max_run_seconds: int = Field(default=0, ge=0, le=900)
    context_max_tokens: int = Field(default=0, ge=0, le=1_000_000)
    memory_enabled: bool = True
    allowed_roles: list[str] = Field(default_factory=lambda: ["*"], max_length=50)
    enabled: bool = True
    sort_order: int = Field(default=100, ge=0, le=10000)


class AssistantUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    icon: str | None = Field(default=None, max_length=8)
    description: str | None = Field(default=None, max_length=300)
    greeting: str | None = Field(default=None, max_length=500)
    system_prompt: str | None = Field(default=None, max_length=20000)
    mode: Literal["agent", "report"] | None = None
    model_row_id: int | None = None
    allow_model_switch: bool | None = None
    prefetch_tools: list[str] | None = Field(default=None, max_length=20)
    tool_names: list[str] | None = Field(default=None, max_length=50)
    skill_ids: list[int] | None = Field(default=None, max_length=50)
    max_steps: int | None = Field(default=None, ge=0, le=12)
    max_tool_calls: int | None = Field(default=None, ge=0, le=50)
    max_run_seconds: int | None = Field(default=None, ge=0, le=900)
    context_max_tokens: int | None = Field(default=None, ge=0, le=1_000_000)
    memory_enabled: bool | None = None
    allowed_roles: list[str] | None = Field(default=None, max_length=50)
    enabled: bool | None = None
    sort_order: int | None = Field(default=None, ge=0, le=10000)


app = FastAPI(title="WebAgent Agent Gateway", version="1.0.0")


@app.on_event("startup")
def startup() -> None:
    db.init_db()


@app.exception_handler(AgentError)
async def agent_error_handler(_request: Request, exc: AgentError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.message},
    )


def _verify_internal(token: str | None) -> None:
    if not token or not hmac.compare_digest(token, INTERNAL_SECRET):
        raise HTTPException(status_code=401, detail="invalid internal token")


def _bearer(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    token = auth[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="missing bearer token")
    return token


async def _admin(token: str) -> dict[str, Any]:
    user = await runtime.identity_from_token(token)
    if not user.get("is_admin"):
        raise AgentError("仅管理员可执行此操作", 403)
    return user


def _mask_key(key: str) -> str:
    if not key:
        return ""
    if len(key) <= 6:
        return "••••••"
    return "••••••••" + key[-4:]


def _provider_public(provider: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": provider["id"],
        "name": provider["name"],
        "provider_type": provider["provider_type"],
        "base_url": provider["base_url"],
        "api_key_masked": _mask_key(provider.get("api_key", "")),
        "api_key_set": bool(provider.get("api_key", "").strip()),
        "extra_headers": provider.get("extra_headers", {}),
        "timeout_seconds": provider["timeout_seconds"],
        "enabled": provider["enabled"],
        "model_count": provider.get("model_count", 0),
        "created_at": provider.get("created_at"),
        "updated_at": provider.get("updated_at"),
    }


def _assistant_public(
    item: dict[str, Any], *, admin: bool = False
) -> dict[str, Any]:
    data = {
        "id": item["id"],
        "name": item["name"],
        "icon": item.get("icon", "✦"),
        "description": item.get("description", ""),
        "greeting": item.get("greeting", ""),
        "mode": item.get("mode", "agent"),
        "model_row_id": item.get("model_row_id"),
        "model_name": item.get("model_name"),
        "model_external_id": item.get("model_external_id"),
        "provider_name": item.get("provider_name"),
        "allow_model_switch": item.get("allow_model_switch", True),
        "tool_names": item.get("tool_names", []),
        "prefetch_tools": item.get("prefetch_tools", []),
        "skill_ids": item.get("skill_ids", []),
        "max_steps": item.get("max_steps", 0),
        "max_tool_calls": item.get("max_tool_calls", 0),
        "max_run_seconds": item.get("max_run_seconds", 0),
        "context_max_tokens": item.get("context_max_tokens", 0),
        "memory_enabled": item.get("memory_enabled", True),
        "allowed_roles": item.get("allowed_roles", ["*"]),
        "enabled": item.get("enabled", True),
        "sort_order": item.get("sort_order", 100),
    }
    if admin:
        data["system_prompt"] = item.get("system_prompt", "")
        data["created_at"] = item.get("created_at")
        data["updated_at"] = item.get("updated_at")
    return data


def _assistant_for_user(
    user: dict[str, Any], assistant_id: int
) -> dict[str, Any]:
    assistant = db.get_assistant(assistant_id)
    if not assistant or not assistant["enabled"]:
        raise AgentError("助手不存在或已被管理员停用", 404)
    allowed = assistant.get("allowed_roles") or ["*"]
    if (
        "*" not in allowed
        and user.get("role") not in allowed
        and user.get("username") not in allowed
    ):
        raise AgentError("当前账号无权使用该助手", 403)
    return assistant


def _validated_provider_values(
    *,
    name: str,
    provider_type: str,
    base_url: str,
    api_key: str,
    extra_headers: dict[str, str],
    timeout_seconds: float,
    enabled: bool,
) -> dict[str, Any]:
    try:
        base_url = validate_base_url(base_url)
        headers = validate_headers(extra_headers or {})
    except ProviderError as exc:
        raise AgentError(exc.message, 422) from exc
    return {
        "name": name.strip(),
        "provider_type": provider_type,
        "base_url": base_url,
        "api_key": api_key.strip(),
        "extra_headers": headers,
        "timeout_seconds": timeout_seconds,
        "enabled": enabled,
    }


def _validate_extra_params(value: dict[str, Any]) -> dict[str, Any]:
    reserved = {
        "model",
        "messages",
        "tools",
        "tool_choice",
        "stream",
        "api_key",
        "base_url",
    }
    blocked = sorted(set(value) & reserved)
    if blocked:
        raise AgentError(f"额外请求参数不能覆盖：{'、'.join(blocked)}", 422)
    return value


def _config_public() -> dict[str, Any]:
    config = runtime_config()
    return {
        "llm_temperature": config["temperature"],
        "max_iterations": config["max_iterations"],
        "max_tool_calls": config["max_tool_calls"],
        "max_run_seconds": config["max_run_seconds"],
        "context_max_tokens": config["context_max_tokens"],
        "context_compression": config["context_compression"],
        "memory_enabled": config["memory_enabled"],
        "system_prompt_extra": config["system_prompt_extra"],
        "demo_mode": config["demo_mode"],
        "effective_demo_mode": config["demo_mode"],
        "provider_count": len(db.get_providers(include_disabled=True)),
        "model_count": len(db.get_models(include_disabled=True)),
        "assistants": len(db.get_assistants(include_disabled=True)),
    }


@app.get("/health")
async def health() -> dict[str, Any]:
    mcp_ok = False
    try:
        async with httpx2.AsyncClient(timeout=1.5) as client:
            response = await client.get(f"http://127.0.0.1:{MCP_PORT}/health")
            mcp_ok = response.status_code < 400
    except Exception:  # noqa: BLE001
        mcp_ok = False
    return {
        "ok": True,
        "service": "agent",
        "port": AGENT_PORT,
        "mcp": {"ok": mcp_ok},
    }


@app.post("/api/chat")
async def chat(
    body: ChatBody,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    token = _bearer(request)
    text = (body.message or "").strip()
    if not text and body.messages:
        last = next(
            (item for item in reversed(body.messages) if item.role == "user"),
            None,
        )
        text = last.content.strip() if last else ""
    if not text:
        raise AgentError("消息不能为空", 422)
    attachments = [item.model_dump() for item in body.attachments]
    return await runtime.chat(
        token,
        text,
        body.model_row_id,
        body.enabled_tools,
        assistant_id=body.assistant_id,
        session_id=body.session_id,
        attachments=attachments,
    )


@app.post("/api/approvals/{approval_id}/approve")
async def approve(
    approval_id: str,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    return await runtime.resolve_approval(approval_id, _bearer(request), True)


@app.post("/api/approvals/{approval_id}/reject")
async def reject(
    approval_id: str,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    return await runtime.resolve_approval(approval_id, _bearer(request), False)


@app.get("/api/models")
async def models(
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    await runtime.identity_from_token(_bearer(request))
    items = db.get_models(include_disabled=False)
    return {
        "items": [
            {
                "id": item["id"],
                "name": item["name"],
                "model_id": item["model_id"],
                "is_default": item["is_default"],
                "provider_id": item.get("provider_id"),
                "provider_name": item.get("provider_name"),
                "capabilities": item.get("capabilities", ["text"]),
                "supports_tools": item.get("supports_tools", True),
                "context_window": item.get("context_window", 0),
                "max_output_tokens": item.get("max_output_tokens", 0),
            }
            for item in items
        ]
    }


@app.get("/api/tools")
async def tools(
    request: Request,
    assistant_id: int | None = Query(default=None),
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    items = await runtime.user_tools(_bearer(request), assistant_id=assistant_id)
    return {"items": items, "total": len(items)}


@app.get("/api/skills")
async def skills(
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    await runtime.identity_from_token(_bearer(request))
    items = [
        {
            "id": item["id"],
            "name": item["name"],
            "description": item["description"],
        }
        for item in db.get_skills(include_disabled=False)
    ]
    return {"items": items}


@app.get("/api/assistants")
async def assistants(
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await runtime.identity_from_token(_bearer(request))
    items = db.assistants_for_user(user)
    return {"items": [_assistant_public(item) for item in items]}


@app.get("/api/sessions")
async def list_sessions(
    request: Request,
    limit: int = Query(default=100, ge=1, le=200),
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await runtime.identity_from_token(_bearer(request))
    return {"items": sessions.list_sessions(user["id"], limit=limit)}


@app.post("/api/sessions", status_code=201)
async def create_session(
    body: SessionCreate,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await runtime.identity_from_token(_bearer(request))
    if body.assistant_id:
        _assistant_for_user(user, body.assistant_id)
    session = sessions.create_session(
        user, title=body.title, assistant_id=body.assistant_id
    )
    return {"session": session}


@app.patch("/api/sessions/{session_id}")
async def update_session(
    session_id: str,
    body: SessionUpdate,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await runtime.identity_from_token(_bearer(request))
    session = sessions.get_session(session_id, user["id"])
    if session is None:
        raise AgentError("会话不存在或不属于当前账号", 404)
    if body.title is not None:
        session = sessions.rename_session(session_id, user["id"], body.title)
    if body.assistant_id is not None:
        _assistant_for_user(user, body.assistant_id)
        session = sessions.set_session_assistant(
            session_id, user["id"], body.assistant_id
        )
    return {"session": session}


@app.delete("/api/sessions/{session_id}")
async def remove_session(
    session_id: str,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await runtime.identity_from_token(_bearer(request))
    if not sessions.delete_session(session_id, user["id"]):
        raise AgentError("会话不存在或不属于当前账号", 404)
    return {"ok": True}


@app.get("/api/sessions/{session_id}/messages")
async def session_messages(
    session_id: str,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await runtime.identity_from_token(_bearer(request))
    session = sessions.get_session(session_id, user["id"])
    if session is None:
        raise AgentError("会话不存在或不属于当前账号", 404)
    return {
        "session": session,
        "items": sessions.list_messages(session_id, user["id"]),
    }


@app.delete("/api/sessions/{session_id}/messages")
async def clear_session_messages(
    session_id: str,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await runtime.identity_from_token(_bearer(request))
    if not sessions.clear_messages(session_id, user["id"]):
        raise AgentError("会话不存在或不属于当前账号", 404)
    return {"ok": True}


@app.get("/api/memories")
async def list_memories(
    request: Request,
    include_disabled: bool = Query(default=True),
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await runtime.identity_from_token(_bearer(request))
    items = sessions.list_memories(user["id"], include_disabled=include_disabled)
    return {"items": items}


@app.post("/api/memories", status_code=201)
async def create_memory(
    body: MemoryCreate,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await runtime.identity_from_token(_bearer(request))
    memory = sessions.create_memory(user, body.content, kind=body.kind)
    db.log_audit(
        username=user["username"],
        action="memory.create",
        resource=f"memory:{memory['id']}",
        detail={"content": body.content[:120]},
    )
    return {"memory": memory}


@app.patch("/api/memories/{memory_id}")
async def update_memory(
    memory_id: int,
    body: MemoryUpdate,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await runtime.identity_from_token(_bearer(request))
    values = body.model_dump(exclude_unset=True)
    memory = sessions.update_memory(memory_id, user["id"], values)
    if memory is None:
        raise AgentError("记忆不存在或不属于当前账号", 404)
    return {"memory": memory}


@app.delete("/api/memories/{memory_id}")
async def remove_memory(
    memory_id: int,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await runtime.identity_from_token(_bearer(request))
    if not sessions.delete_memory(memory_id, user["id"]):
        raise AgentError("记忆不存在或不属于当前账号", 404)
    db.log_audit(
        username=user["username"],
        action="memory.delete",
        resource=f"memory:{memory_id}",
    )
    return {"ok": True}


@app.get("/api/admin/assistants")
async def admin_assistants(
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    await _admin(_bearer(request))
    items = db.get_assistants(include_disabled=True)
    return {"items": [_assistant_public(item, admin=True) for item in items]}


@app.post("/api/admin/assistants", status_code=201)
async def admin_create_assistant(
    body: AssistantCreate,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await _admin(_bearer(request))
    values = body.model_dump()
    if values.get("model_row_id") and not db.get_model(values["model_row_id"]):
        raise AgentError("绑定的模型不存在", 404)
    assistant = db.create_assistant(values)
    db.log_audit(
        username=user["username"],
        action="assistant.create",
        resource=f"assistant:{assistant['id']}",
        detail={"name": assistant["name"], "mode": assistant["mode"]},
    )
    return {"assistant": _assistant_public(assistant, admin=True)}


@app.put("/api/admin/assistants/{assistant_id}")
async def admin_update_assistant(
    assistant_id: int,
    body: AssistantUpdate,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await _admin(_bearer(request))
    values = body.model_dump(exclude_unset=True)
    if not values:
        raise AgentError("没有需要更新的字段", 422)
    if values.get("model_row_id") and not db.get_model(values["model_row_id"]):
        raise AgentError("绑定的模型不存在", 404)
    assistant = db.update_assistant(assistant_id, values)
    if assistant is None:
        raise AgentError("助手不存在", 404)
    db.log_audit(
        username=user["username"],
        action="assistant.update",
        resource=f"assistant:{assistant_id}",
        detail=values,
    )
    return {"assistant": _assistant_public(assistant, admin=True)}


@app.delete("/api/admin/assistants/{assistant_id}")
async def admin_delete_assistant(
    assistant_id: int,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await _admin(_bearer(request))
    if not db.delete_assistant(assistant_id):
        raise AgentError("助手不存在", 404)
    db.log_audit(
        username=user["username"],
        action="assistant.delete",
        resource=f"assistant:{assistant_id}",
    )
    return {"ok": True}


@app.get("/api/config")
async def get_config(
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    await _admin(_bearer(request))
    return _config_public()


@app.put("/api/config")
async def update_config(
    body: ConfigUpdate,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    token = _bearer(request)
    user = await _admin(token)
    values: dict[str, str] = {}
    if body.llm_temperature is not None:
        values["llm_temperature"] = str(body.llm_temperature)
    if body.max_iterations is not None:
        values["max_iterations"] = str(body.max_iterations)
    if body.max_tool_calls is not None:
        values["max_tool_calls"] = str(body.max_tool_calls)
    if body.max_run_seconds is not None:
        values["max_run_seconds"] = str(body.max_run_seconds)
    if body.context_max_tokens is not None:
        values["context_max_tokens"] = str(body.context_max_tokens)
    if body.context_compression is not None:
        values["context_compression"] = "1" if body.context_compression else "0"
    if body.memory_enabled is not None:
        values["memory_enabled"] = "1" if body.memory_enabled else "0"
    if body.system_prompt_extra is not None:
        values["system_prompt_extra"] = body.system_prompt_extra.strip()
    if body.demo_mode is not None:
        values["demo_mode"] = "1" if body.demo_mode else "0"
    db.set_settings(values)
    db.log_audit(
        username=user["username"],
        action="config.update",
        resource="llm_settings",
        detail={"keys": sorted(values)},
    )
    return _config_public()


@app.post("/api/test-llm")
async def test_connection(
    body: TestModelBody | None,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    token = _bearer(request)
    user = await _admin(token)
    model = (
        db.get_model(body.model_row_id)
        if body and body.model_row_id
        else db.default_model()
    )
    if not model:
        raise AgentError("没有可用模型，请先添加并启用模型", 400)
    provider = db.get_provider(model["provider_id"])
    if not provider:
        raise AgentError("模型没有关联供应商", 400)
    result = await test_llm(model, provider, runtime_config())
    db.log_audit(
        username=user["username"],
        action="config.test_llm",
        resource=f"model:{model['id']}",
        detail={
            "model_id": model["model_id"],
            "provider": provider["name"],
            "ok": result.get("ok"),
            "demo": result.get("demo"),
        },
    )
    return result


@app.get("/api/admin/providers")
async def admin_providers(
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    await _admin(_bearer(request))
    items = [_provider_public(item) for item in db.get_providers(include_disabled=True)]
    return {"items": items, "total": len(items)}


@app.post("/api/admin/providers", status_code=201)
async def admin_create_provider(
    body: ProviderCreate,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await _admin(_bearer(request))
    values = _validated_provider_values(
        name=body.name,
        provider_type=body.provider_type,
        base_url=body.base_url,
        api_key=body.api_key,
        extra_headers=body.extra_headers,
        timeout_seconds=body.timeout_seconds,
        enabled=body.enabled,
    )
    provider = db.create_provider(**values)
    db.log_audit(
        username=user["username"],
        action="provider.create",
        resource=f"provider:{provider['id']}",
        detail={
            "name": provider["name"],
            "type": provider["provider_type"],
            "base_url": provider["base_url"],
        },
    )
    return {"provider": _provider_public(provider)}


@app.put("/api/admin/providers/{provider_id}")
async def admin_update_provider(
    provider_id: int,
    body: ProviderUpdate,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await _admin(_bearer(request))
    current = db.get_provider(provider_id)
    if not current:
        raise AgentError("供应商不存在", 404)
    updates: dict[str, Any] = body.model_dump(exclude_unset=True)
    updates.pop("clear_api_key", None)
    if body.clear_api_key:
        updates["api_key"] = ""
    elif not body.api_key or not body.api_key.strip():
        updates.pop("api_key", None)

    merged = {
        "name": updates.get("name", current["name"]),
        "provider_type": updates.get("provider_type", current["provider_type"]),
        "base_url": updates.get("base_url", current["base_url"]),
        "api_key": updates.get("api_key", current.get("api_key", "")),
        "extra_headers": updates.get("extra_headers", current.get("extra_headers", {})),
        "timeout_seconds": updates.get(
            "timeout_seconds", current["timeout_seconds"]
        ),
        "enabled": updates.get("enabled", current["enabled"]),
    }
    validated = _validated_provider_values(**merged)
    provider = db.update_provider(
        provider_id,
        {
            **updates,
            "name": validated["name"],
            "provider_type": validated["provider_type"],
            "base_url": validated["base_url"],
            "extra_headers": validated["extra_headers"],
            "timeout_seconds": validated["timeout_seconds"],
            "enabled": validated["enabled"],
            **(
                {"api_key": validated["api_key"]}
                if "api_key" in updates
                else {}
            ),
        },
    )
    if provider is None:
        raise AgentError("供应商不存在", 404)
    db.log_audit(
        username=user["username"],
        action="provider.update",
        resource=f"provider:{provider_id}",
        detail={
            "keys": sorted(updates),
            "api_key_changed": "api_key" in updates,
        },
    )
    return {"provider": _provider_public(provider)}


@app.delete("/api/admin/providers/{provider_id}")
async def admin_delete_provider(
    provider_id: int,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await _admin(_bearer(request))
    provider = db.get_provider(provider_id)
    if not provider:
        raise AgentError("供应商不存在", 404)
    deleted, reason = db.delete_provider(provider_id)
    if not deleted:
        raise AgentError(reason, 409)
    db.log_audit(
        username=user["username"],
        action="provider.delete",
        resource=f"provider:{provider_id}",
        detail={"name": provider["name"]},
    )
    return {"ok": True}


@app.post("/api/admin/providers/{provider_id}/test")
async def admin_test_provider(
    provider_id: int,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await _admin(_bearer(request))
    provider = db.get_provider(provider_id)
    if not provider:
        raise AgentError("供应商不存在", 404)
    try:
        models = await list_remote_models(provider)
    except ProviderError as exc:
        result = {"ok": False, "message": exc.message, "count": 0, "sample": []}
    else:
        sample = [item["model_id"] for item in models[:8]]
        result = {
            "ok": True,
            "message": f"连接成功，读取到 {len(models)} 个模型",
            "count": len(models),
            "sample": sample,
        }
    db.log_audit(
        username=user["username"],
        action="provider.test",
        resource=f"provider:{provider_id}",
        detail={"ok": result["ok"], "count": result["count"]},
    )
    return result


@app.get("/api/admin/providers/{provider_id}/discover-models")
async def admin_discover_provider_models(
    provider_id: int,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    await _admin(_bearer(request))
    provider = db.get_provider(provider_id)
    if not provider:
        raise AgentError("供应商不存在", 404)
    try:
        models = await list_remote_models(provider)
    except ProviderError as exc:
        raise AgentError(exc.message, 502) from exc
    items = []
    for item in models:
        existing = db.find_model_by_external_id(provider_id, item["model_id"])
        defaults = suggest_model_defaults(item["model_id"])
        items.append(
            {
                **item,
                "already_imported": bool(existing),
                "existing_model_row_id": existing["id"] if existing else None,
                "suggested": defaults,
            }
        )
    return {"provider": _provider_public(provider), "items": items}


@app.post("/api/admin/providers/{provider_id}/import-models")
async def admin_import_provider_models(
    provider_id: int,
    body: ImportModelsBody,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await _admin(_bearer(request))
    provider = db.get_provider(provider_id)
    if not provider:
        raise AgentError("供应商不存在", 404)
    try:
        remote_models = await list_remote_models(provider)
    except ProviderError as exc:
        raise AgentError(exc.message, 502) from exc
    remote_map = {item["model_id"]: item for item in remote_models}
    missing = sorted(set(body.model_ids) - set(remote_map))
    if missing:
        raise AgentError(f"供应商未返回这些模型：{'、'.join(missing[:8])}", 422)

    imported = []
    skipped = []
    for model_id in body.model_ids:
        if db.find_model_by_external_id(provider_id, model_id):
            skipped.append(model_id)
            continue
        remote = remote_map[model_id]
        defaults = suggest_model_defaults(model_id)
        model = db.create_model(
            provider_id=provider_id,
            name=remote.get("name") or model_id,
            model_id=model_id,
            enabled=True,
            is_default=not db.get_models(include_disabled=True),
            **defaults,
        )
        imported.append(model)
    db.log_audit(
        username=user["username"],
        action="provider.import_models",
        resource=f"provider:{provider_id}",
        detail={"imported": [item["model_id"] for item in imported], "skipped": skipped},
    )
    return {"imported": imported, "skipped": skipped}


@app.get("/api/admin/models")
async def admin_models(
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    await _admin(_bearer(request))
    return {"items": db.get_models(include_disabled=True)}


@app.post("/api/admin/models", status_code=201)
async def admin_create_model(
    body: ModelCreate,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await _admin(_bearer(request))
    provider = db.get_provider(body.provider_id)
    if not provider:
        raise AgentError("供应商不存在", 404)
    is_default = body.is_default or not db.get_models(include_disabled=True)
    model = db.create_model(
        provider_id=body.provider_id,
        name=body.name,
        model_id=body.model_id,
        enabled=body.enabled,
        is_default=is_default,
        capabilities=body.capabilities,
        supports_tools=body.supports_tools,
        context_window=body.context_window,
        max_output_tokens=body.max_output_tokens,
        temperature=body.temperature,
        top_p=body.top_p,
        extra_params=_validate_extra_params(body.extra_params),
    )
    db.log_audit(
        username=user["username"],
        action="model.create",
        resource=f"model:{model['id']}",
        detail={
            "name": model["name"],
            "model_id": model["model_id"],
            "provider": provider["name"],
            "capabilities": model["capabilities"],
        },
    )
    return {"model": model}


@app.put("/api/admin/models/{model_row_id}")
async def admin_update_model(
    model_row_id: int,
    body: ModelUpdate,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await _admin(_bearer(request))
    values = body.model_dump(exclude_unset=True)
    if not values:
        raise AgentError("没有需要更新的字段", 422)
    if "provider_id" in values and not db.get_provider(values["provider_id"]):
        raise AgentError("供应商不存在", 404)
    if "extra_params" in values:
        values["extra_params"] = _validate_extra_params(values["extra_params"])
    model = db.update_model(model_row_id, values)
    if model is None:
        raise AgentError("模型不存在", 404)
    db.log_audit(
        username=user["username"],
        action="model.update",
        resource=f"model:{model_row_id}",
        detail=values,
    )
    return {"model": model}


@app.post("/api/admin/models/{model_row_id}/test")
async def admin_test_model(
    model_row_id: int,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await _admin(_bearer(request))
    model = db.get_model(model_row_id)
    if not model:
        raise AgentError("模型不存在", 404)
    provider = db.get_provider(model["provider_id"])
    if not provider:
        raise AgentError("模型没有关联供应商", 400)
    result = await test_llm(model, provider, runtime_config())
    db.log_audit(
        username=user["username"],
        action="model.test",
        resource=f"model:{model_row_id}",
        detail={"ok": result.get("ok"), "demo": result.get("demo")},
    )
    return result


@app.delete("/api/admin/models/{model_row_id}")
async def admin_delete_model(
    model_row_id: int,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await _admin(_bearer(request))
    if not db.delete_model(model_row_id):
        raise AgentError("模型不存在", 404)
    db.log_audit(
        username=user["username"],
        action="model.delete",
        resource=f"model:{model_row_id}",
    )
    return {"ok": True}


@app.get("/api/admin/tools")
async def admin_tools(
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    items = await runtime.admin_all_tools(_bearer(request))
    return {
        "items": items,
        "total": len(items),
        "enabled_count": sum(1 for item in items if item["enabled"]),
    }


@app.put("/api/admin/tools/{name}")
async def admin_toggle_tool(
    name: str,
    body: ToolToggle,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    token = _bearer(request)
    user = await _admin(token)
    try:
        specs = await list_tools(token)
    except Exception as exc:  # noqa: BLE001
        raise AgentError(f"MCP 工具服务不可用：{exc}", 503) from exc
    spec = next((item for item in specs if item.name == name), None)
    if spec is None:
        raise AgentError("工具不存在", 404)
    db.set_tool_setting(name, body.enabled)
    db.log_audit(
        username=user["username"],
        action="tool.toggle",
        resource=f"tool:{name}",
        detail={"enabled": body.enabled},
    )
    return {"tool": spec.public(enabled=body.enabled)}


@app.get("/api/admin/skills")
async def admin_skills(
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    await _admin(_bearer(request))
    return {"items": db.get_skills(include_disabled=True)}


@app.post("/api/admin/skills", status_code=201)
async def admin_create_skill(
    body: SkillCreate,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await _admin(_bearer(request))
    skill = db.create_skill(
        body.name, body.description, body.content, enabled=body.enabled
    )
    db.log_audit(
        username=user["username"],
        action="skill.create",
        resource=f"skill:{skill['id']}",
        detail={"name": skill["name"]},
    )
    return {"skill": skill}


@app.put("/api/admin/skills/{skill_id}")
async def admin_update_skill(
    skill_id: int,
    body: SkillUpdate,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await _admin(_bearer(request))
    values = body.model_dump(exclude_unset=True)
    if not values:
        raise AgentError("没有需要更新的字段", 422)
    skill = db.update_skill(skill_id, values)
    if skill is None:
        raise AgentError("技能不存在", 404)
    db.log_audit(
        username=user["username"],
        action="skill.update",
        resource=f"skill:{skill_id}",
        detail=values,
    )
    return {"skill": skill}


@app.delete("/api/admin/skills/{skill_id}")
async def admin_delete_skill(
    skill_id: int,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await _admin(_bearer(request))
    if not db.delete_skill(skill_id):
        raise AgentError("技能不存在", 404)
    db.log_audit(
        username=user["username"],
        action="skill.delete",
        resource=f"skill:{skill_id}",
    )
    return {"ok": True}


@app.get("/api/admin/audit")
async def admin_audit(
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    await _admin(_bearer(request))
    return {"items": db.list_audit(limit=300)}


@app.get("/api/status")
async def status(
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await runtime.identity_from_token(_bearer(request))
    config = runtime_config()
    return {
        "ok": True,
        "user": user,
        "models": len(db.get_models(include_disabled=False)),
        "skills": len(db.get_skills(include_disabled=False)),
        "assistants": len(db.assistants_for_user(user)),
        "demo_mode": config["demo_mode"],
        "max_iterations": config["max_iterations"],
        "max_tool_calls": config["max_tool_calls"],
        "max_run_seconds": config["max_run_seconds"],
        "context_max_tokens": config["context_max_tokens"],
    }
