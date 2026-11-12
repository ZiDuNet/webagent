(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const ICONS = {
    spark: '<path d="M12 3l1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z"/>',
    device: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.1 2.1-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V20h-3v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1L6.6 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H5v-3h.5a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L6.6 8 8.7 6l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V4h3v.9a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 2.1 2.1-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.6v3h-.6a1.7 1.7 0 0 0-1.5 1z"/>',
    send: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    tool: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.3 2.3-2.3-2.3 2.3-2.3z"/>',
    eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.5"/>',
    edit: '<path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="M13.5 6.5l3 3"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>',
    shield: '<path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/><path d="M9.5 12l1.8 1.8 3.5-3.6"/>',
    check: '<path d="M5 12l4 4L19 6"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v6h-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M16 16l4 4"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l2 2M14 9l2 2"/>',
    users: '<path d="M16 20v-1.5a4.5 4.5 0 0 0-4.5-4.5h-3A4.5 4.5 0 0 0 4 18.5V20"/><circle cx="10" cy="7" r="3.5"/><path d="M17 4.5a3.5 3.5 0 0 1 0 6.8M20 20v-1.4a4.5 4.5 0 0 0-3-4.2"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16z"/><path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20"/>',
    activity: '<path d="M3 12h4l2.5-6 5 12 2.5-6h4"/>',
    database: '<ellipse cx="12" cy="5.5" rx="7.5" ry="3"/><path d="M4.5 5.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6M4.5 11.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6"/>',
    warning: '<path d="M12 4l9 16H3L12 4z"/><path d="M12 9v5M12 17h.01"/>',
    lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    server: '<rect x="4" y="4" width="16" height="6" rx="1.5"/><rect x="4" y="14" width="16" height="6" rx="1.5"/><path d="M8 7h.01M8 17h.01"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
    wifi: '<path d="M3 9a14 14 0 0 1 18 0M6.5 12.5a9 9 0 0 1 11 0M10 16a4 4 0 0 1 4 0"/><circle cx="12" cy="19" r=".7"/>',
    brain: '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-1 5.8A3 3 0 0 0 8 18h1V4z"/><path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 1 5.8A3 3 0 0 1 16 18h-1V4z"/>',
    mic: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  };

  function icon(name, size = 15) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true" style="width:${size}px;height:${size}px">${ICONS[name] || ICONS.spark}</svg>`;
  }

  const state = {
    user: null,
    page: "ai",
    assistants: [],
    assistantId: null,
    models: [],
    tools: [],
    skills: [],
    selectedTools: new Set(),
    modelId: null,
    demoMode: true,
    status: null,
    sessions: [],
    activeSessionId: null,
    messages: [],
    attachments: [],
    attachmentReads: 0,
    sending: false,
    approvalLoading: new Set(),
    lastBudget: null,
    lastRun: null,
    contextInfo: null,
    usage: null,
    sessionUsage: null,
    myUsage: null,
    memoryCount: 0,
    reasoningEffort: "",
    approvalMode: "confirm",
    liveUpdateTimer: null,
    processTimer: null,
    streamEl: null,
    liveToolsSignature: "",
    liveApprovalSignature: "",
    liveStartedAt: 0,
    liveElapsed: null,
    liveError: "",
    activeRunId: null,
    lastEventId: 0,
    streamingMessage: null,
    liveThinking: "",
    liveText: "",
    liveRenderedHtml: "",
    liveRenderedText: "",
    liveToolRuns: [],
    liveActivities: [],
    liveActivitySequence: 0,
    liveActivityId: null,
    liveActivityAt: 0,
    liveOutputActivity: null,
    liveOutputLength: 0,
    livePlaybackPaused: false,
    livePlaybackInteracting: false,
    livePreparingTools: new Set(),
    recording: false,
    recognition: null,
    mediaRecorder: null,
    mediaChunks: [],
    voiceBusy: false,
    configTab: "models",
    config: {
      providers: [],
      models: [],
      assistants: [],
      tools: [],
      skills: [],
      users: [],
      audit: [],
      agentAudit: [],
      sessions: [],
      usageSummary: null,
      settings: null,
      dynamicTools: [],
      pagepilot: null,
    },
    sessionFilter: {
      username: "",
      model: "",
      status: "",
      q: "",
      days: 7,
    },
    sessionDetail: null,
    devices: [],
    deviceFilter: { q: "", status: "" },
    deviceTimer: null,
  };

  let healthTimer = null;
  let modalTarget = null;
  let modalKeyHandler = null;
  let modalReturnFocus = null;
  let chartSequence = 0;
  const htmlArtifacts = new Map();
  const codeBoxes = new Map();
  const transientReasoning = new Map();
  let codeBoxSequence = 0;
  let codeBoxCleanupTimer = null;
  let activeArtifact = null;
  let artifactPublishStatus = null;
  let publicationsView = null;

  const PERMISSION_LABELS = {
    "profile:read": "身份读取",
    "device:read": "设备查询",
    "device:create": "设备新增",
    "device:update": "设备修改",
    "device:delete": "设备删除",
    "user:manage": "用户管理",
    "session:read_all": "会话治理",
  };
  const RISK_LABELS = { read: "读取", write: "写入", delete: "删除" };
  const MODE_LABELS = { agent: "多步", report: "单步报告" };
  const APPROVAL_MODE_LABELS = { confirm: "变更前确认", full_access: "完全访问" };
  const REASONING_OPTIONS = [
    ["", "跟随模型"],
    ["off", "关闭深度思考"],
    ["none", "不使用推理"],
    ["minimal", "minimal"],
    ["low", "low"],
    ["medium", "medium"],
    ["high", "high"],
    ["xhigh", "xhigh"],
  ];
  const TOOL_STATE_LABELS = {
    optional: "可见 · 可选",
    fixed: "可见 · 不可选",
    hidden: "不可见 · 默认启用",
    disabled: "不可见 · 不可用",
  };
  const SESSION_STATUS_LABELS = {
    ok: "成功",
    error: "失败",
    approval_required: "待审批",
    "": "—",
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function initials(user) {
    const source = user?.display_name || user?.username || "?";
    return [...source][0].toUpperCase();
  }

  function can(permission) {
    return Boolean(state.user?.permissions?.includes(permission));
  }

  function currentAssistant() {
    return state.assistants.find((item) => Number(item.id) === Number(state.assistantId)) || null;
  }

  function selectedModel() {
    return state.models.find((model) => Number(model.id) === Number(state.modelId)) || state.models[0] || null;
  }

  function toolState(tool) {
    if (!tool?.enabled) return "disabled";
    if (!tool.visible) return "hidden";
    return tool.selectable ? "optional" : "fixed";
  }

  function toolSourceLabel(tool) {
    if (tool.source === "mcp") return "MCP";
    if (tool.source === "dynamic") return "HTTP Tool";
    if (tool.source === "pagepilot") return tool.name === "publish_to_pagepilot" ? "REST 连接器" : "内置 Tool";
    return "Tool";
  }

  function formatTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  function formatRelative(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
    }
    return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
  }

  function truncate(value, max = 80) {
    const text = String(value ?? "");
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  function formatTokens(value) {
    const number = Number(value) || 0;
    if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(2)}M`;
    if (number >= 1_000) return `${(number / 1_000).toFixed(1)}k`;
    return String(number);
  }

  function formatCost(value) {
    const number = Number(value) || 0;
    if (!number) return "$0";
    if (number < 0.000001) return "<$0.000001";
    return `$${number.toFixed(6)}`;
  }

  function formatPrice(value) {
    const number = Number(value) || 0;
    return `$${number.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`;
  }

  async function api(path, options = {}) {
    const opts = {
      credentials: "same-origin",
      method: options.method || "GET",
      headers: { ...(options.headers || {}) },
    };
    if (options.body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(options.body);
    }
    let response;
    try {
      response = await fetch(path, opts);
    } catch (error) {
      throw new Error(`无法连接服务：${error.message}`);
    }
    if (response.status === 401 && path !== "/api/login") {
      showLogin();
      const error = new Error("登录已失效，请重新登录");
      error.status = 401;
      throw error;
    }
    let data = null;
    const text = await response.text();
    if (text) {
      try { data = JSON.parse(text); } catch { data = { detail: text }; }
    }
    if (!response.ok) {
      let detail = data?.detail ?? `请求失败（${response.status}）`;
      if (Array.isArray(detail)) {
        detail = detail.map((item) => item.msg || JSON.stringify(item)).join("；");
      }
      if (typeof detail !== "string") detail = JSON.stringify(detail);
      const error = new Error(detail);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function toast(message, type = "ok", timeout = 3400) {
    const root = $("#toast-root");
    const node = document.createElement("div");
    node.className = `toast ${type}`;
    node.textContent = message;
    root.appendChild(node);
    window.setTimeout(() => node.remove(), timeout);
  }

  /* ---------- Markdown (markdown-it + KaTeX + Mermaid, sanitized) ---------- */
  let markdownIt = null;

  function markdownEngine() {
    if (markdownIt) return markdownIt;
    const md = window.markdownit({
      html: false,
      linkify: true,
      breaks: false,
      typographer: false,
    });

    function mathInline(state, silent) {
      const src = state.src;
      const pos = state.pos;
      if (src[pos] !== "$" || src[pos + 1] === "$") return false;
      const next = src.charCodeAt(pos + 1);
      if (next === 0x20 || next === 0x09 || (next >= 0x30 && next <= 0x39)) return false;
      let end = -1;
      for (let i = pos + 1; i < src.length; i += 1) {
        const code = src.charCodeAt(i);
        if (code === 0x0a) break;
        if (code === 0x5c) { i += 1; continue; }
        if (code === 0x24) { end = i; break; }
      }
      if (end < 0 || end === pos + 1) return false;
      const content = src.slice(pos + 1, end);
      if (!content.trim()) return false;
      if (!silent) {
        const token = state.push("math_inline", "math", 0);
        token.content = content;
      }
      state.pos = end + 1;
      return true;
    }

    function mathBlock(state, startLine, endLine, silent) {
      const lineStart = state.bMarks[startLine] + state.tShift[startLine];
      const firstLine = state.src.slice(lineStart, state.eMarks[startLine]);
      const openIdx = firstLine.indexOf("$$");
      if (openIdx === -1) return false;
      let content = "";
      let nextLine = startLine;
      let closed = false;
      const sameClose = firstLine.indexOf("$$", openIdx + 2);
      if (sameClose !== -1) {
        content = firstLine.slice(openIdx + 2, sameClose);
        nextLine = startLine + 1;
        closed = true;
      } else {
        content = `${firstLine.slice(openIdx + 2)}\n`;
        nextLine = startLine + 1;
        while (nextLine < endLine) {
          const line = state.src.slice(state.bMarks[nextLine] + state.tShift[nextLine], state.eMarks[nextLine]);
          const closeIdx = line.indexOf("$$");
          if (closeIdx !== -1) {
            content += line.slice(0, closeIdx);
            nextLine += 1;
            closed = true;
            break;
          }
          content += `${line}\n`;
          nextLine += 1;
        }
      }
      if (!closed) return false;
      content = content.replace(/^\s*\n/, "").replace(/\n\s*$/, "").trim();
      if (!content) return false;
      if (silent) {
        state.line = nextLine;
        return true;
      }
      const token = state.push("math_block", "math", 0);
      token.block = true;
      token.content = content;
      token.map = [startLine, nextLine];
      state.line = nextLine;
      return true;
    }

    md.inline.ruler.before("escape", "math_inline", mathInline);
    md.block.ruler.after("fence", "math_block", mathBlock);
    md.renderer.rules.math_inline = (tokens, idx) => renderKatex(tokens[idx].content, false);
    md.renderer.rules.math_block = (tokens, idx) => `<div class="math-block">${renderKatex(tokens[idx].content, true)}</div>\n`;

    const defaultFence = md.renderer.rules.fence
      || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
    md.renderer.rules.fence = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      const info = String(token.info || "").trim();
      const lang = (info.split(/\s+/)[0] || "").toLowerCase();
      const code = token.content.replace(/\n$/, "");
      if (lang === "mermaid") return mermaidBlock(code, Boolean(env.streaming));
      if (lang === "html") return htmlBlock(code, Boolean(env.streaming));
      if (lang === "chart") {
        try {
          const spec = JSON.parse(code);
          if (spec && Array.isArray(spec.data)) return chartMarkup(spec);
        } catch {
          // Invalid chart JSON falls back to a regular code block.
        }
      }
      return renderCodeBox(code, lang);
    };

    const defaultLinkOpen = md.renderer.rules.link_open
      || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
    md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
      const href = tokens[idx].attrGet("href") || "";
      if (/^https?:\/\//i.test(href)) {
        tokens[idx].attrSet("target", "_blank");
        tokens[idx].attrSet("rel", "noopener noreferrer");
      }
      return defaultLinkOpen(tokens, idx, options, env, self);
    };

    const tableOpen = md.renderer.rules.table_open
      || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
    const tableClose = md.renderer.rules.table_close
      || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
    md.renderer.rules.table_open = (tokens, idx, options, env, self) =>
      `<div class="md-table-wrap">${tableOpen(tokens, idx, options, env, self)}`;
    md.renderer.rules.table_close = (tokens, idx, options, env, self) =>
      `${tableClose(tokens, idx, options, env, self)}</div>`;

    markdownIt = md;
    return md;
  }

  function renderKatex(tex, displayMode) {
    if (window.katex) {
      try {
        return window.katex.renderToString(tex, { throwOnError: false, displayMode, strict: false });
      } catch {
        // Fall through to escaped fallback.
      }
    }
    return `<code>${escapeHtml(tex)}</code>`;
  }

  function mermaidBlock(code, streaming) {
    if (!code.trim()) {
      return '<div class="mermaid-generating"><span class="process-spinner"></span>图表生成中…</div>';
    }
    if (!window.mermaid) return renderCodeBox(code, "mermaid");
    const id = `mermaid-${artifactKey(code)}`;
    return `<div class="mermaid-block" data-mermaid-id="${id}" data-mermaid-streaming="${streaming ? "1" : "0"}" data-mermaid-pending="1">${escapeHtml(code)}</div>`;
  }

  function htmlBlock(code, streaming) {
    if (streaming) {
      return `
        <div class="html-artifact generating">
          <span class="html-artifact-icon">HTML</span>
          <div class="html-artifact-body">
            <strong>正在生成 HTML 页面…</strong>
            <small>完成后可预览、查看代码、保存图片或发布</small>
          </div>
        </div>`;
    }
    return renderHtmlArtifact(code);
  }

  const mermaidCache = new Map();
  let mermaidInitialized = false;

  async function hydrateMermaid(root) {
    if (!window.mermaid || !root?.querySelectorAll) return;
    if (!mermaidInitialized) {
      window.mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "dark", suppressErrorRendering: true });
      mermaidInitialized = true;
    }
    const nodes = [...root.querySelectorAll("[data-mermaid-pending='1']")];
    for (const node of nodes) {
      node.removeAttribute("data-mermaid-pending");
      const id = node.dataset.mermaidId;
      const code = node.textContent;
      try {
        if (mermaidCache.has(code)) {
          node.classList.add("mermaid-rendered");
          node.innerHTML = mermaidCache.get(code);
          continue;
        }
        if (node.dataset.mermaidStreaming === "1" && !(await window.mermaid.parse(code, { suppressErrors: true }))) {
          node.innerHTML = '<div class="mermaid-generating"><span class="process-spinner"></span>图表生成中…</div>';
          continue;
        }
        const result = await window.mermaid.render(`mm-${id}`, code);
        if (mermaidCache.size >= 50) mermaidCache.delete(mermaidCache.keys().next().value);
        mermaidCache.set(code, result.svg);
        if (!node.isConnected) continue;
        node.classList.add("mermaid-rendered");
        node.innerHTML = result.svg;
      } catch (error) {
        if (!node.isConnected) continue;
        if (node.dataset.mermaidStreaming === "1") {
          node.innerHTML = '<div class="mermaid-generating"><span class="process-spinner"></span>图表生成中…</div>';
          continue;
        }
        node.classList.add("mermaid-error");
        node.innerHTML = `<div class="mermaid-error-note">图表渲染失败：${escapeHtml(error.message)}</div>${renderCodeBox(code, "mermaid")}`;
      }
    }
  }

  const CHART_TONES = {
    green: "#27c96a",
    amber: "#f0b451",
    red: "#ef6470",
    blue: "#65a9ff",
    purple: "#b58cff",
  };

  function chartMarkup(spec) {
    if (!spec || !Array.isArray(spec.data) || !spec.data.length) return "";
    const type = ["bar", "line", "area", "pie", "donut"].includes(spec.type) ? spec.type : "bar";
    const data = spec.data
      .map((item) => ({
        label: String(item?.label ?? "").slice(0, 80),
        value: Number.isFinite(Number(item?.value)) ? Number(item.value) : 0,
        tone: CHART_TONES[item?.tone] ? item.tone : "blue",
      }))
      .slice(0, 24);
    const title = escapeHtml(String(spec.title || "数据图表").slice(0, 120));
    const unit = escapeHtml(String(spec.unit || "").slice(0, 16));
    const max = Math.max(1, ...data.map((item) => Math.abs(item.value)));
    const id = `wa-chart-${++chartSequence}`;
    const head = `
      <figcaption>
        <strong>${title}</strong>
        <span>${unit ? `单位：${unit}` : ""}</span>
      </figcaption>`;

    if (type === "line" || type === "area") {
      const width = 520;
      const height = 166;
      const pad = { left: 34, right: 12, top: 14, bottom: 28 };
      const plotW = width - pad.left - pad.right;
      const plotH = height - pad.top - pad.bottom;
      const values = data.map((item) => item.value);
      let minValue = Math.min(...values);
      let maxValue = Math.max(...values);
      const spread = maxValue - minValue;
      if (spread <= 0) {
        minValue -= 1;
        maxValue += 1;
      } else {
        minValue -= spread * 0.12;
        maxValue += spread * 0.12;
      }
      const range = Math.max(1, maxValue - minValue);
      const points = data.map((item, index) => {
        const x = pad.left + (plotW / Math.max(1, data.length - 1)) * index;
        const y = pad.top + plotH - ((item.value - minValue) / range) * plotH;
        return [x, y];
      });
      const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
      const area = `${pad.left},${pad.top + plotH} ${line} ${pad.left + plotW},${pad.top + plotH}`;
      const grid = [0, 0.5, 1].map((ratio) => {
        const y = pad.top + plotH * ratio;
        return `<line class="chart-grid-line" x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}"/>`;
      }).join("");
      const step = Math.ceil(data.length / 7);
      const labels = data.map((item, index) => {
        if (index % step !== 0 && index !== data.length - 1) return "";
        return `<text class="chart-axis-text" x="${points[index][0]}" y="${height - 7}" text-anchor="middle">${escapeHtml(item.label)}</text>`;
      }).join("");
      return `
        <figure class="md-chart ${type === "area" ? "area" : "line"}">
          ${head}
          <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}">
            <defs>
              <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#65a9ff" stop-opacity=".26"/>
                <stop offset="100%" stop-color="#65a9ff" stop-opacity="0"/>
              </linearGradient>
            </defs>
            ${grid}
            ${type === "area" ? `<polygon points="${area}" fill="url(#${id})"></polygon>` : ""}
            <polyline class="chart-trend" points="${line}"/>
            ${points.map(([x, y], index) => `<circle class="chart-point" cx="${x}" cy="${y}" r="2.7"><title>${escapeHtml(data[index].label)}：${data[index].value}${unit}</title></circle>`).join("")}
            ${labels}
          </svg>
        </figure>`;
    }

    if (type === "pie" || type === "donut") {
      const total = data.reduce((sum, item) => sum + Math.max(0, item.value), 0) || 1;
      const radius = 52;
      const circumference = 2 * Math.PI * radius;
      let offset = 0;
      const rings = data.map((item) => {
        const fraction = Math.max(0, item.value) / total;
        const segment = `<circle class="chart-pie-seg" cx="70" cy="70" r="${radius}" stroke="${CHART_TONES[item.tone]}" stroke-dasharray="${(fraction * circumference).toFixed(2)} ${circumference.toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"><title>${escapeHtml(item.label)}：${item.value}${unit}</title></circle>`;
        offset += fraction * circumference;
        return segment;
      }).join("");
      const legend = data.map((item) => `
        <span><i style="--legend:${CHART_TONES[item.tone]}"></i>${escapeHtml(item.label)}<b>${item.value}${unit}</b></span>`).join("");
      return `
        <figure class="md-chart pie">
          ${head}
          <div class="chart-pie-wrap">
            <svg class="chart-pie" viewBox="0 0 140 140" role="img" aria-label="${title}">
              <circle cx="70" cy="70" r="${radius}" fill="none" stroke="#1c2430" stroke-width="${type === "donut" ? 20 : 26}"/>
              <g transform="rotate(-90 70 70)" fill="none" stroke-width="${type === "donut" ? 20 : 26}">${rings}</g>
              ${type === "donut" ? `<text x="70" y="68" text-anchor="middle" class="chart-total">${total}</text><text x="70" y="82" text-anchor="middle" class="chart-total-unit">${unit}</text>` : ""}
            </svg>
            <div class="chart-legend">${legend}</div>
          </div>
        </figure>`;
    }

    const rows = data.map((item) => `
      <div class="md-bar-row">
        <span class="md-bar-label">${escapeHtml(item.label)}</span>
        <span class="md-bar-track"><i style="--value:${Math.max(2, Math.abs(item.value) / max * 100)}%;--bar:${CHART_TONES[item.tone]}"></i></span>
        <strong>${item.value}${unit}</strong>
      </div>`).join("");
    return `
      <figure class="md-chart bar">
        ${head}
        <div class="md-bars">${rows}</div>
      </figure>`;
  }

  function artifactTitle(html) {
    const source = String(html || "");
    const match = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || source.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const raw = match ? match[1].replace(/<[^>]+>/g, "") : "HTML 页面";
    return raw.trim().slice(0, 120) || "HTML 页面";
  }

  function artifactKey(html) {
    let hash = 2166136261;
    for (const char of String(html)) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return `html_${(hash >>> 0).toString(36)}_${String(html).length}`;
  }

  function renderCodeBox(code, language = "", fileName = "") {
    const id = `code_${++codeBoxSequence}`;
    const text = String(code || "").replace(/\n$/, "");
    codeBoxes.set(id, { code: text, language, fileName });
    if (codeBoxCleanupTimer === null) {
      codeBoxCleanupTimer = window.setTimeout(() => {
        codeBoxCleanupTimer = null;
        const connected = new Set($$("[data-code-id]").map((node) => node.dataset.codeId));
        for (const key of codeBoxes.keys()) {
          if (!connected.has(key)) codeBoxes.delete(key);
        }
      }, 0);
    }
    const lineCount = text ? text.split("\n").length : 0;
    const size = new Blob([text]).size;
    return `
      <div class="code-box" data-code-box>
        <div class="code-box-head">
          <span class="code-box-lang">${escapeHtml((language || "text").toUpperCase())}</span>
          <span class="code-box-meta">${Math.max(1, Math.round(size / 1024))} KB · ${lineCount} 行</span>
          <span class="code-box-actions">
            <button type="button" class="code-box-btn" data-code-action="copy" data-code-id="${id}">复制</button>
            <button type="button" class="code-box-btn" data-code-action="download" data-code-id="${id}">下载</button>
            <button type="button" class="code-box-btn" data-code-action="wrap" data-code-id="${id}">换行</button>
          </span>
        </div>
        <pre class="code-box-body"><code>${escapeHtml(text)}</code></pre>
      </div>`;
  }

  function renderHtmlArtifact(html) {
    const id = artifactKey(html);
    const title = artifactTitle(html);
    htmlArtifacts.set(id, { html, title });
    const size = new Blob([html]).size;
    return `
      <div class="html-artifact">
        <span class="html-artifact-icon">HTML</span>
        <div class="html-artifact-body">
          <strong>${escapeHtml(title)}</strong>
          <small>可交互网页 · ${Math.max(1, Math.round(size / 1024))} KB · 隔离沙箱预览</small>
        </div>
        <button class="html-artifact-open" type="button" data-artifact-open="${id}">
          打开预览
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
        </button>
        <button class="html-artifact-code" type="button" data-artifact-code="${id}">查看代码</button>
      </div>`;
  }

  function openCodeModal(title, code, language = "html", fileName = "page.html") {
    openModal(`
      <div class="modal-head">
        <div><h3>${escapeHtml(title || "查看代码")}</h3><p>只读代码，不会在聊天区执行。</p></div>
        <button class="icon-btn" data-action="modal-close">${icon("x")}</button>
      </div>
      <div class="modal-body">${renderCodeBox(code, language, fileName)}</div>`, { wide: true });
  }

  function renderMarkdown(raw, options = {}) {
    if (!raw) return "";
    const streaming = Boolean(options.streaming);
    let source = String(raw);

    // A full HTML document is never dumped into the transcript; turn it into
    // an artifact instead. While streaming, show a generating placeholder.
    if (/^\s*(<!doctype\s+html|<html[\s>])/i.test(source) && /<\/html>\s*$/i.test(source)) {
      return renderHtmlArtifact(source.trim());
    }
    if (streaming && /^\s*(<!doctype\s+html|<html[\s>])/i.test(source)) {
      return htmlBlock("", true);
    }

    // While streaming, markdown-it would parse an unclosed fence as a
    // paragraph. Close it temporarily so code/mermaid blocks stay blocks.
    const fenceCount = (source.match(/```/g) || []).length;
    if (streaming && fenceCount % 2 === 1) {
      source += "\n```";
    }

    if (!window.markdownit) {
      return escapeHtml(source).replace(/\n/g, "<br>");
    }
    return markdownEngine().render(source, { streaming });
  }

  function prettyJson(value, fallback = "") {
    let data = value;
    if (data === null || data === undefined) data = fallback;
    if (typeof data === "string") {
      try { data = JSON.parse(data); } catch { return data.slice(0, 5000); }
    }
    try { return JSON.stringify(data, null, 2).slice(0, 5000); } catch { return String(data).slice(0, 5000); }
  }

  /* ---------- Shell / login ---------- */
  async function boot() {
    bindStaticEvents();
    try {
      const response = await fetch("/api/me", { credentials: "same-origin" });
      if (response.ok) {
        const data = await response.json();
        await enterApp(data.user);
        return;
      }
    } catch {
      // fall through to login
    }
    showLogin();
  }

  function showLogin() {
    if (healthTimer) window.clearInterval(healthTimer);
    healthTimer = null;
    closeModal();
    closeArtifactModal();
    publicationsView = null;
    htmlArtifacts.clear();
    codeBoxes.clear();
    transientReasoning.clear();
    state.user = null;
    state.sending = false;
    $("#app-view").classList.add("hidden");
    $("#login-view").classList.remove("hidden");
    $("#login-error").classList.add("hidden");
    window.setTimeout(() => $("#login-username")?.focus(), 60);
  }

  async function enterApp(user) {
    state.user = user;
    $("#login-view").classList.add("hidden");
    $("#app-view").classList.remove("hidden");
    applyUserUI();
    await loadAgentMeta();
    await loadSessions();
    await restoreActiveSession();
    renderAssistantRail();
    renderWelcome();
    renderConversationList();
    renderChat();
    await loadTools();
    await loadMyUsage();
    renderContextRail();
    loadHealth();
    if (healthTimer) window.clearInterval(healthTimer);
    healthTimer = window.setInterval(loadHealth, 30000);
    switchPage("ai");
  }

  async function loadMyUsage() {
    try {
      const data = await api("/api/agent/usage/me?days=7");
      state.myUsage = data;
    } catch {
      state.myUsage = null;
    }
  }

  function applyUserUI() {
    const user = state.user;
    const letter = initials(user);
    for (const id of ["top-avatar", "rail-avatar", "context-avatar"]) {
      const node = $(`#${id}`);
      if (!node) continue;
      node.textContent = letter;
      node.classList.toggle("admin", Boolean(user.is_admin));
    }
    $("#top-display-name").textContent = user.display_name;
    $("#top-role").textContent = user.is_admin
      ? "系统管理员"
      : `${user.role} · ${user.permissions.length} 项权限`;
    $("#rail-display-name").textContent = user.display_name;
    $("#rail-username").textContent = `@${user.username}`;
    $("#context-display-name").textContent = user.display_name;
    $("#context-username").textContent = `${user.username} · ${user.role}`;
    $("#context-admin-badge").classList.toggle("hidden", !user.is_admin);
    renderPermissions();
    updateDevicePermissions();
  }

  function renderPermissions() {
    const root = $("#permission-chips");
    if (!root) return;
    root.innerHTML = (state.user?.permissions || []).map((permission) => {
      const highlight = ["device:update", "device:delete", "user:manage"].includes(permission);
      return `<span class="permission-chip ${highlight ? "highlight" : ""}" title="${escapeHtml(permission)}">${escapeHtml(PERMISSION_LABELS[permission] || permission)}</span>`;
    }).join("");
  }

  async function login(event) {
    event.preventDefault();
    const errorNode = $("#login-error");
    const button = $("#login-btn");
    errorNode.classList.add("hidden");
    button.disabled = true;
    try {
      const data = await api("/api/login", {
        method: "POST",
        body: { username: $("#login-username").value.trim(), password: $("#login-password").value },
      });
      await enterApp(data.user);
      toast(`欢迎回来，${data.user.display_name}`);
    } catch (error) {
      errorNode.textContent = error.message;
      errorNode.classList.remove("hidden");
    } finally {
      button.disabled = false;
    }
  }

  async function logout() {
    try { await api("/api/logout", { method: "POST" }); } catch { /* ignore */ }
    showLogin();
    toast("已退出登录");
  }

  /* ---------- Navigation ---------- */
  function switchPage(page) {
    state.page = page;
    $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.page === page));
    for (const name of ["ai", "devices", "config"]) {
      $(`#page-${name}`).classList.toggle("hidden", name !== page);
    }
    if (page === "devices") loadDevices();
    if (page === "config") loadConfigPage();
    if (page === "ai") {
      renderChat();
      window.setTimeout(() => $("#chat-input")?.focus(), 50);
    }
  }

  async function loadHealth() {
    const pill = $("#health-pill");
    if (!pill) return;
    try {
      const response = await fetch("/api/health", { credentials: "same-origin" });
      const data = await response.json();
      const services = data.services || {};
      const allOk = data.ok && services.agent?.ok && services.mcp?.ok;
      pill.classList.toggle("ok", Boolean(allOk));
      pill.classList.toggle("bad", !allOk);
      pill.innerHTML = `<i></i> ${allOk ? "服务正常" : "部分离线"}`;
      pill.title = `Business: ok · Agent: ${services.agent?.ok ? "ok" : "offline"} · MCP: ${services.mcp?.ok ? "ok" : "offline"}`;
    } catch {
      pill.classList.remove("ok");
      pill.classList.add("bad");
      pill.innerHTML = "<i></i> 服务离线";
    }
  }

  /* ---------- Agent meta ---------- */
  async function loadAgentMeta() {
    if (!state.user) return;
    const results = await Promise.allSettled([
      api("/api/agent/assistants"),
      api("/api/agent/models"),
      api("/api/agent/skills"),
      api("/api/agent/status"),
    ]);
    let failures = 0;
    if (results[0].status === "fulfilled") state.assistants = results[0].value.items || [];
    else failures += 1;
    if (results[1].status === "fulfilled") state.models = (results[1].value.items || []).filter((model) => ["chat", "vision"].includes(model.model_kind || "chat"));
    else failures += 1;
    if (results[2].status === "fulfilled") state.skills = results[2].value.items || [];
    else failures += 1;
    if (results[3].status === "fulfilled") {
      state.status = results[3].value;
      state.demoMode = Boolean(results[3].value.demo_mode);
      const storedApproval = localStorage.getItem(`wa_approval_${state.user.username}`);
      const preferredApproval = storedApproval || results[3].value.default_approval_mode || "confirm";
      state.approvalMode = preferredApproval === "full_access" && results[3].value.allow_full_access
        ? "full_access"
        : "confirm";
    } else failures += 1;

    const storedAssistant = Number(localStorage.getItem(`wa_assistant_${state.user.username}`));
    const fallback = state.assistants.find((item) => Number(item.id) === storedAssistant) || state.assistants[0];
    state.assistantId = fallback ? Number(fallback.id) : null;
    const assistant = currentAssistant();

    const preferredModel = Number(assistant?.model_row_id) || Number(localStorage.getItem(`wa_model_${state.user.username}`));
    const model = state.models.find((item) => Number(item.id) === preferredModel)
      || state.models.find((item) => item.is_default)
      || state.models[0];
    state.modelId = model ? Number(model.id) : null;

    renderModelSelect();
    renderApprovalMode();
    renderVoiceState();
    updateDemoBadge();
    updateSendState();
    if (failures) toast("部分 Agent 配置未能加载，请检查 8010 / 8020 服务", "warn");
  }

  function renderAssistantRail() {
    const root = $("#assistant-list");
    if (!root) return;
    if (!state.assistants.length) {
      root.innerHTML = '<div class="conv-empty">管理员还没有配置可用助手</div>';
      return;
    }
    root.innerHTML = state.assistants.map((assistant) => `
      <button type="button" class="assistant-item ${Number(assistant.id) === Number(state.assistantId) ? "active" : ""}" data-action="assistant-switch" data-id="${assistant.id}">
        <span class="assistant-icon">${escapeHtml(assistant.icon || "✦")}</span>
        <span class="assistant-item-main">
          <strong>${escapeHtml(assistant.name)}</strong>
          <small>${escapeHtml(assistant.description || "通用业务助手")}</small>
        </span>
        <span class="assistant-mode">${escapeHtml(MODE_LABELS[assistant.mode] || assistant.mode)}</span>
      </button>`).join("");
  }

  function renderWelcome() {
    const assistant = currentAssistant();
    $("#welcome-title").textContent = state.status?.welcome_title || "有什么我能帮你的吗？";
    $("#welcome-subtitle").textContent = state.status?.welcome_subtitle || assistant?.greeting
      || (can("device:update")
        ? "我可以查询设备、统计状态，并在你审批后执行修改或删除。"
        : "我可以查询设备、统计状态。当前账号没有写入权限，Agent 也不会越权。");
    renderQuickChips();
    $("#chat-assistant-icon").textContent = assistant?.icon || "✦";
    $("#mode-badge").textContent = MODE_LABELS[assistant?.mode || "agent"];
    $("#mode-badge").className = `badge ${assistant?.mode === "report" ? "badge-blue" : "badge-green"}`;
  }

  function renderQuickChips() {
    const root = $("#quick-chips");
    if (!root) return;
    const assistant = currentAssistant();
    let chips = [];
    const configured = String(state.status?.welcome_prompts || "")
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (configured.length) {
      chips = configured;
    } else if (assistant?.mode === "report") {
      chips = [assistant.greeting || "生成设备健康报告", "开始生成报告"];
    } else if (assistant?.name?.includes("只读")) {
      chips = ["查看全部设备", "统计设备状态", "离线设备有哪些"];
    } else {
      chips = ["查看全部设备", "统计设备状态"];
      if (can("device:update")) chips.push("把 2 号设备状态改为维护中");
      if (can("device:delete")) chips.push("删除 4 号设备");
      if (state.user?.is_admin) chips.push("查看所有用户");
    }
    root.innerHTML = chips.map((text) => `<button class="quick-chip" data-action="quick-prompt" data-prompt="${escapeHtml(text)}">${escapeHtml(text)}</button>`).join("");
  }

  function renderModelSelect() {
    const select = $("#model-select");
    if (!select) return;
    const assistant = currentAssistant();
    const locked = assistant && assistant.allow_model_switch === false;
    if (!state.models.length) {
      select.innerHTML = '<option value="">无可用模型</option>';
      select.disabled = true;
    } else {
      select.disabled = Boolean(locked);
      select.innerHTML = state.models.map((model) =>
        `<option value="${model.id}">${escapeHtml(model.name)}</option>`
      ).join("");
      select.value = String(state.modelId || state.models[0].id);
    }
    if (assistant?.model_row_id) state.modelId = Number(assistant.model_row_id);
    const model = selectedModel();
    const note = $("#composer-model-note");
    if (note) note.textContent = model ? `${model.name} · ${model.model_id}${locked ? "（助手绑定）" : ""}` : "未配置模型";
    renderReasoningSelect();
  }

  function renderReasoningSelect() {
    const wrap = $("#reasoning-wrap");
    const select = $("#reasoning-select");
    const model = selectedModel();
    if (!wrap || !select) return;
    if (!model?.supports_reasoning) {
      wrap.classList.add("hidden");
      state.reasoningEffort = "";
      return;
    }
    wrap.classList.remove("hidden");
    const allowed = new Set(model.reasoning_efforts || []);
    const options = REASONING_OPTIONS.filter(([value]) => !value || (allowed.has(value) && (value !== "off" || model.reasoning_can_disable)));
    if (!options.some(([value]) => value === state.reasoningEffort)) state.reasoningEffort = "";
    select.innerHTML = options.map(([value, label]) =>
      `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`
    ).join("");
    select.value = state.reasoningEffort || "";
  }

  function renderApprovalMode() {
    const allowed = state.status?.allow_full_access !== false;
    if (!allowed) state.approvalMode = "confirm";
    const mode = state.approvalMode === "full_access" && allowed ? "full_access" : "confirm";
    state.approvalMode = mode;
    const label = $("#access-mode-label");
    if (label) label.textContent = APPROVAL_MODE_LABELS[mode];
    const button = $("#access-mode-btn");
    if (button) {
      button.classList.toggle("active-warning", mode === "full_access");
      button.title = mode === "full_access"
        ? "完全访问：改动类工具直接执行，但不会扩大你的工具权限"
        : "变更前确认：改动类工具执行前需要你批准";
    }
    $$("[data-action='set-approval-mode']").forEach((option) => {
      const active = option.dataset.mode === mode;
      option.classList.toggle("active", active);
      option.classList.toggle("disabled", option.dataset.mode === "full_access" && !allowed);
      option.disabled = option.dataset.mode === "full_access" && !allowed;
    });
    const note = $("#access-popover > p");
    if (note) {
      note.textContent = allowed
        ? "只跳过确认，不扩大工具权限；每次执行仍会写入审计和对话记录。"
        : "管理员已关闭完全访问；当前保持不变前确认。";
    }
  }

  function setApprovalMode(mode) {
    if (mode === "full_access" && state.status?.allow_full_access === false) {
      toast("管理员未开启完全访问", "warn");
      return;
    }
    state.approvalMode = mode === "full_access" ? "full_access" : "confirm";
    localStorage.setItem(`wa_approval_${state.user.username}`, state.approvalMode);
    $("#access-popover")?.classList.add("hidden");
    renderApprovalMode();
    toast(
      state.approvalMode === "full_access"
        ? "已切换为完全访问：改动类工具将直接执行"
        : "已切换为变更前确认",
      state.approvalMode === "full_access" ? "warn" : "ok",
      2600,
    );
  }

  function renderVoiceState() {
    const button = $("#voice-btn");
    if (!button) return;
    const configured = Boolean(state.status?.asr?.configured);
    button.disabled = !configured || state.voiceBusy;
    button.title = configured
      ? `语音输入（${state.status.asr.model_name || "ASR"}）`
      : (state.status?.asr?.reason || "管理员尚未配置语音识别模型");
    const label = $("#voice-label");
    if (label) label.textContent = state.recording ? "停止" : (state.voiceBusy ? "识别中" : "语音");
  }

  function changeModel(value) {
    const model = state.models.find((item) => Number(item.id) === Number(value));
    if (!model) return;
    state.modelId = Number(model.id);
    state.reasoningEffort = "";
    localStorage.setItem(`wa_model_${state.user.username}`, String(state.modelId));
    renderModelSelect();
    renderContextRail();
    toast(`本轮模型切换为 ${model.name}`, "ok", 2200);
  }

  async function loadTools() {
    const assistant = currentAssistant();
    const query = assistant ? `?assistant_id=${assistant.id}` : "";
    try {
      const data = await api(`/api/agent/tools${query}`);
      state.tools = data.items || [];
    } catch (error) {
      state.tools = [];
      toast(error.message, "warn");
    }
    const key = `wa_tools_${state.user.username}_${state.assistantId || "none"}`;
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(key) || "null"); } catch { stored = null; }
    const selected = new Set();
    for (const tool of state.tools) {
      if (tool.selectable === false) {
        selected.add(tool.name);
      } else if (Array.isArray(stored)) {
        if (stored.includes(tool.name)) selected.add(tool.name);
      } else if (tool.default_selected !== false) {
        selected.add(tool.name);
      }
    }
    state.selectedTools = selected;
    renderToolPopover();
    renderContextRail();
    updateSendState();
  }

  function saveToolSelection() {
    if (!state.user) return;
    const key = `wa_tools_${state.user.username}_${state.assistantId || "none"}`;
    const selectable = new Set(state.tools.filter((tool) => tool.selectable !== false).map((tool) => tool.name));
    localStorage.setItem(key, JSON.stringify([...state.selectedTools].filter((name) => selectable.has(name))));
  }

  function renderToolPopover() {
    const list = $("#tool-popover-list");
    if (!list) return;
    if (!state.tools.length) {
      list.innerHTML = '<div class="mini-empty" style="padding:18px">当前助手没有可用工具，请联系管理员检查助手配置或账号权限。</div>';
    } else {
      list.innerHTML = state.tools.map((tool) => {
        const checked = state.selectedTools.has(tool.name);
        const fixed = tool.selectable === false;
        return `
          <label class="tool-option ${checked ? "" : "off"}">
            <input type="checkbox" data-tool-name="${escapeHtml(tool.name)}" ${checked ? "checked" : ""} ${fixed ? "disabled" : ""}>
            <span class="tool-option-body">
              <span class="tool-option-title">
                <strong>${escapeHtml(tool.name)}</strong>
                <span class="risk-badge ${escapeHtml(tool.risk)}">${escapeHtml(RISK_LABELS[tool.risk] || tool.risk)}</span>
                ${fixed ? '<span class="badge badge-blue">固定</span>' : ""}
                ${tool.source === "dynamic" ? '<span class="badge">动态</span>' : ""}
              </span>
              <p>${escapeHtml(tool.description)}</p>
              <span class="tool-perm">${escapeHtml(tool.permission)}</span>
            </span>
          </label>`;
      }).join("");
    }
    updateToolCount();
  }

  function updateToolCount() {
    const total = state.tools.length;
    const enabled = state.tools.filter((tool) => state.selectedTools.has(tool.name)).length;
    const node = $("#tool-count");
    if (node) node.textContent = `${enabled}/${total}`;
    $("#tool-picker-btn")?.classList.toggle("warn-text", enabled === 0);
  }

  /* ---------- Sessions ---------- */
  async function loadSessions() {
    try {
      const data = await api("/api/agent/sessions");
      state.sessions = data.items || [];
    } catch (error) {
      state.sessions = [];
      toast(error.message, "warn");
    }
  }

  async function restoreActiveSession() {
    const key = `wa_session_${state.user.username}`;
    const stored = localStorage.getItem(key);
    const assistant = currentAssistant();
    const candidates = state.sessions.filter((session) =>
      !assistant || !session.assistant_id || Number(session.assistant_id) === Number(assistant.id)
    );
    let session = candidates.find((item) => item.id === stored) || candidates[0];
    if (!session) {
      session = await createSession(state.assistantId, false);
    }
    state.activeSessionId = session ? session.id : null;
    if (state.activeSessionId) {
      localStorage.setItem(key, state.activeSessionId);
      await loadMessages(state.activeSessionId);
    }
  }

  async function createSession(assistantId, switchTo = true) {
    try {
      const data = await api("/api/agent/sessions", {
        method: "POST",
        body: { assistant_id: assistantId || null },
      });
      const session = data.session;
      state.sessions.unshift(session);
      if (switchTo) {
        state.activeSessionId = session.id;
        state.messages = [];
        state.contextInfo = null;
        state.lastBudget = null;
        state.lastRun = null;
        state.usage = null;
        state.sessionUsage = session;
        localStorage.setItem(`wa_session_${state.user.username}`, session.id);
        renderConversationList();
        renderChat();
        renderContextRail();
      }
      return session;
    } catch (error) {
      toast(error.message, "error");
      return null;
    }
  }

  async function newChat() {
    const assistant = currentAssistant();
    await createSession(assistant?.id || null, true);
    $("#chat-input").value = "";
    $("#chat-input").style.height = "auto";
    state.attachments = [];
    renderAttachments();
    toast("已新建对话", "ok", 1600);
    $("#chat-input").focus();
  }

  async function openSession(id) {
    if (id === state.activeSessionId) return;
    state.activeSessionId = id;
    localStorage.setItem(`wa_session_${state.user.username}`, id);
    await loadMessages(id);
    renderConversationList();
    renderChat();
    renderContextRail();
  }

  async function loadMessages(sessionId, { liveReasoning = "" } = {}) {
    try {
      const data = await api(`/api/agent/sessions/${encodeURIComponent(sessionId)}/messages`);
      state.messages = data.items || [];
      const lastAssistant = [...state.messages].reverse().find((message) => message.role === "assistant" && message.metadata);
      for (const message of state.messages) {
        if (message.reasoning && message.metadata?.reasoning) message.metadata.reasoning.stored = true;
      }
      if (lastAssistant && liveReasoning && !lastAssistant.reasoning) {
        if (transientReasoning.size >= 50) transientReasoning.delete(transientReasoning.keys().next().value);
        transientReasoning.set(`${sessionId}:${lastAssistant.id}`, liveReasoning);
      }
      for (const message of state.messages) {
        if (!message.reasoning) message.reasoning = transientReasoning.get(`${sessionId}:${message.id}`) || "";
      }
      state.contextInfo = lastAssistant?.metadata?.context || null;
      state.lastRun = lastAssistant?.metadata?.run || null;
      state.usage = lastAssistant?.metadata?.usage || null;
      const session = state.sessions.find((item) => item.id === sessionId);
      if (session && data.session) {
        session.title = data.session.title;
        session.message_count = data.session.message_count;
        Object.assign(session, data.session);
      }
      state.sessionUsage = data.session || null;
      if (data.session?.assistant_id && !state.assistantId) {
        state.assistantId = Number(data.session.assistant_id);
      }
    } catch (error) {
      state.messages = [];
      toast(error.message, "error");
    }
  }

  async function deleteSession(id) {
    const session = state.sessions.find((item) => item.id === id);
    if (!session) return;
    if (!(await confirmDialog({ title: "删除会话", message: `确定删除「${session.title}」及其全部消息？`, confirmText: "删除", danger: true }))) return;
    try {
      await api(`/api/agent/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      state.sessions = state.sessions.filter((item) => item.id !== id);
      if (state.activeSessionId === id) {
        const assistant = currentAssistant();
        const next = state.sessions.find((item) => !assistant || Number(item.assistant_id) === Number(assistant.id));
        if (next) {
          state.activeSessionId = next.id;
          await loadMessages(next.id);
        } else {
          await createSession(assistant?.id || null, true);
        }
      }
      renderConversationList();
      renderChat();
      toast("会话已删除", "ok", 1800);
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function renameSession(id) {
    const session = state.sessions.find((item) => item.id === id);
    if (!session) return;
    const title = await promptDialog({
      title: "重命名会话",
      message: "给这个对话起一个更易识别的名字。",
      value: session.title || "",
      placeholder: "例如：设备巡检报告",
      confirmText: "保存",
    });
    if (!title) return;
    try {
      await api(`/api/agent/sessions/${encodeURIComponent(id)}`, { method: "PATCH", body: { title } });
      session.title = title;
      if (state.activeSessionId === id) $("#chat-heading").textContent = title;
      renderConversationList();
      toast("会话已重命名", "ok", 1600);
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function forkSession(id, untilMessageId = null) {
    const session = state.sessions.find((item) => item.id === id);
    if (!session) return;
    try {
      const body = { until_message_id: untilMessageId || null, title: `分叉 · ${session.title || "新对话"}` };
      const data = await api(`/api/agent/sessions/${encodeURIComponent(id)}/fork`, { method: "POST", body });
      const branch = data.session;
      state.sessions.unshift(branch);
      state.activeSessionId = branch.id;
      localStorage.setItem(`wa_session_${state.user.username}`, branch.id);
      await loadMessages(branch.id);
      renderConversationList();
      renderChat();
      renderContextRail();
      toast("已从当前会话分叉", "ok", 1800);
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function deleteMessage(messageId) {
    if (!state.activeSessionId) return;
    if (!(await confirmDialog({ title: "删除消息", message: "将删除这条消息，无法恢复。", confirmText: "删除", danger: true }))) return;
    try {
      await api(`/api/agent/sessions/${encodeURIComponent(state.activeSessionId)}/messages/${encodeURIComponent(messageId)}`, { method: "DELETE" });
      state.messages = state.messages.filter((item) => item.id !== messageId);
      await loadSessions();
      renderConversationList();
      renderChat();
      renderContextRail();
      toast("消息已删除", "ok", 1600);
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function editMessage(messageId) {
    const message = state.messages.find((item) => item.id === messageId);
    if (!message || !state.activeSessionId) return;
    const content = await promptDialog({
      title: "编辑消息",
      message: "修改这条提问后，后续回答不会被自动重算。",
      value: message.content || "",
      placeholder: "输入新的问题内容",
      confirmText: "保存",
    });
    if (!content) return;
    try {
      await api(`/api/agent/sessions/${encodeURIComponent(state.activeSessionId)}/messages/${encodeURIComponent(messageId)}`, { method: "PATCH", body: { content } });
      message.content = content;
      renderChat();
      toast("消息已更新", "ok", 1600);
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function clearChat() {
    if (!state.activeSessionId) return;
    if (!state.messages.length) return;
    if (!(await confirmDialog({ title: "清空对话", message: "将删除当前会话的全部消息，无法恢复。", confirmText: "清空", danger: true }))) return;
    try {
      await api(`/api/agent/sessions/${encodeURIComponent(state.activeSessionId)}/messages`, { method: "DELETE" });
      state.messages = [];
      state.contextInfo = null;
      await loadSessions();
      renderConversationList();
      renderChat();
      toast("当前对话已清空", "ok", 1800);
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function compactChat() {
    if (!state.activeSessionId) {
      toast("当前还没有会话", "warn");
      return;
    }
    const button = $("#compact-chat-btn");
    if (button) {
      button.disabled = true;
      button.textContent = "压缩中…";
    }
    try {
      const data = await api(`/api/agent/sessions/${encodeURIComponent(state.activeSessionId)}/compact`, {
        method: "POST",
        body: { model_row_id: state.modelId },
      });
      const compaction = data.compaction || {};
      state.sessionUsage = data.session || state.sessionUsage;
      state.contextInfo = {
        ...(state.contextInfo || {}),
        compacted: Boolean(compaction.ok),
        compaction,
        context_tokens: compaction.ok ? compaction.after_tokens : state.contextInfo?.context_tokens,
        summarized_messages: compaction.summarized_messages || 0,
      };
      await loadMessages(state.activeSessionId);
      await loadSessions();
      renderConversationList();
      renderChat();
      renderContextRail();
      if (compaction.ok) {
        toast(`压缩完成，节省 ${formatTokens(compaction.saved_tokens || 0)} tokens`, "ok");
      } else {
        toast(compaction.reason || "当前没有需要压缩的内容", "warn");
      }
    } catch (error) {
      toast(error.message, "error", 5000);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "压缩上下文";
      }
    }
  }

  async function switchAssistant(id) {
    if (Number(id) === Number(state.assistantId)) {
      closeModal();
      return;
    }
    closeModal();
    state.assistantId = Number(id);
    localStorage.setItem(`wa_assistant_${state.user.username}`, String(id));
    const assistant = currentAssistant();
    if (assistant?.model_row_id) {
      state.modelId = Number(assistant.model_row_id);
    }
    renderAssistantRail();
    renderWelcome();
    renderModelSelect();
    await loadTools();
    const existing = state.sessions.find((item) => Number(item.assistant_id) === Number(id));
    if (existing) {
      state.activeSessionId = existing.id;
      localStorage.setItem(`wa_session_${state.user.username}`, existing.id);
      await loadMessages(existing.id);
      renderConversationList();
      renderChat();
    } else {
      await createSession(id, true);
    }
    renderContextRail();
  }

  function openAssistantPicker() {
    openModal(`
      <div class="modal-head">
        <div><h3>切换助手</h3><p>不同助手有不同的提示词、工具白名单和运行预算。</p></div>
        <button class="icon-btn" data-action="modal-close">${icon("x")}</button>
      </div>
      <div class="modal-body">
        <div class="list-panel">
          ${state.assistants.map((item) => `
            <div class="list-row" data-action="assistant-switch" data-id="${item.id}" style="cursor:pointer">
              <span class="assistant-icon">${escapeHtml(item.icon || "✦")}</span>
              <div class="list-row-main">
                <div class="list-row-title">
                  <strong>${escapeHtml(item.name)}</strong>
                  <span class="badge ${item.mode === "report" ? "badge-blue" : "badge-green"}">${MODE_LABELS[item.mode] || item.mode}</span>
                  ${Number(item.id) === Number(state.assistantId) ? '<span class="badge badge-green">当前</span>' : ""}
                </div>
                <p>${escapeHtml(item.description || "通用业务助手")}</p>
                <div class="list-row-meta">
                  <span>${item.model_name ? escapeHtml(item.model_name) : "默认模型"}</span>
                  <span>${item.tool_names.length ? item.tool_names.length + " 个工具" : "按账号权限"}</span>
                </div>
              </div>
            </div>`).join("")}
        </div>
      </div>`);
  }

  function renderConversationList() {
    const root = $("#conv-list");
    if (!root) return;
    const assistant = currentAssistant();
    const items = state.sessions.filter((session) =>
      !assistant || !session.assistant_id || Number(session.assistant_id) === Number(assistant.id)
    );
    root.innerHTML = items.length
      ? items.map((session) => `
          <div class="conv-item ${session.id === state.activeSessionId ? "active" : ""}">
            <button class="conv-open" type="button" data-action="session-open" data-id="${escapeHtml(session.id)}">
              <span class="conv-title">${escapeHtml(session.title || "新对话")}</span>
              <span class="conv-meta">${formatRelative(session.updated_at)} · ${session.message_count || 0} 条</span>
            </button>
            <span class="conv-actions">
              <button class="conv-action" type="button" data-action="session-fork" data-id="${escapeHtml(session.id)}" title="分叉会话">${icon("refresh", 11)}</button>
              <button class="conv-action" type="button" data-action="session-rename" data-id="${escapeHtml(session.id)}" title="重命名">${icon("edit", 11)}</button>
              <button class="conv-action danger" type="button" data-action="session-delete" data-id="${escapeHtml(session.id)}" title="删除会话">${icon("trash", 11)}</button>
            </span>
          </div>`).join("")
      : '<div class="conv-empty">这个助手还没有对话<br>直接提问就会开始</div>';
  }

  function isNearBottom() {
    const scroll = $("#chat-scroll");
    if (!scroll) return true;
    return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 180;
  }

  function scrollToBottom() {
    const scroll = $("#chat-scroll");
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }

  function renderChat({ forceScroll = false } = {}) {
    const hasMessages = state.messages.length > 0;
    const wasNearBottom = isNearBottom();
    $("#chat-welcome").classList.toggle("hidden", hasMessages);
    const session = state.sessions.find((item) => item.id === state.activeSessionId);
    $("#chat-heading").textContent = session?.title || "新对话";
    const assistant = currentAssistant();
    $("#chat-subheading").textContent = hasMessages
      ? `${state.messages.filter((m) => m.role === "user").length} 次提问 · ${assistant?.name || "Agent"} · 使用你的账号权限`
      : `${assistant?.name || "Agent"} 已就绪，使用你的账号权限`;
    $("#clear-chat-btn").disabled = !hasMessages;
    const messagesRoot = $("#messages");
    messagesRoot.innerHTML = state.messages.map(renderMessage).join("");
    hydrateMermaid(messagesRoot);
    if (state.sending && !state.streamingMessage) {
      messagesRoot.insertAdjacentHTML("beforeend", `
        <div class="message assistant">
          <div class="msg-avatar">AI</div>
          <div class="msg-body">
            <div class="msg-meta"><strong>${escapeHtml(assistant?.name || "Agent")}</strong><span>正在处理</span></div>
            <div class="process-line running">
              <span class="process-spinner"></span>
              <span class="process-label">正在思考…</span>
            </div>
          </div>
        </div>`);
    }
    state.streamEl = state.streamingMessage
      ? messagesRoot.lastElementChild
      : null;
    requestAnimationFrame(() => {
      if (forceScroll || wasNearBottom) scrollToBottom();
    });
  }

  function renderMessage(message) {
    const meta = message.metadata || {};
    const real = Number.isInteger(message.id);
    if (message.role === "user") {
      const attachments = Array.isArray(message.attachments) ? message.attachments : [];
      return `
        <div class="message user" data-message-id="${escapeHtml(message.id)}">
          <div class="msg-avatar">${escapeHtml(initials(state.user))}</div>
          <div class="msg-body">
            <div class="msg-meta"><span>${formatRelative(message.created_at)}</span><strong>你</strong></div>
            <div class="msg-content">${renderMarkdown(message.content)}</div>
            ${attachments.length ? `<div class="msg-attachments">${attachments.map((item) => `<span class="card-tag">${escapeHtml(item.name)}</span>`).join("")}</div>` : ""}
            ${real ? `<div class="msg-actions"><button class="msg-action" type="button" data-action="message-edit" data-id="${message.id}">编辑</button><button class="msg-action danger" type="button" data-action="message-delete" data-id="${message.id}">删除</button></div>` : ""}
          </div>
        </div>`;
    }
    const modelName = meta.model?.name || selectedModel()?.name || "Agent";
    const runs = Array.isArray(message.tool_runs) ? message.tool_runs : [];
    const streaming = state.streamingMessage && message.id === state.streamingMessage.id;
    const approval = meta.approval && !meta.approval_status ? meta.approval : null;
    const contentHtml = streaming
      ? `<div class="msg-content streaming-text" data-stream-markdown>${renderMarkdown(state.liveText, { streaming: true })}</div><span class="stream-cursor"></span>`
      : (message.content ? `<div class="msg-content ${meta.status === "error" ? "is-error" : ""}">${renderMarkdown(message.content)}</div>` : "");
    return `
      <div class="message assistant ${streaming ? "streaming" : ""}" data-message-id="${escapeHtml(message.id)}">
        <div class="msg-avatar">${escapeHtml((meta.assistant?.icon) || "AI")}</div>
        <div class="msg-body">
          <div class="msg-meta">
            <strong>${escapeHtml(meta.assistant?.name || currentAssistant()?.name || "Agent")}</strong>
            <span>${escapeHtml(modelName)}</span>
            ${meta.status === "error" ? '<span class="badge badge-red">失败</span>' : ""}
            ${streaming ? '<span class="badge badge-blue">流式输出</span>' : ""}
          </div>
          <div data-live-process>${renderProcess(message, { streaming })}</div>
          <div data-live-content>${contentHtml}</div>
          <div data-live-approval>${approval ? renderApproval(approval) : ""}</div>
          ${meta.context?.compressed ? `<div class="msg-context-note">上下文已压缩：${meta.context.summarized_messages} 条历史已摘要</div>` : ""}
          <div class="msg-foot">
            ${real ? `<span class="msg-actions"><button class="msg-action" type="button" data-action="message-fork" data-id="${message.id}">分叉自此</button><button class="msg-action danger" type="button" data-action="message-delete" data-id="${message.id}">删除</button></span>` : ""}
          </div>
        </div>
      </div>`;
  }

  function formatSeconds(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds < 0) return "";
    if (seconds < 10) return `${seconds.toFixed(1)}s`;
    if (seconds < 60) return `${Math.round(seconds)}s`;
    return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  }

  function runStatusLabel(status) {
    return {
      ok: "完成",
      error: "失败",
      pending: "待审批",
      rejected: "已取消",
      running: "执行中",
    }[status] || status || "完成";
  }

  function addLiveActivity(title, preview = "", kind = "step") {
    state.liveOutputActivity = null;
    state.liveOutputLength = 0;
    const activity = { id: `output-${++state.liveActivitySequence}`, title, preview, kind };
    state.liveActivities.push(activity);
    if (state.liveActivities.length > 300) state.liveActivities.splice(0, state.liveActivities.length - 300);
    return activity;
  }

  function appendLiveOutput(title, text, kind) {
    for (const character of String(text || "")) {
      if (!state.liveOutputActivity || state.liveOutputActivity.title !== title) state.liveOutputActivity = addLiveActivity(title, "", kind);
      state.liveOutputActivity.preview += character;
      state.liveOutputLength += 1;
      if (state.liveOutputLength >= 36 || (state.liveOutputLength >= 16 && /[。！？!?；;\n]/u.test(character))) {
        state.liveOutputActivity = null;
        state.liveOutputLength = 0;
      }
    }
  }

  function currentLiveActivity() {
    const activities = state.liveActivities;
    if (!activities.length) return { id: "connecting", title: "正在连接", preview: "" };
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let index = activities.findIndex((activity) => activity.id === state.liveActivityId);
    if (reducedMotion && !state.livePlaybackPaused) return activities.at(-1);
    if (index < 0) {
      index = 0;
      state.liveActivityId = activities[0].id;
      state.liveActivityAt = Date.now();
    }
    const activity = activities[index];
    const remaining = activities.length - index - 1;
    const dwell = activity.preview ? remaining > 10 ? 600 : remaining > 3 ? 1100 : 2200 : 450;
    if (!state.livePlaybackPaused && !state.livePlaybackInteracting && Date.now() - state.liveActivityAt >= dwell && index < activities.length - 1) {
      state.liveActivityId = activities[index + 1].id;
      state.liveActivityAt = Date.now();
      return activities[index + 1];
    }
    return activity;
  }

  function livePlaybackControls() {
    if (state.liveActivities.length < 2) return "";
    return `<span class="process-playback" role="group" aria-label="实时过程播放控制"><button type="button" data-process-playback="previous" aria-label="上一条过程" title="上一条">‹</button><button type="button" data-process-playback="pause" aria-label="${state.livePlaybackPaused ? "继续播放过程" : "暂停播放过程"}" aria-pressed="${state.livePlaybackPaused}">${state.livePlaybackPaused ? "▷" : "Ⅱ"}</button><button type="button" data-process-playback="next" aria-label="下一条过程" title="下一条">›</button></span>`;
  }

  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-process-playback]");
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    const action = target.dataset.processPlayback;
    if (action === "pause") {
      state.livePlaybackPaused = !state.livePlaybackPaused;
      state.livePlaybackInteracting = false;
    } else {
      const index = Math.max(0, state.liveActivities.findIndex((activity) => activity.id === state.liveActivityId));
      const nextIndex = Math.max(0, Math.min(state.liveActivities.length - 1, index + (action === "previous" ? -1 : 1)));
      state.liveActivityId = state.liveActivities[nextIndex]?.id;
      state.livePlaybackPaused = true;
    }
    state.liveActivityAt = Date.now();
    updateLiveProcessHeader();
  });

  function updateLiveProcessHeader() {
    const root = state.streamEl?.querySelector("[data-live-process]");
    const label = root?.querySelector("[data-process-label]");
    const preview = root?.querySelector("[data-process-preview]");
    if (!label || !preview || state.liveCompleted || state.liveError) return;
    const activity = currentLiveActivity();
    const line = root.querySelector(".process-line");
    if (line && !line.dataset.playbackBound) {
      line.dataset.playbackBound = "1";
      const summary = line.querySelector(":scope > summary");
      summary.addEventListener("mouseenter", () => { state.livePlaybackInteracting = true; updateLiveProcessHeader(); });
      summary.addEventListener("mouseleave", () => { state.livePlaybackInteracting = false; updateLiveProcessHeader(); });
      summary.addEventListener("focusin", () => { state.livePlaybackInteracting = true; updateLiveProcessHeader(); });
      summary.addEventListener("focusout", (event) => { if (!summary.contains(event.relatedTarget)) { state.livePlaybackInteracting = false; updateLiveProcessHeader(); } });
    }
    if (label.textContent !== activity.title) label.textContent = activity.title;
    if (preview.textContent !== activity.preview.replace(/\s+/g, " ")) preview.textContent = activity.preview.replace(/\s+/g, " ");
    const overflow = Math.max(0, preview.scrollWidth - preview.parentElement.clientWidth);
    if (preview.dataset.activityId !== activity.id || preview.dataset.overflow !== String(overflow)) {
      preview.dataset.activityId = activity.id;
      preview.dataset.overflow = String(overflow);
      preview.getAnimations().forEach((animation) => animation.cancel());
      if (overflow > 0 && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        preview.animate([{ transform: "translateX(0)" }, { transform: `translateX(-${overflow}px)` }], { duration: Math.max(1200, overflow / 150 * 1000), delay: 500, fill: "forwards", easing: "linear" });
      }
    }
    preview.getAnimations().forEach((animation) => { if (state.livePlaybackPaused || state.livePlaybackInteracting) animation.pause(); else animation.play(); });
    const controls = root.querySelector("[data-process-playback-controls]");
    const controlsSignature = `${state.liveActivities.length > 1}:${state.livePlaybackPaused}`;
    if (controls && controls.dataset.signature !== controlsSignature) {
      controls.dataset.signature = controlsSignature;
      controls.innerHTML = livePlaybackControls();
    }
  }

  function renderProcess(message, { streaming = false } = {}) {
    const meta = message.metadata || {};
    const runs = streaming ? state.liveToolRuns : (Array.isArray(message.tool_runs) ? message.tool_runs : []);
    const storedReasoning = String(message.reasoning || "").trim();
    const hadReasoning = Boolean(meta.reasoning?.had_reasoning);
    const storeReasoning = Boolean(meta.reasoning?.stored);
    const thinkingText = streaming ? state.liveThinking : storedReasoning;
    const hasThinking = Boolean(thinkingText) || hadReasoning || (streaming && Boolean(state.liveThinking));
    const hasContent = streaming ? Boolean(state.liveText) : Boolean(message.content);
    const pending = runs.filter((run) => run.status === "pending").length;
    const errors = runs.filter((run) => ["error", "rejected"].includes(run.status)).length;
    const liveError = streaming && state.liveError;
    const failed = Boolean(liveError) || meta.status === "error" || errors > 0;
    const busy = streaming && !state.liveCompleted && !liveError;
    const stepCount = Math.max(1, runs.length + (hasThinking ? 1 : 0) + (hasContent || !busy ? 1 : 0));
    let stateClass = "done";
    let label = `已完成 · ${stepCount} 个步骤`;
    if (pending) {
      stateClass = "pending";
      label = `等待你确认 · ${pending} 个操作`;
    } else if (failed) {
      stateClass = "error";
      label = liveError ? "执行中断" : `执行结束 · ${errors || 1} 个步骤未完成`;
    } else if (busy) {
      stateClass = "running";
      label = currentLiveActivity().title;
    }
    let seconds = meta.run?.elapsed_seconds;
    if (streaming) {
      seconds = state.liveElapsed ?? (state.liveStartedAt ? (Date.now() - state.liveStartedAt) / 1000 : 0);
    }
    const secondsLabel = busy || seconds ? formatSeconds(seconds) : "";
    const usage = meta.usage || {};
    const usageLabel = usage.total_tokens
      ? `${formatTokens(usage.prompt_tokens)} in · ${formatTokens(usage.completion_tokens)} out · ${formatCost(usage.cost_usd)}${usage.latency_ms ? ` · ${usage.latency_ms}ms` : ""}`
      : "";
    const stateIcon = busy
      ? '<span class="process-spinner"></span>'
      : failed || pending
        ? `<span class="process-alert">${pending ? "!" : "×"}</span>`
        : `<span class="process-check">${icon("check", 11)}</span>`;
    const toolSteps = runs.map((run, index) => renderProcessToolStep(run, index)).join("");
    const thinkingSummary = streaming
      ? (state.liveThinking ? "正在推理…" : "等待思考…")
      : (storedReasoning
        ? (storeReasoning ? "思考已保存 · 点开查看" : "思考已完成 · 仅本次页面可见")
        : (hadReasoning && !storeReasoning
          ? "思考原文未保存（管理员可在运行设置开启）"
          : "思考原文已保存"));
    const thinkingFallback = hadReasoning && !storeReasoning
      ? "思考原文未保存（管理员可在运行设置开启）"
      : "模型思考内容未保存。";
    const thinkingStep = hasThinking ? `
      <details class="process-step think-step">
        <summary>
          <span class="process-step-icon think">${icon("brain", 12)}</span>
          <span class="process-step-name">分析问题</span>
          <span class="process-step-summary">${thinkingSummary}</span>
          <span class="process-step-status">${busy && !runs.length ? "进行中" : "完成"}</span>
          <span class="process-step-chevron">›</span>
        </summary>
        <div class="process-raw"><pre class="thinking-text">${escapeHtml(thinkingText || thinkingFallback)}</pre></div>
      </details>` : "";
    const answerStep = hasContent ? `
      <div class="process-step static-step">
        <span class="process-step-icon answer">${icon("spark", 12)}</span>
        <span class="process-step-name">生成回答</span>
        <span class="process-step-summary">${busy ? "生成中…" : "已输出"}</span>
        <span class="process-step-status">${busy ? "进行中" : "完成"}</span>
      </div>` : "";
    const empty = !thinkingStep && !toolSteps && !answerStep
      ? '<div class="process-empty">本次没有调用工具，模型直接给出了回答。</div>'
      : "";
    const activity = busy ? currentLiveActivity() : null;
    return `
      <details class="process-line ${stateClass}">
        <summary>
          <span class="process-state-icon">${stateIcon}</span>
          <span class="process-ticker"><span class="process-label" data-process-label>${escapeHtml(label)}</span>${busy ? `<span class="process-preview"><span data-process-preview>${escapeHtml(activity?.preview || "")}</span></span>` : ""}</span>
          ${secondsLabel ? `<span class="process-time" data-process-time>${escapeHtml(secondsLabel)}</span>` : ""}
          ${!busy && usageLabel ? `<span class="process-usage">${escapeHtml(usageLabel)}</span>` : ""}
          <span class="process-chevron">›</span>
          ${busy ? `<span data-process-playback-controls>${livePlaybackControls()}</span>` : ""}
        </summary>
        <div class="process-body">
          ${thinkingStep}${toolSteps}${answerStep}${empty}
          ${liveError ? `<div class="process-error">${escapeHtml(liveError)}</div>` : ""}
        </div>
      </details>`;
  }

  function renderProcessToolStep(run, index = 0) {
    const risk = run.risk || "write";
    const iconName = risk === "read" ? "eye" : risk === "delete" ? "trash" : "edit";
    const status = run.status || "ok";
    const resultText = run.result !== null && run.result !== undefined
      ? prettyJson(run.result, run.result_text || "")
      : (run.result_text || "");
    const callId = run.call_id || `${run.tool || "tool"}_${index}`;
    const resultView = status === "pending" ? "等待你批准后执行" : (resultText || "无返回内容");
    return `
      <details class="process-step tool-step ${escapeHtml(status)}" data-call-id="${escapeHtml(callId)}">
        <summary>
          <span class="process-step-icon ${escapeHtml(risk)}">${icon(iconName, 12)}</span>
          <span class="process-step-name">${escapeHtml(run.tool || "tool")}</span>
          <span class="process-step-summary">${escapeHtml(run.summary || "")}</span>
          <span class="process-step-status ${escapeHtml(status)}">${escapeHtml(runStatusLabel(status))}</span>
          <span class="process-step-chevron">›</span>
        </summary>
        <div class="process-raw">
          <div class="raw-caption">调用参数</div>
          <pre>${escapeHtml(prettyJson(run.arguments || {}))}</pre>
          <div class="raw-caption">原始结果</div>
          <pre>${escapeHtml(resultView)}</pre>
        </div>
      </details>`;
  }

  function renderApproval(approval) {
    const loading = state.approvalLoading.has(approval.id);
    const risk = approval.risk || "write";
    return `
      <div class="approval-card" data-approval-card="${escapeHtml(approval.id)}">
        <div class="approval-top">
          <span class="approval-icon">!</span>
          <div><strong>需要你的确认</strong><small>${escapeHtml(approval.risk_label || RISK_LABELS[risk] || risk)}操作 · 10 分钟内有效</small></div>
          <span class="approval-state">${loading ? "执行中…" : "待审批"}</span>
        </div>
        <p>${escapeHtml(approval.summary || "Agent 请求执行一个敏感操作。")}</p>
        <div class="approval-args">${escapeHtml(prettyJson(approval.arguments || {}))}</div>
        <div class="approval-actions">
          <button class="ghost-btn" data-action="approval-reject" data-id="${escapeHtml(approval.id)}" ${loading ? "disabled" : ""}>取消</button>
          <button class="danger-btn" data-action="approval-approve" data-id="${escapeHtml(approval.id)}" ${loading ? "disabled" : ""}>${loading ? "执行中…" : "批准执行"}</button>
        </div>
      </div>`;
  }

  /* ---------- HTML artifact preview ---------- */
  function sandboxDocument(html) {
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob: https:; style-src 'unsafe-inline' https:; font-src data: https:; script-src 'unsafe-inline' https:; connect-src 'none'; form-action 'none'; base-uri 'none'">`;
    const source = String(html || "");
    if (/<head[^>]*>/i.test(source)) {
      return source.replace(/<head([^>]*)>/i, `<head$1>${csp}`);
    }
    if (/<html[^>]*>/i.test(source)) {
      return source.replace(/<html([^>]*)>/i, `<html$1><head>${csp}</head>`);
    }
    return `<!doctype html><html><head>${csp}<meta charset="utf-8"></head><body>${source}</body></html>`;
  }

  function openArtifactModal(id) {
    const artifact = htmlArtifacts.get(id);
    if (!artifact) {
      toast("HTML 产物已失效，请重新生成", "warn");
      return;
    }
    activeArtifact = artifact;
    artifactPublishStatus = null;
    const modal = $("#artifact-modal");
    $("#artifact-title").textContent = artifact.title;
    const size = new Blob([artifact.html]).size;
    $("#artifact-meta").textContent = `隔离沙箱 · ${Math.max(1, Math.round(size / 1024))} KB · 不可访问系统登录态`;
    $("#artifact-hint").textContent = "模型生成的 HTML 在独立沙箱中运行，无法读取业务系统登录态。";
    $("#artifact-frame").srcdoc = sandboxDocument(artifact.html);
    $("#artifact-publish-panel").classList.add("hidden");
    $("#artifact-publish-result").classList.add("hidden");
    $("#artifact-publish-result").innerHTML = "";
    $("#artifact-publish-status").className = "publish-status";
    $("#artifact-publish-status").textContent = "正在检查 PagePilot 连接器…";
    $("#artifact-publish-submit").disabled = true;
    $("#artifact-publish-form").title.value = artifact.title;
    $("#artifact-publish-form").description.value = "";
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("artifact-open");
    loadArtifactPublishStatus();
  }

  function closeArtifactModal() {
    const modal = $("#artifact-modal");
    if (!modal || modal.classList.contains("hidden")) return;
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("artifact-open");
    $("#artifact-frame").srcdoc = "";
    $("#artifact-publish-panel").classList.add("hidden");
    activeArtifact = null;
  }

  async function loadArtifactPublishStatus() {
    const button = $("#artifact-publish-btn");
    const status = $("#artifact-publish-status");
    try {
      const data = await api("/api/agent/pagepilot/status");
      artifactPublishStatus = data;
      button.disabled = !data.publish_allowed;
      $("#artifact-publish-submit").disabled = !data.publish_allowed;
      button.title = data.publish_allowed
        ? "通过业务后端发布当前 HTML 到 PagePilot"
        : "管理员尚未启用 PagePilot 发布连接器";
      if (!data.publish_allowed) {
        status.className = "publish-status warn";
        status.textContent = data.configured
          ? "PagePilot 已配置但连接器未启用，请联系管理员在「AI 配置 → 工具」中开启。"
          : "PagePilot 尚未配置。管理员可在「AI 配置 → 工具 → PagePilot 连接器」中接入。";
        $("#artifact-hint").textContent = "PagePilot 尚未接入。你仍可保存图片；管理员配置后即可一键发布。";
      } else {
        status.className = "publish-status ok";
        status.textContent = `已连接 ${data.base_url} · Token ${data.token_masked}`;
        $("#artifact-hint").textContent = "模型生成的 HTML 在独立沙箱中运行，无法读取业务系统登录态。";
      }
    } catch (error) {
      artifactPublishStatus = { publish_allowed: false };
      button.disabled = true;
      status.className = "publish-status fail";
      status.textContent = `无法读取 PagePilot 状态：${error.message}`;
    }
  }

  async function openArtifactPublishPanel() {
    if (!activeArtifact) return;
    const artifact = activeArtifact;
    if (!artifactPublishStatus) await loadArtifactPublishStatus();
    if (activeArtifact !== artifact) return;
    $("#artifact-publish-panel").classList.remove("hidden");
    $("#artifact-publish-result").classList.add("hidden");
    $("#artifact-publish-result").innerHTML = "";
    const form = $("#artifact-publish-form");
    form.publication_id.innerHTML = '<option value="">新建页面</option>';
    form.title.value = artifact.title;
    form.description.value = artifact.publication?.description || artifactPublishStatus?.default_description || "";
    form.access_password.value = "";
    form.visibility.value = artifact.publication?.visibility || artifactPublishStatus?.default_visibility || "unlisted";
    form.publication_id.disabled = true;
    $("#artifact-publish-submit").disabled = true;
    try {
      const data = await api("/api/agent/pagepilot/publications?limit=100");
      if (activeArtifact !== artifact) return;
      const items = [...(data.items || [])];
      if (artifact.publication && !items.some((item) => item.id === artifact.publication.id)) items.unshift(artifact.publication);
      form.publication_id.innerHTML = '<option value="">新建页面</option>' + items.filter((item) => item.code).map((item) => `<option value="${item.id}">${escapeHtml(item.title)} · v${item.version || 1}</option>`).join("");
      form.publication_id.value = artifact.publication?.id || "";
    } catch (error) {
      if (artifact.publication) {
        $("#artifact-publish-status").className = "publish-status fail";
        $("#artifact-publish-status").textContent = `无法读取更新目标：${error.message}。请关闭后重试。`;
        return;
      }
      toast(`暂时无法读取更新目标，仍可新建：${error.message}`, "warn");
    }
    form.publication_id.disabled = false;
    $("#artifact-publish-submit").disabled = !artifactPublishStatus?.publish_allowed;
    window.setTimeout(() => form.title.focus(), 40);
  }

  async function publishArtifact() {
    if (!activeArtifact) return;
    const artifact = activeArtifact;
    const form = $("#artifact-publish-form");
    const submit = $("#artifact-publish-submit");
    const result = $("#artifact-publish-result");
    const status = $("#artifact-publish-status");
    submit.disabled = true;
    const original = submit.textContent;
    submit.textContent = "发布中…";
    status.className = "publish-status";
    status.textContent = "正在上传到 PagePilot，请稍候…";
    try {
      const data = await api("/api/agent/pagepilot/publish", {
        method: "POST",
        body: {
          html: artifact.html,
          title: form.title.value.trim() || artifact.title,
          description: form.description.value.trim(),
          publication_id: form.publication_id.value ? Number(form.publication_id.value) : null,
          session_id: form.publication_id.value ? null : state.activeSessionId,
          access_password: form.access_password.value,
          visibility: form.visibility.value,
        },
      });
      artifact.publication = { ...data, id: data.publication_id };
      if (activeArtifact !== artifact) return;
      const complete = data.ok !== false && data.status !== "partial";
      status.className = `publish-status ${complete ? "ok" : "warn"}`;
      status.textContent = complete
        ? `${data.updated ? "更新" : "发布"}成功 · 版本 ${data.version ?? 1} · ${Math.max(1, Math.round(Number(data.size || 0) / 1024))} KB${data.password_set ? " · 已设置访问密码" : " · 无密码（持链接可访问）"}`
        : (data.warning || "内容已发布，部分设置未生效，请核对后更新，不要重复新建。");
      const published = { ...data, id: data.publication_id };
      artifact.publication = published;
      if (data.publication_id) {
        if (!Array.from(form.publication_id.options).some((option) => option.value === String(data.publication_id))) {
          form.publication_id.add(new Option(data.title || activeArtifact.title, String(data.publication_id)));
        }
        form.publication_id.value = String(data.publication_id);
      }
      form.access_password.value = "";
      const url = safeWebUrl(data.url || data.detail_url);
      result.classList.remove("hidden");
      result.innerHTML = `
        <span>页面地址</span>
        ${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a><button type="button" class="text-btn" data-action="artifact-copy-url" data-url="${escapeHtml(url)}">复制链接</button>` : '<span>未返回链接，请核对远端发布结果</span>'}
        <button type="button" class="text-btn" data-action="publications-open">查看我的发布记录</button>`;
    } catch (error) {
      if (activeArtifact !== artifact) return;
      status.className = "publish-status fail";
      status.textContent = `发布失败：${error.message}`;
    } finally {
      if (activeArtifact === artifact) {
        submit.textContent = original;
        submit.disabled = !artifactPublishStatus?.publish_allowed;
      }
    }
  }

  function safeWebUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
    } catch {
      return "";
    }
  }

  function publicationStatus(item) {
    if (item.status === "failed" && item.publish_count > 0) return "操作中断或失败 · 链接保留";
    return ({ publishing: "发布中", published: "已发布", partial: "部分完成", failed: "发布失败" })[item.status] || item.status;
  }

  function publicationMeta(item) {
    return `<span class="publication-state ${escapeHtml(item.status)}">${escapeHtml(publicationStatus(item))}</span><span>${item.visibility === "public" ? "创作广场可见" : "仅链接可见"}</span><span>${item.password_set ? "密码保护" : "无密码"}</span><span>${Math.max(1, Math.round(Number(item.size || 0) / 1024))} KB</span>`;
  }

  function openPublishedPages() {
    closeArtifactModal();
    publicationsView = { q: "", sessionOnly: false, offset: 0, total: 0, items: [], detail: null, version: null, view: "preview", request: 0 };
    openModal(`
      <header class="modal-head">
        <div><h3 id="publications-heading">我的已发布</h3><p>按当前业务账号归属保存，不读取共享 PagePilot 下其他用户的页面。</p></div>
        <button type="button" class="icon-btn" data-action="modal-close" aria-label="关闭已发布">${icon("x")}</button>
      </header>
      <div class="modal-body publication-body">
        <form id="publications-search" class="publication-toolbar">
          <label class="publication-search">${icon("search")}<input name="q" type="search" maxlength="200" aria-label="搜索页面标题或说明" placeholder="搜索标题、发布说明…"></label>
          <label class="publication-session-filter"><input name="session_only" type="checkbox" ${state.activeSessionId ? "" : "disabled"}> 仅当前会话</label>
          <button type="submit" class="ghost-btn">查询</button>
        </form>
        <div id="publications-content" aria-live="polite"></div>
      </div>
      <footer class="publication-footer"><span id="publications-count">正在读取本地记录…</span><div><button class="ghost-btn" type="button" data-action="publications-prev" disabled>上一页</button><button class="ghost-btn" type="button" data-action="publications-next" disabled>下一页</button></div></footer>`, { wide: true });
    $("#modal-root .modal").classList.add("publications-dialog");
    $("#modal-root .modal").setAttribute("aria-labelledby", "publications-heading");
    $("#publications-search").addEventListener("submit", (event) => {
      event.preventDefault();
      publicationsView.q = event.currentTarget.q.value.trim();
      publicationsView.sessionOnly = event.currentTarget.session_only.checked;
      publicationsView.offset = 0;
      loadPublicationsPage();
    });
    $("#publications-search").session_only.addEventListener("change", () => $("#publications-search").requestSubmit());
    loadPublicationsPage();
  }

  async function loadPublicationsPage() {
    const view = publicationsView;
    const root = $("#publications-content");
    if (!view || !root) return;
    const request = ++view.request;
    root.innerHTML = '<div class="publication-empty" role="status">正在读取你的发布记录…</div>';
    $("#publications-search").classList.remove("hidden");
    $(".publication-footer > div").classList.remove("hidden");
    const params = new URLSearchParams({ q: view.q, limit: "12", offset: String(view.offset) });
    if (view.sessionOnly && state.activeSessionId) params.set("session_id", state.activeSessionId);
    try {
      const data = await api(`/api/agent/pagepilot/publications?${params}`);
      if (view !== publicationsView || request !== view.request || !root.isConnected) return;
      view.items = data.items || [];
      view.total = data.total || 0;
      view.detail = null;
      root.innerHTML = view.items.length ? `<div class="publication-list">${view.items.map((item) => {
        const url = safeWebUrl(item.url || item.detail_url);
        return `<article class="publication-card">
          <div class="publication-card-main"><button type="button" class="publication-title" data-action="publication-detail" data-id="${item.id}">${icon("book", 17)}<strong>${escapeHtml(item.title)}</strong></button><p>${escapeHtml(item.description || "未填写发布说明")}</p><div class="publication-meta">${publicationMeta(item)}<span>${escapeHtml(formatTime(item.updated_at))}</span></div>${item.last_error ? `<div class="publication-warning">${escapeHtml(item.last_error)}</div>` : ""}${url ? `<a class="publication-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>` : ""}</div>
          <div class="publication-card-actions"><button type="button" class="ghost-btn" data-action="publication-detail" data-id="${item.id}">查看 / 版本</button>${url ? `<button type="button" class="text-btn" data-action="artifact-copy-url" data-url="${escapeHtml(url)}">复制链接</button>` : ""}</div>
        </article>`;
      }).join("")}</div>` : '<div class="publication-empty">还没有符合条件的发布记录。<small>从聊天中的 HTML 预览发布后，内容和链接会自动保存到这里。历史远端页面不会被自动导入。</small></div>';
      $("#publications-count").textContent = `共 ${view.total} 个页面 · ${state.user?.display_name || state.user?.username || "当前账号"}`;
      $("[data-action='publications-prev']").disabled = view.offset <= 0;
      $("[data-action='publications-next']").disabled = view.offset + 12 >= view.total;
    } catch (error) {
      if (view !== publicationsView || !root.isConnected) return;
      root.innerHTML = `<div class="publication-empty"><p class="publication-warning">${escapeHtml(error.message)}</p><button type="button" class="ghost-btn" data-action="publications-reload">重新读取</button></div>`;
      $("#publications-count").textContent = "读取失败，不影响已发布的远端页面";
    }
  }

  async function openPublicationDetail(id) {
    const view = publicationsView;
    const root = $("#publications-content");
    if (!view || !root) return;
    const request = ++view.request;
    root.innerHTML = '<div class="publication-empty" role="status">正在读取已保存的内容和版本…</div>';
    try {
      const data = await api(`/api/agent/pagepilot/publications/${Number(id)}`);
      if (view !== publicationsView || request !== view.request || !root.isConnected) return;
      view.detail = data.publication;
      view.version = null;
      view.view = "preview";
      renderPublicationDetail();
    } catch (error) {
      if (view !== publicationsView || request !== view.request || !root.isConnected) return;
      root.innerHTML = `<div class="publication-empty"><p class="publication-warning">${escapeHtml(error.message)}</p><button type="button" class="ghost-btn" data-action="publications-reload">返回列表</button></div>`;
    }
  }

  function renderPublicationDetail() {
    const view = publicationsView;
    const item = view?.detail;
    const root = $("#publications-content");
    if (!item || !root) return;
    const shown = view.version || item;
    const url = safeWebUrl(item.url || item.detail_url);
    $("#publications-search").classList.add("hidden");
    $(".publication-footer > div").classList.add("hidden");
    $("[data-action='publications-prev']").disabled = true;
    $("[data-action='publications-next']").disabled = true;
    $("#publications-count").textContent = `已保存 ${item.versions?.length || 0} 次发布记录 · 内容不随会话清理删除`;
    root.innerHTML = `<div class="publication-detail">
      <div class="publication-detail-top"><button class="text-btn" type="button" data-action="publications-reload">‹ 返回列表</button><span>${escapeHtml(item.code || "尚未成功发布")}</span></div>
      <h3>${escapeHtml(shown.title || item.title)}</h3><p class="publication-description">${escapeHtml(shown.description || "未填写发布说明")}</p>
      <div class="publication-meta">${publicationMeta(shown)}<span>${escapeHtml(formatTime(shown.created_at || item.updated_at))}</span></div>
      ${(shown.error || item.last_error) ? `<div class="publication-warning">${escapeHtml(shown.error || item.last_error)}</div>` : ""}
      ${url ? `<a class="publication-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>` : ""}
      <div class="publication-detail-controls"><div class="publication-tabs"><button class="ghost-btn ${view.view === "preview" ? "active" : ""}" type="button" data-action="publication-preview">预览</button><button class="ghost-btn ${view.view === "code" ? "active" : ""}" type="button" data-action="publication-code">代码</button></div>
        <label class="publication-version-label">版本<select id="publication-version" aria-label="选择已保存版本"><option value="">当前内容</option>${(item.versions || []).map((version) => `<option value="${version.id}" ${view.version?.id === version.id ? "selected" : ""}>${version.version ? `v${version.version}` : "尝试记录"} · ${escapeHtml(publicationStatus(version))} · ${escapeHtml(formatTime(version.created_at))}</option>`).join("")}</select></label>
      </div>
      <div id="publication-preview-content" class="publication-preview-content">${view.view === "code" ? `<pre class="publication-code"><code>${escapeHtml(shown.html || "")}</code></pre>` : '<iframe class="publication-preview" sandbox="allow-scripts" referrerpolicy="no-referrer" title="已保存页面的隔离预览"></iframe>'}</div>
      <div class="publication-detail-actions"><button class="ghost-btn" type="button" data-action="publication-download">下载 HTML</button>${item.session_id ? '<button class="ghost-btn" type="button" data-action="publication-session">来源会话</button>' : ""}${item.code ? '<button class="primary-btn" type="button" data-action="publication-update">更新此页面</button>' : '<button class="primary-btn" type="button" data-action="publication-update">重新发布为新页面</button>'}</div>
      <p class="publication-isolation-note">内容来自本系统的本地快照；外部预览与更新使用共享服务，但记录与操作归属始终绑定你的业务账号。</p>
    </div>`;
    const frame = $(".publication-preview", root);
    if (frame) frame.srcdoc = sandboxDocument(shown.html || "");
    $("#publication-version").addEventListener("change", async (event) => {
      const versionId = Number(event.target.value);
      if (!versionId) { view.version = null; renderPublicationDetail(); return; }
      event.target.disabled = true;
      try {
        const data = await api(`/api/agent/pagepilot/publications/${item.id}/versions/${versionId}`);
        if (publicationsView !== view || view.detail !== item) return;
        view.version = data.version;
        renderPublicationDetail();
      } catch (error) {
        event.target.disabled = false;
        event.target.value = view.version?.id || "";
        toast(`读取版本失败：${error.message}`, "error");
      }
    });
  }

  function downloadPublication() {
    const item = publicationsView?.version || publicationsView?.detail;
    if (!item?.html) return;
    const url = URL.createObjectURL(new Blob([item.html], { type: "text/html;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${String(item.title || "page").replace(/[\\/:*?"<>|]/g, "-")}.html`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function updatePublicationFromLibrary() {
    const item = publicationsView?.detail;
    const shown = publicationsView?.version || item;
    if (!item || !shown?.html) return;
    const id = `publication-${item.id}-${shown.id}`;
    htmlArtifacts.set(id, { html: shown.html, title: shown.title || item.title, publication: item.code ? item : null });
    closeModal();
    openArtifactModal(id);
    await openArtifactPublishPanel();
  }

  async function saveArtifactImage(target) {
    if (!activeArtifact || target.disabled) return;
    const original = target.textContent;
    target.disabled = true;
    target.textContent = "正在截图…";
    try {
      const response = await fetch("/api/agent/artifacts/screenshot", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html: activeArtifact.html }),
      });
      if (!response.ok) {
        let detail = `截图失败（${response.status}）`;
        try {
          const data = await response.json();
          detail = data.detail || detail;
        } catch {
          // keep the status-based message
        }
        throw new Error(detail);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const stamp = new Intl.DateTimeFormat("sv-SE").format(new Date());
      link.href = objectUrl;
      link.download = `${activeArtifact.title.replace(/[\\/:*?"<>|]/g, "-")}-${stamp}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1200);
      toast("PNG 已生成并开始下载");
    } catch (error) {
      toast(`截图失败：${error.message}`, "error", 5000);
    } finally {
      target.disabled = false;
      target.textContent = original;
    }
  }

  function scheduleLiveRender() {
    if (state.liveUpdateTimer) return;
    state.liveUpdateTimer = window.setTimeout(() => {
      state.liveUpdateTimer = null;
      applyLiveUI();
    }, 45);
  }

  function startProcessTicker() {
    if (state.processTimer) window.clearInterval(state.processTimer);
    state.processTimer = window.setInterval(() => {
      if (!state.sending || state.liveCompleted) return;
      applyLiveUI();
    }, 200);
  }

  function stopProcessTicker() {
    if (state.processTimer) window.clearInterval(state.processTimer);
    state.processTimer = null;
  }

  function applyLiveUI() {
    const message = state.streamingMessage;
    const el = state.streamEl || (message
      ? $(`[data-message-id="${CSS.escape(String(message.id))}"]`)
      : null);
    if (!message || !el) return;
    const stick = isNearBottom();

    const markdownNode = el.querySelector("[data-stream-markdown]");
    if (markdownNode && state.liveText !== state.liveRenderedText) {
      state.liveRenderedText = state.liveText;
      const html = renderMarkdown(state.liveText, { streaming: true });
      if (html !== state.liveRenderedHtml) {
        state.liveRenderedHtml = html;
        markdownNode.innerHTML = html;
        hydrateMermaid(markdownNode);
      }
    }

    const processRoot = el.querySelector("[data-live-process]");
    if (processRoot) {
      const signature = JSON.stringify(
        [
          state.liveToolRuns.map((run) => [run.call_id, run.tool, run.status, run.summary]),
          Boolean(state.liveThinking),
          Boolean(state.liveText),
          Boolean(state.liveCompleted),
          state.liveError,
        ]
      );
      if (signature !== state.liveToolsSignature) {
        state.liveToolsSignature = signature;
        const oldLine = processRoot.querySelector(".process-line");
        const wasOpen = Boolean(oldLine?.open);
        const thinkingOpen = Boolean(processRoot.querySelector(".think-step")?.open);
        const openTools = new Set(
          [...processRoot.querySelectorAll(".tool-step[open]")].map((node) => node.dataset.callId)
        );
        processRoot.innerHTML = renderProcess(message, { streaming: true });
        const newLine = processRoot.querySelector(".process-line");
        if (newLine) newLine.open = !state.liveCompleted && !state.liveError && wasOpen;
        const thinkingStep = processRoot.querySelector(".think-step");
        if (thinkingStep) thinkingStep.open = thinkingOpen;
        [...processRoot.querySelectorAll(".tool-step")].forEach((node) => {
          if (openTools.has(node.dataset.callId)) node.open = true;
        });
      }
      const thinkingNode = processRoot.querySelector(".thinking-text");
      if (thinkingNode && thinkingNode.textContent !== state.liveThinking) thinkingNode.textContent = state.liveThinking || "模型思考内容未保存。";
      updateLiveProcessHeader();
      const timeNode = processRoot.querySelector("[data-process-time]");
      const seconds = state.liveElapsed ?? (state.liveStartedAt ? (Date.now() - state.liveStartedAt) / 1000 : 0);
      const timeLabel = formatSeconds(seconds);
      if (timeNode && timeLabel && !state.liveCompleted) timeNode.textContent = timeLabel;
    }

    const approvalRoot = el.querySelector("[data-live-approval]");
    const approval = message.metadata?.approval && !message.metadata?.approval_status
      ? message.metadata.approval
      : null;
    if (approvalRoot) {
      const signature = approval ? JSON.stringify(approval) : "";
      if (signature !== state.liveApprovalSignature) {
        state.liveApprovalSignature = signature;
        approvalRoot.innerHTML = approval ? renderApproval(approval) : "";
      }
    }

    if (stick) requestAnimationFrame(scrollToBottom);
  }

  function appendLiveThinking(delta) {
    state.liveThinking += delta;
    if (state.streamingMessage) {
      state.streamingMessage.metadata = {
        ...(state.streamingMessage.metadata || {}),
        reasoning: { had_reasoning: true },
      };
    }
    scheduleLiveRender();
  }

  function applyLiveEvent(eventName, data, eventId) {
    if (eventId) state.lastEventId = Number(eventId);
    const message = state.streamingMessage;
    if (eventName === "run.phase") {
      addLiveActivity(data.title || "正在准备运行环境", data.message || "");
      scheduleLiveRender();
      return;
    }
    if (eventName === "step.started") {
      addLiveActivity("模型请求已发送", "等待上游返回新内容");
      scheduleLiveRender();
      return;
    }
    if (eventName === "run.started") {
      if (data.approval_mode) {
        state.approvalMode = data.approval_mode === "full_access" ? "full_access" : "confirm";
        renderApprovalMode();
      }
      return;
    }
    if (eventName === "text.delta") {
      appendLiveOutput("回答内容", data.delta || "", "answer");
      state.liveText += data.delta || "";
      if (message) message.content = state.liveText;
      scheduleLiveRender();
      return;
    }
    if (eventName === "thinking.delta") {
      appendLiveOutput("模型思考", data.delta || "", "think");
      appendLiveThinking(data.delta || "");
      return;
    }
    if (eventName === "tool.args.delta") {
      const key = data.call_id || data.tool || "tool";
      if (!state.livePreparingTools.has(key)) {
        state.livePreparingTools.add(key);
        addLiveActivity(`准备调用 ${data.tool || "工具"}`, "模型正在生成调用参数", "tool");
        scheduleLiveRender();
      }
      return;
    }
    if (eventName === "tool.started") {
      addLiveActivity(`正在调用 ${data.tool || "工具"}`, "工具执行中", "tool");
      if (data.arguments !== undefined) appendLiveOutput(`${data.tool || "工具"} · 参数`, typeof data.arguments === "string" ? data.arguments : JSON.stringify(data.arguments), "tool");
      state.liveToolRuns.push({
        call_id: data.call_id,
        tool: data.tool,
        arguments: data.arguments || {},
        risk: data.risk || "write",
        status: "running",
        summary: "执行中…",
      });
      if (message) message.tool_runs = state.liveToolRuns;
      scheduleLiveRender();
      return;
    }
    if (eventName === "tool.finished") {
      addLiveActivity(`工具已返回 · ${data.tool || "工具"}`, data.summary || "", "tool");
      if (data.result !== undefined) appendLiveOutput(`${data.tool || "工具"} · 结果`, typeof data.result === "string" ? data.result : JSON.stringify(data.result), "tool");
      const run = data.call_id
        ? state.liveToolRuns.find((item) => item.call_id === data.call_id)
        : [...state.liveToolRuns].reverse().find((item) => item.tool === data.tool && item.status === "running");
      if (run) Object.assign(run, data);
      if (message) message.tool_runs = state.liveToolRuns;
      scheduleLiveRender();
      return;
    }
    if (eventName === "tool.approval_required") {
      addLiveActivity("等待操作确认", data.summary || data.tool || "", "approval");
      state.liveToolRuns.push({
        tool: data.tool,
        arguments: data.arguments || {},
        risk: data.risk || "write",
        status: "pending",
        summary: data.summary || "等待审批",
      });
      if (message) {
        message.tool_runs = state.liveToolRuns;
        message.metadata = { ...(message.metadata || {}), approval: data };
      }
      scheduleLiveRender();
      return;
    }
    if (eventName === "usage") {
      state.usage = data.usage || state.usage;
      if (message) message.metadata = { ...(message.metadata || {}), usage: state.usage };
      renderContextRail();
      return;
    }
    if (eventName === "context") {
      state.contextInfo = data;
      renderContextRail();
      return;
    }
    if (eventName === "retry") {
      addLiveActivity("请求重试", `${((data.delay_ms || 0) / 1000).toFixed(1)} 秒后重试`);
      scheduleLiveRender();
      state.lastRun = { ...(state.lastRun || {}), retry_count: (state.lastRun?.retry_count || 0) + 1 };
      toast(`模型调用暂时失败，${Math.round((data.delay_ms || 0) / 100) / 10}s 后自动重试`, "warn", 2400);
      return;
    }
    if (eventName === "model.fallback") {
      addLiveActivity("切换备用模型", data.to || "");
      scheduleLiveRender();
      toast(`主模型失败，已降级到 ${data.to || "备用模型"}`, "warn", 4200);
      return;
    }
    if (eventName === "session.title") {
      const session = state.sessions.find((item) => item.id === state.activeSessionId);
      if (session) session.title = data.title;
      $("#chat-heading").textContent = data.title || $("#chat-heading").textContent;
      renderConversationList();
      return;
    }
    if (eventName === "run.completed") {
      state.liveCompleted = data;
      state.liveElapsed = Number(data.run?.elapsed_seconds) || null;
      if (message && data.answer) message.content = data.answer;
      if (data.approval_mode) {
        state.approvalMode = data.approval_mode === "full_access" ? "full_access" : "confirm";
        renderApprovalMode();
      }
      scheduleLiveRender();
      return;
    }
    if (eventName === "run.failed") {
      state.liveError = data.message || "运行失败";
      scheduleLiveRender();
      throw new Error(data.message || "运行失败");
    }
  }

  async function consumeSSE(response, onEvent) {
    if (!response.body) throw new Error("浏览器不支持流式响应");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
      let index = buffer.indexOf("\n\n");
      while (index >= 0) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (block.trim()) {
          let id = 0;
          let eventName = "message";
          const dataLines = [];
          for (const line of block.split("\n")) {
            if (line.startsWith("id:")) id = Number(line.slice(3).trim()) || 0;
            else if (line.startsWith("event:")) eventName = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
          }
          let data = {};
          if (dataLines.length) {
            try { data = JSON.parse(dataLines.join("\n")); } catch { data = { raw: dataLines.join("\n") }; }
          }
          await onEvent(eventName, data, id);
        }
        index = buffer.indexOf("\n\n");
      }
    }
  }

  async function streamChat(body) {
    const response = await fetch("/api/agent/chat/stream", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      let detail = `请求失败（${response.status}）`;
      try {
        const data = await response.json();
        detail = data.detail || detail;
      } catch { /* ignore */ }
      throw new Error(detail);
    }
    const runId = response.headers.get("X-Run-Id");
    if (runId) state.activeRunId = runId;
    try {
      await consumeSSE(response, async (eventName, data, eventId) => {
        applyLiveEvent(eventName, data, eventId);
      });
    } catch (error) {
      if (!state.activeRunId) throw error;
    }
    if (state.liveError) throw new Error(state.liveError);
    let reconnectAttempts = 0;
    while (!state.liveCompleted && state.activeRunId && reconnectAttempts < 3) {
      reconnectAttempts += 1;
      await new Promise((resolve) => window.setTimeout(resolve, 500 * reconnectAttempts));
      const resumed = await fetch(`/api/agent/chat/stream/${encodeURIComponent(state.activeRunId)}`, {
        credentials: "same-origin",
        headers: { Accept: "text/event-stream", "Last-Event-ID": String(state.lastEventId || 0) },
      });
      if (resumed.status === 404) break;
      if (!resumed.ok) continue;
      try {
        await consumeSSE(resumed, async (eventName, data, eventId) => {
          applyLiveEvent(eventName, data, eventId);
        });
      } catch {
        if (state.liveError) throw new Error(state.liveError);
        continue;
      }
    }
    if (!state.liveCompleted) {
      throw new Error("连接中断，且未能恢复本次运行。请稍后在会话记录中查看结果。");
    }
    return state.liveCompleted;
  }

  async function sendMessage(prompt = null) {
    if (state.sending) return;
    const input = $("#chat-input");
    const text = String(prompt ?? input.value).trim();
    if (!text) return;
    if (!state.models.length) {
      toast("没有可用模型，请让管理员先在 AI 配置中启用模型", "warn");
      return;
    }
    if (!state.assistantId) {
      toast("没有可用助手，请让管理员在 AI 配置中创建助手", "warn");
      return;
    }
    if (!state.activeSessionId) {
      const session = await createSession(state.assistantId, true);
      if (!session) return;
    }
    const attachments = state.attachments.map((item) => ({
      name: item.name,
      mime_type: item.mime_type,
      data_url: item.data_url,
    }));
    if (attachments.length && !(selectedModel()?.capabilities || []).includes("image")) {
      toast("当前模型不支持图片，请切换支持图像理解的模型", "warn");
      return;
    }
    state.sending = true;
    state.activeRunId = null;
    state.lastEventId = 0;
    state.liveThinking = "";
    state.liveText = "";
    state.liveRenderedHtml = "";
    state.liveRenderedText = "";
    state.liveToolRuns = [];
    state.liveActivities = [];
    state.liveActivitySequence = 0;
    state.liveActivityId = null;
    state.liveActivityAt = Date.now();
    state.liveOutputActivity = null;
    state.liveOutputLength = 0;
    state.livePreparingTools = new Set();
    state.livePlaybackPaused = false;
    state.livePlaybackInteracting = false;
    state.liveToolsSignature = "";
    state.liveApprovalSignature = "";
    state.liveCompleted = null;
    state.liveStartedAt = Date.now();
    state.liveElapsed = null;
    state.liveError = "";
    if (prompt === null) {
      input.value = "";
      input.style.height = "auto";
    }
    state.messages.push({
      id: `local-${Date.now()}`,
      role: "user",
      content: text,
      attachments: state.attachments.map((item) => ({ name: item.name, mime_type: item.mime_type })),
      metadata: {},
      created_at: new Date().toISOString(),
    });
    state.streamingMessage = {
      id: `stream-${Date.now()}`,
      role: "assistant",
      content: "",
      tool_runs: [],
      metadata: { status: "streaming", assistant: currentAssistant(), model: selectedModel() },
      created_at: new Date().toISOString(),
    };
    state.messages.push(state.streamingMessage);
    renderChat({ forceScroll: true });
    startProcessTicker();
    updateSendState();
    try {
      const data = await streamChat({
        message: text,
        session_id: state.activeSessionId,
        assistant_id: state.assistantId,
        model_row_id: state.modelId,
        enabled_tools: [...state.selectedTools],
        reasoning_effort: state.reasoningEffort || null,
        approval_mode: state.approvalMode,
        attachments,
      });
      state.demoMode = Boolean(data.demo_mode);
      if (data.model?.id) state.modelId = Number(data.model.id);
      state.lastBudget = data.budget || null;
      state.lastRun = data.run || null;
      state.contextInfo = data.context || null;
      state.usage = data.usage || null;
      state.sessionUsage = data.session_usage || state.sessionUsage;
      loadMyUsage().then(renderContextRail);
      state.attachments = [];
      renderAttachments();
      state.streamingMessage = null;
      state.activeRunId = null;
      await loadMessages(state.activeSessionId, { liveReasoning: state.liveThinking });
      await loadSessions();
      renderConversationList();
      renderChat();
      renderContextRail();
      updateDemoBadge();
    } catch (error) {
      state.streamingMessage = null;
      state.messages.push({
        id: `local-error-${Date.now()}`,
        role: "assistant",
        content: `请求失败：${error.message}`,
        tool_runs: [],
        metadata: { status: "error" },
        created_at: new Date().toISOString(),
      });
      renderChat();
      toast(error.message, "error", 5000);
    } finally {
      state.sending = false;
      state.streamingMessage = null;
      stopProcessTicker();
      renderChat();
      updateSendState();
      window.setTimeout(() => input.focus(), 30);
    }
  }

  async function handleApproval(approvalId, approve) {
    state.approvalLoading.add(approvalId);
    renderChat();
    try {
      await api(`/api/agent/approvals/${encodeURIComponent(approvalId)}/${approve ? "approve" : "reject"}`, { method: "POST" });
      await loadMessages(state.activeSessionId);
      await loadSessions();
      renderConversationList();
      renderChat();
      toast(approve ? "操作已批准并执行" : "操作已取消", approve ? "ok" : "warn");
    } catch (error) {
      toast(error.message, "error", 5000);
    } finally {
      state.approvalLoading.delete(approvalId);
      renderChat();
    }
  }

  /* ---------- Attachments ---------- */
  function attachFiles(files) {
    const remaining = 4 - state.attachments.length - state.attachmentReads;
    if (remaining <= 0) {
      toast("最多添加 4 张图片", "warn");
      return;
    }
    for (const file of [...files].slice(0, remaining)) {
      if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) {
        toast(`${file.name} 不是支持的图片格式`, "warn");
        continue;
      }
      if (file.size > 3 * 1024 * 1024) {
        toast(`${file.name} 超过 3 MB`, "warn");
        continue;
      }
      const reader = new FileReader();
      const userId = state.user?.id;
      const sessionId = state.activeSessionId;
      state.attachmentReads += 1;
      reader.onloadend = () => { state.attachmentReads = Math.max(0, state.attachmentReads - 1); };
      reader.onerror = () => toast(`无法读取 ${file.name}`, "error");
      reader.onload = () => {
        if (state.user?.id !== userId || state.activeSessionId !== sessionId || state.sending) return;
        const existingSize = state.attachments.reduce((total, item) => total + (item.size || atob(item.data_url.split(",")[1] || "").length), 0);
        if (existingSize + file.size > 8 * 1024 * 1024) {
          toast("本轮图片总大小不能超过 8 MB", "warn");
          return;
        }
        state.attachments.push({
          name: file.name,
          size: file.size,
          mime_type: file.type,
          data_url: String(reader.result),
        });
        renderAttachments();
      };
      reader.readAsDataURL(file);
    }
  }

  function renderAttachments() {
    const root = $("#attach-bar");
    if (!root) return;
    root.classList.toggle("hidden", !state.attachments.length);
    root.innerHTML = state.attachments.map((item, index) => `
      <span class="attach-chip">
        <img src="${item.data_url}" alt="">
        <span>${escapeHtml(truncate(item.name, 24))}</span>
        <button type="button" data-action="attach-remove" data-index="${index}" title="移除">×</button>
      </span>`).join("");
  }

  function removeAttachment(index) {
    state.attachments.splice(index, 1);
    renderAttachments();
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || new Error("读取录音失败"));
      reader.readAsDataURL(blob);
    });
  }

  async function toggleVoice() {
    if (state.voiceBusy) return;
    if (!state.status?.asr?.configured) {
      toast("管理员还没有配置语音识别模型", "warn");
      return;
    }
    if (state.recording) {
      state.mediaRecorder?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      toast("当前浏览器不支持录音，请使用 HTTPS 或 localhost 打开", "warn");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"]
        .find((item) => MediaRecorder.isTypeSupported(item)) || "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      state.mediaRecorder = recorder;
      state.mediaChunks = [];
      state.recording = true;
      renderVoiceState();
      $("#voice-btn")?.classList.add("recording");
      const timeout = window.setTimeout(() => {
        if (state.recording) recorder.stop();
      }, 60_000);
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data?.size) state.mediaChunks.push(event.data);
      });
      recorder.addEventListener("stop", async () => {
        window.clearTimeout(timeout);
        stream.getTracks().forEach((track) => track.stop());
        state.recording = false;
        $("#voice-btn")?.classList.remove("recording");
        const blob = new Blob(state.mediaChunks, { type: recorder.mimeType || "audio/webm" });
        if (!blob.size) {
          renderVoiceState();
          return;
        }
        state.voiceBusy = true;
        renderVoiceState();
        try {
          const dataUrl = await blobToDataUrl(blob);
          const result = await api("/api/agent/transcribe", {
            method: "POST",
            body: { audio_data_url: dataUrl, language: "zh" },
          });
          const text = String(result.text || "").trim();
          if (!text) throw new Error("没有识别到语音内容");
          $("#chat-input").value = text;
          toast("语音识别完成，正在发送", "ok", 1600);
          await sendMessage(text);
        } catch (error) {
          toast(error.message, "error", 5000);
        } finally {
          state.voiceBusy = false;
          renderVoiceState();
        }
      });
      recorder.start();
    } catch (error) {
      state.recording = false;
      renderVoiceState();
      toast(`无法启动录音：${error.message}`, "error", 5000);
    }
  }

  /* ---------- Context rail ---------- */
  function renderContextRail() {
    const model = selectedModel();
    const assistant = currentAssistant();
    const modelNode = $("#context-model");
    if (modelNode) {
      modelNode.innerHTML = `<span class="model-dot"></span><span>${escapeHtml(model ? `${model.name} · ${model.model_id}` : "未配置模型")}</span>`;
    }
    const toolRoot = $("#context-tool-list");
    if (toolRoot) {
      const enabled = state.tools.filter((tool) => state.selectedTools.has(tool.name));
      toolRoot.innerHTML = enabled.length
        ? enabled.slice(0, 8).map((tool) => `<div class="mini-item on">${escapeHtml(tool.name)}</div>`).join("")
        : '<div class="mini-empty">本轮未选择工具</div>';
    }
    const toolTotal = $("#context-tool-total");
    if (toolTotal) {
      toolTotal.textContent = `${state.tools.filter((tool) => state.selectedTools.has(tool.name)).length}/${state.tools.length}`;
    }
    const skillRoot = $("#context-skill-list");
    if (skillRoot) {
      const wanted = assistant?.skill_ids || [];
      const skills = wanted.length ? state.skills.filter((skill) => wanted.includes(Number(skill.id))) : state.skills;
      skillRoot.innerHTML = skills.length
        ? skills.map((skill) => `<div class="mini-item on">${escapeHtml(skill.name)}</div>`).join("")
        : '<div class="mini-empty">暂无启用技能</div>';
    }
    const budget = state.lastBudget || {};
    const context = state.contextInfo || {};
    const run = state.lastRun || {};
    const usedTokens = Number(
      context.context_tokens || state.usage?.prompt_tokens || 0
    );
    const modelWindow = Number(model?.context_window) || 0;
    const reserve = Number(context.reserve_tokens ?? state.status?.context_reserve_tokens ?? 1600);
    const explicitBudget = Number(assistant?.context_max_tokens || state.status?.context_max_tokens || 0);
    const windowTokens = Number(modelWindow || context.context_window || 0);
    const cappedWindow = Math.max(2048, explicitBudget > 0 ? Math.min(windowTokens || explicitBudget, explicitBudget) : (windowTokens || 32768));
    const outputReserve = Math.min(Number(model?.max_output_tokens || 0), Math.floor(cappedWindow / 2));
    const budgetTokens = Math.max(1200, cappedWindow - outputReserve - reserve);
    const ratio = budgetTokens > 0 ? Math.min(1, usedTokens / budgetTokens) : 0;
    const meter = $("#composer-context-fill");
    if (meter) {
      meter.style.width = `${Math.round(ratio * 100)}%`;
      meter.parentElement.classList.toggle("warn", ratio >= 0.8 && ratio < 0.95);
      meter.parentElement.classList.toggle("danger", ratio >= 0.95);
    }
    const contextValue = $("#composer-context-value");
    if (contextValue) {
      const usage = state.usage || {};
      const parts = state.activeSessionId
        ? [`${formatTokens(usedTokens)} / ${formatTokens(budgetTokens)} · ${Math.round(ratio * 100)}%`]
        : ["尚未开始对话"];
      if (usage.retry_count) parts.push(`${usage.retry_count} 次重试`);
      contextValue.textContent = parts.join(" · ");
      contextValue.title = state.activeSessionId
        ? `模型窗口 ${formatTokens(windowTokens)} · 本轮输入 ${formatTokens(usage.prompt_tokens || 0)} · 输出 ${formatTokens(usage.completion_tokens || 0)}`
        : "发送第一条消息后显示上下文预算";
    }
    const budgetRoot = $("#context-budget");
    if (budgetRoot) {
      const cells = [
        ["推理轮次", `${run.steps_used || 0}/${(assistant?.max_steps || (state.status?.max_iterations ?? budget.max_steps ?? 6)) || "不限"}`],
        ["工具调用", `${run.tool_calls_used || 0}/${(assistant?.max_tool_calls || (state.status?.max_tool_calls ?? budget.max_tool_calls ?? 12)) || "不限"}`],
        ["运行超时", `${Math.round(run.elapsed_seconds || 0)}s/${assistant?.max_run_seconds || state.status?.max_run_seconds || budget.max_run_seconds || 120}s`],
      ];
      budgetRoot.innerHTML = cells.map(([label, value]) => `<div class="budget-cell"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
    }
    const sessionUsage = state.sessionUsage || {};
    const sessionRoot = $("#context-session-usage");
    if (sessionRoot) {
      const rows = [
        ["累计 tokens", formatTokens(sessionUsage.total_tokens || 0)],
        ["估算费用", formatCost(sessionUsage.total_cost_usd || 0)],
        ["消息数", String(sessionUsage.message_count || 0)],
        ["压缩次数", String(sessionUsage.compaction_count || 0)],
      ];
      sessionRoot.innerHTML = rows.map(([label, value]) => `<div class="usage-row"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
    }
    const compactionNode = $("#context-compaction");
    if (compactionNode) {
      const notes = [];
      if (context.compacted || context.compaction?.ok) {
        notes.push(`上次压缩节省 ${formatTokens(context.compaction?.saved_tokens || 0)} tokens`);
      }
      if (state.myUsage?.daily_limit) {
        notes.push(`今日 ${formatTokens(state.myUsage.used_today || 0)} / ${formatTokens(state.myUsage.daily_limit)}`);
      }
      compactionNode.textContent = notes.join(" · ") || "超出预算时会自动摘要较早对话";
    }
    const compactionCount = $("#context-compaction-count");
    if (compactionCount) {
      compactionCount.textContent = sessionUsage.compaction_count ? `${sessionUsage.compaction_count} 次` : "";
    }
    const memoryCount = $("#context-memory-count");
    if (memoryCount) memoryCount.textContent = state.memoryCount ? `${state.memoryCount} 条` : "";
    const note = $("#composer-model-note");
    if (note) note.textContent = model ? `${model.name} · ${model.model_id}` : "未配置模型";
    updateToolCount();
    updateDemoBadge();
    updateSendState();
  }

  function updateDemoBadge() {
    const badge = $("#demo-badge");
    if (!badge) return;
    badge.classList.toggle("hidden", !state.demoMode);
    badge.textContent = state.demoMode ? "演示模式" : "真实模型";
  }

  function updateSendState() {
    const button = $("#send-btn");
    if (!button) return;
    button.disabled = state.sending || !state.models.length || !state.assistantId;
  }

  /* ---------- Devices ---------- */
  function updateDevicePermissions() {
    const addBtn = $("#add-device-btn");
    if (addBtn) addBtn.classList.toggle("hidden", !can("device:create"));
    const banner = $("#readonly-banner");
    if (!banner) return;
    const readonly = !can("device:update") && !can("device:delete");
    banner.classList.toggle("hidden", !readonly);
    if (readonly) {
      $("#readonly-banner-text").textContent = "当前账号仅有查看权限，编辑与删除入口已隐藏；服务端同样会拒绝越权请求。";
    }
  }

  async function loadDevices() {
    if (!state.user) return;
    const params = new URLSearchParams();
    if (state.deviceFilter.q) params.set("q", state.deviceFilter.q);
    if (state.deviceFilter.status) params.set("status", state.deviceFilter.status);
    try {
      const [list, stats] = await Promise.all([
        api(`/api/devices?${params.toString()}`),
        api("/api/devices/stats"),
      ]);
      state.devices = list.items || [];
      renderStats(stats);
      renderDeviceTable(list.items || []);
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function renderStats(stats) {
    const cards = [
      { label: "设备总数", value: stats.total, foot: "全部登记设备", icon: "database", cls: "" },
      { label: "在线", value: stats.online, foot: "运行正常", icon: "wifi", cls: "online" },
      { label: "离线", value: stats.offline, foot: "需要排查", icon: "warning", cls: "offline" },
      { label: "维护中", value: stats.maintenance, foot: "计划内维护", icon: "activity", cls: "maintenance" },
    ];
    $("#stats-grid").innerHTML = cards.map((card) => `
      <div class="stat-card ${card.cls}">
        <div class="stat-label">${icon(card.icon, 14)}<span>${card.label}</span></div>
        <div class="stat-value">${card.value ?? 0}</div>
        <div class="stat-foot">${card.foot}</div>
      </div>`).join("");
  }

  function statusBadge(status) {
    const cls = status === "在线" ? "status-online" : status === "离线" ? "status-offline" : "status-maintenance";
    return `<span class="status-badge ${cls}">${escapeHtml(status)}</span>`;
  }

  function renderDeviceTable(items) {
    $("#device-count").textContent = `${items.length} 台`;
    $("#device-empty").classList.toggle("hidden", items.length > 0);
    $("#device-tbody").innerHTML = items.map((device) => `
      <tr>
        <td class="mono">#${device.id}</td>
        <td class="device-name">${escapeHtml(device.name)}</td>
        <td>${escapeHtml(device.device_type)}</td>
        <td class="mono">${escapeHtml(device.serial_no)}</td>
        <td>${escapeHtml(device.location || "—")}</td>
        <td>${statusBadge(device.status)}</td>
        <td>${escapeHtml(device.owner || "—")}</td>
        <td class="w-actions">
          <span class="row-actions">
            ${can("device:update") ? `<button class="row-btn" data-action="device-edit" data-id="${device.id}" title="编辑">${icon("edit", 13)}</button>` : ""}
            ${can("device:delete") ? `<button class="row-btn danger" data-action="device-delete" data-id="${device.id}" title="删除">${icon("trash", 13)}</button>` : ""}
          </span>
        </td>
      </tr>`).join("");
  }

  function openDeviceModal(device = null) {
    const editing = Boolean(device);
    const statusOptions = ["在线", "离线", "维护中"].map((status) =>
      `<option value="${status}" ${device?.status === status ? "selected" : ""}>${status}</option>`
    ).join("");
    openModal(`
      <div class="modal-head">
        <div><h3>${editing ? "编辑设备" : "新增设备"}</h3><p>业务系统的普通表单，Agent 通过 MCP 工具做同样的操作。</p></div>
        <button class="icon-btn" data-action="modal-close">${icon("x")}</button>
      </div>
      <form id="device-form" class="modal-body">
        <div class="form-grid">
          <label class="field"><span>设备名称</span><input name="name" value="${escapeHtml(device?.name || "")}" required></label>
          <label class="field"><span>设备类型</span><input name="device_type" value="${escapeHtml(device?.device_type || "")}" required></label>
          <label class="field"><span>设备编号</span><input name="serial_no" value="${escapeHtml(device?.serial_no || "")}" required></label>
          <label class="field"><span>位置</span><input name="location" value="${escapeHtml(device?.location || "")}"></label>
          <label class="field"><span>状态</span><select name="status">${statusOptions}</select></label>
          <label class="field"><span>负责人</span><input name="owner" value="${escapeHtml(device?.owner || "")}"></label>
          <label class="field span-2"><span>备注</span><textarea name="remark">${escapeHtml(device?.remark || "")}</textarea></label>
        </div>
        <div class="modal-foot" style="padding:0">
          <button type="button" class="ghost-btn" data-action="modal-close">取消</button>
          <button type="submit" class="primary-btn">${editing ? "保存修改" : "新增设备"}</button>
        </div>
      </form>`);
    $("#device-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.target);
      const payload = Object.fromEntries(form.entries());
      try {
        if (editing) {
          await api(`/api/devices/${device.id}`, { method: "PATCH", body: payload });
          toast("设备已更新");
        } else {
          await api("/api/devices", { method: "POST", body: payload });
          toast("设备已新增");
        }
        closeModal();
        await loadDevices();
      } catch (error) {
        toast(error.message, "error");
      }
    });
  }

  async function deleteDevice(device) {
    if (!device) return;
    if (!(await confirmDialog({ title: "删除设备", message: `确定删除「${device.name}」（${device.serial_no}）？`, confirmText: "删除", danger: true }))) return;
    try {
      await api(`/api/devices/${device.id}`, { method: "DELETE" });
      toast("设备已删除");
      await loadDevices();
    } catch (error) {
      toast(error.message, "error");
    }
  }

  /* ---------- Modal ---------- */
  function openModal(html, options = {}) {
    closeModal();
    modalReturnFocus = document.activeElement;
    const root = $("#modal-root");
    root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal ${options.wide ? "wide" : ""}" role="dialog" aria-modal="true">${html}</div>
      </div>`;
    modalTarget = root.firstElementChild;
    modalTarget.addEventListener("click", (event) => {
      if (event.target === modalTarget) closeModal();
    });
    modalKeyHandler = (event) => {
      if (event.key === "Escape") {
        closeModal();
      } else if (event.key === "Tab" && modalTarget) {
        const controls = $$("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]", modalTarget).filter((control) => control.getClientRects().length);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first) return;
        if (event.shiftKey && (document.activeElement === first || !modalTarget.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !modalTarget.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", modalKeyHandler);
    const focusTarget = $("input:not(:disabled), button:not(:disabled)", modalTarget);
    window.requestAnimationFrame(() => { if (focusTarget?.isConnected) focusTarget.focus(); });
    return root;
  }

  function closeModal() {
    if (modalKeyHandler) document.removeEventListener("keydown", modalKeyHandler);
    modalKeyHandler = null;
    const root = $("#modal-root");
    if (root) root.innerHTML = "";
    modalTarget = null;
    if (modalReturnFocus?.isConnected) modalReturnFocus.focus();
    modalReturnFocus = null;
  }

  function confirmDialog({ title, message, confirmText = "确认", danger = false }) {
    return new Promise((resolve) => {
      openModal(`
        <div class="modal-head">
          <div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p></div>
          <button class="icon-btn" data-action="modal-close">${icon("x")}</button>
        </div>
        <div class="modal-foot">
          <button class="ghost-btn" data-action="modal-close">取消</button>
          <button class="${danger ? "danger-btn" : "primary-btn"}" id="confirm-ok">${escapeHtml(confirmText)}</button>
        </div>`);
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const overlay = $("#modal-root .modal-backdrop");
      $("#confirm-ok").addEventListener("click", () => { closeModal(); finish(true); });
      overlay.addEventListener("click", (event) => {
        if (event.target.closest('[data-action="modal-close"]')) finish(false);
      });
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) finish(false);
      });
    });
  }

  function promptDialog({ title, message = "", value = "", placeholder = "", confirmText = "确认" }) {
    return new Promise((resolve) => {
      openModal(`
        <div class="modal-head">
          <div><h3>${escapeHtml(title)}</h3>${message ? `<p>${escapeHtml(message)}</p>` : ""}</div>
          <button class="icon-btn" data-action="modal-close">${icon("x")}</button>
        </div>
        <div class="modal-body">
          <label class="field"><input id="prompt-input" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" maxlength="200"></label>
        </div>
        <div class="modal-foot">
          <button class="ghost-btn" data-action="modal-close">取消</button>
          <button class="primary-btn" id="prompt-ok">${escapeHtml(confirmText)}</button>
        </div>`);
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const overlay = $("#modal-root .modal-backdrop");
      $("#prompt-ok").addEventListener("click", () => {
        const value = $("#prompt-input").value.trim();
        closeModal();
        finish(value || null);
      });
      const input = $("#prompt-input");
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          const value = input.value.trim();
          closeModal();
          finish(value || null);
        }
      });
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay || event.target.closest('[data-action="modal-close"]')) finish(null);
      });
      window.setTimeout(() => input.focus(), 40);
    });
  }

  /* ---------- Config page ---------- */
  window.addEventListener("message", (event) => {
    const frame = $("#models-settings-frame");
    if (!frame || event.origin !== window.location.origin || event.source !== frame.contentWindow) return;
    if (event.data?.type === "webagent.models.updated") {
      loadAgentMeta().catch((error) => toast(error.message, "error"));
    }
  });

  async function loadConfigPage(force = false) {
    const guest = $("#config-guest");
    const admin = $("#config-admin");
    if (!state.user?.is_admin) {
      $("#page-config").classList.remove("has-model-settings");
      guest.classList.remove("hidden");
      admin.classList.add("hidden");
      renderGuestConfig();
      return;
    }
    guest.classList.add("hidden");
    admin.classList.remove("hidden");
    await switchConfigTab(state.configTab, force);
  }

  async function switchConfigTab(tab, force = false) {
    if (tab === "providers") tab = "models";
    state.configTab = tab;
    $$("#config-nav .config-nav-item").forEach((button) => {
      button.classList.toggle("active", button.dataset.tab === tab);
    });
    await loadConfigTab(tab, force);
  }

  async function loadConfigTab(tab, force = false) {
    const content = $("#config-content");
    $("#page-config").classList.toggle("has-model-settings", tab === "models");
    content.innerHTML = '<div class="empty-config">正在加载…</div>';
    try {
      if (tab === "models") {
        content.innerHTML = '<iframe id="models-settings-frame" class="models-settings-frame" title="模型与供应商配置" src="/react/?view=models&amp;embed=1&amp;ui=models-v2"></iframe>';
      } else if (tab === "assistants") {
        const [assistants, tools, skills, models] = await Promise.all([
          api("/api/agent/admin/assistants"),
          api("/api/agent/admin/tools"),
          api("/api/agent/admin/skills"),
          api("/api/agent/admin/models"),
        ]);
        state.config.assistants = assistants.items || [];
        state.config.tools = tools.items || [];
        state.config.skills = skills.items || [];
        state.config.models = models.items || [];
        renderAssistants();
      } else if (tab === "tools") {
        const [data, dynamic, pilot, settings] = await Promise.all([
          api("/api/agent/admin/tools"),
          api("/api/agent/admin/dynamic-tools"),
          api("/api/agent/admin/pagepilot"),
          api("/api/agent/config"),
        ]);
        state.config.tools = data.items || [];
        state.config.dynamicTools = dynamic.items || [];
        state.config.pagepilot = pilot.config || null;
        state.config.settings = settings;
        renderToolsConfig(data);
      } else if (tab === "skills") {
        const data = await api("/api/agent/admin/skills");
        state.config.skills = data.items || [];
        renderSkillsConfig();
      } else if (tab === "users") {
        const data = await api("/api/users");
        state.config.users = data.items || [];
        renderUsersConfig();
      } else if (tab === "audit") {
        const [biz, agent] = await Promise.all([
          api("/api/audit"),
          api("/api/agent/admin/audit"),
        ]);
        state.config.audit = biz.items || [];
        state.config.agentAudit = agent.items || [];
        renderAuditConfig();
      } else if (tab === "sessions") {
        const params = new URLSearchParams();
        for (const key of ["username", "model", "status", "q"]) {
          const value = String(state.sessionFilter[key] || "").trim();
          if (value) params.set(key, value);
        }
        params.set("limit", "100");
        const [sessionsData, usageData] = await Promise.all([
          api(`/api/agent/admin/sessions?${params.toString()}`),
          api(`/api/agent/admin/usage/summary?days=${state.sessionFilter.days || 7}`),
        ]);
        state.config.sessions = sessionsData.items || [];
        state.config.sessionTotal = sessionsData.total || 0;
        state.config.usageSummary = usageData;
        renderSessionsConfig();
      } else if (tab === "settings") {
        const [data, models] = await Promise.all([
          api("/api/agent/config"),
          api("/api/agent/admin/models"),
        ]);
        state.config.models = models.items || [];
        state.config.settings = data;
        renderSettingsConfig();
      }
    } catch (error) {
      content.innerHTML = `<div class="empty-config">加载失败：${escapeHtml(error.message)}</div>`;
    }
  }

  function sectionHead(title, subtitle, actions = "") {
    return `
      <div class="config-section-head">
        <div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div>
        <div class="section-actions">${actions}</div>
      </div>`;
  }

  function renderGuestConfig() {
    const root = $("#guest-config-grid");
    if (!root) return;
    const assistant = currentAssistant();
    const cards = [
      ["可用助手", state.assistants.length],
      ["可用模型", state.models.length],
      ["我的工具", state.tools.length],
      ["启用技能", state.skills.length],
    ];
    root.innerHTML = cards.map(([label, value]) => `
      <div class="guest-stat"><span>${label}</span><strong>${value}</strong></div>`).join("");
    const assistantList = state.assistants.length
      ? state.assistants.map((item) => `
          <div class="list-row">
            <span class="assistant-icon">${escapeHtml(item.icon || "✦")}</span>
            <div class="list-row-main">
              <div class="list-row-title"><strong>${escapeHtml(item.name)}</strong><span class="badge ${item.mode === "report" ? "badge-blue" : "badge-green"}">${MODE_LABELS[item.mode] || item.mode}</span></div>
              <p>${escapeHtml(item.description || "通用业务助手")}</p>
              <div class="list-row-meta">
                <span>${item.model_name ? escapeHtml(item.model_name) : "默认模型"}</span>
                <span>${item.allow_model_switch ? "可切换模型" : "模型由管理员绑定"}</span>
                <span>${item.tool_names.length ? `${item.tool_names.length} 个指定工具` : "工具按账号权限"}</span>
              </div>
            </div>
          </div>`).join("")
      : '<div class="empty-config">暂无可用助手</div>';
    const note = $("#config-guest .guest-note");
    if (note) {
      note.querySelector("strong").textContent = "配置项由管理员统一维护";
      note.querySelector("p").textContent = "你可以切换管理员启用的助手和模型，并在每轮对话中选择是否使用某个工具。管理员停用的模型、工具或助手不会出现在用户侧。";
    }
    const container = $("#guest-config-grid");
    if (container && !$("#guest-assistant-list")) {
      const panel = document.createElement("div");
      panel.id = "guest-assistant-list";
      panel.className = "panel";
      panel.style.marginTop = "14px";
      panel.innerHTML = `<div class="panel-toolbar"><div class="table-title"><strong>我的助手</strong><span>${state.assistants.length}</span></div></div><div class="list-panel" style="padding:12px">${assistantList}</div>`;
      container.after(panel);
    } else if ($("#guest-assistant-list")) {
      $("#guest-assistant-list .list-panel").innerHTML = assistantList;
    }
    if (assistant) $("#welcome-subtitle").textContent = assistant.greeting || $("#welcome-subtitle").textContent;
  }

  /* ----- Assistants ----- */
  function renderAssistants() {
    const items = state.config.assistants;
    $("#config-content").innerHTML = `
      ${sectionHead("助手", "助手是运行时的配置模板：提示词、工具白名单、技能、预算和可见范围，不改代码就能新增。", `
        <span class="count-pill">${items.length} 个</span>
        <button class="primary-btn" data-action="assistant-new">${icon("plus", 14)} 新增助手</button>`)}
      <div class="list-panel">${items.length ? items.map((item) => `
        <div class="list-row ${item.enabled ? "" : "off"}">
          <span class="assistant-icon">${escapeHtml(item.icon || "✦")}</span>
          <div class="list-row-main">
            <div class="list-row-title">
              <strong>${escapeHtml(item.name)}</strong>
              <span class="badge ${item.mode === "report" ? "badge-blue" : "badge-green"}">${MODE_LABELS[item.mode] || item.mode}</span>
              ${item.enabled ? "" : '<span class="badge">停用</span>'}
            </div>
            <p>${escapeHtml(item.description || "未填写描述")}</p>
            <div class="list-row-meta">
              <span>${item.model_name ? escapeHtml(item.model_name) : "默认模型"}</span>
              <span>${item.tool_names.length ? item.tool_names.length + " 个工具" : "按账号权限"}</span>
              <span>${item.mode === "report" ? `预采集 ${item.prefetch_tools.length} 个` : `最多 ${item.max_steps || "全局"} 轮`}</span>
              <span>${escapeHtml((item.allowed_roles || []).join(", "))}</span>
            </div>
          </div>
          <div class="list-row-actions">
            <button class="mini-action" data-action="assistant-edit" data-id="${item.id}" title="编辑">${icon("edit", 12)}</button>
            <button class="mini-action danger" data-action="assistant-delete" data-id="${item.id}" title="删除">${icon("trash", 12)}</button>
          </div>
        </div>`).join("") : '<div class="empty-config">还没有助手。创建一个「设备管理助手」开始。</div>'}</div>`;
  }

  function assistantById(id) {
    return state.config.assistants.find((item) => Number(item.id) === Number(id));
  }

  function openAssistantModal(assistant = null) {
    const editing = Boolean(assistant);
    const data = assistant || {
      name: "",
      icon: "✦",
      description: "",
      greeting: "",
      system_prompt: "",
      mode: "agent",
      model_row_id: null,
      allow_model_switch: true,
      tool_names: [],
      prefetch_tools: [],
      skill_ids: [],
      max_steps: 0,
      max_tool_calls: 0,
      max_run_seconds: 0,
      context_max_tokens: 0,
      memory_enabled: true,
      allowed_roles: ["*"],
      enabled: true,
      sort_order: 100,
    };
    const tools = state.config.tools;
    const skills = state.config.skills;
    const models = state.config.models.filter((model) => ["chat", "vision"].includes(model.model_kind || "chat"));
    const selectedTools = new Set(data.tool_names || []);
    const selectedPrefetch = new Set(data.prefetch_tools || []);
    const selectedSkills = new Set((data.skill_ids || []).map(Number));
    openModal(`
      <div class="modal-head">
        <div><h3>${editing ? "编辑助手" : "新增助手"}</h3><p>助手不改代码即可新增。留空工具表示按账号权限放开全部工具。</p></div>
        <button class="icon-btn" data-action="modal-close">${icon("x")}</button>
      </div>
      <form id="assistant-form" class="modal-body">
        <div class="form-grid">
          <label class="field"><span>名称</span><input name="name" value="${escapeHtml(data.name)}" placeholder="设备管理助手" required></label>
          <label class="field"><span>图标（1 个字符）</span><input name="icon" value="${escapeHtml(data.icon)}" maxlength="4"></label>
          <label class="field span-2"><span>描述</span><input name="description" value="${escapeHtml(data.description)}" placeholder="给用户看的一句话说明"></label>
          <label class="field span-2"><span>欢迎语</span><input name="greeting" value="${escapeHtml(data.greeting)}" placeholder="我可以查询设备、统计状态……"></label>
          <label class="field"><span>运行模式</span>
            <select name="mode">
              <option value="agent" ${data.mode === "agent" ? "selected" : ""}>多步（模型决定工具）</option>
              <option value="report" ${data.mode === "report" ? "selected" : ""}>单步报告（预采集 + 一次生成）</option>
            </select>
          </label>
          <label class="field"><span>绑定模型</span>
            <select name="model_row_id">
              <option value="">跟随默认模型</option>
              ${models.map((model) => `<option value="${model.id}" ${Number(data.model_row_id) === Number(model.id) ? "selected" : ""}>${escapeHtml(model.name)} · ${escapeHtml(model.model_id)}</option>`).join("")}
            </select>
          </label>
          <label class="field span-2"><span>系统提示词</span><textarea name="system_prompt" placeholder="定义角色、边界和输出格式">${escapeHtml(data.system_prompt)}</textarea></label>
          <div class="field span-2"><span>工具白名单（不选 = 按账号权限开放全部）</span>
            <div class="check-grid">
              ${tools.map((tool) => `<label><input type="checkbox" name="tool_names" value="${escapeHtml(tool.name)}" ${selectedTools.has(tool.name) ? "checked" : ""}> <code>${escapeHtml(tool.name)}</code></label>`).join("")}
              ${tools.length ? "" : '<span class="check-note">MCP 工具层暂时不可用</span>'}
            </div>
          </div>
          <div class="field span-2"><span>报告预采集工具（仅单步模式，只会执行读取类工具）</span>
            <div class="check-grid">
              ${tools.filter((tool) => tool.risk === "read").map((tool) => `<label><input type="checkbox" name="prefetch_tools" value="${escapeHtml(tool.name)}" ${selectedPrefetch.has(tool.name) ? "checked" : ""}> <code>${escapeHtml(tool.name)}</code></label>`).join("")}
              ${tools.filter((tool) => tool.risk === "read").length ? "" : '<span class="check-note">没有可用的读取类工具</span>'}
            </div>
          </div>
          <div class="field span-2"><span>技能（只注入名称与用途，模型按需加载正文）</span>
            <div class="check-grid">
              ${skills.map((skill) => `<label><input type="checkbox" name="skill_ids" value="${skill.id}" ${selectedSkills.has(Number(skill.id)) ? "checked" : ""}> ${escapeHtml(skill.name)}</label>`).join("")}
              ${skills.length ? "" : '<span class="check-note">暂无技能</span>'}
            </div>
          </div>
          <label class="field"><span>最大推理轮次（0 = 跟随全局）</span><input name="max_steps" type="number" min="0" step="1" required value="${data.max_steps || 0}"><small>全局设为 0 时不限制轮次，仍受运行超时约束。</small></label>
          <label class="field"><span>最大工具调用（0 = 跟随全局）</span><input name="max_tool_calls" type="number" min="0" step="1" required value="${data.max_tool_calls || 0}"><small>全局设为 0 时不限制调用次数，账号权限和审批仍生效。</small></label>
          <label class="field"><span>运行超时秒（0 = 全局）</span><input name="max_run_seconds" type="number" min="0" max="900" value="${data.max_run_seconds || 0}"></label>
          <label class="field"><span>上下文上限（0 = 全局）</span><input name="context_max_tokens" type="number" min="0" value="${data.context_max_tokens || 0}"></label>
          <label class="field"><span>可见角色 / 用户（逗号分隔，* = 全部）</span><input name="allowed_roles" value="${escapeHtml((data.allowed_roles || ["*"]).join(", "))}"></label>
          <label class="field"><span>排序</span><input name="sort_order" type="number" min="0" value="${data.sort_order ?? 100}"></label>
          <div class="field span-2">
            <div class="check-grid">
              <label><input type="checkbox" name="allow_model_switch" ${data.allow_model_switch !== false ? "checked" : ""}> 允许用户切换模型</label>
              <label><input type="checkbox" name="memory_enabled" ${data.memory_enabled !== false ? "checked" : ""}> 启用长期记忆</label>
              <label><input type="checkbox" name="enabled" ${data.enabled !== false ? "checked" : ""}> 启用助手</label>
            </div>
          </div>
        </div>
        <div class="modal-foot" style="padding:0">
          <button type="button" class="ghost-btn" data-action="modal-close">取消</button>
          <button type="submit" class="primary-btn">${editing ? "保存" : "创建"}</button>
        </div>
      </form>`, { wide: true });
    $("#assistant-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.target;
      const payload = {
        name: form.elements.namedItem("name").value.trim(),
        icon: form.icon.value.trim() || "✦",
        description: form.description.value.trim(),
        greeting: form.greeting.value.trim(),
        system_prompt: form.system_prompt.value.trim(),
        mode: form.mode.value,
        model_row_id: form.model_row_id.value ? Number(form.model_row_id.value) : null,
        allow_model_switch: form.allow_model_switch.checked,
        tool_names: $$('input[name="tool_names"]:checked', form).map((item) => item.value),
        prefetch_tools: $$('input[name="prefetch_tools"]:checked', form).map((item) => item.value),
        skill_ids: $$('input[name="skill_ids"]:checked', form).map((item) => Number(item.value)),
        max_steps: Number(form.max_steps.value) || 0,
        max_tool_calls: Number(form.max_tool_calls.value) || 0,
        max_run_seconds: Number(form.max_run_seconds.value) || 0,
        context_max_tokens: Number(form.context_max_tokens.value) || 0,
        memory_enabled: form.memory_enabled.checked,
        allowed_roles: form.allowed_roles.value.split(",").map((item) => item.trim()).filter(Boolean),
        enabled: form.enabled.checked,
        sort_order: Number(form.sort_order.value) || 100,
      };
      if (!payload.allowed_roles.length) payload.allowed_roles = ["*"];
      try {
        if (editing) {
          await api(`/api/agent/admin/assistants/${assistant.id}`, { method: "PUT", body: payload });
          toast("助手已更新");
        } else {
          await api("/api/agent/admin/assistants", { method: "POST", body: payload });
          toast("助手已创建");
        }
        closeModal();
        await loadConfigTab("assistants");
        await loadAgentMeta();
        renderAssistantRail();
        renderWelcome();
      } catch (error) {
        toast(error.message, "error");
      }
    });
  }

  /* ----- Tools ----- */
  function renderToolsConfig(data) {
    const groups = {};
    for (const tool of state.config.tools) {
      const key = tool.category || "其他";
      if (!groups[key]) groups[key] = [];
      groups[key].push(tool);
    }
    const pilot = state.config.pagepilot || {};
    const pilotEnabled = Boolean(pilot.enabled && pilot.configured);
    $("#config-content").innerHTML = `
      ${sectionHead("工具治理", "工具支持 MCP 与管理员新增的 HTTP 连接器。四种状态：可见可选 / 可见固定 / 不可见但默认启用 / 不可见不可用；写和删除工具也可隐藏，但审批策略仍会校验权限。", `
        <span class="count-pill">${data.enabled_count}/${data.total}</span>
        <button class="primary-btn" data-action="dynamic-tool-new">${icon("plus", 14)} 新增工具</button>`)}
      <section class="panel connector-card ${pilotEnabled ? "connected" : ""}">
        <div class="connector-main">
          <span class="connector-icon">PP</span>
          <div>
            <div class="connector-title">
              <strong>PagePilot 发布连接器</strong>
              <span class="badge ${pilotEnabled ? "badge-green" : "badge"}">${pilotEnabled ? "已接入" : "未接入"}</span>
              <span class="badge badge-blue">REST</span>
            </div>
            <p>把模型生成或预览中的 HTML 发布为可访问网页。PagePilot 的 MCP 是本地 stdio，本框架通过官方 <code>POST /api/deploy</code> 接入，Token 加密保存且不下发浏览器。</p>
            <div class="list-row-meta">
              <span>${escapeHtml(pilot.base_url || "尚未配置地址")}</span>
              <span>${pilot.token_set ? `Token ${escapeHtml(pilot.token_masked)}` : "未配置 Token"}</span>
              <span>工具名 publish_to_pagepilot · 写入风险 · 需审批</span>
            </div>
          </div>
        </div>
        <div class="connector-actions">
          <button class="ghost-btn" data-action="pagepilot-test">测试连接</button>
          <button class="primary-btn" data-action="pagepilot-config">${pilotEnabled ? "管理连接" : "接入 PagePilot"}</button>
        </div>
      </section>
      <div class="settings-note" style="margin:0 0 10px">${icon("search", 14)}<span>先按账号权限、助手白名单和四态过滤。BM25 与决策模型最多开启一种，也可以都关闭；筛选不会扩大用户权限。</span></div>
      <div class="inline-switch tool-bm25-switch">
        <div><strong>BM25 工具检索</strong><small>本地检索 Top 16；开启时自动关闭决策筛选。</small></div>
        <label class="switch"><input type="checkbox" data-config-toggle="bm25" aria-label="启用 BM25 工具检索" ${state.config.settings?.bm25_enabled === false ? "" : "checked"}><span class="switch-track"></span></label>
      </div>
      <div class="inline-switch tool-bm25-switch">
        <div><strong>决策模型筛选</strong><small>开启时自动关闭 BM25。模型、阈值与范围在左侧「模型」页统一配置。</small></div>
        <label class="switch"><input type="checkbox" data-config-toggle="decision" aria-label="启用决策模型筛选" ${state.config.settings?.decision_enabled ? "checked" : ""}><span class="switch-track"></span></label>
      </div>
      ${Object.entries(groups).map(([category, tools]) => `
        <div class="tool-group">
          <div class="tool-group-head"><strong>${escapeHtml(category)}</strong><span>${tools.length} 个</span></div>
          <div class="list-panel">
            ${tools.map((tool) => `
              <div class="list-row ${tool.enabled ? "" : "off"}">
                <span class="assistant-icon">${icon(tool.risk === "read" ? "eye" : tool.risk === "delete" ? "trash" : "edit", 13)}</span>
                <div class="list-row-main">
                  <div class="list-row-title">
                    <strong>${escapeHtml(tool.name)}</strong>
                    <span class="risk-badge ${escapeHtml(tool.risk)}">${escapeHtml(RISK_LABELS[tool.risk] || tool.risk)}</span>
                    <span class="badge ${tool.source === "dynamic" ? "badge-blue" : ""}">${toolSourceLabel(tool)}</span>
                  </div>
                  <p>${escapeHtml(tool.description)}</p>
                  <div class="list-row-meta"><span>${escapeHtml(tool.permission)}</span></div>
                </div>
                <div class="list-row-actions">
                  <select class="select-control tool-state-select" data-tool-state="${escapeHtml(tool.name)}" aria-label="工具状态">
                    <option value="optional" ${toolState(tool) === "optional" ? "selected" : ""}>可见 · 可选</option>
                    <option value="fixed" ${toolState(tool) === "fixed" ? "selected" : ""}>可见 · 不可选</option>
                    <option value="hidden" ${toolState(tool) === "hidden" ? "selected" : ""}>不可见 · 默认启用</option>
                    <option value="disabled" ${toolState(tool) === "disabled" ? "selected" : ""}>不可见 · 不可用</option>
                  </select>
                  ${tool.source === "dynamic" ? `
                    <button class="mini-action" data-action="dynamic-tool-edit" data-id="${tool.definition?.dynamic_tool_id || ""}" title="编辑">${icon("edit", 12)}</button>
                    <button class="mini-action danger" data-action="dynamic-tool-delete" data-id="${tool.definition?.dynamic_tool_id || ""}" title="删除">${icon("trash", 12)}</button>` : ""}
                </div>
              </div>`).join("")}
          </div>
        </div>`).join("")}`;
  }

  function dynamicToolById(id) {
    return (state.config.dynamicTools || []).find((item) => Number(item.id) === Number(id));
  }

  function openDynamicToolModal(tool = null) {
    const editing = Boolean(tool);
    const schema = tool?.input_schema || { type: "object", properties: {} };
    openModal(`
      <div class="modal-head">
        <div><h3>${editing ? "编辑动态工具" : "新增动态工具"}</h3><p>管理员用 HTTP 连接器接入业务 API，不需要改 MCP 或 Agent 代码。工具调用仍透传当前用户 Token，并由业务系统再次校验权限。</p></div>
        <button class="icon-btn" data-action="modal-close">${icon("x")}</button>
      </div>
      <form id="dynamic-tool-form" class="modal-body">
        <div class="form-grid">
          <label class="field"><span>工具名</span><input name="name" value="${escapeHtml(tool?.name || "")}" placeholder="get_device_detail" required pattern="[A-Za-z][A-Za-z0-9_-]{1,63}"></label>
          <label class="field"><span>显示名称</span><input name="display_name" value="${escapeHtml(tool?.display_name || "")}" placeholder="读取设备详情"></label>
          <label class="field span-2"><span>描述（会参与 BM25 检索）</span><input name="description" value="${escapeHtml(tool?.description || "")}" placeholder="按设备 ID 读取一台设备的完整信息" required></label>
          <label class="field"><span>分类</span><input name="category" value="${escapeHtml(tool?.category || "业务连接器")}"></label>
          <label class="field"><span>所需权限</span><input name="permission" value="${escapeHtml(tool?.permission || "device:read")}" placeholder="device:read"></label>
          <label class="field"><span>风险等级</span>
            <select name="risk">
              ${["read", "write", "delete"].map((risk) => `<option value="${risk}" ${tool?.risk === risk ? "selected" : ""}>${RISK_LABELS[risk]}</option>`).join("")}
            </select>
          </label>
          <label class="field"><span>HTTP 方法</span>
            <select name="method">
              ${["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => `<option value="${method}" ${tool?.method === method ? "selected" : ""}>${method}</option>`).join("")}
            </select>
          </label>
          <label class="field span-2"><span>URL 模板</span><input name="url_template" value="${escapeHtml(tool?.url_template || "http://127.0.0.1:8000/api/devices/{device_id}")}" placeholder="http://业务系统/api/.../{path_param}" required></label>
          <label class="field span-2"><span>附加 Header（JSON）</span><input name="headers" value="${escapeHtml(JSON.stringify(tool?.headers || {}))}" placeholder='{"X-Client":"webagent"}'></label>
          <label class="field span-2"><span>输入 Schema（JSON Schema）</span><textarea name="input_schema" style="min-height:160px;font-family:var(--mono);font-size:10px">${escapeHtml(JSON.stringify(schema, null, 2))}</textarea></label>
          <label class="field span-2"><span>测试参数（JSON，仅测试用）</span><textarea name="test_arguments" style="min-height:70px;font-family:var(--mono);font-size:10px">{"device_id": 1}</textarea></label>
          <div class="field span-2"><label><input type="checkbox" name="enabled" ${tool?.enabled !== false ? "checked" : ""}> 启用这个工具</label></div>
        </div>
        <div class="modal-foot" style="padding:0">
          <button type="button" class="ghost-btn" data-action="modal-close">取消</button>
          ${editing ? `<button type="button" class="ghost-btn" data-action="dynamic-tool-test" data-id="${tool.id}">测试调用</button>` : ""}
          <button type="submit" class="primary-btn">${editing ? "保存" : "创建"}</button>
        </div>
        <div id="dynamic-tool-test-result" class="test-result hidden"></div>
      </form>`, { wide: true });
    $("#dynamic-tool-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.target;
      let headers = {};
      let inputSchema = {};
      try {
        headers = JSON.parse(form.headers.value || "{}");
        inputSchema = JSON.parse(form.input_schema.value || "{}");
      } catch {
        toast("Header 和输入 Schema 必须是 JSON", "warn");
        return;
      }
      const payload = {
        name: form.name.value.trim(),
        display_name: form.display_name.value.trim(),
        description: form.description.value.trim(),
        category: form.category.value.trim() || "业务连接器",
        permission: form.permission.value.trim(),
        risk: form.risk.value,
        method: form.method.value,
        url_template: form.url_template.value.trim(),
        headers,
        input_schema: inputSchema,
        enabled: form.enabled.checked,
      };
      try {
        if (editing) {
          await api(`/api/agent/admin/dynamic-tools/${tool.id}`, { method: "PUT", body: payload });
          toast("动态工具已更新");
        } else {
          await api("/api/agent/admin/dynamic-tools", { method: "POST", body: payload });
          toast("动态工具已创建");
        }
        closeModal();
        await loadConfigTab("tools");
      } catch (error) {
        toast(error.message, "error", 5000);
      }
    });
  }

  async function testDynamicTool(id, target) {
    const form = $("#dynamic-tool-form");
    const resultNode = $("#dynamic-tool-test-result");
    let args = {};
    try {
      args = JSON.parse(form?.test_arguments?.value || "{}");
    } catch {
      toast("测试参数必须是 JSON", "warn");
      return;
    }
    const original = target.textContent;
    target.disabled = true;
    target.textContent = "测试中…";
    resultNode.className = "test-result";
    resultNode.textContent = "正在调用业务 API…";
    resultNode.classList.remove("hidden");
    try {
      const data = await api(`/api/agent/admin/dynamic-tools/${id}/test`, {
        method: "POST",
        body: { arguments: args },
      });
      resultNode.className = `test-result ${data.ok ? "ok" : "fail"}`;
      resultNode.textContent = data.message || (data.ok ? "调用成功" : "调用失败");
    } catch (error) {
      resultNode.className = "test-result fail";
      resultNode.textContent = error.message;
    } finally {
      target.disabled = false;
      target.textContent = original;
    }
  }

  /* ----- PagePilot connector ----- */
  function openPagePilotModal() {
    const pilot = state.config.pagepilot || {};
    openModal(`
      <div class="modal-head">
        <div><h3>PagePilot 发布连接器</h3><p>通过 PagePilot REST API 发布 HTML。Token 只在 Agent 服务端加密保存，浏览器只会看到掩码。</p></div>
        <button class="icon-btn" data-action="modal-close">${icon("x")}</button>
      </div>
      <form id="pagepilot-form" class="modal-body">
        <div class="form-grid">
          <label class="field span-2"><span>PagePilot 地址</span><input name="base_url" value="${escapeHtml(pilot.base_url || "https://pagepilot.dell.4dbim.cc:1143")}" placeholder="https://pagepilot.example.com:1143" required></label>
          <label class="field span-2"><span>Bearer Token ${pilot.token_set ? "（留空表示不修改）" : ""}</span><input name="token" type="password" value="" placeholder="${pilot.token_set ? "已配置，留空保持不变" : "粘贴 PagePilot Token"}" autocomplete="new-password"></label>
          <label class="field"><span>标题后缀 / 模板</span><input name="default_title" maxlength="120" value="${escapeHtml(pilot.default_title || "")}" placeholder="例如：设备运维；或用 {title}（{date}）"></label>
          <label class="field"><span>默认发布说明</span><input name="default_description" maxlength="240" value="${escapeHtml(pilot.default_description || "")}" placeholder="支持 {date}、{user}；留空自动生成"></label>
          <label class="field"><span>默认可见范围</span>
            <select name="default_visibility">
              <option value="unlisted" ${(pilot.default_visibility || "unlisted") === "unlisted" ? "selected" : ""}>不公开（仅链接可见）</option>
              <option value="public" ${pilot.default_visibility === "public" ? "selected" : ""}>公开（创作广场可见）</option>
            </select>
          </label>
          <label class="field"><span>连接器状态</span>
            <select name="enabled">
              <option value="1" ${pilot.enabled ? "selected" : ""}>启用</option>
              <option value="0" ${!pilot.enabled ? "selected" : ""}>停用</option>
            </select>
          </label>
          <label class="field"><span>清除已存 Token</span>
            <select name="clear_token">
              <option value="0">保留</option>
              <option value="1">清除 Token</option>
            </select>
          </label>
        </div>
        <div class="settings-note" style="margin-top:12px">${icon("shield", 14)}<span>标题规则：用户填写标题 + 后台后缀，例如「用户标题（设备运维）」；用户不填时使用后台值并自动追加日期。访问密码每次发布时填写，留空即公开，不会自动生成。</span></div>
        <div id="pagepilot-test-result" class="test-result hidden"></div>
        <div class="modal-foot" style="padding:16px 0 0">
          <button type="button" class="ghost-btn" data-action="modal-close">取消</button>
          <button type="button" class="ghost-btn" data-action="pagepilot-test">测试连接</button>
          <button type="submit" class="primary-btn">保存连接器</button>
        </div>
      </form>`, { wide: true });
    $("#pagepilot-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.target;
      const payload = {
        base_url: form.base_url.value.trim(),
        enabled: form.enabled.value === "1",
        default_title: form.default_title.value.trim(),
        default_description: form.default_description.value.trim(),
        default_visibility: form.default_visibility.value,
        clear_token: form.clear_token.value === "1",
      };
      if (form.token.value.trim()) payload.token = form.token.value.trim();
      try {
        const data = await api("/api/agent/admin/pagepilot", { method: "PUT", body: payload });
        state.config.pagepilot = data.config;
        toast("PagePilot 连接器已保存");
        closeModal();
        await loadConfigTab("tools");
      } catch (error) {
        toast(error.message, "error", 5000);
      }
    });
  }

  async function testPagePilot(target) {
    const result = $("#pagepilot-test-result");
    const original = target.textContent;
    target.disabled = true;
    target.textContent = "测试中…";
    if (result) {
      result.className = "test-result";
      result.textContent = "正在验证 PagePilot Token…";
      result.classList.remove("hidden");
    }
    try {
      const data = await api("/api/agent/admin/pagepilot/test", { method: "POST" });
      if (result) {
        result.className = `test-result ${data.ok ? "ok" : "fail"}`;
        result.textContent = data.message;
      } else {
        toast(data.message, data.ok ? "ok" : "error", 5000);
      }
    } catch (error) {
      if (result) {
        result.className = "test-result fail";
        result.textContent = error.message;
      } else {
        toast(error.message, "error", 5000);
      }
    } finally {
      target.disabled = false;
      target.textContent = original;
    }
  }

  /* ----- Skills ----- */
  function renderSkillsConfig() {
    const items = state.config.skills;
    $("#config-content").innerHTML = `
      ${sectionHead("技能", "按 Agent Skills 规范做渐进式加载：系统提示词只放名称和用途，需要时由模型调用 load_skill 读取正文。", `
        <span class="count-pill">${items.length} 个</span>
        <button class="primary-btn" data-action="skill-new">${icon("plus", 14)} 新增技能</button>`)}
      <div class="list-panel">${items.length ? items.map((item) => `
        <div class="list-row ${item.enabled ? "" : "off"}">
          <span class="assistant-icon">${icon("book", 13)}</span>
          <div class="list-row-main">
            <div class="list-row-title">
              <strong>${escapeHtml(item.name)}</strong>
              <code>${escapeHtml(item.slug || "—")}</code>
              <span class="badge badge-blue">知识型</span>
            </div>
            <p>${escapeHtml(item.description || "未填写描述")}</p>
            <div class="list-row-meta">
              <span>${Object.keys(item.files || {}).length} 个参考文件</span>
              <span>${escapeHtml(truncate(item.content.replace(/\s+/g, " "), 90))}</span>
            </div>
          </div>
          <div class="list-row-actions">
            <label class="switch"><input type="checkbox" data-config-toggle="skill" data-id="${item.id}" ${item.enabled ? "checked" : ""}><span class="switch-track"></span></label>
            <button class="mini-action" data-action="skill-edit" data-id="${item.id}" title="编辑">${icon("edit", 12)}</button>
            <button class="mini-action danger" data-action="skill-delete" data-id="${item.id}" title="删除">${icon("trash", 12)}</button>
          </div>
        </div>`).join("") : '<div class="empty-config">还没有技能。</div>'}</div>`;
  }

  function openSkillModal(skill = null) {
    const editing = Boolean(skill);
    const files = skill?.files || {};
    openModal(`
      <div class="modal-head">
        <div><h3>${editing ? "编辑技能" : "新增技能"}</h3><p>遵循 Agent Skills 渐进式加载：名称和描述常驻提示词，正文与参考文件按需加载。技能只提供知识，不获得执行权限。</p></div>
        <button class="icon-btn" data-action="modal-close">${icon("x")}</button>
      </div>
      <form id="skill-form" class="modal-body">
        <div class="form-grid">
          <label class="field"><span>名称</span><input name="name" value="${escapeHtml(skill?.name || "")}" required></label>
          <label class="field"><span>标识（slug）</span><input name="slug" value="${escapeHtml(skill?.slug || "")}" placeholder="device-inspection"></label>
          <label class="field span-2"><span>描述</span><input name="description" value="${escapeHtml(skill?.description || "")}"></label>
          <label class="field"><span>类型</span><input value="prompt · 知识型" disabled></label>
          <label class="field"><span>License（可选）</span><input name="license" value="${escapeHtml(skill?.license || "")}" placeholder="MIT / 内部规范"></label>
          <label class="field span-2"><span>SKILL.md 正文</span><textarea name="content" required style="min-height:220px">${escapeHtml(skill?.content || "")}</textarea></label>
          <label class="field span-2"><span>参考文件（JSON：路径 → 内容）</span><textarea name="files" style="min-height:150px" placeholder='{"references/status-codes.md":"# 状态码..."}'>${escapeHtml(JSON.stringify(files, null, 2))}</textarea></label>
        </div>
        <div class="modal-foot" style="padding:0">
          <button type="button" class="ghost-btn" data-action="modal-close">取消</button>
          <button type="submit" class="primary-btn">${editing ? "保存" : "创建"}</button>
        </div>
      </form>`, { wide: true });
    $("#skill-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.target;
      let filesValue = {};
      try {
        filesValue = JSON.parse(form.files.value || "{}");
      } catch {
        toast("参考文件必须是 JSON 对象", "warn");
        return;
      }
      if (typeof filesValue !== "object" || Array.isArray(filesValue)) {
        toast("参考文件必须是 JSON 对象", "warn");
        return;
      }
      const payload = {
        name: form.elements.namedItem("name").value.trim(),
        slug: form.slug.value.trim(),
        description: form.description.value.trim(),
        content: form.content.value.trim(),
        kind: "prompt",
        license: form.license.value.trim(),
        files: filesValue,
      };
      try {
        if (editing) {
          await api(`/api/agent/admin/skills/${skill.id}`, { method: "PUT", body: payload });
          toast("技能已更新");
        } else {
          await api("/api/agent/admin/skills", { method: "POST", body: payload });
          toast("技能已创建");
        }
        closeModal();
        await loadConfigTab("skills");
      } catch (error) {
        toast(error.message, "error");
      }
    });
  }

  /* ----- Users ----- */
  function renderUsersConfig() {
    const items = state.config.users;
    $("#config-content").innerHTML = `
      ${sectionHead("用户与权限", "业务系统账号。Agent 不持有超级管理员身份，始终以当前用户权限调用工具。", `<span class="count-pill">${items.length} 个</span>`)}
      <div class="panel">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th class="w-id">ID</th><th>账号</th><th>显示名</th><th>角色</th><th>权限</th><th class="w-actions">操作</th></tr></thead>
            <tbody>${items.map((user) => `
              <tr>
                <td class="mono">#${user.id}</td>
                <td class="device-name">${escapeHtml(user.username)}</td>
                <td>${escapeHtml(user.display_name)}</td>
                <td>${user.is_admin ? '<span class="badge badge-green">管理员</span>' : escapeHtml(user.role)}</td>
                <td><div class="permission-chips">${(user.permissions || []).map((permission) => `<span class="permission-chip">${escapeHtml(PERMISSION_LABELS[permission] || permission)}</span>`).join("")}</div></td>
                <td class="w-actions">${user.is_admin || Number(user.id) === Number(state.user.id) ? "" : `<button class="row-btn danger" data-action="user-delete" data-id="${user.id}" title="删除用户">${icon("trash", 13)}</button>`}</td>
              </tr>`).join("")}</tbody>
          </table>
        </div>
      </div>`;
  }

  /* ----- Sessions ----- */
  function renderSessionsConfig() {
    const items = state.config.sessions || [];
    const summary = state.config.usageSummary || {};
    const totals = summary.totals || {};
    const filter = state.sessionFilter;
    const statusOptions = [
      ["", "全部状态"],
      ["ok", "成功"],
      ["error", "失败"],
      ["approval_required", "待审批"],
    ];
    const cards = [
      ["近 " + (summary.days || filter.days) + " 天调用", formatTokens(totals.calls || 0)],
      ["总 tokens", formatTokens(totals.total_tokens || 0)],
      ["估算费用", formatCost(totals.cost_usd || 0)],
      ["失败 / 重试", `${formatTokens(totals.errors || 0)} / ${formatTokens(totals.retries || 0)}`],
    ];
    $("#config-content").innerHTML = `
      ${sectionHead("会话管理", "查看所有用户的会话、上下文压缩、重试与 token 消耗。查看和导出都会写入审计。", `
        <span class="count-pill">${state.config.sessionTotal || items.length} 个会话</span>
        <button class="ghost-btn" data-action="admin-sessions-refresh">刷新</button>`)}
      <div class="admin-session-summary">
        ${cards.map(([label, value]) => `<div class="stat-card"><div class="stat-label">${escapeHtml(label)}</div><div class="stat-value">${escapeHtml(value)}</div></div>`).join("")}
      </div>
      <div class="panel" style="margin-bottom:12px;padding:11px">
        <div class="session-filter-row">
          <input data-session-filter="username" value="${escapeHtml(filter.username)}" placeholder="用户">
          <input data-session-filter="model" value="${escapeHtml(filter.model)}" placeholder="模型">
          <input data-session-filter="q" value="${escapeHtml(filter.q)}" placeholder="标题 / 关键词">
          <select class="select-control" data-session-filter="status">
            ${statusOptions.map(([value, label]) => `<option value="${value}" ${filter.status === value ? "selected" : ""}>${label}</option>`).join("")}
          </select>
          <select class="select-control" data-session-filter="days">
            ${[1, 7, 30, 90].map((days) => `<option value="${days}" ${Number(filter.days) === days ? "selected" : ""}>近 ${days} 天</option>`).join("")}
          </select>
          <button class="primary-btn" data-action="admin-sessions-refresh">查询</button>
          <button class="ghost-btn" data-action="admin-sessions-reset">重置</button>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>用户</th><th>标题</th><th>助手</th><th>模型</th><th>状态</th><th>消息</th><th>Tokens</th><th>费用</th><th>重试/压缩</th><th>更新时间</th><th class="w-actions">操作</th></tr></thead>
            <tbody>${items.length ? items.map((item) => `
              <tr>
                <td><strong>${escapeHtml(item.username)}</strong><br><span class="mono">#${item.user_id}</span></td>
                <td class="device-name">${escapeHtml(item.title || "新对话")}</td>
                <td>${escapeHtml(item.assistant_name || "—")}</td>
                <td class="mono">${escapeHtml(item.last_model_name || "—")}</td>
                <td>${item.last_status === "error" ? '<span class="badge badge-red">失败</span>' : item.last_status === "approval_required" ? '<span class="badge badge-warn">待审批</span>' : item.last_status ? '<span class="badge badge-green">成功</span>' : "—"}</td>
                <td class="mono">${item.message_count || 0}</td>
                <td class="mono">${formatTokens(item.total_tokens || 0)}</td>
                <td class="mono">${formatCost(item.total_cost_usd || 0)}</td>
                <td class="mono">${item.retry_count || 0} / ${item.compaction_count || 0}</td>
                <td class="mono">${formatTime(item.updated_at)}</td>
                <td class="w-actions"><button class="row-btn" data-action="admin-session-detail" data-id="${escapeHtml(item.id)}" title="查看会话">${icon("eye", 13)}</button></td>
              </tr>`).join("") : '<tr><td colspan="11"><div class="empty-config">没有匹配的会话</div></td></tr>'}</tbody>
          </table>
        </div>
      </div>
      <div class="panel" style="padding:11px 13px">
        <div class="settings-note">${icon("shield", 14)}<span>隐私开关关闭时，管理员只能看到会话元数据、工具名和 token，不显示正文与工具参数。可在「运行设置」中调整。</span></div>
      </div>`;
  }

  async function openAdminSessionDetail(id) {
    openModal(`<div class="modal-head"><div><h3>会话详情</h3><p>正在读取…</p></div><button class="icon-btn" data-action="modal-close">${icon("x")}</button></div><div class="modal-body"><div class="empty-config">加载中…</div></div>`, { wide: true });
    try {
      const detail = await api(`/api/agent/admin/sessions/${encodeURIComponent(id)}`);
      state.sessionDetail = detail;
      const session = detail.session || {};
      const messages = detail.messages || [];
      const compactions = detail.compaction_events || [];
      const calls = detail.llm_calls || [];
      const privacy = detail.privacy || {};
      const meta = [
        ["用户", `${session.username || "—"} #${session.user_id || ""}`],
        ["助手", session.assistant_name || "—"],
        ["模型", session.last_model_name || "—"],
        ["状态", SESSION_STATUS_LABELS[session.last_status] || session.last_status || "—"],
        ["消息数", String(session.message_count || messages.length)],
        ["累计 tokens", formatTokens(session.total_tokens || 0)],
        ["估算费用", formatCost(session.total_cost_usd || 0)],
        ["重试 / 压缩", `${session.retry_count || 0} / ${session.compaction_count || 0}`],
      ];
      const messageHtml = messages.length ? messages.map((message) => {
        const runs = message.tool_runs || [];
        const usage = message.metadata?.usage || {};
        const retrieval = message.metadata?.tool_retrieval;
        const scored = retrieval?.decision;
        return `
          <div class="session-detail-message ${escapeHtml(message.role)}">
            <div class="msg-head">
              <strong>${message.role === "user" ? "用户" : "助手"}</strong>
              <span>${formatTime(message.created_at)} · ${message.token_estimate || 0} tokens</span>
            </div>
            <div class="msg-text">${renderMarkdown(message.content || "（无正文）")}</div>
            ${runs.length ? `<div class="admin-tool-runs">${runs.map((run, index) => renderProcessToolStep(run, index)).join("")}</div>` : ""}
            ${retrieval ? `<details class="retrieval-diagnostics"><summary>候选筛选 · ${escapeHtml({none: "全部关闭", bm25: "BM25", decision: "决策模型"}[retrieval.mode] || retrieval.reason)} · ${retrieval.eligible} → ${retrieval.selected} 个工具${scored ? ` · ${scored.latency_ms || 0}ms${scored.fallback ? " · 已回退全量候选" : ""}` : ""}</summary><div>${scored?.model ? `<p>决策模型：${escapeHtml(scored.model)}</p>` : ""}${scored ? `<p>结果：${escapeHtml(scored.reason || "")} · 候选 ${scored.candidates || 0} 项</p>` : ""}${scored?.scores ? `<pre>${escapeHtml(JSON.stringify(scored.scores, null, 2))}</pre>` : ""}</div></details>` : ""}
            ${usage.total_tokens ? `<div class="msg-usage">${formatTokens(usage.prompt_tokens)} in · ${formatTokens(usage.completion_tokens)} out · ${formatCost(usage.cost_usd)}${usage.retry_count ? ` · ${usage.retry_count} 次重试` : ""}</div>` : ""}
          </div>`;
      }).join("") : '<div class="empty-config">没有消息</div>';
      const compactionHtml = compactions.length ? compactions.map((event) => `
        <div class="session-event-row">
          <span class="${event.ok ? "ok" : "fail"}">${event.ok ? "OK" : "FAIL"}</span>
          <span>${formatTime(event.created_at)}</span>
          <span>${escapeHtml(event.trigger)}</span>
          <span>${formatTokens(event.before_tokens)} → ${formatTokens(event.after_tokens)}</span>
          <span>${event.summarized_messages} 条</span>
          <span>${escapeHtml(event.summary_model || "")}</span>
          <span>${event.duration_ms}ms</span>
        </div>`).join("") : '<div class="usage-note">没有压缩记录</div>';
      const callHtml = calls.length ? calls.slice(0, 40).map((call) => `
        <div class="session-event-row">
          <span class="${call.status === "ok" ? "ok" : "fail"}">${call.status}</span>
          <span>${formatTime(call.created_at)}</span>
          <span>${escapeHtml(call.purpose)}</span>
          <span>#${call.attempt}</span>
          <span>${formatTokens(call.total_tokens)} tok</span>
          <span>${formatCost(call.cost_usd)}</span>
          <span>${call.latency_ms}ms</span>
          <span title="${escapeHtml(call.error || "")}">${escapeHtml(truncate(call.error || "", 60))}</span>
        </div>`).join("") : '<div class="usage-note">没有模型调用记录</div>';
      openModal(`
        <div class="modal-head">
          <div><h3>${escapeHtml(session.title || "会话详情")}</h3><p>${escapeHtml(session.id)}${privacy.include_content ? "" : " · 正文已按隐私设置隐藏"}</p></div>
          <button class="icon-btn" data-action="modal-close">${icon("x")}</button>
        </div>
        <div class="modal-body">
          <div class="session-detail-meta">${meta.map(([label, value]) => `<div><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}</div>
          <div class="session-detail-messages">${messageHtml}</div>
          <div class="session-events"><h4>压缩记录</h4>${compactionHtml}</div>
          <div class="session-events"><h4>模型调用与重试</h4>${callHtml}</div>
          <div class="modal-foot" style="padding:0">
            <a class="ghost-btn" href="/api/agent/admin/sessions/${encodeURIComponent(session.id)}/export?format=json" download>导出 JSON</a>
            <a class="ghost-btn" href="/api/agent/admin/sessions/${encodeURIComponent(session.id)}/export?format=markdown" download>导出 Markdown</a>
            <a class="ghost-btn" href="/api/agent/admin/sessions/${encodeURIComponent(session.id)}/export?format=csv" download>导出 CSV</a>
          </div>
        </div>`, { wide: true });
      hydrateMermaid($("#modal-root .session-detail-messages"));
    } catch (error) {
      toast(error.message, "error", 5000);
      closeModal();
    }
  }

  /* ----- Audit ----- */
  function renderAuditConfig() {
    const rows = [
      ...state.config.audit.map((item) => ({ ...item, origin: item.source || "business" })),
      ...state.config.agentAudit.map((item) => ({ ...item, origin: "agent" })),
    ].sort((a, b) => String(b.ts || b.created_at || "").localeCompare(String(a.ts || a.created_at || "")));
    $("#config-content").innerHTML = `
      ${sectionHead("审计日志", "业务系统与 Agent 服务双端记录，包含工具审批和模型调用。", `<span class="count-pill">${rows.length} 条</span>`)}
      <div class="panel">
        <div class="table-wrap">
          <table class="data-table audit-table">
            <thead><tr><th>时间</th><th>来源</th><th>用户</th><th>动作</th><th>资源</th><th>详情</th></tr></thead>
            <tbody>${rows.slice(0, 300).map((row) => `
              <tr>
                <td class="mono">${formatTime(row.ts)}</td>
                <td><span class="source-badge ${escapeHtml(row.origin)}">${escapeHtml(row.origin)}</span></td>
                <td>${escapeHtml(row.username)}</td>
                <td class="mono">${escapeHtml(row.action)}</td>
                <td class="mono">${escapeHtml(row.resource)}</td>
                <td class="detail-cell" title="${escapeHtml(row.detail)}">${escapeHtml(row.detail)}</td>
              </tr>`).join("")}</tbody>
          </table>
        </div>
      </div>`;
  }

  /* ----- Settings ----- */
  function renderSettingsConfig() {
    const config = state.config.settings || {};
    const allModels = state.config.models || [];
    const models = allModels.filter((model) => ["chat", "vision"].includes(model.model_kind || "chat"));
    const compactionModel = models.find((item) => Number(item.id) === Number(config.compaction_model_id));
    $("#config-content").innerHTML = `
      ${sectionHead("运行设置", "全局默认值。助手可以覆盖步数、工具调用、超时和上下文上限。", "")}
      <form id="settings-form" class="settings-grid">
        <section class="panel settings-card">
          <div class="settings-section-title">模型与上下文</div>
          <div class="form-grid">
            <label class="field"><span>temperature</span><input name="llm_temperature" type="number" step="0.1" min="0" max="2" value="${config.llm_temperature ?? 0.3}"></label>
            <label class="field"><span>最大推理轮次（0 = 不限）</span><input name="max_iterations" type="number" min="0" step="1" required value="${config.max_iterations ?? 6}"><small>每次模型请求计一轮；取消次数限制后，仍受运行超时约束。</small></label>
            <label class="field"><span>最大工具调用（0 = 不限）</span><input name="max_tool_calls" type="number" min="0" step="1" required value="${config.max_tool_calls ?? 12}"><small>一次运行的实际工具执行次数，不改变账号权限与审批规则。</small></label>
            <label class="field"><span>运行超时（秒）</span><input name="max_run_seconds" type="number" min="10" max="900" value="${config.max_run_seconds ?? 120}"><small>单次任务的总时限，范围 10–900 秒；次数不限时仍保留该边界。</small></label>
            <label class="field"><span>上下文上限（0 = 跟随模型窗口）</span><input name="context_max_tokens" type="number" min="0" value="${config.context_max_tokens ?? 0}"></label>
            <label class="field"><span>上下文安全余量（tokens）</span><input name="context_reserve_tokens" type="number" min="0" max="100000" value="${config.context_reserve_tokens ?? 1600}"><small>从模型窗口中额外留出的空间，缓冲系统提示、工具定义和 token 估算误差；与回复输出预留分别计算。默认 1600，设为 0 不额外预留。</small></label>
            <label class="field"><span>压缩摘要模型</span>
              <select name="compaction_model_id">
                <option value="0" ${!config.compaction_model_id ? "selected" : ""}>跟随主模型</option>
                ${models.map((model) => `<option value="${model.id}" ${Number(config.compaction_model_id) === Number(model.id) ? "selected" : ""}>${escapeHtml(model.name)} · ${escapeHtml(model.model_id)}</option>`).join("")}
              </select>
            </label>
            <label class="field"><span>标题生成模型</span>
              <select name="title_model_id">
                <option value="0" ${!config.title_model_id ? "selected" : ""}>跟随主模型</option>
                ${models.map((model) => `<option value="${model.id}" ${Number(config.title_model_id) === Number(model.id) ? "selected" : ""}>${escapeHtml(model.name)}</option>`).join("")}
              </select>
            </label>
            <label class="field"><span>降级模型</span>
              <select name="fallback_model_id">
                <option value="0" ${!config.fallback_model_id ? "selected" : ""}>不降级</option>
                ${models.map((model) => `<option value="${model.id}" ${Number(config.fallback_model_id) === Number(model.id) ? "selected" : ""}>${escapeHtml(model.name)}</option>`).join("")}
              </select>
            </label>
            <label class="field"><span>语音识别（ASR）模型</span>
              <select name="asr_model_id">
                <option value="0" ${!config.asr_model_id ? "selected" : ""}>未配置（语音按钮禁用）</option>
                ${allModels.filter((model) => model.supports_transcription && model.model_kind !== "asr_realtime" && !/realtime|real-time/i.test(model.model_id || "")).map((model) => `<option value="${model.id}" ${Number(config.asr_model_id) === Number(model.id) ? "selected" : ""}>${escapeHtml(model.name)}</option>`).join("")}
              </select>
              <small>仅用于录音文件识别。实时 WebSocket 模型不能在这里使用；请先在模型中选择正确语音协议并测试。</small>
            </label>
            <label class="field"><span>默认执行方式</span>
              <select name="default_approval_mode">
                <option value="confirm" ${config.default_approval_mode !== "full_access" ? "selected" : ""}>变更前确认</option>
                <option value="full_access" ${config.default_approval_mode === "full_access" ? "selected" : ""}>完全访问</option>
              </select>
            </label>
            <label class="field"><span>默认思考强度</span>
              <select name="default_reasoning_effort">
                ${REASONING_OPTIONS.map(([effort, label]) => `<option value="${effort}" ${(config.default_reasoning_effort || "") === effort ? "selected" : ""}>${label}</option>`).join("")}
              </select>
            </label>
            <label class="field"><span>压缩保留比例（0.2–0.9）</span><input name="compaction_keep_ratio" type="number" step="0.05" min="0.2" max="0.9" value="${config.compaction_keep_ratio ?? 0.58}"></label>
            <label class="field"><span>每用户每日 token 上限（0 = 不限）</span><input name="user_daily_token_limit" type="number" min="0" value="${config.user_daily_token_limit ?? 0}"></label>
            <label class="field"><span>演示模式</span>
              <select name="demo_mode"><option value="1" ${config.demo_mode ? "selected" : ""}>开启（不请求外部 LLM）</option><option value="0" ${!config.demo_mode ? "selected" : ""}>关闭（真实调用）</option></select>
            </label>
            <label class="field"><span>空态标题</span><input name="welcome_title" maxlength="120" value="${escapeHtml(config.welcome_title || "有什么我能帮你的吗？")}"></label>
            <label class="field"><span>空态副标题（留空用助手欢迎语）</span><input name="welcome_subtitle" maxlength="500" value="${escapeHtml(config.welcome_subtitle || "")}"></label>
            <label class="field span-2"><span>空态问题（每行一个，留空使用权限默认）</span><textarea name="welcome_prompts" style="min-height:92px">${escapeHtml(config.welcome_prompts || "")}</textarea></label>
            <label class="field span-2"><span>管理员补充提示词</span><textarea name="system_prompt_extra" style="min-height:110px">${escapeHtml(config.system_prompt_extra || "")}</textarea></label>
          </div>
          <div class="check-grid" style="margin-top:4px">
            <label><input type="checkbox" name="context_compression" ${config.context_compression ? "checked" : ""}> 启用自动上下文压缩</label>
            <label><input type="checkbox" name="memory_enabled" ${config.memory_enabled ? "checked" : ""}> 启用长期记忆</label>
            <label><input type="checkbox" name="allow_full_access" ${config.allow_full_access !== false ? "checked" : ""}> 允许用户切换完全访问</label>
          </div>
          <div class="config-actions">
            <button type="submit" class="primary-btn">保存设置</button>
            <button type="button" class="ghost-btn" data-action="settings-test">测试默认模型</button>
          </div>
          <div id="settings-test-result" class="test-result hidden"></div>
        </section>
        <section class="panel settings-card">
          <div class="settings-section-title">LLM 异常重试</div>
          <div class="form-grid">
            <label class="field"><span>最大尝试次数</span><input name="retry_max_attempts" type="number" min="1" max="8" value="${config.retry_max_attempts ?? 3}"></label>
            <label class="field"><span>初始退避（毫秒）</span><input name="retry_initial_backoff_ms" type="number" min="100" max="60000" value="${config.retry_initial_backoff_ms ?? 800}"></label>
            <label class="field"><span>最大退避（毫秒）</span><input name="retry_max_backoff_ms" type="number" min="100" max="120000" value="${config.retry_max_backoff_ms ?? 8000}"></label>
            <label class="field"><span>退避倍数</span><input name="retry_multiplier" type="number" step="0.1" min="1" max="10" value="${config.retry_multiplier ?? 2}"></label>
            <label class="field"><span>抖动比例（0–1）</span><input name="retry_jitter" type="number" step="0.05" min="0" max="1" value="${config.retry_jitter ?? 0.2}"></label>
            <label class="field"><span>重试总时长上限（秒）</span><input name="retry_max_elapsed_seconds" type="number" min="1" max="600" value="${config.retry_max_elapsed_seconds ?? 60}"></label>
          </div>
          <div class="check-grid" style="margin-top:4px">
            <label><input type="checkbox" name="retry_enabled" ${config.retry_enabled !== false ? "checked" : ""}> 启用自动重试</label>
            <label><input type="checkbox" name="retry_honor_retry_after" ${config.retry_honor_retry_after !== false ? "checked" : ""}> 优先遵守 Retry-After</label>
          </div>
          <div class="settings-note" style="margin-top:10px">${icon("activity", 14)}<span>只重试 LLM HTTP 请求；超时、连接错误、429 和 5xx 会退避重试，401/403/404/422 不重试。工具执行不会自动重放。</span></div>
        </section>
        <section class="panel settings-card">
          <div class="settings-section-title">会话与隐私</div>
          <div class="form-grid">
            <label class="field"><span>会话保留天数（0 = 永久）</span><input name="session_retention_days" type="number" min="0" max="3650" value="${config.session_retention_days ?? 0}"></label>
            <label class="field"><span>管理员查看会话正文</span>
              <select name="admin_session_content">
                <option value="1" ${config.admin_session_content !== false ? "selected" : ""}>允许查看正文</option>
                <option value="0" ${config.admin_session_content === false ? "selected" : ""}>只看元数据</option>
              </select>
            </label>
          </div>
          <div class="settings-note">${icon("shield", 14)}<span>API Key 只存放于 Agent 服务端 SQLite，接口只返回掩码；浏览器和业务系统都拿不到明文。</span></div>
          <div class="settings-note" style="margin-top:10px">${icon("activity", 14)}<span>当前：${config.provider_count || 0} 个供应商 · ${config.model_count || 0} 个模型 · ${config.assistants || 0} 个助手</span></div>
          <div class="inline-switch"><div><strong>保存思考原文</strong><small>关闭时仍可在本次页面展开思考，刷新后不恢复；开启后才持久保存原文。</small></div><label class="switch"><input type="checkbox" name="store_reasoning" ${config.store_reasoning !== false ? "checked" : ""}><span class="switch-track"></span></label></div>
          <div class="inline-switch"><div><strong>上下文压缩</strong><small>超出预算时把较早消息摘要，保留最近对话。</small></div><span class="badge ${config.context_compression ? "badge-green" : ""}">${config.context_compression ? "开启" : "关闭"}</span></div>
          <div class="inline-switch"><div><strong>压缩摘要模型</strong><small>${compactionModel ? escapeHtml(compactionModel.name + " · " + compactionModel.model_id) : "跟随主模型"}</small></div><span class="badge badge-blue">${compactionModel ? "已指定" : "继承"}</span></div>
          <div class="inline-switch"><div><strong>长期记忆</strong><small>只注入用户手动添加的记忆，v1 不做自动抽取。</small></div><span class="badge ${config.memory_enabled ? "badge-green" : ""}">${config.memory_enabled ? "开启" : "关闭"}</span></div>
          <div class="inline-switch"><div><strong>演示模式</strong><small>开启时使用本地规则引擎，适合演示和回归测试。</small></div><span class="badge ${config.demo_mode ? "badge-warn" : "badge-green"}">${config.demo_mode ? "开启" : "关闭"}</span></div>
        </section>
      </form>`;
    $("#settings-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.target;
      const payload = {
        llm_temperature: Number(form.llm_temperature.value),
        max_iterations: Number(form.max_iterations.value),
        max_tool_calls: Number(form.max_tool_calls.value),
        max_run_seconds: Number(form.max_run_seconds.value),
        context_max_tokens: Number(form.context_max_tokens.value),
        context_reserve_tokens: Number(form.context_reserve_tokens.value),
        compaction_model_id: Number(form.compaction_model_id.value) || 0,
        title_model_id: Number(form.title_model_id.value) || 0,
        fallback_model_id: Number(form.fallback_model_id.value) || 0,
        asr_model_id: Number(form.asr_model_id.value) || 0,
        default_reasoning_effort: form.default_reasoning_effort.value,
        default_approval_mode: form.default_approval_mode.value,
        allow_full_access: form.allow_full_access.checked,
        welcome_title: form.welcome_title.value.trim(),
        welcome_subtitle: form.welcome_subtitle.value.trim(),
        welcome_prompts: form.welcome_prompts.value.trim(),
        compaction_keep_ratio: Number(form.compaction_keep_ratio.value),
        user_daily_token_limit: Number(form.user_daily_token_limit.value) || 0,
        session_retention_days: Number(form.session_retention_days.value) || 0,
        admin_session_content: form.admin_session_content.value === "1",
        store_reasoning: form.store_reasoning.checked,
        context_compression: form.context_compression.checked,
        memory_enabled: form.memory_enabled.checked,
        demo_mode: form.demo_mode.value === "1",
        system_prompt_extra: form.system_prompt_extra.value.trim(),
        retry_enabled: form.retry_enabled.checked,
        retry_max_attempts: Number(form.retry_max_attempts.value),
        retry_initial_backoff_ms: Number(form.retry_initial_backoff_ms.value),
        retry_max_backoff_ms: Number(form.retry_max_backoff_ms.value),
        retry_multiplier: Number(form.retry_multiplier.value),
        retry_jitter: Number(form.retry_jitter.value),
        retry_honor_retry_after: form.retry_honor_retry_after.checked,
        retry_max_elapsed_seconds: Number(form.retry_max_elapsed_seconds.value),
      };
      try {
        await api("/api/agent/config", { method: "PUT", body: payload });
        toast("运行设置已保存");
        state.demoMode = payload.demo_mode;
        if (state.status) state.status.store_reasoning = payload.store_reasoning;
        try {
          const fresh = await api("/api/agent/status");
          state.status = fresh;
          renderVoiceState();
        } catch { /* ignore */ }
        updateDemoBadge();
        await loadConfigTab("settings");
      } catch (error) {
        toast(error.message, "error");
      }
    });
  }

  /* ----- Memory ----- */
  async function openMemoryModal() {
    openModal(`
      <div class="modal-head">
        <div><h3>长期记忆</h3><p>只注入你手动添加的内容，可随时停用或删除。</p></div>
        <button class="icon-btn" data-action="modal-close">${icon("x")}</button>
      </div>
      <div class="modal-body"><div class="empty-config">正在加载…</div></div>`, { wide: true });
    try {
      const data = await api("/api/agent/memories?include_disabled=true");
      const items = data.items || [];
      state.memoryCount = items.filter((item) => item.enabled).length;
      openModal(`
        <div class="modal-head">
          <div><h3>长期记忆</h3><p>只注入你手动添加的内容，可随时停用或删除。</p></div>
          <button class="icon-btn" data-action="modal-close">${icon("x")}</button>
        </div>
        <div class="modal-body">
          <form id="memory-form" class="memory-add">
            <input name="content" placeholder="例如：我负责机房 A 的设备，优先关注离线告警" maxlength="2000" required>
            <button class="primary-btn" type="submit">添加</button>
          </form>
          <div class="list-panel" style="margin-top:12px">
            ${items.length ? items.map((item) => `
              <div class="list-row ${item.enabled ? "" : "off"}">
                <span class="assistant-icon">${icon("brain", 13)}</span>
                <div class="list-row-main">
                  <p style="margin:0">${escapeHtml(item.content)}</p>
                  <div class="list-row-meta"><span>${escapeHtml(item.kind)}</span><span>${formatRelative(item.updated_at)}</span></div>
                </div>
                <div class="list-row-actions">
                  <label class="switch"><input type="checkbox" data-config-toggle="memory" data-id="${item.id}" ${item.enabled ? "checked" : ""}><span class="switch-track"></span></label>
                  <button class="mini-action danger" data-action="memory-delete" data-id="${item.id}" title="删除">${icon("trash", 12)}</button>
                </div>
              </div>`).join("") : '<div class="empty-config">还没有记忆。添加一条后，助手会在相关对话中使用。</div>'}
          </div>
        </div>`, { wide: true });
      $("#memory-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const content = event.target.content.value.trim();
        if (!content) return;
        try {
          await api("/api/agent/memories", { method: "POST", body: { content, kind: "fact" } });
          toast("记忆已添加");
          closeModal();
          await openMemoryModal();
          renderContextRail();
        } catch (error) {
          toast(error.message, "error");
        }
      });
    } catch (error) {
      toast(error.message, "error");
    }
  }

  /* ----- Config actions ----- */
  async function handleConfigAction(action, target) {
    const id = target.dataset.id;
    if (action === "admin-sessions-refresh") { await loadConfigTab("sessions"); return; }
    if (action === "admin-sessions-reset") {
      state.sessionFilter = { username: "", model: "", status: "", q: "", days: 7 };
      await loadConfigTab("sessions");
      return;
    }
    if (action === "admin-session-detail") { await openAdminSessionDetail(id); return; }
    if (action === "dynamic-tool-new") { openDynamicToolModal(); return; }
    if (action === "pagepilot-config") { openPagePilotModal(); return; }
    if (action === "pagepilot-test") { testPagePilot(target); return; }
    if (action === "dynamic-tool-edit") {
      openDynamicToolModal(dynamicToolById(id));
      return;
    }
    if (action === "dynamic-tool-test") { testDynamicTool(Number(id), target); return; }
    if (action === "dynamic-tool-delete") {
      const tool = dynamicToolById(id);
      if (!tool) return;
      if (!(await confirmDialog({ title: "删除动态工具", message: `删除「${tool.display_name || tool.name}」？相关工具状态也会移除。`, confirmText: "删除", danger: true }))) return;
      try {
        await api(`/api/agent/admin/dynamic-tools/${id}`, { method: "DELETE" });
        toast("动态工具已删除");
        await loadConfigTab("tools");
      } catch (error) { toast(error.message, "error"); }
      return;
    }
    if (action === "assistant-new") { openAssistantModal(); return; }
    if (action === "assistant-edit") { openAssistantModal(assistantById(id)); return; }
    if (action === "assistant-delete") {
      const assistant = assistantById(id);
      if (!(await confirmDialog({ title: "删除助手", message: `删除「${assistant.name}」？已有会话会保留。`, confirmText: "删除", danger: true }))) return;
      try {
        await api(`/api/agent/admin/assistants/${id}`, { method: "DELETE" });
        toast("助手已删除");
        await loadConfigTab("assistants");
        await loadAgentMeta();
        renderAssistantRail();
      } catch (error) { toast(error.message, "error"); }
      return;
    }
    if (action === "skill-new") { openSkillModal(); return; }
    if (action === "skill-edit") {
      openSkillModal(state.config.skills.find((item) => Number(item.id) === Number(id)));
      return;
    }
    if (action === "skill-delete") {
      if (!(await confirmDialog({ title: "删除技能", message: "删除后助手将不再注入该技能。", confirmText: "删除", danger: true }))) return;
      try {
        await api(`/api/agent/admin/skills/${id}`, { method: "DELETE" });
        toast("技能已删除");
        await loadConfigTab("skills");
      } catch (error) { toast(error.message, "error"); }
      return;
    }
    if (action === "user-delete") {
      const user = state.config.users.find((item) => Number(item.id) === Number(id));
      if (!(await confirmDialog({ title: "删除用户", message: `删除账号「${user.username}」及其登录会话？`, confirmText: "删除", danger: true }))) return;
      try {
        await api(`/api/users/${id}`, { method: "DELETE" });
        toast("用户已删除");
        await loadConfigTab("users");
      } catch (error) { toast(error.message, "error"); }
      return;
    }
    if (action === "memory-delete") {
      try {
        await api(`/api/agent/memories/${id}`, { method: "DELETE" });
        closeModal();
        await openMemoryModal();
        renderContextRail();
      } catch (error) { toast(error.message, "error"); }
      return;
    }
    if (action === "settings-test") {
      target.disabled = true;
      const result = $("#settings-test-result");
      result.className = "test-result";
      result.textContent = "正在测试…";
      result.classList.remove("hidden");
      try {
        const data = await api("/api/agent/test-llm", { method: "POST", body: {} });
        result.className = `test-result ${data.ok ? "ok" : "fail"}`;
        result.textContent = data.message;
      } catch (error) {
        result.className = "test-result fail";
        result.textContent = error.message;
      } finally {
        target.disabled = false;
      }
    }
  }

  async function handleConfigChange(event) {
    const stateSelect = event.target.closest("[data-tool-state]");
    if (stateSelect) {
      const name = stateSelect.dataset.toolState;
      const value = stateSelect.value;
      const tool = state.config.tools.find((item) => item.name === name);
      if (
        value === "hidden" &&
        tool &&
        ["write", "delete"].includes(tool.risk)
      ) {
        const confirmed = await confirmDialog({
          title: "隐藏高风险工具",
          message: `「${name}」是${tool.risk === "delete" ? "删除" : "写入"}工具。隐藏后用户工具列表里看不到它，但模型仍可能自动调用；调用仍会进入审批。确认继续？`,
          confirmText: "确认隐藏",
          danger: true,
        });
        if (!confirmed) {
          await loadConfigTab("tools");
          return;
        }
      }
      const payload = {
        optional: { enabled: true, visible: true, selectable: true, default_selected: true },
        fixed: { enabled: true, visible: true, selectable: false, default_selected: true },
        hidden: { enabled: true, visible: false, selectable: false, default_selected: true },
        disabled: { enabled: false, visible: false, selectable: false, default_selected: false },
      }[value];
      if (!payload) return;
      try {
        await api(`/api/agent/admin/tools/${encodeURIComponent(name)}`, { method: "PUT", body: payload });
        const tool = state.config.tools.find((item) => item.name === name);
        if (tool) Object.assign(tool, payload);
        toast(`工具状态已更新：${TOOL_STATE_LABELS[value]}`, "ok", 1800);
        await loadConfigTab("tools");
      } catch (error) {
        toast(error.message, "error");
        await loadConfigTab("tools");
      }
      return;
    }
    const toggle = event.target.closest("[data-config-toggle]");
    if (!toggle) return;
    const kind = toggle.dataset.configToggle;
    const enabled = toggle.checked;
    try {
      if (kind === "tool") {
        await api(`/api/agent/admin/tools/${encodeURIComponent(toggle.dataset.name)}`, { method: "PUT", body: { enabled } });
        const tool = state.config.tools.find((item) => item.name === toggle.dataset.name);
        if (tool) tool.enabled = enabled;
        toast(enabled ? "工具已启用" : "工具已停用", "ok", 1800);
      } else if (kind === "skill") {
        await api(`/api/agent/admin/skills/${toggle.dataset.id}`, { method: "PUT", body: { enabled } });
        toast(enabled ? "技能已启用" : "技能已停用", "ok", 1800);
      } else if (kind === "memory") {
        await api(`/api/agent/memories/${toggle.dataset.id}`, { method: "PATCH", body: { enabled } });
        toast(enabled ? "记忆已启用" : "记忆已停用", "ok", 1800);
      } else if (kind === "bm25" || kind === "decision") {
        const result = await api("/api/agent/config", {
          method: "PUT",
          body: { [kind === "bm25" ? "bm25_enabled" : "decision_enabled"]: enabled },
        });
        state.config.settings = result;
        state.status = { ...(state.status || {}), ...result };
        toast(result.decision_enabled ? "决策筛选已开启，BM25 已关闭" : result.bm25_enabled ? "BM25 已开启，决策筛选已关闭" : "两种筛选均已关闭，保留全部已授权候选", "ok", 2400);
        await loadConfigTab("tools");
      }
    } catch (error) {
      toggle.checked = !enabled;
      toast(error.message, "error");
    }
  }

  /* ---------- Static events ---------- */
  function bindStaticEvents() {
    $("#login-form").addEventListener("submit", login);
    $$(".account-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        $("#login-username").value = chip.dataset.user;
        $("#login-password").value = chip.dataset.pass;
      });
    });
    $("#logout-btn").addEventListener("click", logout);
    $$(".nav-item").forEach((button) => {
      button.addEventListener("click", () => switchPage(button.dataset.page));
    });
    $("#new-chat-btn").addEventListener("click", newChat);
    $("#mobile-new-chat-btn").addEventListener("click", newChat);
    $("#mobile-assistant-btn").addEventListener("click", openAssistantPicker);
    $("#clear-chat-btn").addEventListener("click", clearChat);
    $("#compact-chat-btn").addEventListener("click", compactChat);
    $("#send-btn").addEventListener("click", () => sendMessage());
    $("#chat-input").addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
      }
    });
    $("#chat-input").addEventListener("input", (event) => {
      event.target.style.height = "auto";
      event.target.style.height = `${Math.min(event.target.scrollHeight, 180)}px`;
    });
    $("#model-select").addEventListener("change", (event) => changeModel(event.target.value));
    $("#reasoning-select").addEventListener("change", (event) => {
      state.reasoningEffort = event.target.value;
    });
    $("#voice-btn").addEventListener("click", toggleVoice);
    $("#access-mode-btn").addEventListener("click", () => {
      $("#tool-popover").classList.add("hidden");
      $("#access-popover").classList.toggle("hidden");
    });
    $("#tool-picker-btn").addEventListener("click", () => {
      $("#access-popover").classList.add("hidden");
      $("#tool-popover").classList.toggle("hidden");
    });
    $("#tools-all-btn").addEventListener("click", () => {
      state.selectedTools = new Set(state.tools.map((tool) => tool.name));
      saveToolSelection();
      renderToolPopover();
      renderContextRail();
    });
    $("#tools-none-btn").addEventListener("click", () => {
      state.selectedTools = new Set();
      saveToolSelection();
      renderToolPopover();
      renderContextRail();
    });
    $("#file-input").addEventListener("change", (event) => {
      attachFiles(event.target.files);
      event.target.value = "";
    });
    $("#manage-memory-btn").addEventListener("click", openMemoryModal);
    $("#artifact-publish-form").addEventListener("submit", (event) => {
      event.preventDefault();
      publishArtifact();
    });
    $("#refresh-devices-btn").addEventListener("click", loadDevices);
    $("#add-device-btn").addEventListener("click", () => openDeviceModal());
    $("#refresh-config-btn").addEventListener("click", () => loadConfigPage(true));
    $("#device-search").addEventListener("input", (event) => {
      state.deviceFilter.q = event.target.value.trim();
      window.clearTimeout(state.deviceTimer);
      state.deviceTimer = window.setTimeout(loadDevices, 260);
    });
    $("#device-status-filter").addEventListener("change", (event) => {
      state.deviceFilter.status = event.target.value;
      loadDevices();
    });
    $$("#config-nav .config-nav-item").forEach((button) => {
      button.addEventListener("click", () => switchConfigTab(button.dataset.tab));
    });

    document.addEventListener("click", handleGlobalClick);
    document.addEventListener("change", handleGlobalChange);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target.matches("[data-session-filter]")) {
        event.preventDefault();
        loadConfigTab("sessions");
      }
      if (event.key === "Escape") closeArtifactModal();
    });
  }

  function handleGlobalClick(event) {
    const artifactTrigger = event.target.closest("[data-artifact-open]");
    if (artifactTrigger) {
      openArtifactModal(artifactTrigger.dataset.artifactOpen);
      return;
    }
    const artifactCode = event.target.closest("[data-artifact-code]");
    if (artifactCode) {
      const artifact = htmlArtifacts.get(artifactCode.dataset.artifactCode);
      if (artifact) openCodeModal(`${artifact.title} · HTML`, artifact.html, "html", "page.html");
      return;
    }
    const codeAction = event.target.closest("[data-code-action]");
    if (codeAction) {
      const item = codeBoxes.get(codeAction.dataset.codeId);
      if (!item) return;
      const action = codeAction.dataset.codeAction;
      if (action === "copy") {
        navigator.clipboard?.writeText(item.code).then(
          () => toast("代码已复制"),
          () => toast("复制失败，请展开代码手动选择", "warn")
        );
      } else if (action === "download") {
        const blob = new Blob([item.code], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = item.fileName || (item.language === "html" ? "page.html" : "code.txt");
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else if (action === "wrap") {
        const box = codeAction.closest("[data-code-box]");
        box?.classList.toggle("wrap");
        codeAction.textContent = box?.classList.contains("wrap") ? "不换行" : "换行";
      }
      return;
    }
    const target = event.target.closest("[data-action]");
    if (!target) {
      if (!event.target.closest("#access-popover") && !event.target.closest("#access-mode-btn")) {
        $("#access-popover")?.classList.add("hidden");
      }
      return;
    }
    const action = target.dataset.action;
    const id = target.dataset.id;
    if (action === "set-approval-mode") { setApprovalMode(target.dataset.mode); return; }
    if (action === "modal-close") { closeModal(); return; }
    if (action === "assistant-switch") { switchAssistant(id); return; }
    if (action === "quick-prompt") { sendMessage(target.dataset.prompt); return; }
    if (action === "session-open") { openSession(id); return; }
    if (action === "session-delete") { event.stopPropagation(); deleteSession(id); return; }
    if (action === "session-fork") { event.stopPropagation(); forkSession(id); return; }
    if (action === "session-rename") { event.stopPropagation(); renameSession(id); return; }
    if (action === "message-edit") { editMessage(Number(id)); return; }
    if (action === "message-delete") { deleteMessage(Number(id)); return; }
    if (action === "message-fork") { forkSession(state.activeSessionId, Number(id)); return; }
    if (action === "approval-approve") { handleApproval(id, true); return; }
    if (action === "approval-reject") { handleApproval(id, false); return; }
    if (action === "attach-remove") { removeAttachment(Number(target.dataset.index)); return; }
    if (action === "artifact-close") { closeArtifactModal(); return; }
    if (action === "artifact-save") { saveArtifactImage(target); return; }
    if (action === "publications-open") { openPublishedPages(); return; }
    if (action === "publications-reload") { loadPublicationsPage(); return; }
    if (action === "publications-prev" || action === "publications-next") {
      publicationsView.offset = Math.max(0, publicationsView.offset + (action.endsWith("prev") ? -12 : 12));
      loadPublicationsPage(); return;
    }
    if (action === "publication-detail") { openPublicationDetail(id); return; }
    if (action === "publication-preview" || action === "publication-code") { publicationsView.view = action === "publication-code" ? "code" : "preview"; renderPublicationDetail(); return; }
    if (action === "publication-download") { downloadPublication(); return; }
    if (action === "publication-update") { updatePublicationFromLibrary(); return; }
    if (action === "publication-session") { const sessionId = publicationsView.detail?.session_id; closeModal(); if (sessionId) openSession(sessionId); return; }
    if (action === "artifact-publish-open") { openArtifactPublishPanel(); return; }
    if (action === "artifact-publish-close") { $("#artifact-publish-panel").classList.add("hidden"); return; }
    if (action === "artifact-copy-url") {
      const url = target.dataset.url || "";
      if (!url) return;
      navigator.clipboard?.writeText(url).then(
        () => toast("链接已复制"),
        () => toast("复制失败，请手动选择链接", "warn")
      );
      return;
    }
    if (action === "device-edit") { openDeviceModal(state.devices.find((item) => Number(item.id) === Number(id))); return; }
    if (action === "device-delete") { deleteDevice(state.devices.find((item) => Number(item.id) === Number(id))); return; }
    handleConfigAction(action, target);
  }

  function handleGlobalChange(event) {
    if (event.target.matches("[data-session-filter]")) {
      const key = event.target.dataset.sessionFilter;
      state.sessionFilter[key] = key === "days" ? Number(event.target.value) : event.target.value;
      loadConfigTab("sessions");
      return;
    }
    if (event.target.matches("[data-tool-name]")) {
      const name = event.target.dataset.toolName;
      if (event.target.checked) state.selectedTools.add(name);
      else state.selectedTools.delete(name);
      saveToolSelection();
      renderToolPopover();
      renderContextRail();
      return;
    }
    handleConfigChange(event);
  }

  boot();
})();
