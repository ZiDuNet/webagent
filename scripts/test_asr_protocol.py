from __future__ import annotations

import base64
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import unittest
from unittest.mock import patch
import wave

import httpx2

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from webagent.agent import llm
from webagent.agent.providers import (
    ProviderError,
    guess_model_kind,
    reasoning_config,
    transcription_config,
)


class AudioProtocolTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.provider = {
            "name": "Protocol fixture",
            "base_url": "https://provider.example/v1",
            "api_key": "fixture-api-key",
            "timeout_seconds": 5,
        }
        self.audio = llm._silent_wav()
        self.requests: list[httpx2.Request] = []
        self.original_client = httpx2.AsyncClient

    async def request(
        self,
        model_id: str,
        response_body: object,
        *,
        options: dict[str, str] | None = None,
        status: int = 200,
        allow_empty: bool = False,
        audio: bytes | None = None,
        mime_type: str = "audio/wav",
    ) -> dict[str, object]:
        async def handle(request: httpx2.Request) -> httpx2.Response:
            self.requests.append(request)
            return httpx2.Response(status, json=response_body, request=request)

        transport = httpx2.MockTransport(handle)
        with patch.object(
            llm.httpx2,
            "AsyncClient",
            side_effect=lambda **kwargs: self.original_client(
                **kwargs, transport=transport
            ),
        ):
            return await llm.transcribe_audio(
                audio=self.audio if audio is None else audio,
                mime_type=mime_type,
                filename="fixture.wav",
                model={
                    "model_id": model_id,
                    "name": model_id,
                    "supports_transcription": True,
                    "extra_params": {"_asr": options or {}},
                },
                provider=self.provider,
                allow_empty=allow_empty,
            )

    async def test_openai_transcriptions_uses_multipart(self) -> None:
        result = await self.request("whisper-1", {"text": "设备运行正常"})
        self.assertEqual(result["text"], "设备运行正常")
        request = self.requests[0]
        self.assertEqual(request.url.path, "/v1/audio/transcriptions")
        self.assertIn("multipart/form-data", request.headers["content-type"])
        self.assertIn(self.audio, request.content)
        self.assertIn(b"whisper-1", request.content)

    async def test_qwen_chat_audio_uses_data_uri(self) -> None:
        result = await self.request(
            "qwen3-asr-flash",
            {"choices": [{"message": {"content": "查询设备"}}]},
        )
        self.assertEqual(result["text"], "查询设备")
        request = self.requests[0]
        self.assertEqual(request.url.path, "/v1/chat/completions")
        body = json.loads(request.content)
        part = body["messages"][0]["content"][0]["input_audio"]
        self.assertTrue(part["data"].startswith("data:audio/wav;base64,"))
        self.assertEqual(base64.b64decode(part["data"].split(",")[1]), self.audio)
        self.assertEqual(body["asr_options"]["language"], "zh")
        self.assertNotIn("_asr", body)

    async def test_standard_chat_audio_uses_base64_and_transcript(self) -> None:
        result = await self.request(
            "gpt-audio-mini",
            {"choices": [{"message": {"audio": {"transcript": "hello"}}}]},
        )
        self.assertEqual(result["text"], "hello")
        body = json.loads(self.requests[0].content)
        part = body["messages"][0]["content"][1]["input_audio"]
        self.assertEqual(part["format"], "wav")
        self.assertEqual(base64.b64decode(part["data"]), self.audio)
        self.assertEqual(body["modalities"], ["text"])

    async def test_dashscope_native_legacy_and_new_audio_schema(self) -> None:
        await self.request(
            "qwen3-asr-flash",
            {"output": {"choices": [{"message": {"content": [{"text": "你好"}]}}]}},
            options={"protocol": "dashscope"},
        )
        request = self.requests[-1]
        self.assertEqual(
            request.url.path,
            "/api/v1/services/aigc/multimodal-generation/generation",
        )
        body = json.loads(request.content)
        self.assertIn("audio", body["input"]["messages"][0]["content"][0])
        self.assertEqual(body["parameters"]["asr_options"]["language"], "zh")
        result = await self.request(
            "qwen-audio-3.0-asr-flash",
            {"output": {"text": "设备正常"}},
        )
        self.assertEqual(result["text"], "设备正常")
        body = json.loads(self.requests[-1].content)
        self.assertEqual(
            body["input"]["messages"][0]["content"][0]["type"], "input_audio"
        )
        self.assertEqual(body["parameters"]["format"], "wav")
        self.assertEqual(body["parameters"]["sample_rate"], 16000)

    async def test_custom_protocol_endpoint_can_override_model_alias(self) -> None:
        await self.request(
            "private-audio-alias",
            {"text": "hello"},
            options={"protocol": "transcriptions", "endpoint": "/speech/recognize"},
        )
        self.assertEqual(self.requests[0].url.path, "/speech/recognize")

    async def test_empty_transcript_only_succeeds_for_connection_tests(self) -> None:
        result = await self.request("whisper-1", {"text": ""}, allow_empty=True)
        self.assertEqual(result["text"], "")
        with self.assertRaisesRegex(llm.LLMError, "没有返回文本"):
            await self.request("whisper-1", {"text": ""})

    async def test_missing_transcript_is_not_a_successful_silence_test(self) -> None:
        with self.assertRaisesRegex(llm.LLMError, "缺少识别结果"):
            await self.request("whisper-1", {"ok": True}, allow_empty=True)

    async def test_realtime_has_explicit_protocol_error_without_http_request(self) -> None:
        with self.assertRaisesRegex(llm.LLMError, "WebSocket"):
            await self.request("qwen-audio-3.1-realtime-plus", {})
        self.assertFalse(self.requests)
        self.assertEqual(guess_model_kind("qwen-audio-3.1-realtime-plus"), "asr_realtime")

    async def test_http_error_keeps_status_and_redacts_credentials(self) -> None:
        with self.assertRaises(llm.LLMError) as raised:
            await self.request(
                "qwen3-asr-flash",
                {"error": {"message": "bad fixture-api-key"}},
                status=429,
            )
        self.assertEqual(raised.exception.status_code, 429)
        self.assertTrue(raised.exception.retryable)
        self.assertNotIn("fixture-api-key", str(raised.exception))

    async def test_timeout_is_normalized(self) -> None:
        async def handle(request: httpx2.Request) -> httpx2.Response:
            raise httpx2.ReadTimeout("fixture timeout", request=request)

        with patch.object(
            llm.httpx2,
            "AsyncClient",
            side_effect=lambda **kwargs: self.original_client(
                **kwargs, transport=httpx2.MockTransport(handle)
            ),
        ):
            with self.assertRaisesRegex(llm.LLMError, "超时") as raised:
                await llm.transcribe_audio(
                    audio=self.audio,
                    mime_type="audio/wav",
                    filename="fixture.wav",
                    model={"model_id": "whisper-1", "supports_transcription": True},
                    provider=self.provider,
                )
        self.assertTrue(raised.exception.retryable)

    async def test_webm_recordings_convert_to_wav_for_chat_audio(self) -> None:
        executable = shutil.which("ffmpeg")
        if not executable:
            self.skipTest("FFmpeg is not installed")
        encoded = subprocess.run(
            [executable, "-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-f", "webm", "pipe:1"],
            input=self.audio,
            capture_output=True,
            timeout=10,
            check=True,
        ).stdout
        await self.request(
            "qwen3-asr-flash",
            {"choices": [{"message": {"content": ""}}]},
            audio=encoded,
            mime_type="audio/webm",
            allow_empty=True,
        )
        body = json.loads(self.requests[0].content)
        data_uri = body["messages"][0]["content"][0]["input_audio"]["data"]
        converted = base64.b64decode(data_uri.split(",")[1])
        with wave.open(io.BytesIO(converted), "rb") as wav:
            self.assertEqual(wav.getframerate(), 16000)
            self.assertEqual(wav.getnchannels(), 1)
            self.assertEqual(wav.getnframes(), 16000)

    def test_endpoint_rejects_key_forwarding_to_other_origins(self) -> None:
        with self.assertRaisesRegex(ProviderError, "同源"):
            transcription_config(
                {"extra_params": {"_asr": {"endpoint": "https://other.example/audio"}}},
                self.provider,
            )


class ReasoningProtocolTests(unittest.TestCase):
    def payload(self, model: dict[str, object], effort: str) -> dict[str, object]:
        return llm._request_payload(
            messages=[{"role": "user", "content": "Hi"}],
            tools=[],
            model={
                "supports_reasoning": True,
                "reasoning_efforts": ["low", "medium", "high"],
                **model,
            },
            config={"temperature": 0.3},
            reasoning_effort=effort,
        )

    def test_qwen_off_overrides_model_default_thinking(self) -> None:
        payload = self.payload(
            {"model_id": "qwen3-32b", "extra_params": {"enable_thinking": True}},
            "off",
        )
        self.assertEqual(payload["extra_body"], {"enable_thinking": False})
        self.assertNotIn("reasoning_effort", payload)

    def test_deepseek_off_uses_thinking_type_disabled(self) -> None:
        payload = self.payload({"model_id": "deepseek-v4.1-flash"}, "off")
        self.assertEqual(payload["extra_body"], {"thinking": {"type": "disabled"}})
        self.assertNotIn("reasoning_effort", payload)
        enabled = self.payload({"model_id": "deepseek-v4.1-flash"}, "high")
        self.assertEqual(enabled["extra_body"], {"thinking": {"type": "enabled"}})
        self.assertEqual(enabled["reasoning_effort"], "high")

    def test_declared_standard_none_and_fixed_reasoning(self) -> None:
        payload = self.payload(
            {"model_id": "standard-chat", "reasoning_efforts": ["none", "high"]},
            "off",
        )
        self.assertEqual(payload["reasoning_effort"], "none")
        with self.assertRaisesRegex(llm.LLMError, "未声明支持关闭推理"):
            self.payload({"model_id": "o3"}, "off")
        self.assertFalse(reasoning_config({"model_id": "deepseek-r1"})["can_disable"])

    def test_framework_metadata_never_enters_provider_chat_request(self) -> None:
        payload = self.payload(
            {
                "model_id": "qwen3-32b",
                "extra_params": {
                    "_asr": {"protocol": "chat_audio"},
                    "_reasoning": {"protocol": "enable_thinking"},
                    "extra_body": {"enable_thinking": True, "model": "wrong"},
                },
            },
            "off",
        )
        self.assertEqual(payload["model"], "qwen3-32b")
        self.assertEqual(payload["extra_body"], {"enable_thinking": False})
        self.assertNotIn("_asr", payload)


if __name__ == "__main__":
    unittest.main(verbosity=2)
