export type ProcessStatus = "pending" | "running" | "done" | "approval" | "failed";

export type ProcessStepKind = "think" | "tool" | "answer" | "step" | "approval";

export interface ProcessStep {
  id: string;
  title: string;
  status: ProcessStatus;
  kind?: ProcessStepKind;
  /** 右侧的轻量信息，例如耗时、风险、结果摘要 */
  meta?: string;
  description?: string;
  arguments?: unknown;
  result?: unknown;
  /** 思考原文（仅 think 步骤，可能不落库） */
  reasoning?: string;
}

export interface ProcessData {
  title: string;
  status: ProcessStatus;
  steps: ProcessStep[];
  meta?: string;
  duration?: string;
  preview?: string;
  startedAt?: number;
  activityAt?: number;
  waitingForModel?: boolean;
  /** 思考原文是否已入库 */
  reasoningStored?: boolean;
}

export interface ArtifactData {
  id: string;
  title: string;
  description?: string;
  html: string;
  fileName?: string;
  createdAt?: string;
}

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface ApprovalData {
  id: string;
  title: string;
  description?: string;
  tool: string;
  risk?: "低风险" | "中风险" | "高风险" | string;
  arguments?: unknown;
  expiresAt?: string;
  status: ApprovalStatus;
}

export type MessagePart =
  | { kind: "markdown"; content: string }
  | { kind: "process"; process: ProcessData }
  | { kind: "artifact"; artifact: ArtifactData }
  | { kind: "approval"; approval: ApprovalData };

export type MessageRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  renderKey?: string;
  role: MessageRole;
  name: string;
  time?: string;
  parts: MessagePart[];
  streaming?: boolean;
  usage?: UsageData;
}

export interface ModelOption {
  id: string;
  name: string;
  description?: string;
  badge?: string;
  contextWindow?: number;
  supportsReasoning?: boolean;
  reasoningEfforts?: string[];
  defaultReasoningEffort?: string;
}

export interface ToolOption {
  id: string;
  name: string;
  description?: string;
  selectable?: boolean;
  defaultSelected?: boolean;
}

export interface UsageData {
  input_tokens?: number;
  output_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number;
  cost_usd?: number;
  latency_ms?: number;
  model?: string;
}
