"""Agent gateway API consumed only through the business system's same-origin proxy."""

from __future__ import annotations

import csv
import hmac
import io
import json
import logging
import base64
import binascii
import secrets
import asyncio
import time
from typing import Any, Literal

import httpx2
from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from webagent.agent import artifacts, db, decision, dynamic_tools, pagepilot, publications, runtime, sessions
from webagent.agent.llm import runtime_config, test_llm, transcribe_audio
from webagent.agent.provider_presets import list_provider_presets
from webagent.agent.providers import (
    ProviderError,
    enrich_model_defaults,
    list_remote_models,
    reasoning_config,
    provider_requires_key,
    suggest_model_defaults,
    transcription_config,
    validate_base_url,
    validate_headers,
)
from webagent.agent.runtime import AgentError
from webagent.config import AGENT_PORT, INTERNAL_SECRET, MCP_HEALTH_URL


logger = logging.getLogger("uvicorn.error")

ReasoningEffort = Literal[
    "off",
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
]


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
    reasoning_effort: ReasoningEffort | None = None
    approval_mode: Literal["confirm", "full_access"] | None = None
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
    model_kind: Literal[
        "chat",
        "vision",
        "asr",
        "asr_realtime",
        "tts",
        "embedding",
        "rerank",
        "image_generation",
        "decision",
    ] = "chat"
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
    input_price_per_1m: float = Field(default=0, ge=0, le=100_000)
    output_price_per_1m: float = Field(default=0, ge=0, le=100_000)
    supports_reasoning: bool = False
    reasoning_style: Literal["effort"] = "effort"
    reasoning_efforts: list[ReasoningEffort] = Field(default_factory=list)
    default_reasoning_effort: Literal["", "off", "none", "minimal", "low", "medium", "high", "xhigh"] = ""
    supports_reasoning_summary: bool = True
    supports_transcription: bool = False
    metadata_source: str = Field(default="", max_length=40)
    extra_params: dict[str, Any] = Field(default_factory=dict)


class ModelUpdate(BaseModel):
    provider_id: int | None = None
    name: str | None = Field(default=None, min_length=1, max_length=80)
    model_id: str | None = Field(default=None, min_length=1, max_length=160)
    model_kind: Literal[
        "chat",
        "vision",
        "asr",
        "asr_realtime",
        "tts",
        "embedding",
        "rerank",
        "image_generation",
        "decision",
    ] | None = None
    enabled: bool | None = None
    is_default: bool | None = None
    capabilities: list[Literal["text", "image"]] | None = None
    supports_tools: bool | None = None
    context_window: int | None = Field(default=None, ge=0, le=10_000_000)
    max_output_tokens: int | None = Field(default=None, ge=0, le=1_000_000)
    temperature: float | None = Field(default=None, ge=0, le=2)
    top_p: float | None = Field(default=None, ge=0, le=1)
    input_price_per_1m: float | None = Field(default=None, ge=0, le=100_000)
    output_price_per_1m: float | None = Field(default=None, ge=0, le=100_000)
    supports_reasoning: bool | None = None
    reasoning_style: Literal["effort"] | None = None
    reasoning_efforts: list[ReasoningEffort] | None = None
    default_reasoning_effort: Literal["", "off", "none", "minimal", "low", "medium", "high", "xhigh"] | None = None
    supports_reasoning_summary: bool | None = None
    supports_transcription: bool | None = None
    metadata_source: str | None = Field(default=None, max_length=40)
    extra_params: dict[str, Any] | None = None


class ToolConfigUpdate(BaseModel):
    enabled: bool | None = None
    visible: bool | None = None
    selectable: bool | None = None
    default_selected: bool | None = None


class DynamicToolCreate(BaseModel):
    name: str = Field(min_length=2, max_length=64)
    display_name: str = Field(default="", max_length=120)
    description: str = Field(default="", max_length=2000)
    category: str = Field(default="业务连接器", max_length=60)
    permission: str = Field(default="", max_length=100)
    risk: Literal["read", "write", "delete"] = "read"
    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"] = "GET"
    url_template: str = Field(min_length=8, max_length=1000)
    headers: dict[str, str] = Field(default_factory=dict)
    input_schema: dict[str, Any] = Field(
        default_factory=lambda: {"type": "object", "properties": {}}
    )
    enabled: bool = True


class DynamicToolUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=64)
    display_name: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    category: str | None = Field(default=None, max_length=60)
    permission: str | None = Field(default=None, max_length=100)
    risk: Literal["read", "write", "delete"] | None = None
    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"] | None = None
    url_template: str | None = Field(default=None, min_length=8, max_length=1000)
    headers: dict[str, str] | None = None
    input_schema: dict[str, Any] | None = None
    enabled: bool | None = None


class DynamicToolTestBody(BaseModel):
    arguments: dict[str, Any] = Field(default_factory=dict)


class TranscribeBody(BaseModel):
    audio_data_url: str = Field(min_length=32, max_length=20_000_000)
    language: str | None = Field(default=None, max_length=20)


class SpeechBody(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    model_row_id: int | None = Field(default=None, gt=0)
    voice: str | None = Field(default=None, min_length=1, max_length=160)
    response_format: Literal["mp3", "wav", "opus", "aac", "flac", "pcm"] | None = None
    speed: float | None = Field(default=None, ge=0.25, le=4)


class SkillCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    slug: str = Field(default="", max_length=100)
    description: str = Field(default="", max_length=300)
    content: str = Field(min_length=1, max_length=20000)
    kind: Literal["prompt"] = "prompt"
    license: str = Field(default="", max_length=200)
    metadata: dict[str, Any] = Field(default_factory=dict)
    files: dict[str, str] = Field(default_factory=dict)
    enabled: bool = True


class SkillUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    slug: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=300)
    content: str | None = Field(default=None, min_length=1, max_length=20000)
    kind: Literal["prompt"] | None = None
    license: str | None = Field(default=None, max_length=200)
    metadata: dict[str, Any] | None = None
    files: dict[str, str] | None = None
    enabled: bool | None = None


class ConfigUpdate(BaseModel):
    llm_temperature: float | None = Field(default=None, ge=0, le=2)
    max_iterations: int | None = Field(default=None, ge=0)
    max_tool_calls: int | None = Field(default=None, ge=0)
    max_run_seconds: int | None = Field(default=None, ge=10, le=900)
    context_max_tokens: int | None = Field(default=None, ge=0, le=1_000_000)
    context_compression: bool | None = None
    bm25_enabled: bool | None = None
    tool_selection_mode: Literal["none", "bm25", "decision"] | None = None
    decision_enabled: bool | None = None
    decision_model_id: int | None = Field(default=None, ge=0)
    decision_tools: bool | None = None
    decision_skills: bool | None = None
    decision_threshold: float | None = Field(default=None, gt=0, lt=1)
    decision_min_count: int | None = Field(default=None, ge=1, le=200)
    decision_timeout_seconds: float | None = Field(default=None, ge=1, le=30)
    context_reserve_tokens: int | None = Field(default=None, ge=0, le=100_000)
    compaction_model_id: int | None = None
    compaction_keep_ratio: float | None = Field(default=None, ge=0.2, le=0.9)
    session_retention_days: int | None = Field(default=None, ge=0, le=3650)
    admin_session_content: bool | None = None
    store_reasoning: bool | None = None
    user_daily_token_limit: int | None = Field(default=None, ge=0, le=100_000_000)
    memory_enabled: bool | None = None
    system_prompt_extra: str | None = Field(default=None, max_length=4000)
    demo_mode: bool | None = None
    default_reasoning_effort: Literal["", "off", "none", "minimal", "low", "medium", "high", "xhigh"] | None = None
    default_approval_mode: Literal["confirm", "full_access"] | None = None
    allow_full_access: bool | None = None
    welcome_title: str | None = Field(default=None, max_length=120)
    welcome_subtitle: str | None = Field(default=None, max_length=500)
    welcome_prompts: str | None = Field(default=None, max_length=4000)
    asr_model_id: int | None = None
    tts_model_id: int | None = Field(default=None, ge=0)
    title_model_id: int | None = None
    fallback_model_id: int | None = None
    retry_enabled: bool | None = None
    retry_max_attempts: int | None = Field(default=None, ge=1, le=8)
    retry_initial_backoff_ms: int | None = Field(default=None, ge=100, le=60_000)
    retry_max_backoff_ms: int | None = Field(default=None, ge=100, le=120_000)
    retry_multiplier: float | None = Field(default=None, ge=1, le=10)
    retry_jitter: float | None = Field(default=None, ge=0, le=1)
    retry_honor_retry_after: bool | None = None
    retry_max_elapsed_seconds: int | None = Field(default=None, ge=1, le=600)


class SessionCreate(BaseModel):
    assistant_id: int | None = None
    title: str = Field(default="新对话", max_length=120)


class SessionUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    assistant_id: int | None = None


class CompactBody(BaseModel):
    model_row_id: int | None = None


class ForkBody(BaseModel):
    until_message_id: int | None = None
    title: str | None = Field(default=None, min_length=1, max_length=120)


class MessageEditBody(BaseModel):
    content: str = Field(min_length=1, max_length=20000)


class PagePilotConfigUpdate(BaseModel):
    base_url: str = Field(min_length=8, max_length=500)
    token: str | None = Field(default=None, max_length=800)
    clear_token: bool = False
    enabled: bool | None = None
    default_title: str | None = Field(default=None, max_length=120)
    default_description: str | None = Field(default=None, max_length=240)
    default_visibility: Literal["public", "unlisted"] | None = None


class PagePilotPublishBody(BaseModel):
    html: str = Field(min_length=20, max_length=3_200_000)
    title: str = Field(default="", max_length=120)
    description: str = Field(default="", max_length=240)
    filename: str = Field(default="index.html", max_length=160)
    code: str = Field(default="", max_length=300)
    access_password: str | None = Field(default=None, max_length=200)
    visibility: Literal["public", "unlisted"] | None = None
    session_id: str | None = Field(default=None, max_length=80)
    publication_id: int | None = Field(default=None, gt=0)


class ArtifactScreenshotBody(BaseModel):
    html: str = Field(min_length=20, max_length=3_200_000)


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
    max_steps: int = Field(default=0, ge=0)
    max_tool_calls: int = Field(default=0, ge=0)
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
    max_steps: int | None = Field(default=None, ge=0)
    max_tool_calls: int | None = Field(default=None, ge=0)
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
    publications.recover_interrupted()
    config = runtime_config()
    db.purge_old_sessions(int(config.get("session_retention_days") or 0))


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


async def _session_admin(token: str) -> dict[str, Any]:
    user = await runtime.identity_from_token(token)
    permissions = set(user.get("permissions", []))
    if not user.get("is_admin") and "session:read_all" not in permissions:
        raise AgentError("需要 session:read_all 权限才能查看全部会话", 403)
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
        "requires_key": provider_requires_key(provider),
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


def _session_detail(session_id: str, include_content: bool) -> dict[str, Any] | None:
    session = sessions.get_session_admin(session_id)
    if session is None:
        return None
    messages = sessions.list_messages_admin(session_id)
    compaction_events = db.list_compaction_events(session_id)
    llm_calls = db.list_llm_calls(session_id, limit=500)
    if not include_content:
        session = dict(session)
        session["summary"] = "[内容已隐藏]"
        session["title"] = "[内容已隐藏]"
        session["last_error"] = ""
        for message in messages:
            message["content"] = "[内容已隐藏]"
            message["reasoning"] = ""
            message["attachments"] = []
            message["metadata"] = {
                key: value for key, value in (message.get("metadata") or {}).items()
                if key in {"status", "approval_status", "usage", "run", "model_row_id", "reasoning"}
            }
            run = message["metadata"].get("run")
            if isinstance(run, dict):
                message["metadata"]["run"] = {key: value for key, value in run.items() if key != "reasoning"}
            runs = []
            for run in message.get("tool_runs") or []:
                item = dict(run)
                item["arguments"] = {}
                item["result"] = None
                item["result_text"] = ""
                item["summary"] = "[内容已隐藏]"
                runs.append(item)
            message["tool_runs"] = runs
        for item in [*compaction_events, *llm_calls]:
            item["error"] = ""
    return {
        "session": session,
        "messages": messages,
        "compaction_events": compaction_events,
        "llm_calls": llm_calls,
        "privacy": {"include_content": include_content},
    }


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


def _validate_model_protocols(model: dict[str, Any], provider: dict[str, Any]) -> None:
    try:
        if model.get("model_kind") == "decision":
            decision.connection_config(model, provider)
        if model.get("model_kind") == "tts":
            from webagent.agent.speech import SpeechError, synthesis_config

            try:
                synthesis_config({**model, "enabled": True}, {**provider, "enabled": True, "api_key": provider.get("api_key") or "configuration-validation"})
            except SpeechError as exc:
                raise ProviderError(str(exc)) from exc
        reasoning_config(model)
        transcription_config(model, provider)
    except ProviderError as exc:
        raise AgentError(str(exc), 422) from exc


def _asr_status(config: dict[str, Any]) -> dict[str, Any]:
    model_id = config.get("asr_model_id")
    model = db.get_model(int(model_id)) if model_id else None
    result = {
        "configured": False,
        "model_id": model_id,
        "model_name": model.get("name", "") if model else "",
        "protocol": "",
        "reason": "管理员尚未设置默认语音识别模型",
    }
    if not model:
        return result
    provider = db.get_provider(int(model["provider_id"])) if model.get("provider_id") else None
    if not model.get("enabled") or not model.get("supports_transcription"):
        result["reason"] = "所选模型未启用语音转写能力"
    elif not provider or not provider.get("enabled") or (provider_requires_key(provider) and not provider.get("api_key")):
        result["reason"] = "语音模型的供应商未启用或尚未配置密钥"
    else:
        try:
            protocol = transcription_config(model, provider)["protocol"]
            result["protocol"] = protocol
            if protocol == "realtime":
                result["reason"] = "所选模型使用 WebSocket 实时语音协议，不能用于当前录音文件转写"
            else:
                result.update(configured=True, reason="")
        except ProviderError as exc:
            result["reason"] = str(exc)
    return result


def _tts_status(config: dict[str, Any]) -> dict[str, Any]:
    from webagent.agent.speech import SpeechError, synthesis_config

    model_id = config.get("tts_model_id")
    model = db.get_model(int(model_id)) if model_id else None
    result: dict[str, Any] = {
        "configured": False, "model_id": model_id,
        "model_name": model.get("name", "") if model else "",
        "reason": "管理员尚未设置默认语音合成模型",
    }
    if not model:
        return result
    provider = db.get_provider(int(model.get("provider_id") or 0))
    if not provider:
        result["reason"] = "语音合成模型的供应商不存在"
        return result
    try:
        settings = synthesis_config(model, provider)
        result.update(configured=True, reason="")
        result.update({key: settings[key] for key in ("protocol", "voice", "response_format", "speed", "formats", "speed_min", "speed_max", "max_text_length") if key in settings})
    except SpeechError as exc:
        result["reason"] = str(exc)
    return result


def _config_public() -> dict[str, Any]:
    config = runtime_config()
    retry = config.get("retry") or {}
    return {
        "llm_temperature": config["temperature"],
        "max_iterations": config["max_iterations"],
        "max_tool_calls": config["max_tool_calls"],
        "max_run_seconds": config["max_run_seconds"],
        "context_max_tokens": config["context_max_tokens"],
        "context_compression": config["context_compression"],
        "bm25_enabled": config["bm25_enabled"],
        **{key: config[key] for key in (
            "tool_selection_mode", "decision_enabled", "decision_model_id", "decision_tools",
            "decision_skills", "decision_threshold", "decision_min_count", "decision_timeout_seconds",
        )},
        "context_reserve_tokens": config["context_reserve_tokens"],
        "compaction_model_id": config["compaction_model_id"],
        "compaction_keep_ratio": config["compaction_keep_ratio"],
        "session_retention_days": config["session_retention_days"],
        "admin_session_content": config["admin_session_content"],
        "store_reasoning": config["store_reasoning"],
        "user_daily_token_limit": config["user_daily_token_limit"],
        "memory_enabled": config["memory_enabled"],
        "system_prompt_extra": config["system_prompt_extra"],
        "demo_mode": config["demo_mode"],
        "effective_demo_mode": config["demo_mode"],
        "default_reasoning_effort": config["default_reasoning_effort"],
        "default_approval_mode": config["default_approval_mode"],
        "allow_full_access": config["allow_full_access"],
        "welcome_title": config["welcome_title"],
        "welcome_subtitle": config["welcome_subtitle"],
        "welcome_prompts": config["welcome_prompts"],
        "asr_model_id": config["asr_model_id"],
        "tts_model_id": config["tts_model_id"],
        "title_model_id": config["title_model_id"],
        "fallback_model_id": config["fallback_model_id"],
        "provider_count": len(db.get_providers(include_disabled=True)),
        "model_count": len(db.get_models(include_disabled=True)),
        "assistants": len(db.get_assistants(include_disabled=True)),
        "retry_enabled": retry.get("enabled", True),
        "retry_max_attempts": retry.get("max_attempts", 3),
        "retry_initial_backoff_ms": retry.get("initial_backoff_ms", 800),
        "retry_max_backoff_ms": retry.get("max_backoff_ms", 8000),
        "retry_multiplier": retry.get("multiplier", 2.0),
        "retry_jitter": retry.get("jitter", 0.2),
        "retry_honor_retry_after": retry.get("honor_retry_after", True),
        "retry_max_elapsed_seconds": retry.get("max_elapsed_seconds", 60),
    }


class RunChannel:
    def __init__(self, run_id: str, user_id: int) -> None:
        self.run_id = run_id
        self.user_id = user_id
        self.events: list[tuple[int, str, dict[str, Any]]] = []
        self.closed = False
        self.created_at = time.time()
        self.condition = asyncio.Condition()
        self.task: asyncio.Task[Any] | None = None

    async def emit(self, event_type: str, payload: dict[str, Any]) -> None:
        async with self.condition:
            event_id = len(self.events) + 1
            self.events.append((event_id, event_type, payload))
            self.condition.notify_all()

    async def close(self) -> None:
        async with self.condition:
            self.closed = True
            self.condition.notify_all()

    async def subscribe(self, last_event_id: int = 0):
        cursor = max(0, last_event_id)
        while True:
            heartbeat = False
            async with self.condition:
                pending = [
                    item for item in self.events if item[0] > cursor
                ]
                if not pending and not self.closed:
                    try:
                        await asyncio.wait_for(
                            self.condition.wait(), timeout=15.0
                        )
                    except asyncio.TimeoutError:
                        heartbeat = True
                    else:
                        pending = [
                            item for item in self.events if item[0] > cursor
                        ]
                if heartbeat:
                    pending = []
                closed = self.closed
            if heartbeat:
                yield _sse_event(
                    0,
                    "heartbeat",
                    {"run_id": self.run_id, "ts": int(time.time())},
                )
                continue
            for event_id, event_type, payload in pending:
                cursor = event_id
                yield _sse_event(event_id, event_type, payload)
            if closed and not pending:
                return


RUNS: dict[str, RunChannel] = {}
RUNS_LOCK = asyncio.Lock()
RUN_TTL_SECONDS = 30 * 60


def _sse_event(event_id: int, event_type: str, payload: dict[str, Any]) -> str:
    try:
        data = json.dumps(payload, ensure_ascii=False)
    except (TypeError, ValueError):
        logger.exception("SSE payload serialization failed for %s", event_type)
        data = json.dumps(payload, ensure_ascii=False, default=str)
    prefix = f"id: {event_id}\n" if event_id else ""
    return f"{prefix}event: {event_type}\ndata: {data}\n\n"


async def _new_run_channel(user_id: int) -> RunChannel:
    async with RUNS_LOCK:
        now = time.time()
        expired = [
            key
            for key, channel in RUNS.items()
            if channel.closed and now - channel.created_at > RUN_TTL_SECONDS
        ]
        for key in expired:
            RUNS.pop(key, None)
        if sum(not channel.closed and channel.user_id == user_id for channel in RUNS.values()) >= 4:
            raise AgentError("当前账号已有多个任务执行中，请等待完成后再发起请求", 429)
        if len(RUNS) >= 120:
            completed = [channel for channel in RUNS.values() if channel.closed]
            if not completed:
                raise AgentError("服务当前繁忙，请稍后重试", 429)
            oldest = min(completed, key=lambda item: item.created_at)
            RUNS.pop(oldest.run_id, None)
        run_id = secrets.token_urlsafe(12)
        channel = RunChannel(run_id, user_id)
        RUNS[run_id] = channel
        return channel


async def _run_chat_job(
    channel: RunChannel,
    token: str,
    text: str,
    body: ChatBody,
) -> None:
    try:
        result = await runtime.chat(
            token,
            text,
            body.model_row_id,
            body.enabled_tools,
            assistant_id=body.assistant_id,
            session_id=body.session_id,
            attachments=[item.model_dump() for item in body.attachments],
            reasoning_effort=body.reasoning_effort,
            approval_mode=body.approval_mode,
            emit=channel.emit,
        )
        has_text_delta = any(
            event_type == "text.delta" for _, event_type, _ in channel.events
        )
        if not has_text_delta:
            answer = str(result.get("answer") or "")
            for index in range(0, len(answer), 28):
                await channel.emit("text.delta", {"delta": answer[index : index + 28]})
                await asyncio.sleep(0.018)
        await channel.emit(
            "run.completed",
            {
                "status": result.get("status"),
                "session_id": result.get("session_id"),
                "answer": result.get("answer"),
                "usage": result.get("usage") or {},
                "context": result.get("context") or {},
                "run": result.get("run") or {},
                "tool_runs": result.get("tool_runs") or [],
                "approval": result.get("approval"),
                "demo_mode": result.get("demo_mode"),
                "approval_mode": result.get("approval_mode"),
                "model": result.get("model"),
                "budget": result.get("budget"),
                "session_usage": result.get("session_usage"),
                "enabled_tools": result.get("enabled_tools"),
                "tool_retrieval": result.get("tool_retrieval"),
            },
        )
    except asyncio.CancelledError:
        logger.warning("run %s cancelled", channel.run_id)
        raise
    except AgentError as exc:
        await channel.emit(
            "run.failed",
            {"message": exc.message, "status_code": exc.status_code},
        )
    except Exception as exc:  # noqa: BLE001 - reported through the stream
        logger.exception("run %s failed", channel.run_id)
        await channel.emit("run.failed", {"message": str(exc)[:800]})
    finally:
        await channel.close()


async def _start_stream(
    body: ChatBody,
    request: Request,
    last_event_id: int = 0,
) -> StreamingResponse:
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
    user = await runtime.identity_from_token(token)
    channel = await _new_run_channel(int(user["id"]))
    channel.task = asyncio.create_task(
        _run_chat_job(channel, token, text, body)
    )
    return StreamingResponse(
        channel.subscribe(last_event_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "X-Run-Id": channel.run_id,
        },
    )


@app.get("/health")
async def health() -> dict[str, Any]:
    mcp_ok = False
    try:
        async with httpx2.AsyncClient(timeout=1.5) as client:
            response = await client.get(MCP_HEALTH_URL)
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
        reasoning_effort=body.reasoning_effort,
        approval_mode=body.approval_mode,
    )


@app.post("/api/chat/stream")
async def chat_stream(
    body: ChatBody,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
    last_event_id: int = Header(default=0, alias="Last-Event-ID"),
) -> StreamingResponse:
    _verify_internal(x_internal_token)
    return await _start_stream(body, request, last_event_id)


@app.get("/api/chat/stream/{run_id}")
async def resume_chat_stream(
    run_id: str,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
    last_event_id: int = Header(default=0, alias="Last-Event-ID"),
) -> StreamingResponse:
    _verify_internal(x_internal_token)
    user = await runtime.identity_from_token(_bearer(request))
    async with RUNS_LOCK:
        channel = RUNS.get(run_id)
    if channel is None:
        raise AgentError("运行记录不存在或已过期", 404)
    if channel.user_id != int(user["id"]):
        raise AgentError("不能恢复其他用户的运行记录", 403)
    return StreamingResponse(
        channel.subscribe(last_event_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/transcribe")
async def transcribe(
    body: TranscribeBody,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await runtime.identity_from_token(_bearer(request))
    config = runtime_config()
    model_id = config.get("asr_model_id")
    if not model_id:
        raise AgentError("管理员还没有配置语音识别模型", 400)
    model = db.get_model(int(model_id))
    if not model or not model.get("enabled") or not model.get("provider_id"):
        raise AgentError("语音识别模型不可用，请联系管理员", 400)
    provider = db.get_provider(int(model["provider_id"]))
    if not provider or not provider.get("enabled"):
        raise AgentError("语音识别模型的供应商不可用", 400)
    availability = _asr_status(config)
    if not availability["configured"]:
        raise AgentError(availability["reason"], 422)
    data_url = body.audio_data_url
    if not data_url.startswith("data:audio/") or ";base64," not in data_url:
        raise AgentError("音频格式不正确", 422)
    header, payload = data_url.split(",", 1)
    mime_type = header[5:].split(";")[0]
    try:
        audio = base64.b64decode(payload, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise AgentError("音频不是有效的 Base64 数据", 422) from exc
    if len(audio) > 12 * 1024 * 1024:
        raise AgentError("录音不能超过 12 MB", 413)
    try:
        result = await transcribe_audio(
            audio=audio, mime_type=mime_type, filename="voice.webm",
            model=model, provider=provider, language=body.language or (model.get("extra_params") or {}).get("_asr", {}).get("language") or "zh",
        )
    except Exception as exc:  # noqa: BLE001
        raise AgentError(f"语音识别失败：{str(exc)[:400]}", 502) from exc
    db.log_audit(
        username=user["username"],
        action="agent.transcribe",
        resource=f"model:{model['id']}",
        detail={"bytes": len(audio), "mime_type": mime_type},
    )
    return result


@app.post("/api/audio/speech")
async def audio_speech(
    body: SpeechBody,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> Response:
    from webagent.agent.speech import SpeechError, synthesize_speech

    _verify_internal(x_internal_token)
    user = await runtime.identity_from_token(_bearer(request))
    config = runtime_config()
    model_id = body.model_row_id or config.get("tts_model_id")
    if body.model_row_id and not user.get("is_admin"):
        raise AgentError("普通用户只能使用管理员指定的默认 TTS 模型", 403)
    if not model_id:
        raise AgentError("管理员尚未配置默认语音合成模型", 422)
    model = db.get_model(int(model_id))
    provider = db.get_provider(int(model.get("provider_id") or 0)) if model else None
    if not model or not provider or model.get("model_kind") != "tts":
        raise AgentError("语音合成模型不可用", 422)
    try:
        result = await synthesize_speech(
            text=body.text, model=model, provider=provider, voice=body.voice,
            response_format=body.response_format, speed=body.speed,
        )
    except SpeechError as exc:
        raise AgentError(str(exc), 502) from exc
    db.log_audit(
        username=user["username"], action="agent.speech", resource=f"model:{model['id']}",
        detail={"characters": len(body.text), "bytes": len(result["audio"]), "latency_ms": result["latency_ms"], "protocol": result["protocol"]},
    )
    return Response(content=result["audio"], media_type=result["mime_type"], headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


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
                "model_kind": item.get("model_kind", "chat"),
                "is_default": item["is_default"],
                "provider_id": item.get("provider_id"),
                "provider_name": item.get("provider_name"),
                "capabilities": item.get("capabilities", ["text"]),
                "supports_tools": item.get("supports_tools", True),
                "context_window": item.get("context_window", 0),
                "max_output_tokens": item.get("max_output_tokens", 0),
                "supports_reasoning": item.get("supports_reasoning", False),
                "reasoning_efforts": reasoning_config(item)["efforts"],
                "reasoning_can_disable": reasoning_config(item)["can_disable"],
                "default_reasoning_effort": item.get(
                    "default_reasoning_effort", ""
                ),
                "supports_reasoning_summary": item.get(
                    "supports_reasoning_summary", True
                ),
                "supports_transcription": item.get(
                    "supports_transcription", False
                ),
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
            "slug": item.get("slug", ""),
            "description": item["description"],
            "kind": item.get("kind", "prompt"),
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
    assistant_id = body.assistant_id
    if assistant_id is None:
        available = db.assistants_for_user(user)
        if available:
            assistant_id = int(available[0]["id"])
    if body.assistant_id:
        _assistant_for_user(user, body.assistant_id)
    session = sessions.create_session(
        user, title=body.title, assistant_id=assistant_id
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
    runtime.ensure_session_idle(session_id)
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
    runtime.ensure_session_idle(session_id)
    if not sessions.clear_messages(session_id, user["id"]):
        raise AgentError("会话不存在或不属于当前账号", 404)
    return {"ok": True}


@app.post("/api/sessions/{session_id}/fork", status_code=201)
async def fork_session(
    session_id: str,
    request: Request,
    body: ForkBody | None = None,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await runtime.identity_from_token(_bearer(request))
    session = sessions.fork_session(
        session_id,
        user["id"],
        until_message_id=(body.until_message_id if body else None),
        title=(body.title if body else None),
    )
    if session is None:
        raise AgentError("会话不存在或不属于当前账号", 404)
    return {"session": session}


@app.patch("/api/sessions/{session_id}/messages/{message_id}")
async def edit_session_message(
    session_id: str,
    message_id: int,
    body: MessageEditBody,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await runtime.identity_from_token(_bearer(request))
    runtime.ensure_session_idle(session_id)
    message = sessions.update_message_owned(
        session_id,
        message_id,
        user["id"],
        content=body.content,
    )
    if message is None:
        raise AgentError("消息不存在、不属于当前账号或不是用户消息", 404)
    return {"message": message}


@app.delete("/api/sessions/{session_id}/messages/{message_id}")
async def delete_session_message(
    session_id: str,
    message_id: int,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await runtime.identity_from_token(_bearer(request))
    runtime.ensure_session_idle(session_id)
    if not sessions.delete_message(session_id, message_id, user["id"]):
        raise AgentError("消息不存在或不属于当前账号", 404)
    return {"ok": True}


@app.post("/api/sessions/{session_id}/compact")
async def compact_session(
    session_id: str,
    request: Request,
    body: CompactBody | None = None,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    token = _bearer(request)
    result = await runtime.compact_session_now(
        token,
        session_id,
        model_row_id=(body.model_row_id if body else None),
    )
    if result.get("session") is None:
        raise AgentError("会话不存在或不属于当前账号", 404)
    return result


@app.get("/api/usage/me")
async def my_usage(
    request: Request,
    days: int = Query(default=7, ge=1, le=90),
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await runtime.identity_from_token(_bearer(request))
    config = runtime_config()
    return {
        "usage": db.user_usage(user["username"], days=days),
        "daily_limit": config["user_daily_token_limit"],
        "used_today": db.user_daily_usage(user["username"]),
    }


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
    kind = values.get("model_kind")
    if kind in {"asr", "asr_realtime"}:
        values["supports_transcription"] = True
    if kind and kind not in {"chat", "vision"}:
        values["supports_tools"] = False
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
    current_config = runtime_config()
    for key in ("compaction_model_id", "title_model_id", "fallback_model_id"):
        reference = getattr(body, key)
        if reference:
            target = db.get_model(reference)
            if not target or target.get("model_kind") not in {"chat", "vision"}:
                raise AgentError("标题、摘要和降级用途只能选择对话模型", 422)
    mode = body.tool_selection_mode or current_config["tool_selection_mode"]
    if body.bm25_enabled is True and body.decision_enabled is True:
        raise AgentError("BM25 与决策模型只能启用一个，也可以全部关闭", 422)
    for requested, name in ((body.bm25_enabled, "bm25"), (body.decision_enabled, "decision")):
        if requested is None:
            continue
        if body.tool_selection_mode is not None and requested != (mode == name):
            raise AgentError("筛选策略与开关配置不一致", 422)
        if requested:
            mode = name
        elif mode == name:
            mode = "none"
    if any(value is not None for value in (body.tool_selection_mode, body.bm25_enabled, body.decision_enabled)):
        values["tool_selection_mode"] = mode
        values["bm25_enabled"] = "1" if mode == "bm25" else "0"
    for key in ("decision_model_id", "decision_threshold", "decision_min_count", "decision_timeout_seconds"):
        value = getattr(body, key)
        if value is not None:
            values[key] = str(value)
    for key in ("decision_tools", "decision_skills"):
        value = getattr(body, key)
        if value is not None:
            values[key] = "1" if value else "0"
    decision_fields = (
        body.tool_selection_mode, body.decision_enabled, body.decision_model_id,
        body.decision_tools, body.decision_skills,
    )
    if mode == "decision" and any(value is not None for value in decision_fields):
        target = db.get_model(body.decision_model_id if body.decision_model_id is not None else current_config["decision_model_id"] or 0)
        if not target or target.get("model_kind") != "decision" or not target.get("enabled") or not target.get("provider_enabled"):
            raise AgentError("请先添加并启用一个决策模型，再启用决策筛选", 422)
        scopes = [body.decision_tools, body.decision_skills]
        effective_scopes = [value if value is not None else current_config[key] for value, key in zip(scopes, ("decision_tools", "decision_skills"))]
        if not any(effective_scopes):
            raise AgentError("决策筛选至少选择工具或 Skill 中的一项", 422)
    if body.context_reserve_tokens is not None:
        values["context_reserve_tokens"] = str(body.context_reserve_tokens)
    if body.compaction_model_id is not None:
        values["compaction_model_id"] = (
            str(body.compaction_model_id) if body.compaction_model_id else ""
        )
    if body.compaction_keep_ratio is not None:
        values["compaction_keep_ratio"] = str(body.compaction_keep_ratio)
    if body.session_retention_days is not None:
        values["session_retention_days"] = str(body.session_retention_days)
    if body.admin_session_content is not None:
        values["admin_session_content"] = "1" if body.admin_session_content else "0"
    if body.store_reasoning is not None:
        values["store_reasoning"] = "1" if body.store_reasoning else "0"
    if body.user_daily_token_limit is not None:
        values["user_daily_token_limit"] = str(body.user_daily_token_limit)
    if body.memory_enabled is not None:
        values["memory_enabled"] = "1" if body.memory_enabled else "0"
    if body.system_prompt_extra is not None:
        values["system_prompt_extra"] = body.system_prompt_extra.strip()
    if body.demo_mode is not None:
        values["demo_mode"] = "1" if body.demo_mode else "0"
    if body.default_reasoning_effort is not None:
        values["default_reasoning_effort"] = body.default_reasoning_effort
    if body.default_approval_mode is not None:
        values["default_approval_mode"] = body.default_approval_mode
    if body.allow_full_access is not None:
        values["allow_full_access"] = "1" if body.allow_full_access else "0"
    if body.welcome_title is not None:
        values["welcome_title"] = body.welcome_title.strip()
    if body.welcome_subtitle is not None:
        values["welcome_subtitle"] = body.welcome_subtitle.strip()
    if body.welcome_prompts is not None:
        values["welcome_prompts"] = body.welcome_prompts.strip()
    if body.asr_model_id is not None:
        if body.asr_model_id:
            target = db.get_model(body.asr_model_id)
            if not target or target.get("model_kind") == "asr_realtime" or not target.get("supports_transcription"):
                raise AgentError("默认 STT 必须是支持录音文件识别的模型", 422)
        values["asr_model_id"] = str(body.asr_model_id) if body.asr_model_id else ""
    if body.tts_model_id is not None:
        if body.tts_model_id:
            target = db.get_model(body.tts_model_id)
            if not target or target.get("model_kind") != "tts":
                raise AgentError("默认 TTS 必须是语音合成模型", 422)
        values["tts_model_id"] = str(body.tts_model_id) if body.tts_model_id else ""
    if body.title_model_id is not None:
        values["title_model_id"] = (
            str(body.title_model_id) if body.title_model_id else ""
        )
    if body.fallback_model_id is not None:
        values["fallback_model_id"] = (
            str(body.fallback_model_id) if body.fallback_model_id else ""
        )
    if body.retry_enabled is not None:
        values["retry_enabled"] = "1" if body.retry_enabled else "0"
    if body.retry_max_attempts is not None:
        values["retry_max_attempts"] = str(body.retry_max_attempts)
    if body.retry_initial_backoff_ms is not None:
        values["retry_initial_backoff_ms"] = str(body.retry_initial_backoff_ms)
    if body.retry_max_backoff_ms is not None:
        values["retry_max_backoff_ms"] = str(body.retry_max_backoff_ms)
    if body.retry_multiplier is not None:
        values["retry_multiplier"] = str(body.retry_multiplier)
    if body.retry_jitter is not None:
        values["retry_jitter"] = str(body.retry_jitter)
    if body.retry_honor_retry_after is not None:
        values["retry_honor_retry_after"] = (
            "1" if body.retry_honor_retry_after else "0"
        )
    if body.retry_max_elapsed_seconds is not None:
        values["retry_max_elapsed_seconds"] = str(body.retry_max_elapsed_seconds)
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


@app.get("/api/admin/providers/presets")
async def admin_provider_presets(
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    await _admin(_bearer(request))
    return {"items": list_provider_presets()}


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
        items.append(
            {
                **item,
                "already_imported": bool(existing),
                "existing_model_row_id": existing["id"] if existing else None,
                # Keep discovery fast: full models.dev enrichment happens on
                # import or when the administrator edits a single model.
                "suggested": suggest_model_defaults(item["model_id"]),
            }
        )
    return {"provider": _provider_public(provider), "items": items}


@app.get("/api/admin/model-suggest")
async def admin_model_suggest(
    request: Request,
    model_id: str = Query(min_length=1, max_length=160),
    provider_id: int | None = Query(default=None),
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    await _admin(_bearer(request))
    provider_name = ""
    if provider_id:
        provider = db.get_provider(provider_id)
        provider_name = str(provider.get("name") or "") if provider else ""
    defaults = await enrich_model_defaults(model_id, provider_name)
    return {"model_id": model_id, "suggested": defaults}


@app.post("/api/admin/models/{model_row_id}/sync")
async def admin_sync_model(
    model_row_id: int,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await _admin(_bearer(request))
    model = db.get_model(model_row_id)
    if not model:
        raise AgentError("模型不存在", 404)
    provider = db.get_provider(int(model.get("provider_id") or 0))
    if not provider:
        raise AgentError("模型所属供应商不存在", 404)
    remote_name = ""
    try:
        remote_models = await list_remote_models(provider)
        for item in remote_models:
            if item.get("model_id") == model.get("model_id"):
                remote_name = str(item.get("name") or "")
                break
    except ProviderError:
        remote_models = []
    defaults = await enrich_model_defaults(
        str(model.get("model_id") or ""),
        str(provider.get("name") or ""),
    )
    if model.get("model_kind") in {"decision", "tts", "asr", "asr_realtime", "image_generation", "embedding", "rerank"}:
        kind = model["model_kind"]
        defaults.update(model_kind=kind, supports_tools=False, supports_transcription=kind in {"asr", "asr_realtime"})
        if kind != "decision":
            defaults.update(supports_reasoning=False, reasoning_efforts=[], default_reasoning_effort="")
    defaults["extra_params"] = model.get("extra_params") or {}
    defaults["metadata_source"] = "models.dev" if defaults.get("context_window") else model.get("metadata_source")
    if remote_name and not str(model.get("name") or "").strip():
        defaults["name"] = remote_name
    updated = db.update_model(model_row_id, defaults)
    db.log_audit(
        username=user["username"],
        action="model.sync",
        resource=f"model:{model_row_id}",
        detail={"model_id": model.get("model_id"), "remote_listed": bool(remote_models)},
    )
    return {"model": updated}


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
        defaults = await enrich_model_defaults(
            model_id, str(provider.get("name") or "")
        )
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
    _validate_model_protocols(body.model_dump(), provider)
    if body.is_default and body.model_kind not in {"chat", "vision"}:
        raise AgentError("只有对话或视觉模型可以设为默认对话模型", 422)
    is_default = body.model_kind in {"chat", "vision"} and (body.is_default or not db.default_model())
    supports_tools = body.supports_tools and body.model_kind in {"chat", "vision"}
    supports_transcription = body.supports_transcription or body.model_kind in {
        "asr",
        "asr_realtime",
    }
    model = db.create_model(
        provider_id=body.provider_id,
        name=body.name,
        model_id=body.model_id,
        model_kind=body.model_kind,
        enabled=body.enabled,
        is_default=is_default,
        capabilities=body.capabilities,
        supports_tools=supports_tools,
        context_window=body.context_window,
        max_output_tokens=body.max_output_tokens,
        temperature=body.temperature,
        top_p=body.top_p,
        input_price_per_1m=body.input_price_per_1m,
        output_price_per_1m=body.output_price_per_1m,
        supports_reasoning=body.supports_reasoning,
        reasoning_style=body.reasoning_style,
        reasoning_efforts=body.reasoning_efforts,
        default_reasoning_effort=body.default_reasoning_effort,
        supports_reasoning_summary=body.supports_reasoning_summary,
        supports_transcription=supports_transcription,
        metadata_source=body.metadata_source,
        extra_params=_validate_extra_params(body.extra_params),
    )
    db.log_audit(
        username=user["username"],
        action="model.create",
        resource=f"model:{model['id']}",
        detail={
            "name": model["name"],
            "model_id": model["model_id"],
            "model_kind": model["model_kind"],
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
    current = db.get_model(model_row_id)
    if current is None:
        raise AgentError("模型不存在", 404)
    if "provider_id" in values and not db.get_provider(values["provider_id"]):
        raise AgentError("供应商不存在", 404)
    if "extra_params" in values:
        values["extra_params"] = _validate_extra_params(values["extra_params"])
    merged = {**current, **values}
    if body.is_default and merged["model_kind"] not in {"chat", "vision"}:
        raise AgentError("只有对话或视觉模型可以设为默认对话模型", 422)
    provider = db.get_provider(int(merged["provider_id"]))
    if not provider:
        raise AgentError("供应商不存在", 404)
    _validate_model_protocols(merged, provider)
    if values.get("model_kind") in {"asr", "asr_realtime"}:
        values["supports_transcription"] = True
    if values.get("model_kind") and values["model_kind"] not in {"chat", "vision"}:
        values["supports_tools"] = False
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
    result = await test_llm(model, provider, {**runtime_config(), "demo_mode": False})
    db.log_audit(
        username=user["username"],
        action="model.test",
        resource=f"model:{model_row_id}",
        detail={"ok": result.get("ok"), "demo": result.get("demo")},
    )
    return result


@app.post("/api/admin/models/{model_row_id}/transcribe")
async def admin_test_transcription(
    model_row_id: int,
    body: TranscribeBody,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await _admin(_bearer(request))
    model = db.get_model(model_row_id)
    if not model or not model.get("enabled") or not model.get("supports_transcription"):
        raise AgentError("模型未启用语音转写能力", 422)
    provider = db.get_provider(int(model.get("provider_id") or 0))
    if not provider or not provider.get("enabled"):
        raise AgentError("语音识别供应商不可用", 422)
    ready, reason = runtime.provider_ready(provider)
    if not ready:
        raise AgentError(reason, 422)
    if not body.audio_data_url.startswith("data:audio/") or ";base64," not in body.audio_data_url:
        raise AgentError("请上传有效的音频 Data URI", 422)
    header, payload = body.audio_data_url.split(",", 1)
    try:
        audio = base64.b64decode(payload, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise AgentError("音频不是有效的 Base64 数据", 422) from exc
    if not audio or len(audio) > 12 * 1024 * 1024:
        raise AgentError("音频为空或超过 12 MB", 422)
    try:
        result = await transcribe_audio(
            audio=audio, mime_type=header[5:].split(";")[0], filename="model-test.wav",
            model=model, provider=provider, language=body.language or (model.get("extra_params") or {}).get("_asr", {}).get("language") or "zh",
        )
    except Exception as exc:
        raise AgentError(f"语音识别测试失败：{str(exc)[:400]}", 502) from exc
    db.log_audit(username=user["username"], action="model.transcribe_test", resource=f"model:{model_row_id}", detail={"bytes": len(audio), "protocol": result.get("protocol")})
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
    body: ToolConfigUpdate,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    token = _bearer(request)
    user = await _admin(token)
    items = await runtime.admin_all_tools(token)
    current = next((item for item in items if item["name"] == name), None)
    if current is None:
        raise AgentError("工具不存在", 404)
    values = body.model_dump(exclude_unset=True)
    merged = {
        "enabled": values.get("enabled", current.get("enabled", True)),
        "visible": values.get("visible", current.get("visible", True)),
        "selectable": values.get("selectable", current.get("selectable", True)),
        "default_selected": values.get(
            "default_selected", current.get("default_selected", True)
        ),
    }
    if not merged["visible"]:
        merged["selectable"] = False
    if merged["enabled"] and merged["visible"] and not merged["selectable"]:
        merged["default_selected"] = True
    setting = db.set_tool_setting(
        name,
        **merged,
        source=str(current.get("source") or "mcp"),
        definition=current.get("definition") or {},
    )
    db.log_audit(
        username=user["username"],
        action="tool.toggle",
        resource=f"tool:{name}",
        detail=merged,
    )
    return {"tool": {**current, **setting}}


async def _check_dynamic_tool_name(token: str, name: str) -> None:
    reserved = {"load_skill", "read_skill_file", pagepilot.TOOL_NAME, pagepilot.LIST_TOOL_NAME, pagepilot.GET_TOOL_NAME}
    tools = await runtime.admin_all_tools(token)
    if name in reserved or any(item["name"] == name and item.get("source") != "dynamic" for item in tools):
        raise AgentError("工具名与已有 MCP 或内置工具冲突，请使用独立的业务工具名", 409)


@app.get("/api/admin/dynamic-tools")
async def admin_dynamic_tools(
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    await _admin(_bearer(request))
    items = db.get_dynamic_tools(include_disabled=True)
    return {"items": items, "total": len(items)}


@app.post("/api/admin/dynamic-tools", status_code=201)
async def admin_create_dynamic_tool(
    body: DynamicToolCreate,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    token = _bearer(request)
    user = await _admin(token)
    if db.get_dynamic_tool_by_name(body.name):
        raise AgentError("工具名已存在", 409)
    await _check_dynamic_tool_name(token, body.name)
    try:
        values = dynamic_tools.validate_dynamic_tool(body.model_dump())
    except dynamic_tools.DynamicToolError as exc:
        raise AgentError(str(exc), 422) from exc
    tool = db.create_dynamic_tool(**values)
    db.log_audit(
        username=user["username"],
        action="dynamic_tool.create",
        resource=f"dynamic_tool:{tool['id']}",
        detail={"name": tool["name"], "method": tool["method"], "url": tool["url_template"]},
    )
    return {"tool": tool}


@app.put("/api/admin/dynamic-tools/{tool_id}")
async def admin_update_dynamic_tool(
    tool_id: int,
    body: DynamicToolUpdate,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    token = _bearer(request)
    user = await _admin(token)
    current = db.get_dynamic_tool(tool_id)
    if not current:
        raise AgentError("动态工具不存在", 404)
    updates = body.model_dump(exclude_unset=True)
    merged = {**current, **updates}
    try:
        validated = dynamic_tools.validate_dynamic_tool(merged)
    except dynamic_tools.DynamicToolError as exc:
        raise AgentError(str(exc), 422) from exc
    if validated["name"] != current["name"] and db.get_dynamic_tool_by_name(
        validated["name"]
    ):
        raise AgentError("工具名已存在", 409)
    await _check_dynamic_tool_name(token, validated["name"])
    tool = db.update_dynamic_tool(
        tool_id,
        {
            key: validated[key]
            for key in (
                "name",
                "display_name",
                "description",
                "category",
                "permission",
                "risk",
                "method",
                "url_template",
                "headers",
                "input_schema",
                "enabled",
            )
        },
    )
    db.log_audit(
        username=user["username"],
        action="dynamic_tool.update",
        resource=f"dynamic_tool:{tool_id}",
        detail={"keys": sorted(updates)},
    )
    return {"tool": tool}


@app.delete("/api/admin/dynamic-tools/{tool_id}")
async def admin_delete_dynamic_tool(
    tool_id: int,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await _admin(_bearer(request))
    if not db.delete_dynamic_tool(tool_id):
        raise AgentError("动态工具不存在", 404)
    db.log_audit(
        username=user["username"],
        action="dynamic_tool.delete",
        resource=f"dynamic_tool:{tool_id}",
    )
    return {"ok": True}


@app.post("/api/admin/dynamic-tools/{tool_id}/test")
async def admin_test_dynamic_tool(
    tool_id: int,
    request: Request,
    body: DynamicToolTestBody | None = None,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    token = _bearer(request)
    await _admin(token)
    tool = db.get_dynamic_tool(tool_id)
    if not tool:
        raise AgentError("动态工具不存在", 404)
    spec = dynamic_tools.spec_from_row(tool)
    result = await dynamic_tools.test_dynamic_tool(
        token, spec, (body.arguments if body else {})
    )
    return {"tool": tool, **result}


@app.get("/api/admin/pagepilot")
async def admin_pagepilot(
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    await _admin(_bearer(request))
    return {"config": pagepilot.public_config()}


@app.put("/api/admin/pagepilot")
async def admin_update_pagepilot(
    body: PagePilotConfigUpdate,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await _admin(_bearer(request))
    try:
        config = pagepilot.save_config(
            base_url=body.base_url,
            token=body.token,
            clear_token=body.clear_token,
            enabled=body.enabled,
            default_title=body.default_title,
            default_description=body.default_description,
            default_visibility=body.default_visibility,
        )
    except pagepilot.PagePilotError as exc:
        raise AgentError(str(exc), 422) from exc
    db.log_audit(
        username=user["username"],
        action="pagepilot.config",
        resource="pagepilot:connector",
        detail={"base_url": config["base_url"], "enabled": config["enabled"]},
    )
    return {"config": config}


@app.post("/api/admin/pagepilot/test")
async def admin_test_pagepilot(
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    await _admin(_bearer(request))
    return await pagepilot.test_connection()


@app.get("/api/pagepilot/status")
async def pagepilot_status(
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    await runtime.identity_from_token(_bearer(request))
    return pagepilot.status_for_user()


@app.post("/api/pagepilot/publish")
async def pagepilot_publish(
    body: PagePilotPublishBody,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await runtime.identity_from_token(_bearer(request))
    setting = db.get_tool_setting(pagepilot.TOOL_NAME, source="pagepilot")
    if not setting.get("enabled", True):
        raise AgentError("PagePilot 发布工具已被管理员停用", 403)
    try:
        return await pagepilot.publish_html(
            html=body.html,
            title=body.title,
            description=body.description,
            filename=body.filename,
            code=body.code,
            access_password=body.access_password,
            visibility=body.visibility,
            user=user,
            session_id=body.session_id,
            publication_id=body.publication_id,
            source="preview",
        )
    except pagepilot.PagePilotError as exc:
        raise AgentError(str(exc), exc.status_code) from exc


@app.get("/api/pagepilot/publications")
async def pagepilot_publications(
    request: Request,
    q: str = Query(default="", max_length=200),
    session_id: str | None = Query(default=None, max_length=80),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await runtime.identity_from_token(_bearer(request))
    return publications.list_publications(
        int(user["id"]), q=q, session_id=session_id, limit=limit, offset=offset
    )


@app.get("/api/pagepilot/publications/{publication_id}")
async def pagepilot_publication_detail(
    publication_id: int,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await runtime.identity_from_token(_bearer(request))
    try:
        return {"publication": publications.detail(publication_id, int(user["id"]))}
    except publications.PublicationError as exc:
        raise AgentError(str(exc), exc.status_code) from exc


@app.get("/api/pagepilot/publications/{publication_id}/versions/{version_id}")
async def pagepilot_publication_version(
    publication_id: int,
    version_id: int,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await runtime.identity_from_token(_bearer(request))
    try:
        return {"version": publications.version_detail(publication_id, version_id, int(user["id"]))}
    except publications.PublicationError as exc:
        raise AgentError(str(exc), exc.status_code) from exc


@app.post("/api/artifacts/screenshot")
async def artifact_screenshot(
    body: ArtifactScreenshotBody,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> Response:
    _verify_internal(x_internal_token)
    await runtime.identity_from_token(_bearer(request))
    try:
        png = await artifacts.render_html_png(body.html)
    except artifacts.ArtifactRenderError as exc:
        raise AgentError(str(exc), 503) from exc
    return Response(
        content=png,
        media_type="image/png",
        headers={
            "Content-Disposition": 'attachment; filename="webagent-report.png"',
            "Cache-Control": "no-store",
        },
    )


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
    if body.slug.strip() and db.skill_slug_exists(body.slug):
        raise AgentError(f"技能标识已被占用：{body.slug.strip()}", 409)
    skill = db.create_skill(
        body.name,
        body.description,
        body.content,
        enabled=body.enabled,
        slug=body.slug,
        kind=body.kind,
        license=body.license,
        metadata=body.metadata,
        files=body.files,
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
    slug = str(values.get("slug") or "").strip()
    if slug and db.skill_slug_exists(slug, exclude_id=skill_id):
        raise AgentError(f"技能标识已被占用：{slug}", 409)
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


@app.get("/api/admin/sessions")
async def admin_sessions(
    request: Request,
    username: str = Query(default="", max_length=100),
    assistant_id: int | None = Query(default=None),
    model: str = Query(default="", max_length=100),
    status: str = Query(default="", max_length=30),
    q: str = Query(default="", max_length=120),
    date_from: str = Query(default="", max_length=30),
    date_to: str = Query(default="", max_length=30),
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    await _session_admin(_bearer(request))
    if date_to and len(date_to) == 10:
        date_to = f"{date_to}T23:59:59"
    result = sessions.list_all_sessions(
        username=username.strip(),
        assistant_id=assistant_id,
        model=model.strip(),
        status=status.strip(),
        q=q.strip(),
        date_from=date_from.strip(),
        date_to=date_to.strip(),
        limit=limit,
        offset=offset,
    )
    if not runtime_config()["admin_session_content"]:
        for item in result["items"]:
            item.update(title="[内容已隐藏]", summary="[内容已隐藏]", last_error="")
    return result


@app.get("/api/admin/usage/summary")
async def admin_usage_summary(
    request: Request,
    days: int = Query(default=7, ge=1, le=90),
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    await _session_admin(_bearer(request))
    return db.usage_summary(days=days)


@app.get("/api/admin/sessions/{session_id}")
async def admin_session_detail(
    session_id: str,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _verify_internal(x_internal_token)
    user = await _session_admin(_bearer(request))
    config = runtime_config()
    detail = _session_detail(
        session_id, include_content=config["admin_session_content"]
    )
    if detail is None:
        raise AgentError("会话不存在", 404)
    db.log_audit(
        username=user["username"],
        action="admin.session.view",
        resource=f"session:{session_id}",
        detail={"include_content": config["admin_session_content"]},
    )
    return detail


@app.get("/api/admin/sessions/{session_id}/export")
async def admin_session_export(
    session_id: str,
    request: Request,
    format: Literal["json", "markdown", "csv"] = Query(default="json"),
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> Response:
    _verify_internal(x_internal_token)
    user = await _session_admin(_bearer(request))
    config = runtime_config()
    detail = _session_detail(
        session_id, include_content=config["admin_session_content"]
    )
    if detail is None:
        raise AgentError("会话不存在", 404)
    db.log_audit(
        username=user["username"],
        action="admin.session.export",
        resource=f"session:{session_id}",
        detail={
            "format": format,
            "include_content": config["admin_session_content"],
        },
    )
    session = detail["session"]
    messages = detail["messages"]
    if format == "json":
        content = json.dumps(detail, ensure_ascii=False, indent=2)
        media_type = "application/json; charset=utf-8"
        extension = "json"
    elif format == "csv":
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(
            [
                "message_id",
                "role",
                "created_at",
                "content",
                "token_estimate",
                "tool_count",
                "tool_statuses",
            ]
        )
        for message in messages:
            runs = message.get("tool_runs") or []
            writer.writerow(
                [
                    message["id"],
                    message["role"],
                    message["created_at"],
                    message["content"],
                    message["token_estimate"],
                    len(runs),
                    ",".join(str(run.get("status", "")) for run in runs),
                ]
            )
        content = buffer.getvalue()
        media_type = "text/csv; charset=utf-8"
        extension = "csv"
    else:
        lines = [
            f"# 会话 {session['id']}",
            "",
            f"- 用户：{session['username']}（ID {session['user_id']}）",
            f"- 助手：{session.get('assistant_name') or '—'}",
            f"- 模型：{session.get('last_model_name') or '—'}",
            f"- 状态：{session.get('last_status') or '—'}",
            f"- 消息数：{session.get('message_count', 0)}",
            f"- 累计 tokens：{session.get('total_tokens', 0)}",
            f"- 估算费用：${session.get('total_cost_usd', 0):.6f}",
            f"- 压缩次数：{session.get('compaction_count', 0)}",
            f"- 重试次数：{session.get('retry_count', 0)}",
            "",
            "## 消息",
            "",
        ]
        for message in messages:
            lines.append(
                f"### {message['role']} · {message['created_at']} · "
                f"{message.get('token_estimate', 0)} tokens"
            )
            lines.append("")
            lines.append(message.get("content") or "（无正文）")
            lines.append("")
            for run in message.get("tool_runs") or []:
                lines.append(
                    f"- 工具 `{run.get('tool')}`：{run.get('status')} "
                    f"{run.get('summary') or ''}"
                )
            if message.get("tool_runs"):
                lines.append("")
        content = "\n".join(lines)
        media_type = "text/markdown; charset=utf-8"
        extension = "md"
    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Content-Disposition": (
                f'attachment; filename="session-{session_id}.{extension}"'
            )
        },
    )


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
        "bm25_enabled": config["bm25_enabled"],
        "tool_selection_mode": config["tool_selection_mode"],
        "decision_enabled": config["decision_enabled"],
        "context_reserve_tokens": config["context_reserve_tokens"],
        "user_daily_token_limit": config["user_daily_token_limit"],
        "compaction_model_id": config["compaction_model_id"],
        "store_reasoning": config["store_reasoning"],
        "default_reasoning_effort": config["default_reasoning_effort"],
        "default_approval_mode": config["default_approval_mode"],
        "allow_full_access": config["allow_full_access"],
        "welcome_title": config["welcome_title"],
        "welcome_subtitle": config["welcome_subtitle"],
        "welcome_prompts": config["welcome_prompts"],
        "fallback_model_id": config["fallback_model_id"],
        "title_model_id": config["title_model_id"],
        "asr": _asr_status(config),
        "tts": _tts_status(config),
        "tool_retrieval_limit": 16,
    }
