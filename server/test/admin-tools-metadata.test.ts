import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.js";
import { config } from "../src/config.js";
import type { Row } from "../src/types.js";

async function administrator(service: Awaited<ReturnType<typeof fixture>>) {
  const response = await service.app.inject({ method: "POST", url: "/api/control/auth/login", payload: { username: "admin", password: config.adminPassword } });
  assert.equal(response.statusCode, 200);
  return { cookie: response.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ") };
}

const catalogItem = async (service: Awaited<ReturnType<typeof fixture>>, name: string) =>
  (await service.registry.catalog()).find((tool) => tool.name === name);

test("tool metadata overrides apply to every source without changing tool names", async () => {
  const service = await fixture();
  try {
    const headers = await administrator(service);
    const httpTool = service.store.saveHttpTool(undefined, {
      name: "erp_lookup", display_name: "ERP 查询", description: "HTTP 工具的原始描述",
      url_template: "https://example.invalid/records", method: "GET", enabled: true,
    });
    const server = service.store.saveMcpServer(undefined, {
      name: "demo-mcp", transport: "http", enabled: true,
      config: {
        url: "https://example.invalid/mcp",
        cached_tools: [{ name: "search", description: "MCP 工具的原始描述", inputSchema: { type: "object", properties: {} } }],
        tool_policies: { search: { public: true } },
      },
    });
    const mcpToolName = `mcp_${server.id}_search`;

    const cases = [
      { name: "business_search", title: "业务检索（覆盖）", description: "原生工具的覆盖描述" },
      { name: "current_datetime", title: "当前时间（覆盖）", description: "内置工具的覆盖描述" },
      { name: "read", title: "读取文件（覆盖）", description: "PI 原生工具的覆盖描述" },
      { name: httpTool.name, title: "ERP 查询（覆盖）", description: "HTTP 工具的覆盖描述" },
      { name: mcpToolName, title: "MCP 检索（覆盖）", description: "MCP 工具的覆盖描述" },
    ] as const;
    for (const item of cases) {
      const response = await service.app.inject({ method: "PATCH", url: `/api/control/admin/tools/${encodeURIComponent(item.name)}/metadata`, headers, payload: { title: item.title, description: item.description } });
      assert.equal(response.statusCode, 200, `${item.name}: ${response.body}`);
      assert.equal(response.json().tool.name, item.name, "覆盖不得修改工具名");
      assert.equal(response.json().tool.title, item.title);
      assert.equal(response.json().tool.description, item.description);
      const listed = await catalogItem(service, item.name);
      assert.equal(listed?.title, item.title, `${item.name} 应出现在管理端目录`);
      assert.equal(listed?.description, item.description);
      assert.equal(listed?.name, item.name);
    }

    const assistant = service.runtime.assistant(await service.auth.identity(service.credential("user1")));
    const offered = await service.registry.permitted(await service.auth.identity(service.credential("user1")), assistant);
    const business = offered.find((tool) => tool.name === "business_search")!;
    assert.equal(business.title, "业务检索（覆盖）", "模型看到的标题应使用覆盖值");
    assert.equal(business.description, "原生工具的覆盖描述", "模型看到的描述应使用覆盖值");
    assert.equal(business.name, "business_search", "权限与白名单仍按原 name");

    const cleared = await service.app.inject({ method: "PATCH", url: "/api/control/admin/tools/business_search/metadata", headers, payload: { title: "", description: "" } });
    assert.equal(cleared.statusCode, 200, cleared.body);
    const restored = await catalogItem(service, "business_search");
    assert.equal(restored?.title, "业务记录查询");
    assert.equal(restored?.description, "测试用只读业务工具，返回固定的业务记录。");
    assert.equal(service.store.settings().tool_overrides.business_search, undefined);

    assert.equal((await service.app.inject({ method: "PATCH", url: "/api/control/admin/tools/not_exists/metadata", headers, payload: { title: "x" } })).statusCode, 404);
    assert.equal((await service.app.inject({ method: "PATCH", url: "/api/control/admin/tools/business_search/metadata", headers, payload: { title: "x".repeat(81) } })).statusCode, 422);
    assert.equal((await service.app.inject({ method: "PATCH", url: "/api/control/admin/tools/business_search/metadata", headers, payload: { description: "x".repeat(501) } })).statusCode, 422);
  } finally { await service.close(); }
});

test("tool overrides reject unknown fields and cap the number of entries", async () => {
  const service = await fixture();
  try {
    const headers = await administrator(service);
    const unknownField = await service.app.inject({ method: "PATCH", url: "/api/control/admin/tools/business_search/metadata", headers, payload: { name: "renamed" } });
    assert.equal(unknownField.statusCode, 422);
    const empty = await service.app.inject({ method: "PATCH", url: "/api/control/admin/tools/business_search/metadata", headers, payload: {} });
    assert.equal(empty.statusCode, 422);

    const overrides: Row = {};
    for (let index = 0; index < 500; index++) overrides[`tool_${index}`] = { title: `标题 ${index}` };
    service.store.setSettings({ tool_overrides: overrides });
    const rejected = await service.app.inject({ method: "PATCH", url: "/api/control/admin/tools/business_search/metadata", headers, payload: { title: "第 501 条" } });
    assert.equal(rejected.statusCode, 422);
    assert.match(rejected.json().detail, /500/);
  } finally { await service.close(); }
});
