import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, mockServer, sse } from "./helpers.js";
import type { Row, ToolSpec } from "../src/types.js";

function answersFor(body: Row, score = 0.9) {
  return Object.fromEntries(Object.keys(body.questions || {}).map((id) => [id, { answer: { noul: score } }]));
}

test("decision failure falls back to every authorized candidate and records diagnostics plus usage", async () => {
  const upstream = await mockServer((body, request, response) => {
    if (request.url?.endsWith("/systemone")) {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: "decision service unavailable" } }));
      return true;
    }
    if (body.stream) {
      const toolNames = (body.tools || []).map((tool: Row) => tool.function?.name);
      if (toolNames.includes("tool_search")) throw new Error("BM25 must stay off while decision screening is enabled");
      sse(response, [{ content: "已保留全部候选继续处理。" }]);
      return true;
    }
    return false;
  });
  const service = await fixture(upstream.baseUrl);
  try {
    const model = service.store.config.insertModel({
      name: "故障决策",
      model_id: "decision-custom",
      provider_id: service.model!.provider_id,
      model_kind: "decision",
      extra_params: { _decision: { protocol: "decisions", endpoint: `${upstream.baseUrl}/systemone` } },
    });
    service.store.setSettings({ decision_enabled: true, bm25_enabled: false, tool_selection_mode: "decision", decision_model_id: model.id, decision_min_count: 1, decision_timeout_seconds: 2 });
    const user = await service.auth.identity(service.credential());
    const expected = (await service.registry.permitted(user, service.runtime.assistant(user))).map((tool) => tool.name).sort();
    const session = await service.session();
    const run = await service.runs.start(service.credential(), { session_id: session.id, message: "查业务记录" });
    const result = await run.task;
    assert.equal(result.status, "ok");
    assert.deepEqual([...result.enabled_tools].sort(), expected);
    const offered = upstream.requests.find((request) => request.stream)!.tools.map((tool: Row) => tool.function.name);
    assert.ok(offered.includes("business_search"));
    assert.equal(offered.includes("business_update"), false);
    assert.equal(offered.includes("tool_search"), false);

    const diagnostics = service.runs.diagnostics(run.id);
    const failed = diagnostics.events.find((event) => event.name === "decision.diagnostics");
    assert.ok(failed, "failed screening should keep a transient diagnostic event");
    assert.equal(failed.payload.used, false);
    assert.match(String(failed.payload.error), /HTTP 500|决策/);
    const completed = diagnostics.events.find((event) => event.name === "decision.completed");
    assert.ok(completed);
    assert.equal(completed.payload.used, false);
    assert.equal(completed.payload.fallback, true);

    const calls = service.store.all("SELECT * FROM llm_calls WHERE purpose='decision'");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].status, "error");
    assert.match(String(calls[0].error), /决策服务请求失败/);
  } finally { await service.close(); await upstream.close(); }
});

test("decision timeout falls back to authorized candidates within the configured budget", async () => {
  const upstream = await mockServer((body, request, response) => {
    if (request.url?.endsWith("/slow")) return new Promise<boolean>(() => {});
    if (body.stream) { sse(response, [{ content: "决策超时后继续处理。" }]); return true; }
    return false;
  });
  const service = await fixture(upstream.baseUrl);
  try {
    const model = service.store.config.insertModel({
      name: "慢决策",
      model_id: "decision-custom",
      provider_id: service.model!.provider_id,
      model_kind: "decision",
      extra_params: { _decision: { protocol: "decisions", endpoint: `${upstream.baseUrl}/slow` } },
    });
    service.store.setSettings({ decision_enabled: true, bm25_enabled: false, tool_selection_mode: "decision", decision_model_id: model.id, decision_min_count: 1, decision_timeout_seconds: 1 });
    const session = await service.session();
    const started = Date.now();
    const run = await service.runs.start(service.credential(), { session_id: session.id, message: "查业务记录" });
    const result = await run.task;
    assert.equal(result.status, "ok");
    assert.ok(Date.now() - started < 5000, "decision timeout must not block the run");
    const failed = service.runs.diagnostics(run.id).events.find((event) => event.name === "decision.diagnostics");
    assert.ok(failed);
    assert.equal(failed.payload.used, false);
    assert.match(String(failed.payload.error), /超时|取消|timeout/i);
    assert.equal(service.store.all("SELECT * FROM llm_calls WHERE purpose='decision' AND status='error'").length, 1);
  } finally { await service.close(); await upstream.close(); }
});

test("decision scoring splits 33 candidates into 16/16/1 batches and merges the scores", async () => {
  const upstream = await mockServer((body, request, response) => {
    if (!request.url?.endsWith("/systemone")) return false;
    const ids = Object.keys(body.questions || {});
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ answers: answersFor(body), usage: { input_tokens: ids.length, output_tokens: 1 } }));
    return true;
  });
  const service = await fixture(upstream.baseUrl);
  try {
    const model = service.store.config.insertModel({
      name: "批量决策",
      model_id: "decision-custom",
      provider_id: service.model!.provider_id,
      model_kind: "decision",
      extra_params: { _decision: { protocol: "decisions", endpoint: `${upstream.baseUrl}/systemone` } },
    });
    const session = await service.session();
    const candidates = Array.from({ length: 33 }, (_, index) => ({ id: `tool:candidate_${index + 1}`, description: `候选工具 ${index + 1}` }));
    const result = await service.decision.score(model, "选择需要使用的工具", candidates, { sessionId: session.id, username: "user1" });
    assert.equal(result.protocol, "decisions");
    assert.equal(result.batch_size, 16);
    assert.equal(result.batch_count, 3);
    assert.deepEqual(result.request.batches.map((batch: Row) => Object.keys(batch.questions).length), [16, 16, 1]);
    assert.equal(Object.keys(result.scores).length, 33);
    assert.equal(result.scores["tool:candidate_1"], 0.9);
    assert.equal(result.scores["tool:candidate_33"], 0.9);
    const calls = service.store.all("SELECT * FROM llm_calls WHERE purpose='decision'");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].status, "ok");
    assert.equal(calls[0].input_tokens, 33);
    assert.equal(calls[0].output_tokens, 3);
    assert.equal(calls[0].total_tokens, 36);
  } finally { await service.close(); await upstream.close(); }
});

test("decision batch size accepts 1-16 overrides and rejects invalid values", async () => {
  const upstream = await mockServer((body, request, response) => {
    if (!request.url?.endsWith("/systemone")) return false;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ answers: answersFor(body) }));
    return true;
  });
  const service = await fixture(upstream.baseUrl);
  try {
    const insert = (batchSize: unknown) => service.store.config.insertModel({
      name: `批量决策 ${String(batchSize)}`,
      model_id: "decision-custom",
      provider_id: service.model!.provider_id,
      model_kind: "decision",
      extra_params: { _decision: { protocol: "decisions", endpoint: `${upstream.baseUrl}/systemone`, batch_size: batchSize } },
    });
    const candidates = Array.from({ length: 33 }, (_, index) => ({ id: `tool:candidate_${index + 1}`, description: `候选工具 ${index + 1}` }));
    const custom = await service.decision.score(insert(5), "选择工具", candidates);
    assert.equal(custom.batch_size, 5);
    assert.equal(custom.batch_count, 7);
    assert.deepEqual(custom.request.batches.map((batch: Row) => Object.keys(batch.questions).length), [5, 5, 5, 5, 5, 5, 3]);
    assert.equal(Object.keys(custom.scores).length, 33);

    const before = upstream.requests.filter((request) => request.path === "/systemone").length;
    for (const invalid of [0, 17, 1.5, "many"]) {
      await assert.rejects(
        () => service.decision.score(insert(invalid), "选择工具", candidates),
        (error: any) => error?.statusCode === 422 && /1–16/.test(String(error?.message)),
      );
    }
    assert.equal(upstream.requests.filter((request) => request.path === "/systemone").length, before, "invalid batch sizes must fail before calling upstream");
  } finally { await service.close(); await upstream.close(); }
});

test("a failed decision batch aborts scoring, falls back to every candidate, and records accumulated error usage", async () => {
  let batch = 0;
  const upstream = await mockServer((body, request, response) => {
    if (!request.url?.endsWith("/systemone")) return false;
    batch += 1;
    if (batch === 2) {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: "second batch unavailable" } }));
      return true;
    }
    const ids = Object.keys(body.questions || {});
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ answers: answersFor(body), usage: { input_tokens: ids.length, output_tokens: 1 } }));
    return true;
  });
  const service = await fixture(upstream.baseUrl);
  try {
    const model = service.store.config.insertModel({
      name: "分批失败决策",
      model_id: "decision-custom",
      provider_id: service.model!.provider_id,
      model_kind: "decision",
      extra_params: { _decision: { protocol: "decisions", endpoint: `${upstream.baseUrl}/systemone` } },
    });
    service.store.setSettings({ decision_enabled: true, bm25_enabled: false, tool_selection_mode: "decision", decision_model_id: model.id, decision_min_count: 1 });
    const user = await service.auth.identity(service.credential());
    const session = await service.session();
    const tools = Array.from({ length: 33 }, (_, index) => ({
      name: `tool_${index + 1}`,
      title: `工具 ${index + 1}`,
      description: `测试候选工具 ${index + 1}`,
      source: "native",
      category: "测试业务",
      permission: "",
      risk: "read",
      parameters: { type: "object", properties: {} },
      execute: async () => ({}),
    })) as ToolSpec[];
    const emitted: { name: string; payload: Row }[] = [];
    const selected = await service.decision.select(tools, [], "查业务记录", user, session.id, new AbortController().signal, (name, payload) => emitted.push({ name, payload }));
    assert.equal(selected.tools, tools);
    assert.deepEqual(selected.skills, []);
    const completed = emitted.find((event) => event.name === "decision.completed");
    assert.ok(completed);
    assert.equal(completed.payload.used, false);
    assert.equal(completed.payload.fallback, true);
    const diagnostics = emitted.find((event) => event.name === "decision.diagnostics");
    assert.ok(diagnostics);
    assert.match(String(diagnostics.payload.error), /HTTP 500|决策/);
    const calls = service.store.all("SELECT * FROM llm_calls WHERE purpose='decision'");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].status, "error");
    assert.match(String(calls[0].error), /决策服务请求失败/);
    assert.match(String(calls[0].error), /第 2\/3 批/);
    assert.equal(calls[0].input_tokens, 16);
    assert.equal(calls[0].output_tokens, 1);
    assert.equal(calls[0].total_tokens, 17);
  } finally { await service.close(); await upstream.close(); }
});

test("chat_completions decision protocol stays a single request regardless of candidate count", async () => {
  const upstream = await mockServer((body, request, response) => {
    if (!request.url?.endsWith("/chat/completions")) return false;
    const prompt = JSON.parse(String(body.messages?.at(-1)?.content || "{}"));
    const scores = Object.fromEntries((prompt.candidates || []).map((candidate: Row) => [candidate.id, 0.8]));
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ scores }) } }], usage: { prompt_tokens: 40, completion_tokens: 5, total_tokens: 45 } }));
    return true;
  });
  const service = await fixture(upstream.baseUrl);
  try {
    const model = service.store.config.insertModel({
      name: "普通决策协议",
      model_id: "decision-custom",
      provider_id: service.model!.provider_id,
      model_kind: "decision",
      extra_params: { _decision: { protocol: "chat_completions" } },
    });
    const candidates = Array.from({ length: 33 }, (_, index) => ({ id: `tool:candidate_${index + 1}`, description: `候选工具 ${index + 1}` }));
    const result = await service.decision.score(model, "选择工具", candidates);
    assert.equal(result.protocol, "chat_completions");
    assert.equal(result.request.candidates.length, 33);
    assert.equal(result.request.questions, undefined);
    assert.equal(result.batch_count, undefined);
    assert.equal(Object.keys(result.scores).length, 33);
    assert.equal(upstream.requests.filter((request) => request.path === "/v1/chat/completions").length, 1);
    const calls = service.store.all("SELECT * FROM llm_calls WHERE purpose='decision'");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].status, "ok");
    assert.equal(calls[0].input_tokens, 40);
  } finally { await service.close(); await upstream.close(); }
});
