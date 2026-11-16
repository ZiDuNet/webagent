import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { randomBytes } from "node:crypto";
import { config } from "./config.js";
import { digest, token, verifyPassword, hashPassword } from "./security.js";
import { now, Store } from "./store.js";
import { AppError, identityOwnerKey, type Identity, type IdentityAdapter, type Row } from "./types.js";

export const VISITOR_COOKIE = "wa_visitor";
export const ACCESS_COOKIE = "wa_access_session";
export type AgentMode = "business" | "token";
export interface AgentAuthContext {
  identity: Identity;
  credential: string;
  mode: AgentMode;
  access?: { token_id: number; token_name: string; fixed_assistant_id: number; expires_at?: string | null };
}

export function parseCookies(header = "") {
  const result: Record<string, string> = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    try { result[key] = decodeURIComponent(part.slice(index + 1).trim()); } catch { result[key] = part.slice(index + 1).trim(); }
  }
  return result;
}

export class Auth {
  private failures = new Map<string, { count: number; until: number }>();
  private accessRate = new Map<string, { count: number; reset: number }>();
  constructor(public store: Store, private adapter?: IdentityAdapter) {}
  credential(request: FastifyRequest) { return request.headers.authorization?.replace(/^Bearer\s+/i, "") || request.cookies.wa_session || ""; }
  private bearer(request: FastifyRequest) { return String(request.headers.authorization || "").replace(/^Bearer\s+/i, "").trim(); }
  private origin(request: FastifyRequest) { return typeof request.headers.origin === "string" ? request.headers.origin : ""; }
  private controlTokenRow(raw: string) {
    if (!raw) return undefined;
    return this.store.one("SELECT * FROM control_tokens WHERE token_hash=?", [digest(raw)]);
  }
  private assertControlToken(row: Row, origin: string) {
    if (!row.enabled) throw new AppError("管理 Token 已停用", 401);
    if (row.expires_at && row.expires_at <= now()) throw new AppError("管理 Token 已过期", 401);
    const allowed = Array.isArray(row.allowed_origins) ? row.allowed_origins.map(String).filter(Boolean) : [];
    if (allowed.length && !allowed.includes("*") && origin && !allowed.includes(origin)) throw new AppError("当前来源不在管理 Token 的允许列表中", 403);
  }
  controlCors(request: FastifyRequest, reply: FastifyReply) {
    if (!request.url.startsWith("/api/control") || !request.headers.origin) return;
    const raw = this.bearer(request);
    if (!raw) return;
    const row = this.controlTokenRow(raw);
    if (!row) return;
    const allowed = Array.isArray(row.allowed_origins) ? row.allowed_origins.map(String).filter(Boolean) : [];
    const origin = this.origin(request);
    if (!allowed.includes("*") && !allowed.includes(origin)) return;
    reply.header("Access-Control-Allow-Origin", allowed.includes("*") ? "*" : origin);
    reply.header("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept");
    reply.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    reply.header("Vary", "Origin");
  }
  private accessRowByToken(raw: string): Row | undefined {
    if (!raw) return undefined;
    const row = this.store.one("SELECT * FROM access_tokens WHERE token_hash=?", [digest(raw)]);
    return row ? { ...row, assistant_name: String(this.store.assistant(Number(row.assistant_id))?.name || "") } : undefined;
  }
  private accessRowBySession(raw: string): Row | undefined {
    if (!raw) return undefined;
    const row = this.store.one("SELECT t.*,s.visitor_id,s.expires_at AS session_expires_at FROM access_sessions s JOIN access_tokens t ON t.id=s.access_token_id WHERE s.session_hash=? AND s.expires_at>?", [digest(raw), now()]);
    return row ? { ...row, assistant_name: String(this.store.assistant(Number(row.assistant_id))?.name || "") } : undefined;
  }
  private assertAccess(row: Row, origin: string) {
    if (!row.enabled) throw new AppError("接入 Token 已停用", 401);
    if (row.expires_at && row.expires_at <= now()) throw new AppError("接入 Token 已过期", 401);
    const allowed = Array.isArray(row.allowed_origins) ? row.allowed_origins.map(String).filter(Boolean) : [];
    if (allowed.length && !allowed.includes("*") && origin && !allowed.includes(origin)) throw new AppError("当前来源不在接入 Token 的允许列表中", 403);
  }
  private identityForAccess(row: Row, visitor: string): Identity {
    const subject = `visitor-${visitor}`;
    return {
      subject,
      namespace: `token-${row.id}`,
      owner_key: identityOwnerKey(subject, `token-${row.id}`),
      username: `访客 · ${row.name}`,
      display_name: `${row.name} · 匿名访客`,
      role: "guest",
      permissions: [],
      is_admin: false,
      access_token_id: row.id,
      access_token_name: row.name,
      assistant_id: row.assistant_id,
      daily_token_limit: Number(row.daily_token_limit || 0),
      auth_mode: "token",
    };
  }
  private rateLimit(row: Row, visitor: string) {
    const limit = Number(row.rate_limit_per_minute || 0);
    if (!limit) return;
    const key = `${row.id}:${visitor}`;
    const current = Date.now();
    const entry = this.accessRate.get(key);
    if (!entry || entry.reset <= current) { this.accessRate.set(key, { count: 1, reset: current + 60000 }); return; }
    if (++entry.count > limit) throw new AppError("接入访问过于频繁，请稍后重试", 429);
    if (this.accessRate.size > 5000) for (const [stored, value] of this.accessRate) if (value.reset <= current) this.accessRate.delete(stored);
  }
  private touch(row: Row) { this.store.run("UPDATE access_tokens SET last_used_at=? WHERE id=?", [now(), row.id]); }
  private setVisitorCookie(reply: FastifyReply | undefined, visitor: string) {
    if (!reply) return;
    reply.setCookie(VISITOR_COOKIE, visitor, { httpOnly: true, sameSite: "lax", secure: config.cookieSecure, path: "/", maxAge: 365 * 24 * 3600 });
  }
  private accessContext(row: Row, visitor: string, credential: string): AgentAuthContext {
    return {
      identity: this.identityForAccess(row, visitor),
      credential,
      mode: "token",
      access: { token_id: row.id, token_name: row.name, fixed_assistant_id: row.assistant_id, expires_at: row.expires_at || null },
    };
  }
  async agent(request: FastifyRequest, reply?: FastifyReply): Promise<AgentAuthContext> {
    const bearer = this.bearer(request);
    const origin = this.origin(request);
    if (bearer) {
      const access = this.accessRowByToken(bearer);
      if (access) {
        this.assertAccess(access, origin);
        const visitor = request.cookies[VISITOR_COOKIE] || randomBytes(24).toString("base64url");
        this.rateLimit(access, visitor);
        this.touch(access);
        this.setVisitorCookie(reply, visitor);
        return this.accessContext(access, visitor, bearer);
      }
    }
    const sessionCredential = request.cookies[ACCESS_COOKIE] || "";
    if (sessionCredential) {
      const access = this.accessRowBySession(sessionCredential);
      if (!access) throw new AppError("接入会话已失效，请重新使用 Token 启动 Chat", 401);
      this.assertAccess(access, origin);
      this.rateLimit(access, access.visitor_id);
      this.touch(access);
      return this.accessContext(access, access.visitor_id, sessionCredential);
    }
    const credential = this.credential(request);
    const identity = await this.identity(credential);
    return { identity: { ...identity, auth_mode: "business" }, credential, mode: "business" };
  }
  async agentFromNode(headers: Record<string, string | string[] | undefined>, cookies: Record<string, string> = {}): Promise<AgentAuthContext> {
    const header = (name: string) => String(Array.isArray(headers[name]) ? headers[name]?.[0] : headers[name] || "");
    const bearer = header("authorization").replace(/^Bearer\s+/i, "").trim();
    const origin = header("origin");
    if (bearer) {
      const access = this.accessRowByToken(bearer);
      if (access) {
        this.assertAccess(access, origin);
        const visitor = cookies[VISITOR_COOKIE] || randomBytes(24).toString("base64url");
        this.rateLimit(access, visitor);
        this.touch(access);
        return this.accessContext(access, visitor, bearer);
      }
    }
    const accessSession = cookies[ACCESS_COOKIE] || "";
    if (accessSession) {
      const access = this.accessRowBySession(accessSession);
      if (!access) throw new AppError("接入会话已失效，请重新使用 Token 启动 Chat", 401);
      this.assertAccess(access, origin);
      this.rateLimit(access, access.visitor_id);
      this.touch(access);
      return this.accessContext(access, access.visitor_id, accessSession);
    }
    const credential = bearer || cookies.wa_session || "";
    const identity = await this.identity(credential);
    return { identity: { ...identity, auth_mode: "business" }, credential, mode: "business" };
  }
  async revalidate(identity: Identity, credential: string) {
    if (!identity.access_token_id) return this.identity(credential);
    const row = this.store.one("SELECT * FROM access_tokens WHERE id=?", [identity.access_token_id]);
    if (!row) throw new AppError("接入 Token 已删除", 401);
    this.assertAccess(row, "");
    return identity;
  }
  fixedAssistant(user: Identity) { return user.assistant_id ?? null; }
  async identity(credential: string): Promise<Identity> {
    if (!credential) throw new AppError("请先通过业务系统登录，或使用接入 Token 打开 Chat", 401);
    if (!this.adapter) throw new AppError("尚未配置业务身份适配器。请在嵌入时注册 identityAdapter，或使用 /chat/?token=… 接入 Token。", 401);
    const identity = await this.adapter.resolve(credential);
    if (!identity) throw new AppError("业务登录已失效", 401);
    const subject = String(identity.subject || (identity.id !== undefined ? `user-${identity.id}` : `login-${digest(credential).slice(0, 32)}`));
    const namespace = identity.namespace ? String(identity.namespace) : undefined;
    return { ...identity, id: identity.id === undefined ? undefined : Number(identity.id), subject, namespace, owner_key: identityOwnerKey(subject, namespace), username: identity.username || subject, permissions: identity.permissions || [], role: identity.role || "user", is_admin: Boolean(identity.is_admin), auth_mode: "business" };
  }
  user(request: FastifyRequest) { return this.identity(this.credential(request)); }
  admin(request: FastifyRequest) {
    const bearer = this.bearer(request);
    if (bearer) {
      const token = this.controlTokenRow(bearer);
      if (!token) throw new AppError("管理 Token 无效", 401);
      this.assertControlToken(token, this.origin(request));
      this.store.run("UPDATE control_tokens SET last_used_at=? WHERE id=?", [now(), token.id]);
      return { id: 0, username: `管理令牌 · ${token.name}`, role: "control_admin", via_token: true, token_id: token.id };
    }
    const credential = request.cookies.wa_control || "";
    const row = this.store.one("SELECT u.* FROM control_sessions s JOIN control_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?", [digest(credential), now()]);
    if (!row) throw new AppError("请登录独立管理端；业务账号不具有框架管理权限", 401);
    return { id: row.id, username: row.username, role: "control_admin", via_token: false };
  }
  permission(identity: Identity, permission: string) { if (permission && !identity.permissions.includes(permission)) throw new AppError(`当前业务账号缺少权限：${permission}`, 403); }
  async exchangeAccessToken(request: FastifyRequest, reply: FastifyReply) {
    const raw = this.bearer(request);
    const access = this.accessRowByToken(raw);
    if (!access) throw new AppError("接入 Token 无效", 401);
    this.assertAccess(access, this.origin(request));
    const visitor = request.cookies[VISITOR_COOKIE] || randomBytes(24).toString("base64url");
    this.rateLimit(access, visitor);
    const session = token();
    const expires = new Date(Date.now() + 7 * 86400000);
    this.store.run("INSERT INTO access_sessions(session_hash,access_token_id,visitor_id,expires_at,created_at) VALUES (?,?,?,?,?)", [digest(session), access.id, visitor, expires.toISOString(), now()]);
    this.store.run("DELETE FROM access_sessions WHERE expires_at < ?", [now()]);
    this.touch(access);
    this.setVisitorCookie(reply, visitor);
    reply.setCookie(ACCESS_COOKIE, session, { httpOnly: true, sameSite: "lax", secure: config.cookieSecure, path: "/api/agent", expires });
    const context = this.accessContext(access, visitor, session);
    return {
      user: context.identity,
      access: { mode: "token", fixed_assistant_id: access.assistant_id, token_name: access.name, expires_at: expires.toISOString() },
    };
  }
  /** 管理端独立登录：只查询 control_users，与业务账号完全分离。 */
  async login(request: FastifyRequest, reply: FastifyReply) {
    const body = request.body as Row;
    if (typeof body?.username !== "string" || typeof body?.password !== "string" || body.username.length > 100 || body.password.length > 500) throw new AppError("请输入有效的账号密码", 422);
    const key = `control:${request.ip}`;
    const failure = this.failures.get(key);
    if (failure && failure.until > Date.now() && failure.count >= 10) throw new AppError("登录尝试过多，请稍后再试", 429);
    if (this.failures.size > 10000) for (const [storedKey, item] of this.failures) if (item.until < Date.now()) this.failures.delete(storedKey);
    const row = this.store.one("SELECT * FROM control_users WHERE username=?", [body.username.trim()]);
    const valid = await verifyPassword(body.password, row?.password_hash || "pbkdf2_sha256$240000$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000");
    if (!row || !valid) {
      this.failures.set(key, { count: failure && failure.until > Date.now() ? failure.count + 1 : 1, until: Date.now() + 60000 });
      throw new AppError("账号或密码错误", 401);
    }
    this.failures.delete(key);
    const credential = token();
    const expires = new Date(Date.now() + config.sessionHours * 3600000);
    this.store.run("INSERT INTO control_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)", [digest(credential), row.id, expires.toISOString()]);
    reply.setCookie("wa_control", credential, { httpOnly: true, sameSite: "strict", secure: config.cookieSecure, path: "/api/control", expires });
    this.store.audit(row.username, "control.login", "auth");
    return { user: { id: row.id, username: row.username, role: "control_admin" } };
  }
  routes(app: FastifyInstance) {
    app.post("/api/agent/auth/exchange", (request, reply) => this.exchangeAccessToken(request, reply));
    app.post("/api/agent/auth/logout", async (request, reply) => {
      const raw = request.cookies[ACCESS_COOKIE] || "";
      if (raw) this.store.run("DELETE FROM access_sessions WHERE session_hash=?", [digest(raw)]);
      reply.clearCookie(ACCESS_COOKIE, { path: "/api/agent" });
      reply.clearCookie(VISITOR_COOKIE, { path: "/" });
      return { ok: true };
    });
    app.get("/api/agent/me", async (request, reply) => {
      const context = await this.agent(request, reply);
      return {
        user: context.identity,
        access: context.mode === "token" ? {
          mode: "token",
          fixed_assistant_id: context.access?.fixed_assistant_id,
          token_name: context.access?.token_name,
          expires_at: context.access?.expires_at,
        } : { mode: "business", fixed_assistant_id: null },
      };
    });
    app.post("/api/control/auth/login", (request, reply) => this.login(request, reply));
    app.options("/api/control/*", async (request, reply) => {
      const origin = this.origin(request);
      if (origin) {
        reply.header("Access-Control-Allow-Origin", origin);
        reply.header("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept");
        reply.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
        reply.header("Access-Control-Max-Age", "600");
        reply.header("Vary", "Origin");
      }
      return reply.code(204).send();
    });
    app.get("/api/control/auth/me", async (request) => ({ user: this.admin(request) }));
    app.post("/api/control/auth/logout", async (request, reply) => {
      this.store.run("DELETE FROM control_sessions WHERE token_hash=?", [digest(request.cookies.wa_control || "")]);
      reply.clearCookie("wa_control", { path: "/api/control" }); return { ok: true };
    });
    app.put("/api/control/auth/password", async (request, reply) => {
      const user = this.admin(request);
      if (user.via_token) throw new AppError("管理 Token 不能修改管理密码，请使用管理员账号登录", 403);
      const body = request.body as Row;
      const row = this.store.one("SELECT * FROM control_users WHERE id=?", [user.id])!;
      if (!await verifyPassword(body?.current_password || "", row.password_hash)) throw new AppError("当前密码错误", 403);
      if (typeof body?.password !== "string" || body.password.length < 12 || body.password.length > 200) throw new AppError("新密码需要 12–200 个字符", 422);
      const encoded = await hashPassword(body.password);
      this.store.transaction(() => { this.store.update("control_users", user.id, { password_hash: encoded }); this.store.run("DELETE FROM control_sessions WHERE user_id=?", [user.id]); });
      reply.clearCookie("wa_control", { path: "/api/control" }); return { ok: true };
    });
  }
}
