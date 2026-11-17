import { inflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";
import { AppError, type Row } from "./types.js";

const FORBIDDEN_FILE = /\.(sh|bash|zsh)$/i;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_FILES = 200;

export interface ImportedSkill {
  name: string;
  slug: string;
  description: string;
  content: string;
  files: Record<string, string>;
  metadata: Row;
}

function safePath(value: string) {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0")) throw new AppError(`技能包路径无效：${value}`, 422);
  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === "..")) throw new AppError(`技能包包含路径穿越：${value}`, 422);
  if (FORBIDDEN_FILE.test(normalized)) throw new AppError(`技能包不允许包含 shell 脚本：${value}`, 422);
  return parts.join("/");
}

function stripFrontmatter(content: string) {
  if (!content.startsWith("---")) return { body: content, fields: {} as Row };
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!match) return { body: content, fields: {} as Row };
  const fields: Row = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!field) continue;
    fields[field[1]] = field[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return { body: content.slice(match[0].length), fields };
}

function commonRoot(paths: string[]) {
  const roots = new Set(paths.map((item) => item.split("/")[0]));
  if (roots.size !== 1) return "";
  const root = [...roots][0];
  return paths.every((item) => item === root || item.startsWith(`${root}/`)) ? root : "";
}

function slugify(value: string) {
  const ascii = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return ascii || `skill-${createHash("sha256").update(value).digest("hex").slice(0, 10)}`;
}

export function skillFromTextFiles(input: { path: string; content: string }[]): ImportedSkill {
  if (!Array.isArray(input) || !input.length) throw new AppError("请选择包含 SKILL.md 的技能目录或 ZIP", 422);
  if (input.length > MAX_FILES) throw new AppError(`技能包文件数量不能超过 ${MAX_FILES}`, 422);
  const entries = input.map((file) => {
    const filePath = safePath(String(file.path || ""));
    const content = String(file.content ?? "");
    if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw new AppError(`技能文件超过 256 KB：${filePath}`, 422);
    return { path: filePath, content };
  });
  if (entries.reduce((total, file) => total + Buffer.byteLength(file.content), 0) > MAX_TOTAL_BYTES) throw new AppError("技能包解压后不能超过 4 MB", 422);
  const direct = entries.some((file) => file.path === "SKILL.md");
  const root = direct ? "" : commonRoot(entries.map((file) => file.path));
  if (!direct && !root) throw new AppError("ZIP 根目录必须直接包含 SKILL.md，或只有一个顶层目录包含 SKILL.md", 422);
  const prefix = root ? `${root}/` : "";
  const normalized = entries.map((file) => ({ ...file, path: file.path === prefix.slice(0, -1) ? "" : file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.path })).filter((file) => file.path);
  const manifest = normalized.find((file) => file.path === "SKILL.md");
  if (!manifest) throw new AppError("技能包缺少 SKILL.md", 422);
  const parsed = stripFrontmatter(manifest.content);
  const name = String(parsed.fields.name || "").trim();
  const description = String(parsed.fields.description || "").trim();
  if (!name || name.length > 100) throw new AppError("SKILL.md frontmatter 需要 1–100 字符的 name", 422);
  if (!description || description.length > 1000) throw new AppError("SKILL.md frontmatter 需要 1–1000 字符的 description", 422);
  const files = Object.fromEntries(normalized.filter((file) => file.path !== "SKILL.md").map((file) => [file.path, file.content]));
  return {
    name,
    slug: slugify(String(parsed.fields.slug || name)).slice(0, 80),
    description,
    content: parsed.body.trim() || description,
    files,
    metadata: { builtin: false, imported: true, format: "skill-folder", frontmatter: parsed.fields },
  };
}

function readUInt64(buffer: Buffer, offset: number) {
  const value = buffer.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new AppError("ZIP 数值超出安全范围", 422);
  return Number(value);
}

export function skillFromZip(buffer: Buffer): ImportedSkill {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw new AppError("ZIP 文件为空或格式无效", 422);
  if (buffer.length > 12 * 1024 * 1024) throw new AppError("ZIP 文件不能超过 12 MB", 422);
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new AppError("未找到 ZIP 中央目录，请确认文件未损坏", 422);
  const count = buffer.readUInt16LE(eocd + 10);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (!count || count > MAX_FILES) throw new AppError(`ZIP 文件数量必须在 1–${MAX_FILES} 之间`, 422);
  let cursor = directoryOffset;
  const files: { path: string; content: string }[] = [];
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) throw new AppError("ZIP 中央目录损坏", 422);
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const external = buffer.readUInt32LE(cursor + 38);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString("utf8");
    cursor = nameStart + nameLength + extraLength + commentLength;
    if (flags & 1) throw new AppError("不支持加密 ZIP", 422);
    if (/\/$/.test(name)) continue;
    if ((external >>> 16 & 0xf000) === 0xa000) throw new AppError(`技能包不允许符号链接：${name}`, 422);
    if (uncompressedSize > MAX_FILE_BYTES) throw new AppError(`技能文件超过 256 KB：${name}`, 422);
    if (compressedSize > MAX_FILE_BYTES * 2) throw new AppError(`ZIP 压缩条目异常：${name}`, 422);
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new AppError("ZIP 本地文件头损坏", 422);
    const localName = buffer.readUInt16LE(localOffset + 26);
    const localExtra = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localName + localExtra;
    if (dataStart + compressedSize > buffer.length) throw new AppError("ZIP 文件数据被截断", 422);
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    let content: Buffer;
    if (method === 0) content = compressed;
    else if (method === 8) {
      try { content = inflateRawSync(compressed, { maxOutputLength: MAX_FILE_BYTES }); }
      catch { throw new AppError(`ZIP 条目解压失败：${name}`, 422); }
    } else throw new AppError(`ZIP 使用了不支持的压缩算法（${method}）：${name}`, 422);
    if (content.length !== uncompressedSize) throw new AppError(`ZIP 条目大小不一致：${name}`, 422);
    files.push({ path: name, content: content.toString("utf8") });
  }
  return skillFromTextFiles(files);
}
