"""Provider adapters for model discovery, connection tests and request config."""

from __future__ import annotations

import asyncio
import hashlib
import json
import time
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx2

from webagent.config import DATA_DIR


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


def transcription_config(
    model: dict[str, Any], provider: dict[str, Any]
) -> dict[str, str]:
    extra_params = model.get("extra_params") or {}
    settings = extra_params.get("_asr") or {}
    if not isinstance(settings, dict):
        raise ProviderError("语音协议配置 _asr 必须是 JSON 对象")
    protocol = str(settings.get("protocol") or "auto").strip().lower()
    if protocol not in {"auto", "transcriptions", "chat_audio", "dashscope"}:
        raise ProviderError(f"不支持的语音协议：{protocol}")
    lower = str(model.get("model_id") or "").lower()
    base_url = validate_base_url(provider["base_url"])
    if protocol == "auto":
        if model.get("model_kind") == "asr_realtime" or "realtime" in lower or "real-time" in lower:
            protocol = "realtime"
        elif "qwen" in lower and "asr" in lower:
            protocol = (
                "dashscope"
                if "/api/v1" in urlparse(base_url).path
                or "qwen-audio-3." in lower
                else "chat_audio"
            )
        elif "gpt-audio" in lower or "audio-preview" in lower or "omni" in lower:
            protocol = "chat_audio"
        else:
            protocol = "transcriptions"
    endpoint = str(settings.get("endpoint") or "").strip()
    if not endpoint:
        if protocol == "dashscope":
            parsed = urlparse(base_url)
            native_path = "/api/v1/services/aigc/multimodal-generation/generation"
            endpoint = (
                base_url
                if parsed.path.endswith("/multimodal-generation/generation")
                else urljoin(f"{base_url}/", native_path)
            )
        elif protocol == "chat_audio":
            endpoint = f"{base_url}/chat/completions"
        elif protocol == "transcriptions":
            endpoint = f"{base_url}/audio/transcriptions"
    elif endpoint.startswith("/") and not endpoint.startswith("//"):
        endpoint = urljoin(f"{base_url}/", endpoint)
    else:
        endpoint = validate_base_url(endpoint)
    if endpoint:
        parsed = urlparse(endpoint)
        provider_origin = urlparse(base_url)
        if (
            parsed.scheme != provider_origin.scheme
            or parsed.netloc.lower() != provider_origin.netloc.lower()
            or parsed.username
            or parsed.password
            or parsed.fragment
        ):
            raise ProviderError("语音端点必须与供应商 Base URL 同源；不同域名请另建供应商")
    data_format = str(settings.get("data_format") or "").strip()
    if not data_format:
        data_format = "data_uri" if "qwen" in lower else "base64"
    if data_format not in {"data_uri", "base64"}:
        raise ProviderError("语音 data_format 只支持 data_uri 或 base64")
    return {"protocol": protocol, "endpoint": endpoint, "data_format": data_format}


def reasoning_config(model: dict[str, Any]) -> dict[str, Any]:
    extra_params = model.get("extra_params") or {}
    settings = extra_params.get("_reasoning") or {}
    if not isinstance(settings, dict):
        raise ProviderError("推理协议配置 _reasoning 必须是 JSON 对象")
    protocol = str(settings.get("protocol") or "auto").strip()
    if protocol not in {"auto", "effort", "thinking", "enable_thinking"}:
        raise ProviderError(f"不支持的推理协议：{protocol}")
    lower = str(model.get("model_id") or "").lower()
    nested_extra = extra_params.get("extra_body") or {}
    if not isinstance(nested_extra, dict):
        nested_extra = {}
    combined_extra = {**nested_extra, **extra_params}
    fixed_reasoning = (
        "qwq" in lower
        or "deepseek-r1" in lower
        or "deepseek-reasoner" in lower
        or "-thinking" in lower
    )
    if protocol == "auto":
        if "enable_thinking" in combined_extra:
            protocol = "enable_thinking"
        elif isinstance(combined_extra.get("thinking"), dict):
            protocol = "thinking"
        elif "deepseek" in lower and any(
            marker in lower for marker in ("v3.1", "v3.2", "v4", "flash", "-pro")
        ):
            protocol = "thinking"
        elif "qwen3" in lower and not fixed_reasoning:
            protocol = "enable_thinking"
        else:
            protocol = "effort"
    efforts = list(model.get("reasoning_efforts") or [])
    can_disable = protocol in {"thinking", "enable_thinking"} or any(
        effort in efforts for effort in ("off", "none")
    )
    if fixed_reasoning:
        can_disable = False
    if settings.get("can_disable") is False:
        can_disable = False
    if model.get("supports_reasoning") is False:
        return {"protocol": protocol, "can_disable": False, "efforts": []}
    if can_disable and "off" not in efforts:
        efforts.insert(0, "off")
    if not can_disable:
        efforts = [effort for effort in efforts if effort not in {"off", "none"}]
    return {
        "protocol": protocol,
        "can_disable": can_disable,
        "efforts": efforts,
    }


DISCOVERY_CACHE_TTL_SECONDS = 5 * 60
DISCOVERY_TIMEOUT_SECONDS = 12.0
_DISCOVERY_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}
_DISCOVERY_LOCKS: dict[str, asyncio.Lock] = {}


def _discovery_key(provider: dict[str, Any]) -> str:
    key = str(provider.get("api_key") or "")
    fingerprint = hashlib.sha256(key.encode("utf-8")).hexdigest()[:12] if key else ""
    return "|".join(
        [
            str(provider.get("id") or ""),
            str(provider.get("base_url") or ""),
            fingerprint,
        ]
    )


def get_cached_models(provider: dict[str, Any]) -> list[dict[str, Any]]:
    cached = _DISCOVERY_CACHE.get(_discovery_key(provider))
    return [dict(item) for item in cached[1]] if cached else []


def clear_discovery_cache(provider: dict[str, Any] | None = None) -> None:
    if provider is None:
        _DISCOVERY_CACHE.clear()
        return
    _DISCOVERY_CACHE.pop(_discovery_key(provider), None)


async def list_remote_models(
    provider: dict[str, Any], *, refresh: bool = False
) -> list[dict[str, Any]]:
    key = _discovery_key(provider)
    cached = _DISCOVERY_CACHE.get(key)
    if (
        not refresh
        and cached
        and time.time() - cached[0] < DISCOVERY_CACHE_TTL_SECONDS
    ):
        return [dict(item) for item in cached[1]]

    lock = _DISCOVERY_LOCKS.setdefault(key, asyncio.Lock())
    async with lock:
        cached = _DISCOVERY_CACHE.get(key)
        if (
            not refresh
            and cached
            and time.time() - cached[0] < DISCOVERY_CACHE_TTL_SECONDS
        ):
            return [dict(item) for item in cached[1]]

        url = discovery_url(provider)
        timeout = min(
            max(float(provider.get("timeout_seconds") or DISCOVERY_TIMEOUT_SECONDS), 3),
            DISCOVERY_TIMEOUT_SECONDS,
        )
        try:
            async with httpx2.AsyncClient(
                timeout=httpx2.Timeout(
                    connect=min(5.0, timeout),
                    read=timeout,
                    write=min(10.0, timeout),
                    pool=min(5.0, timeout),
                )
            ) as client:
                response = await client.get(
                    url,
                    headers=request_headers(provider),
                    follow_redirects=False,
                )
        except httpx2.TimeoutException as exc:
            raise ProviderError(
                f"供应商模型列表读取超时（{timeout:.0f}s），请检查 Base URL 或手工添加模型"
            ) from exc
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
        result = sorted(unique, key=lambda item: item["model_id"].lower())
        _DISCOVERY_CACHE[key] = (time.time(), result)
        return [dict(item) for item in result]


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


def guess_model_kind(model_id: str) -> str:
    lower = model_id.lower()
    if any(hint in lower for hint in ("realtime", "real-time")):
        if any(hint in lower for hint in ("asr", "audio", "transcribe", "whisper", "voice")):
            return "asr_realtime"
    if any(
        hint in lower
        for hint in ("asr", "whisper", "transcribe", "speech-to-text", "stt")
    ):
        return "asr"
    if any(
        hint in lower
        for hint in ("embedding", "embed-", "bge-", "text-embedding", "gte-")
    ):
        return "embedding"
    if any(hint in lower for hint in ("rerank", "reranker")):
        return "rerank"
    if any(
        hint in lower
        for hint in ("dall-e", "gpt-image", "image-generation", "imagen", "flux", "seedream")
    ):
        return "image_generation"
    if any(hint in lower for hint in VISION_HINTS):
        return "vision"
    return "chat"


def suggest_model_defaults(model_id: str) -> dict[str, Any]:
    lower = model_id.lower()
    model_kind = guess_model_kind(model_id)
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
    supports_reasoning = any(
        hint in lower
        for hint in ("o1", "o3", "o4", "reason", "r1", "qwq", "qwen3", "gpt-5", "gpt-6")
    ) or ("deepseek" in lower and any(hint in lower for hint in ("v3.1", "v3.2", "v4", "flash", "-pro")))
    defaults = {
        "model_kind": model_kind,
        "capabilities": guess_capabilities(model_id),
        "supports_tools": model_kind in {"chat", "vision"},
        "supports_reasoning": supports_reasoning and model_kind in {"chat", "vision"},
        "reasoning_efforts": (
            ["minimal", "low", "medium", "high", "xhigh"]
            if supports_reasoning and model_kind in {"chat", "vision"}
            else []
        ),
        "default_reasoning_effort": "",
        "supports_reasoning_summary": True,
        "supports_transcription": model_kind in {"asr", "asr_realtime"},
        "context_window": context_window,
        "max_output_tokens": max_output_tokens,
        "temperature": 0.3,
        "top_p": 1.0,
        "metadata_source": "heuristic",
        "extra_params": {},
    }
    defaults["reasoning_efforts"] = reasoning_config(
        {"model_id": model_id, **defaults}
    )["efforts"]
    return defaults


MODELS_DEV_URL = "https://models.dev/api.json"
MODELS_DEV_CACHE = DATA_DIR / "models_dev_cache.json"
MODELS_DEV_TTL_SECONDS = 6 * 60 * 60


async def fetch_models_dev(force: bool = False) -> dict[str, Any]:
    if not force:
        try:
            payload = json.loads(MODELS_DEV_CACHE.read_text("utf-8"))
            if time.time() - float(payload.get("_fetched_at") or 0) < MODELS_DEV_TTL_SECONDS:
                return payload.get("data") or {}
        except (OSError, ValueError, TypeError):
            pass
    try:
        async with httpx2.AsyncClient(timeout=8.0, follow_redirects=True) as client:
            response = await client.get(MODELS_DEV_URL)
            response.raise_for_status()
            data = response.json()
    except (httpx2.RequestError, ValueError):
        try:
            payload = json.loads(MODELS_DEV_CACHE.read_text("utf-8"))
            return payload.get("data") or {}
        except (OSError, ValueError, TypeError):
            return {}
    if not isinstance(data, dict):
        return {}
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        MODELS_DEV_CACHE.write_text(
            json.dumps(
                {"_fetched_at": time.time(), "data": data},
                ensure_ascii=False,
            ),
            "utf-8",
        )
    except OSError:
        pass
    return data


def _model_from_catalog(
    catalog: dict[str, Any], model_id: str, provider_name: str = ""
) -> dict[str, Any] | None:
    wanted = model_id.lower()
    provider_wanted = provider_name.lower()
    candidates: list[tuple[int, str, dict[str, Any]]] = []
    for provider_key, provider in catalog.items():
        if not isinstance(provider, dict):
            continue
        models = provider.get("models") or {}
        if not isinstance(models, dict):
            continue
        label = " ".join(
            [
                str(provider_key),
                str(provider.get("id") or ""),
                str(provider.get("name") or ""),
                str(provider.get("api") or ""),
            ]
        ).lower()
        for key, model in models.items():
            if not isinstance(model, dict):
                continue
            identifiers = {
                str(key).lower(),
                str(model.get("id") or "").lower(),
            }
            if wanted not in identifiers:
                continue
            score = 10 if wanted == str(model.get("id") or "").lower() else 5
            if provider_wanted and provider_wanted in label:
                score += 5
            candidates.append((score, provider_key, model))
    if not candidates:
        return None
    _score, _provider_key, model = max(candidates, key=lambda item: item[0])
    return model


async def enrich_model_defaults(
    model_id: str, provider_name: str = ""
) -> dict[str, Any]:
    defaults = suggest_model_defaults(model_id)
    catalog = await fetch_models_dev()
    model = _model_from_catalog(catalog, model_id, provider_name)
    if not model:
        return defaults
    limit = model.get("limit") or {}
    cost = model.get("cost") or {}
    modalities = model.get("modalities") or {}
    inputs = modalities.get("input") or []
    capabilities = ["text"]
    if model.get("attachment") or "image" in inputs:
        capabilities.append("image")
    efforts = defaults.get("reasoning_efforts") or []
    if model.get("reasoning"):
        efforts = efforts or ["minimal", "low", "medium", "high", "xhigh"]
    enriched = {
        **defaults,
        "model_kind": defaults.get("model_kind") or guess_model_kind(model_id),
        "capabilities": capabilities,
        "supports_tools": bool(model.get("tool_call", defaults["supports_tools"])),
        "supports_reasoning": bool(model.get("reasoning", defaults["supports_reasoning"])),
        "reasoning_efforts": efforts,
        "supports_reasoning_summary": True,
        "supports_transcription": bool(
            defaults.get("model_kind") in {"asr", "asr_realtime"}
            or "audio" in inputs
            or "transcribe" in model_id.lower()
        ),
        "context_window": int(limit.get("context") or defaults["context_window"]),
        "max_output_tokens": int(limit.get("output") or defaults["max_output_tokens"]),
        "input_price_per_1m": float(cost.get("input") or 0),
        "output_price_per_1m": float(cost.get("output") or 0),
        "metadata_source": "models.dev",
    }
    enriched["reasoning_efforts"] = reasoning_config(
        {"model_id": model_id, **enriched}
    )["efforts"]
    return enriched
