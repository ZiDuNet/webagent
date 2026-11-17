import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AppError, type Row } from "./types.js";
import { storagePaths } from "./storage-paths.js";

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

function storedImagePath(dataDir: string, sessionId: string, target: string): string | undefined {
  const directory = sessionDirectory(dataDir, sessionId);
  if (!inside(directory, target)) return undefined;
  try {
    const uploads = fs.realpathSync(storagePaths(dataDir).uploads);
    const root = fs.realpathSync(directory);
    const file = fs.realpathSync(target);
    if (root !== path.join(uploads, sessionId) || !inside(root, file)) return undefined;
    const stat = fs.statSync(file);
    return stat.isFile() && stat.size <= MAX_ATTACHMENT_CHARS ? file : undefined;
  } catch { return undefined; }
}

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

export function saveAttachments(dataDir: string, sessionId: string, attachments: Row[]): Row[] {
  validateAttachments(attachments);
  if (!attachments.length) return [];
  return attachments.map((item) => {
    const match = dataUrlPattern.exec(String(item.data_url));
    return saveImageBase64(dataDir, sessionId, match![1], match![2], String(item.name || ""));
  });
}

export function copySessionAttachments(dataDir: string, sourceSessionId: string, targetSessionId: string, attachments: Row[]): Row[] {
  const copies = attachments.map((attachment) => {
    if (attachment?.path && !attachment.data_url) {
      try {
        const uploadsRoot = fs.realpathSync(storagePaths(dataDir).uploads);
        const sourceRoot = fs.realpathSync(sessionDirectory(dataDir, sourceSessionId));
        const target = fs.realpathSync(path.resolve(dataDir, String(attachment.path)));
        if (sourceRoot !== path.join(uploadsRoot, sourceSessionId) || !inside(sourceRoot, target)) throw new Error();
      } catch {
        throw new AppError("原会话图片附件不可用，无法分叉该消息", 422);
      }
    }
    const dataUrl = attachmentDataUrl(dataDir, sourceSessionId, attachment);
    if (!dataUrl) throw new AppError("原会话图片附件不可用，无法分叉该消息", 422);
    return { name: attachment.name, mime_type: attachment.mime_type, data_url: dataUrl };
  });
  return saveAttachments(dataDir, targetSessionId, copies);
}

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
  const target = storedImagePath(dataDir, sessionId, path.resolve(dataDir, relative));
  if (!target) return undefined;
  try { return fs.readFileSync(target).toString("base64"); } catch { return undefined; }
}

export function attachmentDataUrl(dataDir: string, sessionId: string, attachment: Row): string | undefined {
  const inline = String(attachment?.data_url || "");
  if (dataUrlPattern.test(inline)) return inline;
  const relative = String(attachment?.path || "");
  if (!relative) return undefined;
  const target = storedImagePath(dataDir, sessionId, path.resolve(dataDir, relative));
  if (!target) return undefined;
  try {
    if (!fs.statSync(target).isFile()) return undefined;
    const mime = String(attachment.mime_type || extensionMimes[path.extname(target).slice(1).toLowerCase()] || "");
    if (!dataUrlPattern.test(`data:${mime};base64,AA==`)) return undefined;
    return `data:${mime};base64,${fs.readFileSync(target).toString("base64")}`;
  } catch {
    return undefined;
  }
}

export function readSessionUpload(dataDir: string, sessionId: string, filename: string) {
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(filename)) return undefined;
  const target = storedImagePath(dataDir, sessionId, path.join(sessionDirectory(dataDir, sessionId), filename));
  if (!target) return undefined;
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

export function removeSessionUploads(dataDir: string, sessionId: string) {
  fs.rmSync(sessionDirectory(dataDir, sessionId), { recursive: true, force: true });
}

const PI_IMAGE_PATH = "webagent_path";

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
