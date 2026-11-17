export type VoiceInputPrefer = "auto_file" | "auto_realtime" | "realtime" | "file";
export type VoiceInputChannel = "file" | "realtime";

export const voiceInputModeInputs = ["auto", "auto_file", "auto_realtime", "realtime", "file"] as const;

/** `auto` 是历史配置的兼容别名，统一归一化为 `auto_file`。 */
export function normalizeVoiceInputMode(value: unknown): VoiceInputPrefer {
  const mode = String(value ?? "").trim();
  if (mode === "realtime") return "realtime";
  if (mode === "file") return "file";
  if (mode === "auto_realtime") return "auto_realtime";
  return "auto_file";
}

/** 解析实际要使用的输入通道；显式 realtime/file 不做跨模式回退。 */
export function resolveVoiceInputMode(prefer: VoiceInputPrefer, capabilities: { file: boolean; realtime: boolean }): VoiceInputChannel {
  const candidates = voiceInputCandidates(prefer, capabilities);
  return candidates[0] || "file";
}

/** 识别候选顺序：auto 模式在首选通道失败时还会尝试另一种通道。 */
export function voiceInputCandidates(prefer: VoiceInputPrefer, capabilities: { file: boolean; realtime: boolean }): VoiceInputChannel[] {
  const { file, realtime } = capabilities;
  if (prefer === "auto_realtime") return realtime ? (file ? ["realtime", "file"] : ["realtime"]) : file ? ["file"] : [];
  if (prefer === "auto_file") return file ? (realtime ? ["file", "realtime"] : ["file"]) : realtime ? ["realtime"] : [];
  if (prefer === "realtime") return realtime ? ["realtime"] : [];
  return file ? ["file"] : [];
}
