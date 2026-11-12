import { memo, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ProcessActivity, ProcessData, ProcessStatus, ProcessStep } from "../../types";
import { isStructuredValue, stringifyValue } from "../../lib/file";
import { extractHtmlArtifacts } from "../../lib/answerContent";
import { nextProcessActivity, processActivities } from "../../lib/processActivity";
import { CodeBox } from "../CodeBox/CodeBox";
import { Markdown } from "../Markdown/Markdown";
import { Icon } from "../ui/Icon";
import "./ProcessLine.css";

export interface ProcessLineProps {
  data: ProcessData;
  defaultOpen?: boolean;
  reasoningStored?: boolean;
  persistKey?: string;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

const STEP_KIND_LABEL: Record<string, string> = {
  think: "思考", tool: "工具", answer: "回答", approval: "审批", step: "步骤",
};

function readExpanded(key: string | undefined): Record<string, boolean> {
  if (!key || typeof window === "undefined") return {};
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || "{}") as { steps?: unknown };
    return Object.fromEntries(Array.isArray(value.steps) ? value.steps.filter((id) => typeof id === "string").map((id) => [id, true]) : []);
  } catch {
    return {};
  }
}

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, ms / 1000);
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}分${Math.floor(seconds % 60).toString().padStart(2, "0")}秒`;
}

export function StatusGlyph({ status, size = 16 }: { status: ProcessStatus; size?: number }) {
  const icon = status === "running" ? "loader" : status === "done" ? "check-circle" : status === "approval" ? "shield" : status === "pending" ? "clock" : "alert";
  return <span className={`status-glyph status-glyph--${status}`} aria-hidden="true"><Icon name={icon} size={size} /></span>;
}

function StepIcon({ status }: { status: ProcessStatus }) {
  const icon = status === "running" ? "loader" : status === "done" ? "check" : status === "approval" ? "shield" : status === "pending" ? "clock" : "x";
  return <span className={`process__step-dot is-${status}`} aria-hidden="true"><Icon name={icon} size={11} /></span>;
}

function ArgumentBlock({ label, value }: { label: string; value: unknown }) {
  const text = stringifyValue(value);
  if (!text) return null;
  return <div className="process__io"><div className="process__io-label"><span>{label}</span>{isStructuredValue(value) && <em>JSON</em>}</div><CodeBox code={text} language={isStructuredValue(value) ? "json" : "text"} lineNumbers={false} maxHeight="24vh" compact /></div>;
}

const OutputBlock = memo(function OutputBlock({ content, streaming, id }: { content: string; streaming: boolean; id: string }) {
  const output = useMemo(() => extractHtmlArtifacts(content, id, streaming), [content, id, streaming]);
  return <>
    {output.parts.map((part, index) => part.kind === "markdown" ? <Markdown key={index} content={part.content} streaming={streaming} /> : part.kind === "artifact" ? <CodeBox key={index} code={part.artifact.html} language="html" maxHeight="24vh" lineNumbers={false} /> : null)}
    {output.pendingHtml && <p className="process__description">正在生成 {output.pendingHtml.title} · 已接收 {output.pendingHtml.characters.toLocaleString()} 字符</p>}
  </>;
});

function ReasoningBlock({ reasoning, stored, streaming }: { reasoning: string; stored: boolean; streaming: boolean }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  useEffect(() => {
    const body = bodyRef.current;
    if (body && streaming && pinnedRef.current) body.scrollTop = body.scrollHeight;
  }, [reasoning, streaming]);
  return <div className="process__reasoning">
    <div className="process__reasoning-head"><Icon name="bot" size={12} />思考原文{!stored && <em className="process__reasoning-badge">原文不落库</em>}</div>
    <div className="process__reasoning-body" ref={bodyRef} onScroll={() => {
      const body = bodyRef.current;
      if (body) pinnedRef.current = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
    }}><Markdown content={reasoning} streaming={streaming} /></div>
  </div>;
}

function StepRow({ step, expanded, reasoningStored, onToggle }: { step: ProcessStep; expanded: boolean; reasoningStored: boolean; onToggle: () => void }) {
  const hasDetail = step.description !== undefined || step.arguments !== undefined || step.result !== undefined || step.reasoning !== undefined || step.content !== undefined;
  return <div className={`process__step ${expanded ? "is-expanded" : ""}`}>
    <button type="button" className="process__step-head" onClick={onToggle} aria-expanded={expanded} disabled={!hasDetail}>
      <StepIcon status={step.status} /><span className="process__step-title">{step.title}</span>
      {step.kind && <span className="process__step-kind">{STEP_KIND_LABEL[step.kind] || "步骤"}</span>}
      <span className="process__step-spacer" />{step.meta && <span className="process__step-meta">{step.meta}</span>}
      {hasDetail && <Icon name="chevron-right" size={13} className="process__step-chevron" />}
    </button>
    {expanded && hasDetail && <div className="process__detail">
      {step.reasoning !== undefined && <ReasoningBlock reasoning={step.reasoning} stored={reasoningStored} streaming={step.status === "running"} />}
      {step.content !== undefined && <OutputBlock content={step.content} streaming={step.status === "running"} id={step.id} />}
      {step.description && <p className="process__description">{step.description}</p>}
      {step.arguments !== undefined && <ArgumentBlock label="参数" value={step.arguments} />}
      {step.result !== undefined && <ArgumentBlock label="结果" value={step.result} />}
    </div>}
  </div>;
}

function ActivityText({ activity, paused, reducedMotion }: { activity: ProcessActivity; paused: boolean; reducedMotion: boolean }) {
  const viewportRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);
  useEffect(() => {
    const viewport = viewportRef.current;
    const text = textRef.current;
    if (!viewport || !text) return;
    const measure = () => setOverflow(Math.max(0, text.scrollWidth - viewport.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(text);
    return () => observer.disconnect();
  }, [activity.id]);
  return <span className="process__preview" ref={viewportRef} title={activity.preview}>
    <span ref={textRef} className={`process__preview-text ${overflow > 0 && !reducedMotion ? "is-scrolling" : ""}`} style={{
      "--process-travel": `${-overflow}px`,
      "--process-travel-time": `${Math.max(1.2, overflow / 150)}s`,
      animationPlayState: paused ? "paused" : "running",
    } as CSSProperties}>{activity.preview.replace(/\s+/g, " ")}</span>
  </span>;
}

export function ProcessLine({ data, defaultOpen = false, reasoningStored, persistKey, onOpenChange, className = "" }: ProcessLineProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [expandedSteps, setExpandedSteps] = useState(() => readExpanded(persistKey));
  const [elapsedMs, setElapsedMs] = useState(0);
  const [activityId, setActivityId] = useState<string>();
  const [paused, setPaused] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const sectionRef = useRef<HTMLElement>(null);
  const revealRef = useRef(false);
  const startedAtRef = useRef(data.startedAt ?? Date.now());
  const previousStatusRef = useRef(data.status);
  const activitiesRef = useRef<ProcessActivity[]>([]);
  const activityIdRef = useRef<string | undefined>(undefined);
  const dwellRef = useRef(1800);
  const bodyId = useId();
  const running = data.status === "running";
  const activities = useMemo(() => processActivities(data), [data]);
  activitiesRef.current = activities;
  const selected = activities.findIndex((activity) => activity.id === activityId);
  const activityIndex = reducedMotion && !paused ? activities.length - 1 : Math.max(0, selected);
  const activity = activities[activityIndex] || { id: "current", title: data.title, preview: data.preview || "" };
  activityIdRef.current = activity.id;
  const remaining = activities.length - activityIndex - 1;
  dwellRef.current = activity.preview ? remaining > 10 ? 600 : remaining > 3 ? 1100 : 2200 : 450;
  const title = running ? activity.title : data.status === "done" ? "已完成" : data.title;
  const duration = running ? formatElapsed(elapsedMs) : data.duration || formatElapsed(elapsedMs);
  const toolCount = data.steps.filter((step) => step.kind === "tool").length;
  const thinkingCount = data.steps.filter((step) => step.kind === "think").length;
  const counts = [toolCount ? `${toolCount} 次工具` : data.status === "done" ? "未调用工具" : "", thinkingCount ? `${thinkingCount} 次思考` : ""].filter(Boolean).join(" · ");
  const stored = reasoningStored ?? data.reasoningStored ?? false;

  useEffect(() => {
    if (previousStatusRef.current === "running" && !running) setOpen(false);
    previousStatusRef.current = data.status;
  }, [data.status, running]);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!running) return;
    const update = () => setElapsedMs(Date.now() - startedAtRef.current);
    update();
    const timer = window.setInterval(update, 500);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (!running || paused || interacting || reducedMotion) return;
    let shownAt = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - shownAt < dwellRef.current) return;
      const nextId = nextProcessActivity(activitiesRef.current, activityIdRef.current);
      if (nextId !== activityIdRef.current) {
        shownAt = Date.now();
        setActivityId(nextId);
      }
    }, 150);
    return () => window.clearInterval(timer);
  }, [running, paused, interacting, reducedMotion]);

  useEffect(() => {
    if (!open || !revealRef.current) return;
    revealRef.current = false;
    const frame = window.requestAnimationFrame(() => sectionRef.current?.scrollIntoView({ block: "nearest", behavior: reducedMotion ? "auto" : "smooth" }));
    return () => window.cancelAnimationFrame(frame);
  }, [open, reducedMotion]);

  useEffect(() => {
    if (!persistKey) return;
    try {
      window.localStorage.setItem(persistKey, JSON.stringify({ open, steps: Object.keys(expandedSteps).filter((key) => expandedSteps[key]), reasoning: [] }));
    } catch {}
  }, [expandedSteps, open, persistKey]);

  const move = (offset: number) => {
    setPaused(true);
    setActivityId(activities[Math.max(0, Math.min(activities.length - 1, activityIndex + offset))]?.id);
  };

  return <section ref={sectionRef} className={`process process--${data.status} ${className}`.trim()} aria-label="执行过程" aria-busy={running || undefined}>
    <div className="process__header" onMouseEnter={() => setInteracting(true)} onMouseLeave={() => setInteracting(false)} onFocus={() => setInteracting(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setInteracting(false); }}>
      <button type="button" className="process__summary" onClick={() => { revealRef.current = !open; setOpen(!open); onOpenChange?.(!open); }} aria-controls={bodyId} aria-expanded={open} aria-label={`${data.title}，${open ? "收起" : "展开"}执行过程`}>
        {running ? <span className="process__activity" aria-hidden="true"><i /><i /><i /></span> : <StatusGlyph status={data.status} size={17} />}
        <span className="process__live-status" role="status" aria-live="polite">{data.title}</span>
        <span className="process__ticker" aria-hidden="true"><span className="process__ticker-item" key={activity.id}>
          <span className="process__title">{title}</span>
          {running && activity.preview && <ActivityText activity={activity} paused={paused || interacting} reducedMotion={reducedMotion} />}
        </span></span>
        {counts && <span className="process__badge">{counts}</span>}
        <span className="process__meta">{duration}</span><Icon name="chevron-right" size={15} className="process__chevron" />
      </button>
      {running && activities.length > 1 && <div className="process__playback" role="group" aria-label="实时过程播放控制">
        <button type="button" onClick={() => move(-1)} disabled={activityIndex === 0} aria-label="上一条过程" title="上一条"><Icon name="chevron-right" size={12} className="process__previous" /></button>
        <button type="button" onClick={() => { setPaused(!paused); setInteracting(false); }} aria-pressed={paused} aria-label={paused ? "继续播放过程" : "暂停播放过程"} title={paused ? "继续播放" : "暂停播放"}><Icon name={paused ? "play" : "pause"} size={12} /></button>
        <button type="button" onClick={() => move(1)} disabled={activityIndex >= activities.length - 1} aria-label="下一条过程" title="下一条"><Icon name="chevron-right" size={12} /></button>
      </div>}
    </div>
    {open && <div className="process__body" id={bodyId}><div className="process__steps">{data.steps.map((step) => <StepRow key={step.id} step={step} expanded={expandedSteps[step.id] ?? step.kind === "think"} reasoningStored={stored} onToggle={() => setExpandedSteps((previous) => ({ ...previous, [step.id]: !(previous[step.id] ?? step.kind === "think") }))} />)}</div></div>}
  </section>;
}
