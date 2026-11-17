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
    const globalStt = service.store.config.insertModel({ provider_id: providerId, name: "全局文件 STT", model_id: "whisper-global", model_kind: "asr" });
    const assistantStt = service.store.config.insertModel({ provider_id: providerId, name: "助手文件 STT", model_id: "whisper-assistant", model_kind: "asr" });
    const globalTts = service.store.config.insertModel({ provider_id: providerId, name: "全局 TTS", model_id: "tts-global", model_kind: "tts" });
    const assistantTts = service.store.config.insertModel({ provider_id: providerId, name: "助手 TTS", model_id: "tts-assistant", model_kind: "tts" });
    service.store.setSettings({
      asr_model_id: globalStt.id,
      tts_model_id: globalTts.id,
      voice_auto_send: true,
      tts_auto_read: true,
      tts_max_read_chars: 1200,
      default_reasoning_effort: "low",
      default_approval_mode: "confirm",
      allow_full_access: true,
      welcome_title: "全局标题",
      welcome_subtitle: "全局说明",
      welcome_prompts: "全局问题",
    });

    const assistant = service.store.assistants().find((item) => item.is_default)!;
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
    assert.equal(inherited.json().welcome_title, "全局标题");
    assert.equal(inherited.json().welcome_subtitle, "全局说明");
    assert.equal(inherited.json().welcome_prompts, "全局问题");
    assert.equal(inherited.json().allow_full_access, true);

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
        allow_full_access: false,
        welcome_title: "助手标题",
        welcome_subtitle: "助手说明",
        welcome_prompts: "助手问题一\n助手问题二",
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
    assert.equal(overridden.json().welcome_title, "助手标题");
    assert.equal(overridden.json().welcome_subtitle, "助手说明");
    assert.equal(overridden.json().welcome_prompts, "助手问题一\n助手问题二");
    assert.equal(overridden.json().allow_full_access, false);

    const cleared = await service.app.inject({
      method: "PUT",
      url: `/api/control/admin/assistants/${assistant.id}`,
      headers: { cookie },
      payload: { asr_model_id: null, tts_model_id: null, voice_auto_send: null, tts_auto_read: null, tts_max_read_chars: null, default_reasoning_effort: null, default_approval_mode: null, allow_full_access: null, welcome_title: null, welcome_subtitle: null, welcome_prompts: null },
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
    assert.equal(fallback.json().welcome_title, "全局标题");
    assert.equal(fallback.json().allow_full_access, true);
  } finally {
    await service.close();
    await upstream.close();
  }
});

test("assistant overrides reject a model of the wrong kind", async () => {
  const upstream = await mockServer();
  const service = await fixture(upstream.baseUrl);
  try {
    const assistant = service.store.assistants().find((item) => item.is_default)!;
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

test("voice input auto resolves to file STT first and only falls back to realtime when file is unavailable", async () => {
  const upstream = await mockServer();
  const service = await fixture(upstream.baseUrl);
  try {
    const providerId = service.model!.provider_id;
    const file = service.store.config.insertModel({ provider_id: providerId, name: "文件 STT", model_id: "whisper-file", model_kind: "asr" });
    const realtime = service.store.config.insertModel({ provider_id: providerId, name: "实时 STT", model_id: "asr-realtime", model_kind: "asr_realtime" });
    service.store.setSettings({ voice_input_mode: "auto", asr_model_id: file.id, asr_realtime_model_id: realtime.id });
    const status = () => service.app.inject({ url: "/api/agent/status", headers: { authorization: `Bearer ${service.credential()}` } });

    const both = await status();
    assert.equal(both.statusCode, 200, both.body);
    assert.equal(both.json().voice_input_mode, "file");
    assert.equal(both.json().asr.model_id, file.id);

    service.store.setSettings({ asr_model_id: null });
    const realtimeOnly = await status();
    assert.equal(realtimeOnly.statusCode, 200, realtimeOnly.body);
    assert.equal(realtimeOnly.json().voice_input_mode, "realtime");
    assert.equal(realtimeOnly.json().asr_realtime.model_id, realtime.id);

    service.store.setSettings({ voice_input_mode: "file", asr_model_id: null });
    const explicitFile = await status();
    assert.equal(explicitFile.statusCode, 200, explicitFile.body);
    assert.equal(explicitFile.json().voice_input_mode, "file");
  } finally {
    await service.close();
    await upstream.close();
  }
});

test("deleting a model only checks model-binding assistant columns", async () => {
  const upstream = await mockServer();
  const service = await fixture(upstream.baseUrl);
  try {
    const assistant = service.store.assistants().find((item) => item.is_default)!;
    service.store.config.updateAssistant(Number(assistant.id), { voice_auto_send: true, tts_auto_read: true, default_approval_mode: "full_access" });
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
