import { createCipheriv, createDecipheriv, createHash, createHmac, pbkdf2, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { config } from "./config.js";
import { AppError } from "./types.js";

const derive = promisify(pbkdf2);
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const token = () => randomBytes(32).toString("base64url");
export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = await derive(password, salt, 240000, 32, "sha256");
  return `pbkdf2_sha256$240000$${salt.toString("hex")}$${derived.toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string) {
  try {
    const [scheme, rounds, salt, expected] = encoded.split("$");
    if (scheme !== "pbkdf2_sha256" || !/^\d+$/.test(rounds) || Number(rounds) > 1000000) return false;
    const actual = await derive(password, Buffer.from(salt, "hex"), Number(rounds), 32, "sha256");
    const expectedBytes = Buffer.from(expected, "hex");
    return expectedBytes.length === actual.length && timingSafeEqual(actual, expectedBytes);
  } catch { return false; }
}
const encryptionKey = () => createHash("sha256").update(config.secret).digest();
export function encrypt(value: string) {
  if (!value || value.startsWith("enc:")) return value;
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), nonce);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `enc:v2:${Buffer.concat([nonce, cipher.getAuthTag(), data]).toString("base64url")}`;
}
export function decrypt(value: string) {
  if (!value || !value.startsWith("enc:")) return value || "";
  try {
    if (value.startsWith("enc:v2:")) {
      const data = Buffer.from(value.slice(7), "base64url");
      const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), data.subarray(0, 12));
      decipher.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
    }
    if (value.startsWith("enc:v1:")) {
      const data = Buffer.from(value.slice(7), "base64url");
      const key = encryptionKey();
      const signature = createHmac("sha256", key.subarray(0, 16)).update(data.subarray(0, -32)).digest();
      if (data[0] !== 128 || !timingSafeEqual(signature, data.subarray(-32))) throw new Error("Invalid Fernet token");
      const decipher = createDecipheriv("aes-128-cbc", key.subarray(16), data.subarray(9, 25));
      return Buffer.concat([decipher.update(data.subarray(25, -32)), decipher.final()]).toString("utf8");
    }
  } catch { throw new AppError("凭据解密失败，请恢复原 WEBAGENT_SECRET_KEY，或重新填写密钥", 503); }
  throw new AppError("不支持的密钥格式", 503);
}
export const mask = (value: string) => value ? `${value.slice(0, 3)}••••${value.slice(-4)}` : "";
export function safeUrl(value: string, base?: string) {
  let parsed: URL;
  try { parsed = new URL(value, base); } catch { throw new AppError("地址不是有效的 URL", 422); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) throw new AppError("只支持不含凭据和片段的 HTTP(S) 地址", 422);
  return parsed;
}
