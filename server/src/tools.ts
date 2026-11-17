import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createHash } from "node:crypto";
import { config, envFlag } from "./config.js";
import { Auth } from "./auth.js";
import { Store } from "./store.js";
import { decrypt, safeUrl } from "./security.js";
import { limitedResponse } from "./providers.js";
import { createPiLocalDefinitions, piLocalTools, piLocalToolReason, runtimeToolNames } from "./pi-tools.js";
import { AppError, type ExecutionContext, type Identity, type Row, type ToolSpec } from "./types.js";

/** 覆盖只影响展示与模型提示，工具 name 始终作为权限、审计和白名单的唯一键。 */
function withMetadata<T extends { name: string; title?: string; description?: string }>(tool: T, overrides: Record<string, Row>): T {
  const override = overrides[tool.name];
  if (!override) return tool;
  return {
    ...tool,
    ...(override.title ? { title: String(override.title) } : {}),
    ...(override.description ? { description: String(override.description) } : {}),
  };
}

export class ToolRegistry {
  private native = new Map<string, ToolSpec>();
  constructor(private store: Store, private auth: Auth) {
    this.register({ name: "current_datetime", title: "当前日期时间", description: "获取当前实际日期、时间和星期，不依赖模型知识。", source: "builtin", category: "基础工具", permission: "", risk: "read", parameters: { type: "object", properties: { timezone: { type: "string", default: "Asia/Shanghai" } } }, execute: async (args) => ({ iso: new Date().toISOString(), local: new Intl.DateTimeFormat("zh-CN", { dateStyle: "full", timeStyle: "long", timeZone: args.timezone || "Asia/Shanghai" }).format(new Date()) }) });
    this.register({ name: "ask_user", title: "向用户提问", description: "当缺少必要信息或需要用户在多个方案中选择时，向用户提出一个清晰问题。必须提供可选项，可允许补充自由文本；禁止用它确认危险操作，危险操作使用审批卡。", source: "builtin", category: "框架交互工具", permission: "", risk: "read", parameters: { type: "object", properties: { question: { type: "string" }, description: { type: "string" }, options: { type: "array", items: { type: "object", properties: { label: { type: "string" }, value: { type: "string" }, description: { type: "string" } }, required: ["label", "value"] }, minItems: 1, maxItems: 12 }, selection: { type: "string", enum: ["single", "multiple"] }, allow_free_text: { type: "boolean" }, required: { type: "boolean" } }, required: ["question", "options"] }, execute: async () => ({ pending: true }) });
  }
  register(tool: ToolSpec) { if (!/^[A-Za-z0-9_-]{1,64}$/.test(tool.name) || this.native.has(tool.name) || runtimeToolNames.includes(tool.name)) throw new Error(`无效、保留或重复的工具名：${tool.name}`); this.native.set(tool.name, tool); }
  setting(tool: ToolSpec) {
    const policy = this.store.toolPolicy(tool.name);
    return tool.name === "ask_user" ? { ...policy, visible: false, selectable: false, default_selected: true } : policy;
  }
  localDeploymentEnabled() { return config.localTools === "admin"; }
  localToolEnabled(name: string) {
    return this.localDeploymentEnabled() && this.store.rawToolPolicy(name)?.enabled === true;
  }
  localToolDefinitions(cwd: string) {
    const overrides = this.store.config.toolOverrides();
    return createPiLocalDefinitions(cwd, new Set(piLocalTools.map(({ definition }) => definition.name).filter((name) => this.localToolEnabled(name))))
      .map((definition) => {
        const override = overrides[definition.name];
        return override ? {
          ...definition,
          ...(override.title ? { label: String(override.title) } : {}),
          ...(override.description ? { description: String(override.description) } : {}),
        } : definition;
      });
  }
  codemodeEnabled() { return this.localToolEnabled("codemode"); }
  async updateTags(name: string, tags: string[]) {
    const tool = (await this.catalog()).find((item) => item.name === name);
    if (!tool) throw new AppError("工具不存在", 404);
    const clean = [...new Set(tags.map((tag) => tag.trim()).filter((tag) => tag && tag.length <= 24))].slice(0, 12);
    this.store.setToolPolicy(name, { tags: clean });
    return (await this.catalog()).find((item) => item.name === name)!;
  }
  async updateMetadata(name: string, values: { title?: string; description?: string }) {
    const tool = (await this.catalog()).find((item) => item.name === name);
    if (!tool) throw new AppError("工具不存在", 404);
    for (const key of ["title", "description"] as const) {
      if (values[key] === undefined) continue;
      const text = String(values[key]).trim();
      const limit = key === "title" ? 80 : 500;
      if (text.length > limit) throw new AppError(`${key === "title" ? "名称" : "描述"}不能超过 ${limit} 个字符`, 422);
    }
    if (values.title === undefined && values.description === undefined) throw new AppError("没有可更新的字段", 422);
    this.store.config.setToolOverride(name, values);
    return (await this.catalog()).find((item) => item.name === name)!;
  }
  async catalog(): Promise<Row[]> {
    const overrides = this.store.config.toolOverrides();
    const entries = (await this.all(undefined, true)).map((tool) => {
      const { execute, available, ...definition } = tool;
      const ready = !available || available();
      const internal = tool.name === "ask_user";
      const saved = this.setting(tool);
      const sourceTag = tool.source === "pi" ? "原生" : tool.source === "builtin" ? "内置" : tool.source === "mcp" ? "MCP" : tool.source === "http" ? "API" : "业务";
      return { ...saved, tags: [...new Set([sourceTag, ...(saved.tags || [])])], ...definition, input_schema: tool.parameters, configured: ready, locked: false, blocked_reason: ready ? "" : "尚未配置或连接器已停用，不会提供给模型。", policy_editable: !internal, ...(internal ? { visible: false, selectable: false, default_selected: true, blocked_reason: "交互问答工具；只控制全局启用，不作为用户工具选项。" } : {}) };
    });
    const localOpen = this.localDeploymentEnabled();
    const localReason = localOpen ? "部署已开放本机工具；仍需在此逐项启用。没有沙箱，仅适合受信任单租户部署。" : "部署环境未开放本机工具（WEBAGENT_LOCAL_TOOLS=off）。后台可见但锁定，部署者设为 admin 后才能逐项启用。";
    const local = piLocalTools.map(({ definition, title, capability, risk }) => {
      const saved = this.store.rawToolPolicy(definition.name);
      const enabled = localOpen && saved?.enabled === true;
      return { name: definition.name, title, description: definition.description, input_schema: definition.parameters, source: "pi", category: "PI 官方内置", capability, risk, permission: "", tags: ["原生", "本机执行"], enabled, visible: false, selectable: false, default_selected: false, configured: localOpen, locked: !localOpen, blocked_reason: localReason, policy_editable: false };
    });
    const codemodeSaved = this.store.rawToolPolicy("codemode");
    const codemode = { name: "codemode", title: "CodeMode 脚本编排", description: "PI 官方代码编排扩展。启用后模型可编写并执行受限 VM 脚本，仍属于本机执行能力。", source: "pi", category: "PI 官方扩展", capability: "code", risk: "write", permission: "", tags: ["原生", "本机执行", "脚本"], enabled: localOpen && codemodeSaved?.enabled === true, visible: false, selectable: false, default_selected: false, configured: localOpen, locked: !localOpen, blocked_reason: localReason, policy_editable: false };
    const internal = [
      { name: "tool_search", title: "BM25 工具发现", source: "pi", category: "PI 官方扩展", enabled: Boolean(this.store.settings().bm25_enabled), description: "复用 PI 官方 tool-search，仅检索本轮已授权工具；在运行设置切换 BM25，允许与决策都关闭。" },
    ].map((tool) => {
      const saved = this.store.rawToolPolicy(tool.name);
      return { ...tool, tags: ["内置"], enabled: tool.name === "tool_search" ? tool.enabled : saved?.enabled !== false, visible: false, selectable: false, default_selected: true, risk: "read", permission: "", input_schema: {}, configured: true, locked: false, policy_editable: false, blocked_reason: tool.name === "tool_search" ? "由运行设置中的 BM25 开关控制。" : "内部知识加载工具；可全局停用，不出现在用户工具选择器。" };
    });
    return [...local, codemode, ...entries, ...internal].map((tool) => withMetadata(tool, overrides));
  }
  async updatePolicy(name: string, values: Row) {
    const tool = (await this.catalog()).find((item) => item.name === name);
    if (!tool) throw new AppError("工具不存在", 404);
    if (tool.locked && Object.values(values).some((value) => value === true)) throw new AppError(piLocalToolReason, 403);
    if (!tool.policy_editable && Object.keys(values).some((key) => key !== "enabled")) throw new AppError("该工具不支持用户选择策略", 422);
    if (name === "tool_search") {
      const settings = this.store.settings();
      const enabled = values.enabled ?? settings.bm25_enabled;
      if (enabled && settings.decision_enabled) throw new AppError("请先关闭决策模型；BM25 与决策不能同时启用，可以同时关闭", 422);
      this.store.setSettings({ bm25_enabled: enabled, tool_selection_mode: enabled ? "bm25" : settings.decision_enabled ? "decision" : "none" });
      return { ...tool, enabled };
    }
    if (name === "ask_user") {
      if (Object.keys(values).some((key) => key !== "enabled")) throw new AppError("交互问答工具只支持全局启用开关", 422);
      values = { enabled: values.enabled };
    }
    const policy = tool.locked ? { enabled: false, visible: false, selectable: false, default_selected: false } : values;
    this.store.setToolPolicy(name, policy);
    return (await this.catalog()).find((item) => item.name === name)!;
  }
  internalEnabled(name: "ask_user") { return this.store.toolPolicy(name).enabled !== false; }
  private dynamic(includeUnavailable = false): ToolSpec[] {
    return this.store.httpTools().filter((row) => includeUnavailable || row.enabled !== false).map((row) => ({ name: row.name, title: row.display_name || row.name, description: row.description, permission: row.permission, risk: row.risk, category: row.category, source: "http", parameters: row.input_schema, available: () => this.store.httpTool(Number(row.id))?.enabled !== false, execute: async (args, context) => {
      const fresh = this.store.httpTool(Number(row.id));
      if (!fresh || fresh.enabled === false) throw new AppError("HTTP 工具已停用", 403);
      const consumed = new Set<string>();
      const rawUrl = fresh.url_template.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, key: string) => { if (!(key in args)) throw new AppError(`缺少路径参数 ${key}`, 422); consumed.add(key); return encodeURIComponent(String(args[key])); });
      const target = safeUrl(rawUrl);
      const remainder = Object.fromEntries(Object.entries(args).filter(([key]) => !consumed.has(key)));
      const headers: Record<string, string> = { Accept: "application/json", "X-WebAgent-Source": "agent-tool" };
      for (const [name, value] of Object.entries(fresh.headers)) {
        if (["authorization", "host", "content-length", "cookie", "proxy-authorization"].includes(name.toLowerCase())) throw new AppError("HTTP 工具不能覆盖身份和传输请求头", 422);
        headers[name] = String(value).replaceAll("${user.id}", String(context.identity.id)).replaceAll("${session.id}", context.sessionId);
      }
      headers.Authorization = `Bearer ${context.credential}`;
      const read = ["GET", "DELETE"].includes(fresh.method);
      if (read) for (const [name, value] of Object.entries(remainder)) target.searchParams.set(name, typeof value === "object" ? JSON.stringify(value) : String(value));
      else headers["Content-Type"] = "application/json";
      const response = await fetch(target, { method: fresh.method, headers, body: read ? undefined : JSON.stringify(remainder), redirect: "error", signal: context.signal });
      const content = (await limitedResponse(response, 1000000)).toString("utf8");
      if (!response.ok) throw new AppError(`业务接口 HTTP ${response.status}：${content.slice(0, 300)}`, response.status);
      try { return JSON.parse(content); } catch { return content; }
    } }));
  }
  private async connect(server: Row, context?: ExecutionContext) {
    const options = server.config || {};
    const credentials = options.secret ? JSON.parse(decrypt(options.secret)) : {};
    const headers: Record<string, string> = { ...credentials.headers };
    if (context && options.forward_user_token) headers.Authorization = `Bearer ${context.credential}`;
    const client = new Client({ name: "webagent-pi", version: "2.0.0" });
    if (server.transport === "stdio") {
      if (!envFlag("WEBAGENT_ALLOW_STDIO")) throw new AppError("stdio MCP 需部署者显式开启 WEBAGENT_ALLOW_STDIO；管理端无法自行越过此限制", 403);
      if (!options.command || !Array.isArray(options.args || [])) throw new AppError("stdio command/args 配置无效", 422);
      try { await client.connect(new StdioClientTransport({ command: options.command, args: options.args || [], env: { PATH: process.env.PATH || "", ...credentials.env }, stderr: "pipe" }), { timeout: 12000, signal: context?.signal }); } catch (error) { await client.close().catch(() => {}); throw error; }
    } else {
      const url = safeUrl(options.url);
      try { await client.connect(server.transport === "sse" ? new SSEClientTransport(url, { requestInit: { headers } }) : new StreamableHTTPClientTransport(url, { requestInit: { headers } }), { timeout: 12000, signal: context?.signal }); } catch (error) { await client.close().catch(() => {}); throw error; }
    }
    return client;
  }
  async discoverServer(server: Row, context?: ExecutionContext) {
    const client = await this.connect(server, context);
    try {
      const entries: Row[] = []; let cursor: string | undefined;
      do { const page = await client.listTools({ cursor }, { timeout: 12000 }); entries.push(...page.tools); cursor = page.nextCursor; if (entries.length > 500) throw new AppError("MCP 工具数量超过限制", 422); } while (cursor);
      return entries;
    } finally { await client.close(); }
  }
  async all(context?: ExecutionContext, includeUnavailable = false): Promise<ToolSpec[]> {
    const overrides = this.store.config.toolOverrides();
    const tools = [...this.native.values()].filter((tool) => includeUnavailable || !tool.available || tool.available());
    tools.push(...this.dynamic(includeUnavailable));
    for (const server of this.store.mcpServers().filter((item) => item.enabled !== false)) {
      let entries = server.config.cached_tools || [];
      if (!entries.length) continue;
      for (const entry of entries) {
        const mapped = server.config.tool_policies?.[entry.name] || {};
        const metadata: Row = {};
        const description = String(entry.description || "").replace(/\[META\]([\s\S]*?)\[\/META\]/g, (_, text: string) => { for (const part of text.split(";")) { const [key, value] = part.split("="); if (value) metadata[key.trim()] = value.trim(); } return ""; });
        const permission = mapped.permission || metadata.permission;
        if (!permission && !mapped.public) continue;
        const prefix = `mcp_${server.id}_${entry.name}`.replace(/[^A-Za-z0-9_-]/g, "_");
        const name = prefix.length <= 64 ? prefix : `${prefix.slice(0, 53)}_${createHash("sha256").update(prefix).digest("hex").slice(0, 10)}`;
        tools.push({ name, title: entry.title || entry.name, description, permission: permission || "", risk: mapped.risk || metadata.risk || "write", category: server.name, source: "mcp", parameters: entry.inputSchema || { type: "object", properties: {} }, execute: async (args, execution) => {
          const fresh = this.store.mcpServer(Number(server.id));
          if (!fresh || fresh.enabled === false) throw new AppError("MCP 连接器已停用", 403);
          const client = await this.connect(fresh, execution);
          try { const result = await client.callTool({ name: entry.name, arguments: args }, undefined, { signal: execution.signal, timeout: 30000 }); if (result.isError) throw new AppError(JSON.stringify(result.content).slice(0, 500), 502); return result.structuredContent || result.content; } finally { await client.close(); }
        } });
      }
    }
    if (tools.some((tool) => runtimeToolNames.includes(tool.name)) || new Set(tools.map((tool) => tool.name)).size !== tools.length) throw new AppError("工具名称冲突或使用 PI 保留名称，请管理员调整连接器命名", 503);
    return tools.map((tool) => withMetadata(tool, overrides));
  }
  async permitted(identity: Identity, assistant: Row, requested?: string[]) {
    return (await this.all()).filter((tool) => {
      const policy = this.setting(tool);
      if (!policy.enabled || (tool.permission && !identity.permissions.includes(tool.permission)) || (assistant.tool_names?.length && !assistant.tool_names.includes(tool.name))) return false;
      if (tool.name === "ask_user") return this.internalEnabled("ask_user");
      if (!policy.visible || !policy.selectable) return Boolean(policy.default_selected);
      return requested ? requested.includes(tool.name) : policy.default_selected;
    });
  }
  async authorize(name: string, context: ExecutionContext) {
    const freshIdentity = await this.auth.revalidate(context.identity, context.credential);
    const tool = (await this.all()).find((candidate) => candidate.name === name);
    if (!tool) throw new AppError("工具已移除或尚未配置", 403);
    this.auth.permission(freshIdentity, tool.permission);
    const policy = this.setting(tool);
    if (!policy.enabled || (!policy.visible || !policy.selectable) && !policy.default_selected) throw new AppError("工具已停用", 403);
    const session = this.store.one("SELECT * FROM sessions WHERE id=?", [context.sessionId]);
    if (session) {
      if (session.owner_key !== freshIdentity.owner_key) throw new AppError("会话不属于当前用户", 403);
      const assistant = this.store.assistant(Number(session.assistant_id));
      const roles = Array.isArray(assistant?.allowed_roles) ? assistant!.allowed_roles : ["*"];
      const toolNames = Array.isArray(assistant?.tool_names) ? assistant!.tool_names : [];
      if (!assistant || assistant.enabled === false || !roles.some((role: string) => role === "*" || role === freshIdentity.role) || (toolNames.length && !toolNames.includes(name))) throw new AppError("助手当前已不允许使用该工具", 403);
    }
    context.signal.throwIfAborted();
    return { tool, identity: freshIdentity };
  }
  async execute(tool: ToolSpec, args: Row, context: ExecutionContext) {
    const authorized = await this.authorize(tool.name, context);
    if (authorized.tool.risk !== tool.risk && authorized.tool.risk !== "read") throw new AppError("工具风险配置已变化，请重新发起确认", 409);
    const freshIdentity = authorized.identity;
    const result = await authorized.tool.execute(args, { ...context, identity: freshIdentity });
    this.store.audit(freshIdentity.username, "tool.execute", tool.name, { risk: tool.risk, ok: true });
    return result;
  }
}
