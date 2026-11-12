"""Bounded text-to-speech requests for OpenAI-compatible and DashScope APIs."""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import math
import re
import time
from typing import Any
from urllib.parse import quote, urljoin, urlparse, urlunparse

import httpx2

from webagent.agent import providers


MAX_TEXT_LENGTH = 4000
MAX_AUDIO_BYTES = 10 * 1024 * 1024
MAX_JSON_BYTES = ((MAX_AUDIO_BYTES + 2) // 3) * 4 + 65536
MAX_TIMEOUT_SECONDS = 90.0
TRUSTED_DASHSCOPE_AUDIO_HOSTS = frozenset({
    "dashscope-result-bj.oss-cn-beijing.aliyuncs.com",
})
AUDIO_MIME_TYPES = {
    "mp3": "audio/mpeg",
    "wav": "audio/wav",
    "opus": "audio/ogg",
    "aac": "audio/aac",
    "flac": "audio/flac",
    "pcm": "audio/pcm",
}


class SpeechError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.retryable = False


def _parse_url(value: str) -> Any:
    if not value or any(character.isspace() or ord(character) < 32 for character in value) or "\\" in value:
        raise SpeechError("语音服务地址必须是有效的 HTTP 或 HTTPS 地址")
    try:
        parsed = urlparse(value)
        parsed.port
    except ValueError as exc:
        raise SpeechError("语音服务地址格式无效") from exc
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.fragment
    ):
        raise SpeechError("语音服务地址不能包含凭据或片段，且必须使用 HTTP 或 HTTPS")
    return parsed


def _origin(parsed: Any) -> tuple[str, str, int]:
    return parsed.scheme, parsed.hostname.lower(), parsed.port or (443 if parsed.scheme == "https" else 80)


def _voice(value: Any) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 128 or any(ord(character) < 32 for character in value):
        raise SpeechError("音色必须为 1 到 128 个字符的名称或 ID")
    return value.strip()


def _speed(value: Any, minimum: float, maximum: float) -> float:
    if isinstance(value, bool):
        raise SpeechError("语速必须是有效数字")
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise SpeechError("语速必须是有效数字") from exc
    if not math.isfinite(number) or not minimum <= number <= maximum:
        raise SpeechError(f"当前语音协议的语速范围为 {minimum:g} 到 {maximum:g}")
    return number


def synthesis_config(model: dict[str, Any], provider: dict[str, Any]) -> dict[str, Any]:
    if model.get("model_kind") != "tts":
        raise SpeechError("请选择 TTS 语音合成类型的模型")
    if not model.get("enabled", True):
        raise SpeechError("语音合成模型已被管理员停用")
    if not provider.get("enabled", True):
        raise SpeechError("语音合成供应商已被管理员停用")
    model_id = model.get("model_id")
    if not isinstance(model_id, str) or not model_id.strip():
        raise SpeechError("语音合成模型 ID 不能为空")
    lower = model_id.lower()
    if "realtime" in lower or "real-time" in lower:
        raise SpeechError("实时语音模型需要 WebSocket，不能用于当前文本转语音接口")
    base_url = str(provider.get("base_url") or "").strip().rstrip("/")
    base = _parse_url(base_url)
    if base.query:
        raise SpeechError("语音供应商 Base URL 不能包含查询参数")
    if providers.provider_requires_key(provider) and not str(provider.get("api_key") or "").strip():
        raise SpeechError("语音合成供应商尚未配置 API Key")
    extra_params = model.get("extra_params")
    if extra_params is None:
        extra_params = {}
    if not isinstance(extra_params, dict):
        raise SpeechError("模型额外参数必须是 JSON 对象")
    options = extra_params.get("_tts")
    if options is None:
        options = {}
    if not isinstance(options, dict):
        raise SpeechError("语音合成协议配置 _tts 必须是 JSON 对象")
    protocol = str(options.get("protocol") or "openai").strip().lower()
    if protocol not in {"openai", "dashscope"}:
        raise SpeechError("语音合成协议仅支持 openai 或 dashscope")
    endpoint = str(options.get("endpoint") or "").strip()
    if endpoint and any(character.isspace() or ord(character) < 32 for character in endpoint):
        raise SpeechError("语音合成端点不能包含空白或控制字符")
    if endpoint.startswith("/") and not endpoint.startswith("//"):
        endpoint = urljoin(base_url + "/", endpoint)
    native_schema = ""
    if protocol == "dashscope":
        hint = urlparse(endpoint or base_url).path.lower()
        if hint.endswith("/speechsynthesizer"):
            native_schema = "qwen_audio"
        elif hint.endswith("/multimodal-generation/generation"):
            native_schema = "qwen3"
        elif "qwen-audio-" in lower and "-tts" in lower:
            native_schema = "qwen_audio"
        elif lower.startswith(("qwen3-tts", "qwen-tts")):
            native_schema = "qwen3"
        else:
            raise SpeechError("DashScope 自定义模型别名需要设置明确的同源 SpeechSynthesizer 或 multimodal-generation/generation 端点")
        if not endpoint:
            path = (
                "/api/v1/services/audio/tts/SpeechSynthesizer"
                if native_schema == "qwen_audio"
                else "/api/v1/services/aigc/multimodal-generation/generation"
            )
            endpoint = base_url if hint.endswith(path.lower()) else urljoin(base_url + "/", path)
    elif not endpoint:
        endpoint = base_url + "/audio/speech"
    target = _parse_url(endpoint)
    if _origin(base) != _origin(target) or target.query:
        raise SpeechError("语音合成端点必须与供应商 Base URL 同源，且不能包含查询参数")
    formats = list(AUDIO_MIME_TYPES)
    default_voice, default_format = "alloy", "mp3"
    minimum, maximum = 0.25, 4.0
    max_text_length = MAX_TEXT_LENGTH
    if native_schema == "qwen_audio":
        formats = ["mp3", "wav", "opus", "pcm"]
        default_voice = "longanhuan_v3.1"
        minimum, maximum = 0.5, 2.0
    elif native_schema == "qwen3":
        formats = ["wav"]
        default_voice, default_format = "Cherry", "wav"
        minimum, maximum = 1.0, 1.0
        max_text_length = 600
    response_format = str(options.get("response_format") or default_format).strip().lower()
    if response_format not in formats:
        raise SpeechError(f"当前语音协议支持的音频格式为 {'、'.join(formats)}")
    return {
        "protocol": protocol,
        "endpoint": endpoint,
        "native_schema": native_schema,
        "voice": _voice(options.get("voice", default_voice)),
        "response_format": response_format,
        "speed": _speed(options.get("speed", 1.0), minimum, maximum),
        "formats": formats,
        "speed_min": minimum,
        "speed_max": maximum,
        "max_text_length": max_text_length,
    }


def _error_detail(payload: Any, provider: dict[str, Any]) -> str:
    detail = "供应商没有返回有效错误详情"
    if isinstance(payload, dict):
        error = payload.get("error") or payload
        if isinstance(error, dict):
            detail = str(error.get("message") or error.get("code") or detail)
    secrets = [str(provider.get("api_key") or "")]
    extra_headers = provider.get("extra_headers") or {}
    if isinstance(extra_headers, dict):
        secrets.extend(str(value) for value in extra_headers.values())
    for secret in sorted((value for value in secrets if value), key=len, reverse=True):
        detail = detail.replace(secret, "[redacted]").replace(quote(secret, safe=""), "[redacted]")
    detail = re.sub(r"https?://[^\s\"'<>]+", "[url]", detail)
    detail = re.sub(r"(?i)bearer\s+[^\s\"'<>]+", "Bearer [redacted]", detail)
    return detail[:240]


async def _read_response(response: httpx2.Response, limit: int, *, truncate: bool = False) -> bytes:
    declared = response.headers.get("content-length", "")
    if not truncate and declared.isdigit() and int(declared) > limit:
        raise SpeechError("语音供应商返回内容超过大小上限")
    chunks: list[bytes] = []
    length = 0
    async for chunk in response.aiter_bytes(chunk_size=65536):
        length += len(chunk)
        if length > limit:
            if truncate:
                chunks.append(chunk[:limit - (length - len(chunk))])
                break
            raise SpeechError("语音供应商返回内容超过大小上限")
        chunks.append(chunk)
    return b"".join(chunks)


def _json_payload(data: bytes) -> Any:
    try:
        return json.loads(data)
    except (ValueError, UnicodeError):
        return None


def _download_url(value: Any, provider: dict[str, Any]) -> str:
    if not isinstance(value, str):
        raise SpeechError("语音供应商未返回可用音频下载地址")
    target = _parse_url(value)
    base = _parse_url(str(provider.get("base_url") or "").strip().rstrip("/"))
    if _origin(base) == _origin(target):
        return value
    if target.hostname.lower() not in TRUSTED_DASHSCOPE_AUDIO_HOSTS or target.port not in {None, 80, 443}:
        raise SpeechError("供应商返回的音频下载地址未经信任，仅允许供应商同源或已核实的 DashScope 官方结果域名")
    if target.scheme == "http":
        host = target.hostname.lower()
        return urlunparse(target._replace(scheme="https", netloc=host))
    return value


def _audio_result(data: bytes, response_format: str, content_type: str) -> tuple[bytes, str]:
    if not data:
        raise SpeechError("语音合成没有返回音频数据")
    if len(data) > MAX_AUDIO_BYTES:
        raise SpeechError("语音合成音频超过 10 MB 上限")
    mime_type = content_type.split(";", 1)[0].strip().lower()
    if mime_type and not mime_type.startswith("audio/") and mime_type not in {"application/octet-stream", "binary/octet-stream", "application/ogg"}:
        raise SpeechError("语音供应商返回的内容不是音频，请检查模型与协议")
    valid = {
        "wav": len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WAVE",
        "mp3": data.startswith(b"ID3") or (len(data) >= 2 and data[0] == 255 and data[1] & 0xE6 == 0xE2),
        "opus": data.startswith(b"OggS"),
        "aac": len(data) >= 2 and data[0] == 255 and data[1] & 0xF6 == 0xF0,
        "flac": data.startswith(b"fLaC"),
        "pcm": len(data) % 2 == 0 and bool(mime_type),
    }
    if not valid[response_format]:
        raise SpeechError("语音供应商返回的音频格式与请求不一致或数据无效")
    return data, AUDIO_MIME_TYPES[response_format]


async def synthesize_speech(
    text: str,
    model: dict[str, Any],
    provider: dict[str, Any],
    voice: str | None = None,
    response_format: str | None = None,
    speed: float | None = None,
) -> dict[str, Any]:
    settings = synthesis_config(model, provider)
    if not isinstance(text, str) or not text.strip():
        raise SpeechError("语音合成文本不能为空")
    if len(text) > settings["max_text_length"]:
        raise SpeechError(f"当前语音模型每次最多合成 {settings['max_text_length']} 个字符")
    if voice is not None:
        settings["voice"] = _voice(voice)
    if response_format is not None:
        if not isinstance(response_format, str) or response_format not in settings["formats"]:
            raise SpeechError(f"当前语音协议支持的音频格式为 {'、'.join(settings['formats'])}")
        settings["response_format"] = response_format
    if speed is not None:
        settings["speed"] = _speed(speed, settings["speed_min"], settings["speed_max"])
    try:
        configured_timeout = float(provider.get("timeout_seconds") or 60)
    except (TypeError, ValueError, OverflowError) as exc:
        raise SpeechError("语音供应商超时配置必须是有效数字") from exc
    if not math.isfinite(configured_timeout) or configured_timeout <= 0:
        raise SpeechError("语音供应商超时配置必须是正数")
    timeout = min(max(configured_timeout, 1.0), MAX_TIMEOUT_SECONDS)
    try:
        headers = providers.validate_headers(provider.get("extra_headers") or {})
    except (providers.ProviderError, AttributeError, TypeError) as exc:
        raise SpeechError("语音供应商附加 Header 配置无效") from exc
    headers = {
        name: value for name, value in headers.items()
        if name.lower() not in {"accept", "content-type", "x-dashscope-sse", "cookie", "proxy-authorization", "host"}
    }
    api_key = str(provider.get("api_key") or "").strip()
    if api_key:
        if any(character in api_key for character in "\r\n"):
            raise SpeechError("语音供应商 API Key 格式无效")
        headers["Authorization"] = f"Bearer {api_key}"
    payload: dict[str, Any] = {
        "model": str(model["model_id"]),
        "input": text.strip(),
        "voice": settings["voice"],
        "response_format": settings["response_format"],
        "speed": settings["speed"],
    }
    headers["Content-Type"] = "application/json"
    headers["Accept"] = "audio/*"
    if settings["protocol"] == "dashscope":
        inputs: dict[str, Any] = {"text": text.strip(), "voice": settings["voice"]}
        if settings["native_schema"] == "qwen_audio":
            inputs.update(format=settings["response_format"], rate=settings["speed"])
        else:
            inputs["language_type"] = "Auto"
        payload = {"model": str(model["model_id"]), "input": inputs}
        headers["Accept"] = "application/json"
        headers["X-DashScope-SSE"] = "disable"
    started = time.monotonic()
    usage: dict[str, int] = {}
    try:
        async with asyncio.timeout(timeout):
            async with httpx2.AsyncClient(
                timeout=httpx2.Timeout(timeout, connect=min(5.0, timeout)),
                follow_redirects=False,
                trust_env=False,
            ) as client:
                async with client.stream("POST", settings["endpoint"], headers=headers, json=payload) as response:
                    if response.status_code >= 300:
                        error = _json_payload(await _read_response(response, 16384, truncate=True))
                        raise SpeechError(
                            f"语音合成接口返回 {response.status_code}：{_error_detail(error, provider)}",
                            status_code=response.status_code,
                        )
                    limit = MAX_JSON_BYTES if settings["protocol"] == "dashscope" else MAX_AUDIO_BYTES
                    body = await _read_response(response, limit)
                    content_type = response.headers.get("content-type", "")
            if settings["protocol"] == "dashscope":
                data = _json_payload(body)
                if not isinstance(data, dict):
                    raise SpeechError("DashScope 语音供应商未返回有效 JSON 响应")
                status = data.get("status_code", 200)
                if data.get("error") or data.get("code") not in {None, "", 0, 200, "200"} or data.get("success") is False or status not in {None, 200, "200"}:
                    raise SpeechError(f"语音合成失败：{_error_detail(data, provider)}")
                output = data.get("output")
                audio = output.get("audio") if isinstance(output, dict) else None
                if not isinstance(audio, dict):
                    raise SpeechError("DashScope 语音响应缺少 output.audio")
                encoded = audio.get("data")
                content_type = AUDIO_MIME_TYPES[settings["response_format"]]
                if encoded:
                    if not isinstance(encoded, str) or len(encoded) > ((MAX_AUDIO_BYTES + 2) // 3) * 4:
                        raise SpeechError("语音供应商返回的 Base64 音频无效或超过 10 MB")
                    try:
                        body = base64.b64decode(encoded, validate=True)
                    except (binascii.Error, ValueError) as exc:
                        raise SpeechError("语音供应商返回的 Base64 音频无效") from exc
                else:
                    audio_url = _download_url(audio.get("url"), provider)
                    async with httpx2.AsyncClient(
                        timeout=httpx2.Timeout(timeout, connect=min(5.0, timeout)),
                        follow_redirects=False,
                        trust_env=False,
                    ) as downloader:
                        async with downloader.stream("GET", audio_url, headers={"Accept": "audio/*"}) as response:
                            if response.status_code >= 300:
                                raise SpeechError(f"语音音频下载返回 {response.status_code}，请检查供应商结果地址", status_code=response.status_code)
                            body = await _read_response(response, MAX_AUDIO_BYTES)
                            content_type = response.headers.get("content-type", "")
                raw_usage = data.get("usage")
                if isinstance(raw_usage, dict):
                    usage = {
                        name: value for name, value in raw_usage.items()
                        if name in {"characters", "input_tokens", "output_tokens", "total_tokens"}
                        and isinstance(value, int) and not isinstance(value, bool) and value >= 0
                    }
            audio_bytes, mime_type = _audio_result(body, settings["response_format"], content_type)
    except (TimeoutError, httpx2.TimeoutException) as exc:
        raise SpeechError(f"语音合成达到 {timeout:g} 秒超时上限，本次未自动重试") from exc
    except httpx2.RequestError as exc:
        raise SpeechError("无法连接语音供应商或下载音频，请检查网络；本次未自动重试") from exc
    except (TypeError, ValueError, UnicodeError) as exc:
        raise SpeechError("语音供应商响应或请求参数格式无效") from exc
    return {
        "audio": audio_bytes,
        "mime_type": mime_type,
        "response_format": settings["response_format"],
        "voice": settings["voice"],
        "model": str(model["model_id"]),
        "protocol": settings["protocol"],
        "latency_ms": int((time.monotonic() - started) * 1000),
        "usage": usage,
    }
