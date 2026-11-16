import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AppError, type Row } from "./types.js";
import type { ImportedSkill } from "./skills.js";
import { storagePaths } from "./storage-paths.js";
import type { Store } from "./store.js";

const META_FILE = ".webagent-skill.json";
const TEXT_FILE = /\.(md|txt|json|ya?ml|csv)$/i;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_FILES = 200;

export interface SkillEntry {
  id: string;
  slug: string;
  name: string;
  description: string;
  content: string;
  files: Record<string, string>;
  enabled: boolean;
  source: "builtin" | "imported" | "custom";
  metadata: Row;
  path: string;
}

export interface SkillLibraryOptions {
  enabled?: boolean;
  builtin?: boolean;
  imported?: boolean;
}

function safeRelative(value: string) {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0")) throw new AppError(`技能文件路径无效：${value}`, 422);
  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === "..")) throw new AppError(`技能文件包含路径穿越：${value}`, 422);
  if (!TEXT_FILE.test(normalized)) throw new AppError(`技能文件只允许文本（md/txt/json/yaml/yml/csv）：${value}`, 422);
  return parts.join("/");
}

function safeSlug(value: string) {
  const slug = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) throw new AppError("技能 slug 必须是小写字母、数字和短横线，最长 80 个字符", 422);
  return slug;
}

function parseFrontmatter(content: string) {
  if (!content.startsWith("---")) return { body: content, fields: {} as Row };
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!match) return { body: content, fields: {} as Row };
  const fields: Row = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (field) fields[field[1]] = field[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return { body: content.slice(match[0].length), fields };
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export class SkillLibrary {
  readonly root: string;
  private readonly runtimeRoot: string;

  constructor(readonly dataDir: string) {
    const paths = storagePaths(dataDir);
    this.root = paths.skills;
    this.runtimeRoot = paths.skillRuntime;
  }

  initialize(store: Store) {
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    this.migrateLegacy(store);
    this.removeLegacyDemoSkill();
  }

  /** 旧演示版本会内置「设备巡检」Skill；只删除仍带 builtin 标记的同名种子，不碰用户自建内容。 */
  private removeLegacyDemoSkill() {
    const dir = this.skillPath("device-inspection");
    if (fs.existsSync(dir)) {
      if (this.readMeta(dir).builtin !== true) return;
      fs.rmSync(dir, { recursive: true, force: true });
    }
    // 运行副本是派生数据；删掉含旧 Skill 的物化目录，下次运行会按当前列表重新生成。
    if (!fs.existsSync(this.runtimeRoot)) return;
    for (const item of fs.readdirSync(this.runtimeRoot, { withFileTypes: true })) {
      if (item.isDirectory() && fs.existsSync(path.join(this.runtimeRoot, item.name, "device-inspection"))) fs.rmSync(path.join(this.runtimeRoot, item.name), { recursive: true, force: true });
    }
  }

  private skillPath(slug: string) {
    return path.join(this.root, safeSlug(slug));
  }

  has(slug: string) {
    return fs.existsSync(path.join(this.skillPath(slug), "SKILL.md"));
  }

  private readMeta(dir: string): Row {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, META_FILE), "utf8"));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  private writeMeta(dir: string, value: Row) {
    const temporary = path.join(dir, `${META_FILE}.${process.pid}.tmp`);
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, path.join(dir, META_FILE));
  }

  private readFiles(dir: string, skipSkill = true) {
    const result: Record<string, string> = {};
    let total = 0;
    const walk = (current: string, relative = "") => {
      for (const item of fs.readdirSync(current, { withFileTypes: true })) {
        if (item.name === META_FILE || item.name === "manifest.json") continue;
        const rel = path.posix.join(relative, item.name);
        if (skipSkill && rel === "SKILL.md") continue;
        if (item.isSymbolicLink()) throw new AppError(`技能目录不允许符号链接：${rel}`, 422);
        if (item.isDirectory()) {
          if (item.name === "node_modules" || item.name === ".git") continue;
          walk(path.join(current, item.name), rel);
          continue;
        }
        if (!item.isFile() || !TEXT_FILE.test(rel)) continue;
        const file = path.join(current, item.name);
        const stat = fs.statSync(file);
        if (stat.size > MAX_FILE_BYTES) throw new AppError(`技能文件超过 256 KB：${rel}`, 422);
        total += stat.size;
        if (total > MAX_TOTAL_BYTES) throw new AppError("技能参考文件总大小不能超过 4 MB", 422);
        result[rel] = fs.readFileSync(file, "utf8");
      }
    };
    walk(dir);
    if (Object.keys(result).length > MAX_FILES) throw new AppError(`技能文件数量不能超过 ${MAX_FILES}`, 422);
    return result;
  }

  private readEntry(slug: string): SkillEntry | undefined {
    const dir = this.skillPath(slug);
    const manifest = path.join(dir, "SKILL.md");
    if (!fs.existsSync(manifest)) return undefined;
    const parsed = parseFrontmatter(fs.readFileSync(manifest, "utf8"));
    const meta = this.readMeta(dir);
    const name = String(parsed.fields.name || meta.name || slug).trim();
    const description = String(parsed.fields.description || meta.description || "").trim();
    if (!name || !description) return undefined;
    const files = this.readFiles(dir);
    return {
      id: slug,
      slug,
      name: name.slice(0, 100),
      description: description.slice(0, 1000),
      content: parsed.body.trim() || description,
      files,
      enabled: meta.enabled !== false,
      source: meta.builtin ? "builtin" : meta.imported ? "imported" : "custom",
      metadata: { ...meta, frontmatter: parsed.fields, file_count: Object.keys(files).length },
      path: dir,
    };
  }

  list() {
    if (!fs.existsSync(this.root)) return [];
    return fs.readdirSync(this.root, { withFileTypes: true })
      .filter((item) => item.isDirectory() && !item.name.startsWith("."))
      .flatMap((item) => {
        try {
          const entry = this.readEntry(item.name);
          return entry ? [entry] : [];
        } catch {
          return [];
        }
      })
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  }

  get(slug: string) {
    return this.list().find((skill) => skill.slug === safeSlug(slug));
  }

  activeForAssistant(assistant: Row) {
    const selected = Array.isArray(assistant.skill_slugs) ? assistant.skill_slugs.map(String) : [];
    return this.list().filter((skill) => skill.enabled && (!selected.length || selected.includes(skill.slug)));
  }

  saveImported(skill: ImportedSkill, options: SkillLibraryOptions = {}) {
    const slug = safeSlug(skill.slug);
    const target = this.skillPath(slug);
    const existed = this.has(slug);
    const previous = this.readMeta(target);
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    fs.rmSync(temporary, { recursive: true, force: true });
    fs.mkdirSync(path.join(temporary, "SKILL.md").replace(/\/SKILL\.md$/, ""), { recursive: true, mode: 0o700 });
    try {
      const title = String(skill.name || "").trim();
      const description = String(skill.description || "").trim();
      if (!title || title.length > 100) throw new AppError("SKILL.md 需要 1–100 字符的 name", 422);
      if (!description || description.length > 1000) throw new AppError("SKILL.md 需要 1–1000 字符的 description", 422);
      fs.writeFileSync(path.join(temporary, "SKILL.md"), `---\nname: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(description)}\n---\n\n${String(skill.content || description).trim()}\n`, { mode: 0o600 });
      for (const [relative, content] of Object.entries(skill.files || {})) {
        if (relative === "SKILL.md") continue;
        const clean = safeRelative(relative);
        if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw new AppError(`技能文件超过 256 KB：${clean}`, 422);
        const output = path.resolve(temporary, clean);
        if (!output.startsWith(`${path.resolve(temporary)}${path.sep}`)) throw new AppError("技能文件路径越界", 422);
        fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
        fs.writeFileSync(output, content, { mode: 0o600 });
      }
      const metadata = {
        enabled: options.enabled ?? (existed ? previous.enabled !== false : true),
        builtin: options.builtin ?? Boolean(previous.builtin || skill.metadata?.builtin),
        imported: options.imported ?? Boolean(previous.imported || skill.metadata?.imported),
        updated_at: new Date().toISOString(),
      };
      this.writeMeta(temporary, metadata);
      fs.rmSync(target, { recursive: true, force: true });
      fs.renameSync(temporary, target);
    } catch (error) {
      fs.rmSync(temporary, { recursive: true, force: true });
      throw error;
    }
    return this.get(slug)!;
  }

  save(input: { slug: string; name: string; description?: string; content?: string; files?: Record<string, string>; enabled?: boolean; metadata?: Row }) {
    return this.saveImported({
      slug: input.slug,
      name: input.name,
      description: input.description || "",
      content: input.content || "",
      files: input.files || {},
      metadata: input.metadata || {},
    }, { enabled: input.enabled });
  }

  setEnabled(slug: string, enabled: boolean) {
    const dir = this.skillPath(slug);
    if (!this.has(slug)) throw new AppError("技能不存在", 404);
    const meta = this.readMeta(dir);
    this.writeMeta(dir, { ...meta, enabled });
    return this.get(slug)!;
  }

  remove(slug: string) {
    const dir = this.skillPath(slug);
    if (!this.has(slug)) throw new AppError("技能不存在", 404);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  materialize(assistantId: number, skills: SkillEntry[]) {
    if (!skills.length) return undefined;
    const signature = hash(JSON.stringify(skills.map((skill) => ({
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      content: skill.content,
      files: skill.files,
    }))));
    const root = path.join(this.runtimeRoot, `assistant-${assistantId}-${signature.slice(0, 16)}`);
    if (fs.existsSync(path.join(root, "manifest.json"))) return root;
    const temporary = `${root}.${process.pid}.${Date.now()}.tmp`;
    fs.rmSync(temporary, { recursive: true, force: true });
    fs.mkdirSync(temporary, { recursive: true, mode: 0o700 });
    try {
      for (const skill of skills) {
        const dir = path.join(temporary, safeSlug(skill.slug));
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${JSON.stringify(skill.slug)}\ndescription: ${JSON.stringify(skill.description)}\n---\n\n${skill.content}\n`, { mode: 0o600 });
        for (const [relative, content] of Object.entries(skill.files)) {
          const clean = safeRelative(relative);
          const output = path.resolve(dir, clean);
          if (!output.startsWith(`${path.resolve(dir)}${path.sep}`)) continue;
          fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
          fs.writeFileSync(output, content, { mode: 0o600 });
        }
      }
      fs.writeFileSync(path.join(temporary, "manifest.json"), JSON.stringify({ assistant_id: assistantId, signature, skills: skills.map((skill) => skill.slug) }), { mode: 0o600 });
      fs.renameSync(temporary, root);
    } catch (error) {
      fs.rmSync(temporary, { recursive: true, force: true });
      throw error;
    }
    return root;
  }

  private migrateLegacy(store: Store) {
    let rows: Row[] = [];
    try { rows = store.all("SELECT * FROM skills"); } catch { return; }
    if (!rows.length) {
      try { store.run("DROP TABLE IF EXISTS skills"); } catch { /* A read-only legacy database can keep the empty table. */ }
      return;
    }
    fs.writeFileSync(path.join(this.root, ".legacy-skills.json"), JSON.stringify(rows, null, 2), { mode: 0o600 });
    const mapped = new Map<number, string>();
    const failed: Array<{ id: unknown; name: unknown; error: string }> = [];
    for (const [index, row] of rows.entries()) {
      try {
        let slug: string;
        try {
          slug = safeSlug(String(row.slug || ""));
        } catch {
          const normalized = String(row.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
          slug = /^[a-z0-9]/.test(normalized) ? normalized : `legacy-skill-${row.id ?? index + 1}`;
        }
        mapped.set(Number(row.id), slug);
        if (!this.has(slug)) {
          const files = row.files && typeof row.files === "object" && !Array.isArray(row.files) ? row.files as Record<string, string> : {};
          this.saveImported({
            slug,
            name: String(row.name || slug).slice(0, 100),
            description: String(row.description || row.content || "从旧数据库迁移的技能").slice(0, 1000),
            content: String(row.content || ""),
            files,
            metadata: { ...(row.metadata || {}), legacy: true },
          }, { enabled: row.enabled !== false, builtin: Boolean(row.metadata?.builtin), imported: true });
        }
      } catch (error) {
        failed.push({ id: row.id, name: row.name, error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (failed.length) {
      console.warn(`[skills] ${failed.length} 条旧数据库技能未能迁移，已保留 skills 表以免数据丢失；备份：${path.join(this.root, ".legacy-skills.json")}`, failed);
      return;
    }
    for (const assistant of store.assistants()) {
      const current = Array.isArray(assistant.skill_slugs) ? assistant.skill_slugs : [];
      if (current.length || !Array.isArray(assistant.skill_ids) || !assistant.skill_ids.length) continue;
      const slugs = assistant.skill_ids.map((id: unknown) => mapped.get(Number(id))).filter((slug: string | undefined): slug is string => Boolean(slug));
      store.config.updateAssistant(Number(assistant.id), { skill_slugs: slugs });
    }
    store.run("DELETE FROM skills");
    try { store.run("DROP TABLE skills"); } catch { /* Keep the empty table if the database is read-only. */ }
  }
}
