import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { fixture, mockServer, sse } from "./helpers.js";
import { speakableText } from "../src/speech-text.js";
import type { Row } from "../src/types.js";

/**
 * 模拟 Qwen-TTS-Realtime 的真实行为：
 * - server_commit 模式下 append 只进服务端缓冲区；
 * - 只有 commit 才会立即合成缓存文本并返回 response.done；
 * - session.finish 到达时立即关闭连接，未 commit 的文本和在途音频都会丢失。
 */
function realtimeTtsServer() {
  const http = createServer();
  const sockets = new WebSocketServer({ server: http });
  const state = { spoken: "", audio: "", commits: 0, dropped: 0, events: [] as string[] };
  let buffer = "";
  let inFlight: NodeJS.Timeout | undefined;
  sockets.on("connection", (socket) => {
    const send = (message: Row) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); };
    socket.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      state.events.push(String(event.type));
      if (event.type === "session.update") send({ type: "session.updated" });
      if (event.type === "input_text_buffer.append") { buffer += String(event.text || ""); state.spoken += String(event.text || ""); }
      if (event.type === "input_text_buffer.commit") {
        state.commits += 1;
        if (!buffer) { send({ type: "error", error: { code: "invalid_value", message: "input text buffer is empty" } }); return; }
        const text = buffer; buffer = "";
        send({ type: "input_text_buffer.committed" });
        send({ type: "response.created", response: { status: "in_progress" } });
        inFlight = setTimeout(() => {
          inFlight = undefined;
          state.audio += text;
          send({ type: "response.audio.delta", delta: Buffer.from(text).toString("base64") });
          send({ type: "response.done", response: { status: "completed" } });
        }, 30);
      }
      if (event.type === "session.finish") {
        state.dropped += buffer.length; buffer = "";
        if (inFlight) { clearTimeout(inFlight); inFlight = undefined; }
        send({ type: "session.finished" });
      }
    });
  });
  return {
    state,
    listen: async () => { http.listen(0, "127.0.0.1"); await once(http, "listening"); return `http://127.0.0.1:${(http.address() as { port: number }).port}`; },
    close: async () => {
      for (const socket of sockets.clients) socket.terminate();
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

test("realtime TTS commits and drains buffered text before ending the session", async () => {
  const upstream = realtimeTtsServer();
  const baseUrl = await upstream.listen();
  const service = await fixture(baseUrl);
  try {
    const model = service.store.config.insertModel({ name: "Realtime TTS", provider_id: service.model!.provider_id, model_id: "qwen3-tts-flash-realtime", model_kind: "tts_realtime" });
    const controller = new AbortController();
    const chunks: Buffer[] = [];
    const session = await service.speech.openTtsRealtime(model, (bytes) => chunks.push(bytes), controller.signal);
    const text = "第一句先说明结论。第二句补充设备状态。第三句给出处理建议，最后这一段没有句号结尾也不能丢";
    session.append(text);
    await session.finish();
    session.close();

    assert.equal(upstream.state.dropped, 0, "session.finish 前必须 commit 完缓存文本");
    assert.equal(upstream.state.commits, 1);
    assert.equal(Buffer.concat(chunks).toString(), text);
    assert.equal(upstream.state.audio, text);
    assert.deepEqual(upstream.state.events.slice(-2), ["input_text_buffer.commit", "session.finish"]);
  } finally { await service.close(); await upstream.close(); }
});

test("voice call speaks every round of a tool-calling answer without losing the tail", async () => {
  const finalAnswer = [
    "我已经完成两轮查询，下面是汇总结果。",
    "当前共有五台设备，其中两台存在告警：A 设备温度偏高，建议先降低负载并观察十分钟；B 设备已经离线超过三十分钟，请检查网络和电源。",
    "其它三台设备运行正常，最近一次心跳都在一分钟以内。",
    "```json",
    "{\"device\":\"A\",\"temperature\":91}",
    "```",
    "处理建议如下：第一，立即安排巡检 A 设备并记录温度变化；第二，联系现场确认 B 设备的网络连接；第三，今天下班前把处理结果同步到运维群。",
    "如果你希望我继续跟进，我可以把上面的建议整理成一张待办清单并生成页面",
  ].join("\n");
  let round = 0;
  const upstream = await mockServer((body, _request, response) => {
    if (!body.stream) return false;
    round += 1;
    if (round === 1) { sse(response, [{ content: "我先查询设备情况。" }, { tool_calls: [{ index: 0, id: "call-1", type: "function", function: { name: "business_search", arguments: JSON.stringify({ keyword: "设备" }) } }] }], "tool_calls"); return true; }
    if (round === 2) { sse(response, [{ content: "我再核对一下告警记录。" }, { tool_calls: [{ index: 0, id: "call-2", type: "function", function: { name: "business_search", arguments: JSON.stringify({ keyword: "告警" }) } }] }], "tool_calls"); return true; }
    sse(response, Array.from({ length: Math.ceil(finalAnswer.length / 12) }, (_, index) => ({ content: finalAnswer.slice(index * 12, index * 12 + 12) })));
    return true;
  });
  const tts = realtimeTtsServer();
  const ttsBase = await tts.listen();
  const service = await fixture(upstream.baseUrl);
  // TTS 走独立的实时服务，其余请求仍由聊天 mock 处理。
  const ttsModel = service.store.config.insertModel({ name: "实时 TTS", provider_id: service.model!.provider_id, model_id: "qwen3-tts-flash-realtime", model_kind: "tts_realtime", extra_params: { _tts: { endpoint: `${ttsBase.replace(/^http/, "ws")}/api-ws/v1/realtime` } } });
  const sockets = new WebSocketServer({ server: upstream.server });
  sockets.on("connection", (socket, request) => {
    const url = new URL(request.url || "", "http://localhost");
    if (!url.pathname.includes("realtime")) return;
    if (!url.searchParams.get("model")?.includes("asr")) return;
    socket.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      if (event.type === "session.update") socket.send(JSON.stringify({ type: "session.updated" }));
      if (event.type === "session.finish") {
        socket.send(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", transcript: "设备运行情况怎么样" }));
        socket.send(JSON.stringify({ type: "session.finished" }));
      }
    });
  });
  try {
    const asr = service.store.config.insertModel({ name: "实时 STT", provider_id: service.model!.provider_id, model_id: "qwen3-asr-flash-realtime", model_kind: "asr_realtime" });
    service.store.setSettings({ voice_asr_model_id: asr.id, voice_tts_model_id: ttsModel.id });
    const session = await service.session();
    await service.app.listen({ host: "127.0.0.1", port: 0 });
    const address = service.app.server.address() as { port: number };
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/api/agent/voice/stream?session_id=${session.id}`, { headers: { Authorization: `Bearer ${service.credential("user1")}` } });
    const messages: Row[] = [];
    ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    await new Promise<void>((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
    try {
      await waitFor(messages, (message) => message.type === "connected");
      ws.send(JSON.stringify({ type: "start" }));
      await waitFor(messages, (message) => message.type === "ready");
      ws.send(JSON.stringify({ type: "audio", audio: Buffer.alloc(640, 0).toString("base64") }));
      ws.send(JSON.stringify({ type: "commit" }));

      const final = await waitFor(messages, (message) => message.type === "asr.final", 20000);
      assert.equal(final.text, "设备运行情况怎么样");
      const done = await waitFor(messages, (message) => message.type === "agent.done", 20000);
      assert.equal(done.status, "ok");
      await waitFor(messages, (message) => message.type === "tts.audio", 20000);
      await waitFor(messages, (message) => message.type === "tts.done", 20000);

      const expected = speakableText([`我先查询设备情况。`, `我再核对一下告警记录。`, finalAnswer].join("\n")).replace(/\s+/g, "");
      assert.equal(tts.state.dropped, 0, "结束会话时不应残留未合成文本");
      assert.equal(tts.state.audio, tts.state.spoken, "所有送入 TTS 的文本都必须完成合成");
      assert.equal(tts.state.spoken.replace(/\s+/g, ""), expected);
      assert.match(tts.state.spoken, /生成页面$/);
      assert.equal(tts.state.commits, 1);
      const doneIndex = messages.findIndex((message) => message.type === "tts.done");
      const audioIndex = messages.findIndex((message) => message.type === "tts.audio");
      assert.ok(audioIndex >= 0 && audioIndex < doneIndex, "tts.done 必须在音频之后");
    } finally { ws.terminate(); }
  } finally {
    await service.close();
    for (const socket of sockets.clients) socket.terminate();
    await new Promise<void>((resolve) => sockets.close(() => resolve()));
    await upstream.close();
    await tts.close();
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
