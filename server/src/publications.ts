import { decrypt } from "./security.js";
import { Store } from "./store.js";
import { AppError, type Identity, type Row, type ToolSpec } from "./types.js";
import { requestJson } from "./providers.js";

export class Publications {
  constructor(private store: Store) {}
  status() { const settings = this.store.settings(); return { configured: settings.pagepilot_enabled && Boolean(settings.pagepilot_token && settings.pagepilot_base_url), enabled: settings.pagepilot_enabled, base_url: settings.pagepilot_base_url }; }
  owned(id: number, user: Identity) { const row = this.store.one("SELECT * FROM publications WHERE id=? AND owner_key=?", [id, user.owner_key]); if (!row) throw new AppError("发布记录不存在", 404); return row; }
  list(user: Identity, query: Row = {}) {
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 50)); const offset = Math.max(0, Number(query.offset) || 0);
    const where = ["owner_key=?"]; const values: any[] = [user.owner_key];
    if (query.q) { where.push("(title LIKE ? OR code LIKE ?)"); values.push(`%${query.q}%`, `%${query.q}%`); }
    if (query.session_id) { where.push("session_id=?"); values.push(query.session_id); }
    return { items: this.store.all(`SELECT * FROM publications WHERE ${where.join(" AND ")} ORDER BY updated_at DESC,id DESC LIMIT ? OFFSET ?`, [...values, limit, offset]), total: this.store.one(`SELECT count(*) AS n FROM publications WHERE ${where.join(" AND ")}`, values)!.n, limit, offset };
  }
  detail(id: number, user: Identity) { const publication = this.owned(id, user); const versions = this.store.all("SELECT id,version,title,description,url,visibility,password_set,size,status,created_at FROM publication_versions WHERE publication_id=? ORDER BY id DESC", [id]); const html = this.store.one("SELECT html FROM publication_versions WHERE id=? AND publication_id=?", [publication.latest_version_id || 0, id])?.html || ""; return { ...publication, html, versions }; }
  async test() {
    const settings = this.store.settings();
    if (!settings.pagepilot_base_url || !settings.pagepilot_token) return { ok: false, message: "请先配置 PagePilot 地址和 Token" };
    await requestJson(`${settings.pagepilot_base_url}/api/tokens`, { headers: { Authorization: `Bearer ${decrypt(settings.pagepilot_token)}` }, signal: AbortSignal.timeout(12000) });
    return { ok: true, message: "PagePilot Token 验证通过" };
  }
  async publish(user: Identity, body: Row, source = "preview") {
    const settings = this.store.settings(); if (!this.status().configured) throw new AppError("PagePilot 未配置或未启用", 422);
    const base = settings.pagepilot_base_url.replace(/\/$/, "");
    if (typeof body.html !== "string" || body.html.length < 20 || Buffer.byteLength(body.html) > 3200000) throw new AppError("HTML 内容需要 20 字符至 3.2 MB", 422);
    if (body.session_id) this.store.ownedSession(body.session_id, user);
    let previous = body.publication_id ? this.owned(Number(body.publication_id), user) : undefined;
    if (!previous && body.code) previous = this.store.one("SELECT * FROM publications WHERE code=? AND remote_base_url=? AND owner_key=?", [body.code, base, user.owner_key]);
    if (body.code && !previous) throw new AppError("不能更新未归属当前用户的远端页面", 404);
    if (previous && previous.remote_base_url !== base) throw new AppError("该页面属于之前的 PagePilot 服务", 409);
    if (previous && (!previous.code || (body.code && body.code !== previous.code))) throw new AppError("更新页面 code 不一致或未成功发布", 409);
    if (!["public", "unlisted"].includes(body.visibility || settings.pagepilot_default_visibility)) throw new AppError("可见范围无效", 422);
    if (body.access_password !== undefined && (typeof body.access_password !== "string" || body.access_password.length > 200)) throw new AppError("密码格式无效", 422);
    const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date());
    const userTitle = String(body.title || "").trim();
    if (!userTitle) throw new AppError("请填写发布标题", 422);
    const title = (settings.pagepilot_default_title ? `${userTitle}（${settings.pagepilot_default_title}）` : userTitle).slice(0, 120);
    const description = String(body.description || settings.pagepilot_default_description || `由 WebAgent 于 ${date} 发布`).slice(0, 240);
    const data: Row = { ...this.store.ownerColumns(user), session_id: body.session_id || null, remote_base_url: base, title, description, filename: "index.html", visibility: body.visibility || settings.pagepilot_default_visibility, password_set: body.access_password === undefined ? Boolean(previous?.password_set) : Boolean(body.access_password), size: Buffer.byteLength(body.html), source, status: "publishing", last_error: "" };
    const record = previous ? this.store.update("publications", previous.id, data)! : this.store.insert("publications", data);
    const version = this.store.insert("publication_versions", { publication_id: record.id, html: body.html, title, description, filename: "index.html", visibility: data.visibility, password_set: data.password_set, size: data.size, source, status: "publishing" });
    const key = decrypt(settings.pagepilot_token);
    const send = async (method: string, route: string, payload: Row) => {
      const response = await fetch(`${base}${route}`, { method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(payload), redirect: "error", signal: AbortSignal.timeout(90000) });
      let result: Row = {}; try { result = await response.json() as Row; } catch {}
      if (!response.ok || result.success === false) { const error = new AppError(`PagePilot HTTP ${response.status}`, 502) as AppError & { remoteStatus: number }; error.remoteStatus = response.status; throw error; }
      return result;
    };
    let contentPublished = false;
    const result: Row = { publication_id: record.id, code: previous?.code || "", url: previous?.url || "", detail_url: previous?.detail_url || "", title, description, visibility: data.visibility, password_set: data.password_set, size: data.size };
    const warnings: string[] = [];
    try {
      const remote = await send("POST", "/api/deploy", { content: body.html, title, description, filename: "index.html", visibility: data.visibility, ...(previous ? { customCode: previous.code, enableCustomCode: true, createVersion: true } : body.access_password ? { accessPassword: body.access_password } : {}) });
      if (previous && remote.code !== previous.code) throw new AppError("PagePilot 更新返回的 code 与目标不一致，请核对远端状态", 502);
      if (!/^[A-Za-z0-9_-]{1,160}$/.test(remote.code || "")) throw new AppError("PagePilot 未返回有效页面 code，请核对远端状态", 502);
      contentPublished = true;
      const safeLink = (value: unknown) => { if (typeof value !== "string" || !value) return ""; const url = new URL(value, base); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : ""; };
      Object.assign(result, { code: remote.code, url: safeLink(remote.url || remote.pathUrl), detail_url: safeLink(remote.detailUrl), version: remote.versionNumber || null });
      this.store.update("publications", record.id, { ...result, latest_version_id: version.id });
      const setMetadata = async (route: string, fallback: string, payload: Row) => {
        try { await send("PATCH", route, payload); } catch (error) { if (![404, 405].includes((error as any).remoteStatus)) throw error; await send("POST", fallback, payload); }
      };
      if (body.access_password !== undefined) try { await setMetadata(`/api/deploys/${result.code}/access`, `/api/deploys/${result.code}/access/set`, { password: body.access_password }); } catch { warnings.push("访问密码设置失败，请核对页面访问权限"); result.password_set = previous?.password_set || Boolean(body.access_password); }
      try { await setMetadata(`/api/deploys/${result.code}/visibility`, `/api/deploys/${result.code}/visibility`, { visibility: data.visibility }); } catch { warnings.push("可见范围设置失败"); }
      Object.assign(result, { ok: !warnings.length, status: warnings.length ? "partial" : "published", warning: warnings.join("；") });
    } catch (error) {
      const message = (error instanceof Error ? error.message : "发布失败").replaceAll(key || "\u0000", "[隐藏]").replaceAll(body.access_password || "\u0000", "[隐藏]");
      Object.assign(result, { ok: false, status: contentPublished ? "partial" : "failed", warning: message });
    }
    this.store.update("publications", record.id, { ...result, last_error: result.warning || "", latest_version_id: version.id, publish_count: (record.publish_count || 0) + Number(contentPublished) });
    this.store.update("publication_versions", version.id, { ...result, error: result.warning || "", response: { code: result.code, url: result.url, status: result.status } });
    this.store.audit(user.username, "pagepilot.publish", String(record.id), { status: result.status });
    return result;
  }
  tools(): ToolSpec[] {
    const properties = { html: { type: "string" }, title: { type: "string" }, description: { type: "string" }, access_password: { type: "string", description: "必须先询问用户是否设置密码；用户明确不设置时填空，不得生成密码。" }, visibility: { type: "string", enum: ["public", "unlisted"] }, publication_id: { type: "integer", description: "更新时填写当前用户的已发布记录 ID" } };
    return [
      { name: "pagepilot_publish_html", title: "发布或更新 HTML", description: "发布 HTML 页面到 PagePilot，或更新当前用户已发布的页面。先询问用户标题、可见范围和是否设置密码，密码可以为空。写入需要审批。", source: "builtin", category: "PagePilot", permission: "", risk: "write", available: () => this.status().configured, parameters: { type: "object", properties, required: ["html", "title", "visibility", "access_password"] }, execute: async (args, context) => this.publish(context.identity, { ...args, session_id: context.sessionId }, "tool") },
      { name: "pagepilot_list_my_pages", title: "我的已发布页面", description: "从本地归属记录查询当前用户已发布页面，不读取全局 Token 下其他用户的页面。", source: "builtin", category: "PagePilot", permission: "", risk: "read", parameters: { type: "object", properties: { q: { type: "string" } } }, execute: async (args, context) => this.list(context.identity, args) },
    ];
  }
}
