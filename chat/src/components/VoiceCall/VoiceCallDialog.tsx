import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../ui/Icon";
import "./VoiceCall.css";

export interface VoiceCallConfig {
  sessionId: string;
  assistantId?: number;
  modelId?: number;
  toolIds: string[];
  reasoning: string;
  accessMode: "confirm" | "full_access";
}

interface VoiceCallDialogProps {
  open: boolean;
  config: VoiceCallConfig | null;
  onClose: () => void;
}

type CallState = "connecting" | "listening" | "recording" | "transcribing" | "thinking" | "tool" | "speaking" | "approval" | "question" | "retry" | "fallback" | "ended" | "error";

interface VoiceMessage {
  type: string;
  text?: string;
  delta?: string;
  label?: string;
  state?: string;
  message?: string;
  audio?: string;
  mime_type?: string;
  format?: "pcm" | "file";
  sample_rate?: number;
  tool?: string;
  summary?: string;
  approval?: unknown;
  question?: unknown;
  answer?: string;
  tts_pending?: boolean;
}

const STATE_LABEL: Record<CallState, string> = {
  connecting: "正在接通",
  listening: "正在听",
  recording: "正在听你说",
  transcribing: "正在识别",
  thinking: "正在思考",
  tool: "正在调用工具",
  speaking: "正在回答",
  approval: "等待你确认操作",
  question: "等待你补充信息",
  retry: "模型请求重试",
  fallback: "切换备用模型",
  ended: "通话已结束",
  error: "连接异常",
};

// 麦克风 VAD：约 85ms 一个音频块。
const VAD_START_THRESHOLD = 0.014;
const VAD_START_CHUNKS = 2;          // ≈170ms 持续说话才开始，避免咔哒声
const VAD_SILENCE_THRESHOLD = 0.01;
const VAD_END_SILENCE_CHUNKS = 7;    // ≈600ms 停顿才断句，避免自然停顿被切成多轮
const BARGE_THRESHOLD = 0.055;
const BARGE_CHUNKS = 3;              // ≈250ms 明确说话才打断 TTS，避免回声误触发
const BARGE_GRACE_MS = 450;          // TTS 刚开始的 450ms 内不响应打断
const BARGE_RESUME_MS = 180;         // 打断后丢弃这段扬声器尾音再开始录音
const ECHO_COOLDOWN_MS = 140;        // TTS 播放结束后短暂闭麦，等扬声器余音消散

function downsample(input: Float32Array, sourceRate: number, targetRate = 16000) {
  if (sourceRate === targetRate) return input;
  const ratio = sourceRate / targetRate;
  const length = Math.max(1, Math.round(input.length / ratio));
  const result = new Float32Array(length);
  for (let index = 0; index < length; index++) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.floor((index + 1) * ratio));
    let total = 0;
    for (let cursor = start; cursor < end; cursor++) total += input[cursor];
    result[index] = total / Math.max(1, end - start);
  }
  return result;
}

function pcm16Base64(samples: Float32Array) {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index++) view.setInt16(index * 2, Math.max(-1, Math.min(1, samples[index])) * 0x7fff, true);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function rms(samples: Float32Array) {
  let total = 0;
  for (let index = 0; index < samples.length; index += 4) total += samples[index] * samples[index];
  return Math.sqrt(total / Math.max(1, samples.length / 4));
}

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function VoiceCallDialog({ open, config, onClose }: VoiceCallDialogProps) {
  const [state, setState] = useState<CallState>("connecting");
  const [status, setStatus] = useState("正在接通语音通道");
  const [transcript, setTranscript] = useState("");
  const [partial, setPartial] = useState("");
  const [answer, setAnswer] = useState("");
  const [thinking, setThinking] = useState("");
  const [tool, setTool] = useState("");
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [barge, setBarge] = useState(() => { try { return localStorage.getItem("wa_voice_barge") === "1"; } catch { return false; } });
  const [seconds, setSeconds] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const activeRef = useRef(false);
  const mutedRef = useRef(false);
  const bargeRef = useRef(barge);
  const generationRef = useRef(0);
  const speakingRef = useRef(false);
  const recordingRef = useRef(false);
  const silenceRef = useRef(0);
  const startChunksRef = useRef(0);
  const bargeChunksRef = useRef(0);
  const speakStartedAtRef = useRef(0);
  const speakEndedAtRef = useRef(0);
  const resumeAtRef = useRef(0);
  const wsReadyRef = useRef(false);
  const ttsPendingRef = useRef(false);
  const waitingRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const filesRef = useRef<Array<{ audio: HTMLAudioElement; url: string }>>([]);
  const fileQueueRef = useRef<Array<{ audio: HTMLAudioElement; url: string }>>([]);
  const filePlayingRef = useRef(false);
  const playAtRef = useRef(0);

  const settlePlayback = useCallback(() => {
    if (sourcesRef.current.length || filesRef.current.length) return;
    if (speakingRef.current) speakEndedAtRef.current = performance.now();
    speakingRef.current = false;
    if (activeRef.current || ttsPendingRef.current || waitingRef.current) return;
    setState("listening");
    setStatus("可以继续说话");
  }, []);

  const stopAudio = useCallback(() => {
    for (const source of sourcesRef.current) { try { source.stop(); } catch {} }
    sourcesRef.current = [];
    for (const item of filesRef.current) { item.audio.pause(); item.audio.src = ""; URL.revokeObjectURL(item.url); }
    filesRef.current = [];
    fileQueueRef.current = [];
    filePlayingRef.current = false;
    playAtRef.current = 0;
    if (speakingRef.current) speakEndedAtRef.current = performance.now();
    speakingRef.current = false;
    bargeChunksRef.current = 0;
    ttsPendingRef.current = false;
    waitingRef.current = false;
  }, []);

  const playPcm = useCallback((base64: string, sampleRate: number) => {
    const context = playbackContextRef.current;
    if (!context) return;
    const bytes = decodeBase64(base64);
    if (bytes.length < 2) return;
    const samples = new Float32Array(Math.floor(bytes.length / 2));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let index = 0; index < samples.length; index++) samples[index] = view.getInt16(index * 2, true) / 0x8000;
    const buffer = context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const startAt = Math.max(context.currentTime + 0.03, playAtRef.current);
    source.start(startAt);
    playAtRef.current = startAt + buffer.duration;
    sourcesRef.current.push(source);
    if (!speakingRef.current) speakStartedAtRef.current = performance.now();
    speakingRef.current = true;
    source.onended = () => { sourcesRef.current = sourcesRef.current.filter((item) => item !== source); settlePlayback(); };
  }, [settlePlayback]);

  const playFile = useCallback((base64: string, mime: string) => {
    const bytes = decodeBase64(base64);
    const url = URL.createObjectURL(new Blob([bytes], { type: mime || "audio/mpeg" }));
    const audio = new Audio(url);
    const item = { audio, url };
    filesRef.current.push(item);
    fileQueueRef.current.push(item);
    if (!speakingRef.current) speakStartedAtRef.current = performance.now();
    speakingRef.current = true;
    const pump = () => {
      if (filePlayingRef.current) return;
      const next = fileQueueRef.current.shift();
      if (!next) {
        settlePlayback();
        return;
      }
      filePlayingRef.current = true;
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        next.audio.onended = null;
        next.audio.onerror = null;
        URL.revokeObjectURL(next.url);
        filesRef.current = filesRef.current.filter((entry) => entry !== next);
        filePlayingRef.current = false;
        pump();
        settlePlayback();
      };
      next.audio.onended = done;
      next.audio.onerror = done;
      void next.audio.play().catch(done);
    };
    pump();
  }, [settlePlayback]);

  const send = useCallback((value: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
  }, []);

  const stopMicrophone = useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
  }, []);

  const startMicrophone = useCallback(async () => {
    const generation = generationRef.current;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("当前浏览器不支持麦克风；请通过 HTTPS 或 localhost 打开。");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (generation !== generationRef.current || !wsReadyRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
    streamRef.current = stream;
    const context = new AudioContext();
    audioContextRef.current = context;
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;
    const mute = context.createGain();
    mute.gain.value = 0;
    processor.onaudioprocess = (event) => {
      if (generation !== generationRef.current) return;
      if (mutedRef.current || !wsReadyRef.current || waitingRef.current) return;
      const input = event.inputBuffer.getChannelData(0);
      const level = rms(input);
      const now = performance.now();
      const speaking = speakingRef.current;
      // 半双工：TTS 播放期间完全不向 ASR 送麦克风音频，从源头阻断自听循环。
      if (speaking) {
        // 默认不打断：播放期间闭麦，等播放完 + 冷却后再听，彻底避免自听循环。
        if (activeRef.current && !bargeRef.current) return;
      } else if (!recordingRef.current && now - speakEndedAtRef.current < ECHO_COOLDOWN_MS) return;
      if (activeRef.current) {
        // 只有持续、明确的人声才打断正在播放的 TTS，避免扬声器回声或短噪声取消回答。
        if (!speaking || now - speakStartedAtRef.current < BARGE_GRACE_MS) return;
        bargeChunksRef.current = level > BARGE_THRESHOLD ? Math.min(BARGE_CHUNKS, bargeChunksRef.current + 1) : Math.max(0, bargeChunksRef.current - 1);
        if (bargeChunksRef.current < BARGE_CHUNKS) return;
        bargeChunksRef.current = 0;
        stopAudio();
        send({ type: "interrupt" });
        activeRef.current = false;
        recordingRef.current = true;
        silenceRef.current = 0;
        startChunksRef.current = 0;
        resumeAtRef.current = now + BARGE_RESUME_MS;
        setState("recording"); setStatus("正在听你说");
        return;
      }
      if (!recordingRef.current) {
        // 回答已结束、只剩音频尾巴时允许用户直接接话：用略高的阈值避免扬声器回声，
        // 但仍能在自然重叠时立刻停止播放并开始录音，而不是必须等整段 TTS 播完。
        const startThreshold = speaking ? Math.max(VAD_START_THRESHOLD, 0.035) : VAD_START_THRESHOLD;
        startChunksRef.current = level > startThreshold ? Math.min(VAD_START_CHUNKS, startChunksRef.current + 1) : Math.max(0, startChunksRef.current - 1);
        if (startChunksRef.current < VAD_START_CHUNKS) return;
        startChunksRef.current = 0;
        // TTS 尾巴仍可能在播放；用户开始说话就停止播放，并通知服务端丢弃未播完的音频。
        if (speaking) { stopAudio(); send({ type: "interrupt" }); resumeAtRef.current = now + 120; }
        recordingRef.current = true;
        silenceRef.current = 0;
        setState("recording"); setStatus("正在听你说");
      }
      if (now < resumeAtRef.current) return;
      const samples = downsample(input, context.sampleRate, 16000);
      send({ type: "audio", audio: pcm16Base64(samples) });
      if (level < VAD_SILENCE_THRESHOLD) silenceRef.current += 1; else silenceRef.current = 0;
      if (silenceRef.current >= VAD_END_SILENCE_CHUNKS) {
        recordingRef.current = false;
        resumeAtRef.current = 0;
        startChunksRef.current = 0;
        bargeChunksRef.current = 0;
        activeRef.current = true;
        setState("transcribing"); setStatus("正在识别");
        send({ type: "commit" });
      }
    };
    source.connect(processor);
    processor.connect(mute);
    mute.connect(context.destination);
    return () => { if (generation === generationRef.current) { processor.disconnect(); stream.getTracks().forEach((track) => track.stop()); void context.close().catch(() => {}); } };
  }, [send, stopAudio]);

  useEffect(() => {
    if (!open || !config) return;
    generationRef.current += 1;
    setState("connecting"); setStatus("正在接通语音通道"); setTranscript(""); setPartial(""); setAnswer(""); setThinking(""); setTool(""); setError(""); setSeconds(0); setMuted(false); mutedRef.current = false; activeRef.current = false; speakingRef.current = false; recordingRef.current = false; silenceRef.current = 0; wsReadyRef.current = false; ttsPendingRef.current = false; waitingRef.current = false;
    playbackContextRef.current = new AudioContext();
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const generation = generationRef.current;
    const socket = new WebSocket(`${protocol}//${location.host}/api/agent/voice/stream?session_id=${encodeURIComponent(config.sessionId)}`);
    socketRef.current = socket;
    socket.onopen = () => {
      send({ type: "start", assistant_id: config.assistantId, model_row_id: config.modelId, enabled_tools: config.toolIds, reasoning_effort: config.reasoning || undefined, approval_mode: config.accessMode });
    };
    socket.onmessage = (event) => {
      let message: VoiceMessage;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (message.type === "ready") {
        wsReadyRef.current = true; ttsPendingRef.current = false; waitingRef.current = false; setState("listening"); setStatus("可以开始说话");
        startMicrophone().catch((failure) => { if (generationRef.current === generation) { setError(failure instanceof Error ? failure.message : "麦克风不可用"); setState("error"); } });
        return;
      }
      if (message.type === "asr.partial") { setPartial(message.text || ""); return; }
      if (message.type === "asr.cancelled") { setPartial(""); return; }
      if (message.type === "asr.final") { setTranscript(message.text || ""); setPartial(""); setAnswer(""); setThinking(""); setTool(""); activeRef.current = true; startChunksRef.current = 0; bargeChunksRef.current = 0; silenceRef.current = 0; return; }
      if (message.type === "asr.empty") { activeRef.current = false; ttsPendingRef.current = false; waitingRef.current = false; setState("listening"); setStatus("没有听清，请再说一次"); return; }
      if (message.type === "status") {
        if (message.state === "approval" || message.state === "question") waitingRef.current = true;
        else if (message.state === "listening") waitingRef.current = false;
        if (message.state && message.state in STATE_LABEL) setState(message.state as CallState);
        if (message.label) setStatus(message.label);
        return;
      }
      if (message.type === "assistant.delta") { setAnswer((previous) => previous + (message.delta || "")); setState("speaking"); setStatus("正在回答"); return; }
      if (message.type === "thinking.delta") { setThinking((previous) => (previous + (message.delta || "")).slice(-4000)); return; }
      if (message.type === "tool") { setTool(`${message.state === "finished" ? "已完成" : message.state === "failed" ? "失败" : "调用"} · ${message.tool || "工具"}${message.summary ? ` · ${message.summary}` : ""}`); return; }
      if (message.type === "tts.audio" && message.audio) {
        setState("speaking"); setStatus("正在回答");
        if (message.format === "pcm") playPcm(message.audio, message.sample_rate || 24000);
        else playFile(message.audio, message.mime_type || "audio/mpeg");
        return;
      }
      if (message.type === "agent.done") {
        activeRef.current = false;
        ttsPendingRef.current = Boolean(message.tts_pending);
        setAnswer((previous) => previous || message.answer || "");
        if (!ttsPendingRef.current && !speakingRef.current && !waitingRef.current) { setState("listening"); setStatus("可以继续说话"); }
        return;
      }
      if (message.type === "tts.done") {
        ttsPendingRef.current = false;
        if (!activeRef.current && !speakingRef.current && !waitingRef.current) { setState("listening"); setStatus("可以继续说话"); }
        return;
      }
      if (message.type === "approval.required") { activeRef.current = false; waitingRef.current = true; setState("approval"); setStatus("请在聊天页确认操作后再继续语音"); return; }
      if (message.type === "question.required") { activeRef.current = false; waitingRef.current = true; setState("question"); setStatus("请在聊天页回答后继续语音"); return; }
      if (message.type === "interrupted") { activeRef.current = false; stopAudio(); return; }
      if (message.type === "tts.error") { ttsPendingRef.current = false; setError(message.message || "语音合成失败"); settlePlayback(); return; }
      if (message.type === "run.error" || message.type === "error") { activeRef.current = false; setError(message.message || "语音通话发生错误"); setState("error"); setStatus("连接异常"); return; }
    };
    socket.onerror = () => { setError("语音 WebSocket 连接失败"); setState("error"); };
    socket.onclose = () => { wsReadyRef.current = false; setState((previous) => previous === "error" ? previous : "ended"); setStatus("通话已结束"); };
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => {
      window.clearInterval(timer);
      wsReadyRef.current = false;
      send({ type: "stop" });
      socket.close();
      socketRef.current = null;
      stopMicrophone();
      stopAudio();
      void playbackContextRef.current?.close().catch(() => {});
      playbackContextRef.current = null;
    };
  }, [open, config, playFile, playPcm, send, settlePlayback, startMicrophone, stopAudio, stopMicrophone]);

  const hangup = () => { send({ type: "stop" }); socketRef.current?.close(); onClose(); };
  const toggleBarge = () => {
    const next = !barge;
    setBarge(next);
    bargeRef.current = next;
    try { localStorage.setItem("wa_voice_barge", next ? "1" : "0"); } catch {}
  };
  if (!open) return null;
  const time = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return <div className="voicecall" role="dialog" aria-modal="true" aria-label="语音通话">
    <div className="voicecall__backdrop" onClick={hangup} />
    <section className="voicecall__panel">
      <header className="voicecall__head"><span><i className="voicecall__live" />语音通话 · 当前会话</span><button type="button" onClick={hangup} aria-label="关闭语音通话"><Icon name="x" size={16} /></button></header>
      <div className={`voicecall__orb is-${state}`} aria-hidden="true"><span /><span /><span /><Icon name={state === "thinking" ? "sparkles" : state === "speaking" ? "audio-lines" : "mic"} size={30} /></div>
      <div className="voicecall__state"><strong>{STATE_LABEL[state]}</strong><span>{time}</span></div>
      <p className="voicecall__status">{status}</p>
      {tool && <div className="voicecall__tool"><Icon name="wrench" size={13} />{tool}</div>}
      {transcript && <div className="voicecall__bubble voicecall__bubble--user"><small>你</small><p>{transcript}</p></div>}
      {partial && !transcript && <div className="voicecall__bubble voicecall__bubble--user is-partial"><small>正在识别</small><p>{partial}</p></div>}
      {(answer || thinking) && <div className="voicecall__bubble voicecall__bubble--assistant"><small>助手</small>{thinking && !answer && <p className="voicecall__thinking">{thinking}</p>}{answer && <p>{answer}</p>}</div>}
      {error && <div className="voicecall__error" role="alert">{error}</div>}
      <footer className="voicecall__actions">
        <button type="button" className={`voicecall__round ${muted ? "is-off" : ""}`} onClick={() => { const next = !muted; setMuted(next); mutedRef.current = next; if (next) { recordingRef.current = false; silenceRef.current = 0; startChunksRef.current = 0; bargeChunksRef.current = 0; send({ type: "cancel" }); } }} aria-label={muted ? "打开麦克风" : "静音麦克风"}><Icon name={muted ? "mic" : "mic"} size={19} /><span>{muted ? "已静音" : "静音"}</span></button>
        <button type="button" className={`voicecall__round ${barge ? "" : "is-off"}`} onClick={toggleBarge} aria-label={barge ? "关闭语音打断" : "允许语音打断"} title={barge ? "说话可以打断回答；回声环境建议关闭" : "播放回答时闭麦，避免扬声器回声形成循环"}><Icon name="audio-lines" size={19} /><span>{barge ? "可打断" : "不打断"}</span></button>
        {(state === "approval" || state === "question") && <button type="button" className="voicecall__round voicecall__attention" onClick={onClose}><Icon name="chevron-right" size={18} /><span>返回聊天处理</span></button>}
        <button type="button" className="voicecall__hangup" onClick={hangup} aria-label="挂断"><Icon name="x" size={22} /></button>
      </footer>
      <p className="voicecall__hint">语音与当前会话、助手和工具权限绑定；审批与补充信息请回到聊天页处理。</p>
    </section>
  </div>;
}
