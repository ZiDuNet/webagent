import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { encodePcmWav } from "../../sdk/src/audio.js";
import { fixture, mockServer } from "./helpers.js";
import { config } from "../src/config.js";
import type { Row } from "../src/types.js";

async function managementCookie(service: Awaited<ReturnType<typeof fixture>>) {
  const result = await service.app.inject({ method: "POST", url: "/api/control/auth/login", payload: { username: "admin", password: config.adminPassword } });
  assert.equal(result.statusCode, 200);
  return result.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

test("voice input mode reports the resolved channel, the raw preference and per-channel capabilities", async () => {
  const upstream = await mockServer();
  const service = await fixture(upstream.baseUrl);
  try {
    const providerId = service.model!.provider_id;
    const file = service.store.config.insertModel({ provider_id: providerId, name: "文件 STT", model_id: "whisper-file", model_kind: "asr" });
    const realtime = service.store.config.insertModel({ provider_id: providerId, name: "实时 STT", model_id: "asr-realtime", model_kind: "asr_realtime" });
    service.store.setSettings({ asr_model_id: file.id, asr_realtime_model_id: realtime.id });
    const status = async () => (await service.app.inject({ url: "/api/agent/status", headers: { authorization: `Bearer ${service.credential()}` } })).json();

    service.store.setSettings({ voice_input_mode: "auto" });
    const legacy = await status();
    assert.equal(legacy.voice_input_mode, "file");
    assert.equal(legacy.voice_input_prefer, "auto_file");
    assert.deepEqual(legacy.voice_input_capabilities, { file: true, realtime: true });

    service.store.setSettings({ voice_input_mode: "auto_realtime" });
    const preferRealtime = await status();
    assert.equal(preferRealtime.voice_input_mode, "realtime");
    assert.equal(preferRealtime.voice_input_prefer, "auto_realtime");

    service.store.setSettings({ voice_input_mode: "auto_file" });
    assert.equal((await status()).voice_input_mode, "file");

    // 自动优先文件：文件模型不可用时才回退实时。
    service.store.setSettings({ asr_model_id: null });
    const autoFallback = await status();
    assert.equal(autoFallback.voice_input_mode, "realtime");
    assert.deepEqual(autoFallback.voice_input_capabilities, { file: false, realtime: true });

    // 显式 file 不回退：即使实时可用，实际策略仍是 file，只是 capability 标记不可用。
    service.store.setSettings({ voice_input_mode: "file", asr_model_id: null });
    const explicitFile = await status();
    assert.equal(explicitFile.voice_input_mode, "file");
    assert.equal(explicitFile.voice_input_prefer, "file");
    assert.deepEqual(explicitFile.voice_input_capabilities, { file: false, realtime: true });
  } finally { await service.close(); await upstream.close(); }
});

test("admin validation accepts auto aliases and normalizes them to auto_file", async () => {
  const service = await fixture();
  try {
    const cookie = await managementCookie(service);
    const update = (voice_input_mode: string) => service.app.inject({ method: "PUT", url: "/api/control/config", headers: { cookie }, payload: { voice_input_mode } });

    const legacy = await update("auto");
    assert.equal(legacy.statusCode, 200, legacy.body);
    assert.equal(service.store.settings().voice_input_mode, "auto_file");
    assert.equal(legacy.json().voice_input_mode, "auto_file");

    assert.equal((await update("auto_realtime")).statusCode, 200);
    assert.equal(service.store.settings().voice_input_mode, "auto_realtime");
    assert.equal((await update("realtime")).statusCode, 200);
    assert.equal((await update("file")).statusCode, 200);
    assert.equal((await update("bogus")).statusCode, 422);

    const assistant = service.store.assistants()[0];
    const saved = await service.app.inject({ method: "PUT", url: `/api/control/admin/assistants/${assistant.id}`, headers: { cookie }, payload: { name: assistant.name, voice_input_mode: "auto" } });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().assistant.voice_input_mode, "auto_file");
  } finally { await service.close(); }
});

test("call voice bindings accept file models so realtime and non-realtime are both supported", async () => {
  const upstream = await mockServer();
  const service = await fixture(upstream.baseUrl);
  try {
    const providerId = service.model!.provider_id;
    const asrFile = service.store.config.insertModel({ provider_id: providerId, name: "文件 STT", model_id: "whisper-file", model_kind: "asr" });
    const ttsFile = service.store.config.insertModel({ provider_id: providerId, name: "文件 TTS", model_id: "tts-1", model_kind: "tts" });
    const cookie = await managementCookie(service);
    const saved = await service.app.inject({ method: "PUT", url: "/api/control/config", headers: { cookie }, payload: { voice_asr_model_id: asrFile.id, voice_tts_model_id: ttsFile.id } });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().voice_asr_model_id, asrFile.id);
    assert.equal(saved.json().voice_tts_model_id, ttsFile.id);
    const assistant = service.store.assistants()[0];
    const bound = await service.app.inject({ method: "PUT", url: `/api/control/admin/assistants/${assistant.id}`, headers: { cookie }, payload: { name: assistant.name, voice_asr_model_id: asrFile.id, voice_tts_model_id: ttsFile.id } });
    assert.equal(bound.statusCode, 200, bound.body);
  } finally { await service.close(); await upstream.close(); }
});

test("/transcribe follows auto preferences while explicit modes stay on their own channel", async () => {
  const upstream = await mockServer();
  const service = await fixture(upstream.baseUrl);
  try {
    const providerId = service.model!.provider_id;
    const file = service.store.config.insertModel({ provider_id: providerId, name: "文件 STT", model_id: "whisper-file", model_kind: "asr" });
    // 用文件协议承载实时模型，便于在不建 WebSocket 的情况下验证候选顺序。
    const realtime = service.store.config.insertModel({ provider_id: providerId, name: "实时 STT", model_id: "asr-realtime", model_kind: "asr_realtime", extra_params: { _asr: { protocol: "transcriptions" } } });
    service.store.setSettings({ asr_model_id: file.id, asr_realtime_model_id: realtime.id });
    const wav = Buffer.from(encodePcmWav(new Float32Array(160)));
    const transcribe = async () => (await service.app.inject({
      method: "POST",
      url: "/api/agent/transcribe",
      headers: { authorization: `Bearer ${service.credential()}` },
      payload: { audio_data_url: `data:audio/wav;base64,${wav.toString("base64")}` },
    })).json();

    service.store.setSettings({ voice_input_mode: "auto" });
    assert.equal((await transcribe()).model_id, file.id);
    service.store.setSettings({ voice_input_mode: "auto_file" });
    assert.equal((await transcribe()).model_id, file.id);
    service.store.setSettings({ voice_input_mode: "auto_realtime" });
    assert.equal((await transcribe()).model_id, realtime.id);
    service.store.setSettings({ voice_input_mode: "realtime" });
    assert.equal((await transcribe()).model_id, realtime.id);
    service.store.setSettings({ voice_input_mode: "file" });
    assert.equal((await transcribe()).model_id, file.id);
  } finally { await service.close(); await upstream.close(); }
});

test("realtime dictation works without a session so the empty Chat state can use the microphone", async () => {
  const http = createServer();
  const sockets = new WebSocketServer({ server: http });
  const transcripts: Row[] = [];
  sockets.on("connection", (socket, request) => {
    const model = new URL(request.url || "", "http://localhost").searchParams.get("model") || "";
    transcripts.push({ model });
    socket.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      if (event.type === "session.update") socket.send(JSON.stringify({ type: "session.updated" }));
      if (event.type === "session.finish") {
        socket.send(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", transcript: "空态也能听写" }));
        socket.send(JSON.stringify({ type: "session.finished" }));
      }
    });
  });
  http.listen(0, "127.0.0.1"); await once(http, "listening");
  const baseUrl = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  const service = await fixture(baseUrl);
  try {
    const asr = service.store.config.insertModel({ name: "实时 STT", provider_id: service.model!.provider_id, model_id: "qwen3-asr-flash-realtime", model_kind: "asr_realtime" });
    service.store.setSettings({ asr_realtime_model_id: asr.id });
    await service.app.listen({ host: "127.0.0.1", port: 0 });
    const address = service.app.server.address() as { port: number };
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/api/agent/voice/dictate`, { headers: { Authorization: `Bearer ${service.credential()}` } });
    const messages: Row[] = [];
    ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    await new Promise<void>((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
    try {
      await waitFor(messages, (message) => message.type === "connected");
      ws.send(JSON.stringify({ type: "start" }));
      await waitFor(messages, (message) => message.type === "ready");
      ws.send(JSON.stringify({ type: "audio", audio: Buffer.alloc(640, 0).toString("base64") }));
      ws.send(JSON.stringify({ type: "commit" }));
      const final = await waitFor(messages, (message) => message.type === "asr.final");
      assert.equal(final.text, "空态也能听写");
      assert.equal(transcripts.length, 1);
    } finally { ws.terminate(); }
  } finally {
    await service.close();
    for (const socket of sockets.clients) socket.terminate();
    await new Promise<void>((resolve) => sockets.close(() => resolve()));
    await new Promise<void>((resolve) => http.close(() => resolve()));
  }
});

async function waitFor(messages: Row[], predicate: (message: Row) => boolean, timeout = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const found = messages.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`等待语音事件超时；已收到：${messages.map((message) => message.type).join(", ")}`);
}
