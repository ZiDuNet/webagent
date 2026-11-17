import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { decrypt, encrypt } from "../../security.js";
import { AppError } from "../../types.js";
import type { Auth } from "../../auth.js";
import type { Store } from "../../store.js";
import { Pc4dConnector } from "./connector.js";

export function pc4dRoutes(app: FastifyInstance, connector: Pc4dConnector, auth: Auth, store: Store) {
  const prefix = "/api/integrations/pc4d";
  const origins = (process.env.WEBAGENT_UI_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean);
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith(prefix) && !request.url.startsWith("/api/agent/")) return;
    const origin = request.headers.origin;
    if (origin && origins.includes(origin)) reply.header("Access-Control-Allow-Origin", origin).header("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, Last-Event-ID").header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS").header("Access-Control-Expose-Headers", "X-Run-Id").header("Vary", "Origin");
    if (request.method === "OPTIONS") return origin && origins.includes(origin) ? reply.code(204).send() : reply.code(403).send({ detail: "接入来源未配置" });
  });
  const attempts = new Map<string, { count: number; until: number }>();
  app.post(`${prefix}/exchange`, async (request, reply) => {
    const current = Date.now();
    let entry = attempts.get(request.ip);
    if (!entry || entry.until <= current) { entry = { count: 0, until: current + 60000 }; attempts.set(request.ip, entry); }
    if (++entry.count > 30) throw new AppError("接入请求过于频繁，请稍后重试", 429);
    if (attempts.size > 5000) for (const [key, value] of attempts) if (value.until <= current) attempts.delete(key);
    const input = z.object({ channel: z.enum(["screen", "web", "miniprogram"]), pid: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), access_token: z.string().min(1).max(8192).optional(), project_name: z.string().max(120).optional() }).strict().parse(request.body);
    if (input.channel !== "screen" && !input.access_token) throw new AppError("请先在业务系统登录", 401);
    reply.header("Cache-Control", "no-store");
    return connector.exchange(input);
  });

  const artifactRoot = path.join(store.dataDir, "artifacts", "pc4d");
  fs.mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
  const pruneArtifacts = () => {
    let files: string[];
    try { files = fs.readdirSync(artifactRoot); } catch { return; }
    for (const file of files) {
      if (!/^[a-f0-9-]{36}\.html$/.test(file)) continue;
      const target = path.join(artifactRoot, file);
      try { if (fs.statSync(target).mtimeMs < Date.now() - 3600000) fs.unlinkSync(target); } catch {}
    }
  };
  pruneArtifacts();
  const cleanup = setInterval(pruneArtifacts, 3600000); cleanup.unref();
  app.addHook("onClose", async () => clearInterval(cleanup));
  app.post(`${prefix}/artifacts`, async (request, reply) => {
    const { identity } = await auth.agent(request, reply);
    if (!identity.namespace?.startsWith("pc4d:")) throw new AppError("请使用 PC4D 业务身份", 403);
    const input = z.object({ html: z.string().min(1).max(3200000), title: z.string().max(120).optional(), session_id: z.string().max(100).optional() }).strict().parse(request.body);
    if (Buffer.byteLength(input.html) > 3200000) throw new AppError("HTML 内容超过 3.2 MB", 422);
    if (input.session_id) store.ownedSession(input.session_id, identity);
    const id = randomUUID();
    const expires = Date.now() + 30 * 60000;
    fs.mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(artifactRoot, `${id}.html`), input.html, { mode: 0o600 });
    const ticket = encrypt(`${id}.${expires.toString(36)}`).slice(7);
    const configured = process.env.WEBAGENT_PC4D_PUBLIC_URL;
    // 默认返回同源相对地址：HTTPS 反向代理下不能用 request.protocol（常被代理成 http）
    // 否则 iframe 会被浏览器按 Mixed Content 拦截。前端会基于 agentBaseUrl 解析。
    // 显式配置公网地址时只取 origin；部署在子路径时由前端拼接，避免后端猜测代理前缀。
    let base = "";
    if (configured) {
      try {
        const url = new URL(configured);
        if (["http:", "https:"].includes(url.protocol)) base = url.origin;
      } catch {}
    }
    reply.code(201);
    return { url: `${base}${prefix}/artifacts/${ticket}`, path: `${prefix}/artifacts/${ticket}`, expires_at: new Date(expires).toISOString() };
  });
  app.get(`${prefix}/artifacts/:ticket`, async (request, reply) => {
    let ticket: { id: string; expires: number };
    try {
      const [id, expires] = decrypt(`enc:v2:${(request.params as { ticket: string }).ticket}`).split(".");
      ticket = { id, expires: Number.parseInt(expires, 36) };
    } catch { throw new AppError("预览链接无效或已过期，请重新打开", 404); }
    if (!/^[a-f0-9-]{36}$/.test(ticket.id) || !Number.isFinite(ticket.expires) || ticket.expires <= Date.now()) throw new AppError("预览已过期，请从聊天中重新打开", 410);
    const file = path.join(artifactRoot, `${ticket.id}.html`);
    if (!fs.existsSync(file)) throw new AppError("预览已清理，请从聊天中重新打开", 410);
    reply.header("Content-Security-Policy", "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com; style-src 'unsafe-inline' https:; img-src data: https:; font-src data: https:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    return reply.type("text/html; charset=utf-8").send(fs.readFileSync(file));
  });
}
