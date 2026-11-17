import type { FastifyInstance } from "fastify";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { Auth, parseCookies } from "./auth.js";
import { Store } from "./store.js";
import { Runs } from "./runs.js";
import { Speech, pcmToWav } from "./speech.js";
import { drainSpeechText, isLikelyEcho, speakableText } from "./speech-text.js";
import { AppError, type Identity, type Row } from "./types.js";
import { PiRuntime } from "./pi-runtime.js";
import { effectiveAssistantConfig } from "./assistant-config.js";

const PATH = "/api/agent/voice/stream";
const DICTATION_PATH = "/api/agent/voice/dictate";
const VOICE_PROTOCOL = "webagent.voice";
const TOKEN_PROTOCOL_PREFIX = "webagent.token.";

export function voiceCredential(request: IncomingMessage): string {
  const protocols = String(request.headers["sec-websocket-protocol"] || "")
    .split(",")
    .map((value) => value.trim());
  const carried = protocols.find((value) => value.startsWith(TOKEN_PROTOCOL_PREFIX));
  if (!carried) return "";
  const encoded = carried.slice(TOKEN_PROTOCOL_PREFIX.length);
  // 浏览器可自定义的子协议必须是 token 字符；客户端把凭据做 base64url 编码，避免特殊字符导致握手失败。
  try {
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    return /^[\x20-\x7e]{1,8192}$/.test(decoded) ? decoded : encoded;
  } catch {
    return encoded;
  }
}

class Dictation {
  private closed = false;
  private started = false;
  private controller = new AbortController();
  private stream?: Awaited<ReturnType<Speech["openAsrRealtime"]>>;
  private partial = "";
  private bytes = 0;
  constructor(
    private socket: WebSocket,
    private user: Identity,
    private sessionId: string,
    private assistantId: number,
    private store: Store,
    private speech: Speech,
  ) {}
  private send(message: Row) { if (!this.closed && this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message)); }
  async start() {
    if (this.started) return;
    this.started = true;
    this.store.ownedSession(this.sessionId, this.user);
    const settings = this.store.settings();
    const assistant = this.store.assistant(this.assistantId);
    const effective = effectiveAssistantConfig(assistant, settings);
    const model = this.store.model(effective.asr_realtime_model_id || 0);
    if (!model?.enabled || !model.provider_enabled || model.model_kind !== "asr_realtime") throw new AppError("管理员尚未配置可用的实时 STT 模型", 422);
    this.stream = await this.speech.openAsrRealtime(model, "zh", (text) => {
      if (text.startsWith(this.partial)) this.partial = text;
      else this.partial += text;
      this.send({ type: "asr.partial", text: this.partial });
    }, this.controller.signal);
    this.send({ type: "ready", model: model.name, sample_rate: 16000 });
  }
  audio(base64: string) {
    if (!this.stream || this.closed) return;
    const bytes = Buffer.from(base64, "base64");
    if (!bytes.length || bytes.length % 2) return;
    this.bytes += bytes.length;
    if (this.bytes > 2 * 1024 * 1024) throw new AppError("单次语音输入不能超过约 60 秒", 422);
    this.stream.append(bytes);
  }
  async commit() {
    if (!this.stream) throw new AppError("实时语音识别尚未就绪", 409);
    const stream = this.stream;
    this.stream = undefined;
    let transcript = "";
    let timer: NodeJS.Timeout | undefined;
    const finishing = stream.finish();
    // 超时后 finish() 仍可能因为 socket 被关闭而拒绝；提前挂上处理器避免进程级未捕获异常。
    void finishing.catch(() => {});
    try {
      transcript = (await Promise.race([
        finishing,
        new Promise<string>((resolve) => { timer = setTimeout(() => resolve(""), 8000); }),
      ])).trim();
    } catch {
      transcript = "";
    } finally {
      if (timer) clearTimeout(timer);
      stream.close();
      this.bytes = 0;
      this.partial = "";
    }
    if (!transcript) this.send({ type: "asr.empty" });
    else this.send({ type: "asr.final", text: transcript });
  }
  close() {
    this.closed = true;
    this.stream?.close();
    this.controller.abort();
  }
}

class SpeechQueue {
  private sentences: string[] = [];
  private work = Promise.resolve();
  private realtimePromise?: Promise<Awaited<ReturnType<Speech["openTtsRealtime"]>>>;
  private realtimeSession?: Awaited<ReturnType<Speech["openTtsRealtime"]>>;
  private realtimeController = new AbortController();
  private raw = "";
  private emitted = "";
  private pending = "";
  private closed = false;
  private spoke = false;
  private realtimeSampleRate = 24000;
  private cancelSynthesis?: AbortController;
  constructor(private speech: Speech, private model: Row, private send: (message: Row) => void, private realtime: boolean, private cancellable = false, private context: { sessionId?: string; username?: string } = {}) {}
  prewarm() {
    if (!this.realtime || this.closed) return;
    void this.ensureRealtime().catch(() => {});
  }
  feed(delta: string) {
    if (this.closed) return;
    this.raw += delta;
    const filtered = speakableText(this.raw);
    if (filtered.startsWith(this.emitted)) {
      this.pending += filtered.slice(this.emitted.length);
    } else {
      let common = 0;
      const max = Math.min(filtered.length, this.emitted.length);
      while (common < max && filtered[common] === this.emitted[common]) common++;
      this.pending += filtered.slice(common);
    }
    this.emitted = filtered;
    // 实时通话需要更短的句子才能尽快出首包；文件合成可以攒长一点，减少请求次数。
    const drained = drainSpeechText(this.pending, this.realtime ? 36 : 100);
    this.pending = drained.rest;
    if (!drained.chunks.length) return;
    this.sentences.push(...drained.chunks);
    this.spoke = true;
    if (this.realtime) this.flushRealtime();
    else this.flushAudio();
  }
  private flushRealtime() {
    const sentences = this.sentences.splice(0);
    if (!sentences.length) return;
    this.work = this.work.then(async () => {
      const session = await this.ensureRealtime();
      for (const sentence of sentences) session.append(sentence);
    }).catch((error) => { if (!this.closed) this.send({ type: "tts.error", message: error instanceof Error ? error.message : "实时语音合成失败" }); });
  }
  private async ensureRealtime() {
    if (this.closed) throw new AppError("语音合成已取消", 499);
    if (this.realtimeSession) return this.realtimeSession;
    if (!this.realtimePromise) this.realtimePromise = this.speech.openTtsRealtime(this.model, (bytes) => {
      this.send({ type: "tts.audio", audio: bytes.toString("base64"), format: "pcm", sample_rate: this.realtimeSampleRate });
    }, this.realtimeController.signal).catch((error) => {
      this.realtimePromise = undefined;
      throw error;
    });
    const session = await this.realtimePromise;
    this.realtimeSampleRate = Number((session as Row).sample_rate) || 24000;
    this.realtimeSession = session;
    return this.realtimeSession;
  }
  private flushAudio() {
    const sentences = this.sentences.splice(0);
    if (!sentences.length) return;
    this.work = this.work.then(async () => {
      for (const sentence of sentences) {
        if (this.closed) return;
        for (let offset = 0; offset < sentence.length; offset += 600) {
          const part = sentence.slice(offset, offset + 600);
          this.cancelSynthesis ??= new AbortController();
          const result = await this.speech.synthesize(this.model, part, {}, this.cancelSynthesis.signal, this.context);
          if (this.closed) return;
          this.send({ type: "tts.audio", audio: result.bytes.toString("base64"), mime_type: result.mime_type, format: result.mime_type === "audio/pcm" ? "pcm" : "file", sample_rate: (result as Row).sample_rate });
        }
      }
    }).catch((error) => { if (!this.closed) this.send({ type: "tts.error", message: error instanceof Error ? error.message : "语音合成失败" }); });
  }
  async finish() {
    if (this.closed) return;
    this.feed("\n");
    const tail = this.pending.trim();
    if (tail.length >= 2) { this.sentences.push(tail.slice(0, 1200)); this.spoke = true; }
    this.pending = "";
    if (!this.spoke) { this.close(); return; }
    if (this.realtime) {
      this.flushRealtime();
      await this.work;
      if (this.closed) return;
      const session = await this.ensureRealtime().catch((error) => { if (!this.closed) this.send({ type: "tts.error", message: error instanceof Error ? error.message : "实时语音合成失败" }); return undefined; });
      if (session && !this.closed) {
        try { await session.finish(); }
        catch (error) { if (!this.closed) throw error; }
      }
    } else {
      this.flushAudio();
      await this.work;
    }
    this.closed = true;
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.sentences = [];
    this.pending = "";
    this.raw = "";
    this.emitted = "";
    // Detach the abort listener before cancelling so an intentional close is not
    // reported as a synthesis failure.
    this.realtimeSession?.close();
    this.realtimeController.abort();
    this.cancelSynthesis?.abort();
  }
}

class VoiceCall {
  private closed = false;
  private started = false;
  private config: Row = {};
  private asrStream?: Awaited<ReturnType<Speech["openAsrRealtime"]>>;
  private asrPromise?: Promise<Awaited<ReturnType<Speech["openAsrRealtime"]>> | undefined>;
  private asrController?: AbortController;
  private asrChain = Promise.resolve();
  private asrBuffer: Buffer[] = [];
  private asrBytes = 0;
  private partial = "";
  private activeRun?: { id: string; task: Promise<Row> };
  private turn = 0;
  private busyNoticeAt = 0;
  private lastSpoken = "";
  private spokenAt = 0;
  private tts?: SpeechQueue;
  constructor(
    private socket: WebSocket,
    private request: IncomingMessage,
    private user: Identity,
    private credential: string,
    private sessionId: string,
    private store: Store,
    private speech: Speech,
    private runs: Runs,
    private runtime: PiRuntime,
  ) {}
  private send(message: Row) { if (!this.closed && this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message)); }
  private error(message: string, code = "voice_error") { this.send({ type: "error", code, message }); }
  async start(input: Row) {
    if (this.started) return;
    this.started = true;
    const session = this.store.ownedSession(this.sessionId, this.user);
    const settings = this.store.settings();
    const assistant = this.runtime.assistant(this.user, Number(input.assistant_id) || session.assistant_id || undefined);
    const effective = effectiveAssistantConfig(assistant, settings);
    const asr = this.store.model(effective.voice_asr_model_id || effective.asr_realtime_model_id || 0);
    const tts = this.store.model(effective.voice_tts_model_id || effective.tts_model_id || 0);
    if (!asr?.enabled || !asr.provider_enabled || !["asr_realtime", "asr"].includes(asr.model_kind)) throw new AppError("管理员尚未配置可用实时通话 STT 模型", 422);
    if (!tts?.enabled || !tts.provider_enabled || !["tts_realtime", "tts"].includes(tts.model_kind)) throw new AppError("管理员尚未配置可用实时通话 TTS 模型", 422);
    this.config = { session, asr, tts, model_row_id: input.model_row_id, assistant_id: assistant.id, enabled_tools: input.enabled_tools, reasoning_effort: input.reasoning_effort, approval_mode: input.approval_mode };
    this.send({ type: "ready", session_id: this.sessionId, assistant_id: this.config.assistant_id, asr: asr.name, tts: tts.name, tts_realtime: tts.model_kind === "tts_realtime" || this.store.provider(tts.provider_id) && String(tts.extra_params?._tts?.protocol || "") === "realtime", sample_rate: 16000 });
    this.prewarmAsr();
  }
  private prewarmAsr() {
    if (this.closed || this.config.asr?.model_kind !== "asr_realtime" || this.asrStream || this.asrPromise) return;
    void this.ensureAsr();
  }
  private async ensureAsr() {
    if (this.config.asr.model_kind !== "asr_realtime") return undefined;
    if (this.asrStream) return this.asrStream;
    if (!this.asrPromise) {
      const controller = new AbortController();
      this.asrController = controller;
      this.asrPromise = this.speech.openAsrRealtime(this.config.asr, "zh", (text) => {
        this.partial += text;
        this.send({ type: "asr.partial", text: this.partial });
      }, controller.signal).catch((error) => {
        this.asrPromise = undefined; this.asrStream = undefined;
        if (!controller.signal.aborted) this.error(error instanceof Error ? error.message : "实时语音识别连接失败");
        return undefined;
      });
    }
    this.asrStream = await this.asrPromise;
    return this.asrStream;
  }
  audio(base64: string) {
    if (this.activeRun) {
      const now = Date.now();
      if (now - this.busyNoticeAt > 1500) { this.busyNoticeAt = now; this.send({ type: "status", state: "thinking", label: "正在处理上一句话" }); }
      return;
    }
    const bytes = Buffer.from(base64, "base64");
    if (!bytes.length || bytes.length % 2) return;
    if (this.config.asr.model_kind !== "asr_realtime" && this.asrBytes > 2 * 1024 * 1024) return;
    if (this.config.asr.model_kind === "asr_realtime") { this.asrBytes += bytes.length; this.asrBuffer = []; }
    else { this.asrBytes += bytes.length; this.asrBuffer.push(bytes); }
    if (this.config.asr.model_kind === "asr_realtime") {
      this.asrChain = this.asrChain.then(async () => {
        const stream = await this.ensureAsr();
        stream?.append(bytes);
      }).catch((error) => {
        this.asrStream = undefined; this.asrPromise = undefined;
        this.error(error instanceof Error ? error.message : "实时语音识别失败");
      });
    }
  }
  async commit() {
    if (this.activeRun) {
      const now = Date.now();
      if (now - this.busyNoticeAt > 500) { this.busyNoticeAt = now; this.send({ type: "status", state: "thinking", label: "正在处理上一句话" }); }
      return;
    }
    if (!this.asrBuffer.length && this.config.asr.model_kind !== "asr_realtime") { this.error("没有收到有效语音", "empty_audio"); return; }
    this.send({ type: "status", state: "transcribing", label: "正在识别" });
    let transcript = "";
    try {
      if (this.config.asr.model_kind === "asr_realtime") {
        await this.asrChain;
        const stream = await this.ensureAsr();
        if (!stream) throw new AppError("实时语音识别连接不可用", 502);
        transcript = await stream.finish();
        this.asrStream = undefined; this.asrPromise = undefined;
        this.asrController?.abort();
        this.asrController = undefined;
      } else {
        const wav = pcmToWav(Buffer.concat(this.asrBuffer), 16000);
        const result = await this.speech.transcribe(this.config.asr, `data:audio/wav;base64,${wav.toString("base64")}`, "zh", undefined, { sessionId: this.sessionId, username: this.user.username });
        transcript = result.text;
      }
    } catch (error) {
      this.asrStream = undefined; this.asrPromise = undefined; this.asrController = undefined;
      this.error(error instanceof Error ? error.message : "语音识别失败", "asr_error");
      this.resetUtterance();
      return;
    }
    this.resetUtterance();
    this.prewarmAsr();
    transcript = transcript.trim();
    if (!transcript) { this.send({ type: "asr.empty" }); return; }
    if (this.lastSpoken && Date.now() - this.spokenAt < 20000 && isLikelyEcho(transcript, this.lastSpoken)) {
      this.send({ type: "asr.echo", text: transcript });
      this.send({ type: "status", state: "listening", label: "检测到扬声器回声，已忽略" });
      return;
    }
    this.send({ type: "asr.final", text: transcript });
    await this.respond(transcript);
  }
  private resetUtterance() {
    this.asrBuffer = [];
    this.asrBytes = 0;
    this.partial = "";
  }
  cancelUtterance() {
    this.resetUtterance();
    this.asrStream?.close();
    this.asrStream = undefined;
    this.asrPromise = undefined;
    this.asrController?.abort();
    this.asrController = undefined;
    this.asrChain = Promise.resolve();
    this.send({ type: "asr.cancelled" });
  }
  private async respond(text: string) {
    const turn = ++this.turn;
    this.tts?.close();
    const ttsRealtime = this.config.tts.model_kind === "tts_realtime" || String(this.config.tts.extra_params?._tts?.protocol || "") === "realtime";
    const tts = new SpeechQueue(this.speech, this.config.tts, (message) => { if (turn === this.turn) this.send(message); }, ttsRealtime, true, { sessionId: this.sessionId, username: this.user.username });
    this.tts = tts;
    tts.prewarm();
    this.send({ type: "status", state: "thinking", label: "正在思考" });
    let answer = "";
    let lastTool = "";
    let answerDone = false;
    let ttsDone: Promise<void> | undefined;
    try {
      const run = await this.runs.startWithListener(this.credential, {
        session_id: this.sessionId,
        message: text,
        assistant_id: this.config.assistant_id,
        model_row_id: this.config.model_row_id,
        enabled_tools: this.config.enabled_tools,
        reasoning_effort: this.config.reasoning_effort,
        approval_mode: this.config.approval_mode,
      }, (name, payload) => {
        if (name === "text.delta" && payload.delta) { answer += payload.delta; this.send({ type: "assistant.delta", delta: payload.delta }); this.send({ type: "status", state: "speaking", label: "正在回答" }); tts.feed(payload.delta); }
        if (name === "answer.completed") { answerDone = true; this.lastSpoken = speakableText(answer); this.spokenAt = Date.now(); ttsDone = tts.finish(); void ttsDone.catch(() => {}); }
        if (name === "thinking.delta" && payload.delta) this.send({ type: "thinking.delta", delta: payload.delta });
        if (name === "tool.started") { lastTool = String(payload.tool || "工具"); this.send({ type: "tool", state: "started", tool: lastTool, arguments: payload.arguments }); this.send({ type: "status", state: "tool", label: `正在调用 ${lastTool}` }); }
        if (name === "tool.finished") this.send({ type: "tool", state: payload.status === "failed" ? "failed" : "finished", tool: String(payload.tool || lastTool), summary: payload.summary, result: payload.result });
        if (name === "tool.approval_required") { this.send({ type: "approval.required", approval: payload }); this.send({ type: "status", state: "approval", label: "等待你确认操作" }); }
        if (name === "question.required") { this.send({ type: "question.required", question: payload.question }); this.send({ type: "status", state: "question", label: "等待你补充信息" }); }
        if (name === "retry") this.send({ type: "status", state: "retry", label: `模型请求重试（第 ${payload.attempt || 1} 次）` });
        if (name === "model.fallback") this.send({ type: "status", state: "fallback", label: `切换备用模型 ${payload.to || ""}` });
        if (name === "run.phase" && payload.phase === "compaction" && !answerDone) this.send({ type: "status", state: "thinking", label: String(payload.title || "正在整理上下文") });
      }, this.user);
      this.activeRun = run;
      const result = await run.task;
      this.activeRun = undefined;
      if (turn !== this.turn) return;
      if (answer && !answerDone) { this.lastSpoken = speakableText(answer); this.spokenAt = Date.now(); }
      if (result.status !== "ok") this.send({ type: "agent.status", status: result.status, message: result.message || "", answer: result.answer || answer });
      const pending = (ttsDone || tts.finish()).then(() => {
        if (turn === this.turn) this.send({ type: "tts.done" });
      }).catch((error) => {
        if (turn === this.turn) {
          this.send({ type: "tts.error", message: error instanceof Error ? error.message : "语音合成结束失败" });
          this.send({ type: "tts.done" });
        }
      });
      this.send({ type: "agent.done", answer: result.answer || answer, status: result.status, usage: result.usage, context: result.context, approval: result.approval, question: result.question, duration_ms: result.run?.elapsed_seconds ? result.run.elapsed_seconds * 1000 : undefined, tts_pending: true });
      if (["question_required", "approval_required"].includes(result.status)) this.send({ type: "status", state: result.status === "question_required" ? "question" : "approval", label: result.status === "question_required" ? "等待你补充信息" : "等待你确认操作" });
      void pending;
    } catch (error) {
      this.activeRun = undefined;
      tts.close();
      if (turn === this.turn) {
        this.send({ type: "run.error", message: error instanceof Error ? error.message : "本轮回答失败" });
        this.send({ type: "status", state: "listening", label: "可以继续说话" });
      }
    }
  }
  async interrupt() {
    this.turn++;
    this.tts?.close();
    if (this.activeRun) {
      const run = this.activeRun;
      this.send({ type: "status", state: "thinking", label: "正在停止上一轮回答" });
      try { await this.runs.cancel(run.id, this.user); } catch {}
      try { await run.task; } catch {}
      this.activeRun = undefined;
    }
    this.send({ type: "interrupted" });
    this.send({ type: "status", state: "listening", label: "已打断，可以继续说话" });
  }
  close() {
    this.closed = true;
    this.tts?.close();
    this.asrStream?.close();
    this.asrController?.abort();
    if (this.activeRun) try { this.runs.cancel(this.activeRun.id, this.user); } catch {}
  }
}

export function voiceRoutes(app: FastifyInstance, context: { store: Store; auth: Auth; speech: Speech; runs: Runs; runtime: PiRuntime }) {
  const { store, auth, speech, runs, runtime } = context;
  const server = new WebSocketServer({
    noServer: true,
    maxPayload: 2 * 1024 * 1024,
    handleProtocols: (protocols) => (protocols.has(VOICE_PROTOCOL) ? VOICE_PROTOCOL : false),
  });
  const calls = new Set<VoiceCall>();
  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    let url: URL;
    try { url = new URL(request.url || "", `http://${request.headers.host || "localhost"}`); } catch { socket.destroy(); return; }
    if (url.pathname !== PATH && url.pathname !== DICTATION_PATH) return;
    server.handleUpgrade(request, socket, head, (ws) => server.emit("connection", ws, request, url));
  };
  app.server.on("upgrade", onUpgrade);
  server.on("connection", async (ws: WebSocket, request: IncomingMessage, url: URL) => {
    let call: VoiceCall | undefined;
    let dictation: Dictation | undefined;
    try {
      // 浏览器 WebSocket 无法自定义 Authorization；业务接入方（如 PC4D 大屏）用子协议携带短期凭据。
      const carried = voiceCredential(request);
      const headers = carried
        ? { ...request.headers, authorization: `Bearer ${carried}` }
        : request.headers;
      const agent = await auth.agentFromNode(
        headers as Record<string, string | string[] | undefined>,
        parseCookies(String(request.headers.cookie || "")),
      );
      const user = agent.identity;
      const credential = agent.credential;
      const sessionId = String(url.searchParams.get("session_id") || "");
      if (!sessionId) throw new AppError("语音通话必须绑定当前会话", 422);
      const session = store.ownedSession(sessionId, user);
      if (!session) throw new AppError("会话不存在", 404);
      if (url.pathname === DICTATION_PATH) {
        const assistant = runtime.assistant(user, session.assistant_id || undefined);
        dictation = new Dictation(ws, user, sessionId, assistant.id, store, speech);
        ws.on("message", (raw) => {
          void (async () => {
            try {
              const message = JSON.parse(raw.toString());
              if (message.type === "start") await dictation!.start();
              else if (message.type === "audio") dictation!.audio(String(message.audio || ""));
              else if (message.type === "commit") await dictation!.commit();
              else if (message.type === "stop") ws.close();
            } catch (error) { ws.send(JSON.stringify({ type: "error", message: error instanceof Error ? error.message : "语音识别请求失败" })); }
          })();
        });
        ws.on("close", () => dictation?.close());
        ws.on("error", () => dictation?.close());
        ws.send(JSON.stringify({ type: "connected" }));
        return;
      }
      call = new VoiceCall(ws, request, user, credential, sessionId, store, speech, runs, runtime);
      calls.add(call);
      ws.on("message", (raw) => {
        void (async () => {
          try {
            const message = JSON.parse(raw.toString());
            if (message.type === "start") await call!.start(message);
            else if (message.type === "audio") call!.audio(String(message.audio || ""));
            else if (message.type === "commit") await call!.commit();
            else if (message.type === "cancel") call!.cancelUtterance();
            else if (message.type === "interrupt") await call!.interrupt();
            else if (message.type === "stop") ws.close();
          } catch (error) { ws.send(JSON.stringify({ type: "error", message: error instanceof Error ? error.message : "语音通话请求失败" })); }
        })();
      });
      ws.on("close", () => { call?.close(); if (call) calls.delete(call); });
      ws.on("error", () => { call?.close(); if (call) calls.delete(call); });
      ws.send(JSON.stringify({ type: "connected" }));
    } catch (error) {
      ws.send(JSON.stringify({ type: "error", message: error instanceof Error ? error.message : "语音通话连接失败" }));
      ws.close(1008, "unauthorized");
    }
  });
  app.addHook("onClose", async () => {
    app.server.off("upgrade", onUpgrade);
    for (const call of calls) call.close();
    calls.clear();
    server.close();
  });
}
