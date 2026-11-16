import fs from "node:fs";
import path from "node:path";
import { AppError, type Row } from "./types.js";

interface ConversationFile {
  version: 1;
  next_id: number;
  messages: Row[];
  pi_entries: Row[];
}

type LegacyStore = {
  all: (sql: string, values?: unknown[]) => Row[];
  run: (sql: string, values?: unknown[]) => unknown;
};

const now = () => new Date().toISOString();

export class ConversationStore {
  readonly root: string;

  constructor(readonly dataDir: string) {
    this.root = path.join(dataDir, "conversations");
  }

  initialize(store: LegacyStore) {
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    this.migrateLegacy(store);
  }

  private file(sessionId: string) {
    const id = String(sessionId || "");
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) throw new AppError("会话 ID 无效", 422);
    return path.join(this.root, `${id}.json`);
  }

  private empty(): ConversationFile {
    return { version: 1, next_id: 1, messages: [], pi_entries: [] };
  }

  private read(sessionId: string): ConversationFile {
    const file = this.file(sessionId);
    if (!fs.existsSync(file)) return this.empty();
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      const messages = Array.isArray(parsed?.messages) ? parsed.messages.map((message: Row) => ({
        reasoning: "",
        attachments: [],
        tool_runs: [],
        metadata: {},
        token_estimate: 0,
        ...message,
      })) : [];
      const maxId = messages.reduce((maximum: number, message: Row) => Math.max(maximum, Number(message.id) || 0), 0);
      return {
        version: 1,
        next_id: Math.max(Number(parsed?.next_id) || 1, maxId + 1),
        messages,
        pi_entries: Array.isArray(parsed?.pi_entries) ? parsed.pi_entries : [],
      };
    } catch (error) {
      throw new AppError(`会话文件损坏：${sessionId}（${error instanceof Error ? error.message : "无法读取"}）`, 500);
    }
  }

  private write(sessionId: string, value: ConversationFile) {
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const target = this.file(sessionId);
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
    fs.renameSync(temporary, target);
  }

  messages(sessionId: string, afterId = 0) {
    return this.read(sessionId).messages
      .filter((message) => Number(message.id) > afterId)
      .sort((left, right) => Number(left.id) - Number(right.id));
  }

  message(sessionId: string, id: number) {
    return this.read(sessionId).messages.find((message) => Number(message.id) === Number(id));
  }

  latestAssistant(sessionId: string, predicate?: (message: Row) => boolean) {
    return [...this.read(sessionId).messages]
      .filter((message) => message.role === "assistant" && (!predicate || predicate(message)))
      .sort((left, right) => Number(right.id) - Number(left.id))[0];
  }

  insert(sessionId: string, values: Row) {
    const data = this.read(sessionId);
    const message: Row = { ...values, id: data.next_id++, created_at: values.created_at || now() };
    data.messages.push(message);
    this.write(sessionId, data);
    return message;
  }

  update(sessionId: string, id: number, values: Row) {
    const data = this.read(sessionId);
    const index = data.messages.findIndex((message) => Number(message.id) === Number(id));
    if (index < 0) return undefined;
    data.messages[index] = { ...data.messages[index], ...values, id: data.messages[index].id };
    this.write(sessionId, data);
    return data.messages[index];
  }

  deleteFrom(sessionId: string, id: number, inclusive: boolean) {
    const data = this.read(sessionId);
    const before = data.messages.length;
    data.messages = data.messages.filter((message) => inclusive ? Number(message.id) < Number(id) : Number(message.id) <= Number(id));
    if (data.messages.length !== before) this.write(sessionId, data);
    return before - data.messages.length;
  }

  clear(sessionId: string) {
    const data = this.read(sessionId);
    data.messages = [];
    data.next_id = 1;
    data.pi_entries = [];
    this.write(sessionId, data);
  }

  delete(sessionId: string) {
    fs.rmSync(this.file(sessionId), { force: true });
  }

  count(sessionId: string) {
    return this.read(sessionId).messages.length;
  }

  totalMessages() {
    return this.sessionIds().reduce((total, id) => total + this.count(id), 0);
  }

  allMessages() {
    return this.sessionIds().flatMap((sessionId) => this.messages(sessionId).map((message) => ({ ...message, session_id: sessionId })));
  }

  allPiEntries() {
    return this.sessionIds().flatMap((sessionId) => this.piEntries(sessionId).map((entry) => ({ ...entry, session_id: sessionId })));
  }

  piEntries(sessionId: string) {
    return this.read(sessionId).pi_entries;
  }

  savePiEntries(sessionId: string, entries: Row[]) {
    const data = this.read(sessionId);
    data.pi_entries = entries;
    this.write(sessionId, data);
  }

  clearPiEntries(sessionId: string) {
    const data = this.read(sessionId);
    if (!data.pi_entries.length) return;
    data.pi_entries = [];
    this.write(sessionId, data);
  }

  stripReasoning() {
    for (const sessionId of this.sessionIds()) {
      const data = this.read(sessionId);
      let changed = false;
      for (const message of data.messages) {
        if (message.reasoning) {
          message.reasoning = "";
          changed = true;
        }
      }
      for (const entry of data.pi_entries) {
        if (entry.message?.role !== "assistant" || !Array.isArray(entry.message.content)) continue;
        const content = entry.message.content.filter((part: Row) => part.type !== "thinking");
        if (content.length !== entry.message.content.length) {
          entry.message.content = content;
          changed = true;
        }
      }
      if (changed) this.write(sessionId, data);
    }
  }

  sessionIds() {
    if (!fs.existsSync(this.root)) return [];
    return fs.readdirSync(this.root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith("."))
      .map((entry) => entry.name.slice(0, -5));
  }

  bytes() {
    if (!fs.existsSync(this.root)) return 0;
    return fs.readdirSync(this.root, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .reduce((total, entry) => total + fs.statSync(path.join(this.root, entry.name)).size, 0);
  }

  private migrateLegacy(store: LegacyStore) {
    let messages: Row[] = [];
    let states: Row[] = [];
    try { messages = store.all("SELECT * FROM messages ORDER BY session_id,id"); } catch { return; }
    try { states = store.all("SELECT * FROM pi_state"); } catch { /* A legacy database may only have messages. */ }
    if (!messages.length && !states.length) {
      try { store.run("DROP TABLE IF EXISTS messages"); store.run("DROP TABLE IF EXISTS pi_state"); } catch { /* read-only legacy DB */ }
      return;
    }
    fs.writeFileSync(path.join(this.root, ".legacy-conversations.json"), JSON.stringify({ messages, pi_state: states }, null, 2), { mode: 0o600 });
    try {
      const sessionIds = new Set([...messages.map((message) => String(message.session_id)), ...states.map((state) => String(state.session_id))]);
      for (const sessionId of sessionIds) {
        const existing = this.read(sessionId);
        const merged = new Map(existing.messages.map((message) => [Number(message.id), message]));
        for (const message of messages.filter((item) => String(item.session_id) === sessionId)) merged.set(Number(message.id), message);
        const ordered = [...merged.values()].sort((left, right) => Number(left.id) - Number(right.id));
        const state = states.find((item) => String(item.session_id) === sessionId);
        this.write(sessionId, {
          version: 1,
          next_id: ordered.reduce((maximum, message) => Math.max(maximum, Number(message.id) + 1), 1),
          messages: ordered,
          pi_entries: state?.entries?.length ? state.entries : existing.pi_entries,
        });
      }
      store.run("DROP TABLE IF EXISTS messages");
      try { store.run("DROP TABLE IF EXISTS pi_state"); } catch { /* The index is dropped with messages. */ }
    } catch (error) {
      console.warn(`[conversations] 旧消息迁移失败，数据库表已保留；备份：${path.join(this.root, ".legacy-conversations.json")}`, error);
    }
  }
}
