import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fixture, mockServer, sse, toolCall } from "./helpers.js";
import { config } from "../src/config.js";
import { piLocalToolNames, piLocalTools } from "../src/pi-tools.js";
import type { Row } from "../src/types.js";

async function administrator(service: Awaited<ReturnType<typeof fixture>>) {
  const response = await service.app.inject({ method: "POST", url: "/api/control/auth/login", payload: { username: "admin", password: config.adminPassword } });
  assert.equal(response.statusCode, 200);
  return { cookie: response.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ") };
}

test("catalog includes official PI metadata and unconfigured built-ins; disabled tools cannot execute", async () => {
  const service = await fixture();
  try {
    const headers = await administrator(service);
    const catalog = await service.app.inject({ url: "/api/control/admin/tools", headers });
    assert.equal(catalog.statusCode, 200);
    const tools = catalog.json().items as Row[];
    for (const { definition } of piLocalTools) {
      const listed = tools.find((tool) => tool.name === definition.name)!;
      assert.ok(listed); assert.equal(listed.source, "pi"); assert.equal(listed.locked, true); assert.equal(listed.enabled, false);
      assert.deepEqual(listed.input_schema, JSON.parse(JSON.stringify(definition.parameters)));
      assert.equal(listed.description, definition.description);
    }
    assert.equal(tools.find((tool) => tool.name === "codemode")?.locked, true);
    const pagepilot = tools.find((tool) => tool.name === "pagepilot_publish_html")!;
    assert.equal(pagepilot.configured, false); assert.equal(pagepilot.locked, false);
    assert.equal(tools.some((tool) => ["load_skill", "read_skill_file"].includes(tool.name)), false);
    for (const name of ["current_datetime", "pagepilot_publish_html", "pagepilot_list_my_pages"]) {
      const result = await service.app.inject({ method: "PUT", url: `/api/control/admin/tools/${name}`, headers, payload: { enabled: false } });
      assert.equal(result.statusCode, 200, result.body); assert.equal(result.json().tool.enabled, false);
    }
    const user = await service.auth.identity(service.credential());
    const native = (await service.registry.all()).find((tool) => tool.name === "current_datetime")!;
    await assert.rejects(service.registry.execute(native, {}, { identity: user, credential: service.credential(), sessionId: "test", signal: AbortSignal.timeout(1000) }), /停用/);
    const offered = await service.registry.permitted(user, service.runtime.assistant(user));
    assert.equal(offered.some((tool) => tool.name === "current_datetime"), false);
    assert.equal((await service.app.inject({ method: "PUT", url: "/api/control/admin/tools/unknown", headers, payload: { enabled: true } })).statusCode, 404);
    const screenshot = await service.app.inject({ method: "POST", url: "/api/agent/artifacts/screenshot", headers: { authorization: `Bearer ${service.credential()}` }, payload: { html: "<html><body>not executed</body></html>" } });
    assert.equal(screenshot.statusCode, 404);
  } finally { await service.close(); }
});

test("PI shell, files and CodeMode stay disabled despite API requests or stale saved settings", async () => {
  const service = await fixture();
  try {
    const headers = await administrator(service);
    for (const name of [...piLocalToolNames, "codemode"]) {
      const response = await service.app.inject({ method: "PUT", url: `/api/control/admin/tools/${name}`, headers, payload: { enabled: true } });
      assert.equal(response.statusCode, 403, name);
      service.store.setToolPolicy(name, { enabled: true, visible: true, default_selected: true });
    }
    const catalog = await service.registry.catalog();
    for (const name of [...piLocalToolNames, "codemode"]) assert.equal(catalog.find((tool) => tool.name === name)?.enabled, false);
    const user = await service.auth.identity(service.credential("admin"));
    const offered = await service.registry.permitted(user, service.runtime.assistant(user), [...piLocalToolNames, "codemode"]);
    assert.equal(offered.filter((tool) => tool.name !== "ask_user").length, 0);
    const template = (await service.registry.all())[0];
    for (const name of [...piLocalToolNames, "codemode", "tool_search"]) {
      assert.throws(() => service.registry.register({ ...template, name }), /保留/);
      const rejected = await service.app.inject({ method: "POST", url: "/api/control/admin/dynamic-tools", headers, payload: { name, description: "cannot shadow PI", url_template: "https://example.invalid/api" } });
      assert.equal(rejected.statusCode, 409, name);
    }
  } finally { await service.close(); }
});

test("PI BM25 catalog switch and runtime configuration share the same state and preserve mutual exclusion", async () => {
  const service = await fixture();
  try {
    const headers = await administrator(service);
    const toggle = (enabled: boolean) => service.app.inject({ method: "PUT", url: "/api/control/admin/tools/tool_search", headers, payload: { enabled } });
    assert.equal((await toggle(true)).statusCode, 200);
    assert.equal(service.store.settings().tool_selection_mode, "bm25");
    assert.equal((await service.registry.catalog()).find((tool) => tool.name === "tool_search")?.enabled, true);
    assert.equal((await toggle(false)).statusCode, 200);
    assert.equal(service.store.settings().tool_selection_mode, "none");
    service.store.setSettings({ tool_selection_mode: "decision", decision_enabled: true });
    assert.equal((await toggle(true)).statusCode, 422);
    assert.equal((await toggle(false)).statusCode, 200);
    assert.equal(service.store.settings().tool_selection_mode, "decision");
  } finally { await service.close(); }
});

test("native PI Skills are advertised through the model tool list", async () => {
  const upstream = await mockServer(); const service = await fixture(upstream.baseUrl);
  try {
    const session = await service.session();
    const result = await (await service.runs.start(service.credential(), { session_id: session.id, message: "你好" })).task;
    assert.equal(result.status, "ok");
    const names = upstream.requests.find((request) => request.stream)!.tools.map((tool: Row) => tool.function.name);
    assert.ok(names.includes("read"), "the native Skill read tool should be visible");
    for (const name of [...piLocalToolNames.filter((name) => name !== "read"), "codemode", "load_skill", "read_skill_file"]) assert.equal(names.includes(name), false, name);
  } finally { await service.close(); await upstream.close(); }
});

test("native Skill read stays inside the materialized directory and reference-file policy is enforced", async () => {
  let requestedPath = "";
  const upstream = await mockServer(async (body, _request, response) => {
    if (!body.stream) return false;
    const last = body.messages.at(-1);
    if (last?.role === "tool") { sse(response, [{ content: "技能读取完成。" }]); return true; }
    if (last?.role === "user" && JSON.stringify(last.content).includes("读取技能")) { toolCall(response, "read", { path: requestedPath }); return true; }
    sse(response, [{ content: "准备完成。" }]);
    return true;
  });
  const service = await fixture(upstream.baseUrl);
  try {
    service.skills.save({ slug: "record-inspection", name: "记录巡检规范", description: "业务记录状态判断规范", content: "secret-knowledge-must-not-be-read", files: { "references/status.md": "reference-content-marker" } });
    assert.equal(service.store.one("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='skills'")!.n, 0);
    const latestRoot = () => {
      const root = path.join(service.dir, "runtime", "skill-runtime");
      const names = fs.readdirSync(root).filter((name) => name.startsWith("assistant-"));
      assert.ok(names.length);
      return path.join(root, names.sort((a, b) => fs.statSync(path.join(root, b)).mtimeMs - fs.statSync(path.join(root, a)).mtimeMs)[0]);
    };
    const session = await service.session();
    const credential = service.credential();
    await (await service.runs.start(credential, { session_id: session.id, message: "准备技能目录" })).task;
    const root = latestRoot();
    requestedPath = path.join(root, "record-inspection", "SKILL.md");
    const read = await (await service.runs.start(credential, { session_id: session.id, message: "读取技能正文" })).task;
    assert.equal(read.status, "ok");
    const readRun = read.tool_runs.find((tool: Row) => tool.tool === "read");
    assert.equal(readRun?.status, "ok");
    assert.ok(upstream.requests.some((request) => JSON.stringify(request.messages).includes("secret-knowledge-must-not-be-read")), "the read tool result should reach the model");
    requestedPath = path.join(root, "record-inspection", "references", "status.md");
    const reference = await (await service.runs.start(credential, { session_id: session.id, message: "读取技能参考" })).task;
    assert.equal(reference.tool_runs.find((tool: Row) => tool.tool === "read")?.status, "ok");
    assert.ok(upstream.requests.some((request) => JSON.stringify(request.messages).includes("reference-content-marker")), "the reference file content should reach the model");
    service.store.setSettings({ skill_files_enabled: false });
    const blocked = await (await service.runs.start(credential, { session_id: session.id, message: "读取技能参考" })).task;
    assert.equal(blocked.tool_runs.find((tool: Row) => tool.tool === "read")?.status, "failed");
    assert.equal(JSON.stringify(blocked).includes("reference-content-marker"), false);
    requestedPath = "/etc/passwd";
    const outside = await (await service.runs.start(credential, { session_id: session.id, message: "读取技能正文" })).task;
    assert.equal(outside.tool_runs.find((tool: Row) => tool.tool === "read")?.status, "failed");
  } finally { await service.close(); await upstream.close(); }
});

test("Skills live on disk, can be scoped per assistant, and respect the global switch", async () => {
  const service = await fixture();
  try {
    const headers = await administrator(service);
    const created = await service.app.inject({
      method: "POST",
      url: "/api/control/admin/skills",
      headers,
      payload: {
        name: "只读巡检",
        slug: "readonly-inspection",
        description: "只允许读取巡检规范",
        content: "巡检时必须先读取真实业务数据。",
        files: { "references/checklist.md": "只读检查项" },
        enabled: true,
      },
    });
    assert.equal(created.statusCode, 200, created.body);
    assert.ok(fs.existsSync(path.join(service.skills.root, "readonly-inspection", "SKILL.md")));
    assert.equal(service.store.one("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='skills'")!.n, 0);

    const assistant = service.store.assistants()[0]!;
    const scoped = await service.app.inject({
      method: "PUT",
      url: `/api/control/admin/assistants/${assistant.id}`,
      headers,
      payload: { skill_slugs: ["readonly-inspection"] },
    });
    assert.equal(scoped.statusCode, 200, scoped.body);

    const list = await service.app.inject({
      url: `/api/agent/skills?assistant_id=${assistant.id}`,
      headers: { authorization: `Bearer ${service.credential()}` },
    });
    assert.equal(list.statusCode, 200, list.body);
    assert.deepEqual(list.json().items.map((skill: Row) => skill.slug), ["readonly-inspection"]);
    assert.equal(JSON.stringify(list.json()).includes("只读检查项"), false);

    const disabled = await service.app.inject({
      method: "PUT",
      url: "/api/control/admin/skills/global",
      headers,
      payload: { enabled: false },
    });
    assert.equal(disabled.statusCode, 200, disabled.body);
    assert.equal(disabled.json().global_enabled, false);
    const hidden = await service.app.inject({
      url: `/api/agent/skills?assistant_id=${assistant.id}`,
      headers: { authorization: `Bearer ${service.credential()}` },
    });
    assert.deepEqual(hidden.json().items, []);
  } finally { await service.close(); }
});
