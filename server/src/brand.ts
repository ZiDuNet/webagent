import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AppError } from "./types.js";
import { storagePaths } from "./storage-paths.js";

/**
 * 空态品牌徽标：助手只保存 `brand/<hash>.<ext>` 相对路径，文件落在数据目录，
 * 不把 Base64 写进配置 JSON。文件名带内容哈希，可以长期缓存。
 */
const mimeExtensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};
const extensionMimes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};
const dataUrlPattern = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/;
/** 3,000,000 个 Base64 字符约等于 2.2 MB 原图，足够放下高清 Logo。 */
export const MAX_BRAND_LOGO_CHARS = 3_000_000;

export function saveBrandLogo(dataDir: string, dataUrl: string) {
  const match = dataUrlPattern.exec(String(dataUrl || ""));
  if (!match) throw new AppError("Logo 仅支持 PNG、JPEG、WebP、GIF 图片", 422);
  if (match[2].length > MAX_BRAND_LOGO_CHARS) throw new AppError("Logo 文件过大，请控制在 2 MB 以内", 422);
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length) throw new AppError("Logo 内容为空", 422);
  const filename = `${createHash("sha256").update(buffer).digest("hex").slice(0, 32)}.${mimeExtensions[match[1]]}`;
  const directory = storagePaths(dataDir).brand;
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = path.join(directory, filename);
  if (!fs.existsSync(target)) fs.writeFileSync(target, buffer, { mode: 0o600, flag: "wx" });
  return { path: `brand/${filename}`, size: buffer.length };
}

/** 只接受 `brand/<32 位十六进制>.<受支持扩展名>`，杜绝目录穿越与任意文件读取。 */
export function brandFilename(relative: unknown) {
  const match = /^brand\/([0-9a-f]{32}\.(?:png|jpg|jpeg|webp|gif))$/.exec(String(relative || ""));
  return match?.[1];
}

export function brandUrl(relative: unknown, prefix = "/api/agent/brand") {
  const file = brandFilename(relative);
  return file ? `${prefix}/${file}` : "";
}

export function readBrandLogo(dataDir: string, file: string) {
  if (!/^[0-9a-f]{32}\.(png|jpg|jpeg|webp|gif)$/.test(file)) return undefined;
  const mime = extensionMimes[file.split(".").pop() || ""];
  if (!mime) return undefined;
  try {
    const target = path.join(storagePaths(dataDir).brand, file);
    const stat = fs.statSync(target);
    if (!stat.isFile()) return undefined;
    return { bytes: fs.readFileSync(target), mime_type: mime };
  } catch {
    return undefined;
  }
}

export function removeBrandLogo(dataDir: string, relative: unknown) {
  const file = brandFilename(relative);
  if (!file) return;
  try { fs.rmSync(path.join(storagePaths(dataDir).brand, file), { force: true }); } catch { /* 文件已不存在时忽略 */ }
}
