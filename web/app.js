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
    sending: false,
    approvalLoading: new Set(),
    lastBudget: null,
    contextInfo: null,
    memoryCount: 0,
    configTab: "providers",
    config: {
      providers: [],
      models: [],
      assistants: [],
      tools: [],
      skills: [],
      users: [],
      audit: [],
      agentAudit: [],
      settings: null,
    },
    devices: [],
    deviceFilter: { q: "", status: "" },
    deviceTimer: null,
  };

  let healthTimer = null;
  let modalTarget = null;

  const PERMISSION_LABELS = {
    "profile:read": "身份读取",
    "device:read": "设备查询",
    "device:create": "设备新增",
    "device:update": "设备修改",
    "device:delete": "设备删除",
    "user:manage": "用户管理",
  };
  const RISK_LABELS = { read: "读取", write: "写入", delete: "删除" };
  const MODE_LABELS = { agent: "多步", report: "单步报告" };

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

  /* ---------- Markdown (escape first, then a small safe subset) ---------- */
  function renderMarkdown(raw) {
    if (!raw) return "";
    const codeBlocks = [];
    let text = String(raw).replace(/```([\w+-]*)\n?([\s\S]*?)```/g, (_m, lang, code) => {
      codeBlocks.push({ lang, code });
      return `\n@@CODEBLOCK_${codeBlocks.length - 1}@@\n`;
    });
    text = escapeHtml(text);
    text = text.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    text = text.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, url) => {
      const safeUrl = /^https?:\/\//i.test(url) || url.startsWith("/") ? url : "#";
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });

    const lines = text.split("\n");
    const html = [];
    let paragraph = [];
    let listType = null;

    const flushParagraph = () => {
      if (!paragraph.length) return;
      html.push(`<p>${paragraph.join("<br>")}</p>`);
      paragraph = [];
    };
    const closeList = () => {
      if (!listType) return;
      html.push(`</${listType}>`);
      listType = null;
    };
    const openList = (type) => {
      if (listType === type) return;
      closeList();
      html.push(`<${type}>`);
      listType = type;
    };

    for (const line of lines) {
      const trimmed = line.trim();
      const codeMatch = trimmed.match(/^@@CODEBLOCK_(\d+)@@$/);
      if (codeMatch) {
        flushParagraph();
        closeList();
        const block = codeBlocks[Number(codeMatch[1])];
        html.push(`<pre><code>${escapeHtml(block.code.replace(/\n$/, ""))}</code></pre>`);
        continue;
      }
      if (!trimmed) { flushParagraph(); closeList(); continue; }
      if (/^#{1,3}\s+/.test(trimmed)) {
        flushParagraph();
        closeList();
        const level = trimmed.match(/^#+/)[0].length;
        html.push(`<h${level}>${trimmed.replace(/^#{1,3}\s+/, "")}</h${level}>`);
        continue;
      }
      if (/^[-*]\s+/.test(trimmed)) {
        flushParagraph();
        openList("ul");
        html.push(`<li>${trimmed.replace(/^[-*]\s+/, "")}</li>`);
        continue;
      }
      if (/^\d+\.\s+/.test(trimmed)) {
        flushParagraph();
        openList("ol");
        html.push(`<li>${trimmed.replace(/^\d+\.\s+/, "")}</li>`);
        continue;
      }
      if (/^&gt;\s+/.test(trimmed)) {
        flushParagraph();
        closeList();
        html.push(`<blockquote>${trimmed.replace(/^&gt;\s+/, "")}</blockquote>`);
        continue;
      }
      closeList();
      paragraph.push(trimmed);
    }
    flushParagraph();
    closeList();
    return html.join("");
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
    renderContextRail();
    loadHealth();
    if (healthTimer) window.clearInterval(healthTimer);
    healthTimer = window.setInterval(loadHealth, 30000);
    switchPage("ai");
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
    if (results[1].status === "fulfilled") state.models = results[1].value.items || [];
    else failures += 1;
    if (results[2].status === "fulfilled") state.skills = results[2].value.items || [];
    else failures += 1;
    if (results[3].status === "fulfilled") {
      state.status = results[3].value;
      state.demoMode = Boolean(results[3].value.demo_mode);
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
    const root = $("#assistant-cards");
    if (!root) return;
    root.innerHTML = state.assistants.map((item) => `
      <button type="button" class="assistant-card ${Number(item.id) === Number(state.assistantId) ? "active" : ""}" data-action="assistant-switch" data-id="${item.id}">
        <span class="assistant-card-head"><span>${escapeHtml(item.icon || "✦")}</span>${escapeHtml(item.name)}</span>
        <p>${escapeHtml(item.description || "通用业务助手")}</p>
        <span class="card-mode">${escapeHtml(MODE_LABELS[item.mode] || item.mode)}${item.model_name ? ` · ${escapeHtml(item.model_name)}` : ""}</span>
      </button>`).join("");
    $("#welcome-title").textContent = assistant ? assistant.name : "有什么我能帮你的吗？";
    $("#welcome-subtitle").textContent = assistant?.greeting
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
    if (assistant?.mode === "report") {
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
  }

  function changeModel(value) {
    const model = state.models.find((item) => Number(item.id) === Number(value));
    if (!model) return;
    state.modelId = Number(model.id);
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
    const available = new Set(state.tools.map((tool) => tool.name));
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(key) || "null"); } catch { stored = null; }
    if (Array.isArray(stored)) {
      state.selectedTools = new Set(stored.filter((name) => available.has(name)));
      if (!state.selectedTools.size && state.tools.length) state.selectedTools = new Set(available);
    } else {
      state.selectedTools = new Set(available);
    }
    renderToolPopover();
    renderContextRail();
    updateSendState();
  }

  function saveToolSelection() {
    if (!state.user) return;
    const key = `wa_tools_${state.user.username}_${state.assistantId || "none"}`;
    localStorage.setItem(key, JSON.stringify([...state.selectedTools]));
  }

  function renderToolPopover() {
    const list = $("#tool-popover-list");
    if (!list) return;
    if (!state.tools.length) {
      list.innerHTML = '<div class="mini-empty" style="padding:18px">当前助手没有可用工具，请联系管理员检查助手配置或账号权限。</div>';
    } else {
      list.innerHTML = state.tools.map((tool) => {
        const checked = state.selectedTools.has(tool.name);
        return `
          <label class="tool-option ${checked ? "" : "off"}">
            <input type="checkbox" data-tool-name="${escapeHtml(tool.name)}" ${checked ? "checked" : ""}>
            <span class="tool-option-body">
              <span class="tool-option-title">
                <strong>${escapeHtml(tool.name)}</strong>
                <span class="risk-badge ${escapeHtml(tool.risk)}">${escapeHtml(RISK_LABELS[tool.risk] || tool.risk)}</span>
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
        localStorage.setItem(`wa_session_${state.user.username}`, session.id);
        renderConversationList();
        renderChat();
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
  }

  async function loadMessages(sessionId) {
    try {
      const data = await api(`/api/agent/sessions/${encodeURIComponent(sessionId)}/messages`);
      state.messages = data.items || [];
      const session = state.sessions.find((item) => item.id === sessionId);
      if (session && data.session) {
        session.title = data.session.title;
        session.message_count = data.session.message_count;
      }
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
          <button class="conv-item ${session.id === state.activeSessionId ? "active" : ""}" data-action="session-open" data-id="${escapeHtml(session.id)}">
            <span class="conv-title">${escapeHtml(session.title || "新对话")}</span>
            <span class="conv-meta">${formatRelative(session.updated_at)} · ${session.message_count || 0} 条</span>
            <span class="conv-del" data-action="session-delete" data-id="${escapeHtml(session.id)}" title="删除会话">×</span>
          </button>`).join("")
      : '<div class="conv-empty">这个助手还没有对话<br>直接提问就会开始</div>';
  }

  function renderChat() {
    const hasMessages = state.messages.length > 0;
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
    if (state.sending) {
      messagesRoot.insertAdjacentHTML("beforeend", `
        <div class="message assistant">
          <div class="msg-avatar">AI</div>
          <div class="msg-body">
            <div class="msg-meta"><strong>${escapeHtml(assistant?.name || "Agent")}</strong><span>正在处理</span></div>
            <div class="typing"><span></span><span></span><span></span></div>
          </div>
        </div>`);
    }
    requestAnimationFrame(() => {
      const scroll = $("#chat-scroll");
      if (scroll) scroll.scrollTop = scroll.scrollHeight;
    });
  }

  function renderMessage(message) {
    const meta = message.metadata || {};
    if (message.role === "user") {
      const attachments = Array.isArray(message.attachments) ? message.attachments : [];
      return `
        <div class="message user">
          <div class="msg-avatar">${escapeHtml(initials(state.user))}</div>
          <div class="msg-body">
            <div class="msg-meta"><span>${formatRelative(message.created_at)}</span><strong>你</strong></div>
            <div class="msg-content">${renderMarkdown(message.content)}</div>
            ${attachments.length ? `<div class="msg-attachments">${attachments.map((item) => `<span class="card-tag">${escapeHtml(item.name)}</span>`).join("")}</div>` : ""}
          </div>
        </div>`;
    }
    const modelName = meta.model?.name || selectedModel()?.name || "Agent";
    const runs = Array.isArray(message.tool_runs) ? message.tool_runs : [];
    const approval = meta.approval && !meta.approval_status ? meta.approval : null;
    return `
      <div class="message assistant">
        <div class="msg-avatar">${escapeHtml((meta.assistant?.icon) || "AI")}</div>
        <div class="msg-body">
          <div class="msg-meta">
            <strong>${escapeHtml(meta.assistant?.name || currentAssistant()?.name || "Agent")}</strong>
            <span>${escapeHtml(modelName)}</span>
            ${meta.status === "error" ? '<span class="badge badge-red">失败</span>' : ""}
          </div>
          ${message.content ? `<div class="msg-content">${renderMarkdown(message.content)}</div>` : ""}
          ${runs.length ? `<div class="tool-run-list">${runs.map(renderToolRun).join("")}</div>` : ""}
          ${approval ? renderApproval(approval) : ""}
          ${meta.context?.compressed ? `<div class="msg-context-note">上下文已压缩：${meta.context.summarized_messages} 条历史已摘要</div>` : ""}
        </div>
      </div>`;
  }

  function renderToolRun(run) {
    const risk = run.risk || "write";
    const iconName = risk === "read" ? "eye" : risk === "delete" ? "trash" : "edit";
    const status = run.status || "ok";
    const statusLabel = { ok: "完成", error: "失败", pending: "等待审批", rejected: "已取消" }[status] || status;
    const resultText = run.result !== null && run.result !== undefined
      ? prettyJson(run.result, run.result_text || "")
      : (run.result_text || "");
    return `
      <div class="tool-run">
        <div class="tool-run-head">
          <span class="tool-kind ${escapeHtml(risk)}">${icon(iconName, 13)}</span>
          <span class="tool-run-name">${escapeHtml(run.tool)}</span>
          <span class="risk-badge ${escapeHtml(risk)}">${escapeHtml(RISK_LABELS[risk] || risk)}</span>
          <span class="tool-run-summary">${escapeHtml(run.summary || "")}</span>
          <span class="run-status ${escapeHtml(status)}">${statusLabel}</span>
        </div>
        <details class="run-details">
          <summary>查看调用参数与结果</summary>
          <div class="run-details-body">
            <div class="run-result-label">参数</div>
            <pre class="run-args">${escapeHtml(prettyJson(run.arguments || {}))}</pre>
            <div class="run-result-label">结果</div>
            <pre class="run-result">${escapeHtml(resultText || (status === "pending" ? "等待用户审批后执行" : "无返回内容"))}</pre>
          </div>
        </details>
      </div>`;
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
    renderChat();
    updateSendState();
    try {
      const data = await api("/api/agent/chat", {
        method: "POST",
        body: {
          message: text,
          session_id: state.activeSessionId,
          assistant_id: state.assistantId,
          model_row_id: state.modelId,
          enabled_tools: [...state.selectedTools],
          attachments,
        },
      });
      state.demoMode = Boolean(data.demo_mode);
      if (data.model?.id) state.modelId = Number(data.model.id);
      state.lastBudget = data.budget || null;
      state.contextInfo = data.context || null;
      state.attachments = [];
      renderAttachments();
      await loadMessages(state.activeSessionId);
      await loadSessions();
      renderConversationList();
      renderChat();
      renderContextRail();
      updateDemoBadge();
    } catch (error) {
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
    const remaining = 4 - state.attachments.length;
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
      reader.onload = () => {
        state.attachments.push({
          name: file.name,
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

  /* ---------- Context rail ---------- */
  function renderContextRail() {
    const model = selectedModel();
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
    const assistant = currentAssistant();
    const skillRoot = $("#context-skill-list");
    if (skillRoot) {
      const wanted = assistant?.skill_ids || [];
      const skills = wanted.length ? state.skills.filter((skill) => wanted.includes(Number(skill.id))) : state.skills;
      skillRoot.innerHTML = skills.length
        ? skills.map((skill) => `<div class="mini-item on">${escapeHtml(skill.name)}</div>`).join("")
        : '<div class="mini-empty">暂无启用技能</div>';
    }
    const budget = state.lastBudget || {};
    const budgetRoot = $("#context-budget");
    if (budgetRoot) {
      const cells = [
        ["推理轮次", assistant?.max_steps || state.status?.max_iterations || budget.max_steps || 6],
        ["工具调用", assistant?.max_tool_calls || state.status?.max_tool_calls || budget.max_tool_calls || 12],
        ["运行超时", `${assistant?.max_run_seconds || state.status?.max_run_seconds || budget.max_run_seconds || 120}s`],
        ["上下文", `${Math.round((state.contextInfo?.context_tokens || 0) / 1000)}k / ${Math.round((state.contextInfo?.budget_tokens || assistant?.context_max_tokens || state.status?.context_max_tokens || 32000) / 1000)}k`],
      ];
      budgetRoot.innerHTML = cells.map(([label, value]) => `<div class="budget-cell"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
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
    const root = $("#modal-root");
    root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal ${options.wide ? "wide" : ""}" role="dialog" aria-modal="true">${html}</div>
      </div>`;
    modalTarget = root.firstElementChild;
    modalTarget.addEventListener("click", (event) => {
      if (event.target === modalTarget) closeModal();
    });
    const onKey = (event) => {
      if (event.key === "Escape") {
        closeModal();
        document.removeEventListener("keydown", onKey);
      }
    };
    document.addEventListener("keydown", onKey);
    return root;
  }

  function closeModal() {
    const root = $("#modal-root");
    if (root) root.innerHTML = "";
    modalTarget = null;
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

  /* ---------- Config page ---------- */
  async function loadConfigPage(force = false) {
    const guest = $("#config-guest");
    const admin = $("#config-admin");
    if (!state.user?.is_admin) {
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
    state.configTab = tab;
    $$("#config-nav .config-nav-item").forEach((button) => {
      button.classList.toggle("active", button.dataset.tab === tab);
    });
    await loadConfigTab(tab, force);
  }

  async function loadConfigTab(tab, force = false) {
    const content = $("#config-content");
    content.innerHTML = '<div class="empty-config">正在加载…</div>';
    try {
      if (tab === "providers") {
        const data = await api("/api/agent/admin/providers");
        state.config.providers = data.items || [];
        renderProviders();
      } else if (tab === "models") {
        const [models, providers] = await Promise.all([
          api("/api/agent/admin/models"),
          api("/api/agent/admin/providers"),
        ]);
        state.config.models = models.items || [];
        state.config.providers = providers.items || [];
        renderModels();
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
        const data = await api("/api/agent/admin/tools");
        state.config.tools = data.items || [];
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
      } else if (tab === "settings") {
        const data = await api("/api/agent/config");
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

  /* ----- Providers ----- */
  function renderProviders() {
    const items = state.config.providers;
    $("#config-content").innerHTML = `
      ${sectionHead("模型供应商", "只接入 OpenAI 兼容协议，一个适配器覆盖 OpenAI、DeepSeek、通义、Moonshot、vLLM 等服务。", `
        <span class="count-pill">${items.length} 个</span>
        <button class="primary-btn" data-action="provider-new">${icon("plus", 14)} 新增供应商</button>`)}
      <div class="list-panel">${items.length ? items.map((item) => `
        <div class="list-row ${item.enabled ? "" : "off"}">
          <span class="assistant-icon">${icon("server", 14)}</span>
          <div class="list-row-main">
            <div class="list-row-title">
              <strong>${escapeHtml(item.name)}</strong>
              <code>${escapeHtml(item.base_url)}</code>
              ${item.enabled ? '<span class="badge badge-green">启用</span>' : '<span class="badge">停用</span>'}
              ${item.api_key_set ? '<span class="badge badge-blue">密钥已存</span>' : '<span class="badge badge-warn">缺少密钥</span>'}
            </div>
            <p>${escapeHtml(item.api_key_masked || "未配置 API Key")} · 超时 ${item.timeout_seconds}s</p>
            <div class="list-row-meta">
              <span>${item.model_count} 个模型</span>
              <span>${escapeHtml(item.provider_type)}</span>
              <span>${escapeHtml(Object.keys(item.extra_headers || {}).join(", ") || "无附加 Header")}</span>
            </div>
          </div>
          <div class="list-row-actions">
            <button class="ghost-btn" data-action="provider-test" data-id="${item.id}">测试连接</button>
            <button class="ghost-btn" data-action="provider-discover" data-id="${item.id}">拉取模型</button>
            <button class="mini-action" data-action="provider-edit" data-id="${item.id}" title="编辑">${icon("edit", 12)}</button>
            <button class="mini-action danger" data-action="provider-delete" data-id="${item.id}" title="删除">${icon("trash", 12)}</button>
          </div>
        </div>`).join("") : '<div class="empty-config">还没有供应商，先添加一个 OpenAI 兼容服务。</div>'}</div>`;
  }

  function providerById(id) {
    return state.config.providers.find((item) => Number(item.id) === Number(id));
  }

  function openProviderModal(provider = null) {
    const editing = Boolean(provider);
    openModal(`
      <div class="modal-head">
        <div><h3>${editing ? "编辑供应商" : "新增供应商"}</h3><p>API Key 只保存在 Agent 服务端，浏览器拿到的始终是掩码。</p></div>
        <button class="icon-btn" data-action="modal-close">${icon("x")}</button>
      </div>
      <form id="provider-form" class="modal-body">
        <div class="form-grid">
          <label class="field"><span>名称</span><input name="name" value="${escapeHtml(provider?.name || "")}" placeholder="DeepSeek" required></label>
          <label class="field"><span>协议</span><input value="OpenAI Compatible" disabled></label>
          <label class="field span-2"><span>Base URL</span><input name="base_url" value="${escapeHtml(provider?.base_url || "")}" placeholder="https://api.deepseek.com/v1" required></label>
          <label class="field span-2"><span>API Key ${editing ? "（留空表示不修改）" : ""}</span><input name="api_key" type="password" value="" placeholder="${editing && provider?.api_key_set ? "已配置，留空保持不变" : "sk-..."}" autocomplete="new-password"></label>
          <label class="field"><span>超时（秒）</span><input name="timeout_seconds" type="number" min="3" max="180" value="${provider?.timeout_seconds ?? 90}"></label>
          <label class="field"><span>附加 Header（JSON）</span><input name="extra_headers" value="${escapeHtml(JSON.stringify(provider?.extra_headers || {}))}"></label>
          <label class="field span-2"><span>状态</span>
            <select name="enabled">
              <option value="1" ${provider?.enabled !== false ? "selected" : ""}>启用</option>
              <option value="0" ${provider?.enabled === false ? "selected" : ""}>停用</option>
            </select>
          </label>
        </div>
        <div class="modal-foot" style="padding:0">
          <button type="button" class="ghost-btn" data-action="modal-close">取消</button>
          <button type="submit" class="primary-btn">${editing ? "保存" : "创建"}</button>
        </div>
      </form>`, { wide: true });
    $("#provider-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.target;
      let headers = {};
      try {
        headers = JSON.parse(form.extra_headers.value || "{}");
      } catch {
        toast("附加 Header 必须是 JSON 对象", "warn");
        return;
      }
      const payload = {
        name: form.elements.namedItem("name").value.trim(),
        base_url: form.base_url.value.trim(),
        extra_headers: headers,
        timeout_seconds: Number(form.timeout_seconds.value) || 90,
        enabled: form.enabled.value === "1",
      };
      if (form.api_key.value.trim()) payload.api_key = form.api_key.value.trim();
      try {
        if (editing) {
          await api(`/api/agent/admin/providers/${provider.id}`, { method: "PUT", body: payload });
          toast("供应商已更新");
        } else {
          await api("/api/agent/admin/providers", { method: "POST", body: payload });
          toast("供应商已创建");
        }
        closeModal();
        await loadConfigTab("providers");
      } catch (error) {
        toast(error.message, "error");
      }
    });
  }

  async function testProvider(id, button) {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "测试中…";
    try {
      const data = await api(`/api/agent/admin/providers/${id}/test`, { method: "POST" });
      toast(data.message, data.ok ? "ok" : "error", 5000);
    } catch (error) {
      toast(error.message, "error", 5000);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  async function openDiscoverModal(provider) {
    openModal(`
      <div class="modal-head">
        <div><h3>拉取模型</h3><p>${escapeHtml(provider.name)} · ${escapeHtml(provider.base_url)}</p></div>
        <button class="icon-btn" data-action="modal-close">${icon("x")}</button>
      </div>
      <div class="modal-body"><div class="empty-config">正在读取供应商模型列表…</div></div>`, { wide: true });
    try {
      const data = await api(`/api/agent/admin/providers/${provider.id}/discover-models`);
      const items = data.items || [];
      openModal(`
        <div class="modal-head">
          <div><h3>拉取模型</h3><p>${escapeHtml(provider.name)} · 共 ${items.length} 个模型，已导入的会标记。</p></div>
          <button class="icon-btn" data-action="modal-close">${icon("x")}</button>
        </div>
        <form id="import-form" class="modal-body">
          <div class="import-list">
            ${items.map((item) => `
              <label class="import-row">
                <input type="checkbox" name="model_ids" value="${escapeHtml(item.model_id)}" ${item.already_imported ? "disabled" : ""}>
                <code>${escapeHtml(item.model_id)}</code>
                <small>${escapeHtml(item.owned_by || "")}${item.already_imported ? " · 已导入" : ""}</small>
              </label>`).join("")}
          </div>
          <div class="modal-foot" style="padding:14px 0 0">
            <button type="button" class="ghost-btn" data-action="modal-close">取消</button>
            <button type="submit" class="primary-btn">导入所选模型</button>
          </div>
        </form>`, { wide: true });
      $("#import-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const selected = $$('input[name="model_ids"]:checked', event.target).map((item) => item.value);
        if (!selected.length) {
          toast("请选择要导入的模型", "warn");
          return;
        }
        try {
          const result = await api(`/api/agent/admin/providers/${provider.id}/import-models`, {
            method: "POST",
            body: { model_ids: selected },
          });
          toast(`已导入 ${result.imported.length} 个模型，跳过 ${result.skipped.length} 个`);
          closeModal();
          await loadConfigTab("providers");
        } catch (error) {
          toast(error.message, "error", 5000);
        }
      });
    } catch (error) {
      openModal(`
        <div class="modal-head"><div><h3>拉取失败</h3><p>${escapeHtml(error.message)}</p></div>
        <button class="icon-btn" data-action="modal-close">${icon("x")}</button></div>
        <div class="modal-foot"><button class="ghost-btn" data-action="modal-close">关闭</button></div>`);
    }
  }

  /* ----- Models ----- */
  function renderModels() {
    const items = state.config.models;
    $("#config-content").innerHTML = `
      ${sectionHead("模型", "设置上下文窗口、输出上限、采样参数、图像能力和额外请求参数。", `
        <span class="count-pill">${items.length} 个</span>
        <button class="primary-btn" data-action="model-new">${icon("plus", 14)} 新增模型</button>`)}
      <div class="list-panel">${items.length ? items.map((item) => `
        <div class="list-row ${item.enabled && item.provider_enabled ? "" : "off"}">
          <span class="assistant-icon">${icon("brain", 14)}</span>
          <div class="list-row-main">
            <div class="list-row-title">
              <strong>${escapeHtml(item.name)}</strong>
              <code>${escapeHtml(item.model_id)}</code>
              ${item.is_default ? '<span class="badge badge-green">默认</span>' : ""}
              ${item.supports_tools ? '<span class="badge badge-blue">工具</span>' : '<span class="badge">无工具</span>'}
              ${(item.capabilities || []).includes("image") ? '<span class="badge badge-blue">图像</span>' : ""}
            </div>
            <p>供应商：${escapeHtml(item.provider_name || "—")} · 温度 ${item.temperature} · top_p ${item.top_p}</p>
            <div class="list-row-meta">
              <span>上下文 ${item.context_window || 0}</span>
              <span>输出 ${item.max_output_tokens || 0}</span>
              <span>${Object.keys(item.extra_params || {}).length} 个额外参数</span>
            </div>
          </div>
          <div class="list-row-actions">
            <button class="ghost-btn" data-action="model-test" data-id="${item.id}">测试</button>
            <button class="mini-action" data-action="model-edit" data-id="${item.id}" title="编辑">${icon("edit", 12)}</button>
            <button class="mini-action danger" data-action="model-delete" data-id="${item.id}" title="删除">${icon("trash", 12)}</button>
          </div>
        </div>`).join("") : '<div class="empty-config">还没有模型。先在供应商页拉取，或手动新增。</div>'}</div>`;
  }

  function openModelModal(model = null) {
    const editing = Boolean(model);
    if (!state.config.providers.length) {
      toast("请先添加供应商", "warn");
      return;
    }
    const capabilities = model?.capabilities || ["text"];
    openModal(`
      <div class="modal-head">
        <div><h3>${editing ? "编辑模型" : "新增模型"}</h3><p>模型参数会覆盖全局默认值；额外参数直接合并进请求体。</p></div>
        <button class="icon-btn" data-action="modal-close">${icon("x")}</button>
      </div>
      <form id="model-form" class="modal-body">
        <div class="form-grid">
          <label class="field"><span>供应商</span>
            <select name="provider_id">${state.config.providers.map((provider) => `<option value="${provider.id}" ${Number(model?.provider_id) === Number(provider.id) ? "selected" : ""}>${escapeHtml(provider.name)}</option>`).join("")}</select>
          </label>
          <label class="field"><span>显示名称</span><input name="name" value="${escapeHtml(model?.name || "")}" placeholder="DeepSeek Chat" required></label>
          <label class="field span-2"><span>模型 ID</span><input name="model_id" value="${escapeHtml(model?.model_id || "")}" placeholder="deepseek-chat" required></label>
          <label class="field"><span>上下文窗口</span><input name="context_window" type="number" min="0" value="${model?.context_window ?? 32768}"></label>
          <label class="field"><span>最大输出</span><input name="max_output_tokens" type="number" min="0" value="${model?.max_output_tokens ?? 8192}"></label>
          <label class="field"><span>temperature</span><input name="temperature" type="number" step="0.1" min="0" max="2" value="${model?.temperature ?? 0.3}"></label>
          <label class="field"><span>top_p</span><input name="top_p" type="number" step="0.05" min="0" max="1" value="${model?.top_p ?? 1}"></label>
          <label class="field span-2"><span>额外请求参数（JSON）</span><input name="extra_params" value="${escapeHtml(JSON.stringify(model?.extra_params || {}))}" placeholder='{"reasoning_effort":"low"}'></label>
          <div class="field span-2"><span>能力</span>
            <div class="check-grid">
              <label><input type="checkbox" name="capabilities" value="text" ${capabilities.includes("text") ? "checked" : ""}> <code>text</code> 文本</label>
              <label><input type="checkbox" name="capabilities" value="image" ${capabilities.includes("image") ? "checked" : ""}> <code>image</code> 图像理解</label>
              <label><input type="checkbox" name="supports_tools" ${model?.supports_tools !== false ? "checked" : ""}> 支持工具调用</label>
              <label><input type="checkbox" name="is_default" ${model?.is_default ? "checked" : ""}> 设为默认模型</label>
              <label><input type="checkbox" name="enabled" ${model?.enabled !== false ? "checked" : ""}> 启用模型</label>
            </div>
          </div>
        </div>
        <div class="modal-foot" style="padding:0">
          <button type="button" class="ghost-btn" data-action="modal-close">取消</button>
          <button type="submit" class="primary-btn">${editing ? "保存" : "创建"}</button>
        </div>
      </form>`, { wide: true });
    $("#model-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.target;
      let extra = {};
      try {
        extra = JSON.parse(form.extra_params.value || "{}");
      } catch {
        toast("额外请求参数必须是 JSON 对象", "warn");
        return;
      }
      const payload = {
        provider_id: Number(form.provider_id.value),
        name: form.elements.namedItem("name").value.trim(),
        model_id: form.model_id.value.trim(),
        context_window: Number(form.context_window.value) || 0,
        max_output_tokens: Number(form.max_output_tokens.value) || 0,
        temperature: Number(form.temperature.value),
        top_p: Number(form.top_p.value),
        extra_params: extra,
        capabilities: $$('input[name="capabilities"]:checked', form).map((item) => item.value),
        supports_tools: form.supports_tools.checked,
        is_default: form.is_default.checked,
        enabled: form.enabled.checked,
      };
      if (!payload.capabilities.length) payload.capabilities = ["text"];
      try {
        if (editing) {
          await api(`/api/agent/admin/models/${model.id}`, { method: "PUT", body: payload });
          toast("模型已更新");
        } else {
          await api("/api/agent/admin/models", { method: "POST", body: payload });
          toast("模型已创建");
        }
        closeModal();
        await loadConfigTab("models");
      } catch (error) {
        toast(error.message, "error");
      }
    });
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
    const models = state.config.models;
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
          <div class="field span-2"><span>技能</span>
            <div class="check-grid">
              ${skills.map((skill) => `<label><input type="checkbox" name="skill_ids" value="${skill.id}" ${selectedSkills.has(Number(skill.id)) ? "checked" : ""}> ${escapeHtml(skill.name)}</label>`).join("")}
              ${skills.length ? "" : '<span class="check-note">暂无技能</span>'}
            </div>
          </div>
          <label class="field"><span>最大推理轮次（0 = 全局）</span><input name="max_steps" type="number" min="0" max="12" value="${data.max_steps || 0}"></label>
          <label class="field"><span>最大工具调用（0 = 全局）</span><input name="max_tool_calls" type="number" min="0" max="50" value="${data.max_tool_calls || 0}"></label>
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
    $("#config-content").innerHTML = `
      ${sectionHead("MCP 工具", "这里是全局开关。用户实际可用工具 = 账号权限 ∩ 助手白名单 ∩ 全局开关 ∩ 本轮勾选。", `
        <span class="count-pill">${data.enabled_count}/${data.total}</span>`)}
      ${Object.entries(groups).map(([category, tools]) => `
        <div class="tool-group">
          <div class="tool-group-head"><strong>${escapeHtml(category)}</strong><span>${tools.length} 个</span></div>
          <div class="list-panel">
            ${tools.map((tool) => `
              <div class="list-row ${tool.enabled ? "" : "off"}">
                <span class="assistant-icon">${icon(tool.risk === "read" ? "eye" : tool.risk === "delete" ? "trash" : "edit", 13)}</span>
                <div class="list-row-main">
                  <div class="list-row-title"><strong>${escapeHtml(tool.name)}</strong><span class="risk-badge ${escapeHtml(tool.risk)}">${escapeHtml(RISK_LABELS[tool.risk] || tool.risk)}</span></div>
                  <p>${escapeHtml(tool.description)}</p>
                  <div class="list-row-meta"><span>${escapeHtml(tool.permission)}</span></div>
                </div>
                <div class="list-row-actions">
                  <label class="switch"><input type="checkbox" data-config-toggle="tool" data-name="${escapeHtml(tool.name)}" ${tool.enabled ? "checked" : ""}><span class="switch-track"></span></label>
                </div>
              </div>`).join("")}
          </div>
        </div>`).join("")}`;
  }

  /* ----- Skills ----- */
  function renderSkillsConfig() {
    const items = state.config.skills;
    $("#config-content").innerHTML = `
      ${sectionHead("技能", "技能会作为规范或知识注入系统提示词，由助手选择启用。", `
        <span class="count-pill">${items.length} 个</span>
        <button class="primary-btn" data-action="skill-new">${icon("plus", 14)} 新增技能</button>`)}
      <div class="list-panel">${items.length ? items.map((item) => `
        <div class="list-row ${item.enabled ? "" : "off"}">
          <span class="assistant-icon">${icon("book", 13)}</span>
          <div class="list-row-main">
            <div class="list-row-title"><strong>${escapeHtml(item.name)}</strong></div>
            <p>${escapeHtml(item.description || "未填写描述")}</p>
            <div class="list-row-meta"><span>${escapeHtml(truncate(item.content.replace(/\s+/g, " "), 90))}</span></div>
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
    openModal(`
      <div class="modal-head">
        <div><h3>${editing ? "编辑技能" : "新增技能"}</h3><p>技能内容会直接拼进系统提示词，建议写清规则而不是长篇资料。</p></div>
        <button class="icon-btn" data-action="modal-close">${icon("x")}</button>
      </div>
      <form id="skill-form" class="modal-body">
        <div class="form-grid">
          <label class="field span-2"><span>名称</span><input name="name" value="${escapeHtml(skill?.name || "")}" required></label>
          <label class="field span-2"><span>描述</span><input name="description" value="${escapeHtml(skill?.description || "")}"></label>
          <label class="field span-2"><span>内容</span><textarea name="content" required>${escapeHtml(skill?.content || "")}</textarea></label>
        </div>
        <div class="modal-foot" style="padding:0">
          <button type="button" class="ghost-btn" data-action="modal-close">取消</button>
          <button type="submit" class="primary-btn">${editing ? "保存" : "创建"}</button>
        </div>
      </form>`, { wide: true });
    $("#skill-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.target;
      const payload = {
        name: form.elements.namedItem("name").value.trim(),
        description: form.description.value.trim(),
        content: form.content.value.trim(),
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
    $("#config-content").innerHTML = `
      ${sectionHead("运行设置", "全局默认值。助手可以覆盖步数、工具调用、超时和上下文上限。", "")}
      <form id="settings-form" class="settings-grid">
        <section class="panel settings-card">
          <div class="form-grid">
            <label class="field"><span>temperature</span><input name="llm_temperature" type="number" step="0.1" min="0" max="2" value="${config.llm_temperature ?? 0.3}"></label>
            <label class="field"><span>最大推理轮次</span><input name="max_iterations" type="number" min="1" max="12" value="${config.max_iterations ?? 6}"></label>
            <label class="field"><span>最大工具调用</span><input name="max_tool_calls" type="number" min="1" max="50" value="${config.max_tool_calls ?? 12}"></label>
            <label class="field"><span>运行超时（秒）</span><input name="max_run_seconds" type="number" min="10" max="900" value="${config.max_run_seconds ?? 120}"></label>
            <label class="field"><span>上下文上限（tokens）</span><input name="context_max_tokens" type="number" min="4096" value="${config.context_max_tokens ?? 32000}"></label>
            <label class="field"><span>演示模式</span>
              <select name="demo_mode"><option value="1" ${config.demo_mode ? "selected" : ""}>开启（不请求外部 LLM）</option><option value="0" ${!config.demo_mode ? "selected" : ""}>关闭（真实调用）</option></select>
            </label>
            <label class="field span-2"><span>管理员补充提示词</span><textarea name="system_prompt_extra" style="min-height:110px">${escapeHtml(config.system_prompt_extra || "")}</textarea></label>
          </div>
          <div class="check-grid" style="margin-top:4px">
            <label><input type="checkbox" name="context_compression" ${config.context_compression ? "checked" : ""}> 启用上下文压缩</label>
            <label><input type="checkbox" name="memory_enabled" ${config.memory_enabled ? "checked" : ""}> 启用长期记忆</label>
          </div>
          <div class="config-actions">
            <button type="submit" class="primary-btn">保存设置</button>
            <button type="button" class="ghost-btn" data-action="settings-test">测试默认模型</button>
          </div>
          <div id="settings-test-result" class="test-result hidden"></div>
        </section>
        <section class="panel settings-card">
          <div class="settings-note">${icon("shield", 14)}<span>API Key 只存放于 Agent 服务端 SQLite，接口只返回掩码；浏览器和业务系统都拿不到明文。</span></div>
          <div class="settings-note" style="margin-top:10px">${icon("activity", 14)}<span>当前：${config.provider_count || 0} 个供应商 · ${config.model_count || 0} 个模型 · ${config.assistants || 0} 个助手</span></div>
          <div class="inline-switch"><div><strong>上下文压缩</strong><small>超出预算时把较早消息摘要，保留最近对话。</small></div><span class="badge ${config.context_compression ? "badge-green" : ""}">${config.context_compression ? "开启" : "关闭"}</span></div>
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
        context_compression: form.context_compression.checked,
        memory_enabled: form.memory_enabled.checked,
        demo_mode: form.demo_mode.value === "1",
        system_prompt_extra: form.system_prompt_extra.value.trim(),
      };
      try {
        await api("/api/agent/config", { method: "PUT", body: payload });
        toast("运行设置已保存");
        state.demoMode = payload.demo_mode;
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
    if (action === "provider-new") { openProviderModal(); return; }
    if (action === "provider-edit") { openProviderModal(providerById(id)); return; }
    if (action === "provider-test") { testProvider(id, target); return; }
    if (action === "provider-discover") { openDiscoverModal(providerById(id)); return; }
    if (action === "provider-delete") {
      const provider = providerById(id);
      if (!(await confirmDialog({ title: "删除供应商", message: `删除「${provider.name}」？其下有模型时会被拒绝。`, confirmText: "删除", danger: true }))) return;
      try {
        await api(`/api/agent/admin/providers/${id}`, { method: "DELETE" });
        toast("供应商已删除");
        await loadConfigTab("providers");
      } catch (error) { toast(error.message, "error"); }
      return;
    }
    if (action === "model-new") { openModelModal(); return; }
    if (action === "model-edit") {
      openModelModal(state.config.models.find((item) => Number(item.id) === Number(id)));
      return;
    }
    if (action === "model-test") {
      const original = target.textContent;
      target.disabled = true;
      target.textContent = "测试中…";
      try {
        const data = await api(`/api/agent/admin/models/${id}/test`, { method: "POST" });
        toast(data.message, data.ok ? "ok" : "error", 5000);
      } catch (error) { toast(error.message, "error", 5000); }
      finally { target.disabled = false; target.textContent = original; }
      return;
    }
    if (action === "model-delete") {
      if (!(await confirmDialog({ title: "删除模型", message: "删除后使用该模型的助手会回退到默认模型。", confirmText: "删除", danger: true }))) return;
      try {
        await api(`/api/agent/admin/models/${id}`, { method: "DELETE" });
        toast("模型已删除");
        await loadConfigTab("models");
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
    $("#tool-picker-btn").addEventListener("click", () => {
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
  }

  function handleGlobalClick(event) {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    const id = target.dataset.id;
    if (action === "modal-close") { closeModal(); return; }
    if (action === "assistant-switch") { switchAssistant(id); return; }
    if (action === "quick-prompt") { sendMessage(target.dataset.prompt); return; }
    if (action === "session-open") { openSession(id); return; }
    if (action === "session-delete") { event.stopPropagation(); deleteSession(id); return; }
    if (action === "approval-approve") { handleApproval(id, true); return; }
    if (action === "approval-reject") { handleApproval(id, false); return; }
    if (action === "attach-remove") { removeAttachment(Number(target.dataset.index)); return; }
    if (action === "device-edit") { openDeviceModal(state.devices.find((item) => Number(item.id) === Number(id))); return; }
    if (action === "device-delete") { deleteDevice(state.devices.find((item) => Number(item.id) === Number(id))); return; }
    handleConfigAction(action, target);
  }

  function handleGlobalChange(event) {
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
