import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

export function initializeEnv(destination, extend = false) {
  const exists = fs.existsSync(destination);
  if (exists && !extend) throw new Error(".env 已存在，拒绝覆盖现有密钥与配置；可用 --extend 只补充缺失配置。");
  const original = exists ? fs.readFileSync(destination, "utf8") : "";
  const configured = new Set([...original.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map((match) => match[1]));
  const defaults = {
    WEBAGENT_BIND_HOST: "127.0.0.1",
    WEBAGENT_PORT: "8000",
    WEBAGENT_CHAT_PORT: "8080",
    WEBAGENT_ADMIN_PORT: "8081",
    WEBAGENT_SECRET_KEY: randomBytes(32).toString("base64url"),
    WEBAGENT_CONTROL_PASSWORD: randomBytes(18).toString("base64url"),
    WEBAGENT_ADMIN_PASSWORD: randomBytes(18).toString("base64url"),
    WEBAGENT_PI_DATA_DIR: "./data/pi",
    WEBAGENT_SEED_DEMO_USERS: "1",
    WEBAGENT_COOKIE_SECURE: "0",
    WEBAGENT_ALLOW_STDIO: "0",
    WEBAGENT_LOCAL_TOOLS: "off",
  };
  const additions = Object.entries(defaults).filter(([key]) => !configured.has(key));
  if (!additions.length) return [];
  const prefix = original && !original.endsWith("\n") ? "\n" : "";
  fs.writeFileSync(destination, `${exists ? "" : original}${prefix}${additions.map(([key, value]) => `${key}=${value}\n`).join("")}`, { flag: exists ? "a" : "wx", mode: 0o600 });
  fs.chmodSync(destination, 0o600);
  return additions.map(([key]) => key);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some((argument) => argument !== "--extend")) throw new Error("用法：npm run init:env -- [--extend]");
  const added = initializeEnv(fileURLToPath(new URL("../.env", import.meta.url)), process.argv.includes("--extend"));
  console.log(added.length ? `已补充 ${added.length} 项配置到 .env（0600），未覆盖原有值。管理与业务管理员初始密码分别保存在 CONTROL_PASSWORD、ADMIN_PASSWORD，两端登录独立。` : ".env 配置已齐全，未修改现有值。");
}
