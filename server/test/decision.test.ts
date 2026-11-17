import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, mockServer, sse } from "./helpers.js";
import type { Row } from "../src/types.js";

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
