import { fileURLToPath } from "node:url";
import path from "node:path";

export const rootDir = fileURLToPath(new URL("../../", import.meta.url));
export const envFlag = (name: string, fallback = false) => process.env[name] === undefined ? fallback : /^(1|true|yes)$/i.test(process.env[name]!);
export const config = {
  host: process.env.WEBAGENT_BIND_HOST || "127.0.0.1",
  port: Number(process.env.WEBAGENT_PORT || process.env.WEBAGENT_BUSINESS_PORT || 8000),
  dataDir: path.resolve(rootDir, process.env.WEBAGENT_DATA_DIR || process.env.WEBAGENT_PI_DATA_DIR || "data"),
  legacyDir: path.resolve(rootDir, process.env.WEBAGENT_LEGACY_DIR || "legacy"),
  secret: process.env.WEBAGENT_SECRET_KEY || process.env.WEBAGENT_INTERNAL_SECRET || "webagent-demo-internal-secret-change-me",
  adminPassword: process.env.WEBAGENT_CONTROL_PASSWORD || "admin123",
  cookieSecure: envFlag("WEBAGENT_COOKIE_SECURE"),
  sessionHours: Number(process.env.WEBAGENT_SESSION_HOURS || 24),
  localTools: (process.env.WEBAGENT_LOCAL_TOOLS || "off").trim().toLowerCase() === "admin" ? "admin" as const : "off" as const,
};
