export function encodePcmWav(samples: Float32Array, sampleRate = 16000): Uint8Array<ArrayBuffer> {
  if (sampleRate !== 16000 || !samples.length || samples.length > sampleRate * 65) throw new Error("音频需要 16 kHz 单声道，时长不能超过 65 秒。");
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => { for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index)); };
  text(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index++) {
    const sample = Math.min(1, Math.max(-1, Number.isFinite(samples[index]) ? samples[index] : 0));
    view.setInt16(44 + index * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}

export async function browserAudioToWav(blob: Blob, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  if (!blob.size || blob.size > 12 * 1024 * 1024) throw new Error("音频为空或超过 12 MB。");
  if (typeof AudioContext === "undefined" || typeof OfflineAudioContext === "undefined") throw new Error("当前浏览器不支持本地音频处理，请使用现代浏览器或由宿主客户端上传 16 kHz 单声道 WAV。");
  const context = new AudioContext();
  let decoded: AudioBuffer;
  try { decoded = await context.decodeAudioData(await blob.arrayBuffer()); }
  catch { throw new Error("当前浏览器无法解码此音频，请换成 WAV、MP3 或浏览器支持的录音格式。"); }
  finally { await context.close(); }
  signal?.throwIfAborted();
  if (!Number.isFinite(decoded.duration) || decoded.duration <= 0 || decoded.duration > 65) throw new Error("单次识别音频需要 0–65 秒，请缩短后重试。");
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
  const source = offline.createBufferSource();
  source.buffer = decoded; source.connect(offline.destination); source.start();
  const audio = await offline.startRendering();
  signal?.throwIfAborted();
  const result = new Blob([encodePcmWav(audio.getChannelData(0))], { type: "audio/wav" });
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => reader.abort();
    const cleanup = () => signal?.removeEventListener("abort", abort);
    reader.onload = () => { cleanup(); resolve(String(reader.result)); };
    reader.onerror = () => { cleanup(); reject(new Error("无法读取处理后的音频。")); };
    reader.onabort = () => { cleanup(); reject(new Error("音频处理已取消。")); };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) { cleanup(); reject(new Error("音频处理已取消。")); return; }
    reader.readAsDataURL(result);
  });
}
