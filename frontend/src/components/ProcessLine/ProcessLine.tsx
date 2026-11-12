import { useEffect, useRef, useState } from "react";
import type { ProcessData, ProcessStatus, ProcessStep } from "../../types";
import { isStructuredValue, stringifyValue } from "../../lib/file";
import { CodeBox } from "../CodeBox/CodeBox";
import { Markdown } from "../Markdown/Markdown";
import { Icon } from "../ui/Icon";
import "./ProcessLine.css";

export interface ProcessLineProps {
  data: ProcessData;
  defaultOpen?: boolean;
  /** 思考原文是否已入库，false 时在思考块上显示「原文不落库」 */
  reasoningStored?: boolean;
  persistKey?: string;
  onOpenChange?: (open: boolean) => void;
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
  streaming,
}: {
  reasoning: string;
  stored: boolean;
  streaming: boolean;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  useEffect(() => {
    const body = bodyRef.current;
    if (body && streaming && pinnedRef.current) body.scrollTop = body.scrollHeight;
  }, [reasoning, streaming]);

  return (
    <div className="process__reasoning">
      <div className="process__reasoning-head">
        <Icon name="bot" size={12} />
        思考原文
        {!stored && <em className="process__reasoning-badge">原文不落库</em>}
      </div>
      <div className="process__reasoning-body" ref={bodyRef} onScroll={() => {
        const body = bodyRef.current;
        if (body) pinnedRef.current = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
      }}>
        <Markdown content={reasoning} streaming={streaming} />
      </div>
    </div>
  );
}

function StepRow({
  step,
  expanded,
  reasoningStored,
  onToggle,
}: {
  step: ProcessStep;
  expanded: boolean;
  reasoningStored: boolean;
  onToggle: () => void;
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
              streaming={step.status === "running"}
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
  onOpenChange,
  className = "",
}: ProcessLineProps) {
  const [persisted] = useState(() => readPersisted(persistKey));
  const [open, setOpen] = useState(persisted?.open ?? defaultOpen);
  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>(
    () => Object.fromEntries((persisted?.steps ?? []).map((id) => [id, true]))
  );
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAtRef = useRef(data.startedAt ?? Date.now());
  const [now, setNow] = useState(Date.now);
  const sectionRef = useRef<HTMLElement>(null);
  const revealRef = useRef(false);

  const running = data.status === "running";
  const previousStatusRef = useRef(data.status);

  useEffect(() => {
    if (previousStatusRef.current === "running" && data.status !== "running") setOpen(false);
    previousStatusRef.current = data.status;
  }, [data.status]);

  useEffect(() => {
    if (!open || !revealRef.current) return;
    revealRef.current = false;
    const frame = window.requestAnimationFrame(() => sectionRef.current?.scrollIntoView({
      block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    }));
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!running) return;
    const update = () => {
      setElapsedMs(Date.now() - startedAtRef.current);
      setNow(Date.now());
    };
    update();
    const timer = window.setInterval(update, 500);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (!persistKey || typeof window === "undefined") return;
    const steps = Object.entries(expandedSteps)
      .filter(([, value]) => value)
      .map(([id]) => id);
    try {
      window.localStorage.setItem(
        persistKey,
        JSON.stringify({ open, steps, reasoning: [] } satisfies PersistedState)
      );
    } catch {
      // localStorage 不可用时忽略持久化
    }
  }, [expandedSteps, open, persistKey]);

  const toolCount = data.steps.filter((step) => step.kind === "tool").length;
  const thinkingCount = data.steps.filter((step) => step.kind === "think").length;
  const stored = reasoningStored ?? data.reasoningStored ?? false;

  const summaryTitle = data.status === "done" ? "已完成" : data.title;
  const counts = [toolCount ? `${toolCount} 次工具` : data.status === "done" ? "未调用工具" : "", thinkingCount ? `${thinkingCount} 次思考` : ""].filter(Boolean).join(" · ");
  const preview = data.preview || (running && data.waitingForModel && now - (data.activityAt ?? startedAtRef.current) > 8000 ? "模型尚未返回新内容，正在等待响应" : "");
  const durationText = running
    ? formatElapsed(elapsedMs)
    : (data.duration ?? formatElapsed(elapsedMs));

  const toggleStep = (id: string) => {
    setExpandedSteps((previous) => ({ ...previous, [id]: !(previous[id] ?? data.steps.find((step) => step.id === id)?.kind === "think") }));
  };

  return (
    <section
      ref={sectionRef}
      className={`process process--${data.status} ${className}`.trim()}
      aria-label="执行过程"
      aria-busy={running || undefined}
    >
      <button
        type="button"
        className="process__summary"
        onClick={() => {
          revealRef.current = !open;
          onOpenChange?.(!open);
          setOpen(!open);
        }}
        aria-expanded={open}
        aria-label={`${summaryTitle}，${open ? "收起" : "展开"}执行过程`}
      >
        {running ? <span className="process__activity" aria-hidden="true"><i /><i /><i /></span> : <StatusGlyph status={data.status} size={17} />}
        <span className="process__title" role="status" aria-live="polite">
          {summaryTitle || STATUS_TEXT[data.status]}
        </span>
        {preview && <span className="process__preview" aria-hidden="true">{preview}</span>}
        <span className="process__summary-spacer" />
        {counts && <span className="process__badge">{counts}</span>}
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
                expanded={expandedSteps[step.id] ?? step.kind === "think"}
                reasoningStored={stored}
                onToggle={() => toggleStep(step.id)}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
