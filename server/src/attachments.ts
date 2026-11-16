import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AppError, type Row } from "./types.js";
import { storagePaths } from "./storage-paths.js";

/**
 * 会话图片附件落在 `data/uploads/<sessionId>/`，会话 JSON 只保存相对路径。
 * Base64 只存在于请求、SSE 请求与调用模型的瞬间，避免会话文件随多模态使用膨胀。
 */
export const MAX_ATTACHMENTS = 4;
export const MAX_ATTACHMENT_CHARS = 8_000_000;
export const MAX_ATTACHMENTS_CHARS = 11_500_000;

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

function inside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function sessionDirectory(dataDir: string, sessionId: string) {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(sessionId)) throw new AppError("会话 ID 无效", 422);
  return path.join(storagePaths(dataDir).uploads, sessionId);
}

/** 写入前校验全部图片，任何一张不合法都不会留下半套文件。 */
export function validateAttachments(attachments: Row[]) {
  if (attachments.length > MAX_ATTACHMENTS) throw new AppError(`每条消息最多 ${MAX_ATTACHMENTS} 张图片`, 422);
  let total = 0;
  for (const item of attachments) {
    const dataUrl = String(item?.data_url || "");
    total += dataUrl.length;
    if (!dataUrlPattern.test(dataUrl) || dataUrl.length > MAX_ATTACHMENT_CHARS) throw new AppError("图片格式或单张大小超限", 422);
  }
  if (total > MAX_ATTACHMENTS_CHARS) throw new AppError("图片总大小超限", 422);
}

/**
 * 把请求里的 data URL 落盘，返回可写入会话 JSON 的规范化附件：
 * `{ name, mime_type, path, size }`，不再包含 `data_url`。
 */
export function saveAttachments(dataDir: string, sessionId: string, attachments: Row[]): Row[] {
  validateAttachments(attachments);
  if (!attachments.length) return [];
  return attachments.map((item) => {
    const match = dataUrlPattern.exec(String(item.data_url));
    return saveImageBase64(dataDir, sessionId, match![1], match![2], String(item.name || ""));
  });
}

/** 按内容哈希写入图片，重复调用同一条 PI 消息不会产生多份文件。 */
export function saveImageBase64(dataDir: string, sessionId: string, mimeType: string, base64: string, name = ""): Row {
  const extension = mimeExtensions[mimeType];
  if (!extension || !/^[A-Za-z0-9+/=]+$/.test(base64) || base64.length > MAX_ATTACHMENT_CHARS) throw new AppError("图片格式或大小超限", 422);
  const buffer = Buffer.from(base64, "base64");
  const digest = createHash("sha256").update(buffer).digest("hex").slice(0, 32);
  const filename = `${digest}.${extension}`;
  const directory = sessionDirectory(dataDir, sessionId);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = path.join(directory, filename);
  if (!fs.existsSync(target)) fs.writeFileSync(target, buffer, { mode: 0o600, flag: "wx" });
  return {
    name: String(name || filename).slice(0, 160),
    mime_type: mimeType,
    path: path.relative(dataDir, target).split(path.sep).join("/"),
    size: buffer.length,
  };
}

function imageBase64(dataDir: string, sessionId: string, relativePath: string): string | undefined {
  const relative = String(relativePath || "");
  if (!relative) return undefined;
  const root = sessionDirectory(dataDir, sessionId);
  const target = path.resolve(dataDir, relative);
  if (!inside(root, target)) return undefined;
  try { return fs.statSync(target).isFile() ? fs.readFileSync(target).toString("base64") : undefined; } catch { return undefined; }
}

/**
 * 把落盘附件还原成 data URL 供 PI 使用。
 * 兼容旧版会话里的内联 `data_url`；文件缺失时返回 undefined，历史消息跳过该图而不是让整条会话不可用。
 */
export function attachmentDataUrl(dataDir: string, sessionId: string, attachment: Row): string | undefined {
  const inline = String(attachment?.data_url || "");
  if (dataUrlPattern.test(inline)) return inline;
  const relative = String(attachment?.path || "");
  if (!relative) return undefined;
  const root = sessionDirectory(dataDir, sessionId);
  const target = path.resolve(dataDir, relative);
  if (!inside(root, target)) return undefined;
  try {
    if (!fs.statSync(target).isFile()) return undefined;
    const mime = String(attachment.mime_type || extensionMimes[path.extname(target).slice(1).toLowerCase()] || "");
    if (!dataUrlPattern.test(`data:${mime};base64,AA==`)) return undefined;
    return `data:${mime};base64,${fs.readFileSync(target).toString("base64")}`;
  } catch {
    return undefined;
  }
}

/** 读取会话附件供受鉴权的预览接口使用；只允许访问该会话自己的 uploads 目录。 */
export function readSessionUpload(dataDir: string, sessionId: string, filename: string) {
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(filename)) return undefined;
  const target = path.join(sessionDirectory(dataDir, sessionId), filename);
  const mime = extensionMimes[path.extname(filename).slice(1).toLowerCase()];
  if (!mime) return undefined;
  try {
    const stat = fs.statSync(target);
    if (!stat.isFile()) return undefined;
    return { bytes: fs.readFileSync(target), mime_type: mime };
  } catch {
    return undefined;
  }
}

/** 删除会话时同步移除其附件目录。 */
export function removeSessionUploads(dataDir: string, sessionId: string) {
  fs.rmSync(sessionDirectory(dataDir, sessionId), { recursive: true, force: true });
}

const PI_IMAGE_PATH = "webagent_path";

/** PI canonical entries 同样不能内联图片：保存前换成路径，读取上下文时再还原。 */
export function externalizePiImages(dataDir: string, sessionId: string, entries: Row[]) {
  for (const entry of entries) {
    const content = entry?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part?.type !== "image" || !part.data) continue;
      if (!part[PI_IMAGE_PATH]) {
        const saved = saveImageBase64(dataDir, sessionId, String(part.mimeType || ""), String(part.data));
        part[PI_IMAGE_PATH] = saved.path;
      }
      delete part.data;
    }
  }
}

/** 把 PI entries 中的图片路径还原成 Base64；文件丢失时移除该图片，保留文本上下文。 */
export function hydratePiImages(dataDir: string, sessionId: string, entries: Row[]) {
  for (const entry of entries) {
    const content = entry?.message?.content;
    if (!Array.isArray(content)) continue;
    entry.message.content = content.filter((part: Row) => {
      if (part?.type !== "image" || part.data) return true;
      const data = imageBase64(dataDir, sessionId, part[PI_IMAGE_PATH]);
      if (!data) return false;
      part.data = data;
      delete part[PI_IMAGE_PATH];
      return true;
    });
  }
}

export function hasInlinePiImages(entries: Row[]) {
  return entries.some((entry) => Array.isArray(entry?.message?.content) && entry.message.content.some((part: Row) => part?.type === "image" && typeof part.data === "string" && !part[PI_IMAGE_PATH]));
}
