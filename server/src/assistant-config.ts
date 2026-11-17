import type { Row } from "./types.js";
import { normalizeVoiceInputMode, type VoiceInputPrefer } from "./voice-input.js";

export const assistantOverrideColumns = [
  "asr_model_id",
  "asr_realtime_model_id",
  "tts_model_id",
  "voice_asr_model_id",
  "voice_tts_model_id",
  "voice_input_mode",
  "voice_auto_send",
  "tts_auto_read",
  "tts_max_read_chars",
  "default_reasoning_effort",
  "default_approval_mode",
  "allow_full_access",
  "welcome_title",
  "welcome_subtitle",
  "welcome_prompts",
  "welcome_logo",
] as const;

/** Columns that point at `models.id`; used for delete/binding validation only. */
export const assistantModelColumns = [
  "asr_model_id",
  "asr_realtime_model_id",
  "tts_model_id",
  "voice_asr_model_id",
  "voice_tts_model_id",
] as const;

export type AssistantRuntimeConfig = {
  asr_model_id: number | null;
  asr_realtime_model_id: number | null;
  tts_model_id: number | null;
  voice_asr_model_id: number | null;
  voice_tts_model_id: number | null;
  voice_input_mode: VoiceInputPrefer;
  voice_auto_send: boolean;
  tts_auto_read: boolean;
  tts_max_read_chars: number;
  default_reasoning_effort: string;
  default_approval_mode: "confirm" | "full_access";
  allow_full_access: boolean;
  welcome_title: string;
  welcome_subtitle: string;
  welcome_prompts: string;
  welcome_logo: string;
};

const inherited = (value: unknown, fallback: unknown) =>
  value === null || value === undefined || value === "" ? fallback : value;

const inheritedBoolean = (value: unknown, fallback: boolean) =>
  value === null || value === undefined ? fallback : Boolean(value);

/**
 * Assistant values win over global runtime defaults. Null/empty values mean
 * “inherit”, which keeps old assistants working without a migration prompt.
 */
export function effectiveAssistantConfig(assistant: Row | undefined, settings: Row): AssistantRuntimeConfig {
  const source = assistant || {};
  return {
    asr_model_id: Number(source.asr_model_id ?? settings.asr_model_id) || null,
    asr_realtime_model_id: Number(source.asr_realtime_model_id ?? settings.asr_realtime_model_id) || null,
    tts_model_id: Number(source.tts_model_id ?? settings.tts_model_id) || null,
    voice_asr_model_id: Number(source.voice_asr_model_id ?? settings.voice_asr_model_id) || null,
    voice_tts_model_id: Number(source.voice_tts_model_id ?? settings.voice_tts_model_id) || null,
    voice_input_mode: normalizeVoiceInputMode(inherited(source.voice_input_mode, settings.voice_input_mode || "auto_file")),
    voice_auto_send: inheritedBoolean(source.voice_auto_send, Boolean(settings.voice_auto_send)),
    tts_auto_read: inheritedBoolean(source.tts_auto_read, Boolean(settings.tts_auto_read)),
    tts_max_read_chars: Number(inherited(source.tts_max_read_chars, settings.tts_max_read_chars || 1200)),
    default_reasoning_effort: String(inherited(source.default_reasoning_effort, settings.default_reasoning_effort || "")),
    default_approval_mode: String(inherited(source.default_approval_mode, settings.default_approval_mode || "confirm")) as AssistantRuntimeConfig["default_approval_mode"],
    allow_full_access: inheritedBoolean(source.allow_full_access, Boolean(settings.allow_full_access)),
    welcome_title: String(inherited(source.welcome_title, settings.welcome_title || "")),
    welcome_subtitle: String(inherited(source.welcome_subtitle, settings.welcome_subtitle || "")),
    welcome_prompts: String(inherited(source.welcome_prompts, settings.welcome_prompts || "")),
    welcome_logo: String(inherited(source.welcome_logo, settings.welcome_logo || "")),
  };
}
