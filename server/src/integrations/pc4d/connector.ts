import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { decrypt, encrypt, token } from "../../security.js";
import { limitedResponse } from "../../providers.js";
import { AppError, identityOwnerKey, type ExecutionContext, type IdentityAdapter, type IdentityInput, type Row, type ToolSpec } from "../../types.js";
import type { Store } from "../../store.js";

export type Pc4dChannel = "screen" | "web" | "miniprogram";
export interface Pc4dTool {
  name: string;
  title: string;
  description: string;
  path: string;
  channels: Pc4dChannel[];
  tags: string[];
  parameters: Row;
  enabled?: boolean;
  permission_alternatives?: { channel: Pc4dChannel; plugin: string; permission: string }[];
}
interface Credential { version: 1; channel: Pc4dChannel; pid: number; expires: number; access_token?: string; access_token_id?: number; project_name?: string }
interface BusinessContext { credential: Credential; user: Row; project: Row; rights: Row; subject: string }
export interface Pc4dOptions { baseUrl?: string; cloudUrl?: string; fetch?: typeof globalThis.fetch; tokenHours?: number; cacheSeconds?: number }

function externalAccount(user: Row): string {
  const raw = user.UID ?? user.uid ?? user.OpenID ?? user.openid;
  const id = raw === undefined || raw === null ? "" : String(raw).trim();
  if (id) return `用户 ${id}`;
  return "";
}

const channels: Pc4dChannel[] = ["screen", "web", "miniprogram"];
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const noArguments = { type: "object", properties: {}, additionalProperties: false };
const privateFields = /^(token|api_?key|access_?token|refresh_?token|authorization|cookie|password|secret|mobile|phone|camera_?info|gps_?guid|iot_?guid|model_?url)$/i;

function modelData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(modelData);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !privateFields.test(key)).map(([key, item]) => [key, modelData(item)]));
  if (typeof value === "string" && /(?:https?:\/\/|rtsp:\/\/)/i.test(value)) return "[已省略外部资源地址]";
  return value;
}

function queryArguments(parameters: Row, args: Row) {
  const properties = parameters.properties || {};
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new AppError("工具参数需要对象", 422);
  for (const key of Object.keys(args)) if (!Object.hasOwn(properties, key)) throw new AppError(`工具参数无效：${key}`, 422);
  const params: Row = {};
  for (const [key, schema] of Object.entries<Row>(properties)) {
    const value = args[key] ?? schema.default;
    if (value === undefined || value === null) {
      if (parameters.required?.includes(key)) throw new AppError(`缺少参数：${key}`, 422);
      continue;
    }
    if (["number", "integer"].includes(schema.type)) {
      if (typeof value !== "number" || !Number.isFinite(value) || schema.type === "integer" && !Number.isSafeInteger(value)) throw new AppError(`参数 ${key} 需要有效数字`, 422);
      if (schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum) throw new AppError(`参数 ${key} 超出允许范围`, 422);
    } else if (schema.type === "string") {
      if (typeof value !== "string" || value.length > Math.min(1000, schema.maxLength ?? 1000) || value.length < (schema.minLength ?? 0)) throw new AppError(`参数 ${key} 需要有效文本`, 422);
      if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) throw new AppError(`参数 ${key} 格式不符合要求`, 422);
    } else if (schema.type === "boolean") {
      if (typeof value !== "boolean") throw new AppError(`参数 ${key} 需要布尔值`, 422);
    } else throw new AppError(`工具参数 ${key} 尚未配置支持的查询类型`, 422);
    if (schema.enum && !schema.enum.includes(value)) throw new AppError(`参数 ${key} 不在允许选项中`, 422);
    if (parameters.required?.includes(key) && value === "") throw new AppError(`缺少参数：${key}`, 422);
    params[key] = value;
  }
  return params;
}

/** 业务接口返回的 Logo 可能是绝对地址、协议相对地址或站内路径，统一转成业务域下的 http(s) 地址。 */
function projectLogo(baseUrl: string, project: Row): string {
  const raw = project.ProjectLogo ?? project.Logo ?? project.ProjectImage ?? project.Image;
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return "";
  try {
    if (/^\/\//.test(value)) return `${new URL(baseUrl).protocol}${value}`;
    const url = new URL(value, baseUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
    return url.href;
  } catch {
    return "";
  }
}

export class Pc4dConnector implements IdentityAdapter {
  private cache = new Map<string, { value: BusinessContext; expires: number }>();
  private pending = new Map<string, Promise<BusinessContext>>();
  private fetcher: typeof globalThis.fetch;
  readonly baseUrl: string;
  readonly cloudUrl: string;
  readonly tokenHours: number;
  private cacheSeconds: number;
  private toolsFile: string;
  private catalogue?: { stamp: string; entries: Pc4dTool[] };

  constructor(private store: Store, private options: Pc4dOptions = {}) {
    this.baseUrl = (options.baseUrl || process.env.WEBAGENT_PC4D_BASE_URL || "https://cloud.4dbim.vip").replace(/\/$/, "");
    this.cloudUrl = (options.cloudUrl || this.baseUrl).replace(/\/$/, "");
    for (const value of [this.baseUrl, this.cloudUrl]) {
      const parsed = new URL(value);
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") throw new Error("PC4D 地址必须是 HTTP(S) 服务根地址");
    }
    this.fetcher = options.fetch || globalThis.fetch.bind(globalThis);
    this.tokenHours = Math.min(24, Math.max(1 / 60, Number(options.tokenHours ?? process.env.WEBAGENT_PC4D_TOKEN_HOURS) || 2));
    this.cacheSeconds = Math.min(60, Math.max(0, Number(options.cacheSeconds ?? process.env.WEBAGENT_PC4D_PERMISSION_CACHE_SECONDS ?? 10)));
    this.toolsFile = path.join(store.dataDir, "tools", "pc4d", "catalogue.json");
  }

  initialize(definitions: Pc4dTool[]) {
    fs.mkdirSync(path.dirname(this.toolsFile), { recursive: true });
    if (!fs.existsSync(this.toolsFile)) fs.writeFileSync(this.toolsFile, `${JSON.stringify(definitions, null, 2)}\n`, { mode: 0o600 });
    const tools = this.definitions();
    for (const tool of tools) if (!this.store.rawToolPolicy(tool.name)) this.store.setToolPolicy(tool.name, { enabled: tool.enabled !== false, visible: true, selectable: true, default_selected: true, tags: tool.tags });
    for (const channel of channels) {
      let assistant = this.store.assistants().find((item) => item.integration_channel === `pc4d:${channel}`);
      if (!assistant) assistant = this.store.config.insertAssistant({
        name: `PC4D · ${channel === "screen" ? "大屏" : channel === "web" ? "Web" : "小程序"}助手`,
        description: "PC4D 业务连接器；工具、模型、Skill 和提示词可在管理端单独维护。",
        integration_channel: `pc4d:${channel}`,
        system_prompt: "你是 PC4D 项目助手。使用已授权工具获取当前项目真实数据；业务身份和项目范围由服务端确定，不索取或输出登录 Token，不猜测数据。查询不到时说明数据范围。可按用户需求分析数据、制作 Markdown 表格或 Mermaid 图表。生成完整网页时使用 html 代码块。发布网页前询问标题、可见范围与可空密码，禁止自行生成密码。",
        allowed_roles: [channel === "screen" ? "pc4d_screen" : "pc4d_user"],
        tool_names: ["pc4d_current_project", ...tools.filter((tool) => tool.channels.includes(channel)).map((tool) => tool.name), "current_datetime", "ask_user", "pagepilot_publish_html", "pagepilot_list_my_pages"],
        default_approval_mode: channel === "screen" ? "full_access" : "confirm",
        welcome_title: "你好，今天想了解什么？",
        welcome_subtitle: "可以查生产、进度、质量和安全数据，也可以生成报告或发布页面。",
        welcome_prompts: "今天的生产情况怎么样？|查看当日产量、进度与异常\n汇总项目进度和异常|梳理风险点与处理优先级\n帮我生成一份项目分析报告|汇总指标并生成可发布页面\n查看质量与安全告警|定位需要优先处理的问题",
        sort_order: 200,
      });
      if (!assistant.welcome_title) this.store.config.updateAssistant(Number(assistant.id), {
        welcome_title: "你好，今天想了解什么？",
        welcome_subtitle: "可以查生产、进度、质量和安全数据，也可以生成报告或发布页面。",
        welcome_prompts: "今天的生产情况怎么样？|查看当日产量、进度与异常\n汇总项目进度和异常|梳理风险点与处理优先级\n帮我生成一份项目分析报告|汇总指标并生成可发布页面\n查看质量与安全告警|定位需要优先处理的问题",
      });
      // 渠道固定绑定到一个接入 Token；Token 再决定助手。浏览器永远拿不到 wa_ 原文，
      // pc4d_ 短期凭据只携带 access_token_id，每次请求重新校验 Token 状态。
      const bound = this.store.one("SELECT id FROM access_tokens WHERE channel=? ORDER BY id LIMIT 1", [channel]);
      if (!bound) {
        const raw = `wa_${token()}`;
        this.store.insert("access_tokens", {
          name: `PC4D · ${channel === "screen" ? "大屏" : channel === "web" ? "Web" : "小程序"}接入`,
          token_hash: digest(raw), token_prefix: raw.slice(0, 12), token_cipher: encrypt(raw),
          assistant_id: assistant.id, channel, enabled: true, allowed_origins: "[]",
          rate_limit_per_minute: 0, daily_token_limit: 0, session_retention_days: 0, created_by: "system",
        });
      }
    }
    if (!this.store.rawToolPolicy("pc4d_current_project")) this.store.setToolPolicy("pc4d_current_project", { enabled: true, visible: false, selectable: false, default_selected: true, tags: ["PC4D", "项目上下文"] });
  }

  definitions(): Pc4dTool[] {
    const stat = fs.statSync(this.toolsFile, { bigint: true });
    const stamp = `${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
    if (this.catalogue?.stamp === stamp) return this.catalogue.entries;
    const entries: Pc4dTool[] = JSON.parse(fs.readFileSync(this.toolsFile, "utf8"));
    if (!Array.isArray(entries) || entries.length > 500) throw new Error("PC4D 工具目录格式无效");
    const names = new Set<string>();
    for (const entry of entries) {
      if (!/^pc4d_[a-z0-9_]{1,57}$/.test(entry.name) || names.has(entry.name) || !/^\/pc\/api\/[A-Za-z0-9_/-]+$/.test(entry.path) || !entry.channels?.length || entry.channels.some((channel) => !channels.includes(channel))) throw new Error(`PC4D 工具定义无效：${entry.name}`);
      names.add(entry.name);
      if (Object.keys(entry.parameters?.properties || {}).some((name) => /^(pid|project_id|access_token|token|url|host|authorization)$/i.test(name))) throw new Error(`PC4D 工具不允许模型填写身份、PID 或地址：${entry.name}`);
      if (entry.channels.includes("screen") && !/^\/pc\/api\/(screen|beam-screen)\//.test(entry.path)) throw new Error(`大屏工具必须属于已审核的数据大屏接口：${entry.name}`);
    }
    this.catalogue = { stamp, entries };
    return entries;
  }

  private decode(raw: string): Credential {
    if (!raw.startsWith("pc4d_")) throw new AppError("请从业务系统重新打开 AI 助手", 401);
    let credential: Credential;
    try { credential = JSON.parse(decrypt(`enc:v2:${raw.slice(5)}`)); } catch { throw new AppError("业务接入凭据无效", 401); }
    if (credential.version !== 1 || !channels.includes(credential.channel) || !Number.isSafeInteger(credential.pid) || credential.pid < 1 || !Number.isFinite(credential.expires) || credential.expires <= Date.now()) throw new AppError("业务接入已过期，请重新连接", 401);
    if (credential.channel !== "screen" && (typeof credential.access_token !== "string" || !credential.access_token)) throw new AppError("缺少业务登录凭据", 401);
    if (!Number.isSafeInteger(credential.access_token_id) || Number(credential.access_token_id) < 1) throw new AppError("业务接入凭据缺少 Token 绑定，请重新打开 AI 助手", 401);
    return credential;
  }

  /** 渠道当前启用的接入 Token；Token 决定助手和权限边界。 */
  private channelToken(channel: Pc4dChannel) {
    return this.store.one("SELECT * FROM access_tokens WHERE channel=? AND enabled=1 AND (expires_at IS NULL OR expires_at>?) ORDER BY updated_at DESC,id DESC LIMIT 1", [channel, new Date().toISOString()]);
  }

  private credentialToken(credential: Credential) {
    const row = this.store.one("SELECT * FROM access_tokens WHERE id=? AND enabled=1", [Number(credential.access_token_id)]);
    if (!row) throw new AppError("PC4D 接入 Token 已停用或删除，请联系管理员", 401);
    if (row.expires_at && row.expires_at <= new Date().toISOString()) throw new AppError("PC4D 接入 Token 已过期，请联系管理员", 401);
    return row;
  }

  private async request(route: string, params: Row, signal?: AbortSignal, cloud = false): Promise<Row> {
    const target = new URL(route, cloud ? this.cloudUrl : this.baseUrl);
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) target.searchParams.set(key, String(value));
    const timeout = AbortSignal.timeout(20000);
    let response: Response;
    try { response = await this.fetcher(target, { headers: { Accept: "application/json" }, redirect: "error", signal: signal ? AbortSignal.any([signal, timeout]) : timeout }); }
    catch (error) { if (signal?.aborted) throw error; throw new AppError("PC4D 业务接口连接超时或不可用", 502); }
    let result: Row;
    try { result = JSON.parse((await limitedResponse(response, 2000000)).toString("utf8")); } catch { throw new AppError("PC4D 业务接口未返回有效 JSON", 502); }
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new AppError("PC4D 业务接口返回格式无效", 502);
    const businessCode = Number(result.code);
    if (!response.ok || result.Success === false || (result.code !== undefined && businessCode !== 0)) {
      const denied = [401, 403].includes(response.status) || [4, 5, 10, 11, 12].includes(businessCode);
      throw new AppError(denied ? "业务登录已失效或无权访问当前项目" : `PC4D 接口返回错误（${result.code ?? response.status}），请检查业务服务`, denied ? 401 : 502);
    }
    return cloud ? result.Data ?? {} : result.data ?? {};
  }

  private async load(credential: Credential): Promise<BusinessContext> {
    if (credential.channel === "screen") {
      const metadata: Row = await this.request("/pc/api/screen/transportation/project-info", { pid: credential.pid }).catch(() => ({}));
      const logo = projectLogo(this.baseUrl, metadata);
      return { credential, user: { RealName: "项目大屏" }, project: { id: credential.pid, name: metadata.ProjectName || credential.project_name || `项目 ${credential.pid}`, ...(logo ? { logo } : {}) }, rights: {}, subject: `screen-project-${credential.pid}` };
    }
    const params = { access_token: credential.access_token, pid: credential.pid };
    const [info, rights] = await Promise.all([this.request("/pc/api/user/info", params), this.request("/pc/api/user/permission", params)]);
    const project = Array.isArray(info.project) ? info.project.find((item: Row) => Number(item.ID) === credential.pid) : info.project;
    const user = Array.isArray(info.user) ? info.user.find((item: Row) => Number(item.ProjectID) === credential.pid) : info.user;
    if (!project || Number(project.ID) !== credential.pid || !user || (user.ProjectID !== undefined && Number(user.ProjectID) !== credential.pid)) throw new AppError("业务账号不属于所选项目", 403);
    const verifiedSubject = user.UID || user.uid || user.Mobile;
    if (!verifiedSubject) throw new AppError("业务服务未返回可验证的稳定用户标识", 403);
    if (!["module", "plugin", "permission", "projectPlugin"].every((name) => Array.isArray(rights[name]))) throw new AppError("业务服务未返回完整的项目功能与权限清单", 502);
    const logo = projectLogo(this.baseUrl, project);
    return { credential, user, project: { id: credential.pid, name: project.Name || `项目 ${credential.pid}`, ...(logo ? { logo } : {}) }, rights, subject: `user-${digest(String(verifiedSubject)).slice(0, 32)}` };
  }

  private context(raw: string, force = false): Promise<BusinessContext> {
    const credential = this.decode(raw);
    const key = digest(raw);
    const hit = this.cache.get(key);
    if (!force && hit && hit.expires > Date.now()) return Promise.resolve(hit.value);
    const existing = this.pending.get(key);
    if (existing) return existing;
    const pending = this.load(credential).then((value) => {
      if (this.cache.size > 2000) for (const [stored, item] of this.cache) if (item.expires <= Date.now()) this.cache.delete(stored);
      if (this.cache.size >= 5000) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, { value, expires: Math.min(credential.expires, Date.now() + this.cacheSeconds * 1000) });
      return value;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, pending);
    return pending;
  }

  private permits(tool: Pc4dTool, context: BusinessContext) {
    if (tool.enabled === false || !tool.channels.includes(context.credential.channel)) return false;
    if (context.credential.channel === "screen") return true;
    return (tool.permission_alternatives || []).some((rule) => rule.channel === context.credential.channel && context.rights.plugin.includes(rule.plugin) && context.rights.projectPlugin.includes(rule.plugin) && context.rights.permission.includes(rule.permission));
  }

  async resolve(raw: string): Promise<IdentityInput | null> {
    if (!raw.startsWith("pc4d_")) return null;
    const context = await this.context(raw);
    const channel = context.credential.channel;
    const token = this.credentialToken(context.credential);
    const assistantId = Number(token.assistant_id);
    if (channel !== "screen") {
      const allowed = [...new Set(["web", "miniprogram"].map((item) => this.channelToken(item as Pc4dChannel)?.assistant_id).filter(Boolean).map(Number))];
      if (allowed.length) return {
        subject: context.subject,
        namespace: `pc4d:project:${context.credential.pid}`,
        username: `${context.project.name} · ${[context.user.RealName || "业务用户", externalAccount(context.user)].filter(Boolean).join(" · ")} · PID ${context.credential.pid}`,
        display_name: context.user.RealName || "业务用户",
        role: "pc4d_user",
        is_admin: false,
        allowed_assistant_ids: allowed,
        default_assistant_id: assistantId,
        permissions: ["pc4d:context", ...this.definitions().filter((tool) => this.permits(tool, context)).map((tool) => `pc4d:tool:${tool.name}`)],
      };
    }
    const account = channel === "screen" ? "项目大屏" : [context.user.RealName || "业务用户", externalAccount(context.user)].filter(Boolean).join(" · ");
    return {
      subject: context.subject,
      namespace: `pc4d:screen:${context.credential.pid}`,
      username: `${context.project.name} · ${account} · PID ${context.credential.pid}`,
      display_name: context.user.RealName || "业务用户",
      role: "pc4d_screen",
      is_admin: false,
      assistant_id: assistantId,
      permissions: ["pc4d:context", ...this.definitions().filter((tool) => this.permits(tool, context)).map((tool) => `pc4d:tool:${tool.name}`)],
    };
  }

  async exchange(input: { channel: Pc4dChannel; pid: number; access_token?: string; project_name?: string; access_token_id: number; assistant_id: number }) {
    const bound = { id: Number(input.access_token_id), assistant_id: Number(input.assistant_id) };
    if (!Number.isSafeInteger(bound.id) || bound.id < 1 || !this.store.assistant(bound.assistant_id)) throw new AppError("PC4D 接入 Token 绑定的助手不存在", 503);
    const credential: Credential = { version: 1, channel: input.channel, pid: input.pid, access_token_id: bound.id, expires: Date.now() + this.tokenHours * 3600000, ...(input.channel === "screen" ? { project_name: input.project_name?.slice(0, 120) } : { access_token: input.access_token }) };
    const raw = `pc4d_${encrypt(JSON.stringify(credential)).slice(7)}`;
    const user = await this.resolve(raw);
    const context = await this.context(raw);
    return { token: raw, expires_at: new Date(credential.expires).toISOString(), user, project: context.project, assistant_id: bound.assistant_id, capabilities: { history: true, publications: true, project_shared: input.channel === "screen" } };
  }

  tools(): ToolSpec[] {
    const contextual: ToolSpec = { name: "pc4d_current_project", title: "当前项目", description: "读取服务端核验的当前项目名称、端类型及数据范围。PID 由服务端绑定，无需用户填写。", source: "native", category: "PC4D", permission: "pc4d:context", risk: "read", parameters: noArguments, execute: async (_args, execution) => { const current = await this.context(execution.credential); return { project: current.project, channel: current.credential.channel, user: current.user.RealName || "项目大屏" }; } };
    return [contextual, ...this.definitions().map((entry): ToolSpec => ({ name: entry.name, title: entry.title, description: `${entry.description} 数据范围为当前绑定项目，禁止猜测没有返回的数据。`, source: "native", category: entry.tags.includes("大屏数据") ? "大屏数据" : "PC4D 业务", permission: `pc4d:tool:${entry.name}`, risk: "read", parameters: entry.parameters, available: () => this.definitions().some((item) => item.name === entry.name && item.enabled !== false), execute: (args, execution) => this.execute(entry.name, args, execution) }))];
  }

  private async execute(name: string, args: Row, execution: ExecutionContext) {
    const tool = this.definitions().find((entry) => entry.name === name);
    const context = await this.context(execution.credential, this.decode(execution.credential).channel !== "screen");
    if (!tool || !this.permits(tool, context)) throw new AppError("当前项目功能或用户权限不允许使用该工具", 403);
    const owner = identityOwnerKey(context.subject, `pc4d:${context.credential.channel === "screen" ? "screen" : "project"}:${context.credential.pid}`);
    if (execution.identity.owner_key !== owner) throw new AppError("业务项目或身份已变化，请新建会话", 403);
    const params = queryArguments(tool.parameters, args);
    const result = await this.request(tool.path, { ...params, pid: context.credential.pid, ...(context.credential.channel === "screen" ? {} : { access_token: context.credential.access_token }) }, execution.signal);
    return { project: context.project, data: modelData(result) };
  }
}
