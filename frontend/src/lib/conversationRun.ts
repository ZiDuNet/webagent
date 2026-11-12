import type { AgentApproval, AgentEvent, AgentToolRun } from "../api/agent";
import type { ProcessActivity, ProcessData, ProcessStatus, ProcessStep, UsageData } from "../types";

export class ConversationRun {
  answer = "";
  reasoning = "";
  usage?: UsageData;
  approval?: AgentApproval;
  completed = false;
  failed = false;
  title = "正在连接";
  preview = "";
  waitingForModel = false;
  activityAt: number;
  startedAt: number;
  steps: ProcessStep[] = [];
  activities: ProcessActivity[] = [];
  toolRuns: AgentToolRun[] = [];
  private sequence = 0;
  private activitySequence = 0;
  private activeId?: string;
  private finishedAt?: number;
  private preparingTools = new Set<string>();
  private activeOutput?: ProcessActivity;
  private outputLength = 0;

  constructor(startedAt = Date.now()) {
    this.startedAt = startedAt;
    this.activityAt = startedAt;
  }

  private finishActive(status: ProcessStatus = "done") {
    const step = this.steps.find((item) => item.id === this.activeId);
    if (step?.status === "running") step.status = status === "done" && this.preparingTools.has(step.id) ? "pending" : status;
    this.activeId = undefined;
  }

  private activate(kind: ProcessStep["kind"], title: string, now: number, id?: string): ProcessStep {
    const active = this.steps.find((step) => step.id === this.activeId);
    if (active && active.kind === kind && (!id || active.id === id) && active.title === title) return active;
    this.finishActive();
    const step: ProcessStep = { id: id || `activity-${++this.sequence}`, title, kind, status: "running" };
    this.steps.push(step);
    this.activeId = step.id;
    this.activityAt = now;
    return step;
  }

  private addActivity(title: string, preview = "", kind: ProcessStep["kind"] = "step", sourceStepId?: string): ProcessActivity {
    this.activeOutput = undefined;
    this.outputLength = 0;
    const activity: ProcessActivity = { id: `output-${++this.activitySequence}`, title, preview, kind, sourceStepId };
    this.activities.push(activity);
    if (this.activities.length > 300) this.activities.splice(0, this.activities.length - 300);
    return activity;
  }

  private appendOutput(title: string, text: string, kind: ProcessStep["kind"], sourceStepId?: string) {
    for (const character of text) {
      if (!this.activeOutput || this.activeOutput.title !== title || this.activeOutput.sourceStepId !== sourceStepId) {
        this.activeOutput = this.addActivity(title, "", kind, sourceStepId);
      }
      this.activeOutput.preview += character;
      this.outputLength += 1;
      if (this.outputLength >= 36 || (this.outputLength >= 16 && /[。！？!?；;\n]/u.test(character))) {
        this.activeOutput = undefined;
        this.outputLength = 0;
      }
    }
  }

  private toolStep(data: AgentEvent, now: number): ProcessStep {
    const existing = data.call_id
      ? this.steps.find((step) => step.id === `tool-${data.call_id}`)
      : [...this.steps].reverse().find((step) => step.kind === "tool" && step.title === (data.tool || "工具") && ["running", "pending"].includes(step.status));
    if (existing) return existing;
    return this.activate("tool", data.tool || "工具", now, data.call_id ? `tool-${data.call_id}` : undefined);
  }

  accept(name: string, data: AgentEvent, now = Date.now()): boolean {
    if (this.completed || this.failed) return false;
    if (name === "run.phase") {
      this.title = data.title || "正在准备运行环境";
      const step = this.activate("step", this.title, now, data.phase ? `phase-${data.phase}` : undefined);
      this.addActivity(this.title, data.message || "", "step", step.id);
      this.preview = "";
      this.waitingForModel = false;
    } else if (name === "step.started") {
      this.title = data.step && data.step > 1 ? "等待模型继续" : "等待模型响应";
      const step = this.activate("step", this.title, now);
      step.meta = data.step ? `第 ${data.step} 轮` : undefined;
      this.addActivity("模型请求已发送", "等待上游返回新内容", "step", step.id);
      this.preview = "";
      this.waitingForModel = true;
    } else if (name === "thinking.delta") {
      if (!data.delta) return false;
      this.reasoning += data.delta;
      const step = this.activate("think", "模型思考", now);
      step.reasoning = (step.reasoning || "") + data.delta;
      this.appendOutput("模型思考", data.delta, "think", step.id);
      this.title = "正在思考";
      this.preview = step.reasoning.replace(/\s+/g, " ").slice(-120);
      this.waitingForModel = false;
      this.activityAt = now;
    } else if (name === "text.delta") {
      if (!data.delta) return false;
      this.answer += data.delta;
      const step = this.activate("answer", "生成回答", now);
      step.content = (step.content || "") + data.delta;
      this.appendOutput("回答内容", data.delta, "answer", step.id);
      this.title = "正在回答";
      this.preview = step.content.replace(/\s+/g, " ").slice(-120);
      this.waitingForModel = false;
      this.activityAt = now;
    } else if (name === "tool.args.delta") {
      const existing = data.call_id && this.steps.find((step) => step.id === `tool-${data.call_id}`);
      if (existing) return false;
      const step = this.toolStep(data, now);
      this.preparingTools.add(step.id);
      this.title = `准备调用 ${data.tool || "工具"}`;
      this.addActivity(this.title, "模型正在生成调用参数", "tool", step.id);
      this.preview = "模型正在生成调用参数";
      this.waitingForModel = false;
    } else if (name === "tool.started") {
      const step = this.toolStep(data, now);
      if (this.activeId !== step.id) this.finishActive();
      this.preparingTools.delete(step.id);
      step.arguments = data.arguments;
      step.status = "running";
      this.activeId = step.id;
      this.toolRuns.push({ tool: data.tool || "工具", call_id: data.call_id, arguments: data.arguments, status: "running" });
      this.title = `正在调用 ${step.title}`;
      this.addActivity(this.title, "工具执行中", "tool", step.id);
      if (data.arguments !== undefined) this.appendOutput(`${step.title} · 参数`, typeof data.arguments === "string" ? data.arguments : JSON.stringify(data.arguments), "tool", step.id);
      this.preview = "";
      this.waitingForModel = false;
      this.activityAt = now;
    } else if (name === "tool.finished") {
      const step = this.toolStep(data, now);
      this.preparingTools.delete(step.id);
      step.status = ["error", "failed", "rejected", "cancelled"].includes(data.status || "") ? "failed" : "done";
      step.result = data.result;
      step.meta = data.summary;
      const run = data.call_id ? this.toolRuns.find((item) => item.call_id === data.call_id) : [...this.toolRuns].reverse().find((item) => item.tool === data.tool && item.status === "running");
      if (run) Object.assign(run, data, { status: data.status || "ok" });
      if (this.activeId === step.id) this.activeId = undefined;
      this.title = step.status === "failed" ? "工具执行失败" : "工具已返回";
      this.addActivity(`${this.title} · ${step.title}`, data.summary || "", "tool", step.id);
      if (data.result !== undefined) this.appendOutput(`${step.title} · 结果`, typeof data.result === "string" ? data.result : JSON.stringify(data.result), "tool", step.id);
      this.preview = data.summary || step.title;
      this.waitingForModel = false;
      this.activityAt = now;
    } else if (name === "tool.approval_required") {
      this.approval = data as AgentApproval;
      const step = this.toolStep(data, now);
      this.preparingTools.delete(step.id);
      step.arguments = data.arguments;
      step.status = "approval";
      this.title = "等待操作确认";
      this.addActivity(this.title, data.summary || step.title, "approval", step.id);
      this.preview = data.summary || "";
      this.waitingForModel = false;
    } else if (name === "usage") {
      this.usage = data.usage || this.usage;
    } else if (name === "retry") {
      this.finishActive("failed");
      this.title = "请求重试";
      this.preview = `${((data.delay_ms || 0) / 1000).toFixed(1)} 秒后重试${data.attempt ? ` · 第 ${data.attempt} 次` : ""}`;
      const step = this.activate("step", this.title, now);
      step.description = this.preview;
      this.addActivity(this.title, this.preview, "step", step.id);
      this.waitingForModel = false;
    } else if (name === "model.fallback") {
      this.finishActive("failed");
      this.title = "切换备用模型";
      this.preview = data.to || "";
      const step = this.activate("step", this.title, now);
      step.description = this.preview;
      this.addActivity(this.title, this.preview, "step", step.id);
      this.waitingForModel = true;
    } else if (name === "run.completed") {
      this.completed = true;
      this.finishedAt = now;
      this.failed = ["error", "failed"].includes(data.status || "");
      this.answer = data.answer ?? this.answer;
      this.usage = data.usage || this.usage;
      this.approval = data.approval || this.approval;
      this.toolRuns = data.tool_runs || this.toolRuns;
      this.finishActive(this.failed ? "failed" : "done");
      this.title = this.failed ? "运行未完成" : this.approval ? "等待操作确认" : "已完成";
      this.preview = "";
      this.waitingForModel = false;
    } else if (name === "run.failed") {
      this.interrupt(data.message || "运行失败", now);
    } else {
      return false;
    }
    return true;
  }

  reconnect(now = Date.now()) {
    this.title = "正在恢复连接";
    this.preview = "后台任务继续执行";
    this.addActivity(this.title, this.preview);
    this.activityAt = now;
    this.waitingForModel = false;
  }

  interrupt(message: string, now = Date.now()) {
    this.failed = true;
    this.finishedAt = now;
    this.finishActive("failed");
    this.title = message;
    this.preview = "";
    this.addActivity("运行未完成", message);
    this.waitingForModel = false;
    this.activityAt = now;
  }

  snapshot(now = Date.now()): ProcessData {
    return {
      title: this.title,
      status: this.failed ? "failed" : this.approval ? "approval" : this.completed ? "done" : "running",
      preview: this.preview,
      startedAt: this.startedAt,
      activityAt: this.activityAt,
      waitingForModel: this.waitingForModel,
      activities: this.activities.map((activity) => ({ ...activity })),
      duration: `${(((this.finishedAt ?? now) - this.startedAt) / 1000).toFixed(1)}s`,
      reasoningStored: false,
      steps: this.steps.map((step) => ({ ...step })),
    };
  }
}
