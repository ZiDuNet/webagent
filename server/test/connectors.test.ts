import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { fixture, mockServer, sse, toolCall } from "./helpers.js";
import { asrConfig, ttsConfig } from "../src/speech.js";
import { encrypt } from "../src/security.js";
import type { Row } from "../src/types.js";

test("STT and TTS select their actual protocols and reject cross-origin endpoints", async () => {
  const upstream = await mockServer((body, request, response) => {
    if (request.url === "/v1/audio/transcriptions") { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ text: "今天的设备报告" })); return true; }
    if (request.url === "/v1/audio/speech") { assert.equal(body.input, "你好"); response.writeHead(200, { "Content-Type": "audio/mpeg" }); response.end(Buffer.from("ID3-test-audio")); return true; }
    if (request.url === "/api/v1/services/aigc/multimodal-generation/generation") { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ output: { audio: { data: Buffer.from("RIFF-test-wav").toString("base64") } } })); return true; }
    return false;
  });
  const service = await fixture(upstream.baseUrl);
  try {
    const stt = service.store.insert("models", { name: "STT", provider_id: service.model!.provider_id, model_id: "whisper-1", model_kind: "asr" });
    const tts = service.store.insert("models", { name: "TTS", provider_id: service.model!.provider_id, model_id: "tts-1", model_kind: "tts" });
    const transcript = await service.speech.transcribe(stt, `data:audio/wav;base64,${Buffer.from("RIFF-file").toString("base64")}`);
    assert.equal(transcript.text, "今天的设备报告"); assert.equal(transcript.protocol, "transcriptions");
    const audio = await service.speech.synthesize(tts, "你好"); assert.equal(audio.mime_type, "audio/mpeg"); assert.equal(audio.bytes.toString(), "ID3-test-audio");
    const qwen = service.store.insert("models", { name: "Qwen TTS", provider_id: service.model!.provider_id, model_id: "qwen3-tts-flash", model_kind: "tts" });
    assert.equal((await service.speech.synthesize(qwen, "你好")).bytes.toString(), "RIFF-test-wav");
    assert.equal(asrConfig({ model_id: "qwen3-asr-flash", model_kind: "asr" }, { base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1" }).protocol, "chat_audio");
    assert.equal(asrConfig({ model_id: "qwen3-asr-flash-realtime", model_kind: "asr_realtime" }, { base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1" }).endpoint, "wss://dashscope.aliyuncs.com/api-ws/v1/realtime");
    assert.equal(ttsConfig({ model_id: "qwen3-tts-flash", model_kind: "tts" }, { base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1" }).protocol, "dashscope");
    assert.throws(() => ttsConfig({ model_kind: "tts", model_id: "tts-1", extra_params: { _tts: { endpoint: "https://attacker.invalid/speech" } } }, { base_url: upstream.baseUrl }), /同源/);
    await assert.rejects(service.speech.transcribe(stt, "data:text/plain;base64,aGVsbG8="), /audio/);
  } finally { await service.close(); await upstream.close(); }
});
test("MCP uses the official HTTP transport, encrypted credentials, and explicit tool authorization", async () => {
  const seen: string[] = [];
  const http = createServer(async (request, response) => {
    seen.push(String(request.headers.authorization || ""));
    const mcp = new McpServer({ name: "fixture", version: "1.0.0" });
    mcp.registerTool("lookup", { description: "查询业务数据", inputSchema: { id: z.number() } }, async ({ id }) => ({ content: [{ type: "text", text: JSON.stringify({ id, name: "from-mcp" }) }] }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    response.on("close", () => { void transport.close(); void mcp.close(); });
    await mcp.connect(transport); await transport.handleRequest(request, response);
  });
  http.listen(0, "127.0.0.1"); await once(http, "listening");
  const service = await fixture();
  try {
    const server = service.store.insert("mcp_servers", { name: "MCP fixture", config: { url: `http://127.0.0.1:${(http.address() as { port: number }).port}/mcp`, secret: encrypt(JSON.stringify({ headers: { Authorization: "Bearer mcp-test-key" } })) } });
    const tools = await service.registry.discoverServer(server); assert.equal(tools[0].name, "lookup");
    service.store.update("mcp_servers", server.id, { config: { ...server.config, cached_tools: tools } });
    assert.equal((await service.registry.all()).some((tool) => tool.source === "mcp"), false);
    service.store.update("mcp_servers", server.id, { config: { ...server.config, cached_tools: tools, tool_policies: { lookup: { permission: "device:read", risk: "read" } } } });
    const user = await service.auth.identity(service.credential());
    const allowed = await service.registry.permitted(user, service.runtime.assistant(user)); const tool = allowed.find((item) => item.source === "mcp")!;
    assert.ok(tool);
    const result = await service.registry.execute(tool, { id: 19 }, { identity: user, credential: service.credential(), sessionId: "test-session", signal: AbortSignal.timeout(5000) }) as Row[];
    assert.equal(JSON.parse(result[0].text).id, 19); assert.ok(seen.every((value) => value === "Bearer mcp-test-key"));
  } finally { await service.close(); http.closeAllConnections(); await new Promise<void>((resolve) => http.close(() => resolve())); }
});
test("PagePilot keeps local ownership and versions; publication passwords never enter PI or event storage", async () => {
  let remoteVersion = 0;
  const upstream = await mockServer((body, request, response) => {
    if (request.url === "/api/deploy") { remoteVersion++; response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ code: body.customCode || "page-test", url: "/p/page-test", versionNumber: remoteVersion })); return true; }
    if (request.url?.startsWith("/api/deploys/")) { response.setHeader("Content-Type", "application/json"); response.end("{\"success\":true}"); return true; }
    if (body.stream) { toolCall(response, "pagepilot_publish_html", { html: "<!doctype html><html><body>report</body></html>", title: "报告", visibility: "unlisted", access_password: "private-publication-password" }); return true; }
    return false;
  });
  const service = await fixture(upstream.baseUrl);
  try {
    const user = await service.auth.identity(service.credential());
    service.store.setSettings({ pagepilot_enabled: true, pagepilot_base_url: upstream.baseUrl, pagepilot_token: encrypt("private-global-token") });
    const body = { html: "<!doctype html><html><body>report</body></html>", title: "今日报告", visibility: "unlisted", access_password: "" };
    const created = await service.publications.publish(user, body); assert.equal(created.status, "published"); assert.equal(created.password_set, false);
    const updated = await service.publications.publish(user, { ...body, publication_id: created.publication_id, html: body.html.replace("report", "updated") }); assert.equal(updated.version, 2);
    assert.equal(service.publications.detail(created.publication_id, user).versions.length, 2);
    assert.throws(() => service.publications.owned(created.publication_id, { ...user, subject: "user-other", owner_key: "user-other" }), /不存在/);
    await assert.rejects(service.publications.publish({ ...user, subject: "user-other", owner_key: "user-other" }, { ...body, code: created.code }), /归属/);
    const session = await service.session(); const result = await (await service.runs.start(service.credential(), { message: "发布运维报告", session_id: session.id })).task;
    assert.equal(result.status, "approval_required");
    assert.equal(JSON.stringify(service.store.conversations.allPiEntries()).includes("private-publication-password"), false, "pi_state");
    assert.equal(JSON.stringify(service.store.conversations.allMessages()).includes("private-publication-password"), false, "messages");
    for (const table of ["run_events", "approvals_v2", "audit_log", "publications", "publication_versions"]) {
      assert.equal(JSON.stringify(service.store.all(`SELECT * FROM ${table}`)).includes("private-publication-password"), false, table);
    }
    const sealed = service.store.one("SELECT * FROM approvals_v2 WHERE id=?", [result.approval.id])!; assert.ok(sealed.data.sealed.startsWith("enc:v2:"));
    assert.equal(upstream.requests.filter((request) => request.path === "/api/deploy").length, 2);
  } finally { await service.close(); await upstream.close(); }
});
test("SSE disconnection does not cancel the backend; reconnect and explicit cancel are separate", async () => {
  let release: (() => void) | undefined;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const upstream = await mockServer(async (body, _request, response) => { if (!body.stream) return false; await barrier; sse(response, [{ content: "断线后仍完成" }]); return true; });
  const service = await fixture(upstream.baseUrl);
  try {
    await service.app.listen({ host: "127.0.0.1", port: 0 }); const address = service.app.server.address() as { port: number }; const base = `http://127.0.0.1:${address.port}`;
    const session = await service.session(); const headers = { Authorization: `Bearer ${service.credential()}`, "Content-Type": "application/json" };
    const controller = new AbortController(); const response = await fetch(`${base}/api/agent/chat/stream`, { method: "POST", headers, body: JSON.stringify({ session_id: session.id, message: "继续运行" }), signal: controller.signal });
    const runId = response.headers.get("X-Run-Id")!; assert.ok(runId); controller.abort();
    assert.equal(service.store.one("SELECT status FROM runs WHERE id=?", [runId])!.status, "running");
    release!();
    const resumed = await fetch(`${base}/api/agent/chat/stream/${runId}`, { headers }); const text = await resumed.text();
    assert.match(text, /event: text.delta/); assert.match(text, /断线后仍完成/); assert.match(text, /event: run.completed/);
    const user2 = await service.auth.identity(service.credential("user2")); assert.throws(() => service.runs.owned(runId, user2), /不属于/);
    const completed = await fetch(`${base}/api/agent/chat/stream/${runId}`, { headers }); assert.match(await completed.text(), /event: run.completed/);
  } finally { release!(); await service.close(); await upstream.close(); }
});
test("explicit cancellation stops the actual PI model request instead of only detaching the browser", async () => {
  let ready: (() => void) | undefined;
  const started = new Promise<void>((resolve) => { ready = resolve; });
  const upstream = await mockServer((body, _request, response) => {
    if (!body.stream) return false;
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(`data: ${JSON.stringify({ id: "cancel-test", choices: [{ index: 0, delta: { role: "assistant", content: "正在处理" }, finish_reason: null }] })}\n\n`);
    ready!(); return true;
  });
  const service = await fixture(upstream.baseUrl);
  try {
    const session = await service.session(); const credential = service.credential();
    const run = await service.runs.start(credential, { session_id: session.id, message: "等待取消" });
    await started;
    service.runs.cancel(run.id, await service.auth.identity(credential));
    const result = await run.task;
    assert.equal(result.status, "cancelled");
    assert.equal(service.store.one("SELECT status FROM runs WHERE id=?", [run.id])!.status, "cancelled");
    assert.equal(service.store.one("SELECT last_status FROM sessions WHERE id=?", [session.id])!.last_status, "cancelled");
  } finally { await service.close(); await upstream.close(); }
});
