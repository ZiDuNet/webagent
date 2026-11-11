"""OpenAI-compatible LLM access kept behind the Agent service boundary."""

from __future__ import annotations

import json
from typing import Any

from openai import AsyncOpenAI

from webagent.agent.db import get_settings
from webagent.agent.providers import chat_base_url


RESERVED_REQUEST_PARAMS = {
    "model",
    "messages",
    "tools",
    "tool_choice",
    "stream",
    "api_key",
    "base_url",
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
        context_max_tokens = int(settings.get("context_max_tokens", "32000"))
    except ValueError:
        context_max_tokens = 32000
    demo_mode = settings.get("demo_mode", "1") == "1"
    return {
        "temperature": max(0.0, min(temperature, 2.0)),
        "max_iterations": max(1, min(max_iterations, 12)),
        "max_tool_calls": max(1, min(max_tool_calls, 50)),
        "max_run_seconds": max(10, min(max_run_seconds, 900)),
        "context_max_tokens": max(4096, min(context_max_tokens, 1_000_000)),
        "context_compression": settings.get("context_compression", "1") == "1",
        "memory_enabled": settings.get("memory_enabled", "1") == "1",
        "system_prompt_extra": settings.get("system_prompt_extra", "").strip(),
        "demo_mode": demo_mode,
        "demo_mode_setting": demo_mode,
    }


def provider_ready(provider: dict[str, Any]) -> tuple[bool, str]:
    if not provider.get("enabled", True):
        return False, "供应商已被管理员停用"
    if not str(provider.get("api_key", "")).strip():
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
    budget["max_steps"] = max(1, min(budget["max_steps"], 12))
    budget["max_tool_calls"] = max(1, min(budget["max_tool_calls"], 50))
    budget["max_run_seconds"] = max(10, min(budget["max_run_seconds"], 900))
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
        parts.extend(["", "启用的技能：", ""])
        for skill in skills:
            parts.append(f"## {skill['name']}")
            parts.append(skill.get("content", ""))
            parts.append("")
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
        max_retries=1,
        default_headers=dict(provider.get("extra_headers") or {}),
    )


def _request_payload(
    *,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    model: dict[str, Any],
    config: dict[str, Any],
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
    max_output_tokens = int(model.get("max_output_tokens") or 0)
    if max_output_tokens > 0:
        payload["max_tokens"] = max_output_tokens
    if tools and model.get("supports_tools", True):
        payload["tools"] = tools
        payload["tool_choice"] = "auto"

    extra_params = model.get("extra_params") or {}
    if isinstance(extra_params, dict):
        for key, value in extra_params.items():
            if key not in RESERVED_REQUEST_PARAMS:
                payload[key] = value
    return payload


async def chat_completion(
    *,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    model: dict[str, Any],
    provider: dict[str, Any],
    config: dict[str, Any],
) -> dict[str, Any]:
    ready, reason = provider_ready(provider)
    if not ready:
        raise RuntimeError(reason)
    payload = _request_payload(
        messages=messages, tools=tools, model=model, config=config
    )
    async with _client(provider) as client:
        response = await client.chat.completions.create(**payload)

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
    usage = response.usage.model_dump() if getattr(response, "usage", None) else {}
    return {
        "content": message.content or "",
        "tool_calls": tool_calls,
        "finish_reason": choice.finish_reason,
        "usage": usage,
    }


async def test_llm(
    model: dict[str, Any],
    provider: dict[str, Any],
    config: dict[str, Any],
) -> dict[str, Any]:
    if config["demo_mode"]:
        return {
            "ok": True,
            "demo": True,
            "message": "当前处于演示模式，不会请求外部 LLM。关闭演示模式后可测试真实连接。",
        }
    ready, reason = provider_ready(provider)
    if not ready:
        return {"ok": False, "demo": False, "message": reason}
    try:
        async with _client(provider) as client:
            response = await client.chat.completions.create(
                model=model["model_id"],
                messages=[{"role": "user", "content": "只回复 OK"}],
                temperature=0,
                max_tokens=8,
            )
        return {
            "ok": True,
            "demo": False,
            "message": (response.choices[0].message.content or "OK").strip()[:200],
        }
    except Exception as exc:  # noqa: BLE001 - surfaced to the admin UI
        return {"ok": False, "demo": False, "message": str(exc)[:500]}
