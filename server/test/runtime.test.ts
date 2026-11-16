import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, mockServer, sse, toolCall } from "./helpers.js";
import type { Row } from "../src/types.js";

test("PI SDK streams text and thinking, persists a resumable canonical session without thinking by default", async () => {
  const upstream = await mockServer((body, _request, response) => { if (!body.stream) return false; sse(response, [{ reasoning_content: "核对用户问题。" }, { content: "你好，" }, { content: "我是 PI。" }]); return true; });
  const service = await fixture(upstream.baseUrl);
  try {
    const session = await service.session(); const events: Row[] = [];
    const result = await service.runtime.run(service.credential(), { session_id: session.id, message: "你好", reasoning_effort: "low" }, new AbortController().signal, (name, data) => events.push({ name, data }));
    assert.equal(result.status, "ok"); assert.equal(result.answer, "你好，我是 PI。");
    assert.ok(events.some((event) => event.name === "thinking.delta"));
    assert.ok(events.some((event) => event.name === "text.delta"));
    assert.equal(result.usage.total_tokens, 100);
    assert.equal(typeof result.usage.latency_ms, "number");
    assert.equal(service.store.conversations.latestAssistant(session.id)!.metadata.usage.latency_ms, result.usage.latency_ms);
    const saved = service.store.conversations.piEntries(session.id);
    assert.ok(saved.some((entry: Row) => entry.message?.role === "assistant"));
    assert.equal(JSON.stringify(saved).includes("核对用户问题"), false);
    assert.equal(service.store.conversations.latestAssistant(session.id)!.reasoning, "");
    await service.runtime.run(service.credential(), { session_id: session.id, message: "接着说" }, new AbortController().signal, () => {});
    const lastRequest = upstream.requests.filter((request) => request.stream).at(-1)!;
    assert.ok(lastRequest.messages.some((message: Row) => message.role === "assistant" && message.content?.includes("我是 PI")));
    assert.equal(lastRequest.temperature, 0.3);
    const toolNames = lastRequest.tools.map((tool: Row) => tool.function.name);
    assert.ok(toolNames.includes("read"), "PI native Skill read tool should be available");
    for (const forbidden of ["bash", "write", "edit", "delete_device", "create_device", "update_device"]) assert.equal(toolNames.includes(forbidden), false, forbidden);
  } finally { await service.close(); await upstream.close(); }
});
test("PI executes authorized native tools and returns their actual results", async () => {
  const upstream = await mockServer((body, _request, response) => {
    if (!body.stream) return false;
    if (body.messages.at(-1).role === "tool") sse(response, [{ content: "已获取设备统计。" }]);
    else toolCall(response, "get_device_stats", {});
    return true;
  });
  const service = await fixture(upstream.baseUrl);
  try {
    const session = await service.session(); const run = await service.runs.start(service.credential(), { session_id: session.id, message: "统计设备" });
    const result = await run.task;
    assert.equal(result.status, "ok"); assert.equal(result.run.steps, 2); assert.equal(result.run.tool_calls, 1);
    assert.equal(result.tool_runs[0].result.total, 5);
    assert.equal(service.store.one("SELECT status FROM runs WHERE id=?", [run.id])!.status, "completed");
  } finally { await service.close(); await upstream.close(); }
});
test("write tools wait for approval, revalidate permissions, and cannot be replayed", async () => {
  const upstream = await mockServer((body, _request, response) => {
    if (!body.stream) return false;
    const last = body.messages.at(-1);
    if (last.role === "user" && JSON.stringify(last.content).includes("服务器实际执行完成")) sse(response, [{ content: "设备名称已更新。" }]);
    else toolCall(response, "update_device", { device_id: 1, name: "审批更新" });
    return true;
  });
  const service = await fixture(upstream.baseUrl);
  try {
    const session = await service.session("user2"); const credential = service.credential("user2");
    const first = await (await service.runs.start(credential, { session_id: session.id, message: "修改设备1名称", approval_mode: "confirm" })).task;
    assert.equal(first.status, "approval_required");
    assert.notEqual(service.store.one("SELECT name FROM devices WHERE id=1", [], true)!.name, "审批更新");
    const result = await (await service.runs.approval(credential, first.approval.id, true)).task;
    assert.equal(result.status, "ok");
    assert.equal(service.store.one("SELECT name FROM devices WHERE id=1", [], true)!.name, "审批更新");
    await assert.rejects(service.runs.approval(credential, first.approval.id, true), /已处理/);
    const second = await (await service.runs.start(credential, { session_id: session.id, message: "再修改设备" })).task;
    service.store.run("UPDATE users SET permissions=? WHERE username='user2'", [["device:read"]], true);
    const revoked = await (await service.runs.approval(credential, second.approval.id, true)).task;
    assert.equal(revoked.status, "error");
  } finally { await service.close(); await upstream.close(); }
});
test("PI's BM25 deferred discovery and disabled routing are distinct, never simultaneous", async () => {
  const upstream = await mockServer(); const service = await fixture(upstream.baseUrl);
  try {
    service.store.setSettings({ bm25_enabled: true, tool_selection_mode: "bm25" });
    const session = await service.session();
    const result = await (await service.runs.start(service.credential(), { session_id: session.id, message: "你好" })).task;
    assert.equal(result.status, "ok");
    const names = upstream.requests.find((request) => request.stream)!.tools.map((tool: Row) => tool.function.name);
    assert.ok(names.includes("tool_search")); assert.equal(names.includes("get_device_stats"), false);
    service.store.setSettings({ bm25_enabled: false, tool_selection_mode: "none" });
    await (await service.runs.start(service.credential(), { session_id: session.id, message: "再问" })).task;
    assert.ok(upstream.requests.filter((request) => request.stream).at(-1)!.tools.some((tool: Row) => tool.function.name === "get_device_stats"));
  } finally { await service.close(); await upstream.close(); }
});
test("manual context compaction uses the configured summarizer, not a separate handwritten loop", async () => {
  const upstream = await mockServer(); const service = await fixture(upstream.baseUrl);
  try {
    const session = await service.session();
    service.store.setSettings({ compaction_keep_ratio: 0.2 });
    for (let index = 0; index < 4; index++) {
      service.store.conversations.insert(session.id, { role: "user", content: `第${index}轮问题。` + "历史业务数据".repeat(600) });
      service.store.conversations.insert(session.id, { role: "assistant", content: "已查询业务结果。".repeat(600) });
    }
    const user = await service.auth.identity(service.credential());
    const result = await service.runtime.compact(user, service.credential(), session.id);
    assert.equal(result.ok, true); assert.equal(result.summary, "测试辅助模型摘要");
    assert.ok(upstream.requests.some((request) => !request.stream && request.messages?.[0].content.includes("压缩业务会话")));
    assert.ok(service.store.one("SELECT * FROM compaction_events WHERE session_id=?", [session.id]));
  } finally { await service.close(); await upstream.close(); }
});
test("PI treats administrator credentials and headers literally and never expands shell or environment references", async () => {
  const seen: Row[] = [];
  const upstream = await mockServer((body, request, response) => {
    if (!body.stream) return false;
    seen.push({ authorization: request.headers.authorization, literal: request.headers["x-literal"] });
    sse(response, [{ content: "字面值验证完成" }]); return true;
  });
  const service = await fixture(upstream.baseUrl);
  try {
    service.store.update("providers", service.model!.provider_id, { api_key: "!printf never-execute-$HOME", extra_headers: { "X-Literal": "!printf literal-${HOME}-$PATH" } });
    const session = await service.session();
    const result = await (await service.runs.start(service.credential(), { session_id: session.id, message: "!printf this-is-only-user-text" })).task;
    assert.equal(result.status, "ok");
    assert.deepEqual(seen, [{ authorization: "Bearer !printf never-execute-$HOME", literal: "!printf literal-${HOME}-$PATH" }]);
    assert.ok(upstream.requests.find((request) => request.stream)!.messages.some((message: Row) => JSON.stringify(message).includes("!printf this-is-only-user-text")));
  } finally { await service.close(); await upstream.close(); }
});
test("PI honors a one-turn budget and cannot loop indefinitely on repeated tool requests", async () => {
  const upstream = await mockServer((body, _request, response) => { if (!body.stream) return false; toolCall(response, "get_device_stats", {}); return true; });
  const service = await fixture(upstream.baseUrl);
  try {
    service.store.setSettings({ max_iterations: 1 });
    const session = await service.session();
    const result = await (await service.runs.start(service.credential(), { session_id: session.id, message: "统计设备" })).task;
    assert.equal(result.run.steps, 1); assert.equal(result.run.tool_calls, 1);
    assert.equal(result.status, "limited"); assert.match(result.answer, /推理轮次上限/);
    assert.equal(upstream.requests.filter((request) => request.stream).length, 1);
  } finally { await service.close(); await upstream.close(); }
});
test("fallback models update their context budget and saved model selection", async () => {
  const upstream = await mockServer((body, _request, response) => {
    if (!body.stream) return false;
    if (body.model === "test-chat") { response.writeHead(404, { "Content-Type": "application/json" }); response.end(JSON.stringify({ error: { message: "primary model unavailable" } })); }
    else sse(response, [{ content: "备用模型已回答" }]);
    return true;
  });
  const service = await fixture(upstream.baseUrl);
  try {
    const fallback = service.store.insert("models", { provider_id: service.model!.provider_id, name: "Fallback", model_id: "test-fallback", context_window: 8192, max_output_tokens: 1024 });
    service.store.setSettings({ fallback_model_id: fallback.id });
    const session = await service.session();
    const result = await (await service.runs.start(service.credential(), { session_id: session.id, message: "主模型不可用时回答" })).task;
    assert.equal(result.status, "ok"); assert.equal(result.answer, "备用模型已回答");
    assert.equal(result.context.context_window, 8192);
    assert.equal(service.store.one("SELECT last_model_id FROM sessions WHERE id=?", [session.id])!.last_model_id, fallback.id);
  } finally { await service.close(); await upstream.close(); }
});
test("automatic memory extraction does not delay completion of the chat response", async () => {
  let release: (() => void) | undefined; let ready: (() => void) | undefined;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const memoryStarted = new Promise<void>((resolve) => { ready = resolve; });
  const upstream = await mockServer(async (body, _request, response) => {
    if (body.stream) { sse(response, [{ content: "回答已经完成" }]); return true; }
    ready!(); await barrier;
    response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ choices: [{ message: { content: "[]" } }] })); return true;
  });
  const service = await fixture(upstream.baseUrl);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    service.store.setSettings({ memory_auto_extract: true });
    const session = await service.session();
    const run = await service.runs.start(service.credential(), { session_id: session.id, message: "以后请使用中文" });
    const result = await Promise.race([run.task, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("记忆提取阻塞了聊天完成")), 3000); })]);
    assert.equal(result.status, "ok"); assert.equal(result.answer, "回答已经完成");
    await memoryStarted;
    assert.equal(service.store.one("SELECT status FROM runs WHERE id=?", [run.id])!.status, "completed");
  } finally { clearTimeout(timer); release!(); await service.close(); await upstream.close(); }
});
test("context round trimming preserves the PI compaction summary for the next request", async () => {
  const upstream = await mockServer(); const service = await fixture(upstream.baseUrl);
  try {
    const session = await service.session();
    service.store.setSettings({ compaction_keep_ratio: 0.2, context_max_rounds: 1 });
    for (let index = 0; index < 4; index++) {
      service.store.conversations.insert(session.id, { role: "user", content: `第${index}轮。` + "业务历史".repeat(900) });
      service.store.conversations.insert(session.id, { role: "assistant", content: "已核对状态。".repeat(900) });
    }
    await service.runtime.compact(await service.auth.identity(service.credential()), service.credential(), session.id);
    await (await service.runs.start(service.credential(), { session_id: session.id, message: "根据历史继续" })).task;
    const request = upstream.requests.filter((item) => item.stream).at(-1)!;
    assert.ok(JSON.stringify(request.messages).includes("测试辅助模型摘要"));
    assert.ok(JSON.stringify(request.messages).includes("根据历史继续"));
  } finally { await service.close(); await upstream.close(); }
});
test("turning off reasoning persistence during a run applies to the final message and canonical entries", async () => {
  let emitted: (() => void) | undefined; let release: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => { emitted = resolve; });
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const upstream = await mockServer(async (body, _request, response) => {
    if (!body.stream) return false;
    emitted!(); await barrier; sse(response, [{ reasoning_content: "不应落库的中途思考" }, { content: "完成" }]); return true;
  });
  const service = await fixture(upstream.baseUrl);
  try {
    service.store.setSettings({ store_reasoning: true }); const session = await service.session();
    const run = await service.runs.start(service.credential(), { session_id: session.id, message: "检查设置", reasoning_effort: "low" });
    await ready; service.store.setSettings({ store_reasoning: false }); release!(); await run.task;
    assert.equal(service.store.conversations.latestAssistant(session.id)!.reasoning, "");
    assert.equal(JSON.stringify(service.store.conversations.allPiEntries()).includes("不应落库的中途思考"), false);
    assert.equal(JSON.stringify(service.store.all("SELECT * FROM run_events")).includes("不应落库的中途思考"), false);
  } finally { release!(); await service.close(); await upstream.close(); }
});

test("automatic compaction releases the completed answer before the run settles", async () => {
  const upstream = await mockServer((body, _request, response) => {
    if (!body.stream) return false;
    sse(response, [{ content: "回答已经完成，压缩不应阻塞展示。" }], "stop", { prompt_tokens: 900, completion_tokens: 20, total_tokens: 920 });
    return true;
  });
  const service = await fixture(upstream.baseUrl);
  try {
    service.store.update("models", service.model!.id, { context_window: 2500, max_output_tokens: 256 });
    service.store.setSettings({ context_compression: true, context_reserve_tokens: 1600, compaction_keep_ratio: 0.2 });
    const session = await service.session();
    for (let index = 0; index < 3; index++) {
      service.store.conversations.insert(session.id, { role: "user", content: `历史问题 ${index}。` + "历史业务数据".repeat(40) });
      service.store.conversations.insert(session.id, { role: "assistant", content: `历史回答 ${index}。` + "已查询业务结果".repeat(40) });
    }
    const events: string[] = [];
    const run = await service.runs.startWithListener(service.credential(), { session_id: session.id, message: "总结目前设备情况" }, (name) => events.push(name));
    const result = await run.task;
    assert.equal(result.status, "ok");
    assert.match(result.answer, /压缩不应阻塞展示/);
    assert.ok(events.includes("answer.completed"), `events: ${events.join(", ")}`);
    assert.ok(service.store.one("SELECT * FROM compaction_events WHERE session_id=?", [session.id]));
  } finally { await service.close(); await upstream.close(); }
});
