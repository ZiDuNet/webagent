import { useEffect, useRef, useState } from "react";
import { agentJson } from "../api/agent";
import { apiErrorMessage } from "../api/pagepilot";

export function useVoiceInput(onRecognized: (text: string) => void | Promise<void>, enabled: boolean, contextKey?: string) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const mountedRef = useRef(true);
  const timerRef = useRef<number | null>(null);
  const callbackRef = useRef(onRecognized);
  const contextRef = useRef(contextKey);
  const enabledRef = useRef(enabled);
  callbackRef.current = onRecognized;
  contextRef.current = contextKey;
  enabledRef.current = enabled;

  useEffect(() => {
    return () => {
      const recorder = recorderRef.current;
      if (recorder?.state === "recording") recorder.stop();
      recorder?.stream.getTracks().forEach((track) => track.stop());
    };
  }, [contextKey, enabled]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      const recorder = recorderRef.current;
      if (recorder?.state === "recording") recorder.stop();
      recorder?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const toggle = async () => {
    if (busy || !enabled) return;
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
        if (timerRef.current) window.clearTimeout(timerRef.current);
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
          const audioDataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error("无法读取录音。"));
            reader.readAsDataURL(blob);
          });
          const result = await agentJson<{ text: string }>("/api/agent/transcribe", { audio_data_url: audioDataUrl, language: "zh" });
          const text = result.text?.trim();
          if (!text) throw new Error("未识别到语音，请重试。");
          if (mountedRef.current && enabledRef.current && contextRef.current === recordingContext) await callbackRef.current(text);
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

  return { recording, busy, error, toggle };
}
