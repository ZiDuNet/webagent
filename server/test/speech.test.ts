import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import { encodePcmWav } from "../../sdk/src/audio.js";
import { pcmFromWav } from "../src/speech.js";
import { drainSpeechText, isLikelyEcho, speakableText } from "../src/speech-text.js";
import { fixture, mockServer } from "./helpers.js";

test("speech text drains complete sentences and caps long unpunctuated fragments", () => {
  const first = drainSpeechText("第一句。第二", 20);
  assert.deepEqual(first.chunks, ["第一句。"]);
  assert.equal(first.rest, "第二");

  const long = "这是一段没有任何句号的长文本".repeat(12);
  const drained = drainSpeechText(long, 24);
  assert.ok(drained.chunks.length > 4);
  assert.ok(drained.chunks.every((chunk) => chunk.length <= 24));
  assert.ok(drained.rest.length < 24);
  assert.equal(drained.chunks.join("") + drained.rest, long);

  const soft = drainSpeechText("前半段内容，后半段内容，第三段内容继续", 16);
  assert.ok(soft.chunks.every((chunk) => chunk.length <= 16));
  assert.ok(soft.chunks[0].endsWith("，"));
});

test("speech text excludes markdown tables, code, HTML and URLs", () => {
  const readable = speakableText("# 标题\n| 设备 | 状态 |\n|---|---|\n| 交换机 | 在线 |\n```js\nconst secret = 1;\n```\n<html><body>不应朗读</body></html>\n正文 [链接](https://example.com) 结束");
  assert.match(readable, /标题/);
  assert.match(readable, /正文/);
  assert.match(readable, /链接/);
  assert.doesNotMatch(readable, /设备|交换机|secret|不应朗读|example\.com/);
});

test("echo guard ignores TTS loopback without dropping unrelated user speech", () => {
  const spoken = "当前系统共有五台设备，分别是交换机、路由器和防火墙。";
  assert.equal(isLikelyEcho("当前系统共有五台设备", spoken), true);
  assert.equal(isLikelyEcho("交换机、路由器和防火墙", spoken), true);
  assert.equal(isLikelyEcho("当前系统共有五台设备分别是交换机和路由器", spoken), true);
  assert.equal(isLikelyEcho("帮我查一下设备列表", spoken), false);
  assert.equal(isLikelyEcho("好的", spoken), false);
});

test("server validates client WAV and rejects malformed or non-PCM content without transcoding", () => {
  const wav = Buffer.from(encodePcmWav(new Float32Array([0, 0.5, -1])));
  assert.equal(pcmFromWav(wav).length, 6);
  assert.equal(pcmFromWav(wav).readInt16LE(2), 16384);
  assert.throws(() => pcmFromWav(Buffer.from("not-a-wav")), /客户端转换/);
  for (const [offset, value] of [[20, 3], [22, 2], [24, 48000], [28, 1], [32, 4], [34, 8], [40, 2000]]) {
    const invalid = Buffer.from(wav); invalid.writeUInt16LE(value, offset);
    assert.throws(() => pcmFromWav(invalid), /客户端转换/);
  }
  assert.throws(() => pcmFromWav(wav.subarray(0, wav.length - 1)), /客户端转换/);
});

test("Chat Audio ASR forwards validated client WAV and refuses compressed input rather than spawning a decoder", async () => {
  const upstream = await mockServer((body, request, response) => {
    if (request.url !== "/v1/chat/completions") return false;
    const audio = body.messages[0].content[0].input_audio;
    assert.ok(String(audio.data).startsWith("data:audio/wav;base64,"));
    response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ choices: [{ message: { content: "客户端转码成功" } }] })); return true;
  });
  const service = await fixture(upstream.baseUrl);
  try {
    const model = service.store.insert("models", { name: "Qwen ASR", provider_id: service.model!.provider_id, model_id: "qwen3-asr-flash", model_kind: "asr" });
    const wav = Buffer.from(encodePcmWav(new Float32Array(160)));
    assert.equal((await service.speech.transcribe(model, `data:audio/wav;base64,${wav.toString("base64")}`)).text, "客户端转码成功");
    await assert.rejects(service.speech.transcribe(model, "data:audio/webm;base64,aGVsbG8="), /客户端转换/);
    assert.equal(upstream.requests.length, 1);
  } finally { await service.close(); await upstream.close(); }
});

test("realtime ASR sends client PCM over WebSocket without local ffmpeg", async () => {
  const http = createServer();
  const sockets = new WebSocketServer({ server: http });
  const wav = Buffer.from(encodePcmWav(new Float32Array(1600).fill(0.25)));
  const chunks: Buffer[] = [];
  sockets.on("connection", (socket) => socket.on("message", (raw) => {
    const event = JSON.parse(raw.toString());
    if (event.type === "session.update") socket.send(JSON.stringify({ type: "session.updated" }));
    if (event.type === "input_audio_buffer.append") chunks.push(Buffer.from(event.audio, "base64"));
    if (event.type === "session.finish") {
      socket.send(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", transcript: "实时协议成功" }));
      socket.send(JSON.stringify({ type: "session.finished" }));
    }
  }));
  http.listen(0, "127.0.0.1"); await once(http, "listening");
  const service = await fixture(`http://127.0.0.1:${(http.address() as { port: number }).port}`);
  try {
    const model = service.store.insert("models", { name: "Realtime ASR", provider_id: service.model!.provider_id, model_id: "qwen3-asr-flash-realtime", model_kind: "asr_realtime" });
    const result = await service.speech.transcribe(model, `data:audio/wav;base64,${wav.toString("base64")}`);
    assert.equal(result.text, "实时协议成功"); assert.equal(result.protocol, "realtime");
    assert.deepEqual(Buffer.concat(chunks), pcmFromWav(wav));
  } finally { await service.close(); for (const socket of sockets.clients) socket.terminate(); await new Promise<void>((resolve) => sockets.close(() => resolve())); await new Promise<void>((resolve) => http.close(() => resolve())); }
});

test("realtime TTS cancellation before finish stays a handled rejection", async () => {
  const http = createServer();
  const sockets = new WebSocketServer({ server: http });
  sockets.on("connection", (socket) => socket.on("message", (raw) => {
    const event = JSON.parse(raw.toString());
    if (event.type === "session.update") socket.send(JSON.stringify({ type: "session.updated" }));
  }));
  http.listen(0, "127.0.0.1"); await once(http, "listening");
  const service = await fixture(`http://127.0.0.1:${(http.address() as { port: number }).port}`);
  try {
    const model = service.store.insert("models", { name: "Realtime TTS", provider_id: service.model!.provider_id, model_id: "qwen3-tts-flash-realtime", model_kind: "tts_realtime" });
    const controller = new AbortController();
    const session = await service.speech.openTtsRealtime(model, () => {}, controller.signal);
    session.append("第一句。");
    controller.abort();
    // Barge-in aborts before finish() is awaited. This tick used to crash the process.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await assert.rejects(session.finish(), /已取消/);
    session.close();
  } finally { await service.close(); for (const socket of sockets.clients) socket.terminate(); await new Promise<void>((resolve) => sockets.close(() => resolve())); await new Promise<void>((resolve) => http.close(() => resolve())); }
});
