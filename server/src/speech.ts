import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { AppError, type Row } from "./types.js";
import { Providers, limitedResponse, providerHeaders, requestJson, sameOriginEndpoint } from "./providers.js";

export function audioInput(dataUrl: string) {
  if (typeof dataUrl !== "string" || dataUrl.length > 18000000) throw new AppError("音频大小超过 12 MB", 422);
  const match = /^data:(audio\/[a-zA-Z0-9.+-]+)(?:;[^,]*)?;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new AppError("音频必须为 Base64 audio Data URL", 422);
  const bytes = Buffer.from(match[2], "base64"); if (!bytes.length || bytes.length > 12 * 1024 * 1024) throw new AppError("音频为空或超过 12 MB", 422);
  return { bytes, mime: match[1] };
}
export function pcmFromWav(data: Buffer) {
  const invalid = () => new AppError("此语音协议需要客户端转换后的 16 kHz、单声道、16-bit PCM WAV；后端不执行转码。", 422);
  if (data.length < 44 || data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WAVE" || data.readUInt32LE(4) + 8 !== data.length) throw invalid();
  let format = false;
  let pcm: Buffer | undefined;
  let offset = 12;
  while (offset + 8 <= data.length) {
    const name = data.toString("ascii", offset, offset + 4);
    const size = data.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (size > data.length - start) throw invalid();
    if (name === "fmt ") {
      if (format || size < 16 || data.readUInt16LE(start) !== 1 || data.readUInt16LE(start + 2) !== 1 || data.readUInt32LE(start + 4) !== 16000 || data.readUInt32LE(start + 8) !== 32000 || data.readUInt16LE(start + 12) !== 2 || data.readUInt16LE(start + 14) !== 16) throw invalid();
      format = true;
    }
    if (name === "data") {
      if (pcm || !size || size % 2 || size > 65 * 32000) throw invalid();
      pcm = data.subarray(start, start + size);
    }
    offset = start + size + size % 2;
  }
  if (!format || !pcm || offset !== data.length) throw invalid();
  return pcm;
}
export function pcmToWav(pcm: Buffer, sampleRate = 24000, channels = 1, bits = 16) {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * bits / 8;
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(byteRate, 28); header.writeUInt16LE(channels * bits / 8, 32); header.writeUInt16LE(bits, 34);
  header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
export function asrConfig(model: Row, provider: Row) {
  const options = model.extra_params?._asr || {};
  let protocol = options.protocol || "auto";
  if (protocol === "auto") protocol = model.model_kind === "asr_realtime" || /real.?time/i.test(model.model_id) ? "realtime" : /qwen.*asr/i.test(model.model_id) ? (/\/api\/v1/.test(provider.base_url) || /qwen-audio-3\./i.test(model.model_id) ? "dashscope" : "chat_audio") : "transcriptions";
  if (!["transcriptions", "realtime", "dashscope", "chat_audio"].includes(protocol)) throw new AppError("不支持的 STT 协议", 422);
  const nativePath = "/api/v1/services/aigc/multimodal-generation/generation";
  const fallback = protocol === "transcriptions" ? `${provider.base_url}/audio/transcriptions` : protocol === "chat_audio" ? `${provider.base_url}/chat/completions` : protocol === "realtime" ? "/api-ws/v1/realtime" : provider.base_url.endsWith(nativePath) ? provider.base_url : nativePath;
  const endpoint = protocol === "realtime" && /^wss?:/.test(options.endpoint || "") ? sameOriginEndpoint(provider, options.endpoint.replace(/^ws/, "http"), fallback).replace(/^http/, "ws") : sameOriginEndpoint(provider, options.endpoint || "", fallback).replace(protocol === "realtime" ? /^http/ : /$^/, "ws");
  return { protocol, endpoint, language: options.language || "zh", data_format: options.data_format || (/qwen/i.test(model.model_id) ? "data_uri" : "base64") };
}
export function ttsConfig(model: Row, provider: Row) {
  if (!["tts", "tts_realtime"].includes(model.model_kind)) throw new AppError("请选择 TTS 模型", 422);
  const options = model.extra_params?._tts || {};
  const realtime = model.model_kind === "tts_realtime" || /real.?time/i.test(model.model_id);
  const protocol = realtime ? "realtime" : options.protocol || (/qwen.*tts/i.test(model.model_id) ? "dashscope" : "openai");
  if (protocol === "realtime") {
    const base = new URL(provider.base_url);
    const endpoint = options.endpoint || `${base.protocol === "https:" ? "wss:" : "ws:"}//${base.host}/api-ws/v1/realtime?model=${encodeURIComponent(model.model_id)}`;
    return { protocol, endpoint, voice: options.voice || "Cherry", response_format: "pcm", sample_rate: Number(options.sample_rate || 24000), language_type: options.language_type || "Chinese" };
  }
  if (!["openai", "dashscope"].includes(protocol)) throw new AppError("TTS 协议不支持", 422);
  const oldQwen = /qwen-audio-.*tts/i.test(model.model_id) || /SpeechSynthesizer$/i.test(options.endpoint || "");
  const path = oldQwen ? "/api/v1/services/audio/tts/SpeechSynthesizer" : "/api/v1/services/aigc/multimodal-generation/generation";
  const endpoint = sameOriginEndpoint(provider, options.endpoint || "", protocol === "openai" ? `${provider.base_url}/audio/speech` : provider.base_url.endsWith(path) ? provider.base_url : path);
  return { protocol, endpoint, oldQwen, voice: options.voice || (protocol === "openai" ? "alloy" : oldQwen ? "longanhuan_v3.1" : "Cherry"), response_format: options.response_format || (protocol === "dashscope" && !oldQwen ? "wav" : "mp3"), speed: Number(options.speed || 1) };
}

function wsEndpoint(provider: Row, model: Row, options: Row, pathname = "/api-ws/v1/realtime") {
  if (options.endpoint && /^wss?:/i.test(options.endpoint)) {
    const target = new URL(options.endpoint);
    const base = new URL(provider.base_url);
    if (target.host !== base.host) throw new AppError("实时语音端点必须与供应商地址同域", 422);
    target.searchParams.set("model", model.model_id);
    return target;
  }
  const base = new URL(provider.base_url);
  const target = new URL(`${base.protocol === "https:" ? "wss:" : "ws:"}//${base.host}${pathname}`);
  target.searchParams.set("model", model.model_id);
  return target;
}
export class Speech {
  constructor(private providers: Providers) {}
  async transcribe(model: Row, dataUrl: string, language = "zh", signal?: AbortSignal) {
    if (!model.enabled || !["asr", "asr_realtime"].includes(model.model_kind)) throw new AppError("STT 模型未启用或类型不正确", 422);
    const provider = this.providers.connection(model.provider_id);
    const options = asrConfig(model, provider);
    const input = audioInput(dataUrl);
    const timeout = AbortSignal.timeout(Math.min(provider.timeout_seconds || 90, 180) * 1000);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const started = Date.now();
    if (options.protocol === "realtime") {
      const pcm = pcmFromWav(input.bytes);
      requestSignal.throwIfAborted();
      const target = new URL(options.endpoint); target.searchParams.set("model", model.model_id);
      const text = await new Promise<string>((resolve, reject) => {
        const socket = new WebSocket(target, { headers: { ...providerHeaders(provider), "OpenAI-Beta": "realtime=v1" }, handshakeTimeout: 10000, maxPayload: 1024 * 1024, followRedirects: false });
        let transcript = ""; let complete = false;
        const finish = (error?: Error) => { if (complete) return; complete = true; requestSignal.removeEventListener("abort", aborted); socket.close(); error ? reject(error) : resolve(transcript); };
        const aborted = () => { socket.terminate(); finish(new AppError("实时语音识别超时或取消", 504)); };
        requestSignal.addEventListener("abort", aborted, { once: true });
        socket.on("open", () => socket.send(JSON.stringify({ event_id: "wa-session", type: "session.update", session: { modalities: ["text"], input_audio_format: "pcm", sample_rate: 16000, turn_detection: null, input_audio_transcription: { language } } })));
        socket.on("message", (raw) => {
          try {
            const event = JSON.parse(raw.toString());
            if (event.type === "error" || event.error) return finish(new AppError(String(event.error?.message || event.message || "语音服务返回错误").replaceAll(provider.api_key || "\u0000", "[隐藏]"), 502));
            if (event.type === "session.updated") { for (let offset = 0; offset < pcm.length; offset += 3200) socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio: pcm.subarray(offset, offset + 3200).toString("base64") })); socket.send(JSON.stringify({ type: "input_audio_buffer.commit" })); socket.send(JSON.stringify({ type: "session.finish" })); }
            if (event.type === "conversation.item.input_audio_transcription.completed") transcript += event.transcript || "";
            if (event.type === "session.finished") finish();
          } catch { finish(new AppError("实时语音服务返回无效数据", 502)); }
        });
        socket.on("error", () => finish(new AppError("实时语音 WebSocket 连接失败，请核对端点、模型地域与权限", 502)));
        socket.on("close", () => finish(transcript ? undefined : new AppError("实时语音服务提前断开，未返回识别结果", 502)));
      });
      this.providers.record(model, "asr", {}, "", "", Date.now() - started);
      return { text: text.trim(), protocol: "realtime", latency_ms: Date.now() - started };
    }
    const headers = providerHeaders(provider);
    let body: BodyInit;
    if (options.protocol === "transcriptions") {
      const form = new FormData(); form.set("model", model.model_id); form.set("language", language); form.set("file", new Blob([new Uint8Array(input.bytes)], { type: input.mime }), `recording.${input.mime.split("/")[1].replace("x-", "")}`); body = form;
    } else {
      pcmFromWav(input.bytes);
      const wav = input.bytes;
      const dataUri = `data:audio/wav;base64,${wav.toString("base64")}`;
      headers["Content-Type"] = "application/json";
      if (options.protocol === "chat_audio") body = JSON.stringify({ model: model.model_id, messages: [{ role: "user", content: [{ type: "input_audio", input_audio: options.data_format === "data_uri" ? { data: dataUri } : { data: wav.toString("base64"), format: "wav" } }] }], asr_options: { language }, stream: false });
      else body = JSON.stringify({ model: model.model_id, input: { messages: [{ role: "user", content: [/qwen-audio-3\./i.test(model.model_id) ? { type: "input_audio", input_audio: { data: dataUri } } : { audio: dataUri }] }] }, parameters: /qwen-audio-3\./i.test(model.model_id) ? { format: "wav", sample_rate: 16000 } : { asr_options: { language } } });
    }
    const payload = await requestJson(options.endpoint, { method: "POST", headers, body, signal: requestSignal });
    const value = payload.text || payload.choices?.[0]?.message?.content || payload.output?.choices?.[0]?.message?.content || payload.output?.text || "";
    const text = typeof value === "string" ? value : Array.isArray(value) ? value.map((part) => part.text || "").join("") : "";
    this.providers.record(model, "asr", payload.usage, "", "", Date.now() - started);
    return { text: text.trim(), protocol: options.protocol, latency_ms: Date.now() - started };
  }
  async synthesize(model: Row, text: string, overrides: Row = {}, signal?: AbortSignal) {
    if (typeof text !== "string" || !text.trim() || text.length > 4000) throw new AppError("TTS 文本需要 1–4000 字符", 422);
    const provider = this.providers.connection(model.provider_id);
    const options = { ...ttsConfig(model, provider), ...Object.fromEntries(Object.entries(overrides).filter(([key]) => ["voice", "response_format", "speed"].includes(key))) };
    if (options.protocol === "realtime") {
      const audio = await this.synthesizeRealtime(model, text, overrides, signal);
      return audio;
    }
    const formats: Row = { mp3: "audio/mpeg", wav: "audio/wav", opus: "audio/ogg", aac: "audio/aac", flac: "audio/flac", pcm: "audio/pcm" };
    if (!formats[options.response_format] || !Number.isFinite(Number(options.speed)) || Number(options.speed) < 0.25 || Number(options.speed) > 4) throw new AppError("TTS 格式或语速无效", 422);
    if (options.protocol === "dashscope" && !options.oldQwen && (text.length > 600 || options.response_format !== "wav" || Number(options.speed) !== 1)) throw new AppError("Qwen3 TTS 单次最多 600 字符，仅支持 WAV、语速 1", 422);
    const payload = options.protocol === "openai" ? { model: model.model_id, input: text, voice: options.voice, response_format: options.response_format, speed: options.speed } : { model: model.model_id, input: { text, voice: options.voice, ...(options.oldQwen ? { format: options.response_format, rate: options.speed } : { language_type: "Auto" }) } };
    const response = await fetch(options.endpoint, { method: "POST", headers: { ...providerHeaders(provider), "Content-Type": "application/json", Accept: options.protocol === "openai" ? "audio/*" : "application/json" }, body: JSON.stringify(payload), signal: signal || AbortSignal.timeout(provider.timeout_seconds * 1000), redirect: "error" });
    let bytes = await limitedResponse(response, 10 * 1024 * 1024);
    if (!response.ok) throw new AppError(`语音服务 HTTP ${response.status}`, 502);
    if (options.protocol === "dashscope") {
      const data = JSON.parse(bytes.toString()); const audio = data.output?.audio;
      if (!audio) throw new AppError("DashScope 未返回 output.audio", 502);
      if (audio.data) bytes = Buffer.from(audio.data, "base64");
      else {
        const url = new URL(audio.url); const origin = new URL(provider.base_url).origin;
        if (url.protocol === "http:") url.protocol = "https:";
        // DashScope may return a regional host with an optional region suffix,
        // e.g. dashscope-result-bj.oss-cn-beijing.aliyuncs.com or the older
        // dashscope-result.oss-cn-beijing.aliyuncs.com form.
        const trustedOss = /^dashscope-result(?:-[a-z0-9-]+)?\.oss-[a-z0-9-]+\.aliyuncs\.com$/i.test(url.hostname);
        if (url.origin !== origin && (!trustedOss || url.username || url.password)) throw new AppError("音频结果下载地址未经信任", 502);
        const download = await fetch(url, { redirect: "error", signal: signal || AbortSignal.timeout(30000) });
        if (!download.ok) throw new AppError("音频结果下载失败", 502);
        bytes = await limitedResponse(download, 10 * 1024 * 1024);
      }
    } else if (!/^(audio\/|application\/octet-stream)/.test(response.headers.get("content-type") || "")) throw new AppError("TTS 返回内容不是音频", 502);
    if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new AppError("TTS 音频为空或超限", 502);
    return { bytes, mime_type: formats[options.response_format], protocol: options.protocol };
  }
  async openAsrRealtime(model: Row, language: string, onPartial: (text: string) => void, signal: AbortSignal) {
    const provider = this.providers.connection(model.provider_id);
    const options = asrConfig(model, provider);
    if (options.protocol !== "realtime") throw new AppError("当前 STT 模型未配置实时协议", 422);
    const target = wsEndpoint(provider, model, { endpoint: options.endpoint }, "/api-ws/v1/realtime");
    const socket = new WebSocket(target, { headers: { ...providerHeaders(provider), "OpenAI-Beta": "realtime=v1" }, handshakeTimeout: 10000, maxPayload: 2 * 1024 * 1024, followRedirects: false });
    let readyResolve!: () => void; let readyReject!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    let transcript = ""; let closed = false; let failure: Error | undefined; let finishResolve!: (value: string) => void; let finishReject!: (error: Error) => void;
    const finished = new Promise<string>((resolve, reject) => { finishResolve = resolve; finishReject = reject; });
    // Abort may arrive before anyone awaits these promises (barge-in closes the stream first).
    // Mark them handled so an intentional cancellation cannot become an unhandled rejection.
    void ready.catch(() => {}); void finished.catch(() => {});
    const fail = (error: Error) => { if (failure) return; failure = error; readyReject(error); finishReject(error); socket.terminate(); };
    const aborted = () => fail(new AppError("实时语音识别已取消", 499));
    signal.addEventListener("abort", aborted, { once: true });
    socket.on("open", () => socket.send(JSON.stringify({ event_id: `wa-${randomUUID()}`, type: "session.update", session: { modalities: ["text"], input_audio_format: "pcm", sample_rate: 16000, turn_detection: null, input_audio_transcription: { language } } })));
    socket.on("message", (raw) => {
      try {
        const event = JSON.parse(raw.toString());
        if (event.type === "error" || event.error) return fail(new AppError(String(event.error?.message || event.message || "实时语音服务返回错误"), 502));
        if (event.type === "session.updated") readyResolve();
        if (event.type === "conversation.item.input_audio_transcription.delta" && typeof event.delta === "string") onPartial(event.delta);
        if (event.type === "conversation.item.input_audio_transcription.text" && typeof event.text === "string") onPartial(event.text);
        if (event.type === "conversation.item.input_audio_transcription.completed") { if (typeof event.transcript === "string") transcript += event.transcript; else if (typeof event.text === "string") transcript += event.text; }
        if (event.type === "session.finished") { closed = true; finishResolve(transcript.trim()); socket.close(); }
      } catch { fail(new AppError("实时语音服务返回无效数据", 502)); }
    });
    socket.on("error", () => fail(new AppError("实时语音 WebSocket 连接失败，请核对端点、模型地域与权限", 502)));
    socket.on("close", () => { if (!closed && !failure) fail(new AppError("实时语音服务提前断开，未返回识别结果", 502)); });
    const readyTimeout = setTimeout(() => fail(new AppError("实时语音识别初始化超时", 504)), 15000);
    try { await ready; } finally { clearTimeout(readyTimeout); }
    return {
      append(pcm: Buffer) { if (failure) throw failure; for (let offset = 0; offset < pcm.length; offset += 3200) socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio: pcm.subarray(offset, offset + 3200).toString("base64") })); },
      async finish() {
        signal.throwIfAborted();
        socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        socket.send(JSON.stringify({ type: "session.finish" }));
        const timeout = setTimeout(() => fail(new AppError("实时语音识别超时", 504)), 60000);
        try { return await finished; } finally { clearTimeout(timeout); signal.removeEventListener("abort", aborted); }
      },
      close() { signal.removeEventListener("abort", aborted); if (socket.readyState === WebSocket.OPEN) socket.close(); },
    };
  }
  async openTtsRealtime(model: Row, onAudio: (bytes: Buffer) => void, signal: AbortSignal) {
    const provider = this.providers.connection(model.provider_id);
    const options = ttsConfig(model, provider);
    if (options.protocol !== "realtime") throw new AppError("当前 TTS 模型未配置实时协议", 422);
    const target = options.endpoint && /^wss?:/i.test(options.endpoint) ? new URL(options.endpoint) : wsEndpoint(provider, model, {}, "/api-ws/v1/realtime");
    target.searchParams.set("model", model.model_id);
    const socket = new WebSocket(target, { headers: providerHeaders(provider), handshakeTimeout: 10000, maxPayload: 4 * 1024 * 1024, followRedirects: false });
    let readyResolve!: () => void; let readyReject!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    let failure: Error | undefined; let closed = false; let finishResolve!: () => void; let finishReject!: (error: Error) => void;
    const finished = new Promise<void>((resolve, reject) => { finishResolve = resolve; finishReject = reject; });
    // Same as realtime ASR: close() aborts while finish() may not be awaiting yet.
    void ready.catch(() => {}); void finished.catch(() => {});
    const fail = (error: Error) => { if (failure) return; failure = error; readyReject(error); finishReject(error); socket.terminate(); };
    const aborted = () => fail(new AppError("实时语音合成已取消", 499));
    signal.addEventListener("abort", aborted, { once: true });
    socket.on("open", () => socket.send(JSON.stringify({ event_id: `wa-${randomUUID()}`, type: "session.update", session: { voice: options.voice, mode: "server_commit", language_type: options.language_type, response_format: "pcm", sample_rate: options.sample_rate } })));
    socket.on("message", (raw) => {
      try {
        const event = JSON.parse(raw.toString());
        if (event.type === "error" || event.error) return fail(new AppError(String(event.error?.message || event.message || "实时语音合成服务返回错误"), 502));
        if (event.type === "session.updated") readyResolve();
        if (event.type === "response.audio.delta" && typeof event.delta === "string") onAudio(Buffer.from(event.delta, "base64"));
        if (event.type === "session.finished") { closed = true; finishResolve(); socket.close(); }
      } catch { fail(new AppError("实时语音合成返回无效数据", 502)); }
    });
    socket.on("error", () => fail(new AppError("实时语音合成 WebSocket 连接失败", 502)));
    socket.on("close", () => { if (!closed && !failure) fail(new AppError("实时语音合成服务提前断开", 502)); });
    const readyTimeout = setTimeout(() => fail(new AppError("实时语音合成初始化超时", 504)), 15000);
    try { await ready; } finally { clearTimeout(readyTimeout); }
    return {
      format: "pcm" as const,
      sample_rate: options.sample_rate,
      append(text: string) { if (failure) throw failure; if (text) socket.send(JSON.stringify({ event_id: `wa-${randomUUID()}`, type: "input_text_buffer.append", text })); },
      async finish() {
        if (failure) throw failure;
        socket.send(JSON.stringify({ event_id: `wa-${randomUUID()}`, type: "session.finish" }));
        const timeout = setTimeout(() => fail(new AppError("实时语音合成结束超时", 504)), 60000);
        try { await finished; } finally { clearTimeout(timeout); signal.removeEventListener("abort", aborted); }
      },
      close() { signal.removeEventListener("abort", aborted); if (socket.readyState === WebSocket.OPEN) socket.close(); },
    };
  }
  async synthesizeRealtime(model: Row, text: string, overrides: Row = {}, signal?: AbortSignal) {
    const controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const chunks: Buffer[] = [];
    const session = await this.openTtsRealtime(model, (bytes) => chunks.push(bytes), combined);
    try { session.append(text); await session.finish(); } finally { session.close(); }
    return { bytes: Buffer.concat(chunks), mime_type: "audio/pcm", protocol: "realtime", sample_rate: session.sample_rate };
  }
}
