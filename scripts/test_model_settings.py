"""Model categories, multi-provider configuration and speech API contracts."""

from __future__ import annotations

import base64
from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx2

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from webagent.agent import app as agent_app
from webagent.agent import db, llm, providers, runtime, speech
from webagent.agent.provider_presets import list_provider_presets
from webagent.config import INTERNAL_SECRET


ADMIN = {"id": 191, "username": "config-review", "is_admin": True, "permissions": []}
USER = {**ADMIN, "id": 192, "username": "ordinary", "is_admin": False}
HEADERS = {"Authorization": "Bearer fixture", "X-Internal-Token": INTERNAL_SECRET}


class ModelSettingsTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory(prefix="webagent-model-settings-")
        self.database = patch.object(db, "AGENT_DB_PATH", Path(self.directory.name) / "agent.db")
        self.database.start()
        db.init_db()
        self.provider = db.create_provider(name="fixture", provider_type="openai_compatible", base_url="https://api.example/v1", api_key="fixture-secret")
        self.chat = db.create_model(provider_id=self.provider["id"], name="chat", model_id="chat", is_default=True)
        self.tts = db.create_model(provider_id=self.provider["id"], name="speech", model_id="gpt-4o-mini-tts", model_kind="tts", supports_tools=False)
        self.asr = db.create_model(provider_id=self.provider["id"], name="recognition", model_id="whisper-1", model_kind="asr", supports_tools=False, supports_transcription=True)

    def tearDown(self) -> None:
        self.database.stop()
        self.directory.cleanup()

    async def request(self, method: str, path: str, body=None, *, user=None, headers=None):
        with patch.object(runtime, "identity_from_token", AsyncMock(return_value=user or ADMIN)):
            async with httpx2.AsyncClient(transport=httpx2.ASGITransport(app=agent_app.app), base_url="http://test") as client:
                return await client.request(method, path, json=body, headers=HEADERS if headers is None else headers)

    async def test_presets_are_admin_only_and_do_not_create_rows(self) -> None:
        count = len(db.get_providers())
        response = await self.request("GET", "/api/admin/providers/presets")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["items"]), 12)
        self.assertEqual(len(db.get_providers()), count)
        response = await self.request("GET", "/api/admin/providers/presets", user=USER)
        self.assertEqual(response.status_code, 403)

    def test_presets_cover_all_four_categories_without_native_protocol_claims(self) -> None:
        presets = list_provider_presets()
        self.assertEqual({category for preset in presets for category in preset["categories"]}, {"chat", "voice", "image", "decision"})
        self.assertNotIn("anthropic", {preset["id"] for preset in presets})
        self.assertIn("custom", {preset["id"] for preset in presets})

    def test_tts_names_are_detected_and_do_not_gain_chat_capabilities(self) -> None:
        for model_id in ("gpt-4o-mini-tts", "qwen3-tts-flash", "qwen-audio-3.1-tts-flash", "tts-1-hd"):
            defaults = providers.suggest_model_defaults(model_id)
            self.assertEqual(defaults["model_kind"], "tts")
            self.assertFalse(defaults["supports_tools"])
            self.assertFalse(defaults["supports_transcription"])

    def test_only_loopback_connections_can_omit_key(self) -> None:
        for address in ("http://localhost:1234/v1", "http://127.0.0.1:11434/v1", "http://[::1]:1234/v1"):
            provider = {"base_url": address, "enabled": True, "api_key": ""}
            self.assertFalse(providers.provider_requires_key(provider))
            self.assertTrue(llm.provider_ready(provider)[0])
        for address in ("https://api.example/v1", "http://192.168.1.2/v1", "http://host.docker.internal:1234/v1"):
            self.assertTrue(providers.provider_requires_key({"base_url": address}))

    async def test_create_multiple_same_brand_connections_keeps_keys_private(self) -> None:
        for name, key in (("OpenAI account A", "alpha-secret"), ("OpenAI account B", "beta-secret")):
            response = await self.request("POST", "/api/admin/providers", {"name": name, "base_url": "https://api.openai.com/v1", "api_key": key})
            self.assertEqual(response.status_code, 201)
            self.assertNotIn(key, response.text)
            self.assertTrue(response.json()["provider"]["api_key_set"])
        connections = [provider for provider in db.get_providers() if provider["name"].startswith("OpenAI account")]
        self.assertEqual(len(connections), 2)

    async def test_tts_create_validates_format_but_can_be_configured_without_key(self) -> None:
        provider = db.create_provider(name="not configured", provider_type="openai_compatible", base_url="https://api.example/v1", api_key="")
        body = {"provider_id": provider["id"], "name": "TTS", "model_id": "tts-1", "model_kind": "tts", "extra_params": {"_tts": {"protocol": "openai", "voice": "alloy"}}}
        response = await self.request("POST", "/api/admin/models", body)
        self.assertEqual(response.status_code, 201)
        self.assertFalse(response.json()["model"]["is_default"])
        self.assertFalse(response.json()["model"]["supports_tools"])
        body["extra_params"]["_tts"]["endpoint"] = "https://other.example/speech"
        response = await self.request("POST", "/api/admin/models", body)
        self.assertEqual(response.status_code, 422)

    async def test_default_stt_tts_bindings_are_independent_and_can_clear(self) -> None:
        response = await self.request("PUT", "/api/config", {"asr_model_id": self.asr["id"], "tts_model_id": self.tts["id"]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["tts_model_id"], self.tts["id"])
        response = await self.request("PUT", "/api/config", {"tts_model_id": 0})
        self.assertIsNone(response.json()["tts_model_id"])
        self.assertEqual(response.json()["asr_model_id"], self.asr["id"])
        before = db.get_settings()
        response = await self.request("PUT", "/api/config", {"tts_model_id": self.chat["id"], "max_iterations": 2})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(db.get_settings(), before)

    async def test_stt_rejects_invalid_language_before_saving(self) -> None:
        response = await self.request("PUT", f"/api/admin/models/{self.asr['id']}", {"extra_params": {"_asr": {"language": {"unexpected": "object"}}}})
        self.assertEqual(response.status_code, 422)
        self.assertNotIn("_asr", db.get_model(self.asr["id"])["extra_params"])

    async def test_non_chat_cannot_be_bound_to_summary_title_or_fallback(self) -> None:
        for key in ("compaction_model_id", "title_model_id", "fallback_model_id"):
            response = await self.request("PUT", "/api/config", {key: self.tts["id"]})
            self.assertEqual(response.status_code, 422)

    def test_deleting_bound_model_clears_only_its_bindings(self) -> None:
        db.set_settings({"tts_model_id": str(self.tts["id"]), "asr_model_id": str(self.asr["id"]), "title_model_id": str(self.chat["id"])})
        db.delete_model(self.tts["id"])
        config = llm.runtime_config()
        self.assertIsNone(config["tts_model_id"])
        self.assertEqual(config["asr_model_id"], self.asr["id"])
        self.assertEqual(config["title_model_id"], self.chat["id"])
        db.set_settings({"tool_selection_mode": "decision", "decision_model_id": str(self.chat["id"])})
        db.delete_model(self.chat["id"])
        self.assertEqual(llm.runtime_config()["tool_selection_mode"], "none")
        self.assertFalse(llm.runtime_config()["bm25_enabled"])

    async def test_admin_model_test_is_real_even_when_business_is_demo(self) -> None:
        db.set_settings({"demo_mode": "1"})
        test = AsyncMock(return_value={"ok": True, "kind": "tts", "audio": {"data_url": "data:audio/mpeg;base64,fixture", "mime_type": "audio/mpeg"}})
        with patch.object(agent_app, "test_llm", test):
            response = await self.request("POST", f"/api/admin/models/{self.tts['id']}/test")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(test.call_args.args[2]["demo_mode"])

    async def test_chat_test_requires_reply_and_masks_upstream_credentials(self) -> None:
        with patch.object(llm, "chat_completion", AsyncMock(return_value={"content": "", "usage": {"total_tokens": 5}})):
            result = await llm.test_llm(self.chat, db.get_provider(self.provider["id"]), {"demo_mode": False})
        self.assertFalse(result["ok"])
        self.assertEqual(result["usage"]["total_tokens"], 5)
        with patch.object(llm, "chat_completion", AsyncMock(side_effect=ValueError("upstream echoed fixture-secret"))):
            result = await llm.test_llm(self.chat, db.get_provider(self.provider["id"]), {"demo_mode": False})
        self.assertFalse(result["ok"])
        self.assertNotIn("fixture-secret", result["message"])

    async def test_tts_sync_keeps_kind_and_protocol_even_with_unknown_alias(self) -> None:
        db.update_model(self.tts["id"], {"model_id": "custom-voice-alias", "extra_params": {"_tts": {"voice": "coral", "response_format": "wav"}}})
        with patch.object(agent_app, "list_remote_models", AsyncMock(return_value=[])), patch.object(agent_app, "enrich_model_defaults", AsyncMock(return_value={"model_kind": "chat", "supports_tools": True, "supports_reasoning": True, "extra_params": {}})):
            response = await self.request("POST", f"/api/admin/models/{self.tts['id']}/sync")
        self.assertEqual(response.json()["model"]["model_kind"], "tts")
        self.assertEqual(response.json()["model"]["extra_params"]["_tts"]["voice"], "coral")
        self.assertFalse(response.json()["model"]["supports_tools"])

    async def test_user_speech_uses_default_only_and_returns_no_store_audio(self) -> None:
        db.set_settings({"tts_model_id": str(self.tts["id"])})
        generate = AsyncMock(return_value={"audio": b"fixture-audio", "mime_type": "audio/mpeg", "latency_ms": 9, "protocol": "openai"})
        with patch.object(speech, "synthesize_speech", generate):
            response = await self.request("POST", "/api/audio/speech", {"text": "你好"}, user=USER)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.content, b"fixture-audio")
            self.assertEqual(response.headers["cache-control"], "no-store")
            response = await self.request("POST", "/api/audio/speech", {"text": "你好", "model_row_id": self.tts["id"]}, user=USER)
            self.assertEqual(response.status_code, 403)
            self.assertEqual(generate.await_count, 1)

    async def test_business_proxy_keeps_audio_privacy_headers(self) -> None:
        from webagent.business import app as business_app

        upstream_client = AsyncMock()
        upstream_client.__aenter__.return_value = upstream_client
        upstream_client.request.return_value = httpx2.Response(200, content=b"fixture-audio", headers={"Content-Type": "audio/wav", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
        request = business_app.Request({"type": "http", "method": "POST", "path": "/api/agent/audio/speech", "query_string": b"", "headers": [(b"content-type", b"application/json")]})
        with patch.object(business_app, "require_user", return_value=USER), patch.object(business_app, "request_token", return_value="fixture"), patch.object(business_app.httpx2, "AsyncClient", return_value=upstream_client), patch.object(business_app.Request, "body", AsyncMock(return_value=b'{"text":"test"}')):
            response = await business_app.proxy_agent("audio/speech", request)
        self.assertEqual(response.body, b"fixture-audio")
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.headers["x-content-type-options"], "nosniff")

    async def test_unconfigured_or_disabled_tts_never_calls_service(self) -> None:
        with patch.object(speech, "synthesize_speech", AsyncMock()) as generate:
            response = await self.request("POST", "/api/audio/speech", {"text": "你好"}, user=USER)
            self.assertEqual(response.status_code, 422)
            generate.assert_not_awaited()
        db.set_settings({"tts_model_id": str(self.tts["id"])})
        db.update_model(self.tts["id"], {"enabled": False})
        response = await self.request("GET", "/api/status", user=USER)
        self.assertFalse(response.json()["tts"]["configured"])
        self.assertIn("停用", response.json()["tts"]["reason"])

    async def test_admin_can_test_stt_recording_without_changing_default(self) -> None:
        audio_data = "data:audio/wav;base64," + base64.b64encode(b"test recording bytes").decode()
        recognize = AsyncMock(return_value={"text": "设备运行正常", "protocol": "transcriptions"})
        with patch.object(agent_app, "transcribe_audio", recognize):
            response = await self.request("POST", f"/api/admin/models/{self.asr['id']}/transcribe", {"audio_data_url": audio_data, "language": "zh"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["text"], "设备运行正常")
        self.assertIsNone(llm.runtime_config()["asr_model_id"])
        response = await self.request("POST", f"/api/admin/models/{self.asr['id']}/transcribe", {"audio_data_url": audio_data}, user=USER)
        self.assertEqual(response.status_code, 403)

    async def test_image_test_respects_supported_options_and_returns_preview(self) -> None:
        image = SimpleNamespace(data=[SimpleNamespace(url=None, b64_json="fixture")])
        client = AsyncMock()
        client.images.generate = AsyncMock(return_value=image)
        client.__aenter__.return_value = client
        model = {**self.chat, "model_kind": "image_generation", "extra_params": {"size": "512x512", "quality": "standard", "n": 50, "_secret": "not forwarded"}}
        with patch.object(llm, "_client", return_value=client):
            result = await llm.test_llm(model, self.provider, {**llm.runtime_config(), "demo_mode": False})
        parameters = client.images.generate.call_args.kwargs
        self.assertEqual(parameters["size"], "512x512")
        self.assertEqual(parameters["n"], 1)
        self.assertNotIn("_secret", parameters)
        self.assertTrue(result["image"]["data_url"].startswith("data:image/png;base64,"))


if __name__ == "__main__":
    unittest.main()
