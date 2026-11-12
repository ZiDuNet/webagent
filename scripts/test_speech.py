from __future__ import annotations

import asyncio
import base64
from contextlib import contextmanager
import json
from pathlib import Path
import sys
import time
import unittest
from unittest.mock import patch

import httpx2

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from webagent.agent import llm, speech


class SpeechConfigTests(unittest.TestCase):
    def setUp(self) -> None:
        self.model = {"model_id": "tts-1", "model_kind": "tts", "enabled": True}
        self.provider = {
            "base_url": "https://provider.example/v1",
            "api_key": "fixture-key",
            "enabled": True,
        }

    def options(self, **options: object) -> dict:
        return {**self.model, "extra_params": {"_tts": options}}

    def test_openai_defaults_and_limits(self) -> None:
        config = speech.synthesis_config(self.model, self.provider)
        self.assertEqual(config["endpoint"], "https://provider.example/v1/audio/speech")
        self.assertEqual(config["voice"], "alloy")
        self.assertEqual(config["response_format"], "mp3")
        self.assertEqual(config["speed"], 1)
        self.assertEqual(config["speed_min"], 0.25)
        self.assertEqual(config["speed_max"], 4)
        self.assertEqual(config["max_text_length"], 4000)
        self.assertEqual(set(config["formats"]), {"mp3", "wav", "opus", "aac", "flac", "pcm"})

    def test_native_defaults_are_protocol_specific(self) -> None:
        for model_id, schema, voice, response_format, text_length, speed_min, speed_max, path in [
            ("qwen3-tts-flash", "qwen3", "Cherry", "wav", 600, 1, 1, "/api/v1/services/aigc/multimodal-generation/generation"),
            ("qwen-audio-3.1-tts-flash", "qwen_audio", "longanhuan_v3.1", "mp3", 4000, 0.5, 2, "/api/v1/services/audio/tts/SpeechSynthesizer"),
        ]:
            with self.subTest(model_id=model_id):
                model = {**self.options(protocol="dashscope"), "model_id": model_id}
                config = speech.synthesis_config(model, self.provider)
                self.assertEqual(config["native_schema"], schema)
                self.assertEqual(config["voice"], voice)
                self.assertEqual(config["response_format"], response_format)
                self.assertEqual(config["max_text_length"], text_length)
                self.assertEqual((config["speed_min"], config["speed_max"]), (speed_min, speed_max))
                self.assertEqual(config["endpoint"], "https://provider.example" + path)

    def test_unknown_native_alias_requires_an_explicit_schema_endpoint(self) -> None:
        with self.assertRaisesRegex(speech.SpeechError, "自定义模型别名"):
            speech.synthesis_config(self.options(protocol="dashscope"), self.provider)
        config = speech.synthesis_config(
            self.options(protocol="dashscope", endpoint="/services/audio/tts/SpeechSynthesizer"), self.provider,
        )
        self.assertEqual(config["native_schema"], "qwen_audio")
        config = speech.synthesis_config(
            self.options(protocol="dashscope", endpoint="/services/aigc/multimodal-generation/generation"), self.provider,
        )
        self.assertEqual(config["native_schema"], "qwen3")

    def test_native_provider_full_endpoint_is_not_duplicated(self) -> None:
        endpoint = "https://provider.example/api/v1/services/audio/tts/SpeechSynthesizer"
        config = speech.synthesis_config(
            self.options(protocol="dashscope"), {**self.provider, "base_url": endpoint},
        )
        self.assertEqual(config["endpoint"], endpoint)

    def test_endpoint_is_same_origin_and_has_no_credentials_or_query(self) -> None:
        for endpoint in [
            "https://other.example/speech", "//other.example/speech", "/speech?key=secret",
            "https://provider.example:444/speech", "http://provider.example/speech",
            "https://user:password@provider.example/speech", "/speech#fragment", "/bad\nendpoint",
            "https://provider.example\\@other.example/speech",
        ]:
            with self.subTest(endpoint=endpoint), self.assertRaises(speech.SpeechError):
                speech.synthesis_config(self.options(endpoint=endpoint), self.provider)
        config = speech.synthesis_config(self.options(endpoint="https://provider.example:443/custom/speech"), self.provider)
        self.assertEqual(config["endpoint"], "https://provider.example:443/custom/speech")

    def test_invalid_model_provider_and_key_are_rejected(self) -> None:
        for model, provider in [
            ({**self.model, "model_kind": "chat"}, self.provider),
            ({**self.model, "enabled": False}, self.provider),
            ({**self.model, "model_id": ""}, self.provider),
            ({**self.model, "model_id": "qwen3-tts-realtime"}, self.provider),
            (self.model, {**self.provider, "enabled": False}),
            (self.model, {**self.provider, "api_key": ""}),
            (self.model, {**self.provider, "base_url": "https://user:password@provider.example/v1"}),
            (self.model, {**self.provider, "base_url": "https://provider.example/v1?key=secret"}),
        ]:
            with self.subTest(model=model, provider=provider), self.assertRaises(speech.SpeechError):
                speech.synthesis_config(model, provider)

    def test_local_provider_without_key_requires_loopback(self) -> None:
        for base_url in ("http://127.0.0.1:1234/v1", "http://localhost:1234/v1", "http://[::1]:1234/v1"):
            with self.subTest(base_url=base_url):
                provider = {**self.provider, "provider_type": "lmstudio", "base_url": base_url, "api_key": ""}
                self.assertEqual(speech.synthesis_config(self.model, provider)["voice"], "alloy")
        for base_url in ("http://192.168.1.3:1234/v1", "https://other.example/v1"):
            with self.subTest(base_url=base_url), self.assertRaisesRegex(speech.SpeechError, "API Key"):
                speech.synthesis_config(self.model, {**self.provider, "provider_type": "lmstudio", "base_url": base_url, "api_key": ""})

    def test_malformed_options_invalid_speed_and_formats_fail(self) -> None:
        for extra_params in [[], "bad", {"_tts": []}, {"_tts": "bad"}, {"_tts": {"protocol": "unknown"}}]:
            with self.subTest(extra_params=extra_params), self.assertRaises(speech.SpeechError):
                speech.synthesis_config({**self.model, "extra_params": extra_params}, self.provider)
        for speed in (True, "bad", float("nan"), float("inf"), 0.24, 4.01):
            with self.subTest(speed=speed), self.assertRaises(speech.SpeechError):
                speech.synthesis_config(self.options(speed=speed), self.provider)
        for response_format in ("json", "html"):
            with self.subTest(response_format=response_format), self.assertRaises(speech.SpeechError):
                speech.synthesis_config(self.options(response_format=response_format), self.provider)

    def test_legacy_qwen3_does_not_claim_openai_format_speed_support(self) -> None:
        for options in ({"response_format": "mp3"}, {"speed": 1.1}):
            with self.subTest(options=options), self.assertRaises(speech.SpeechError):
                speech.synthesis_config({**self.model, "model_id": "qwen3-tts-flash", "extra_params": {"_tts": {"protocol": "dashscope", **options}}}, self.provider)


class SpeechRequestTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.model = {"model_id": "tts-1", "model_kind": "tts", "enabled": True}
        self.provider = {
            "name": "Speech fixture", "base_url": "https://provider.example/v1", "api_key": "fixture-key",
            "timeout_seconds": 5, "extra_headers": {"X-Project-Key": "fixture-project-key"},
        }
        self.requests: list[httpx2.Request] = []
        self.original_client = httpx2.AsyncClient
        self.wav = llm._silent_wav(0.01)

    @contextmanager
    def transport(self, handler):
        async def respond(request):
            self.requests.append(request)
            return await handler(request)

        with patch.object(speech.httpx2, "AsyncClient", side_effect=lambda **kwargs: self.original_client(**kwargs, transport=httpx2.MockTransport(respond))):
            yield

    def native_model(self, model_id="qwen3-tts-flash", **options):
        return {**self.model, "model_id": model_id, "extra_params": {"_tts": {"protocol": "dashscope", **options}}}

    async def wav_handler(self, request):
        return httpx2.Response(200, content=self.wav, headers={"Content-Type": "audio/wav"}, request=request)

    async def test_openai_request_uses_only_speech_fields_and_returns_audio(self) -> None:
        model = {**self.model, "extra_params": {"_tts": {"voice": "coral", "response_format": "wav", "speed": 0.75}, "max_tokens": 400, "api_key": "must-not-send"}}
        with self.transport(self.wav_handler):
            result = await speech.synthesize_speech("你好", model, self.provider)
        request = self.requests[0]
        self.assertEqual(request.method, "POST")
        self.assertEqual(request.url.path, "/v1/audio/speech")
        self.assertEqual(json.loads(request.content), {"model": "tts-1", "input": "你好", "voice": "coral", "response_format": "wav", "speed": 0.75})
        self.assertEqual(request.headers["authorization"], "Bearer fixture-key")
        self.assertEqual(result["audio"], self.wav)
        self.assertEqual(result["mime_type"], "audio/wav")
        self.assertGreaterEqual(result["latency_ms"], 0)

    async def test_call_overrides_do_not_mutate_model_options(self) -> None:
        model = {**self.model, "extra_params": {"_tts": {"voice": "coral", "response_format": "mp3", "speed": 1}}}
        with self.transport(self.wav_handler):
            result = await speech.synthesize_speech("你好", model, self.provider, voice="nova", response_format="wav", speed=2)
        self.assertEqual((result["voice"], result["response_format"]), ("nova", "wav"))
        self.assertEqual(model["extra_params"]["_tts"], {"voice": "coral", "response_format": "mp3", "speed": 1})

    async def test_supported_audio_formats_keep_binary_and_correct_mime(self) -> None:
        fixtures = {
            "mp3": (b"ID3" + bytes(20), "audio/mpeg"),
            "wav": (self.wav, "audio/wav"),
            "opus": (b"OggS" + bytes(20), "audio/ogg"),
            "aac": (b"\xff\xf1" + bytes(20), "audio/aac"),
            "flac": (b"fLaC" + bytes(20), "audio/flac"),
            "pcm": (bytes(20), "audio/pcm"),
        }
        for response_format, (audio, mime_type) in fixtures.items():
            async def handler(request):
                return httpx2.Response(200, content=audio, headers={"Content-Type": mime_type}, request=request)

            with self.subTest(response_format=response_format), self.transport(handler):
                result = await speech.synthesize_speech("你好", self.model, self.provider, response_format=response_format)
            self.assertEqual(result["audio"], audio)
            self.assertEqual(result["mime_type"], mime_type)

    async def test_local_keyless_request_sends_no_authorization(self) -> None:
        provider = {**self.provider, "provider_type": "lmstudio", "base_url": "http://127.0.0.1:1234/v1", "api_key": ""}
        with self.transport(self.wav_handler):
            await speech.synthesize_speech("你好", self.model, provider, response_format="wav")
        self.assertNotIn("authorization", self.requests[0].headers)

    async def test_qwen3_native_payload_and_inline_base64_audio(self) -> None:
        async def handler(request):
            return httpx2.Response(200, json={"code": "", "output": {"audio": {"data": base64.b64encode(self.wav).decode()}}, "usage": {"characters": 2, "input_tokens": 1, "total_tokens": 1, "secret": "ignore"}}, request=request)

        with self.transport(handler):
            result = await speech.synthesize_speech("你好", self.native_model(), self.provider)
        self.assertEqual(json.loads(self.requests[0].content), {"model": "qwen3-tts-flash", "input": {"text": "你好", "voice": "Cherry", "language_type": "Auto"}})
        self.assertEqual(self.requests[0].url.path, "/api/v1/services/aigc/multimodal-generation/generation")
        self.assertEqual(self.requests[0].headers["x-dashscope-sse"], "disable")
        self.assertEqual(result["audio"], self.wav)
        self.assertEqual(result["usage"], {"characters": 2, "input_tokens": 1, "total_tokens": 1})

    async def test_qwen_audio_native_payload_uses_format_and_rate(self) -> None:
        async def handler(request):
            return httpx2.Response(200, json={"output": {"audio": {"data": base64.b64encode(self.wav).decode()}}}, request=request)

        with self.transport(handler):
            await speech.synthesize_speech("你好", self.native_model("qwen-audio-3.1-tts-flash", response_format="wav", speed=1.5), self.provider)
        self.assertEqual(self.requests[0].url.path, "/api/v1/services/audio/tts/SpeechSynthesizer")
        self.assertEqual(json.loads(self.requests[0].content), {"model": "qwen-audio-3.1-tts-flash", "input": {"text": "你好", "voice": "longanhuan_v3.1", "format": "wav", "rate": 1.5}})

    async def test_official_url_download_is_https_and_has_no_credentials(self) -> None:
        async def handler(request):
            if request.method == "POST":
                return httpx2.Response(200, json={"output": {"audio": {"url": "http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/audio.wav?Signature=fixture"}}}, headers={"Set-Cookie": "secret=post-cookie"}, request=request)
            return await self.wav_handler(request)

        with self.transport(handler):
            result = await speech.synthesize_speech("你好", self.native_model(), self.provider)
        self.assertEqual(result["audio"], self.wav)
        download = self.requests[1]
        self.assertEqual(download.url.scheme, "https")
        self.assertEqual(download.url.query, b"Signature=fixture")
        for name in ("authorization", "x-project-key", "cookie"):
            self.assertNotIn(name, download.headers)

    async def test_same_origin_download_also_does_not_forward_key_or_cookies(self) -> None:
        async def handler(request):
            if request.method == "POST":
                return httpx2.Response(200, json={"output": {"audio": {"url": "https://provider.example/generated/audio.wav"}}}, headers={"Set-Cookie": "secret=post-cookie"}, request=request)
            return await self.wav_handler(request)

        with self.transport(handler):
            await speech.synthesize_speech("你好", self.native_model(), self.provider)
        for name in ("authorization", "x-project-key", "cookie"):
            self.assertNotIn(name, self.requests[1].headers)

    async def test_untrusted_result_hosts_credentials_and_fragments_are_rejected(self) -> None:
        for url in (
            "http://169.254.169.254/latest/meta-data", "http://127.0.0.1/private",
            "https://attacker.example/audio.wav", "https://evil.oss-cn-beijing.aliyuncs.com/audio.wav",
            "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com.evil.example/audio.wav",
            "https://user:pass@provider.example/audio.wav", "https://provider.example/audio.wav#fragment",
        ):
            async def handler(request):
                return httpx2.Response(200, json={"output": {"audio": {"url": url}}}, request=request)

            with self.subTest(url=url), self.transport(handler), self.assertRaises(speech.SpeechError):
                await speech.synthesize_speech("你好", self.native_model(), self.provider)
        self.assertTrue(all(request.method == "POST" for request in self.requests))

    async def test_audio_download_redirect_is_not_followed(self) -> None:
        async def handler(request):
            if request.method == "POST":
                return httpx2.Response(200, json={"output": {"audio": {"url": "https://provider.example/audio.wav"}}}, request=request)
            return httpx2.Response(302, headers={"Location": "https://attacker.example/"}, request=request)

        with self.transport(handler), self.assertRaisesRegex(speech.SpeechError, "302"):
            await speech.synthesize_speech("你好", self.native_model(), self.provider)
        self.assertEqual(len(self.requests), 2)

    async def test_generation_redirect_is_not_followed(self) -> None:
        async def handler(request):
            return httpx2.Response(307, headers={"Location": "https://attacker.example/"}, request=request)

        with self.transport(handler), self.assertRaisesRegex(speech.SpeechError, "307"):
            await speech.synthesize_speech("你好", self.model, self.provider)
        self.assertEqual(len(self.requests), 1)

    async def test_http_error_is_redacted_and_not_retried(self) -> None:
        async def handler(request):
            return httpx2.Response(429, json={"error": {"message": "bad fixture-key fixture-project-key https://secret.example/?token=hide Bearer unknown-secret"}}, request=request)

        with self.transport(handler), self.assertRaises(speech.SpeechError) as raised:
            await speech.synthesize_speech("你好", self.model, self.provider)
        self.assertEqual(raised.exception.status_code, 429)
        self.assertFalse(raised.exception.retryable)
        for secret in ("fixture-key", "fixture-project-key", "secret.example", "unknown-secret"):
            self.assertNotIn(secret, str(raised.exception))
        self.assertEqual(len(self.requests), 1)

    async def test_native_error_envelope_is_not_audio(self) -> None:
        async def handler(request):
            return httpx2.Response(200, json={"code": "InvalidParameter", "message": "bad fixture-key"}, request=request)

        with self.transport(handler), self.assertRaisesRegex(speech.SpeechError, "InvalidParameter|redacted") as raised:
            await speech.synthesize_speech("你好", self.native_model(), self.provider)
        self.assertNotIn("fixture-key", str(raised.exception))

    async def test_non_audio_and_wrong_container_are_not_reported_as_success(self) -> None:
        for content_type, body in [("text/html", b"<html>no audio</html>"), ("audio/wav", b"{\"ok\":true}"), ("application/json", b"{\"error\":\"bad\"}"), ("audio/wav", b"")]:
            async def handler(request):
                return httpx2.Response(200, content=body, headers={"Content-Type": content_type}, request=request)

            with self.subTest(content_type=content_type, body=body), self.transport(handler), self.assertRaises(speech.SpeechError):
                await speech.synthesize_speech("你好", self.model, self.provider, response_format="wav")

    async def test_native_missing_invalid_and_oversized_base64_are_rejected(self) -> None:
        payloads = [{}, {"output": {"audio": {}}}, {"output": {"audio": {"data": "not base64"}}}, {"output": {"audio": {"data": base64.b64encode(self.wav).decode()}}}]
        for payload in payloads:
            async def handler(request):
                return httpx2.Response(200, json=payload, request=request)

            with self.subTest(payload=payload), self.transport(handler), patch.object(speech, "MAX_AUDIO_BYTES", 64), self.assertRaises(speech.SpeechError):
                await speech.synthesize_speech("你好", self.native_model(), self.provider)

    async def test_declared_and_streamed_audio_size_limits_are_enforced(self) -> None:
        class AudioStream(httpx2.AsyncByteStream):
            async def __aiter__(self):
                yield b"RIFF" + b"\x00" * 4 + b"WAVE" + b"x" * 80
                yield b"x" * 80

        async def declared(request):
            return httpx2.Response(200, content=self.wav, headers={"Content-Type": "audio/wav"}, request=request)

        async def streamed(request):
            return httpx2.Response(200, stream=AudioStream(), headers={"Content-Type": "audio/wav"}, request=request)

        for handler in (declared, streamed):
            with self.subTest(handler=handler.__name__), self.transport(handler), patch.object(speech, "MAX_AUDIO_BYTES", 128), self.assertRaisesRegex(speech.SpeechError, "大小上限"):
                await speech.synthesize_speech("你好", self.model, self.provider, response_format="wav")

    async def test_hard_timeout_bounds_entire_generation_and_has_no_retry(self) -> None:
        async def handler(request):
            await asyncio.sleep(0.3)
            return await self.wav_handler(request)

        started = time.monotonic()
        with self.transport(handler), patch.object(speech, "MAX_TIMEOUT_SECONDS", 0.03), self.assertRaisesRegex(speech.SpeechError, "超时"):
            await speech.synthesize_speech("你好", self.model, self.provider, response_format="wav")
        self.assertLess(time.monotonic() - started, 0.25)
        self.assertEqual(len(self.requests), 1)

    async def test_download_shares_the_generation_deadline(self) -> None:
        async def handler(request):
            await asyncio.sleep(0.02)
            if request.method == "POST":
                return httpx2.Response(200, json={"output": {"audio": {"url": "https://provider.example/audio.wav"}}}, request=request)
            await asyncio.sleep(0.1)
            return await self.wav_handler(request)

        with self.transport(handler), patch.object(speech, "MAX_TIMEOUT_SECONDS", 0.04), self.assertRaisesRegex(speech.SpeechError, "超时"):
            await speech.synthesize_speech("你好", self.native_model(), self.provider)
        self.assertEqual(len(self.requests), 2)

    async def test_network_errors_do_not_expose_exception_urls_or_keys(self) -> None:
        async def handler(request):
            raise httpx2.ReadTimeout("fixture-key https://secret.example/", request=request)

        with self.transport(handler), self.assertRaises(speech.SpeechError) as raised:
            await speech.synthesize_speech("你好", self.model, self.provider)
        self.assertNotIn("fixture-key", str(raised.exception))
        self.assertNotIn("secret.example", str(raised.exception))

    async def test_invalid_text_overrides_and_timeout_do_not_call_supplier(self) -> None:
        requests = [
            ("", self.model, self.provider, {}), (" ", self.model, self.provider, {}),
            ("a" * 4001, self.model, self.provider, {}), ("中" * 601, self.native_model(), self.provider, {}),
            ("hi", self.model, self.provider, {"speed": 10}), ("hi", self.model, self.provider, {"voice": ""}),
            ("hi", self.model, self.provider, {"response_format": "html"}),
            ("hi", self.model, {**self.provider, "timeout_seconds": float("nan")}, {}),
            ("hi", self.model, {**self.provider, "extra_headers": {"Authorization": "secret"}}, {}),
        ]
        with self.transport(self.wav_handler):
            for text, model, provider, options in requests:
                with self.subTest(text=text[:20], options=options), self.assertRaises(speech.SpeechError):
                    await speech.synthesize_speech(text, model, provider, **options)
        self.assertFalse(self.requests)

    async def test_admin_test_returns_playable_audio_and_spends_only_once(self) -> None:
        model = {**self.model, "extra_params": {"_tts": {"response_format": "wav"}}}
        with self.transport(self.wav_handler):
            result = await llm.test_llm(model, self.provider, {"demo_mode": False})
        self.assertTrue(result["ok"])
        self.assertEqual(result["kind"], "tts")
        self.assertEqual(result["audio"]["mime_type"], "audio/wav")
        self.assertEqual(base64.b64decode(result["audio"]["data_url"].split(",", 1)[1]), self.wav)
        self.assertIn("latency_ms", result)
        self.assertEqual(json.loads(self.requests[0].content)["input"], "你好，语音合成测试。")
        self.assertEqual(len(self.requests), 1)

    async def test_demo_test_never_claims_real_tts_success(self) -> None:
        with self.transport(self.wav_handler):
            result = await llm.test_llm(self.model, self.provider, {"demo_mode": True})
        self.assertFalse(result["ok"])
        self.assertTrue(result["demo"])
        self.assertFalse(self.requests)

    async def test_admin_pcm_test_reports_raw_audio_playback_boundary(self) -> None:
        async def handler(request):
            return httpx2.Response(200, content=bytes(20), headers={"Content-Type": "audio/pcm"}, request=request)

        model = {**self.model, "extra_params": {"_tts": {"response_format": "pcm"}}}
        with self.transport(handler):
            result = await llm.test_llm(model, self.provider, {"demo_mode": False})
        self.assertTrue(result["ok"])
        self.assertIn("PCM 解码", result["message"])
        self.assertEqual(result["audio"]["mime_type"], "audio/pcm")

    async def test_admin_test_errors_are_explicit_without_audio(self) -> None:
        async def handler(request):
            return httpx2.Response(500, json={"error": {"message": "bad fixture-key fixture-project-key"}}, request=request)

        with self.transport(handler):
            result = await llm.test_llm(self.model, self.provider, {"demo_mode": False})
        self.assertFalse(result["ok"])
        self.assertEqual(result["kind"], "tts")
        self.assertNotIn("audio", result)
        self.assertNotIn("fixture-key", result["message"])
        self.assertNotIn("fixture-project-key", result["message"])


if __name__ == "__main__":
    unittest.main()
