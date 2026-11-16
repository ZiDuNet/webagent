import Fastify, { LogController } from "fastify";
import cookie from "@fastify/cookie";
import staticFiles from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { config, envFlag, rootDir } from "./config.js";
import { Store } from "./store.js";
import { Auth } from "./auth.js";
import { ToolRegistry } from "./tools.js";
import { Providers } from "./providers.js";
import { Decision } from "./decision.js";
import { Speech } from "./speech.js";
import { Publications } from "./publications.js";
import { PiRuntime } from "./pi-runtime.js";
import { Runs } from "./runs.js";
import { CoreMaintenance } from "./core-maintenance.js";
import { SkillLibrary } from "./skill-library.js";
import { adminRoutes } from "./admin-routes.js";
import { chatRoutes } from "./chat-routes.js";
import { voiceRoutes } from "./voice.js";
import { AppError, type IdentityAdapter, type ToolSpec } from "./types.js";

export interface AppOptions { store?: Store; identityAdapter?: IdentityAdapter; tools?: ToolSpec[]; staticUi?: boolean; serveAdmin?: boolean; serveChat?: boolean; logger?: boolean; warmCatalogue?: boolean }
export async function createWebAgent(options: AppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? true, bodyLimit: 19000000, requestTimeout: 120000, logController: new LogController({ disableRequestLogging: true }) });
  const store = options.store || new Store(); await store.initialize();
  const skills = new SkillLibrary(store.dataDir);
  skills.initialize(store);
  await app.register(cookie);
  app.addHook("onRequest", async (request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff").header("Referrer-Policy", "strict-origin-when-cross-origin");
    if (request.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
    const controlBearer = request.url.startsWith("/api/control") && !request.url.startsWith("/api/control/auth/login") && /^Bearer\s+/i.test(String(request.headers.authorization || ""));
    if (!controlBearer && !["GET", "HEAD", "OPTIONS"].includes(request.method) && request.headers.origin) {
      let origin: URL; try { origin = new URL(request.headers.origin); } catch { throw new AppError("无效来源", 403); }
      const allowed = (process.env.WEBAGENT_UI_ORIGINS || "").split(",").filter(Boolean);
      if (origin.host !== request.headers.host && !allowed.includes(origin.origin)) throw new AppError("跨站写入请求被拒绝，请使用同源 API 代理", 403);
    }
  });
  app.setErrorHandler((error: any, request, reply) => {
    if (error instanceof z.ZodError) return reply.code(422).send({ detail: error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("；") });
    if (error instanceof AppError) return reply.code(error.statusCode).send({ detail: error.message });
    const code = typeof error?.code === "string" ? error.code : "";
    if (code.startsWith("SQLITE_CONSTRAINT") || String(error?.message || "").includes("UNIQUE constraint")) return reply.code(409).send({ detail: "记录已存在或关联关系不允许该操作" });
    request.log.error({ message: error.message, code: error.code }, "request failed");
    reply.code(error.statusCode && error.statusCode < 500 ? error.statusCode : 500).send({ detail: error.statusCode && error.statusCode < 500 ? error.message : "服务器内部错误，请查看服务日志" });
  });
  const auth = new Auth(store, options.identityAdapter);
  app.addHook("onRequest", async (request, reply) => auth.controlCors(request, reply));
  const registry = new ToolRegistry(store, auth);
  const providers = new Providers(store); const decision = new Decision(store, providers); const speech = new Speech(providers); const publications = new Publications(store);
  // Warm the models.dev cache in the background; never block server startup on the network.
  if (options.warmCatalogue ?? envFlag("WEBAGENT_MODELSDEV_WARMUP", true)) void providers.ensureCatalogue(0).catch(() => {});
  app.get("/api/me", async (request) => ({ user: await auth.user(request) }));
  for (const tool of options.tools || []) registry.register(tool);
  for (const tool of publications.tools()) registry.register(tool);
  const runtime = new PiRuntime(store, auth, registry, providers, decision, skills); const runs = new Runs(store, auth, runtime); const core = new CoreMaintenance();
  const services = { store, auth, skills, registry, providers, decision, speech, publications, runtime, runs, core };
  auth.routes(app); adminRoutes(app, services); chatRoutes(app, services);
  voiceRoutes(app, services);
  app.get("/health", async () => ({ ok: true, service: "webagent-pi", runtime: "pi", version: "2.0.0", node: process.versions.node }));
  app.get("/api/health", async () => ({ ok: true, runtime: "pi" }));
  const serveAdmin = options.serveAdmin ?? (options.staticUi !== false && envFlag("WEBAGENT_SERVE_ADMIN", true));
  const serveChat = options.serveChat ?? (options.staticUi !== false && envFlag("WEBAGENT_SERVE_CHAT", true));
  app.get("/", async (_request, reply) => reply.redirect(serveChat ? "/chat/" : serveAdmin ? "/admin/" : "/health"));
  if (serveChat) app.get("/react/", async (_request, reply) => reply.redirect("/chat/"));
  if (options.staticUi !== false) {
    for (const name of [...(serveChat ? ["chat"] : []), ...(serveAdmin ? ["admin"] : [])]) {
      const dir = path.join(rootDir, name, "dist");
      if (!fs.existsSync(dir)) continue;
      await app.register(staticFiles, {
        root: dir,
        prefix: `/${name}/`,
        decorateReply: false,
        index: ["index.html"],
        cacheControl: false,
        // 入口 HTML 必须每次回源，否则重新构建后浏览器仍加载旧 bundle；
        // 带 hash 的静态资源可以长期缓存。
        setHeaders: (response, filePath) => {
          response.setHeader("Cache-Control", filePath.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable");
        },
      });
      app.get(`/${name}`, async (_request, reply) => reply.redirect(`/${name}/`));
    }
  }
  const purge = setInterval(() => store.purge(), 3600000); purge.unref();
  app.addHook("preClose", async () => { clearInterval(purge); providers.close(); await runs.shutdown(); await runtime.shutdown(); });
  app.addHook("onClose", async () => { if (!options.store) store.close(); });
  return { app, ...services };
}
