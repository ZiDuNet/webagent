import { useEffect, useRef, useState } from "react";
import { Alert, Button, Input, Modal, Space, Tag, Upload } from "antd";
import { CircleStop, FlaskConical, Mic, Square, Upload as UploadIcon, Volume2 } from "lucide-react";
import { apiErrorMessage } from "../../api/pagepilot";
import { modelsRequest, type ConfiguredModel, type ModelProvider, type ModelTestResult } from "./modelsApi";

interface ModelTestDialogProps {
  baseUrl: string;
  model: ConfiguredModel;
  provider?: ModelProvider;
  onClose: () => void;
}

function readAudio(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("无法读取录音文件。"));
    reader.readAsDataURL(blob);
  });
}

export function ModelTestDialog({ baseUrl, model, provider, onClose }: ModelTestDialogProps) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ModelTestResult | null>(null);
  const [error, setError] = useState("");
  const [audio, setAudio] = useState<{ blob: Blob; name: string } | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [recording, setRecording] = useState(false);
  const [requestingMic, setRequestingMic] = useState(false);
  const [speechText, setSpeechText] = useState("你好，这是一条 WebAgent 语音合成测试。");
  const controllerRef = useRef<AbortController | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordTimerRef = useRef<number | null>(null);
  const aliveRef = useRef(true);
  const isAsr = model.model_kind === "asr";
  const isRealtime = model.model_kind === "asr_realtime";

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      controllerRef.current?.abort();
      if (recordTimerRef.current) window.clearTimeout(recordTimerRef.current);
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (!audio) { setAudioUrl(""); return; }
    const url = URL.createObjectURL(audio.blob);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [audio]);

  const selectAudio = (blob: Blob, name: string) => {
    if (blob.size > 12 * 1024 * 1024) { setError("录音不能超过 12 MB，请缩短后再试。"); return; }
    setAudio({ blob, name });
    setResult(null);
    setError("");
  };

  const toggleRecording = async () => {
    if (requestingMic) return;
    if (recording) { recorderRef.current?.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setError("当前浏览器不能录音，请使用 HTTPS/localhost，或上传音频文件。"); return; }
    let stream: MediaStream | null = null;
    setRequestingMic(true);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!aliveRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((value) => MediaRecorder.isTypeSupported(value));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: BlobPart[] = [];
      recorderRef.current = recorder;
      recorder.addEventListener("dataavailable", (event) => { if (event.data.size) chunks.push(event.data); });
      recorder.addEventListener("error", () => { if (aliveRef.current) setError("录音失败，请上传音频文件重试。"); });
      recorder.addEventListener("stop", () => {
        recorder.stream.getTracks().forEach((track) => track.stop());
        if (recordTimerRef.current) window.clearTimeout(recordTimerRef.current);
        recorderRef.current = null;
        if (!aliveRef.current) return;
        setRecording(false);
        if (chunks.length) selectAudio(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }), "浏览器录音");
      }, { once: true });
      recorder.start();
      setRecording(true);
      setError("");
      recordTimerRef.current = window.setTimeout(() => { if (recorder.state === "recording") recorder.stop(); }, 60_000);
    } catch (failure) {
      stream?.getTracks().forEach((track) => track.stop());
      if (aliveRef.current) setError(apiErrorMessage(failure));
    } finally {
      if (aliveRef.current) setRequestingMic(false);
    }
  };

  const test = async () => {
    if (testing) return;
    if (isRealtime) return;
    if (isAsr && !audio) { setError("请先录音或上传实际音频，测试结果不会修改默认模型绑定。"); return; }
    setTesting(true);
    setError("");
    setResult(null);
    const controller = new AbortController();
    controllerRef.current = controller;
    const timeout = Math.max(20_000, ((provider?.timeout_seconds || 90) + 10) * 1000);
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
    try {
      if (isAsr && audio) {
        const dataUrl = await readAudio(audio.blob);
        if (controller.signal.aborted) return;
        const response = await modelsRequest<{ text: string; protocol: string }>(baseUrl, `/admin/models/${model.id}/transcribe`, { method: "POST", signal: controller.signal, body: JSON.stringify({ audio_data_url: dataUrl }) }, timeout);
        if (!controller.signal.aborted) setResult({ ok: true, text: response.text, message: response.text ? "音频识别完成" : "接口返回空文本，请检查音频是否包含人声。", protocol: response.protocol });
      } else if (model.model_kind === "tts") {
        const speech = await fetch(`${baseUrl.replace(/\/$/, "")}/audio/speech`, { method: "POST", signal: controller.signal, credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: speechText, model_row_id: model.id }) });
        if (!speech.ok) {
          const detail = await speech.json().catch(() => ({})) as { detail?: string };
          throw new Error(detail.detail || `语音合成失败（HTTP ${speech.status}）`);
        }
        const blob = await speech.blob();
        const dataUrl = await readAudio(blob);
        if (!controller.signal.aborted) setResult({ ok: true, message: blob.type.includes("pcm") ? "已生成原始 PCM 音频，请下载后使用支持的播放器或解码工具。" : "语音已生成，可在下方试听或下载。", audio: { data_url: dataUrl, mime_type: blob.type } });
      } else {
        const response = await modelsRequest<ModelTestResult>(baseUrl, `/admin/models/${model.id}/test`, { method: "POST", signal: controller.signal }, timeout);
        if (!controller.signal.aborted) setResult(response);
      }
    } catch (failure) {
      if (aliveRef.current && (timedOut || !controller.signal.aborted)) setError(timedOut ? "测试等待超时，请检查供应商连接或稍后重试。" : apiErrorMessage(failure));
    } finally {
      window.clearTimeout(timer);
      if (aliveRef.current && controllerRef.current === controller) setTesting(false);
    }
  };

  const stop = () => { controllerRef.current?.abort(); setTesting(false); setError("已停止等待测试结果。上游服务可能已经开始处理本次请求。"); };
  const ttsOptions = model.extra_params?._tts as Record<string, unknown> | undefined;
  const nativeAudioTts = /speechsynthesizer\/?$/i.test(String(ttsOptions?.endpoint || "")) || (!/multimodal-generation\/generation\/?$/i.test(String(ttsOptions?.endpoint || "")) && /qwen-audio-?3/i.test(model.model_id));
  const ttsLimit = ttsOptions?.protocol === "dashscope" && !nativeAudioTts ? 600 : 4000;
  const imageValue = result?.image?.data_url || result?.image?.url;
  const imageSource = imageValue && (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(imageValue) || /^https?:\/\//i.test(imageValue)) ? imageValue : undefined;
  const isPcm = result?.audio?.mime_type?.includes("pcm") || result?.audio?.data_url?.startsWith("data:audio/pcm");
  const outputFormat = String(ttsOptions?.response_format || (ttsOptions?.protocol === "dashscope" && !nativeAudioTts ? "wav" : "mp3"));
  const asrOptions = model.extra_params?._asr as Record<string, unknown> | undefined;
  const speechVoice = String(ttsOptions?.voice || (ttsOptions?.protocol === "dashscope" ? nativeAudioTts ? "longanhuan_v3.1" : "Cherry" : "alloy"));

  return <Modal open title={<span className="ms-modal-title"><FlaskConical size={18} />测试模型</span>} onCancel={onClose} width={620} className="ms-modal ms-test-modal" footer={<><Button onClick={onClose}>关闭</Button>{testing ? <Button icon={<CircleStop size={15} />} onClick={stop}>取消等待</Button> : <Button type="primary" icon={<FlaskConical size={15} />} disabled={isRealtime || recording || requestingMic || (model.model_kind === "tts" && !speechText.trim())} onClick={() => void test()}>开始真实测试</Button>}</>}>
    <div className="ms-test-target"><strong>{model.name}</strong><code>{model.model_id}</code><span>{provider?.name} · {provider?.base_url}</span></div>
    {isAsr && <div className="ms-test-parameters"><Tag>语言 {String(asrOptions?.language || "zh")}</Tag><Tag>协议 {String(asrOptions?.protocol || "auto")}</Tag></div>}
    {model.model_kind === "tts" && <div className="ms-test-parameters"><Tag>{String(ttsOptions?.protocol || "openai")}</Tag><Tag>音色 {speechVoice}</Tag><Tag>{outputFormat.toUpperCase()}</Tag><Tag>语速 {String(ttsOptions?.speed || 1)}</Tag></div>}
    {isRealtime ? <Alert type="warning" showIcon title="当前尚未实现 WebSocket 实时语音测试。请使用 STT 文件识别模型；不能用静音文件假装验证实时协议。" /> : isAsr ? <>
      <p className="ms-dialog-intro">上传或录制一段包含人声的音频，直接测试这个模型，不需要设为默认。</p>
      <Space wrap><Button icon={recording ? <Square size={14} /> : <Mic size={15} />} danger={recording} disabled={testing} loading={requestingMic} onClick={() => void toggleRecording()}>{recording ? "停止录音" : "录制测试音频"}</Button><Upload showUploadList={false} accept="audio/*,.wav,.mp3,.m4a,.webm,.ogg,.flac" beforeUpload={(file) => { selectAudio(file, file.name); return false; }} disabled={testing || recording || requestingMic}><Button icon={<UploadIcon size={14} />}>上传音频</Button></Upload></Space>
      {recording && <p className="ms-recording" role="status"><span className="ms-status-dot is-on" />正在录音，最长 60 秒…</p>}
      {audio && <div className="ms-test-audio"><span>{audio.name}</span><audio controls src={audioUrl} /></div>}
    </> : model.model_kind === "tts" ? <>
      <p className="ms-dialog-intro">按保存的音色、格式和语速合成音频，直接调用供应商，可能产生费用。</p>
      <Input.TextArea aria-label="语音合成测试文本" value={speechText} onChange={(event) => setSpeechText(event.target.value)} maxLength={ttsLimit} showCount rows={3} disabled={testing} />
    </> : <Alert type="info" showIcon title={model.model_kind === "image_generation" ? `真实生图测试生成 1 张图片，n 固定为 1。尺寸为 ${String(model.extra_params?.size || "1024x1024")}（未填时默认 1024×1024）。高级 JSON 支持 size、quality、style、background、output_format 等安全白名单参数，取值以供应商文档为准，可能产生费用。` : model.model_kind === "decision" ? "使用少量候选项验证决策评分协议与返回格式，测试不会修改筛选策略。" : model.model_kind === "embedding" ? "向 Embedding 接口发送一段测试文字，检查向量返回。" : model.model_kind === "rerank" ? "Rerank 协议因供应商而异；后端会明确返回当前是否支持测试。" : "向模型发送 Hi，检查真实对话响应、用量和耗时。不会使用演示回答。"} />}
    {testing && <div className="ms-test-working" role="status"><span className="ms-pulse" />正在等待供应商响应…<small>可取消等待，配置超时 {provider?.timeout_seconds || 90}s</small></div>}
    {error && <Alert type="error" showIcon title={error} role="alert" />}
    {result && <div className="ms-test-result"><Alert type={result.ok ? "success" : "error"} showIcon title={result.message || (result.ok ? "测试完成" : "测试失败")} />{typeof result.demo === "boolean" && result.demo && <Alert type="warning" title="服务端返回了演示结果，不能据此确认真实模型可用。" />}{result.text && <pre>{result.text}</pre>}{imageSource && <img className="ms-test-image" src={imageSource} alt={`${model.name} 测试生成图片`} referrerPolicy="no-referrer" />}{result.audio?.data_url?.startsWith("data:audio/") && <div className="ms-test-audio"><span><Volume2 size={14} />{isPcm ? "原始 PCM 音频" : "语音试听"}</span>{isPcm ? <Alert type="info" title="原始 PCM 需支持的播放器或解码工具，浏览器不能直接播放。" /> : <audio controls src={result.audio.data_url} />}<a className="ms-audio-download" href={result.audio.data_url} download={`speech-test.${isPcm ? "pcm" : outputFormat}`}>下载音频</a></div>}<Space wrap>{result.latency_ms !== undefined && <Tag>耗时 {result.latency_ms}ms</Tag>}{typeof result.protocol === "string" && <Tag>{result.protocol}</Tag>}</Space></div>}
  </Modal>;
}
