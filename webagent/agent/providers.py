"""Provider adapters for model discovery, connection tests and request config."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

import httpx2


class ProviderError(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


def validate_base_url(value: str) -> str:
    candidate = value.strip().rstrip("/")
    parsed = urlparse(candidate)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ProviderError("Base URL 必须是完整的 http:// 或 https:// 地址")
    return candidate


def validate_headers(value: dict[str, Any]) -> dict[str, str]:
    reserved = {"authorization", "x-internal-token"}
    headers: dict[str, str] = {}
    for key, item in value.items():
        name = str(key).strip()
        if not name:
            continue
        if name.lower() in reserved:
            raise ProviderError(f"附加 Header 不允许覆盖 {name}")
        if any(char in name for char in "\r\n:") or any(
            char in str(item) for char in "\r\n"
        ):
            raise ProviderError("附加 Header 不能包含换行或冒号")
        headers[name] = str(item)
    return headers


def chat_base_url(provider: dict[str, Any]) -> str:
    return validate_base_url(provider["base_url"])


def discovery_url(provider: dict[str, Any]) -> str:
    base_url = validate_base_url(provider["base_url"])
    return f"{base_url}/models"


def request_headers(provider: dict[str, Any]) -> dict[str, str]:
    headers = dict(provider.get("extra_headers") or {})
    key = str(provider.get("api_key", "")).strip()
    if key:
        headers["Authorization"] = f"Bearer {key}"
    return headers


async def list_remote_models(provider: dict[str, Any]) -> list[dict[str, Any]]:
    url = discovery_url(provider)
    timeout = float(provider.get("timeout_seconds") or 90)
    try:
        async with httpx2.AsyncClient(timeout=min(max(timeout, 3), 120)) as client:
            response = await client.get(
                url,
                headers=request_headers(provider),
                follow_redirects=False,
            )
    except httpx2.RequestError as exc:
        raise ProviderError(f"无法连接供应商：{exc}") from exc
    if response.status_code >= 400:
        detail = response.text[:300]
        raise ProviderError(
            f"供应商返回 {response.status_code}：{detail or '没有响应内容'}"
        )
    try:
        data = response.json()
    except ValueError as exc:
        raise ProviderError("供应商模型列表不是有效 JSON") from exc

    models: list[dict[str, Any]] = []
    entries = data.get("data") if isinstance(data, dict) else None
    if isinstance(entries, list):
        for item in entries:
            if isinstance(item, dict) and item.get("id"):
                models.append(
                    {
                        "model_id": str(item["id"]),
                        "name": str(item.get("name") or item["id"]),
                        "owned_by": str(item.get("owned_by") or ""),
                    }
                )
    if not models:
        raise ProviderError("供应商没有返回可导入的模型")
    seen: set[str] = set()
    unique = []
    for item in models:
        if item["model_id"] in seen:
            continue
        seen.add(item["model_id"])
        unique.append(item)
    return sorted(unique, key=lambda item: item["model_id"].lower())


VISION_HINTS = (
    "gpt-4o",
    "gpt-4.1",
    "gpt-5",
    "o3",
    "o4",
    "vision",
    "-vl",
    "vl-",
    "llava",
    "pixtral",
    "gemini",
    "claude-3",
    "claude-4",
    "claude-sonnet",
    "gemma3",
    "internvl",
    "glm-4v",
    "step-1v",
    "minicpm-v",
)


def guess_capabilities(model_id: str) -> list[str]:
    lower = model_id.lower()
    capabilities = ["text"]
    if any(hint in lower for hint in VISION_HINTS):
        capabilities.append("image")
    return capabilities


def suggest_model_defaults(model_id: str) -> dict[str, Any]:
    lower = model_id.lower()
    context_window = 32768
    max_output_tokens = 8192
    if any(hint in lower for hint in ("gpt-4o", "gpt-4.1", "gpt-5")):
        context_window = 128000
        max_output_tokens = 16384
    elif "deepseek" in lower:
        context_window = 65536
        max_output_tokens = 8192
    elif any(hint in lower for hint in ("qwen", "qwq")):
        context_window = 131072
        max_output_tokens = 8192
    elif any(hint in lower for hint in ("gemini", "claude")):
        context_window = 200000
        max_output_tokens = 8192
    return {
        "capabilities": guess_capabilities(model_id),
        "supports_tools": True,
        "context_window": context_window,
        "max_output_tokens": max_output_tokens,
        "temperature": 0.3,
        "top_p": 1.0,
        "extra_params": {},
    }
