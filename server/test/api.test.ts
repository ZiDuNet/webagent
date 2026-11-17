import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fixture, mockServer, sse, toolCall } from "./helpers.js";
import { config } from "../src/config.js";
import { encrypt, decrypt } from "../src/security.js";
import { parseScores, decisionConnection } from "../src/decision.js";
import { piPackages } from "../src/core-maintenance.js";
import type { Row } from "../src/types.js";

async function managementCookie(service: Awaited<ReturnType<typeof fixture>>) {
  const result = await service.app.inject({ method: "POST", url: "/api/control/auth/login", payload: { username: "admin", password: config.adminPassword } });
  assert.equal(result.statusCode, 200);
  return result.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}
test("management identity is separate from business auth; CRUD and sessions honor business permissions", async () => {
  const service = await fixture();
  try {
    const controlCookie = await managementCookie(service);
    assert.equal((await service.app.inject({ url: "/api/me", headers: { cookie: controlCookie } })).statusCode, 401);
    assert.equal((await service.app.inject({ url: "/api/control/config", headers: { authorization: `Bearer ${service.credential("admin")}` } })).statusCode, 401);
    assert.equal((await service.app.inject({ url: "/api/control/config", headers: { cookie: controlCookie } })).statusCode, 200);
    const core = await service.app.inject({ url: "/api/control/admin/runtime-core", headers: { cookie: controlCookie } });
    assert.equal(core.statusCode, 200);
    assert.deepEqual(core.json().packages.map((item: Row) => item.name), piPackages);
    assert.ok(core.json().packages.every((item: Row) => item.installed === item.pinned));
    assert.equal((await service.app.inject({ url: "/api/me", headers: { authorization: `Bearer ${service.credential()}` } })).statusCode, 200);
    assert.equal((await service.app.inject({ url: "/api/me", headers: { authorization: "Bearer unknown-token" } })).statusCode, 401);
    const session = await service.session();
    assert.equal((await service.app.inject({ url: `/api/agent/sessions/${session.id}/messages`, headers: { authorization: `Bearer ${service.credential("user3")}` } })).statusCode, 404);
    const noModel = await service.app.inject({ method: "POST", url: "/api/agent/chat", headers: { authorization: `Bearer ${service.credential()}` }, payload: { session_id: session.id, message: "你好" } });
    assert.equal(noModel.json().status, "error"); assert.match(noModel.json().message, /不会伪造回复/);
    assert.equal(service.store.conversations.allMessages().filter((message) => message.role === "assistant").length, 0);
  } finally { await service.close(); }
});

test("access tokens exchange into browser sessions, bind to one assistant, and enforce origin and lifecycle controls", async () => {
  const service = await fixture();
  try {
    const cookie = await managementCookie(service);
    const assistant = service.store.assistants().find((item) => item.is_default)!;
    const created = await service.app.inject({
      method: "POST",
      url: "/api/control/admin/access-tokens",
      headers: { cookie },
      payload: { name: "独立 Chat", assistant_id: assistant.id, allowed_origins: ["https://allowed.example"], rate_limit_per_minute: 0 },
    });
    assert.equal(created.statusCode, 201, created.body);
    const token = created.json().token as string;
    assert.match(token, /^wa_/);
    assert.equal(created.body.includes("token_hash"), false);
    assert.equal(created.json().access_token.assistant_id, assistant.id);
    const listed = await service.app.inject({ url: "/api/control/admin/access-tokens", headers: { cookie } });
    const listedToken = listed.json().items.find((item: Row) => item.id === created.json().access_token.id);
    assert.equal(listedToken.token, token);
    assert.equal(listedToken.token_available, true);
    assert.equal(listed.body.includes("token_hash"), false);
    assert.equal(listed.body.includes("token_cipher"), false);

    const me = await service.app.inject({ url: "/api/agent/me", headers: { authorization: `Bearer ${token}` } });
    assert.equal(me.statusCode, 200, me.body);
    assert.equal(me.json().access.mode, "token");
    assert.equal(me.json().access.fixed_assistant_id, assistant.id);
    assert.equal(me.json().user.auth_mode, "token");
    assert.equal((await service.app.inject({ url: "/api/control/config", headers: { authorization: `Bearer ${token}` } })).statusCode, 401);

    const browserOne = me.json().user.owner_key;
    const browserTwoResponse = await service.app.inject({ url: "/api/agent/me", headers: { authorization: `Bearer ${token}`, cookie: "wa_visitor=browser-two" } });
    assert.notEqual(browserTwoResponse.json().user.owner_key, browserOne);
    const browserTwoAgain = await service.app.inject({ url: "/api/agent/me", headers: { authorization: `Bearer ${token}`, cookie: "wa_visitor=browser-two" } });
    assert.equal(browserTwoAgain.json().user.owner_key, browserTwoResponse.json().user.owner_key);

    const exchanged = await service.app.inject({ method: "POST", url: "/api/agent/auth/exchange", headers: { authorization: `Bearer ${token}` } });
    assert.equal(exchanged.statusCode, 200, exchanged.body);
    const accessCookie = exchanged.cookies.find((item) => item.name === "wa_access_session")!;
    const visitorCookie = exchanged.cookies.find((item) => item.name === "wa_visitor")!;
    assert.ok(accessCookie?.value && visitorCookie?.value);
    const browserHeaders = { cookie: `wa_access_session=${accessCookie.value}; wa_visitor=${visitorCookie.value}` };
    assert.equal((await service.app.inject({ url: "/api/agent/sessions", headers: browserHeaders })).statusCode, 200);

    const secondAssistant = service.store.config.insertAssistant({ name: "另一个助手", enabled: true, allowed_roles: ["*"] });
    const switched = await service.app.inject({ method: "POST", url: "/api/agent/sessions", headers: browserHeaders, payload: { assistant_id: secondAssistant.id } });
    assert.equal(switched.statusCode, 403);
    assert.match(switched.body, /绑定助手/);

    const blockedOrigin = await service.app.inject({ url: "/api/agent/me", headers: { authorization: `Bearer ${token}`, origin: "https://blocked.example" } });
    assert.equal(blockedOrigin.statusCode, 403);
    const allowedOrigin = await service.app.inject({ url: "/api/agent/me", headers: { authorization: `Bearer ${token}`, origin: "https://allowed.example" } });
    assert.equal(allowedOrigin.statusCode, 200);

    const disabled = await service.app.inject({ method: "PUT", url: `/api/control/admin/access-tokens/${created.json().access_token.id}`, headers: { cookie }, payload: { enabled: false } });
    assert.equal(disabled.statusCode, 200, disabled.body);
    assert.equal((await service.app.inject({ url: "/api/agent/me", headers: { authorization: `Bearer ${token}` } })).statusCode, 401);
  } finally { await service.close(); }
});
test("control tokens authenticate the admin API with independent origin and lifecycle controls", async () => {
  const service = await fixture();
  try {
    const cookie = await managementCookie(service);
    const created = await service.app.inject({
      method: "POST",
      url: "/api/control/admin/control-tokens",
      headers: { cookie },
      payload: { name: "业务系统管理端", allowed_origins: ["https://admin.example"] },
    });
    assert.equal(created.statusCode, 201, created.body);
    const token = created.json().token as string;
    assert.match(token, /^wac_/);
    assert.equal(created.body.includes("token_hash"), false);

    const me = await service.app.inject({ url: "/api/control/auth/me", headers: { authorization: `Bearer ${token}` } });
    assert.equal(me.statusCode, 200, me.body);
    assert.equal(me.json().user.via_token, true);
    assert.equal((await service.app.inject({ url: "/api/agent/me", headers: { authorization: `Bearer ${token}` } })).statusCode, 401);
    assert.equal((await service.app.inject({ url: "/api/control/config", headers: { authorization: `Bearer ${token}`, origin: "https://blocked.example" } })).statusCode, 403);

    const allowed = await service.app.inject({ url: "/api/control/config", headers: { authorization: `Bearer ${token}`, origin: "https://admin.example" } });
    assert.equal(allowed.statusCode, 200, allowed.body);
    assert.equal(allowed.headers["access-control-allow-origin"], "https://admin.example");

    const preflight = await service.app.inject({
      method: "OPTIONS",
      url: "/api/control/config",
      headers: { origin: "https://admin.example", "access-control-request-method": "GET", "access-control-request-headers": "authorization" },
    });
    assert.equal(preflight.statusCode, 204);
    assert.equal(preflight.headers["access-control-allow-origin"], "https://admin.example");

    const password = await service.app.inject({
      method: "PUT",
      url: "/api/control/auth/password",
      headers: { authorization: `Bearer ${token}` },
      payload: { current_password: "irrelevant", password: "a-new-admin-password" },
    });
    assert.equal(password.statusCode, 403);

    const rotated = await service.app.inject({
      method: "POST",
      url: `/api/control/admin/control-tokens/${created.json().control_token.id}/rotate`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(rotated.statusCode, 201, rotated.body);
    const nextToken = rotated.json().token as string;
    assert.equal((await service.app.inject({ url: "/api/control/config", headers: { authorization: `Bearer ${token}` } })).statusCode, 401);
    assert.equal((await service.app.inject({ url: "/api/control/config", headers: { authorization: `Bearer ${nextToken}` } })).statusCode, 200);

    await service.app.inject({
      method: "PUT",
      url: `/api/control/admin/control-tokens/${created.json().control_token.id}`,
      headers: { cookie },
      payload: { enabled: false },
    });
    assert.equal((await service.app.inject({ url: "/api/control/config", headers: { authorization: `Bearer ${nextToken}` } })).statusCode, 401);
  } finally { await service.close(); }
});
test("BM25 and decision can both be disabled, model bindings and unsafe extra parameters are validated", async () => {
  const upstream = await mockServer(); const service = await fixture(upstream.baseUrl);
  try {
    const cookie = await managementCookie(service); const update = (payload: Row) => service.app.inject({ method: "PUT", url: "/api/control/config", headers: { cookie }, payload });
    assert.equal((await update({ bm25_enabled: false, decision_enabled: false, max_iterations: 0, max_tool_calls: 0 })).statusCode, 200);
    assert.equal(service.store.settings().max_iterations, 0);
    assert.equal((await update({ bm25_enabled: true, decision_enabled: true })).statusCode, 422);
    assert.equal((await update({ asr_model_id: service.model!.id })).statusCode, 422);
    const forbidden = await service.app.inject({ method: "PUT", url: `/api/control/admin/models/${service.model!.id}`, headers: { cookie }, payload: { extra_params: { extra_body: { tools: [] } } } });
    assert.equal(forbidden.statusCode, 422);
    const first = await service.app.inject({ url: `/api/control/admin/providers/${service.model!.provider_id}/discover-models?kind=tts`, headers: { cookie } });
    const second = await service.app.inject({ url: `/api/control/admin/providers/${service.model!.provider_id}/discover-models?kind=asr`, headers: { cookie } });
    assert.deepEqual(first.json().items.map((model: Row) => model.model_id), ["tts-1"]);
    assert.deepEqual(second.json().items.map((model: Row) => model.model_id), ["whisper-1"]);
    assert.equal(upstream.requests.filter((request) => request.path === "/v1/models").length, 2, "provider model lists must be fetched live, not cached");
    assert.equal((await service.app.inject({ method: "POST", url: "/api/control/admin/runtime-core/upgrade-plan", headers: { cookie }, payload: { version: "https://bad.invalid/runtime" } })).statusCode, 422);
  } finally { await service.close(); await upstream.close(); }
});
test("system prompt defaults are visible in the control plane, can be overridden, and blank prompts are rejected", async () => {
  const service = await fixture();
  try {
    const cookie = await managementCookie(service);
    const config = await service.app.inject({ url: "/api/control/config", headers: { cookie } });
    assert.equal(config.statusCode, 200);
    assert.equal(typeof config.json().prompt_defaults.base_system_prompt, "string");
    const blank = await service.app.inject({ method: "PUT", url: "/api/control/config", headers: { cookie }, payload: { base_system_prompt: "   " } });
    assert.equal(blank.statusCode, 422);
    assert.match(blank.json().detail, /不能为空/);
    const accepted = await service.app.inject({ method: "PUT", url: "/api/control/config", headers: { cookie }, payload: { compaction_prompt: "保留目标、事实和未决事项。" } });
    assert.equal(accepted.statusCode, 200);
    assert.equal(accepted.json().compaction_prompt, "保留目标、事实和未决事项。");
    assert.equal(service.store.settings().compaction_prompt, "保留目标、事实和未决事项。");
  } finally { await service.close(); }
});
test("embedding and rerank models have real protocol tests instead of placeholder success", async () => {
  const upstream = await mockServer((_body, request, response) => {
    if (request.url === "/v1/embeddings") { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ data: [{ embedding: [0.1, -0.2, 0.3] }], usage: { prompt_tokens: 4 } })); return true; }
    if (request.url === "/v1/rerank") { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ results: [{ index: 0, relevance_score: 0.91 }] })); return true; }
    return false;
  });
  const service = await fixture(upstream.baseUrl);
  try {
    const cookie = await managementCookie(service);
    const embedding = service.store.config.insertModel({ provider_id: service.model!.provider_id, name: "向量模型", model_id: "text-embedding-test", model_kind: "embedding" });
    const rerank = service.store.config.insertModel({ provider_id: service.model!.provider_id, name: "重排模型", model_id: "rerank-test", model_kind: "rerank" });
    const embeddingResult = await service.app.inject({ method: "POST", url: `/api/control/admin/models/${embedding.id}/test`, headers: { cookie }, payload: {} });
    assert.equal(embeddingResult.statusCode, 200); assert.equal(embeddingResult.json().ok, true); assert.equal(embeddingResult.json().dimensions, 3);
    const rerankResult = await service.app.inject({ method: "POST", url: `/api/control/admin/models/${rerank.id}/test`, headers: { cookie }, payload: {} });
    assert.equal(rerankResult.statusCode, 200); assert.equal(rerankResult.json().ok, true); assert.equal(rerankResult.json().results[0].index, 0);
    assert.equal(upstream.requests.some((request) => request.path === "/v1/embeddings"), true);
    assert.equal(upstream.requests.some((request) => request.path === "/v1/rerank"), true);
  } finally { await service.close(); await upstream.close(); }
});
test("admin session browsing is paginated on the server and SQLite vacuum is explicit", async () => {
  const service = await fixture();
  try {
    const cookie = await managementCookie(service);
    const user = await service.auth.identity(service.credential());
    for (const title of ["巡检一", "巡检二", "告警复盘"]) service.runtime.createSession(user, { title });
    const page = await service.app.inject({ url: "/api/control/admin/sessions?limit=2&offset=0", headers: { cookie } });
    assert.equal(page.statusCode, 200);
    assert.equal(page.json().items.length, 2);
    assert.equal(page.json().total, 3);
    assert.equal(page.json().all_total, 3);
    const filtered = await service.app.inject({ url: "/api/control/admin/sessions?limit=20&q=%E5%B7%A1%E6%A3%80", headers: { cookie } });
    assert.equal(filtered.json().total, 2);
    const vacuum = await service.app.inject({ method: "POST", url: "/api/control/admin/storage/vacuum", headers: { cookie }, payload: {} });
    assert.equal(vacuum.statusCode, 200);
    assert.equal(vacuum.json().ok, true);
    assert.equal(vacuum.json().storage.sessions, 3);
  } finally { await service.close(); }
});
test("native and HTTP tools share a permission boundary, four tool states, and identity injection", async () => {
  const upstream = await mockServer((_body, request, response) => {
    response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ credential: request.headers.authorization, id: request.headers["x-owner"], path: request.url })); return true;
  });
  const service = await fixture();
  try {
    service.identities.user1.permissions = ["profile:read", "business:read"];
    const user = await service.auth.identity(service.credential()); const assistant = service.runtime.assistant(user);
    service.store.setToolPolicy("business_search", { visible: false, selectable: false, default_selected: true });
    service.store.setToolPolicy("business_update", { visible: false, selectable: false, default_selected: false });
    service.store.saveHttpTool(undefined, { name: "business_http", display_name: "业务 HTTP", description: "查询自己的业务记录", permission: "business:read", url_template: `${upstream.baseUrl}/records/{record_id}`, headers: { "X-Owner": "${user.id}" }, input_schema: { type: "object", properties: { record_id: { type: "integer" } }, required: ["record_id"] } });
    const selected = await service.registry.permitted(user, assistant, ["business_http"]);
    assert.ok(selected.some((tool) => tool.name === "business_search"));
    assert.equal(selected.some((tool) => tool.name === "business_update"), false);
    const tool = selected.find((tool) => tool.name === "business_http")!;
    const result = await service.registry.execute(tool, { record_id: 17 }, { identity: user, credential: service.credential(), sessionId: "test-session", signal: AbortSignal.timeout(2000) }) as Row;
    assert.equal(result.credential, "Bearer fixture-user1"); assert.equal(result.id, String(user.id)); assert.equal(result.path, "/records/17");
    service.identities.user1.permissions = [];
    await assert.rejects(service.registry.execute(tool, {}, { identity: user, credential: service.credential(), sessionId: "test", signal: AbortSignal.timeout(1000) }), /缺少权限/);
  } finally { await service.close(); await upstream.close(); }
});
test("decision scoring changes the primary model's authorized tool loadout and exposes transient diagnostics", async () => {
  const upstream = await mockServer((body, request, response) => {
    if (request.url?.endsWith("/systemone")) { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ answers: Object.fromEntries(Object.keys(body.questions).map((key) => [key, { answer: { noul: key === "tool:business_search" ? 0.95 : 0.05 } }])), usage: { input_tokens: 20, output_tokens: 2 } })); return true; }
    if (body.stream) { sse(response, [{ content: "已根据筛选结果准备查询。" }]); return true; }
    return false;
  });
  const service = await fixture(upstream.baseUrl);
  try {
    const model = service.store.config.insertModel({ name: "决策测试", model_id: "decision-custom", provider_id: service.model!.provider_id, model_kind: "decision", extra_params: { _decision: { protocol: "decisions", endpoint: `${upstream.baseUrl}/systemone` } } });
    service.store.setSettings({ decision_enabled: true, tool_selection_mode: "decision", decision_model_id: model.id, decision_min_count: 1 });
    const session = await service.session(); const run = await service.runs.start(service.credential(), { session_id: session.id, message: "查业务记录" }); const result = await run.task;
    assert.equal(result.status, "ok"); assert.deepEqual(result.enabled_tools, ["ask_user", "business_search"]);
    const tools = upstream.requests.find((request) => request.stream)!.tools.map((tool: Row) => tool.function.name);
    assert.ok(tools.includes("business_search")); assert.ok(tools.includes("ask_user")); assert.equal(tools.includes("business_update"), false); assert.equal(tools.includes("tool_search"), false);
    const diagnostics = service.runs.diagnostics(run.id); assert.ok(diagnostics.events.some((event) => event.name === "decision.diagnostics"));
    assert.equal(JSON.stringify(service.store.all("SELECT payload FROM run_events WHERE name='decision.diagnostics'")).includes("查业务记录"), false);
    service.store.setSettings({ admin_session_content: false }); assert.equal(service.runs.diagnostics(run.id).events.some((event) => event.name === "decision.diagnostics"), false);
    assert.throws(() => parseScores({ scores: { one: 1.2 } }, ["one"]), /0–1/);
    assert.equal(decisionConnection({ model_id: "decision-model-preview" }, { base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1" }).endpoint, "https://dashscope.aliyuncs.com/compatible-mode/v1/systemone");
    assert.deepEqual(
      decisionConnection(
        { model_id: "decision-model-preview", extra_params: { _decision: { protocol: "chat_completions" } } },
        { base_url: "https://llm-example.cn-beijing.maas.aliyuncs.com" },
      ),
      {
        protocol: "decisions",
        endpoint: "https://llm-example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/systemone",
      },
    );
  } finally { await service.close(); await upstream.close(); }
});
test("tool execution rechecks current tool policy, assistant scope, and risk after discovery", async () => {
  const service = await fixture();
  try {
    const user = await service.auth.identity(service.credential()); const session = await service.session();
    const assistant = service.runtime.assistant(user);
    const tool = (await service.registry.permitted(user, assistant)).find((item) => item.name === "business_search")!;
    const context = { identity: user, credential: service.credential(), sessionId: session.id, signal: AbortSignal.timeout(2000) };
    service.store.setToolPolicy(tool.name, { enabled: false });
    await assert.rejects(service.registry.execute(tool, {}, context), /停用/);
    service.store.setToolPolicy(tool.name, { enabled: true });
    service.store.config.updateAssistant(Number(assistant.id), { tool_names: ["business_update"] });
    await assert.rejects(service.registry.execute(tool, {}, context), /助手当前/);
    service.store.config.updateAssistant(Number(assistant.id), { tool_names: [] });
    service.registry.register({ ...tool, name: "runtime_risk_change", execute: async () => "not executed" });
    const initial = (await service.registry.all()).find((item) => item.name === "runtime_risk_change")!;
    initial.risk = "write";
    await assert.rejects(service.registry.execute({ ...initial, risk: "read" }, {}, context), /风险配置已变化/);
    assert.equal(service.store.one("SELECT count(*) AS n FROM audit_log WHERE action='tool.execute'")!.n, 0);
  } finally { await service.close(); }
});
test("session edits invalidate PI context and approvals; memories are user-owned", async () => {
  const service = await fixture();
  try {
    const session = await service.session(); const token = service.credential(); const headers = { authorization: `Bearer ${token}` };
    const first = service.store.conversations.insert(session.id, { role: "user", content: "before" }); service.store.conversations.insert(session.id, { role: "assistant", content: "obsolete" });
    service.store.conversations.savePiEntries(session.id, [{ type: "session" }]);
    const edited = await service.app.inject({ method: "PATCH", url: `/api/agent/sessions/${session.id}/messages/${first.id}`, headers, payload: { content: "after" } });
    assert.equal(edited.statusCode, 200); assert.deepEqual(service.store.conversations.piEntries(session.id), []); assert.equal(service.store.conversations.messages(session.id).length, 1);
    const memory = await service.app.inject({ method: "POST", url: "/api/agent/memories", headers, payload: { content: "我喜欢中文报告" } });
    assert.equal(memory.statusCode, 201);
    const denied = await service.app.inject({ method: "PATCH", url: `/api/agent/memories/${memory.json().memory.id}`, headers: { authorization: `Bearer ${service.credential("user2")}` }, payload: { enabled: true } });
    assert.equal(denied.statusCode, 404);
    assert.equal(decrypt(encrypt("private-key")), "private-key");
    const sealed = encrypt("private-key"); assert.equal(sealed.includes("private-key"), false); assert.throws(() => decrypt(`${sealed.slice(0, -3)}123`));
  } finally { await service.close(); }
});
test("embedded mode delegates business identity without seeding demo users or exposing their login", async () => {
  const identity = { id: 123, username: "external-user", role: "operator", permissions: ["profile:read"], is_admin: false };
  const service = await fixture(undefined, { identityAdapter: { resolve: async (credential) => credential === "business-token" ? identity : null } });
  try {
    const response = await service.app.inject({ url: "/api/me", headers: { authorization: "Bearer business-token" } });
    assert.equal(response.json().user.id, 123);
    assert.equal((await service.app.inject({ url: "/api/me", headers: { authorization: "Bearer fixture-user1" } })).statusCode, 401);
    assert.equal((await service.app.inject({ url: "/api/control/config", headers: { authorization: "Bearer business-token" } })).statusCode, 401);
    assert.ok(await managementCookie(service));
  } finally { await service.close(); }
});
test("MCP JSON import is atomic, keeps secrets encrypted, and does not connect or open tools", async () => {
  const service = await fixture();
  try {
    const cookie = await managementCookie(service);
    const imported = await service.app.inject({ method: "POST", url: "/api/control/admin/mcp-servers/import", headers: { cookie }, payload: { mcpServers: { "测试 HTTP": { type: "streamable-http", url: "https://mcp.example/mcp", headers: { Authorization: "Bearer private-mcp-token" } }, "测试 stdio": { command: "node", args: ["mcp-server.js"], env: { PRIVATE_KEY: "private-env-token" } } } } });
    assert.equal(imported.statusCode, 200); assert.equal(imported.json().items.length, 2);
    assert.equal(imported.body.includes("private-mcp-token"), false);
    assert.equal(JSON.stringify(service.store.mcpServers()).includes("private-env-token"), false);
    assert.equal((await service.registry.all()).some((tool) => tool.source === "mcp"), false);
    const rejected = await service.app.inject({ method: "POST", url: "/api/control/admin/mcp-servers/import", headers: { cookie }, payload: { mcpServers: { "不应部分写入": { url: "https://mcp.example/mcp" }, "无效条目": { type: "invalid" } } } });
    assert.equal(rejected.statusCode, 422);
    assert.equal(service.store.mcpServers().length, 2);
  } finally { await service.close(); }
});
test("the same stable business identity shares sessions across web and mini-program credentials", async () => {
  const identity = { id: 501, username: "zhangsan", display_name: "张三", role: "operator", permissions: ["profile:read"], is_admin: false };
  const service = await fixture(undefined, { identityAdapter: { resolve: async (credential) => ["web-token", "mini-token"].includes(credential) ? identity : null } });
  try {
    const created = await service.app.inject({ method: "POST", url: "/api/agent/sessions", headers: { authorization: "Bearer web-token" }, payload: { title: "跨端会话" } });
    assert.equal(created.statusCode, 201);
    const listed = await service.app.inject({ url: "/api/agent/sessions", headers: { authorization: "Bearer mini-token" } });
    assert.equal(listed.statusCode, 200);
    assert.deepEqual(listed.json().items.map((item: Row) => item.id), [created.json().session.id]);
    assert.equal((await service.app.inject({ url: `/api/agent/sessions/${created.json().session.id}/messages`, headers: { authorization: "Bearer mini-token" } })).statusCode, 200);
    const other = await fixture(undefined, { identityAdapter: { resolve: async (credential) => credential === "other-token" ? { ...identity, id: 502, username: "lisi" } : null } });
    try {
      assert.equal((await other.app.inject({ url: "/api/agent/sessions" , headers: { authorization: "Bearer other-token" } })).json().items.length, 0);
    } finally { await other.close(); }
  } finally { await service.close(); }
});
test("ask_user creates a user-owned interactive question, pauses the run, and resumes only after a valid answer", async () => {
  const upstream = await mockServer((body, _request, response) => {
    if (!body.stream) return false;
    const prompt = JSON.stringify(body.messages || []);
    if (prompt.includes("用户已回答上一轮问题")) { sse(response, [{ content: "已根据你的选择继续。" }]); return true; }
    toolCall(response, "ask_user", { question: "请选择查询范围", description: "不同范围会影响查询结果", options: [{ label: "全部记录", value: "all" }, { label: "仅异常记录", value: "abnormal" }], selection: "single", allow_free_text: true });
    return true;
  });
  const service = await fixture(upstream.baseUrl);
  try {
    const session = await service.session(); const credential = service.credential();
    const first = await (await service.runs.start(credential, { session_id: session.id, message: "生成本周巡检摘要" })).task;
    assert.equal(first.status, "question_required");
    assert.equal(first.question.selection, "single");
    assert.equal(first.question.options.length, 2);
    const pending = service.store.one("SELECT * FROM questions WHERE id=?", [first.question.id])!;
    assert.equal(pending.status, "pending");
    assert.equal(service.store.conversations.latestAssistant(session.id)!.metadata.question.id, first.question.id);
    await assert.rejects(service.runs.answer(service.credential("user2"), first.question.id, { values: ["all"] }), /不存在/);
    await assert.rejects(service.runs.answer(credential, first.question.id, { values: ["invalid"] }), /无效选项/);
    await assert.rejects(service.runs.answer(credential, first.question.id, {}), /请选择/);
    assert.equal(service.store.one("SELECT status FROM questions WHERE id=?", [first.question.id])!.status, "pending");
    service.store.insert("runs", { id: "question-busy", session_id: session.id, owner_key: session.owner_key, status: "running", started_at: new Date().toISOString() });
    await assert.rejects(service.runs.answer(credential, first.question.id, { cancel: true }), /正在执行/);
    service.store.run("DELETE FROM runs WHERE id='question-busy'");
    const answered = await (await service.runs.answer(credential, first.question.id, { values: ["abnormal"], free_text: "只看异常" })).task;
    assert.equal(answered.status, "ok");
    assert.match(answered.answer, /继续/);
    assert.equal(service.store.one("SELECT status FROM questions WHERE id=?", [first.question.id])!.status, "answered");
    assert.equal(service.store.conversations.latestAssistant(session.id, (message) => Boolean(message.metadata?.question))!.metadata.question_status, "answered");
    await assert.rejects(service.runs.answer(credential, first.question.id, { values: ["all"] }), /已回答|取消|过期/);
  } finally { await service.close(); await upstream.close(); }
});
test("a later user message cancels a stale pending question; cleanup removes session-owned rows but keeps publication records", async () => {
  let questionAsked = false;
  const upstream = await mockServer((body, _request, response) => {
    if (!body.stream) return false;
    if (!questionAsked) { questionAsked = true; toolCall(response, "ask_user", { question: "请选择范围", options: [{ label: "全部", value: "all" }] }); }
    else sse(response, [{ content: "已按新消息继续。" }]);
    return true;
  });
  const service = await fixture(upstream.baseUrl);
  try {
    const session = await service.session(); const credential = service.credential();
    const first = await (await service.runs.start(credential, { session_id: session.id, message: "第一次问题" })).task;
    assert.equal(first.status, "question_required");
    const second = await (await service.runs.start(credential, { session_id: session.id, message: "不回答，换一个问题" })).task;
    assert.equal(second.status, "ok");
    assert.equal(service.store.one("SELECT status FROM questions WHERE id=?", [first.question.id])!.status, "cancelled");
    assert.equal(service.store.conversations.latestAssistant(session.id, (message) => Boolean(message.metadata?.question))!.metadata.question_status, "cancelled");
    service.store.insert("llm_calls", { session_id: session.id, username: "user1", model: "old", purpose: "chat" });
    service.store.insert("compaction_events", { session_id: session.id, trigger: "auto" });
    service.store.conversations.savePiEntries(session.id, [{ type: "session" }]);
    const publication = service.store.insert("publications", { user_id: 2, username: "user1", session_id: session.id, remote_base_url: "http://pagepilot.local", title: "报告", description: "", visibility: "unlisted" });
    service.store.run("UPDATE sessions SET updated_at=? WHERE id=?", [new Date(Date.now() - 40 * 86400000).toISOString(), session.id]);
    const workspace = path.join(service.store.paths.workspaces, session.id);
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, "temp.txt"), "cleanup");
    service.store.purge();
    assert.equal(service.store.one("SELECT id FROM sessions WHERE id=?", [session.id]), undefined);
    assert.equal(fs.existsSync(workspace), false);
    assert.equal(service.store.conversations.count(session.id), 0);
    assert.deepEqual(service.store.conversations.piEntries(session.id), []);
    assert.equal(service.store.one("SELECT id FROM llm_calls WHERE session_id=?", [session.id]), undefined);
    assert.equal(service.store.one("SELECT id FROM compaction_events WHERE session_id=?", [session.id]), undefined);
    assert.equal(service.store.one("SELECT session_id FROM publications WHERE id=?", [publication.id])!.session_id, null);
  } finally { await service.close(); await upstream.close(); }
});
test("a failed new message does not cancel a pending question before the model is validated", async () => {
  const upstream = await mockServer((body, _request, response) => {
    if (!body.stream) return false;
    toolCall(response, "ask_user", { question: "请选择范围", options: [{ label: "全部", value: "all" }] });
    return true;
  });
  const service = await fixture(upstream.baseUrl);
  try {
    const session = await service.session(); const credential = service.credential();
    const first = await (await service.runs.start(credential, { session_id: session.id, message: "需要补充信息" })).task;
    assert.equal(first.status, "question_required");
    service.store.config.updateModel(Number(service.model!.id), { enabled: false });
    const failed = await (await service.runs.start(credential, { session_id: session.id, message: "模型不可用时的新消息" })).task;
    assert.equal(failed.status, "error");
    assert.match(failed.message, /没有可用对话模型/);
    assert.equal(service.store.one("SELECT status FROM questions WHERE id=?", [first.question.id])!.status, "pending");
  } finally { await service.close(); await upstream.close(); }
});
