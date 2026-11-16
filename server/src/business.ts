import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Auth, publicUser } from "./auth.js";
import { Store } from "./store.js";
import { AppError, type ExecutionContext, type Row, type ToolSpec } from "./types.js";

const deviceSchema = z.object({ name: z.string().trim().min(1).max(100), device_type: z.string().trim().min(1).max(80), serial_no: z.string().trim().min(1).max(100), location: z.string().max(200).default(""), status: z.enum(["在线", "离线", "维护中"]).default("在线"), owner: z.string().max(100).default(""), remark: z.string().max(2000).default("") });
export class DemoBusiness {
  constructor(private store: Store, private auth: Auth) {}
  device(id: number) { const result = this.store.one("SELECT * FROM devices WHERE id=?", [id], true); if (!result) throw new AppError("设备不存在", 404); return result; }
  execute(action: string, args: Row, context: ExecutionContext): unknown {
    const identity = context.identity;
    const permissions: Row = { profile: "profile:read", list: "device:read", get: "device:read", stats: "device:read", create: "device:create", update: "device:update", delete: "device:delete", users: "user:manage" };
    this.auth.permission(identity, permissions[action]);
    if (action === "profile") return { user: identity };
    if (action === "list") {
      const clauses = ["1=1"]; const values: any[] = [];
      if (args.q || args.keyword) { clauses.push("(name LIKE ? OR serial_no LIKE ? OR location LIKE ?)"); values.push(...Array(3).fill(`%${args.q || args.keyword}%`)); }
      if (args.status) { clauses.push("status=?"); values.push(args.status); }
      const where = clauses.join(" AND "); const limit = Math.min(200, Math.max(1, Number(args.limit) || 50)); const offset = Math.max(0, Number(args.offset) || 0);
      return { items: this.store.all(`SELECT * FROM devices WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, [...values, limit, offset], true), total: this.store.one(`SELECT count(*) AS total FROM devices WHERE ${where}`, values, true)!.total, limit, offset };
    }
    if (action === "stats") return { total: this.store.one("SELECT count(*) AS total FROM devices", [], true)!.total, by_status: this.store.all("SELECT status AS name,count(*) AS count FROM devices GROUP BY status", [], true), by_type: this.store.all("SELECT device_type AS name,count(*) AS count FROM devices GROUP BY device_type", [], true) };
    if (action === "get") return { device: this.device(Number(args.device_id || args.id)) };
    if (action === "users") return { items: this.store.all("SELECT * FROM users ORDER BY id", [], true).map(publicUser) };
    const id = Number(args.device_id || args.id);
    let result: unknown;
    if (action === "create") result = { device: this.store.insert("devices", deviceSchema.parse(args), true) };
    else if (action === "update") { this.device(id); result = { device: this.store.update("devices", id, deviceSchema.partial().parse(args.changes || args), true) }; }
    else if (action === "delete") { this.device(id); this.store.run("DELETE FROM devices WHERE id=?", [id], true); result = { ok: true }; }
    else throw new AppError("不支持的业务操作", 422);
    this.store.insert("audit_log", { ts: new Date().toISOString(), user_id: identity.id, username: identity.username, source: "business-tool", action, resource: `device:${id || "new"}`, detail: JSON.stringify(args) }, true);
    return result;
  }
  tools(): ToolSpec[] {
    const idSchema = { type: "object", properties: { device_id: { type: "integer", minimum: 1 } }, required: ["device_id"] };
    const deviceFields = { name: { type: "string" }, device_type: { type: "string" }, serial_no: { type: "string" }, location: { type: "string" }, status: { type: "string", enum: ["在线", "离线", "维护中"] }, owner: { type: "string" }, remark: { type: "string" } };
    const definitions: [string, string, string, string, ToolSpec["risk"], Row][] = [
      ["get_my_profile", "我的身份", "profile", "profile:read", "read", { type: "object", properties: {} }],
      ["list_devices", "查询设备", "list", "device:read", "read", { type: "object", properties: { q: { type: "string" }, status: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 200 } } }],
      ["get_device", "设备详情", "get", "device:read", "read", idSchema],
      ["get_device_stats", "设备统计", "stats", "device:read", "read", { type: "object", properties: {} }],
      ["create_device", "新增设备", "create", "device:create", "write", { type: "object", properties: deviceFields, required: ["name", "device_type", "serial_no"] }],
      ["update_device", "修改设备", "update", "device:update", "write", { ...idSchema, properties: { ...idSchema.properties, ...deviceFields } }],
      ["delete_device", "删除设备", "delete", "device:delete", "delete", idSchema],
      ["list_users", "业务用户列表", "users", "user:manage", "read", { type: "object", properties: {} }],
    ];
    return definitions.map(([name, title, action, permission, risk, parameters]) => ({ name, title, description: title + "，基于当前业务账号权限获取真实数据。", source: "native", category: "设备业务", permission, risk, parameters, execute: async (args, context) => this.execute(action, args, context) }));
  }
  routes(app: FastifyInstance) {
    app.post("/api/login", (request, reply) => this.auth.login(request, reply, false));
    app.post("/api/logout", async (request, reply) => { const { digest } = await import("./security.js"); this.store.run("DELETE FROM sessions WHERE token_hash=?", [digest(this.auth.credential(request))], true); reply.clearCookie("wa_session", { path: "/" }); return { ok: true }; });
    app.get("/api/me", async (request) => ({ user: await this.auth.user(request) }));
    for (const [method, url, action] of [["GET", "/api/devices", "list"], ["GET", "/api/devices/stats", "stats"], ["GET", "/api/devices/:id", "get"], ["POST", "/api/devices", "create"], ["PATCH", "/api/devices/:id", "update"], ["DELETE", "/api/devices/:id", "delete"], ["GET", "/api/users", "users"]] as const) app.route({ method, url, handler: async (request, reply) => {
      const identity = await this.auth.user(request);
      const result = this.execute(action, { ...request.query as Row, ...request.body as Row, ...request.params as Row }, { identity, credential: this.auth.credential(request), sessionId: "", signal: AbortSignal.timeout(30000) });
      if (action === "create") reply.code(201); return result;
    } });
    app.delete("/api/users/:id", async (request) => {
      const user = await this.auth.user(request); this.auth.permission(user, "user:manage");
      const id = Number((request.params as Row).id); const target = this.store.one("SELECT * FROM users WHERE id=?", [id], true);
      if (!target) throw new AppError("用户不存在", 404);
      if (id === user.id || target.is_admin) throw new AppError("不能删除当前账号或业务管理员", 403);
      this.store.run("DELETE FROM users WHERE id=?", [id], true); return { ok: true };
    });
    app.get("/api/audit", async (request) => { const user = await this.auth.user(request); this.auth.permission(user, "user:manage"); return { items: this.store.all("SELECT * FROM audit_log ORDER BY id DESC LIMIT 300", [], true) }; });
  }
}
