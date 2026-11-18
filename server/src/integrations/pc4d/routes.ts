import type { FastifyInstance } from "fastify";
import { z } from "zod";
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
    const bearer = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    const access = auth.accessToken(bearer, typeof request.headers.origin === "string" ? request.headers.origin : "");
    if (!["screen", "web", "miniprogram"].includes(String(access.channel))) throw new AppError("接入 Token 渠道不匹配，请使用 PC4D 业务接入 Token", 403);
    if (String(access.channel) !== input.channel) throw new AppError(`接入 Token 与请求端不匹配：Token 绑定 ${access.channel}，请求为 ${input.channel}`, 403);
    reply.header("Cache-Control", "no-store");
    return connector.exchange({ ...input, access_token_id: Number(access.id), assistant_id: Number(access.assistant_id) });
  });
}
