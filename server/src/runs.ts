import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { FastifyReply } from "fastify";
import { Auth } from "./auth.js";
import { PiRuntime, type ChatInput } from "./pi-runtime.js";
import { Store, now } from "./store.js";
import { AppError, type Emit, type Identity, type Row } from "./types.js";

interface RunEvent { id: number; name: string; payload: Row }
interface LiveRun { events: RunEvent[]; bus: EventEmitter; controller: AbortController; result?: Row; task?: Promise<Row>; expires: number }
export class Runs {
  private live = new Map<string, LiveRun>();
  private sweep = setInterval(() => this.purge(), 60000);
  constructor(private store: Store, private auth: Auth, private runtime: PiRuntime) { this.sweep.unref(); }
  private purge() { for (const [key, value] of this.live) if (value.result && value.expires < Date.now()) this.live.delete(key); }
  async start(credential: string, input: ChatInput, presetUser?: Identity) {
    const user = presetUser || await this.auth.identity(credential);
    const session = input.session_id ? this.store.ownedSession(input.session_id, user) : this.runtime.createSession(user, input);
    return this.launch(user, session, (_id, signal, emit) => this.runtime.run(credential, { ...input, session_id: session.id }, signal, emit, undefined, user));
  }
  async approval(credential: string, approvalId: string, accepted: boolean, presetUser?: Identity) {
    const user = presetUser || await this.auth.identity(credential);
    const session = this.runtime.approvalSession(user, approvalId);
    return this.launch(user, session, (id, signal, emit) => this.runtime.approve(user, credential, approvalId, accepted, signal, emit, id));
  }
  async answer(credential: string, questionId: string, input: Row, presetUser?: Identity) {
    const user = presetUser || await this.auth.identity(credential);
    const current = this.runtime.questionSession(user, questionId);
    if (input.cancel) {
      return { task: undefined, result: await this.runtime.answerQuestion(user, credential, questionId, input, new AbortController().signal, () => {}) };
    }
    this.runtime.validateAnswer(user, questionId, input);
    return this.launch(user, current.session, (id, signal, emit) => this.runtime.answerQuestion(user, credential, questionId, input, signal, emit, id));
  }
  async startWithListener(credential: string, input: ChatInput, listener: (name: string, payload: Row) => void, presetUser?: Identity) {
    const user = presetUser || await this.auth.identity(credential);
    const session = input.session_id ? this.store.ownedSession(input.session_id, user) : this.runtime.createSession(user, input);
    return this.launch(user, session, (id, signal, emit) => this.runtime.run(credential, { ...input, session_id: session.id }, signal, (name, payload) => {
      try { listener(name, payload); } catch {}
      emit(name, payload);
    }, undefined, user));
  }
  private launch(user: Identity, session: Row, task: (id: string, signal: AbortSignal, emit: Emit) => Promise<Row>) {
    this.store.assertIdle(session.id);
    if (this.store.one("SELECT count(*) AS n FROM runs WHERE owner_key=? AND status='running'", [user.owner_key])!.n >= 4) throw new AppError("当前账号已有多个运行任务", 429);
    if (this.store.one("SELECT count(*) AS n FROM runs WHERE status='running'")!.n >= 100) throw new AppError("运行服务繁忙，请稍后再试", 429);
    const id = randomUUID();
    this.purge();
    const live: LiveRun = { events: [], bus: new EventEmitter(), controller: new AbortController(), expires: Date.now() + 3600000 };
    live.bus.setMaxListeners(20); this.live.set(id, live);
    this.store.insert("runs", { id, session_id: session.id, user_id: user.id ?? null, owner_key: user.owner_key, status: "running", started_at: now() });
    const emit = (name: string, payload: Row) => {
      const transient = name === "decision.diagnostics" || name === "thinking.delta" && !this.store.settings().store_reasoning;
      const result = this.store.insert("run_events", { run_id: id, name, payload: transient ? { transient: true } : payload });
      const event = { id: result.id, name, payload };
      live.events.push(event);
      if (live.events.length > 20000) live.events.splice(0, 1000);
      live.bus.emit("event", event);
    };
    emit("run.started", { run_id: id, session_id: session.id });
    const timeout = setTimeout(() => live.controller.abort(), this.store.settings().max_run_seconds * 1000);
    live.task = task(id, live.controller.signal, emit).then((result) => {
      live.result = result; this.store.update("runs", id, { status: result.status === "cancelled" ? "cancelled" : result.status === "error" ? "failed" : "completed", completed_at: now() }); emit("run.completed", result); return result;
    }).catch((error) => {
      const cancelled = live.controller.signal.aborted;
      const message = cancelled ? "运行已取消或达到时长限制；请核对已执行工具的真实业务状态" : error instanceof AppError ? error.message : "运行异常，请管理员查看日志";
      const result = { status: cancelled ? "cancelled" : "error", message, session_id: session.id };
      live.result = result;
      this.store.update("runs", id, { status: cancelled ? "cancelled" : "failed", completed_at: now() }); this.store.update("sessions", session.id, { last_status: cancelled ? "cancelled" : "error", last_error: message });
      emit(cancelled ? "run.completed" : "run.failed", { ...result, status_code: error.statusCode || 500 });
      this.store.audit(user.username, cancelled ? "run.cancelled" : "run.failed", id, message); return result;
    }).finally(() => { clearTimeout(timeout); live.expires = Date.now() + 3600000; live.bus.emit("close"); });
    return { id, task: live.task, session_id: session.id };
  }
  owned(id: string, user: Identity) { const row = this.store.one("SELECT * FROM runs WHERE id=? AND owner_key=?", [id, user.owner_key]); if (!row) throw new AppError("运行不存在或不属于当前用户", 404); return row; }
  subscribe(id: string, user: Identity, reply: FastifyReply, after = 0) {
    const run = this.owned(id, user); const live = this.live.get(id);
    let cursor = Math.max(0, Number(after) || 0);
    reply.hijack();
    reply.raw.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "X-Run-Id": id, Connection: "keep-alive" });
    const send = (event: RunEvent) => {
      if (event.id <= cursor || reply.raw.destroyed) return;
      cursor = event.id;
      if (event.name === "decision.diagnostics" || event.payload.transient) return;
      if (reply.raw.writableLength > 2 * 1024 * 1024) { reply.raw.destroy(); return; }
      reply.raw.write(`id: ${event.id}\nevent: ${event.name}\ndata: ${JSON.stringify(event.payload)}\n\n`);
    };
    const end = () => { cleanup(); reply.raw.end(); };
    const heartbeat = setInterval(() => { if (!reply.raw.destroyed) reply.raw.write(": heartbeat\n\n"); }, 15000);
    const cleanup = () => { clearInterval(heartbeat); live?.bus.off("event", send); live?.bus.off("close", end); };
    reply.raw.on("close", cleanup);
    live?.bus.on("event", send); live?.bus.once("close", end);
    const cached = new Map(live?.events.map((event) => [event.id, event]) || []);
    for (const event of this.store.all("SELECT * FROM run_events WHERE run_id=? AND id>? ORDER BY id", [id, cursor])) send(cached.get(event.id) || { id: event.id, name: event.name, payload: event.payload });
    if (this.store.one("SELECT status FROM runs WHERE id=?", [id])?.status !== "running") {
      if (run.status === "interrupted") reply.raw.write(`event: run.failed\ndata: ${JSON.stringify({ message: "服务重启中断本次运行，历史已保存。请核对写操作状态后重新发起，不会自动重放工具。" })}\n\n`);
      end();
    }
  }
  cancel(id: string, user: Identity) { this.owned(id, user); const live = this.live.get(id); if (!live) throw new AppError("运行不在当前进程中", 409); live.controller.abort(); return { ok: true }; }
  diagnostics(id: string) { const run = this.store.one("SELECT * FROM runs WHERE id=?", [id]); if (!run) throw new AppError("运行不存在", 404); const content = this.store.settings().admin_session_content; const events = this.live.get(id)?.events || this.store.all("SELECT * FROM run_events WHERE run_id=? ORDER BY id", [id]); return { run, events: events.filter((event) => (event.name === "decision.diagnostics" && content || ["decision.completed", "step.started", "retry"].includes(event.name)) && !event.payload.transient), calls: this.store.all("SELECT * FROM llm_calls WHERE session_id=? AND created_at>=? AND created_at<=? ORDER BY id", [run.session_id, run.started_at, run.completed_at || now()]), diagnostics_persisted: false, content_available: Boolean(content && this.live.has(id)) }; }
  async shutdown() { clearInterval(this.sweep); for (const live of this.live.values()) live.controller.abort(); await Promise.all([...this.live.values()].map((live) => live.task)); this.live.clear(); }
}
