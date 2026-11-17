import { useEffect, useRef, useState } from "react";
import { browserAudioToWav } from "@webagent/sdk";
import { agentJson } from "../api/agent";
import { apiErrorMessage } from "../api/pagepilot";

interface VoiceInputOptions {
  realtime?: boolean;
  assistantId?: number;
  onPartial?: (text: string) => void;
}

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

export function useVoiceInput(
  onRecognized: (text: string) => void | Promise<void>,
  enabled: boolean,
  contextKey?: string,
  options: VoiceInputOptions = {},
) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [partial, setPartial] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const timerRef = useRef<number | null>(null);
  const callbackRef = useRef(onRecognized);
  const partialCallbackRef = useRef(options.onPartial);
  const contextRef = useRef(contextKey);
  const enabledRef = useRef(enabled);
  const realtimeRef = useRef(Boolean(options.realtime));
  const assistantIdRef = useRef(options.assistantId);
  const recordingRef = useRef(false);
  const commitRequestedRef = useRef(false);
  // 本次录音实际绑定的会话；自动建会话时用于避免 contextKey 更新触发 cleanup 关闭连接。
  const scopeRef = useRef<string | undefined>(undefined);
  callbackRef.current = onRecognized;
  partialCallbackRef.current = options.onPartial;
  contextRef.current = contextKey;
  enabledRef.current = enabled;
  realtimeRef.current = Boolean(options.realtime);
  assistantIdRef.current = options.assistantId;

  const clearTimer = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const cleanupRealtime = () => {
    clearTimer();
    processorRef.current?.disconnect();
    processorRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
    recordingRef.current = false;
    setRecording(false);
  };

  const closeSocket = () => {
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) socket.close();
  };

  // 识别完成后立即释放“识别中”，发送会话是独立的后台动作，不能拖住麦克风状态。
  const deliver = (text: string) => {
    try {
      const pending = callbackRef.current(text);
      if (pending && typeof (pending as Promise<void>).then === "function") {
        void (pending as Promise<void>).catch((failure) => { if (mountedRef.current) setError(apiErrorMessage(failure)); });
      }
    } catch (failure) {
      if (mountedRef.current) setError(apiErrorMessage(failure));
    }
  };

  useEffect(() => {
    return () => {
      // contextKey 从空变为自动创建的新会话时，录音目标与当前会话一致，不能停止录音。
      // 用户手动切换到其它会话（contextRef.current !== scopeRef.current）时仍会正常清理。
      if (scopeRef.current && contextRef.current === scopeRef.current && contextRef.current !== contextKey) return;
      const recorder = recorderRef.current;
      if (recorder?.state === "recording") recorder.stop();
      recorder?.stream.getTracks().forEach((track) => track.stop());
      cleanupRealtime();
      closeSocket();
    };
  }, [contextKey, enabled]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimer();
      const recorder = recorderRef.current;
      if (recorder?.state === "recording") recorder.stop();
      recorder?.stream.getTracks().forEach((track) => track.stop());
      cleanupRealtime();
      closeSocket();
    };
  }, []);

  const stopRealtime = () => {
    if (!recordingRef.current) return;
    commitRequestedRef.current = true;
    cleanupRealtime();
    setBusy(true);
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "commit" }));
    else { setBusy(false); closeSocket(); }
  };

  const startCapture = async (socket: WebSocket) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (!mountedRef.current || socketRef.current !== socket || socket.readyState !== WebSocket.OPEN) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    streamRef.current = stream;
    const context = new AudioContext();
    audioContextRef.current = context;
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;
    const mute = context.createGain();
    mute.gain.value = 0;
    processor.onaudioprocess = (event) => {
      if (!recordingRef.current || socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type: "audio", audio: pcm16Base64(downsample(event.inputBuffer.getChannelData(0), context.sampleRate, 16000)) }));
    };
    source.connect(processor);
    processor.connect(mute);
    mute.connect(context.destination);
    recordingRef.current = true;
    setRecording(true);
    setBusy(false);
    timerRef.current = window.setTimeout(() => stopRealtime(), 60_000);
  };

  const startRealtime = async (sessionOverride?: string) => {
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") {
      setError("当前浏览器无法录音，请通过 HTTPS 或 localhost 打开。");
      return;
    }
    setError(null);
    setPartial("");
    setBusy(true);
    commitRequestedRef.current = false;
    const sessionId = sessionOverride || contextKey || "";
    if (!sessionId) {
      setBusy(false);
      setError("实时语音识别需要先创建会话");
      return;
    }
    scopeRef.current = sessionId;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const assistantQuery = assistantIdRef.current ? `&assistant_id=${assistantIdRef.current}` : "";
    const socket = new WebSocket(`${protocol}//${location.host}/api/agent/voice/dictate?session_id=${encodeURIComponent(sessionId)}${assistantQuery}`);
    socketRef.current = socket;
    socket.onopen = () => socket.send(JSON.stringify({ type: "start" }));
    socket.onmessage = (event) => {
      let message: { type?: string; text?: string; message?: string };
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (message.type === "ready") {
        void startCapture(socket).catch((failure) => {
          setError(apiErrorMessage(failure));
          setBusy(false);
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "stop" }));
          closeSocket();
        });
        return;
      }
      if (message.type === "asr.partial") {
        setPartial(message.text || "");
        partialCallbackRef.current?.(message.text || "");
        return;
      }
      if (message.type === "asr.final") {
        const text = String(message.text || "").trim();
        cleanupRealtime();
        closeSocket();
        setPartial("");
        setBusy(false);
        if (text && mountedRef.current && enabledRef.current && (contextRef.current === sessionId || contextRef.current === contextKey)) deliver(text);
        return;
      }
      if (message.type === "asr.empty") {
        cleanupRealtime();
        closeSocket();
        setPartial("");
        setBusy(false);
        setError("未识别到语音，请重试。");
        return;
      }
      if (message.type === "error") {
        cleanupRealtime();
        closeSocket();
        setPartial("");
        setBusy(false);
        setError(message.message || "实时语音识别失败");
      }
    };
    socket.onerror = () => {
      cleanupRealtime();
      closeSocket();
      setBusy(false);
      setError("实时语音识别连接失败");
    };
    socket.onclose = () => {
      // 任何原因断开都不要把按钮留在「识别中」，否则只能刷新页面。
      cleanupRealtime();
      scopeRef.current = undefined;
      if (!mountedRef.current) return;
      setBusy(false);
      setRecording(false);
      if (!commitRequestedRef.current) setPartial("");
    };
  };

  const toggleFile = async () => {
    const existing = recorderRef.current;
    if (existing?.state === "recording") { existing.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("当前浏览器无法录音，请通过 HTTPS 或 localhost 打开。");
      return;
    }
    setError(null);
    setBusy(true);
    let stream: MediaStream | null = null;
    const recordingContext = contextKey;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current || contextRef.current !== recordingContext) { stream.getTracks().forEach((track) => track.stop()); setBusy(false); return; }
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      const chunks: BlobPart[] = [];
      let failed = false;
      recorder.addEventListener("dataavailable", (event) => { if (event.data.size) chunks.push(event.data); });
      recorder.addEventListener("error", () => { failed = true; if (mountedRef.current) setError("录音失败，请重试。"); });
      recorder.addEventListener("stop", async () => {
        clearTimer();
        recorder.stream.getTracks().forEach((track) => track.stop());
        recorderRef.current = null;
        if (!mountedRef.current) return;
        setRecording(false);
        if (!enabledRef.current || contextRef.current !== recordingContext) { setBusy(false); return; }
        if (failed || !chunks.length) { setBusy(false); return; }
        setBusy(true);
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
          if (blob.size > 12 * 1024 * 1024) throw new Error("录音超过 12 MB，请缩短后重试。");
          const audioDataUrl = await browserAudioToWav(blob);
          if (!mountedRef.current || !enabledRef.current || contextRef.current !== recordingContext) return;
          const result = await agentJson<{ text: string }>("/api/agent/transcribe", { audio_data_url: audioDataUrl, language: "zh", assistant_id: assistantIdRef.current });
          const text = result.text?.trim();
          if (!text) throw new Error("未识别到语音，请重试。");
          if (mountedRef.current && enabledRef.current && contextRef.current === recordingContext) deliver(text);
        } catch (failure) {
          if (mountedRef.current) setError(apiErrorMessage(failure));
        } finally {
          if (mountedRef.current) setBusy(false);
        }
      }, { once: true });
      recorder.start();
      setRecording(true);
      setBusy(false);
      timerRef.current = window.setTimeout(() => { if (recorder.state === "recording") recorder.stop(); }, 60_000);
    } catch (failure) {
      stream?.getTracks().forEach((track) => track.stop());
      setBusy(false);
      setError(apiErrorMessage(failure));
    }
  };

  const toggle = async (sessionOverride?: string) => {
    if (busy || !enabled) return;
    if (realtimeRef.current) {
      if (recordingRef.current) stopRealtime();
      else await startRealtime(sessionOverride);
    } else {
      await toggleFile();
    }
  };

  return { recording, busy, partial, error, toggle, mode: realtimeRef.current ? "realtime" as const : "file" as const };
}
