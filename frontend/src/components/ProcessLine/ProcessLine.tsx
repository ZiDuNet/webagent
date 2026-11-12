import { useEffect, useRef, useState } from "react";
import type { ProcessData, ProcessStatus, ProcessStep } from "../../types";
import { isStructuredValue, stringifyValue } from "../../lib/file";
import { CodeBox } from "../CodeBox/CodeBox";
import { Icon } from "../ui/Icon";
import "./ProcessLine.css";

export interface ProcessLineProps {
  data: ProcessData;
  defaultOpen?: boolean;
  /** 思考原文是否已入库，false 时在思考块上显示「原文不落库」 */
  reasoningStored?: boolean;
  persistKey?: string;
  className?: string;
}

interface PersistedState {
  open: boolean;
  steps: string[];
  reasoning: string[];
}

const STATUS_TEXT: Record<ProcessStatus, string> = {
  pending: "待执行",
  running: "执行中",
  done: "已完成",
  approval: "等待审批",
  failed: "执行失败",
};

const STEP_KIND_LABEL: Record<string, string> = {
  think: "思考",
  tool: "工具",
  answer: "回答",
  approval: "审批",
  step: "步骤",
};

function readPersisted(key: string | undefined): PersistedState | null {
  if (!key || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PersistedState>;
    return {
      open: Boolean(value.open),
      steps: Array.isArray(value.steps) ? value.steps : [],
      reasoning: Array.isArray(value.reasoning) ? value.reasoning : [],
    };
  } catch {
    return null;
  }
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 100) / 10);
  if (total < 1) return "0.0s";
  if (total < 60) return `${total.toFixed(1)}s`;
  const minutes = Math.floor(total / 60);
  const seconds = Math.round(total % 60);
  return `${minutes}分${seconds.toString().padStart(2, "0")}秒`;
}

export function StatusGlyph({
  status,
  size = 16,
}: {
  status: ProcessStatus;
  size?: number;
}) {
  if (status === "running") {
    return (
      <span className="status-glyph status-glyph--running" aria-hidden="true">
        <Icon name="loader" size={size} />
      </span>
    );
  }
  const icon =
    status === "done"
      ? "check-circle"
      : status === "approval"
        ? "shield"
        : status === "pending"
          ? "clock"
          : "alert";
  return (
    <span className={`status-glyph status-glyph--${status}`} aria-hidden="true">
      <Icon name={icon} size={size} />
    </span>
  );
}

function StepIcon({ status }: { status: ProcessStatus }) {
  if (status === "running") {
    return (
      <span className="process__step-dot is-running" aria-hidden="true">
        <Icon name="loader" size={11} />
      </span>
    );
  }
  const icon =
    status === "done"
      ? "check"
      : status === "approval"
        ? "shield"
        : status === "pending"
          ? "clock"
          : "x";
  return (
    <span className={`process__step-dot is-${status}`} aria-hidden="true">
      <Icon name={icon} size={10} />
    </span>
  );
}

function ArgumentBlock({
  label,
  value,
}: {
  label: string;
  value: unknown;
}) {
  const text = stringifyValue(value);
  if (!text) return null;
  return (
    <div className="process__io">
      <div className="process__io-label">
        <span>{label}</span>
        {isStructuredValue(value) && <em>JSON</em>}
      </div>
      <CodeBox
        code={text}
        language={isStructuredValue(value) ? "json" : "text"}
        lineNumbers={false}
        maxHeight="24vh"
        compact
      />
    </div>
  );
}

function ReasoningBlock({
  reasoning,
  stored,
  expanded,
  onToggle,
}: {
  reasoning: string;
  stored: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="process__reasoning">
      <button
        type="button"
        className="process__reasoning-head"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <Icon name="bot" size={12} />
        思考原文
        {!stored && <em className="process__reasoning-badge">原文不落库</em>}
        <span className="process__step-spacer" />
        <Icon
          name="chevron-right"
          size={12}
          className="process__reasoning-chevron"
        />
      </button>
      {expanded && (
        <div className="process__reasoning-body">
          <CodeBox
            code={reasoning}
            language="text"
            lineNumbers={false}
            maxHeight="28vh"
            compact
          />
        </div>
      )}
    </div>
  );
}

function StepRow({
  step,
  expanded,
  reasoningExpanded,
  reasoningStored,
  onToggle,
  onReasoningToggle,
}: {
  step: ProcessStep;
  expanded: boolean;
  reasoningExpanded: boolean;
  reasoningStored: boolean;
  onToggle: () => void;
  onReasoningToggle: () => void;
}) {
  const hasDetail =
    step.description !== undefined ||
    step.arguments !== undefined ||
    step.result !== undefined ||
    step.reasoning !== undefined;

  return (
    <div className={`process__step ${expanded ? "is-expanded" : ""}`}>
      <button
        type="button"
        className="process__step-head"
        onClick={onToggle}
        aria-expanded={expanded}
        disabled={!hasDetail}
      >
        <StepIcon status={step.status} />
        <span className="process__step-title">{step.title}</span>
        {step.kind && (
          <span className="process__step-kind">
            {STEP_KIND_LABEL[step.kind] ?? "步骤"}
          </span>
        )}
        <span className="process__step-spacer" />
        {step.meta && <span className="process__step-meta">{step.meta}</span>}
        {hasDetail && (
          <Icon
            name="chevron-right"
            size={13}
            className="process__step-chevron"
          />
        )}
      </button>

      {expanded && hasDetail && (
        <div className="process__detail">
          {step.reasoning !== undefined && (
            <ReasoningBlock
              reasoning={step.reasoning}
              stored={reasoningStored}
              expanded={reasoningExpanded}
              onToggle={onReasoningToggle}
            />
          )}
          {step.description && (
            <p className="process__description">{step.description}</p>
          )}
          {step.arguments !== undefined && (
            <ArgumentBlock label="参数" value={step.arguments} />
          )}
          {step.result !== undefined && (
            <ArgumentBlock label="结果" value={step.result} />
          )}
        </div>
      )}
    </div>
  );
}

export function ProcessLine({
  data,
  defaultOpen = false,
  reasoningStored,
  persistKey,
  className = "",
}: ProcessLineProps) {
  const persisted = readPersisted(persistKey);
  const [open, setOpen] = useState(persisted?.open ?? defaultOpen);
  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>(
    () => Object.fromEntries((persisted?.steps ?? []).map((id) => [id, true]))
  );
  const [reasoningExpanded, setReasoningExpanded] = useState<
    Record<string, boolean>
  >(() =>
    Object.fromEntries((persisted?.reasoning ?? []).map((id) => [id, true]))
  );
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAtRef = useRef(Date.now());

  const running = data.status === "running";
  const previousStatusRef = useRef(data.status);

  useEffect(() => {
    if (previousStatusRef.current === "running" && data.status !== "running") setOpen(false);
    previousStatusRef.current = data.status;
  }, [data.status]);

  useEffect(() => {
    if (!running) return;
    const update = () => setElapsedMs(Date.now() - startedAtRef.current);
    update();
    const timer = window.setInterval(update, 500);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (!persistKey || typeof window === "undefined") return;
    const steps = Object.entries(expandedSteps)
      .filter(([, value]) => value)
      .map(([id]) => id);
    const reasoning = Object.entries(reasoningExpanded)
      .filter(([, value]) => value)
      .map(([id]) => id);
    try {
      window.localStorage.setItem(
        persistKey,
        JSON.stringify({ open, steps, reasoning } satisfies PersistedState)
      );
    } catch {
      // localStorage 不可用时忽略持久化
    }
  }, [expandedSteps, reasoningExpanded, open, persistKey]);

  const runningStep = data.steps.find((step) => step.status === "running");
  const doneCount = data.steps.filter((step) => step.status === "done").length;
  const finished = data.status === "done" || data.status === "failed";
  const stored = reasoningStored ?? data.reasoningStored ?? false;

  const summaryTitle = runningStep ? runningStep.title : data.title;
  const badgeText = finished
    ? `${doneCount} 步`
    : STATUS_TEXT[data.status];
  const durationText = running
    ? formatElapsed(elapsedMs)
    : (data.duration ?? formatElapsed(elapsedMs));

  const toggleStep = (id: string) => {
    setExpandedSteps((previous) => ({ ...previous, [id]: !previous[id] }));
  };
  const toggleReasoning = (id: string) => {
    setReasoningExpanded((previous) => ({ ...previous, [id]: !previous[id] }));
  };

  return (
    <section
      className={`process process--${data.status} ${className}`.trim()}
      aria-label="执行过程"
    >
      <button
        type="button"
        className="process__summary"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <StatusGlyph status={data.status} size={17} />
        <span className="process__title">
          {finished ? STATUS_TEXT[data.status] : summaryTitle}
        </span>
        <span className="process__badge">{badgeText}</span>
        <span className="process__summary-spacer" />
        <span className="process__meta">{durationText}</span>
        <Icon
          name="chevron-right"
          size={15}
          className="process__chevron"
        />
      </button>

      {open && (
        <div className="process__body">
          <div className="process__steps">
            {data.steps.map((step) => (
              <StepRow
                key={step.id}
                step={step}
                expanded={Boolean(expandedSteps[step.id])}
                reasoningExpanded={Boolean(reasoningExpanded[step.id])}
                reasoningStored={stored}
                onToggle={() => toggleStep(step.id)}
                onReasoningToggle={() => toggleReasoning(step.id)}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
