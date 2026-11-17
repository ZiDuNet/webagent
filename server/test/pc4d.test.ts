import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPc4dAgent } from "../src/integrations/pc4d/index.js";
import { Pc4dConnector, type Pc4dTool } from "../src/integrations/pc4d/connector.js";
import { Store } from "../src/store.js";
import { encrypt } from "../src/security.js";
import { mockServer, toolCall, sse } from "./helpers.js";
import type { Row } from "../src/types.js";

async function businessFixture() {
  const seen: { path: string; params: Record<string, string> }[] = [];
  let denied = false;
  let queryData: unknown;
  const rights: Row = { module: [], plugin: ["pc4d-web-beam-factory"], permission: ["beam:view"], projectPlugin: ["pc4d-web-beam-factory"] };
  const upstream = await mockServer((body, request, response) => {
    const target = new URL(request.url || "/", "http://localhost");
    if (target.pathname.startsWith("/pc/api/")) {
      seen.push({ path: target.pathname, params: Object.fromEntries(target.searchParams) });
      response.setHeader("Content-Type", "application/json");
      if (target.pathname === "/pc/api/user/info") {
        const pid = Number(target.searchParams.get("pid"));
        const token = target.searchParams.get("access_token");
        response.end(JSON.stringify(denied || token === "invalid" ? { code: 12 } : { code: 0, data: { project: { ID: pid, Name: `项目 ${pid}` }, user: { ProjectID: pid, Mobile: token === "other-user" ? "13800000002" : "13800000001", RealName: "同名测试用户" } } }));
      } else if (target.pathname === "/pc/api/user/permission") response.end(JSON.stringify({ code: 0, data: denied ? { module: [], plugin: [], permission: [], projectPlugin: [] } : rights }));
      else if (target.pathname === "/pc/api/screen/transportation/project-info") response.end(JSON.stringify({ code: 0, data: { ProjectName: `项目 ${target.searchParams.get("pid")}`, ProjectLogo: "/upload/project-logo.png" } }));
      else if (target.pathname === "/pc/api/screen/transportation/vehicle-list") response.end(JSON.stringify({ code: 0, data: [{ ID: 1, Status: "运梁中", DriverData: [{ Name: "张师傅", Mobile: "13800000000" }], CameraInfo: { Token: "playback-secret" }, GpsGuid: "private-device", ModelUrl: "https://models.example/private?token=secret", Url: "https://media.example/play?token=secret" }] }));
      else response.end(JSON.stringify({ code: 0, data: queryData ?? { ProjectName: `项目 ${target.searchParams.get("pid")}`, total: 7 } }));
      return true;
    }
    if (body.stream) {
      const last = body.messages?.at(-1);
      if (last?.role === "tool") sse(response, [{ content: "当前项目共有 7 项。" }]);
      else toolCall(response, "pc4d_current_project", {});
      return true;
    }
    return false;
  });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "webagent-pc4d-test-"));
  const store = new Store(directory);
  const service = await createPc4dAgent({ store, baseUrl: upstream.baseUrl, cacheSeconds: 0, logger: false, staticUi: false, warmCatalogue: false });
  const provider = store.config.insertProvider({ name: "Test", base_url: `${upstream.baseUrl}/v1`, api_key: "mock-model-key" });
  store.config.insertModel({ name: "Test", provider_id: provider.id, model_id: "test-chat", is_default: true, context_window: 16384, max_output_tokens: 1024 });
  store.setSettings({ retry_enabled: false, memory_auto_extract: false });
  const exchange = async (channel: "screen" | "web" | "miniprogram", pid = 19, access_token = "first-login") => {
    const response = await service.app.inject({ method: "POST", url: "/api/integrations/pc4d/exchange", payload: { channel, pid, ...(channel === "screen" ? {} : { access_token }) } });
    assert.equal(response.statusCode, 200, response.body);
    return response.json<Row>();
  };
  return { ...service, directory, seen, upstream, exchange, changeQueryData: (value: unknown) => { queryData = value; }, changeRights: (values: Row) => Object.assign(rights, values), deny: () => { denied = true; }, close: async () => { await service.app.close(); store.close(); await upstream.close(); fs.rmSync(directory, { recursive: true, force: true }); } };
}

test("PC4D verifies business identities and shares ownership across clients without trusting client user IDs", async () => {
  const fixture = await businessFixture();
  try {
    const web = await fixture.exchange("web");
    const mini = await fixture.exchange("miniprogram", 19, "rotated-login");
    const webUser = await fixture.auth.identity(web.token);
    const miniUser = await fixture.auth.identity(mini.token);
    assert.equal(webUser.owner_key, miniUser.owner_key);
    assert.equal(fixture.runtime.assistant(webUser).id, web.assistant_id);
    assert.equal(fixture.runtime.assistant(miniUser).id, mini.assistant_id);
    assert.notEqual(web.assistant_id, mini.assistant_id);
    assert.equal(web.token.includes("first-login"), false);
    assert.equal(JSON.stringify(web.user).includes("13800000001"), false);
    const session = fixture.runtime.createSession(webUser);
    assert.equal(fixture.runtime.assistant(miniUser, session.assistant_id).id, session.assistant_id);
    const sessions = await fixture.app.inject({ url: "/api/agent/sessions", headers: { authorization: `Bearer ${mini.token}` } });
    assert.ok(sessions.json().items.some((item: Row) => item.id === session.id));
    const staleCookie = await fixture.app.inject({ url: "/api/agent/me", headers: { authorization: `Bearer ${mini.token}`, cookie: "wa_access_session=stale-browser-session" } });
    assert.equal(staleCookie.statusCode, 200);
    assert.equal(staleCookie.json().user.owner_key, miniUser.owner_key);
    for (const input of [["web", 72, "first-login"], ["web", 19, "other-user"], ["screen", 19, ""]] as const) {
      const other = await fixture.exchange(...input);
      const response = await fixture.app.inject({ url: `/api/agent/sessions/${session.id}/messages`, headers: { authorization: `Bearer ${other.token}` } });
      assert.equal(response.statusCode, 404);
    }
    const forged = await fixture.app.inject({ method: "POST", url: "/api/integrations/pc4d/exchange", payload: { channel: "web", pid: 19, access_token: "first-login", user_id: "admin" } });
    assert.equal(forged.statusCode, 422);
    assert.equal((await fixture.app.inject({ method: "POST", url: "/api/integrations/pc4d/exchange", payload: { channel: "web", pid: 19 } })).statusCode, 401);
    assert.equal((await fixture.app.inject({ method: "POST", url: "/api/integrations/pc4d/exchange", payload: { channel: "web", pid: 19, access_token: "invalid" } })).statusCode, 401);
    await assert.rejects(fixture.auth.identity(`${web.token}tampered`), /凭据无效/);
    const expired = `pc4d_${encrypt(JSON.stringify({ version: 1, channel: "screen", pid: 19, expires: Date.now() - 1000 })).slice(7)}`;
    await assert.rejects(fixture.auth.identity(expired), /过期/);
  } finally { await fixture.close(); }
});

test("PC4D public tools bind PID, respect global policy, and never forward login tokens to screen APIs", async () => {
  const fixture = await businessFixture();
  try {
    const one = await fixture.exchange("screen");
    const two = await fixture.exchange("screen");
    assert.equal(one.project.name, "项目 19");
    assert.equal(one.project.logo, new URL("/upload/project-logo.png", fixture.upstream.baseUrl).href);
    const user = await fixture.auth.identity(one.token);
    assert.equal(user.owner_key, (await fixture.auth.identity(two.token)).owner_key);
    const assistant = fixture.runtime.assistant(user);
    const offered = await fixture.registry.permitted(user, assistant);
    const screen = offered.find((tool) => tool.name.startsWith("pc4d_screen_") && !tool.parameters.required?.length)!;
    assert.ok(screen);
    const context = { identity: user, credential: one.token, sessionId: "unpersisted-test", signal: AbortSignal.timeout(10000) };
    assert.ok((await fixture.registry.execute(screen, {}, context) as Row).project.id === 19);
    assert.equal(fixture.seen.at(-1)!.params.pid, "19");
    assert.equal(fixture.seen.at(-1)!.params.access_token, undefined);
    await assert.rejects(fixture.registry.execute(screen, { pid: 72 }, context), /参数无效/);
    fixture.store.setToolPolicy(screen.name, { enabled: false });
    assert.equal((await fixture.registry.permitted(user, assistant)).some((tool) => tool.name === screen.name), false);
    await assert.rejects(fixture.registry.execute(screen, {}, context), /停用/);
    const business = await fixture.exchange("web");
    const businessUser = await fixture.auth.identity(business.token);
    assert.equal((await fixture.registry.permitted(businessUser, fixture.runtime.assistant(businessUser))).some((tool) => tool.name.startsWith("pc4d_screen_")), false);
    assert.equal((await fixture.app.inject({ method: "POST", url: "/api/agent/sessions", headers: { authorization: `Bearer ${one.token}` }, payload: { assistant_id: business.assistant_id } })).statusCode, 403);
    const serialized = JSON.stringify(fixture.store.conversations.allPiEntries());
    assert.equal(serialized.includes(one.token), false);
  } finally { await fixture.close(); }
});

test("PC4D checks project plugins and exact operation permission again before invoking business tools", async () => {
  const fixture = await businessFixture();
  try {
    const tool: Pc4dTool = { name: "pc4d_business_test", title: "业务查询", description: "测试", path: "/pc/api/beam/list", channels: ["web"], tags: ["业务"], parameters: { type: "object", properties: {} }, permission_alternatives: [{ channel: "web", plugin: "pc4d-web-beam-factory", permission: "beam:view" }] };
    const catalogue = path.join(fixture.directory, "tools/pc4d/catalogue.json");
    const existing = JSON.parse(fs.readFileSync(catalogue, "utf8"));
    fs.writeFileSync(catalogue, JSON.stringify([...existing, tool]));
    const connector = new Pc4dConnector(fixture.store, { baseUrl: fixture.upstream.baseUrl, cacheSeconds: 0 });
    connector.initialize([...existing, tool]);
    const access = await connector.exchange({ channel: "web", pid: 19, access_token: "first-login" });
    const user = await connector.resolve(access.token);
    assert.ok(user!.permissions.includes("pc4d:tool:pc4d_business_test"));
    const definition = connector.tools().find((item) => item.name === tool.name)!;
    const identity = { ...user!, subject: user!.subject!, owner_key: `pc4d:project:19:${user!.subject}` };
    await definition.execute({}, { identity, credential: access.token, sessionId: "test", signal: AbortSignal.timeout(10000) });
    for (const restricted of [{ projectPlugin: [] }, { plugin: [] }, { permission: [] }]) {
      fixture.changeRights({ projectPlugin: ["pc4d-web-beam-factory"], plugin: ["pc4d-web-beam-factory"], permission: ["beam:view"], ...restricted });
      const current = await connector.resolve(access.token);
      assert.equal(current!.permissions.includes("pc4d:tool:pc4d_business_test"), false);
      await assert.rejects(definition.execute({}, { identity, credential: access.token, sessionId: "test", signal: AbortSignal.timeout(10000) }), /权限/);
    }
    fixture.deny();
    await assert.rejects(definition.execute({}, { identity, credential: access.token, sessionId: "test", signal: AbortSignal.timeout(10000) }), /失效|权限/);
    assert.equal(fixture.seen.filter((item) => item.path === "/pc/api/beam/list").length, 1);
  } finally { await fixture.close(); }
});

test("PC4D usage is scoped by verified ownership rather than a shared display name", async () => {
  const fixture = await businessFixture();
  try {
    const first = await fixture.exchange("web");
    const other = await fixture.exchange("web", 19, "other-user");
    const firstUser = await fixture.auth.identity(first.token);
    const otherUser = await fixture.auth.identity(other.token);
    assert.equal(firstUser.username, otherUser.username);
    const firstSession = fixture.runtime.createSession(firstUser);
    const otherSession = fixture.runtime.createSession(otherUser);
    const model = fixture.store.models()[0];
    fixture.providers.record(model, "chat", { input_tokens: 10, output_tokens: 2 }, firstSession.id, firstUser.username, 10);
    fixture.providers.record(model, "chat", { input_tokens: 30, output_tokens: 7 }, otherSession.id, otherUser.username, 10);
    const usage = async (raw: string) => (await fixture.app.inject({ url: "/api/agent/usage/me", headers: { authorization: `Bearer ${raw}` } })).json<Row>();
    const one = await usage(first.token);
    const two = await usage(other.token);
    assert.equal(one.calls.length, 1);
    assert.equal(two.calls.length, 1);
    assert.equal(one.calls[0].session_id, firstSession.id);
    assert.equal(two.calls[0].session_id, otherSession.id);
    assert.equal(one.totals.total_tokens, 12);
    assert.equal(two.totals.total_tokens, 37);
  } finally { await fixture.close(); }
});

test("PC4D validates schema limits before upstream queries and removes private response fields", async () => {
  const fixture = await businessFixture();
  try {
    const access = await fixture.exchange("screen");
    const identity = await fixture.auth.identity(access.token);
    const tools = await fixture.registry.permitted(identity, fixture.runtime.assistant(identity));
    const details = tools.find((tool) => tool.name === "pc4d_screen_tension_details")!;
    const execution = { identity, credential: access.token, sessionId: "validation-test", signal: AbortSignal.timeout(10000) };
    const invalid = [{ name: "梁'; DELETE FROM example; --" }, { name: "梁\\编号" }, { name: "a".repeat(129) }, { count: 101 }, { page: 0 }, { page: 1.5 }];
    const previous = fixture.seen.filter((item) => item.path === "/pc/api/beam-screen/tension/detail").length;
    for (const args of invalid) await assert.rejects(fixture.registry.execute(details, args, execution), /参数/);
    assert.equal(fixture.seen.filter((item) => item.path === "/pc/api/beam-screen/tension/detail").length, previous);
    await fixture.registry.execute(details, { name: "A-1# 梁（左）" }, execution);
    assert.equal(fixture.seen.at(-1)!.params.page, "1");
    assert.equal(fixture.seen.at(-1)!.params.count, "20");
    const curing = tools.find((tool) => tool.name === "pc4d_screen_beam_curing")!;
    await assert.rejects(fixture.registry.execute(curing, {}, execution), /缺少参数/);
    const vehicleTool = tools.find((tool) => tool.name === "pc4d_screen_transport_vehicles")!;
    assert.ok(vehicleTool);
    const result = await fixture.registry.execute(vehicleTool, {}, execution) as Row;
    assert.equal(result.data[0].Status, "运梁中");
    assert.equal(result.data[0].DriverData[0].Name, "张师傅");
    assert.doesNotMatch(JSON.stringify(result), /13800000000|playback-secret|private-device|https:\/\//);
  } finally { await fixture.close(); }
});

test("PC4D HTML previews use expiring isolated documents and PagePilot/history stay with their owner", async () => {
  const fixture = await businessFixture();
  try {
    const first = await fixture.exchange("screen", 19);
    const other = await fixture.exchange("screen", 72);
    const user = await fixture.auth.identity(first.token);
    const session = fixture.runtime.createSession(user);
    const html = "<!doctype html><html><body><h1>项目报告</h1></body></html>";
    const response = await fixture.app.inject({ method: "POST", url: "/api/integrations/pc4d/artifacts", headers: { authorization: `Bearer ${first.token}`, "x-forwarded-proto": "https" }, payload: { html, session_id: session.id } });
    assert.equal(response.statusCode, 201, response.body);
    assert.match(response.json().url, /^\/api\/integrations\/pc4d\/artifacts\//);
    assert.equal(response.json().path, response.json().url);
    const url = new URL(response.json().url, "http://localhost");
    assert.equal(url.href.includes(first.token), false);
    const preview = await fixture.app.inject({ url: url.pathname });
    assert.equal(preview.statusCode, 200);
    assert.equal(preview.body, html);
    assert.match(String(preview.headers["content-security-policy"]), /sandbox allow-scripts/);
    assert.match(String(preview.headers["content-security-policy"]), /connect-src 'none'/);
    assert.equal(preview.headers["cache-control"], "no-store");
    fixture.store.purge();
    assert.equal((await fixture.app.inject({ url: url.pathname })).statusCode, 200);
    fs.rmSync(path.join(fixture.directory, "artifacts/pc4d"), { recursive: true, force: true });
    const recreated = await fixture.app.inject({ method: "POST", url: "/api/integrations/pc4d/artifacts", headers: { authorization: `Bearer ${first.token}` }, payload: { html, session_id: session.id } });
    assert.equal(recreated.statusCode, 201, recreated.body);
    assert.equal((await fixture.app.inject({ url: new URL(recreated.json().url, "http://localhost").pathname })).statusCode, 200);
    assert.equal((await fixture.app.inject({ method: "POST", url: "/api/integrations/pc4d/artifacts", headers: { authorization: `Bearer ${other.token}` }, payload: { html, session_id: session.id } })).statusCode, 404);
    fixture.store.insert("publications", { ...fixture.store.ownerColumns(user), remote_base_url: "https://pages.example", title: "报告", code: "project-report" });
    const list = (raw: string) => fixture.app.inject({ url: "/api/agent/pagepilot/publications", headers: { authorization: `Bearer ${raw}` } });
    assert.equal((await list(first.token)).json().items.length, 1);
    assert.equal((await list(other.token)).json().items.length, 0);
    const sameProject = await fixture.exchange("screen", 19);
    assert.equal((await list(sameProject.token)).json().items.length, 1);
  } finally { await fixture.close(); }
});

test("PC4D keeps zero/false query results and reloads the catalogue only after changes", async () => {
  const fixture = await businessFixture();
  try {
    const first = fixture.connector.definitions();
    assert.equal(fixture.connector.definitions(), first);
    const access = await fixture.exchange("screen");
    const identity = await fixture.auth.identity(access.token);
    const tool = (await fixture.registry.permitted(identity, fixture.runtime.assistant(identity))).find((entry) => entry.name === "pc4d_screen_capacity")!;
    assert.ok(tool);
    const execution = { identity, credential: access.token, sessionId: "scalar-query", signal: AbortSignal.timeout(10000) };
    for (const value of [0, false]) {
      fixture.changeQueryData(value);
      assert.equal((await fixture.registry.execute(tool, {}, execution) as Row).data, value);
    }
    const catalogue = path.join(fixture.directory, "tools/pc4d/catalogue.json");
    fs.writeFileSync(catalogue, JSON.stringify(first.map((entry) => entry.name === tool.name ? { ...entry, enabled: false } : entry)));
    assert.notEqual(fixture.connector.definitions(), first);
    assert.equal((await fixture.registry.permitted(identity, fixture.runtime.assistant(identity))).some((entry) => entry.name === tool.name), false);
  } finally { await fixture.close(); }
});

test("PC4D SSE preserves allowed-origin headers and uses the PI runtime for an actual tool round", async () => {
  const previous = process.env.WEBAGENT_UI_ORIGINS;
  process.env.WEBAGENT_UI_ORIGINS = "http://127.0.0.1:8001";
  const fixture = await businessFixture();
  try {
    const options = await fixture.app.inject({ method: "OPTIONS", url: "/api/agent/chat/stream", headers: { origin: "http://127.0.0.1:8001", "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" } });
    assert.equal(options.statusCode, 204);
    const access = await fixture.exchange("screen");
    const response = await fixture.app.inject({ method: "POST", url: "/api/agent/chat/stream", headers: { authorization: `Bearer ${access.token}`, origin: "http://127.0.0.1:8001" }, payload: { message: "当前是哪个项目？" } });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.headers["access-control-allow-origin"], "http://127.0.0.1:8001");
    assert.match(response.body, /event: tool.finished/);
    assert.match(response.body, /event: run.completed/);
    assert.equal(response.body.includes(access.token), false);
    const sessions = fixture.store.all("SELECT * FROM sessions");
    assert.equal(sessions.length, 1);
    const entries = JSON.stringify(fixture.store.conversations.allPiEntries());
    assert.equal(entries.includes(access.token), false);
  } finally { await fixture.close(); if (previous === undefined) delete process.env.WEBAGENT_UI_ORIGINS; else process.env.WEBAGENT_UI_ORIGINS = previous; }
});
