"""OpenAI-compatible LLM access kept behind the Agent service boundary."""

from __future__ import annotations

import asyncio
import base64
import io
import json
import random
import re
import shutil
import time
import wave
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Awaitable, Callable

import httpx2
from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AsyncOpenAI,
    RateLimitError,
)

from webagent.agent import db
from webagent.agent.db import get_settings
from webagent.agent.providers import (
    ProviderError,
    chat_base_url,
    provider_requires_key,
    reasoning_config,
    request_headers,
    transcription_config,
)


RESERVED_REQUEST_PARAMS = {
    "model",
    "messages",
    "tools",
    "tool_choice",
    "stream",
    "api_key",
    "base_url",
    "extra_headers",
    "extra_query",
    "timeout",
}

CHAT_REQUEST_PARAMS = {
    "audio", "frequency_penalty", "function_call", "functions", "logit_bias",
    "logprobs", "max_completion_tokens", "max_tokens", "metadata", "modalities",
    "n", "parallel_tool_calls", "prediction", "presence_penalty", "prompt_cache_key",
    "prompt_cache_retention", "reasoning_effort", "response_format", "safety_identifier",
    "seed", "service_tier", "stop", "store", "stream_options", "temperature",
    "top_logprobs", "top_p", "user", "verbosity", "web_search_options",
}


RETRYABLE_STATUSES = {408, 409, 425, 429, 500, 502, 503, 504}
EventCallback = Callable[[str, dict[str, Any]], Awaitable[None]]


class LLMError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        retryable: bool = False,
        context_overflow: bool = False,
        attempts: int = 0,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.retryable = retryable
        self.context_overflow = context_overflow
        self.attempts = attempts


def _int_setting(settings: dict[str, str], key: str, default: int) -> int:
    try:
        return int(settings.get(key, str(default)))
    except (TypeError, ValueError):
        return default


def _float_setting(settings: dict[str, str], key: str, default: float) -> float:
    try:
        return float(settings.get(key, str(default)))
    except (TypeError, ValueError):
        return default


def retry_config(settings: dict[str, str] | None = None) -> dict[str, Any]:
    settings = settings or get_settings()
    return {
        "enabled": settings.get("retry_enabled", "1") == "1",
        "max_attempts": max(
            1, min(_int_setting(settings, "retry_max_attempts", 3), 8)
        ),
        "initial_backoff_ms": max(
            100, min(_int_setting(settings, "retry_initial_backoff_ms", 800), 60_000)
        ),
        "max_backoff_ms": max(
            100, min(_int_setting(settings, "retry_max_backoff_ms", 8000), 120_000)
        ),
        "multiplier": max(
            1.0, min(_float_setting(settings, "retry_multiplier", 2.0), 10.0)
        ),
        "jitter": max(0.0, min(_float_setting(settings, "retry_jitter", 0.2), 1.0)),
        "honor_retry_after": settings.get("retry_honor_retry_after", "1") == "1",
        "max_elapsed_seconds": max(
            1,
            min(_int_setting(settings, "retry_max_elapsed_seconds", 60), 600),
        ),
    }


def runtime_config() -> dict[str, Any]:
    settings = get_settings()
    try:
        temperature = float(settings.get("llm_temperature", "0.3"))
    except ValueError:
        temperature = 0.3
    try:
        max_iterations = int(settings.get("max_iterations", "6"))
    except ValueError:
        max_iterations = 6
    try:
        max_tool_calls = int(settings.get("max_tool_calls", "12"))
    except ValueError:
        max_tool_calls = 12
    try:
        max_run_seconds = int(settings.get("max_run_seconds", "120"))
    except ValueError:
        max_run_seconds = 120
    try:
        context_max_tokens = int(settings.get("context_max_tokens", "0"))
    except ValueError:
        context_max_tokens = 0
    demo_mode = settings.get("demo_mode", "1") == "1"
    try:
        context_reserve_tokens = int(settings.get("context_reserve_tokens", "1600"))
    except ValueError:
        context_reserve_tokens = 1600
    try:
        keep_ratio = float(settings.get("compaction_keep_ratio", "0.58"))
    except ValueError:
        keep_ratio = 0.58
    try:
        session_retention_days = int(settings.get("session_retention_days", "0"))
    except ValueError:
        session_retention_days = 0
    try:
        user_daily_token_limit = int(settings.get("user_daily_token_limit", "0"))
    except ValueError:
        user_daily_token_limit = 0
    try:
        compaction_model_id = int(settings.get("compaction_model_id", "") or 0)
    except ValueError:
        compaction_model_id = 0
    try:
        asr_model_id = int(settings.get("asr_model_id", "") or 0)
    except ValueError:
        asr_model_id = 0
    try:
        title_model_id = int(settings.get("title_model_id", "") or 0)
    except ValueError:
        title_model_id = 0
    try:
        fallback_model_id = int(settings.get("fallback_model_id", "") or 0)
    except ValueError:
        fallback_model_id = 0
    default_approval_mode = settings.get("default_approval_mode", "confirm")
    if default_approval_mode not in {"confirm", "full_access"}:
        default_approval_mode = "confirm"
    allow_full_access = settings.get("allow_full_access", "1") == "1"
    selection_mode = settings.get("tool_selection_mode", "")
    if selection_mode not in {"none", "bm25", "decision"}:
        selection_mode = "bm25" if settings.get("bm25_enabled", "1") == "1" else "none"
    return {
        "temperature": max(0.0, min(temperature, 2.0)),
        "max_iterations": max(0, max_iterations),
        "max_tool_calls": max(0, max_tool_calls),
        "max_run_seconds": max(10, min(max_run_seconds, 900)),
        "context_max_tokens": (
            0 if context_max_tokens <= 0 else max(4096, min(context_max_tokens, 1_000_000))
        ),
        "context_compression": settings.get("context_compression", "1") == "1",
        "tool_selection_mode": selection_mode,
        "bm25_enabled": selection_mode == "bm25",
        "decision_enabled": selection_mode == "decision",
        "decision_model_id": _int_setting(settings, "decision_model_id", 0) or None,
        "decision_tools": settings.get("decision_tools", "1") == "1",
        "decision_skills": settings.get("decision_skills", "1") == "1",
        "decision_threshold": max(0.01, min(_float_setting(settings, "decision_threshold", 0.6), 0.99)),
        "decision_min_count": max(1, min(_int_setting(settings, "decision_min_count", 8), 200)),
        "decision_timeout_seconds": max(1, min(_float_setting(settings, "decision_timeout_seconds", 5), 30)),
        "context_reserve_tokens": max(
            0, min(context_reserve_tokens, 100_000)
        ),
        "compaction_model_id": compaction_model_id or None,
        "compaction_keep_ratio": max(0.2, min(keep_ratio, 0.9)),
        "session_retention_days": max(0, min(session_retention_days, 3650)),
        "admin_session_content": settings.get("admin_session_content", "1") == "1",
        "store_reasoning": settings.get("store_reasoning", "0") == "1",
        "user_daily_token_limit": max(0, min(user_daily_token_limit, 100_000_000)),
        "memory_enabled": settings.get("memory_enabled", "1") == "1",
        "system_prompt_extra": settings.get("system_prompt_extra", "").strip(),
        "demo_mode": demo_mode,
        "demo_mode_setting": demo_mode,
        "default_reasoning_effort": settings.get(
            "default_reasoning_effort", ""
        ).strip(),
        "default_approval_mode": default_approval_mode,
        "allow_full_access": allow_full_access,
        "welcome_title": settings.get(
            "welcome_title", "有什么我能帮你的吗？"
        ).strip(),
        "welcome_subtitle": settings.get("welcome_subtitle", "").strip(),
        "welcome_prompts": settings.get("welcome_prompts", "").strip(),
        "asr_model_id": asr_model_id or None,
        "tts_model_id": _int_setting(settings, "tts_model_id", 0) or None,
        "title_model_id": title_model_id or None,
        "fallback_model_id": fallback_model_id or None,
        "retry": retry_config(settings),
    }


def provider_ready(provider: dict[str, Any]) -> tuple[bool, str]:
    if not provider.get("enabled", True):
        return False, "供应商已被管理员停用"
    if provider_requires_key(provider) and not str(provider.get("api_key", "")).strip():
        return False, f"供应商「{provider.get('name', '')}」尚未配置 API Key"
    return True, ""


def resolve_budget(
    config: dict[str, Any], assistant: dict[str, Any] | None
) -> dict[str, Any]:
    """Assistant-level limits override the global defaults when they are set."""
    budget = {
        "max_steps": int(config["max_iterations"]),
        "max_tool_calls": int(config["max_tool_calls"]),
        "max_run_seconds": int(config["max_run_seconds"]),
        "context_max_tokens": int(config["context_max_tokens"]),
    }
    if assistant:
        for key, source in (
            ("max_steps", "max_steps"),
            ("max_tool_calls", "max_tool_calls"),
            ("max_run_seconds", "max_run_seconds"),
            ("context_max_tokens", "context_max_tokens"),
        ):
            value = int(assistant.get(source) or 0)
            if value > 0:
                budget[key] = value
    budget["max_steps"] = max(0, budget["max_steps"])
    budget["max_tool_calls"] = max(0, budget["max_tool_calls"])
    budget["max_run_seconds"] = max(10, min(budget["max_run_seconds"], 900))
    if budget["context_max_tokens"] > 0:
        budget["context_max_tokens"] = max(
            4096, min(budget["context_max_tokens"], 1_000_000)
        )
    return budget


def build_system_prompt(
    user: dict[str, Any],
    skills: list[dict[str, Any]],
    extra: str,
    model: dict[str, Any],
    provider: dict[str, Any],
    *,
    assistant: dict[str, Any] | None = None,
    memories: list[dict[str, Any]] | None = None,
    prefetched: list[dict[str, Any]] | None = None,
) -> str:
    permission_text = "、".join(user.get("permissions", [])) or "无"
    capabilities = "、".join(model.get("capabilities", [])) or "text"
    identity = (
        f"你是「{assistant['name']}」，嵌入在业务后台中的 AI 助手。"
        if assistant
        else "你是嵌入在业务后台中的 AI 助手。"
    )
    parts = [
        identity,
        (assistant.get("description") or "") if assistant else "",
        (assistant.get("system_prompt") or "") if assistant else "",
        "",
        f"当前用户：{user['display_name']}（{user['username']}），角色：{user['role']}。",
        f"当前账号权限：{permission_text}。",
        f"本轮模型：{model['name']}（{model['model_id']}），供应商：{provider['name']}。",
        f"模型能力：{capabilities}；工具调用：{'支持' if model.get('supports_tools') else '不支持'}。",
    ]
    if assistant and assistant.get("mode") == "report":
        parts.extend(
            [
                "本轮为单步报告模式：工具已由框架预先采集，你不能再调用工具，"
                "只能基于下方预采集结果生成报告。",
            ]
        )
    parts.extend(
        [
            "",
            "执行原则：",
            "1. 业务数据只能来自工具返回结果，不得编造。",
            "2. 工具继承当前登录用户的真实权限；如果被拒绝，如实说明，不要尝试绕过。",
            "3. 新增、修改、删除操作必须等待用户在界面审批卡中确认，不得假设已批准。",
            "4. 只使用本轮已启用的工具。工具不可用时，向用户说明当前可选范围。",
            "5. 如果用户提供图片，只描述图片中能够确认的内容，不猜测模糊细节。",
            "6. 使用简洁中文回答；先给结论，再给必要明细。",
        ]
    )
    if memories:
        parts.extend(["", "该用户的长期记忆（仅在相关时使用，不要主动扩散）："])
        for memory in memories[:20]:
            parts.append(f"- {memory['content']}")
    if prefetched:
        parts.extend(["", "预采集数据（由框架在调用模型前执行，结果如下）："])
        for item in prefetched:
            parts.append(f"### {item['tool']}")
            parts.append(str(item.get("text", ""))[:8000])
            parts.append("")
    if skills:
        parts.extend(
            [
                "",
                "可用技能（渐进式加载，不要假设自己已经读过正文）：",
                "下面只列出技能名称和用途。判断某个技能与本轮任务相关时，"
                "先调用 load_skill(name=技能标识) 读取完整规范；"
                "需要技能附带的参考资料时，再调用 read_skill_file(name, path)。",
                "没有加载成功的技能内容不得臆造。",
                "",
            ]
        )
        for skill in skills:
            identifier = skill.get("slug") or skill.get("name", "")
            description = str(skill.get("description", "")).strip()
            parts.append(f"- {identifier}: {description or skill.get('name', '')}")
    if extra:
        parts.extend(["", "管理员补充要求：", extra])
    return "\n".join(part for part in parts if part is not None)


def openai_tools(tool_specs: list[Any]) -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": spec.name,
                "description": spec.description,
                "parameters": spec.input_schema,
            },
        }
        for spec in tool_specs
    ]


def _client(provider: dict[str, Any]) -> AsyncOpenAI:
    api_key = str(provider.get("api_key", "")).strip() or "not-required"
    timeout = float(provider.get("timeout_seconds") or 90)
    return AsyncOpenAI(
        api_key=api_key,
        base_url=chat_base_url(provider),
        timeout=min(max(timeout, 3), 180),
        max_retries=0,
        default_headers=dict(provider.get("extra_headers") or {}),
    )


def _request_payload(
    *,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    model: dict[str, Any],
    config: dict[str, Any],
    max_tokens_override: int | None = None,
    reasoning_effort: str | None = None,
    stream: bool = False,
) -> dict[str, Any]:
    temperature = model.get("temperature")
    if temperature is None:
        temperature = config["temperature"]
    payload: dict[str, Any] = {
        "model": model["model_id"],
        "messages": messages,
        "temperature": max(0.0, min(float(temperature), 2.0)),
        "top_p": max(0.0, min(float(model.get("top_p", 1.0)), 1.0)),
    }
    max_output_tokens = int(max_tokens_override or model.get("max_output_tokens") or 0)
    if max_output_tokens > 0:
        payload["max_tokens"] = max_output_tokens
    if tools and model.get("supports_tools", True):
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    if stream:
        payload["stream"] = True
        payload["stream_options"] = {"include_usage": True}

    extra_params = model.get("extra_params") or {}
    extra_body: dict[str, Any] = {}
    if isinstance(extra_params, dict):
        configured_body = extra_params.get("extra_body") or {}
        if isinstance(configured_body, dict):
            extra_body.update(
                {
                    key: value for key, value in configured_body.items()
                    if key not in RESERVED_REQUEST_PARAMS and not key.startswith("_")
                }
            )
        for key, value in extra_params.items():
            if key in RESERVED_REQUEST_PARAMS or key.startswith("_") or key == "extra_body":
                continue
            if key in CHAT_REQUEST_PARAMS:
                payload[key] = value
            else:
                extra_body[key] = value
    effort = str(reasoning_effort or model.get("default_reasoning_effort") or "").strip()
    if model.get("supports_reasoning") and effort:
        try:
            reasoning = reasoning_config(model)
        except ProviderError as exc:
            raise LLMError(str(exc), retryable=False) from exc
        normalized = "off" if effort == "none" else effort
        if normalized == "off" and not reasoning["can_disable"]:
            raise LLMError(
                f"模型「{model.get('name') or model['model_id']}」未声明支持关闭推理，请使用模型默认或切换支持关闭推理的模型",
                retryable=False,
            )
        allowed = reasoning["efforts"]
        if normalized != "off" and allowed and normalized not in allowed:
            raise LLMError(f"模型不支持推理等级：{effort}", retryable=False)
        extra_body.pop("reasoning_effort", None)
        extra_body.pop("enable_thinking", None)
        extra_body.pop("thinking", None)
        extra_body.pop("reasoning", None)
        payload.pop("reasoning_effort", None)
        if reasoning["protocol"] == "enable_thinking":
            extra_body["enable_thinking"] = normalized != "off"
        elif reasoning["protocol"] == "thinking":
            extra_body["thinking"] = {
                "type": "disabled" if normalized == "off" else "enabled"
            }
            if normalized != "off":
                payload["reasoning_effort"] = normalized
        else:
            payload["reasoning_effort"] = "none" if normalized == "off" else normalized
    if extra_body:
        payload["extra_body"] = extra_body
    return payload


def compute_cost(usage: dict[str, Any], model: dict[str, Any]) -> float:
    prompt_tokens = int(usage.get("prompt_tokens") or 0)
    completion_tokens = int(usage.get("completion_tokens") or 0)
    input_price = float(model.get("input_price_per_1m") or 0)
    output_price = float(model.get("output_price_per_1m") or 0)
    return round(
        prompt_tokens / 1_000_000 * input_price
        + completion_tokens / 1_000_000 * output_price,
        8,
    )


def normalize_usage(raw: Any, model: dict[str, Any]) -> dict[str, Any]:
    if raw is None:
        payload: dict[str, Any] = {}
    elif hasattr(raw, "model_dump"):
        payload = raw.model_dump()
    elif isinstance(raw, dict):
        payload = dict(raw)
    else:
        payload = {}
    prompt_tokens = int(
        payload.get("prompt_tokens") or payload.get("input_tokens") or 0
    )
    completion_tokens = int(
        payload.get("completion_tokens") or payload.get("output_tokens") or 0
    )
    total_tokens = int(
        payload.get("total_tokens") or prompt_tokens + completion_tokens
    )
    usage = {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": total_tokens,
        "cost_usd": compute_cost(
            {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
            },
            model,
        ),
    }
    for key in ("prompt_tokens_details", "completion_tokens_details"):
        if payload.get(key):
            usage[key] = payload[key]
    return usage


def merge_usage(
    base: dict[str, Any] | None, extra: dict[str, Any] | None
) -> dict[str, Any]:
    merged = dict(base or {})
    incoming = dict(extra or {})
    for key in (
        "prompt_tokens",
        "completion_tokens",
        "total_tokens",
        "cost_usd",
        "attempts",
        "retry_count",
        "latency_ms",
    ):
        merged[key] = merged.get(key, 0) + incoming.get(key, 0)
    for key in ("model", "provider", "purpose"):
        if incoming.get(key):
            merged[key] = incoming[key]
    return merged


def _status_code(exc: Exception) -> int | None:
    value = getattr(exc, "status_code", None)
    if value is None:
        response = getattr(exc, "response", None)
        value = getattr(response, "status_code", None)
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _retry_after_seconds(exc: Exception) -> float | None:
    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", None)
    if not headers:
        return None
    value = headers.get("retry-after") or headers.get("Retry-After")
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except (TypeError, ValueError):
        try:
            target = parsedate_to_datetime(str(value))
            if target.tzinfo is None:
                target = target.replace(tzinfo=timezone.utc)
            return max(
                0.0,
                (target - datetime.now(timezone.utc)).total_seconds(),
            )
        except (TypeError, ValueError):
            return None


def _is_context_overflow(exc: Exception) -> bool:
    status = _status_code(exc)
    text = str(exc).lower()
    markers = (
        "context_length_exceeded",
        "maximum context length",
        "context length",
        "too many tokens",
        "reduce the length",
        "prompt is too long",
        "exceeds the model",
        "maximum number of tokens",
    )
    return status in {400, 413, 422} and any(marker in text for marker in markers)


def _is_retryable(exc: Exception, retry: dict[str, Any]) -> bool:
    if isinstance(exc, (APITimeoutError, APIConnectionError, RateLimitError)):
        return True
    status = _status_code(exc)
    if status in RETRYABLE_STATUSES:
        return True
    if isinstance(exc, APIStatusError):
        return False
    name = type(exc).__name__.lower()
    return "timeout" in name or "connection" in name


def _backoff_seconds(retry: dict[str, Any], attempt: int) -> float:
    raw_ms = float(retry["initial_backoff_ms"]) * (
        float(retry["multiplier"]) ** max(0, attempt - 1)
    )
    raw_ms = min(raw_ms, float(retry["max_backoff_ms"]))
    jitter = float(retry["jitter"])
    if jitter:
        raw_ms *= random.uniform(1.0 - jitter, 1.0 + jitter)
    return max(0.05, raw_ms / 1000.0)


def _estimate_tokens(value: str) -> int:
    text = str(value or "")
    if not text:
        return 0
    ascii_chars = sum(1 for char in text if ord(char) < 128)
    other_chars = len(text) - ascii_chars
    return max(1, int(ascii_chars / 4 + other_chars / 1.4))


def _delta_reasoning(delta: Any) -> str:
    for key in ("reasoning_content", "reasoning"):
        value = getattr(delta, key, None)
        if value:
            return str(value)
    extra = getattr(delta, "model_extra", None) or {}
    for key in ("reasoning_content", "reasoning"):
        value = extra.get(key)
        if value:
            return str(value)
    return ""


async def _emit(
    callback: EventCallback | None, event_type: str, payload: dict[str, Any]
) -> None:
    if callback is None:
        return
    await callback(event_type, payload)


async def _stream_chat_completion(
    *,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    model: dict[str, Any],
    provider: dict[str, Any],
    config: dict[str, Any],
    session_id: str | None,
    username: str,
    purpose: str,
    deadline: float | None,
    max_tokens_override: int | None,
    reasoning_effort: str | None,
    on_event: EventCallback,
) -> dict[str, Any]:
    ready, reason = provider_ready(provider)
    if not ready:
        raise LLMError(reason, retryable=False)
    retry = retry_config()
    payload = _request_payload(
        messages=messages,
        tools=tools,
        model=model,
        config=config,
        max_tokens_override=max_tokens_override,
        reasoning_effort=reasoning_effort,
        stream=True,
    )
    attempts_allowed = int(retry["max_attempts"]) if retry["enabled"] else 1
    started = time.monotonic()
    last_error: Exception | None = None
    last_status: int | None = None

    async with _client(provider) as client:
        for attempt in range(1, attempts_allowed + 1):
            attempt_started = time.monotonic()
            emitted_any = False
            content_parts: list[str] = []
            reasoning_parts: list[str] = []
            tool_calls: dict[int, dict[str, Any]] = {}
            usage_payload: Any = None
            finish_reason = ""
            try:
                stream = await client.chat.completions.create(**payload)
                async for chunk in stream:
                    if getattr(chunk, "usage", None) is not None:
                        usage_payload = chunk.usage
                    choices = getattr(chunk, "choices", None) or []
                    if not choices:
                        continue
                    choice = choices[0]
                    finish_reason = choice.finish_reason or finish_reason
                    delta = choice.delta
                    if delta is None:
                        continue
                    reasoning = _delta_reasoning(delta)
                    if reasoning:
                        emitted_any = True
                        reasoning_parts.append(reasoning)
                        await _emit(
                            on_event,
                            "thinking.delta",
                            {"delta": reasoning, "source": "provider"},
                        )
                    text = getattr(delta, "content", None) or ""
                    if text:
                        emitted_any = True
                        content_parts.append(str(text))
                        await _emit(on_event, "text.delta", {"delta": str(text)})
                    for call in getattr(delta, "tool_calls", None) or []:
                        index = int(getattr(call, "index", 0) or 0)
                        entry = tool_calls.setdefault(
                            index,
                            {
                                "id": "",
                                "name": "",
                                "arguments": "",
                                "raw_arguments": "",
                            },
                        )
                        if getattr(call, "id", None):
                            entry["id"] = str(call.id)
                        function = getattr(call, "function", None)
                        if function is not None:
                            if getattr(function, "name", None):
                                entry["name"] = str(function.name)
                            fragment = getattr(function, "arguments", None)
                            if fragment:
                                entry["arguments"] += str(fragment)
                                emitted_any = True
                                await _emit(
                                    on_event,
                                    "tool.args.delta",
                                    {
                                        "tool": entry["name"],
                                        "call_id": entry["id"],
                                        "delta": str(fragment),
                                    },
                                )
            except Exception as exc:  # noqa: BLE001 - normalized below
                last_error = exc
                last_status = _status_code(exc)
                latency_ms = int((time.monotonic() - attempt_started) * 1000)
                retryable = _is_retryable(exc, retry)
                overflow = _is_context_overflow(exc)
                db.record_llm_call(
                    session_id=session_id,
                    username=username,
                    model=str(model.get("model_id", "")),
                    provider=str(provider.get("name", "")),
                    purpose=purpose,
                    attempt=attempt,
                    status="error",
                    latency_ms=latency_ms,
                    error=str(exc),
                )
                if overflow:
                    raise LLMError(
                        f"上下文超过模型窗口：{str(exc)[:300]}",
                        status_code=last_status,
                        retryable=False,
                        context_overflow=True,
                        attempts=attempt,
                    ) from exc
                if emitted_any or not retryable or attempt >= attempts_allowed:
                    raise LLMError(
                        f"LLM 流式调用失败（尝试 {attempt} 次）：{str(exc)[:400]}",
                        status_code=last_status,
                        retryable=retryable,
                        attempts=attempt,
                    ) from exc
                elapsed = time.monotonic() - started
                if elapsed >= float(retry["max_elapsed_seconds"]):
                    raise LLMError(
                        f"LLM 重试总时长超过 {retry['max_elapsed_seconds']} 秒："
                        f"{str(exc)[:300]}",
                        status_code=last_status,
                        retryable=True,
                        attempts=attempt,
                    ) from exc
                delay = _backoff_seconds(retry, attempt)
                if retry["honor_retry_after"]:
                    retry_after = _retry_after_seconds(exc)
                    if retry_after is not None:
                        delay = max(delay, retry_after)
                if deadline is not None:
                    delay = min(delay, max(0.0, deadline - time.monotonic()))
                if delay <= 0:
                    raise LLMError(
                        f"LLM 调用失败且没有剩余重试时间：{str(exc)[:300]}",
                        status_code=last_status,
                        retryable=True,
                        attempts=attempt,
                    ) from exc
                await _emit(
                    on_event,
                    "retry",
                    {
                        "attempt": attempt,
                        "max_attempts": attempts_allowed,
                        "delay_ms": int(delay * 1000),
                        "reason": str(exc)[:300],
                    },
                )
                await asyncio.sleep(delay)
                continue

            latency_ms = int((time.monotonic() - attempt_started) * 1000)
            content = "".join(content_parts)
            reasoning = "".join(reasoning_parts)
            normalized_calls: list[dict[str, Any]] = []
            for index in sorted(tool_calls):
                entry = tool_calls[index]
                raw = entry.get("arguments") or "{}"
                try:
                    arguments = json.loads(raw)
                except json.JSONDecodeError:
                    arguments = {"_raw": raw}
                normalized_calls.append(
                    {
                        "id": entry.get("id") or f"call_{index}",
                        "name": entry.get("name") or "",
                        "arguments": arguments,
                        "raw_arguments": raw,
                    }
                )
            if usage_payload is None:
                usage = {
                    "prompt_tokens": _estimate_tokens(
                        "\n".join(
                            str(item.get("content", "")) for item in messages
                        )
                    ),
                    "completion_tokens": _estimate_tokens(content + reasoning),
                    "total_tokens": 0,
                    "cost_usd": 0,
                }
                usage["total_tokens"] = (
                    usage["prompt_tokens"] + usage["completion_tokens"]
                )
            else:
                usage = normalize_usage(usage_payload, model)
            usage.update(
                {
                    "attempts": attempt,
                    "retry_count": attempt - 1,
                    "latency_ms": latency_ms,
                    "purpose": purpose,
                    "model": str(model.get("model_id", "")),
                    "provider": str(provider.get("name", "")),
                    "reasoning_tokens": _estimate_tokens(reasoning),
                }
            )
            db.record_llm_call(
                session_id=session_id,
                username=username,
                model=str(model.get("model_id", "")),
                provider=str(provider.get("name", "")),
                purpose=purpose,
                attempt=attempt,
                status="ok",
                input_tokens=usage["prompt_tokens"],
                output_tokens=usage["completion_tokens"],
                total_tokens=usage["total_tokens"],
                cost_usd=usage["cost_usd"],
                latency_ms=latency_ms,
            )
            return {
                "content": content,
                "reasoning_content": reasoning,
                "tool_calls": normalized_calls,
                "finish_reason": finish_reason,
                "usage": usage,
            }

    raise LLMError(
        f"LLM 调用失败：{str(last_error)[:400] if last_error else '未知错误'}",
        status_code=last_status,
        attempts=attempts_allowed,
    )


async def chat_completion(
    *,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    model: dict[str, Any],
    provider: dict[str, Any],
    config: dict[str, Any],
    session_id: str | None = None,
    username: str = "",
    purpose: str = "chat",
    deadline: float | None = None,
    max_tokens_override: int | None = None,
    reasoning_effort: str | None = None,
    on_event: EventCallback | None = None,
) -> dict[str, Any]:
    started = time.monotonic()
    try:
        async with asyncio.timeout_at(deadline):
            return await _chat_completion(
                messages=messages, tools=tools, model=model, provider=provider,
                config=config, session_id=session_id, username=username,
                purpose=purpose, deadline=deadline,
                max_tokens_override=max_tokens_override,
                reasoning_effort=reasoning_effort, on_event=on_event,
            )
    except TimeoutError as exc:
        if purpose == "decision":
            db.record_llm_call(
                session_id=session_id, username=username, model=str(model.get("model_id", "")),
                provider=str(provider.get("name", "")), purpose=purpose, attempt=1,
                status="error", error="决策请求达到时间上限",
                latency_ms=int((time.monotonic() - started) * 1000),
            )
        raise LLMError("本次运行已达到时间上限，模型请求已停止", retryable=False) from exc


async def _chat_completion(
    *,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    model: dict[str, Any],
    provider: dict[str, Any],
    config: dict[str, Any],
    session_id: str | None = None,
    username: str = "",
    purpose: str = "chat",
    deadline: float | None = None,
    max_tokens_override: int | None = None,
    reasoning_effort: str | None = None,
    on_event: EventCallback | None = None,
) -> dict[str, Any]:
    if on_event is not None:
        return await _stream_chat_completion(
            messages=messages,
            tools=tools,
            model=model,
            provider=provider,
            config=config,
            session_id=session_id,
            username=username,
            purpose=purpose,
            deadline=deadline,
            max_tokens_override=max_tokens_override,
            reasoning_effort=reasoning_effort,
            on_event=on_event,
        )
    ready, reason = provider_ready(provider)
    if not ready:
        raise LLMError(reason, retryable=False)
    retry = retry_config()
    payload = _request_payload(
        messages=messages,
        tools=tools,
        model=model,
        config=config,
        max_tokens_override=max_tokens_override,
        reasoning_effort=reasoning_effort,
    )
    attempts_allowed = int(retry["max_attempts"]) if retry["enabled"] else 1
    started = time.monotonic()
    last_error: Exception | None = None
    last_status: int | None = None

    async with _client(provider) as client:
        for attempt in range(1, attempts_allowed + 1):
            attempt_started = time.monotonic()
            try:
                response = await client.chat.completions.create(**payload)
            except Exception as exc:  # noqa: BLE001 - normalized into LLMError
                last_error = exc
                last_status = _status_code(exc)
                latency_ms = int((time.monotonic() - attempt_started) * 1000)
                retryable = _is_retryable(exc, retry)
                overflow = _is_context_overflow(exc)
                db.record_llm_call(
                    session_id=session_id,
                    username=username,
                    model=str(model.get("model_id", "")),
                    provider=str(provider.get("name", "")),
                    purpose=purpose,
                    attempt=attempt,
                    status="error",
                    latency_ms=latency_ms,
                    error=str(exc),
                )
                if overflow:
                    raise LLMError(
                        f"上下文超过模型窗口：{str(exc)[:300]}",
                        status_code=last_status,
                        retryable=False,
                        context_overflow=True,
                        attempts=attempt,
                    ) from exc
                if not retryable or attempt >= attempts_allowed:
                    raise LLMError(
                        f"LLM 调用失败（尝试 {attempt} 次）：{str(exc)[:400]}",
                        status_code=last_status,
                        retryable=retryable,
                        attempts=attempt,
                    ) from exc
                elapsed = time.monotonic() - started
                if elapsed >= float(retry["max_elapsed_seconds"]):
                    raise LLMError(
                        f"LLM 重试总时长超过 {retry['max_elapsed_seconds']} 秒："
                        f"{str(exc)[:300]}",
                        status_code=last_status,
                        retryable=True,
                        attempts=attempt,
                    ) from exc
                delay = _backoff_seconds(retry, attempt)
                if retry["honor_retry_after"]:
                    retry_after = _retry_after_seconds(exc)
                    if retry_after is not None:
                        delay = max(delay, retry_after)
                remaining = float(retry["max_elapsed_seconds"]) - elapsed
                delay = min(delay, max(0.0, remaining))
                if deadline is not None:
                    until_deadline = deadline - time.monotonic()
                    if until_deadline <= 0:
                        raise LLMError(
                            "本次运行已超过时间上限，无法继续重试",
                            status_code=last_status,
                            retryable=True,
                            attempts=attempt,
                        ) from exc
                    delay = min(delay, until_deadline)
                if delay <= 0:
                    raise LLMError(
                        f"LLM 调用失败且没有剩余重试时间：{str(exc)[:300]}",
                        status_code=last_status,
                        retryable=True,
                        attempts=attempt,
                    ) from exc
                await asyncio.sleep(delay)
                continue

            latency_ms = int((time.monotonic() - attempt_started) * 1000)
            choice = response.choices[0]
            message = choice.message
            tool_calls = []
            for call in message.tool_calls or []:
                raw_args = call.function.arguments or "{}"
                try:
                    arguments = json.loads(raw_args)
                except json.JSONDecodeError:
                    arguments = {"_raw": raw_args}
                tool_calls.append(
                    {
                        "id": call.id,
                        "name": call.function.name,
                        "arguments": arguments,
                        "raw_arguments": raw_args,
                    }
                )
            usage = normalize_usage(getattr(response, "usage", None), model)
            usage.update(
                {
                    "attempts": attempt,
                    "retry_count": attempt - 1,
                    "latency_ms": latency_ms,
                    "purpose": purpose,
                    "model": str(model.get("model_id", "")),
                    "provider": str(provider.get("name", "")),
                }
            )
            db.record_llm_call(
                session_id=session_id,
                username=username,
                model=str(model.get("model_id", "")),
                provider=str(provider.get("name", "")),
                purpose=purpose,
                attempt=attempt,
                status="ok",
                input_tokens=usage["prompt_tokens"],
                output_tokens=usage["completion_tokens"],
                total_tokens=usage["total_tokens"],
                cost_usd=usage["cost_usd"],
                latency_ms=latency_ms,
            )
            return {
                "content": message.content or "",
                "tool_calls": tool_calls,
                "finish_reason": choice.finish_reason,
                "usage": usage,
            }

    raise LLMError(
        f"LLM 调用失败：{str(last_error)[:400] if last_error else '未知错误'}",
        status_code=last_status,
        attempts=attempts_allowed,
    )


async def test_llm(
    model: dict[str, Any],
    provider: dict[str, Any],
    config: dict[str, Any],
) -> dict[str, Any]:
    kind = str(model.get("model_kind") or "chat")
    if kind == "decision":
        from webagent.agent.decision import test_decision

        return await test_decision(model, provider, config)
    if kind == "tts":
        from webagent.agent.speech import SpeechError, synthesize_speech

        started = time.monotonic()
        if config.get("demo_mode"):
            return {
                "ok": False,
                "demo": True,
                "kind": kind,
                "message": "演示模式不会执行真实语音合成，请关闭演示模式后测试。",
                "latency_ms": 0,
            }
        try:
            result = await synthesize_speech("你好，语音合成测试。", model, provider)
        except SpeechError as exc:
            return {
                "ok": False,
                "demo": False,
                "kind": kind,
                "message": str(exc),
                "latency_ms": int((time.monotonic() - started) * 1000),
            }
        encoded = base64.b64encode(result["audio"]).decode("ascii")
        return {
            "ok": True,
            "demo": False,
            "kind": kind,
            "message": (
                "语音合成接口连通，已返回原始 PCM 音频，浏览器试听需要支持 PCM 解码的播放器。"
                if result["response_format"] == "pcm"
                else "语音合成接口连通，已返回可试听音频。"
            ),
            "latency_ms": int((time.monotonic() - started) * 1000),
            "protocol": result["protocol"],
            "usage": result["usage"],
            "audio": {
                "data_url": f"data:{result['mime_type']};base64,{encoded}",
                "mime_type": result["mime_type"],
            },
        }
    if config["demo_mode"]:
        return {
            "ok": True,
            "demo": True,
            "kind": kind,
            "message": "当前处于演示模式，不会请求外部 LLM。关闭演示模式后可测试真实连接。",
        }
    ready, reason = provider_ready(provider)
    if not ready:
        return {"ok": False, "demo": False, "kind": kind, "message": reason}
    started = time.monotonic()
    try:
        if kind == "rerank":
            return {
                "ok": False,
                "demo": False,
                "kind": kind,
                "message": "Rerank 模型的接口协议因供应商而异，当前版本暂不支持自动测试。",
            }
        if kind in {"asr", "asr_realtime"}:
            result = await transcribe_audio(
                audio=_silent_wav(),
                mime_type="audio/wav",
                filename="webagent-test.wav",
                model=model,
                provider=provider,
                language="zh",
                allow_empty=True,
            )
            return {
                "ok": True,
                "demo": False,
                "kind": kind,
                "message": (
                    f"语音识别接口连通，静音样本返回：{result.get('text') or '空文本'}"
                ),
                "protocol": result["protocol"],
                "latency_ms": int((time.monotonic() - started) * 1000),
            }
        if kind == "image_generation":
            options = model.get("extra_params") or {}
            image_params = {key: options[key] for key in ("size", "quality", "style", "response_format", "background", "output_format", "output_compression", "moderation") if key in options}
            image_params.setdefault("size", "1024x1024")
            async with _client(provider) as client:
                image = await client.images.generate(
                    model=str(model["model_id"]),
                    prompt="A simple blue circle on a white background",
                    n=1,
                    **image_params,
                )
            item = image.data[0] if getattr(image, "data", None) else None
            has_image = bool(
                getattr(item, "url", None) or getattr(item, "b64_json", None)
            )
            if not has_image:
                raise LLMError("生图接口没有返回图片数据")
            return {
                "ok": True,
                "demo": False,
                "kind": kind,
                "message": "生图接口连通，已返回图片数据。",
                "latency_ms": int((time.monotonic() - started) * 1000),
                "image": {
                    **({"data_url": f"data:image/{'jpeg' if image_params.get('output_format') in {'jpg', 'jpeg'} else image_params.get('output_format') or 'png'};base64,{item.b64_json}"} if getattr(item, "b64_json", None) else {}),
                    **({"url": item.url} if getattr(item, "url", None) else {}),
                },
            }
        if kind == "embedding":
            async with _client(provider) as client:
                embedding = await client.embeddings.create(
                    model=str(model["model_id"]),
                    input="WebAgent connection test",
                )
            vector = embedding.data[0].embedding if getattr(embedding, "data", None) else []
            return {
                "ok": True,
                "demo": False,
                "kind": kind,
                "message": f"Embedding 接口连通，向量维度 {len(vector)}。",
                "latency_ms": int((time.monotonic() - started) * 1000),
            }

        result = await chat_completion(
            messages=[{"role": "user", "content": "Hi"}],
            tools=[],
            model=model,
            provider=provider,
            config=config,
            username="admin",
            purpose="test",
            reasoning_effort="off" if reasoning_config(model)["can_disable"] else None,
            max_tokens_override=256,
        )
        reply = str(result.get("content") or "").strip()
        return {
            "ok": bool(reply),
            "demo": False,
            "kind": kind,
            "message": reply[:500] if reply else "模型接口已响应，但未返回正文。请检查模型类型、推理参数和输出上限后重试。",
            "usage": result.get("usage") or {},
            "latency_ms": int((time.monotonic() - started) * 1000),
        }
    except LLMError as exc:
        return {
            "ok": False,
            "demo": False,
            "kind": kind,
            "message": _asr_error_detail({"message": str(exc)}, provider),
            "attempts": exc.attempts,
            "latency_ms": int((time.monotonic() - started) * 1000),
        }
    except Exception as exc:  # noqa: BLE001 - surfaced to the admin UI
        return {
            "ok": False,
            "demo": False,
            "kind": kind,
            "message": _asr_error_detail({"message": str(exc)}, provider),
            "latency_ms": int((time.monotonic() - started) * 1000),
        }


def _silent_wav(seconds: float = 1.0) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(b"\x00\x00" * int(16000 * seconds))
    return buffer.getvalue()


async def _prepare_chat_audio(
    audio: bytes, mime_type: str, filename: str
) -> tuple[bytes, str, str]:
    media_type = (mime_type or "").split(";", 1)[0].strip().lower()
    formats = {
        "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav",
        "audio/mpeg": "mp3", "audio/mp3": "mp3",
    }
    audio_format = formats.get(media_type)
    if not audio_format and audio[:4] == b"RIFF" and audio[8:12] == b"WAVE":
        audio_format = "wav"
    if audio_format:
        return audio, f"audio/{'mpeg' if audio_format == 'mp3' else 'wav'}", audio_format
    executable = shutil.which("ffmpeg")
    if not executable:
        raise LLMError(
            "该语音协议需要 WAV/MP3；当前录音格式需要服务端安装 FFmpeg 后自动转换",
            retryable=False,
        )
    process = await asyncio.create_subprocess_exec(
        executable, "-hide_banner", "-loglevel", "error", "-i", "pipe:0",
        "-f", "s16le", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", "pipe:1",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        pcm, _error = await asyncio.wait_for(process.communicate(audio), timeout=15)
    except BaseException:
        if process.returncode is None:
            process.kill()
        await process.communicate()
        raise
    if process.returncode or not pcm:
        raise LLMError("录音格式无效或无法解码，请重新录音", retryable=False)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(pcm)
    return buffer.getvalue(), "audio/wav", "wav"


def _transcript_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "".join(_transcript_text(item) for item in value)
    if not isinstance(value, dict):
        return ""
    if isinstance(value.get("text"), str):
        return value["text"]
    for key in ("output", "sentence", "content", "message"):
        if key in value:
            result = _transcript_text(value[key])
            if result:
                return result
    choices = value.get("choices") or []
    if choices:
        return _transcript_text(choices[0])
    audio = value.get("audio") or {}
    return str(audio.get("transcript") or "") if isinstance(audio, dict) else ""


def _asr_error_detail(value: Any, provider: dict[str, Any]) -> str:
    if isinstance(value, dict):
        error = value.get("error") or value
        message = (
            str(error.get("message") or error.get("code") or "供应商没有返回错误详情")
            if isinstance(error, dict)
            else str(error)
        )
    else:
        message = "供应商没有返回有效的 JSON 响应"
    secrets = [str(provider.get("api_key") or "")]
    secrets.extend(str(item) for item in (provider.get("extra_headers") or {}).values())
    for secret in secrets:
        if secret:
            message = message.replace(secret, "[redacted]")
    message = re.sub(r"data:audio/[^\s\"']+", "[audio]", message)
    return message[:240]


async def transcribe_audio(
    *,
    audio: bytes,
    mime_type: str,
    filename: str,
    model: dict[str, Any],
    provider: dict[str, Any],
    language: str = "zh",
    allow_empty: bool = False,
) -> dict[str, Any]:
    ready, reason = provider_ready(provider)
    if not ready:
        raise LLMError(reason, retryable=False)
    if not model.get("supports_transcription"):
        raise LLMError(f"模型「{model.get('name')}」未启用语音转写能力", retryable=False)
    if not audio:
        raise LLMError("录音为空，请重新录音", retryable=False)
    try:
        settings = transcription_config(model, provider)
    except ProviderError as exc:
        raise LLMError(str(exc), retryable=False) from exc
    protocol = settings["protocol"]
    if protocol == "realtime":
        raise LLMError(
            f"模型「{model['model_id']}」使用 WebSocket 实时语音协议，不能用作当前录音文件转写；请选择文件 ASR 模型，或由管理员配置供应商明确支持的 HTTP 语音协议",
            retryable=False,
        )
    timeout = min(max(float(provider.get("timeout_seconds") or 60), 3), 180)
    headers = request_headers(provider)
    request_options: dict[str, Any] = {}
    if protocol == "transcriptions":
        request_options["data"] = {"model": str(model["model_id"])}
        if language:
            request_options["data"]["language"] = language
        request_options["files"] = {
            "file": (filename, audio, mime_type or "audio/webm")
        }
    else:
        try:
            audio, media_type, audio_format = await _prepare_chat_audio(
                audio, mime_type, filename
            )
        except asyncio.TimeoutError as exc:
            raise LLMError("录音格式转换超时，请缩短录音后重试", retryable=False) from exc
        encoded = base64.b64encode(audio).decode("ascii")
        data_uri = f"data:{media_type};base64,{encoded}"
        extra_params = model.get("extra_params") or {}
        asr_options = dict(extra_params.get("asr_options") or {})
        if language:
            asr_options["language"] = language
        lower = str(model["model_id"]).lower()
        if protocol == "chat_audio":
            input_audio: dict[str, str] = {"data": encoded, "format": audio_format}
            if settings["data_format"] == "data_uri":
                input_audio = {"data": data_uri}
            request_options["json"] = {
                "model": str(model["model_id"]),
                "messages": [{"role": "user", "content": [
                    {"type": "input_audio", "input_audio": input_audio}
                ]}],
                "stream": False,
            }
            if "qwen" in lower:
                request_options["json"]["asr_options"] = asr_options
            else:
                request_options["json"]["messages"][0]["content"].insert(
                    0, {"type": "text", "text": "Transcribe the recording verbatim. Return only the transcript. If there is no speech, return an empty string."}
                )
                request_options["json"]["modalities"] = ["text"]
        else:
            audio_part: dict[str, Any] = {"audio": data_uri}
            parameters: dict[str, Any] = {"asr_options": asr_options}
            if "qwen-audio-3." in lower:
                audio_part = {"type": "input_audio", "input_audio": {"data": data_uri}}
                sample_rate = 16000
                if audio_format == "wav":
                    try:
                        with wave.open(io.BytesIO(audio), "rb") as wav:
                            sample_rate = wav.getframerate()
                    except (wave.Error, EOFError):
                        pass
                parameters = {"format": audio_format, "sample_rate": sample_rate}
            request_options["json"] = {
                "model": str(model["model_id"]),
                "input": {"messages": [{"role": "user", "content": [audio_part]}]},
                "parameters": parameters,
            }
            headers["X-DashScope-SSE"] = "disable"
    try:
        async with httpx2.AsyncClient(
            timeout=httpx2.Timeout(timeout, connect=min(5.0, timeout)),
            follow_redirects=False,
        ) as client:
            response = await client.post(
                settings["endpoint"], headers=headers, **request_options
            )
    except httpx2.TimeoutException as exc:
        raise LLMError(
            f"语音识别超时（{timeout:.0f}s，协议 {protocol}），请检查供应商或缩短录音",
            retryable=True,
        ) from exc
    except httpx2.RequestError as exc:
        raise LLMError("无法连接语音识别供应商，请检查服务地址与网络", retryable=True) from exc
    try:
        body = response.json()
    except ValueError as exc:
        raise LLMError(
            f"语音供应商返回 {response.status_code} 非 JSON 响应（协议 {protocol}），请检查语音端点",
            status_code=response.status_code,
            retryable=response.status_code in RETRYABLE_STATUSES,
        ) from exc
    if response.status_code >= 300 or (
        isinstance(body, dict) and (body.get("error") or body.get("code"))
    ):
        detail = _asr_error_detail(body, provider)
        raise LLMError(
            f"语音识别接口返回 {response.status_code}（协议 {protocol}）：{detail}",
            status_code=response.status_code,
            retryable=response.status_code in RETRYABLE_STATUSES,
        )
    if not isinstance(body, dict) or not any(
        key in body for key in ("text", "choices", "output")
    ):
        raise LLMError("语音供应商响应缺少识别结果，请确认模型类型与语音协议", retryable=False)
    text = _transcript_text(body).strip()
    if not text and not allow_empty:
        raise LLMError("语音识别没有返回文本", retryable=False)
    return {
        "text": text,
        "model": model["model_id"],
        "provider": provider["name"],
        "protocol": protocol,
    }


async def generate_title(
    *,
    model: dict[str, Any],
    provider: dict[str, Any],
    config: dict[str, Any],
    user_text: str,
    assistant_text: str,
    session_id: str | None,
    username: str,
) -> str:
    if config.get("demo_mode"):
        cleaned = re.sub(
            r"^(请|帮我|麻烦|查询|查看|统计|把|删除|新增|添加|修改)\s*",
            "",
            user_text.strip(),
        )
        return re.sub(r"\s+", " ", cleaned).strip()[:24] or "新对话"
    completion = await chat_completion(
        messages=[
            {
                "role": "system",
                "content": (
                    "为下面的对话生成一个简短中文标题。只输出标题本身，"
                    "不超过 16 个汉字，不要引号、标点或解释。"
                ),
            },
            {
                "role": "user",
                "content": f"用户：{user_text[:1200]}\n助手：{assistant_text[:1200]}",
            },
        ],
        tools=[],
        model=model,
        provider=provider,
        config=config,
        session_id=session_id,
        username=username,
        purpose="title",
        max_tokens_override=32,
    )
    title = re.sub(r"\s+", " ", str(completion.get("content") or "")).strip()
    title = title.strip("“”\"'`。.：: ")
    return title[:24] or "新对话"
