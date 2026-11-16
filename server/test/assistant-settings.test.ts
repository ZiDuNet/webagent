import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, mockServer } from "./helpers.js";
import { config } from "../src/config.js";
import type { Row } from "../src/types.js";

async function managementCookie(service: Awaited<ReturnType<typeof fixture>>) {
  const result = await service.app.inject({
    method: "POST",
    url: "/api/control/auth/login",
    payload: { username: "admin", password: config.adminPassword },
  });
  assert.equal(result.statusCode, 200);
  return result.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

test("assistant voice and runtime overrides take precedence over global fallbacks", async () => {
  const upstream = await mockServer();
  const service = await fixture(upstream.baseUrl);
  try {
    const providerId = service.model!.provider_id;
    const globalStt = service.store.insert("models", { provider_id: providerId, name: "全局文件 STT", model_id: "whisper-global", model_kind: "asr" });
    const assistantStt = service.store.insert("models", { provider_id: providerId, name: "助手文件 STT", model_id: "whisper-assistant", model_kind: "asr" });
    const globalTts = service.store.insert("models", { provider_id: providerId, name: "全局 TTS", model_id: "tts-global", model_kind: "tts" });
    const assistantTts = service.store.insert("models", { provider_id: providerId, name: "助手 TTS", model_id: "tts-assistant", model_kind: "tts" });
    service.store.setSettings({
      asr_model_id: globalStt.id,
      tts_model_id: globalTts.id,
      voice_auto_send: true,
      tts_auto_read: true,
      tts_max_read_chars: 1200,
      default_reasoning_effort: "low",
      default_approval_mode: "confirm",
    });

    const assistant = service.store.one("SELECT * FROM assistants WHERE is_default=1")!;
    const inherited = await service.app.inject({
      url: `/api/agent/status?assistant_id=${assistant.id}`,
      headers: { authorization: `Bearer ${service.credential()}` },
    });
    assert.equal(inherited.statusCode, 200, inherited.body);
    assert.equal(inherited.json().asr.model_id, globalStt.id);
    assert.equal(inherited.json().tts.model_id, globalTts.id);
    assert.equal(inherited.json().voice_auto_send, true);
    assert.equal(inherited.json().tts_auto_read, true);
    assert.equal(inherited.json().default_reasoning_effort, "low");

    const cookie = await managementCookie(service);
    const updated = await service.app.inject({
      method: "PUT",
      url: `/api/control/admin/assistants/${assistant.id}`,
      headers: { cookie },
      payload: {
        asr_model_id: assistantStt.id,
        tts_model_id: assistantTts.id,
        voice_auto_send: false,
        tts_auto_read: false,
        tts_max_read_chars: 600,
        default_reasoning_effort: "high",
        default_approval_mode: "full_access",
      },
    });
    assert.equal(updated.statusCode, 200, updated.body);

    const overridden = await service.app.inject({
      url: `/api/agent/status?assistant_id=${assistant.id}`,
      headers: { authorization: `Bearer ${service.credential()}` },
    });
    assert.equal(overridden.statusCode, 200, overridden.body);
    assert.equal(overridden.json().asr.model_id, assistantStt.id);
    assert.equal(overridden.json().tts.model_id, assistantTts.id);
    assert.equal(overridden.json().voice_auto_send, false);
    assert.equal(overridden.json().tts_auto_read, false);
    assert.equal(overridden.json().tts_max_read_chars, 600);
    assert.equal(overridden.json().default_reasoning_effort, "high");
    assert.equal(overridden.json().default_approval_mode, "full_access");

    const cleared = await service.app.inject({
      method: "PUT",
      url: `/api/control/admin/assistants/${assistant.id}`,
      headers: { cookie },
      payload: { asr_model_id: null, tts_model_id: null, voice_auto_send: null, tts_auto_read: null, tts_max_read_chars: null, default_reasoning_effort: null, default_approval_mode: null },
    });
    assert.equal(cleared.statusCode, 200, cleared.body);
    const fallback = await service.app.inject({
      url: `/api/agent/status?assistant_id=${assistant.id}`,
      headers: { authorization: `Bearer ${service.credential()}` },
    });
    assert.equal(fallback.statusCode, 200, fallback.body);
    assert.equal(fallback.json().asr.model_id, globalStt.id);
    assert.equal(fallback.json().tts.model_id, globalTts.id);
    assert.equal(fallback.json().voice_auto_send, true);
    assert.equal(fallback.json().tts_auto_read, true);
    assert.equal(fallback.json().default_reasoning_effort, "low");
  } finally {
    await service.close();
    await upstream.close();
  }
});

test("assistant overrides reject a model of the wrong kind", async () => {
  const upstream = await mockServer();
  const service = await fixture(upstream.baseUrl);
  try {
    const assistant = service.store.one("SELECT * FROM assistants WHERE is_default=1")!;
    const cookie = await managementCookie(service);
    const response = await service.app.inject({
      method: "PUT",
      url: `/api/control/admin/assistants/${assistant.id}`,
      headers: { cookie },
      payload: { tts_model_id: service.model!.id } satisfies Row,
    });
    assert.equal(response.statusCode, 422, response.body);
    assert.match(response.body, /tts_model_id/);
  } finally {
    await service.close();
    await upstream.close();
  }
});

test("deleting a model only checks model-binding assistant columns", async () => {
  const upstream = await mockServer();
  const service = await fixture(upstream.baseUrl);
  try {
    const assistant = service.store.one("SELECT * FROM assistants WHERE is_default=1")!;
    service.store.run("UPDATE assistants SET voice_auto_send=1, tts_auto_read=1, default_approval_mode='full_access' WHERE id=?", [assistant.id]);
    const cookie = await managementCookie(service);
    const response = await service.app.inject({
      method: "DELETE",
      url: `/api/control/admin/models/${service.model!.id}`,
      headers: { cookie },
    });
    assert.equal(response.statusCode, 200, response.body);
  } finally {
    await service.close();
    await upstream.close();
  }
});
