"""Server-side Agent loop, RBAC-aware tool selection and approval workflow."""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import re
import secrets
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any

import httpx2

from webagent.agent import context as context_planner
from webagent.agent import db, dynamic_tools, pagepilot, publications, sessions, tool_search
from webagent.agent.llm import (
    LLMError,
    build_system_prompt,
    chat_completion,
    generate_title,
    merge_usage,
    openai_tools,
    provider_ready,
    resolve_budget,
    runtime_config,
)
from webagent.agent.mcp_client import (
    ToolExecution,
    ToolSpec,
    call_tool,
    list_tools,
)
from webagent.config import BUSINESS_URL


RISK_LABELS = {"read": "读取", "write": "写入", "delete": "删除"}
DEVICE_STATUSES = ("在线", "离线", "维护中")
APPROVAL_TTL_SECONDS = 600
ACTIVE_SESSIONS: set[str] = set()
BACKGROUND_TASKS: set[asyncio.Task[Any]] = set()


class AgentError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def ensure_session_idle(session_id: str) -> None:
    if session_id in ACTIVE_SESSIONS:
        raise AgentError("该会话仍有后台任务执行中，请等待完成后再操作", 409)


@contextmanager
def session_run(session_id: str | None):
    if not session_id:
        yield
        return
    ensure_session_idle(session_id)
    ACTIVE_SESSIONS.add(session_id)
    try:
        yield
    finally:
        ACTIVE_SESSIONS.discard(session_id)


@dataclass
class AgentContext:
    token: str
    user: dict[str, Any]
    model: dict[str, Any]
    provider: dict[str, Any]
    config: dict[str, Any]
    skills: list[dict[str, Any]]
    all_tools: list[ToolSpec]
    tools: list[ToolSpec]
    global_tool_settings: dict[str, dict[str, Any]]
    requested_tools: list[str] | None
    reasoning_effort: str | None = None
    approval_mode: str = "confirm"
    assistant: dict[str, Any] | None = None
    budget: dict[str, int] = field(default_factory=dict)
    memories: list[dict[str, Any]] = field(default_factory=list)
    skill_tools: list[ToolSpec] = field(default_factory=list)
    session_id: str | None = None
    started_at: float = field(default_factory=time.monotonic)
    steps_used: int = 0
    tool_calls_used: int = 0
    retry_count: int = 0
    overflow_retried: bool = False
    fallback_used: bool = False
    tool_retrieval: dict[str, Any] = field(default_factory=dict)
    had_reasoning: bool = False
    reasoning_text: str = ""
    last_prompt_tokens: int = 0
    emit: Any = None
    last_compaction: dict[str, Any] | None = None

    @property
    def deadline(self) -> float:
        return self.started_at + int(self.budget.get("max_run_seconds", 120))


@dataclass
class PendingApproval:
    id: str
    ctx: AgentContext
    messages: list[dict[str, Any]]
    calls: list[dict[str, Any]]
    tool_runs: list[dict[str, Any]]
    round_count: int
    tool_call_total: int = 0
    usage: dict[str, Any] | None = None
    created_at: float = field(default_factory=time.time)
    expires_at: float = field(default_factory=lambda: time.time() + APPROVAL_TTL_SECONDS)
    mode: str = "llm"


async def identity_from_token(token: str) -> dict[str, Any]:
    try:
        async with httpx2.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{BUSINESS_URL}/api/me",
                headers={"Authorization": f"Bearer {token}"},
            )
    except httpx2.RequestError as exc:
        raise AgentError(f"业务系统不可用：{exc}", 503) from exc
    if response.status_code == 401:
        raise AgentError("登录已失效，请重新登录", 401)
    if response.status_code >= 400:
        raise AgentError("无法校验当前用户身份", 502)
    return response.json()["user"]


def _tool_available(
    spec: ToolSpec,
    user: dict[str, Any],
    global_settings: dict[str, dict[str, Any]],
    requested: list[str] | None,
    assistant_tools: set[str] | None = None,
) -> bool:
    if spec.permission and spec.permission not in user.get("permissions", []):
        return False
    config = global_settings.get(spec.name) or db.default_tool_setting(
        spec.name, spec.source
    )
    if not config.get("enabled", True):
        return False
    if assistant_tools is not None and spec.name not in assistant_tools:
        return False
    visible = bool(config.get("visible", True))
    selectable = bool(config.get("selectable", True))
    default_selected = bool(config.get("default_selected", True))
    if not visible and not default_selected:
        return False
    if not visible:
        return default_selected
    if not selectable:
        return default_selected
    if requested is None:
        return default_selected
    return spec.name in requested


def _skill_tools(skills: list[dict[str, Any]]) -> list[ToolSpec]:
    if not skills:
        return []
    return [
        ToolSpec(
            name="load_skill",
            description=(
                "加载一个技能（Skill）的完整 SKILL.md 正文。"
                "系统提示词只提供技能名称和用途；当某个技能与本轮任务相关时调用。"
                "参数 name 使用技能标识（slug）或名称。"
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "技能标识（slug）或技能名称",
                    }
                },
                "required": ["name"],
            },
            permission="",
            risk="read",
            category="技能",
        ),
        ToolSpec(
            name="read_skill_file",
            description=(
                "读取技能附带的参考文件。必须先 load_skill 再按需读取；"
                "只能读取该技能声明过的文件路径。"
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "技能标识（slug）或技能名称",
                    },
                    "path": {
                        "type": "string",
                        "description": "技能内的参考文件路径",
                    },
                },
                "required": ["name", "path"],
            },
            permission="",
            risk="read",
            category="技能",
        ),
    ]


async def build_context(
    token: str,
    model_row_id: int | None,
    requested_tools: list[str] | None,
    assistant_id: int | None = None,
    *,
    query: str = "",
    reasoning_effort: str | None = None,
    approval_mode: str | None = None,
    user: dict[str, Any] | None = None,
    emit: Any = None,
) -> AgentContext:
    user = user or await identity_from_token(token)
    assistant = None
    if not assistant_id:
        candidates = db.assistants_for_user(user)
        if candidates:
            assistant_id = int(candidates[0]["id"])
    if assistant_id:
        assistant = db.get_assistant(assistant_id)
        if not assistant or not assistant["enabled"]:
            raise AgentError("助手不存在或已被管理员停用", 404)
        allowed_roles = assistant.get("allowed_roles") or ["*"]
        if (
            "*" not in allowed_roles
            and user.get("role") not in allowed_roles
            and user.get("username") not in allowed_roles
        ):
            raise AgentError("当前账号无权使用该助手", 403)

    if assistant and assistant.get("model_row_id"):
        if not assistant.get("allow_model_switch") or not model_row_id:
            model_row_id = int(assistant["model_row_id"])
    model = db.get_model(model_row_id) if model_row_id else db.default_model()
    if model is None:
        raise AgentError("没有可用模型，请先在 AI 配置中添加并启用模型", 400)
    if model_row_id and not model["enabled"]:
        raise AgentError("所选模型已被管理员停用", 400)
    if model.get("model_kind", "chat") not in {"chat", "vision"}:
        raise AgentError("所选模型不能用于对话，请选择对话或视觉模型", 400)
    provider_id = model.get("provider_id")
    if not provider_id:
        raise AgentError("所选模型没有关联供应商", 400)
    provider = db.get_provider(int(provider_id))
    if not provider:
        raise AgentError("所选模型没有关联供应商", 400)
    if not provider["enabled"]:
        raise AgentError("所选模型的供应商已被管理员停用", 400)

    config = runtime_config()
    daily_limit = int(config.get("user_daily_token_limit") or 0)
    if daily_limit > 0:
        used_today = db.user_daily_usage(user["username"])
        if used_today >= daily_limit:
            raise AgentError(
                f"今日 token 用量已达上限（{used_today}/{daily_limit}），"
                "请联系管理员调整额度。",
                429,
            )
    if not config["demo_mode"]:
        ready, reason = provider_ready(provider)
        if not ready:
            raise AgentError(reason, 400)
    skills = db.get_skills(include_disabled=False)
    if assistant and assistant.get("skill_ids"):
        wanted = set(assistant["skill_ids"])
        skills = [skill for skill in skills if int(skill["id"]) in wanted]
    mcp_error = ""
    await _emit_callback(emit, "run.phase", {
        "phase": "tools", "title": "正在发现并授权工具",
    })
    try:
        all_specs = await list_tools(token)
    except Exception as exc:  # noqa: BLE001 - degrade to connector tools
        mcp_error = str(exc)
        all_specs = []
    all_specs.extend(dynamic_tools.list_specs(include_disabled=False))
    all_specs.extend(pagepilot.local_read_specs())
    pagepilot_spec = pagepilot.spec_if_enabled()
    if pagepilot_spec is not None:
        all_specs.append(pagepilot_spec)
    if not all_specs and not config["demo_mode"]:
        raise AgentError(
            f"工具服务不可用，且没有已启用的动态工具：{mcp_error or '未知错误'}",
            503,
        )

    global_settings = db.get_tool_settings()
    assistant_tools = (
        set(assistant["tool_names"])
        if assistant and assistant.get("tool_names")
        else None
    )
    eligible = (
        [
            spec
            for spec in all_specs
            if _tool_available(
                spec, user, global_settings, requested_tools, assistant_tools
            )
        ]
        if model.get("supports_tools", True)
        else []
    )
    if config.get("bm25_enabled", True):
        available, retrieval_used = tool_search.rank_tools(eligible, query, limit=16)
        retrieval_reason = "bm25" if retrieval_used else "all"
    else:
        available, retrieval_used = eligible, False
        retrieval_reason = "disabled"
    selected_names = {spec.name for spec in available}
    for spec in eligible:
        setting = global_settings.get(spec.name) or db.default_tool_setting(
            spec.name, spec.source
        )
        if (
            not setting.get("selectable", True)
            and setting.get("default_selected", True)
            and spec.name not in selected_names
        ):
            available.append(spec)
            selected_names.add(spec.name)
    budget = resolve_budget(config, assistant)
    skill_tools = (
        _skill_tools(skills) if model.get("supports_tools", True) else []
    )
    memories: list[dict[str, Any]] = []
    if config.get("memory_enabled", True) and (
        assistant is None or assistant.get("memory_enabled", True)
    ):
        memories = sessions.list_memories(user["id"], include_disabled=False)
    effort = str(reasoning_effort or config.get("default_reasoning_effort") or "")
    if not model.get("supports_reasoning"):
        effort = ""
    resolved_approval_mode = approval_mode or config.get("default_approval_mode") or "confirm"
    if resolved_approval_mode not in {"confirm", "full_access"}:
        resolved_approval_mode = "confirm"
    if resolved_approval_mode == "full_access" and not config.get("allow_full_access", True):
        resolved_approval_mode = "confirm"
    return AgentContext(
        token=token,
        user=user,
        model=model,
        provider=provider,
        config=config,
        skills=skills,
        all_tools=all_specs,
        tools=available,
        global_tool_settings=global_settings,
        requested_tools=requested_tools,
        reasoning_effort=effort or None,
        approval_mode=resolved_approval_mode,
        assistant=assistant,
        budget=budget,
        memories=memories,
        skill_tools=skill_tools,
        tool_retrieval={
            "eligible": len(eligible),
            "selected": len(available),
            "bm25": retrieval_used,
            "reason": retrieval_reason,
            "mcp_error": mcp_error,
        },
    )


def _summary_target_for(
    model: dict[str, Any],
    config: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    summary_model = model
    configured = config.get("compaction_model_id")
    if configured:
        candidate = db.get_model(int(configured))
        if candidate and candidate.get("enabled") and candidate.get("provider_id"):
            provider = db.get_provider(int(candidate["provider_id"]))
            if provider and provider.get("enabled"):
                if config["demo_mode"]:
                    return candidate, provider
                ready, _reason = provider_ready(provider)
                if ready:
                    return candidate, provider
    provider = db.get_provider(int(summary_model["provider_id"]))
    return summary_model, provider


def _summary_target(
    ctx: AgentContext,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    return _summary_target_for(ctx.model, ctx.config)


def _run_summary(
    spec: ToolSpec, args: dict[str, Any], execution: ToolExecution
) -> str:
    if not execution.ok:
        return f"{spec.name} 执行失败：{execution.text[:180]}"
    data = execution.data if isinstance(execution.data, dict) else {}
    if spec.name == "list_devices":
        return f"查询设备：共 {data.get('total', 0)} 台"
    if spec.name == "get_device":
        device = data.get("device", {})
        return f"读取设备 #{device.get('id', args.get('device_id'))}「{device.get('name', '')}」"
    if spec.name == "get_device_stats":
        return f"设备统计：共 {data.get('total', 0)} 台"
    if spec.name == "create_device":
        device = data.get("device", {})
        return f"新增设备 #{device.get('id', '?')}「{device.get('name', args.get('name', ''))}」"
    if spec.name == "update_device":
        return f"修改设备 #{args.get('device_id')}"
    if spec.name == "delete_device":
        deleted = data.get("deleted", {})
        return f"删除设备 #{args.get('device_id')}「{deleted.get('name', '')}」"
    if spec.name == "list_users":
        return f"读取用户列表：{len(data.get('items', []))} 个用户"
    if spec.name == "get_my_profile":
        return "读取当前用户身份与权限"
    if spec.name == "load_skill":
        return f"加载技能 {args.get('name', '')}"
    if spec.name == "read_skill_file":
        return f"读取技能文件 {args.get('name', '')}/{args.get('path', '')}"
    if spec.name == pagepilot.TOOL_NAME:
        return f"发布到 PagePilot：{data.get('url', '') or args.get('title', '')}"
    return f"执行工具 {spec.name}"


def _approval_summary(spec: ToolSpec, args: dict[str, Any]) -> str:
    field_labels = {
        "name": "名称",
        "device_type": "类型",
        "serial_no": "编号",
        "location": "位置",
        "status": "状态",
        "owner": "负责人",
        "remark": "备注",
    }
    if spec.name == "delete_device":
        return f"将删除设备 #{args.get('device_id')}，此操作不可恢复。"
    if spec.name == "update_device":
        changed = [
            f"{field_labels.get(key, key)} → {value}"
            for key, value in args.items()
            if key != "device_id"
        ]
        return f"将修改设备 #{args.get('device_id')}：" + "；".join(changed[:4])
    if spec.name == "create_device":
        return (
            f"将新增设备「{args.get('name', '')}」"
            f"（编号 {args.get('serial_no', '')}）。"
        )
    if spec.name == pagepilot.TOOL_NAME:
        size = len(str(args.get("html", "")).encode("utf-8")) / 1024
        action = "更新" if args.get("code") or args.get("publication_id") else "发布"
        password_text = (
            "已设置访问密码"
            if args.get("access_password")
            else "未设置访问密码，发布后公开访问"
        )
        return (
            f"将{action}「{args.get('title', '未命名页面')}」到外部 PagePilot 服务"
            f"（约 {size:.1f} KB），{password_text}。"
        )
    return f"将执行工具 {spec.name}。"


def _find_run(tool_runs: list[dict[str, Any]], call_id: str) -> dict[str, Any] | None:
    return next((run for run in tool_runs if run.get("call_id") == call_id), None)


def _display_arguments(tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    """Keep large generated payloads out of transcripts and approval cards."""
    if tool_name == pagepilot.TOOL_NAME and "html" in arguments:
        size = len(str(arguments.get("html", "")).encode("utf-8"))
        return {
            **arguments,
            "html": f"[HTML 已隐藏，{size} bytes；完整内容保存在待审批记录中]",
            **(
                {"access_password": "[已设置，密码不进入会话记录]"}
                if arguments.get("access_password")
                else {}
            ),
        }
    return arguments


def _find_skill(ctx: AgentContext, name: str) -> dict[str, Any] | None:
    wanted = str(name or "").strip()
    for skill in ctx.skills:
        if wanted in {
            str(skill.get("slug", "")),
            str(skill.get("name", "")),
            str(skill.get("id", "")),
        }:
            return skill
    return None


async def _execute_skill_tool(
    ctx: AgentContext,
    spec: ToolSpec,
    arguments: dict[str, Any],
) -> ToolExecution:
    skill = _find_skill(ctx, str(arguments.get("name", "")))
    if skill is None:
        return ToolExecution(ok=False, text=f"未找到技能：{arguments.get('name', '')}")
    if spec.name == "load_skill":
        files = skill.get("files") or {}
        file_list = "、".join(files.keys()) if files else "无"
        text = "\n".join(
            [
                f"# {skill.get('name', '')}",
                f"标识：{skill.get('slug', '')}",
                f"用途：{skill.get('description', '')}",
                "",
                str(skill.get("content", "")),
                "",
                f"可读取的参考文件：{file_list}",
            ]
        )
        return ToolExecution(ok=True, text=text[:14000], data={"skill": skill})
    if spec.name == "read_skill_file":
        path = str(arguments.get("path", "")).strip().lstrip("/")
        files = skill.get("files") or {}
        if path not in files:
            return ToolExecution(
                ok=False,
                text=f"技能「{skill.get('name', '')}」没有参考文件：{path}",
            )
        return ToolExecution(
            ok=True,
            text=str(files[path])[:14000],
            data={"skill": skill.get("slug"), "path": path},
        )
    return ToolExecution(ok=False, text=f"未知技能工具：{spec.name}")


async def _execute(
    ctx: AgentContext,
    spec: ToolSpec,
    call: dict[str, Any],
    tool_runs: list[dict[str, Any]],
) -> tuple[ToolExecution, dict[str, Any]]:
    arguments = call.get("arguments") or {}
    if spec.category == "技能":
        execution = await _execute_skill_tool(ctx, spec, arguments)
    elif spec.source == "dynamic":
        execution = await dynamic_tools.call_dynamic_tool(ctx.token, spec, arguments)
    elif spec.source == "pagepilot":
        try:
            if spec.name == pagepilot.LIST_TOOL_NAME:
                result = publications.list_publications(
                    int(ctx.user["id"]), q=str(arguments.get("q") or ""),
                    limit=int(arguments.get("limit") or 20),
                    offset=int(arguments.get("offset") or 0),
                )
            elif spec.name == pagepilot.GET_TOOL_NAME:
                result = publications.detail(int(arguments.get("publication_id") or 0), int(ctx.user["id"]))
                result.pop("html", None)
            else:
                if not isinstance(arguments.get("access_password"), str) or arguments.get("visibility") not in {"public", "unlisted"}:
                    raise pagepilot.PagePilotError("发布前请先询问用户本次密码与可见范围；不设密码需显式传空字符串，不得自动生成密码", 422)
                result = await pagepilot.publish_html(
                    html=str(arguments.get("html", "")),
                    title=str(arguments.get("title", "")),
                    description=str(arguments.get("description", "")),
                    filename=str(arguments.get("filename", "")),
                    code=str(arguments.get("code", "")),
                    access_password=(
                        str(arguments["access_password"])
                        if "access_password" in arguments
                        else None
                    ),
                    visibility=str(arguments.get("visibility", "")) or None,
                    user=ctx.user,
                    session_id=ctx.session_id,
                    publication_id=int(arguments["publication_id"]) if arguments.get("publication_id") else None,
                    source="tool",
                )
            execution = ToolExecution(
                ok=result.get("ok", True),
                text=json.dumps(result, ensure_ascii=False),
                data=result,
            )
        except (pagepilot.PagePilotError, publications.PublicationError, ValueError) as exc:
            execution = ToolExecution(ok=False, text=f"PagePilot 操作失败：{exc}", data=None)
    else:
        try:
            execution = await call_tool(ctx.token, spec.name, arguments)
        except Exception as exc:  # noqa: BLE001 - tool failures become model context
            execution = ToolExecution(ok=False, text=f"MCP 调用异常：{exc}", data=None)

    run = _find_run(tool_runs, call["id"])
    if run is None:
        run = {"call_id": call["id"]}
        tool_runs.append(run)
    run.update(
        {
            "tool": spec.name,
            "arguments": _display_arguments(spec.name, arguments),
            "risk": spec.risk,
            "status": "ok" if execution.ok else "error",
            "summary": _run_summary(spec, arguments, execution),
            "result": (
                execution.data if execution.data is not None else execution.text
            ),
            "result_text": execution.text[:12000],
        }
    )
    return execution, run


async def _execute_emitting(
    ctx: AgentContext,
    spec: ToolSpec,
    call: dict[str, Any],
    tool_runs: list[dict[str, Any]],
) -> tuple[ToolExecution, dict[str, Any]]:
    await _emit_event(
        ctx,
        "tool.started",
        {
            "tool": spec.name,
            "call_id": call["id"],
            "arguments": _display_arguments(spec.name, call.get("arguments", {})),
            "risk": spec.risk,
        },
    )
    try:
        execution, run = await asyncio.wait_for(
            _execute(ctx, spec, call, tool_runs),
            timeout=max(0.0, ctx.deadline - time.monotonic()),
        )
    except TimeoutError:
        execution = ToolExecution(ok=False, text="工具执行已达到运行时间上限，请核对业务端状态后再重试")
        run = _find_run(tool_runs, call["id"])
        if run is None:
            run = {"call_id": call["id"]}
            tool_runs.append(run)
        run.update(tool=spec.name, arguments=_display_arguments(spec.name, call.get("arguments", {})), risk=spec.risk, status="error", summary=execution.text, result=execution.text)
    await _emit_event(
        ctx,
        "tool.finished",
        {
            "tool": spec.name,
            "call_id": call["id"],
            "status": run.get("status"),
            "summary": run.get("summary"),
            "result": run.get("result"),
            "result_text": run.get("result_text", "")[:4000],
        },
    )
    return execution, run


def _public_runs(tool_runs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items = []
    for run in tool_runs:
        item = {key: value for key, value in run.items() if key != "call_id"}
        items.append(item)
    return items


def _response(
    ctx: AgentContext,
    *,
    status: str,
    answer: str,
    tool_runs: list[dict[str, Any]] | None = None,
    approval: dict[str, Any] | None = None,
    usage: dict[str, Any] | None = None,
) -> dict[str, Any]:
    assistant = ctx.assistant or {}
    session = (
        sessions.get_session(ctx.session_id, ctx.user["id"])
        if ctx.session_id
        else None
    )
    return {
        "status": status,
        "answer": answer,
        "tool_runs": _public_runs(tool_runs or []),
        "approval": approval,
        "session_id": ctx.session_id,
        "assistant": (
            {
                "id": assistant.get("id"),
                "name": assistant.get("name"),
                "icon": assistant.get("icon"),
                "mode": assistant.get("mode", "agent"),
            }
            if assistant
            else None
        ),
        "model": {
            "id": ctx.model["id"],
            "name": ctx.model["name"],
            "model_id": ctx.model["model_id"],
            "provider_id": ctx.model.get("provider_id"),
            "provider_name": ctx.provider["name"],
            "capabilities": ctx.model.get("capabilities", ["text"]),
            "supports_tools": ctx.model.get("supports_tools", True),
            "supports_reasoning": ctx.model.get("supports_reasoning", False),
            "reasoning_effort": ctx.reasoning_effort or "",
            "context_window": ctx.model.get("context_window", 0),
        },
        "demo_mode": ctx.config["demo_mode"],
        "approval_mode": ctx.approval_mode,
        "enabled_tools": [spec.name for spec in ctx.tools],
        "tool_retrieval": ctx.tool_retrieval,
        "budget": {
            "max_steps": ctx.budget.get("max_steps"),
            "max_tool_calls": ctx.budget.get("max_tool_calls"),
            "max_run_seconds": ctx.budget.get("max_run_seconds"),
        },
        "run": {
            "steps_used": ctx.steps_used,
            "tool_calls_used": ctx.tool_calls_used,
            "retry_count": ctx.retry_count,
            "fallback_used": ctx.fallback_used,
            "had_reasoning": ctx.had_reasoning,
            "reasoning": ctx.reasoning_text,
            "elapsed_seconds": round(time.monotonic() - ctx.started_at, 1),
        },
        "session_usage": (
            {
                "total_input_tokens": session.get("total_input_tokens", 0),
                "total_output_tokens": session.get("total_output_tokens", 0),
                "total_tokens": session.get("total_tokens", 0),
                "total_cost_usd": session.get("total_cost_usd", 0),
                "retry_count": session.get("retry_count", 0),
                "compaction_count": session.get("compaction_count", 0),
                "message_count": session.get("message_count", 0),
            }
            if session
            else {}
        ),
        "usage": usage or {},
        "context": (
            {
                "context_tokens": ctx.last_prompt_tokens,
                "budget_tokens": context_planner._context_budget(ctx.model, {
                    **ctx.config, "context_max_tokens": ctx.budget.get("context_max_tokens", 0),
                })[0],
                "context_window": ctx.model.get("context_window", 0),
            } if ctx.last_prompt_tokens else {}
        ),
    }


def _json_dumps(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False)


def _append_assistant_message(
    messages: list[dict[str, Any]], completion: dict[str, Any]
) -> None:
    tool_calls = []
    for call in completion.get("tool_calls", []):
        raw = call.get("raw_arguments")
        if raw is None:
            raw = _json_dumps(call.get("arguments", {}))
        tool_calls.append(
            {
                "id": call["id"],
                "type": "function",
                "function": {"name": call["name"], "arguments": raw},
            }
        )
    message: dict[str, Any] = {
        "role": "assistant",
        "content": completion.get("content", "") or "",
    }
    if tool_calls:
        message["tool_calls"] = tool_calls
    messages.append(message)


def _append_tool_message(
    messages: list[dict[str, Any]], call: dict[str, Any], text: str
) -> None:
    messages.append(
        {
            "role": "tool",
            "tool_call_id": call["id"],
            "content": text[:12000],
        }
    )


def _tool_result_for_model(execution: ToolExecution) -> str:
    if execution.ok:
        return execution.text[:12000]
    return f"TOOL_ERROR: {execution.text[:12000]}"


async def _store_pending(pending: PendingApproval) -> None:
    db.cleanup_pending_approvals()
    db.create_pending_approval(
        {
            "id": pending.id,
            "user_id": pending.ctx.user["id"],
            "username": pending.ctx.user["username"],
            "session_id": pending.ctx.session_id,
            "assistant_id": (pending.ctx.assistant or {}).get("id"),
            "model_row_id": pending.ctx.model.get("id"),
            "requested_tools": pending.ctx.requested_tools,
            "reasoning_effort": pending.ctx.reasoning_effort,
            "mode": pending.mode,
            "messages": pending.messages,
            "calls": pending.calls,
            "tool_runs": pending.tool_runs,
            "round_count": pending.round_count,
            "tool_call_total": pending.tool_call_total,
            "usage": pending.usage,
            "created_at": pending.created_at,
            "expires_at": pending.expires_at,
        }
    )


def _approval_payload(pending: PendingApproval, call: dict[str, Any]) -> dict[str, Any]:
    spec = next((item for item in pending.ctx.all_tools if item.name == call["name"]), None)
    risk = spec.risk if spec else "write"
    return {
        "id": pending.id,
        "tool": call["name"],
        "arguments": _display_arguments(call["name"], call.get("arguments", {})),
        "risk": risk,
        "risk_label": RISK_LABELS.get(risk, risk),
        "summary": _approval_summary(spec, call.get("arguments", {}))
        if spec
        else f"将执行 {call['name']}",
        "expires_in": max(0, int(pending.expires_at - time.time())),
    }


async def _create_approval(
    ctx: AgentContext,
    messages: list[dict[str, Any]],
    calls: list[dict[str, Any]],
    tool_runs: list[dict[str, Any]],
    round_count: int,
    mode: str,
    tool_call_total: int = 0,
    usage: dict[str, Any] | None = None,
) -> dict[str, Any]:
    call = calls[0]
    spec = next((item for item in ctx.all_tools if item.name == call["name"]), None)
    run = _find_run(tool_runs, call["id"])
    if run is None:
        run = {"call_id": call["id"]}
        tool_runs.append(run)
    run.update(
        {
            "tool": call["name"],
            "arguments": _display_arguments(call["name"], call.get("arguments", {})),
            "risk": spec.risk if spec else "write",
            "status": "pending",
            "summary": _approval_summary(spec, call.get("arguments", {}))
            if spec
            else f"等待确认：{call['name']}",
            "result": None,
            "result_text": "",
        }
    )
    pending = PendingApproval(
        id=secrets.token_urlsafe(12),
        ctx=ctx,
        messages=messages,
        calls=calls,
        tool_runs=tool_runs,
        round_count=round_count,
        tool_call_total=tool_call_total,
        usage=usage,
        mode=mode,
    )
    await _store_pending(pending)
    response = _response(
        ctx,
        status="approval_required",
        answer="该操作需要你的确认，请在审批卡中批准或取消。",
        tool_runs=tool_runs,
        approval=_approval_payload(pending, call),
    )
    await _emit_event(
        ctx,
        "tool.approval_required",
        response.get("approval") or {},
    )
    return response


async def _emit_event(
    ctx: AgentContext, event_type: str, payload: dict[str, Any]
) -> None:
    await _emit_callback(ctx.emit, event_type, payload)


async def _emit_callback(
    callback: Any, event_type: str, payload: dict[str, Any]
) -> None:
    if callback is None:
        return
    try:
        await callback(event_type, payload)
    except Exception:  # noqa: BLE001 - UI disconnects must not break the run
        return


def _fallback_target(
    ctx: AgentContext,
) -> tuple[dict[str, Any], dict[str, Any]] | None:
    if ctx.fallback_used:
        return None
    configured = ctx.config.get("fallback_model_id")
    if not configured:
        return None
    candidate = db.get_model(int(configured))
    if (
        candidate is None
        or not candidate.get("enabled")
        or not candidate.get("provider_id")
        or int(candidate["id"]) == int(ctx.model["id"])
    ):
        return None
    provider = db.get_provider(int(candidate["provider_id"]))
    if provider is None or not provider.get("enabled"):
        return None
    if not ctx.config["demo_mode"]:
        ready, _reason = provider_ready(provider)
        if not ready:
            return None
    return candidate, provider


async def _llm_loop(
    ctx: AgentContext,
    messages: list[dict[str, Any]],
    calls: list[dict[str, Any]],
    tool_runs: list[dict[str, Any]],
    *,
    approved_ids: set[str] | None = None,
    round_count: int = 0,
    tool_call_total: int = 0,
    usage: dict[str, Any] | None = None,
) -> dict[str, Any]:
    approved_ids = set(approved_ids or set())
    all_specs = [*ctx.tools, *ctx.skill_tools]
    tool_schemas = openai_tools(all_specs)
    specs = {spec.name: spec for spec in all_specs}

    while True:
        if time.monotonic() > ctx.deadline:
            return _response(
                ctx,
                status="error",
                answer=(
                    f"本次运行已超过 {ctx.budget['max_run_seconds']} 秒上限，"
                    "请缩小问题范围后重试。"
                ),
                tool_runs=tool_runs,
                usage=usage,
            )
        while calls:
            call = calls[0]
            spec = specs.get(call["name"])
            if spec is None:
                error = ToolExecution(
                    ok=False,
                    text=f"工具 {call['name']} 本轮未启用或当前账号不可用",
                )
                _append_tool_message(messages, call, _tool_result_for_model(error))
                run = _find_run(tool_runs, call["id"])
                if run is None:
                    run = {"call_id": call["id"]}
                    tool_runs.append(run)
                run.update(
                    {
                        "tool": call["name"],
                        "arguments": _display_arguments(call["name"], call.get("arguments", {})),
                        "risk": "write",
                        "status": "error",
                        "summary": error.text,
                        "result": error.text,
                        "result_text": error.text,
                    }
                )
                calls.pop(0)
                continue

            if (
                spec.risk in ("write", "delete")
                and call["id"] not in approved_ids
                and ctx.approval_mode != "full_access"
            ):
                return await _create_approval(
                    ctx,
                    messages,
                    calls,
                    tool_runs,
                    round_count,
                    "llm",
                    tool_call_total,
                    usage,
                )

            tool_call_total += 1
            ctx.tool_calls_used = tool_call_total
            if tool_call_total > ctx.budget["max_tool_calls"]:
                return _response(
                    ctx,
                    status="error",
                    answer=(
                        f"已达到单次运行的工具调用上限"
                        f"（{ctx.budget['max_tool_calls']} 次）。"
                    ),
                    tool_runs=tool_runs,
                    usage=usage,
                )
            execution, run = await _execute_emitting(ctx, spec, call, tool_runs)
            _append_tool_message(
                messages, call, _tool_result_for_model(execution)
            )
            approved_ids.discard(call["id"])
            calls.pop(0)

        if round_count >= ctx.budget["max_steps"]:
            return _response(
                ctx,
                status="error",
                answer=(
                    f"已达到最大推理轮次（{ctx.budget['max_steps']}），"
                    "请缩小问题范围后重试。"
                ),
                tool_runs=tool_runs,
                usage=usage,
            )

        context_budget = int(
            ctx.budget.get("context_budget_tokens")
            or ctx.budget["context_max_tokens"]
        )
        estimated = sum(
            sessions.estimate_tokens(item.get("content", "")) for item in messages
        )
        if estimated > context_budget * 0.95:
            trimmed, info = context_planner.emergency_trim(
                messages,
                context_budget,
                ctx.session_id,
            )
            if info:
                messages[:] = trimmed
                ctx.last_compaction = info

        try:
            await _emit_event(
                ctx,
                "step.started",
                {"step": round_count + 1, "max_steps": ctx.budget["max_steps"]},
            )
            completion = await chat_completion(
                messages=messages,
                tools=tool_schemas,
                model=ctx.model,
                provider=ctx.provider,
                config=ctx.config,
                session_id=ctx.session_id,
                username=ctx.user["username"],
                purpose="chat",
                deadline=ctx.deadline,
                reasoning_effort=ctx.reasoning_effort,
                on_event=(
                    (lambda event, payload: _emit_event(ctx, event, payload))
                    if ctx.emit is not None
                    else None
                ),
            )
        except LLMError as exc:
            fallback = (
                _fallback_target(ctx)
                if not exc.context_overflow
                else None
            )
            if fallback is not None:
                previous = ctx.model
                ctx.model, ctx.provider = fallback
                ctx.fallback_used = True
                await _emit_event(
                    ctx,
                    "model.fallback",
                    {
                        "from": previous.get("name"),
                        "to": ctx.model.get("name"),
                        "reason": str(exc)[:300],
                    },
                )
                continue
            if exc.context_overflow and not ctx.overflow_retried:
                ctx.overflow_retried = True
                trimmed, info = context_planner.emergency_trim(
                    messages,
                    context_budget,
                    ctx.session_id,
                )
                if info:
                    messages[:] = trimmed
                    ctx.last_compaction = info
                    continue
            return _response(
                ctx,
                status="error",
                answer=f"LLM 调用失败：{str(exc)[:500]}",
                tool_runs=tool_runs,
                usage=usage,
            )
        except Exception as exc:  # noqa: BLE001 - return actionable message to UI
            return _response(
                ctx,
                status="error",
                answer=f"LLM 调用失败：{str(exc)[:500]}",
                tool_runs=tool_runs,
                usage=usage,
            )

        round_count += 1
        ctx.steps_used = round_count
        completion_usage = completion.get("usage") or {}
        ctx.last_prompt_tokens = int(completion_usage.get("prompt_tokens") or 0)
        if completion.get("reasoning_content"):
            ctx.had_reasoning = True
            ctx.reasoning_text += ("\n\n" if ctx.reasoning_text else "") + str(completion["reasoning_content"])
        ctx.retry_count += int(completion_usage.get("retry_count") or 0)
        usage = merge_usage(usage, completion_usage)
        await _emit_event(ctx, "usage", {"usage": usage})
        _append_assistant_message(messages, completion)
        if not completion.get("tool_calls"):
            return _response(
                ctx,
                status="ok",
                answer=completion.get("content", "").strip()
                or "模型没有返回文本结果。",
                tool_runs=tool_runs,
                usage=usage,
            )
        calls = completion["tool_calls"]


def _device_id(text: str) -> int | None:
    patterns = [
        r"#\s*(\d+)",
        r"(?:device_id|设备\s*id|设备|id)\s*[=:：#]?\s*(\d+)",
        r"(\d+)\s*号",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return int(match.group(1))
    fallback = re.search(r"(?<![A-Za-z0-9-])(\d{1,6})(?![A-Za-z0-9-])", text)
    return int(fallback.group(1)) if fallback else None


FIELD_ALIASES = {
    "名称": "name",
    "设备名称": "name",
    "name": "name",
    "类型": "device_type",
    "设备类型": "device_type",
    "device_type": "device_type",
    "编号": "serial_no",
    "序列号": "serial_no",
    "serial_no": "serial_no",
    "位置": "location",
    "地点": "location",
    "location": "location",
    "状态": "status",
    "status": "status",
    "负责人": "owner",
    "归属": "owner",
    "owner": "owner",
    "备注": "remark",
    "remark": "remark",
}


def _parse_fields(text: str) -> dict[str, Any]:
    fields: dict[str, Any] = {}
    key_pattern = "|".join(sorted(map(re.escape, FIELD_ALIASES), key=len, reverse=True))
    for match in re.finditer(
        rf"(?:^|[\s,，;；])({key_pattern})\s*[=:：]\s*([^\s,，;；。]+)",
        text,
        re.IGNORECASE,
    ):
        key = FIELD_ALIASES[match.group(1).lower() if match.group(1).isascii() else match.group(1)]
        fields[key] = match.group(2).strip("，,。;；")

    for status in DEVICE_STATUSES:
        if status in text and "status" not in fields:
            if any(word in text for word in ("状态", "改为", "改成", "设为", "设置为")):
                fields["status"] = status

    natural = [
        ("位置", "location"),
        ("地点", "location"),
        ("负责人", "owner"),
        ("归属", "owner"),
        ("备注", "remark"),
        ("设备名称", "name"),
        ("名称", "name"),
    ]
    for label, key in natural:
        if key in fields:
            continue
        match = re.search(
            rf"{label}(?:改为|改成|设置为|设为|更新为)\s*([^\s,，;；。]+)", text
        )
        if match:
            fields[key] = match.group(1)
    return fields


def _detect_intent(text: str) -> str:
    lower = text.lower()
    if any(word in lower for word in ("用户列表", "所有用户", "用户清单", "有哪些用户", "列出用户")):
        return "list_users"
    if any(word in lower for word in ("我是谁", "我的权限", "当前用户", "我的身份", "权限")):
        return "get_my_profile"
    if any(word in lower for word in ("删除", "移除", "删掉", "delete", "remove")):
        return "delete_device"
    if any(word in lower for word in ("新增", "添加", "创建", "加一台", "create", "add ")):
        return "create_device"
    if any(
        word in lower
        for word in ("修改", "更改", "更新", "改成", "改为", "设置为", "设为", "update", "change")
    ):
        return "update_device"
    if any(word in lower for word in ("统计", "多少台", "数量", "概况", "分布", "stats")):
        return "get_device_stats"
    if any(word in lower for word in ("详情", "详细信息", "detail")):
        return "get_device"
    if re.search(r"(?:设备|device)\s*[#：:=]?\s*\d+", lower) or re.search(
        r"\d+\s*号\s*(?:设备)?", lower
    ):
        return "get_device"
    if any(
        word in lower
        for word in ("设备", "列表", "查看", "查询", "有哪些", "所有设备", "device", "list")
    ):
        return "list_devices"
    if any(word in lower for word in ("你好", "您好", "hi", "hello", "帮助", "能做什么", "help")):
        return "help"
    return "unknown"


def _unavailable_answer(name: str, ctx: AgentContext) -> str:
    spec = next((item for item in ctx.all_tools if item.name == name), None)
    if spec is None:
        return f"MCP 工具层没有提供 `{name}` 能力。"
    if spec.permission not in ctx.user.get("permissions", []):
        return (
            f"当前账号（{ctx.user['username']}）缺少 `{spec.permission}` 权限，"
            "无法执行这个操作。服务端会在工具层再次校验，界面隐藏不是唯一防线。"
        )
    assistant = ctx.assistant or {}
    if assistant.get("tool_names") and name not in assistant["tool_names"]:
        return (
            f"助手「{assistant['name']}」只开放了查询类工具，不能执行 `{name}`。"
            "需要变更数据时，请切换到具备写入能力的助手。"
        )
    setting = ctx.global_tool_settings.get(
        spec.name, db.default_tool_setting(spec.name, spec.source)
    )
    if not setting.get("enabled", True):
        return f"管理员已在「AI 配置 → 可用工具」中停用 `{spec.name}`。"
    return (
        f"你在本轮工具选择中关闭了 `{spec.name}`。"
        "打开输入框下方的「工具」开关后再试。"
    )


def _demo_device_list(data: dict[str, Any]) -> str:
    items = data.get("items", [])
    if not items:
        return "没有找到符合条件的设备。"
    lines = [f"共 {data.get('total', len(items))} 台设备："]
    for device in items:
        lines.append(
            f"- #{device['id']} **{device['name']}** / {device['serial_no']} / "
            f"{device['location'] or '未填写位置'} / {device['status']}"
        )
    return "\n".join(lines)


def _demo_device_detail(device: dict[str, Any]) -> str:
    return "\n".join(
        [
            f"设备 #{device['id']}「{device['name']}」",
            f"- 类型：{device['device_type']}",
            f"- 编号：{device['serial_no']}",
            f"- 位置：{device['location'] or '未填写'}",
            f"- 状态：{device['status']}",
            f"- 负责人：{device['owner'] or '未填写'}",
            f"- 备注：{device['remark'] or '无'}",
        ]
    )


def _demo_answer_for_run(
    name: str, run: dict[str, Any], ctx: AgentContext
) -> str:
    if run["status"] != "ok":
        text = str(run.get("summary", ""))
        hint = (
            "\n\n这符合当前账号的权限设置；如需更高权限，请联系管理员。"
            if ("403" in text or "权限" in text)
            else ""
        )
        return f"操作失败：{text}{hint}"

    result = run.get("result")
    if name == "list_devices" and isinstance(result, dict):
        return _demo_device_list(result)
    if name == "get_device" and isinstance(result, dict):
        device = result.get("device", {})
        return _demo_device_detail(device)
    if name == "get_device_stats" and isinstance(result, dict):
        by_type = "、".join(
            f"{key} {value} 台" for key, value in result.get("by_type", {}).items()
        )
        return (
            f"设备总数 **{result.get('total', 0)} 台**："
            f"在线 {result.get('online', 0)}、离线 {result.get('offline', 0)}、"
            f"维护中 {result.get('maintenance', 0)}。\n\n"
            f"按类型：{by_type or '暂无数据'}。"
        )
    if name == "create_device" and isinstance(result, dict):
        device = result.get("device", {})
        return f"已新增设备 #{device.get('id')}「{device.get('name')}」，编号 {device.get('serial_no')}。"
    if name == "update_device" and isinstance(result, dict):
        device = result.get("device", {})
        return f"已更新设备 #{device.get('id')}「{device.get('name')}」，当前状态：{device.get('status')}。"
    if name == "delete_device" and isinstance(result, dict):
        deleted = result.get("deleted", {})
        return f"已删除设备 #{deleted.get('id')}「{deleted.get('name')}」及其编号 {deleted.get('serial_no')}。"
    if name == "get_my_profile" and isinstance(result, dict):
        user = result.get("user", {})
        permissions = "、".join(user.get("permissions", []))
        return (
            f"当前账号：**{user.get('display_name')}**（{user.get('username')}），"
            f"角色 `{user.get('role')}`。\n"
            f"权限：{permissions}。"
        )
    if name == "list_users" and isinstance(result, dict):
        items = result.get("items", [])
        lines = [f"共 {len(items)} 个用户："]
        for user in items:
            role = "管理员" if user.get("is_admin") else user.get("role")
            lines.append(
                f"- **{user['username']}** / {user['display_name']} / {role} / "
                + "、".join(user.get("permissions", []))
            )
        return "\n".join(lines)
    return f"操作已完成。\n\n```json\n{json.dumps(result, ensure_ascii=False, indent=2)[:3000]}\n```"


def _help_answer(ctx: AgentContext) -> str:
    examples = [
        "查看全部设备",
        "统计设备状态",
        "查询 2 号设备详情",
    ]
    if "device:update" in ctx.user.get("permissions", []):
        examples.append("把 2 号设备状态改为维护中")
    if "device:delete" in ctx.user.get("permissions", []):
        examples.append("删除 4 号设备")
    tool_names = "、".join(spec.name for spec in ctx.tools) or "无"
    assistant_name = (ctx.assistant or {}).get("name") or "设备管理 Agent"
    return (
        f"我是 **{assistant_name}**，本轮使用 **{ctx.model['name']}**"
        f"{'（演示模式）' if ctx.config['demo_mode'] else ''}。\n\n"
        "我可以调用 MCP 工具完成设备查询、统计和受控写入，所有工具都继承你的账号权限。\n\n"
        f"你可以这样问：\n" + "\n".join(f"- {item}" for item in examples) +
        f"\n\n本轮已启用工具：{tool_names}"
    )


async def _demo_chat(ctx: AgentContext, text: str) -> dict[str, Any]:
    intent = _detect_intent(text)
    if intent == "help":
        return _response(ctx, status="ok", answer=_help_answer(ctx))
    if intent == "unknown":
        return _response(
            ctx,
            status="ok",
            answer=(
                "我目前主要处理设备信息表的查询、统计和受控增删改。\n\n"
                "你可以试试：查看全部设备、统计设备状态、查询 2 号设备详情，"
                "或者在有权限时修改/删除设备。"
            ),
        )

    available = {spec.name for spec in ctx.tools}
    if intent not in available:
        return _response(ctx, status="ok", answer=_unavailable_answer(intent, ctx))

    spec = next(item for item in ctx.tools if item.name == intent)
    tool_runs: list[dict[str, Any]] = []

    if intent == "list_devices":
        args: dict[str, Any] = {}
        for status in DEVICE_STATUSES:
            if status in text:
                args["status"] = status
                break
        call = {"id": f"demo-{secrets.token_hex(4)}", "name": intent, "arguments": args}
    elif intent == "get_device":
        device_id = _device_id(text)
        if device_id is None:
            return _response(ctx, status="ok", answer="请提供设备 ID，例如：查询 2 号设备详情。")
        call = {
            "id": f"demo-{secrets.token_hex(4)}",
            "name": intent,
            "arguments": {"device_id": device_id},
        }
    elif intent == "get_device_stats":
        call = {"id": f"demo-{secrets.token_hex(4)}", "name": intent, "arguments": {}}
    elif intent == "get_my_profile":
        call = {"id": f"demo-{secrets.token_hex(4)}", "name": intent, "arguments": {}}
    elif intent == "list_users":
        call = {"id": f"demo-{secrets.token_hex(4)}", "name": intent, "arguments": {}}
    elif intent == "create_device":
        fields = _parse_fields(text)
        missing = [
            label
            for key, label in (("name", "名称"), ("device_type", "类型"), ("serial_no", "编号"))
            if not fields.get(key)
        ]
        if missing:
            return _response(
                ctx,
                status="ok",
                answer=(
                    f"新增设备还缺少：{'、'.join(missing)}。\n\n"
                    "可以这样输入：`新增设备 名称=测试交换机 类型=交换机 "
                    "编号=SN-TEST-001 位置=机房C 状态=在线 负责人=网络组`"
                ),
            )
        fields.setdefault("status", "在线")
        fields.setdefault("location", "")
        fields.setdefault("owner", "")
        fields.setdefault("remark", "")
        call = {"id": f"demo-{secrets.token_hex(4)}", "name": intent, "arguments": fields}
    elif intent == "update_device":
        device_id = _device_id(text)
        if device_id is None:
            return _response(ctx, status="ok", answer="请提供要修改的设备 ID，例如：把 2 号设备状态改为维护中。")
        fields = _parse_fields(text)
        fields.pop("device_id", None)
        if not fields:
            return _response(
                ctx,
                status="ok",
                answer=(
                    "请说明要修改哪些字段，例如：`把 2 号设备状态改为维护中`，"
                    "或 `修改设备 id=2 位置=机房C 负责人=网络组`。"
                ),
            )
        call = {
            "id": f"demo-{secrets.token_hex(4)}",
            "name": intent,
            "arguments": {"device_id": device_id, **fields},
        }
    elif intent == "delete_device":
        device_id = _device_id(text)
        if device_id is None:
            return _response(ctx, status="ok", answer="请提供要删除的设备 ID，例如：删除 4 号设备。")
        call = {
            "id": f"demo-{secrets.token_hex(4)}",
            "name": intent,
            "arguments": {"device_id": device_id},
        }
    else:
        return _response(ctx, status="error", answer="未识别的操作。")

    if spec.risk in ("write", "delete") and ctx.approval_mode != "full_access":
        return await _create_approval(ctx, [], [call], tool_runs, 0, "demo")

    execution, run = await _execute_emitting(ctx, spec, call, tool_runs)
    _ = execution
    answer = _demo_answer_for_run(intent, run, ctx)
    return _response(ctx, status="ok", answer=answer, tool_runs=tool_runs)


def _validate_attachments(
    model: dict[str, Any], attachments: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    if not attachments:
        return []
    if "image" not in model.get("capabilities", []):
        raise AgentError(
            f"模型「{model['name']}」未启用图像理解能力，请切换支持图像的模型",
            400,
        )
    normalized = []
    total_bytes = 0
    for item in attachments[:4]:
        mime_type = str(item.get("mime_type", ""))
        data_url = str(item.get("data_url", ""))
        prefix = f"data:{mime_type};base64,"
        if not data_url.startswith(prefix):
            raise AgentError("图片附件格式不正确", 422)
        payload = data_url[len(prefix) :]
        try:
            decoded = base64.b64decode(payload, validate=True)
        except (ValueError, binascii.Error) as exc:
            raise AgentError("图片附件不是有效的 Base64 数据", 422) from exc
        if len(decoded) > 3 * 1024 * 1024:
            raise AgentError("单张图片不能超过 3 MB", 413)
        total_bytes += len(decoded)
        if total_bytes > 8 * 1024 * 1024:
            raise AgentError("本轮图片总大小不能超过 8 MB", 413)
        normalized.append(
            {
                "name": str(item.get("name", "image"))[:160],
                "mime_type": mime_type,
                "data_url": data_url,
                "bytes": len(decoded),
            }
        )
    return normalized


def _multimodal_user_content(
    text: str, attachments: list[dict[str, Any]]
) -> str | list[dict[str, Any]]:
    if not attachments:
        return text
    content: list[dict[str, Any]] = [{"type": "text", "text": text}]
    for attachment in attachments:
        content.append(
            {
                "type": "image_url",
                "image_url": {
                    "url": attachment["data_url"],
                    "detail": "auto",
                },
            }
        )
    return content


async def _run_prefetch(
    ctx: AgentContext,
    tool_runs: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Report mode: run the assistant's read-only prefetch tools before the LLM."""
    assistant = ctx.assistant or {}
    allowed = {spec.name for spec in ctx.tools}
    prefetched: list[dict[str, Any]] = []
    for name in assistant.get("prefetch_tools", []):
        spec = next((item for item in ctx.all_tools if item.name == name), None)
        if spec is None or spec.risk != "read" or name not in allowed:
            continue
        if time.monotonic() > ctx.deadline:
            break
        if ctx.tool_calls_used >= ctx.budget["max_tool_calls"]:
            break
        call = {
            "id": f"prefetch-{secrets.token_hex(4)}",
            "name": name,
            "arguments": {},
        }
        execution, _run = await _execute_emitting(ctx, spec, call, tool_runs)
        ctx.tool_calls_used += 1
        prefetched.append(
            {
                "tool": name,
                "ok": execution.ok,
                "text": execution.text[:8000],
            }
        )
    return prefetched, tool_runs


async def _report_chat(
    ctx: AgentContext,
    text: str,
    attachments: list[dict[str, Any]],
    history: list[dict[str, Any]],
) -> dict[str, Any]:
    tool_runs: list[dict[str, Any]] = []
    prefetched, tool_runs = await _run_prefetch(ctx, tool_runs)
    if ctx.config["demo_mode"]:
        return _demo_report(ctx, tool_runs)

    system_prompt = build_system_prompt(
        ctx.user,
        ctx.skills,
        ctx.config["system_prompt_extra"],
        ctx.model,
        ctx.provider,
        assistant=ctx.assistant,
        memories=ctx.memories,
        prefetched=prefetched,
    )
    messages = [
        {"role": "system", "content": system_prompt},
        *[item for item in history if item.get("content")],
        {
            "role": "user",
            "content": _multimodal_user_content(text, attachments),
        },
    ]
    try:
        await _emit_event(ctx, "step.started", {"step": 1, "max_steps": 1})
        completion = await chat_completion(
            messages=messages,
            tools=[],
            model=ctx.model,
            provider=ctx.provider,
            config=ctx.config,
            session_id=ctx.session_id,
            username=ctx.user["username"],
            purpose="report",
            deadline=ctx.deadline,
            reasoning_effort=ctx.reasoning_effort,
            on_event=(
                (lambda event, payload: _emit_event(ctx, event, payload))
                if ctx.emit is not None
                else None
            ),
        )
    except LLMError as exc:
        return _response(
            ctx,
            status="error",
            answer=f"LLM 调用失败：{str(exc)[:500]}",
            tool_runs=tool_runs,
        )
    except Exception as exc:  # noqa: BLE001 - surfaced to the UI
        return _response(
            ctx,
            status="error",
            answer=f"LLM 调用失败：{str(exc)[:500]}",
            tool_runs=tool_runs,
        )
    usage = completion.get("usage") or {}
    ctx.last_prompt_tokens = int(usage.get("prompt_tokens") or 0)
    if completion.get("reasoning_content"):
        ctx.had_reasoning = True
        ctx.reasoning_text = str(completion.get("reasoning_content"))
    ctx.steps_used = 1
    ctx.retry_count += int(usage.get("retry_count") or 0)
    result = _response(
        ctx,
        status="ok",
        answer=(completion.get("content") or "").strip()
        or "模型没有返回报告内容。",
        tool_runs=tool_runs,
        usage=usage,
    )
    result["system_prompt_preview"] = system_prompt
    result["report"] = {"prefetched": [item["tool"] for item in prefetched]}
    return result


def _demo_report(
    ctx: AgentContext, tool_runs: list[dict[str, Any]]
) -> dict[str, Any]:
    sections = ["## 设备健康报告", ""]
    for run in tool_runs:
        if run.get("tool") == "get_device_stats" and run.get("status") == "ok":
            sections.append(_demo_answer_for_run("get_device_stats", run, ctx))
            sections.append("")
        if run.get("tool") == "list_devices" and run.get("status") == "ok":
            result = run.get("result") if isinstance(run.get("result"), dict) else {}
            offline = [
                item
                for item in result.get("items", [])
                if item.get("status") == "离线"
            ]
            sections.append("### 需要关注")
            if offline:
                for device in offline:
                    sections.append(
                        f"- #{device['id']} **{device['name']}** / "
                        f"{device['location'] or '未填写位置'} / 离线"
                    )
            else:
                sections.append("- 当前没有离线设备。")
            sections.append("")
    if not tool_runs:
        sections.append("没有采集到数据，请检查账号权限或助手预采集工具配置。")
    sections.append("> 演示模式：本报告由预采集数据模板生成，未调用外部模型。")
    return _response(
        ctx, status="ok", answer="\n".join(sections), tool_runs=tool_runs
    )


def _record_assistant_message(ctx: AgentContext, result: dict[str, Any]) -> None:
    if not ctx.session_id:
        return
    usage = result.get("usage") or {}
    status = str(result.get("status") or "")
    store_reasoning = ctx.config.get("store_reasoning") in (True, "1")
    sessions.add_message(
        ctx.session_id,
        role="assistant",
        content=str(result.get("answer") or "").strip(),
        reasoning=(ctx.reasoning_text if store_reasoning else ""),
        tool_runs=result.get("tool_runs") or [],
        metadata={
            "status": status,
            "model": result.get("model"),
            "assistant": result.get("assistant"),
            "usage": usage,
            "budget": result.get("budget") or {},
            "context": result.get("context") or {},
            "approval": result.get("approval"),
            "run": {key: value for key, value in (result.get("run") or {}).items() if key != "reasoning"},
            "reasoning": {
                "had_reasoning": ctx.had_reasoning,
                "stored": bool(store_reasoning and ctx.reasoning_text),
                "tokens": int(usage.get("reasoning_tokens") or 0),
            },
        },
    )
    sessions.apply_usage(
        ctx.session_id,
        usage,
        status=status,
        model=ctx.model,
        tool_runs=result.get("tool_runs") or [],
        error=str(result.get("answer") or "") if status == "error" else "",
    )


async def _maybe_generate_title(
    ctx: AgentContext, user_text: str, answer: str
) -> None:
    if not ctx.session_id or not answer.strip():
        return
    session = sessions.get_session(ctx.session_id, ctx.user["id"])
    if not session or int(session.get("message_count") or 0) > 2:
        return
    current_title = str(session.get("title") or "")
    if current_title and current_title != "新对话":
        expected = re.sub(r"\s+", " ", user_text).strip()[:28]
        if current_title != expected:
            return
    title_model = ctx.model
    title_provider = ctx.provider
    configured = ctx.config.get("title_model_id")
    if configured:
        candidate = db.get_model(int(configured))
        if candidate and candidate.get("enabled") and candidate.get("provider_id"):
            provider = db.get_provider(int(candidate["provider_id"]))
            if provider and provider.get("enabled"):
                title_model, title_provider = candidate, provider
    try:
        title = await generate_title(
            model=title_model,
            provider=title_provider,
            config=ctx.config,
            user_text=user_text,
            assistant_text=answer,
            session_id=ctx.session_id,
            username=ctx.user["username"],
        )
        latest = sessions.get_session(ctx.session_id, ctx.user["id"])
        if not latest or latest.get("title") != current_title:
            return
        sessions.rename_session(ctx.session_id, ctx.user["id"], title)
        await _emit_event(ctx, "session.title", {"title": title})
    except Exception:  # noqa: BLE001 - title generation is best-effort
        return


async def chat(
    token: str,
    text: str,
    model_row_id: int | None,
    enabled_tools: list[str] | None,
    *,
    assistant_id: int | None = None,
    session_id: str | None = None,
    attachments: list[dict[str, Any]] | None = None,
    reasoning_effort: str | None = None,
    approval_mode: str | None = None,
    emit: Any = None,
) -> dict[str, Any]:
    with session_run(session_id):
        return await _chat(
            token, text, model_row_id, enabled_tools, assistant_id=assistant_id,
            session_id=session_id, attachments=attachments,
            reasoning_effort=reasoning_effort, approval_mode=approval_mode, emit=emit,
        )


async def _chat(
    token: str,
    text: str,
    model_row_id: int | None,
    enabled_tools: list[str] | None,
    *,
    assistant_id: int | None = None,
    session_id: str | None = None,
    attachments: list[dict[str, Any]] | None = None,
    reasoning_effort: str | None = None,
    approval_mode: str | None = None,
    emit: Any = None,
) -> dict[str, Any]:
    text = str(text or "").strip()
    if not text:
        raise AgentError("消息不能为空", 422)

    await _emit_callback(emit, "run.phase", {
        "phase": "identity", "title": "正在校验业务身份",
    })
    user = await identity_from_token(token)
    session = None
    if session_id:
        session = sessions.get_session(session_id, user["id"])
        if session is None:
            raise AgentError("会话不存在或不属于当前账号", 404)
        if assistant_id is None and session.get("assistant_id"):
            assistant_id = int(session["assistant_id"])

    ctx = await build_context(
        token,
        model_row_id,
        enabled_tools,
        assistant_id,
        query=text,
        reasoning_effort=reasoning_effort,
        approval_mode=approval_mode,
        user=user,
        emit=emit,
    )
    ctx.emit = emit
    await _emit_event(
        ctx,
        "run.started",
        {
            "model": ctx.model.get("name"),
            "provider": ctx.provider.get("name"),
            "demo_mode": ctx.config["demo_mode"],
            "approval_mode": ctx.approval_mode,
            "tools": [spec.name for spec in ctx.tools],
        },
    )
    image_attachments = _validate_attachments(ctx.model, attachments or [])

    if session:
        current_assistant = session.get("assistant_id")
        wanted_assistant = (ctx.assistant or {}).get("id")
        if wanted_assistant and current_assistant != wanted_assistant:
            session = (
                sessions.set_session_assistant(
                    session_id, ctx.user["id"], wanted_assistant
                )
                or session
            )
    else:
        session = sessions.create_session(
            ctx.user,
            title=text[:28],
            assistant_id=(ctx.assistant or {}).get("id"),
        )
    ctx.session_id = session["id"]

    context_config = dict(ctx.config)
    context_config["context_max_tokens"] = ctx.budget["context_max_tokens"]
    summary_model, summary_provider = _summary_target(ctx)
    await _emit_event(ctx, "run.phase", {
        "phase": "context", "title": "正在检查对话上下文",
    })
    plan = await context_planner.prepare_context(
        session,
        ctx.user["id"],
        ctx.model,
        context_config,
        summary_model=summary_model,
        summary_provider=summary_provider,
        trigger="auto",
        on_compaction=lambda: _emit_event(ctx, "run.phase", {
            "phase": "compaction", "title": "正在压缩较早对话",
        }),
    )
    ctx.budget["context_budget_tokens"] = plan.budget_tokens
    if plan.compaction:
        ctx.last_compaction = plan.compaction
    await _emit_event(ctx, "context", plan.public())

    stored_attachments = [
        {"name": item["name"], "mime_type": item["mime_type"], "bytes": item["bytes"]}
        for item in image_attachments
    ]
    sessions.add_message(
        ctx.session_id,
        role="user",
        content=text,
        attachments=stored_attachments,
        metadata={"model_row_id": ctx.model["id"]},
    )
    sessions.maybe_title_session(ctx.session_id, ctx.user["id"], text)

    if ctx.config["demo_mode"]:
        if (ctx.assistant or {}).get("mode") == "report":
            result = await _report_chat(ctx, text, image_attachments, plan.messages)
        else:
            result = await _demo_chat(ctx, text)
        if image_attachments:
            result["answer"] = (
                f"已接收 {len(image_attachments)} 张图片。当前处于演示模式，"
                "不会把图片发送给外部模型；配置供应商 API Key 并关闭演示模式后，"
                "Agent 会以 OpenAI-compatible 多模态消息格式提交图片。\n\n"
                + result.get("answer", "")
            )
    elif (ctx.assistant or {}).get("mode") == "report":
        result = await _report_chat(ctx, text, image_attachments, plan.messages)
    else:
        system_prompt = build_system_prompt(
            ctx.user,
            ctx.skills,
            ctx.config["system_prompt_extra"],
            ctx.model,
            ctx.provider,
            assistant=ctx.assistant,
            memories=ctx.memories,
        )
        llm_messages = [
            {"role": "system", "content": system_prompt},
            *plan.messages,
            {
                "role": "user",
                "content": _multimodal_user_content(text, image_attachments),
            },
        ]
        result = await _llm_loop(ctx, llm_messages, [], [], round_count=0)
        result["system_prompt_preview"] = system_prompt

    result["session_id"] = ctx.session_id
    result["context"] = {**plan.public(), **(result.get("context") or {})}
    if plan.compaction and plan.compaction.get("usage"):
        result["usage"] = merge_usage(
            result.get("usage"), plan.compaction.get("usage")
        )
        ctx.retry_count += int(
            (plan.compaction.get("usage") or {}).get("retry_count") or 0
        )
    result["run"] = {
        **(result.get("run") or {}),
        "retry_count": ctx.retry_count,
        "steps_used": ctx.steps_used,
        "tool_calls_used": ctx.tool_calls_used,
    }
    result["assistant"] = result.get("assistant") or None
    _record_assistant_message(ctx, result)
    title_task = asyncio.create_task(_maybe_generate_title(ctx, text, str(result.get("answer") or "")))
    BACKGROUND_TASKS.add(title_task)
    title_task.add_done_callback(BACKGROUND_TASKS.discard)
    fresh_session = sessions.get_session(ctx.session_id, ctx.user["id"])
    if fresh_session:
        result["session_usage"] = {
            "total_input_tokens": fresh_session.get("total_input_tokens", 0),
            "total_output_tokens": fresh_session.get("total_output_tokens", 0),
            "total_tokens": fresh_session.get("total_tokens", 0),
            "total_cost_usd": fresh_session.get("total_cost_usd", 0),
            "retry_count": fresh_session.get("retry_count", 0),
            "compaction_count": fresh_session.get("compaction_count", 0),
            "message_count": fresh_session.get("message_count", 0),
        }

    db.log_audit(
        username=ctx.user["username"],
        action="agent.chat",
        resource=f"session:{ctx.session_id}",
        detail={
            "model": ctx.model["model_id"],
            "provider": ctx.provider["name"],
            "assistant": (ctx.assistant or {}).get("name"),
            "mode": (ctx.assistant or {}).get("mode", "agent"),
            "approval_mode": ctx.approval_mode,
            "demo_mode": ctx.config["demo_mode"],
            "status": result.get("status"),
            "tools": result.get("enabled_tools", []),
            "images": len(image_attachments),
            "message": text[:200],
        },
    )
    return result


def _clear_pending_approval(session_id: str, approval_id: str, status: str) -> None:
    if not session_id:
        return
    message = sessions.find_message_by_approval(session_id, approval_id)
    if not message:
        return
    metadata = dict(message.get("metadata") or {})
    metadata["approval"] = None
    metadata["approval_status"] = status
    sessions.update_message(message["id"], metadata=metadata)


async def resolve_approval(
    approval_id: str, token: str, approve: bool
) -> dict[str, Any]:
    user = await identity_from_token(token)
    with db.connect() as conn:
        row = conn.execute(
            "SELECT session_id FROM pending_approvals WHERE id = ? AND user_id = ?",
            (approval_id, user["id"]),
        ).fetchone()
    with session_run(row["session_id"] if row else None):
        return await _resolve_approval(approval_id, token, approve, user)


async def _resolve_approval(
    approval_id: str, token: str, approve: bool, user: dict[str, Any],
) -> dict[str, Any]:
    stored, reason = db.claim_pending_approval(approval_id, int(user["id"]))
    if stored is None:
        if reason == "forbidden":
            raise AgentError("不能操作其他用户的审批", 403)
        if reason == "expired":
            raise AgentError("审批已超时，请重新发起请求", 410)
        if reason not in {"missing", "processed"}:
            raise AgentError("审批已被处理或正在执行，请刷新会话", 409)
        raise AgentError("审批已失效或不存在", 404)

    session_id = str(stored.get("session_id") or "")
    calls = stored.get("calls") or []
    tool_runs = stored.get("tool_runs") or []
    if not calls:
        db.finish_pending_approval(approval_id, "failed")
        raise AgentError("审批内容已损坏，请重新发起请求", 400)
    call = calls[0]

    if not approve:
        run = _find_run(tool_runs, call["id"])
        if run:
            run.update({"status": "rejected", "summary": "用户已取消该操作", "result": None})
        for remaining in calls[1:]:
            other = _find_run(tool_runs, remaining["id"])
            if other:
                other.update({"status": "rejected", "summary": "用户已取消该操作"})
        db.log_audit(
            username=user["username"],
            action="approval.reject",
            resource=f"tool:{call['name']}",
            detail={"arguments": _display_arguments(call["name"], call.get("arguments", {}))},
        )
        db.finish_pending_approval(approval_id, "rejected")
        _clear_pending_approval(session_id, approval_id, "rejected")
        result = {
            "status": "ok",
            "answer": "已取消操作，没有对业务数据做任何修改。",
            "tool_runs": tool_runs,
            "session_id": session_id,
        }
        if session_id:
            sessions.add_message(
                session_id,
                role="assistant",
                content=result["answer"],
                tool_runs=tool_runs,
                metadata={
                    "status": "ok",
                    "approval": None,
                    "approval_status": "rejected",
                },
            )
            sessions.apply_usage(
                session_id,
                stored.get("usage") or {},
                status="ok",
                tool_runs=tool_runs,
            )
        return result

    try:
        ctx = await build_context(
            token,
            int(stored["model_row_id"]) if stored.get("model_row_id") else None,
            stored.get("requested_tools"),
            int(stored["assistant_id"]) if stored.get("assistant_id") else None,
            reasoning_effort=str(stored.get("reasoning_effort") or "") or None,
            user=user,
        )
        if not session_id or not sessions.get_session(session_id, user["id"]):
            raise AgentError("审批所属会话已不存在", 404)
        ctx.session_id = session_id
        spec = next(
            (item for item in ctx.all_tools if item.name == call["name"]), None
        )
        if spec is None:
            raise AgentError("审批对应的工具已不可用", 400)
        setting = db.get_tool_settings().get(
            spec.name, db.default_tool_setting(spec.name, spec.source)
        )
        assistant_tools = (
            set(ctx.assistant["tool_names"])
            if ctx.assistant and ctx.assistant.get("tool_names")
            else None
        )
        if not _tool_available(
            spec,
            user,
            {spec.name: setting},
            stored.get("requested_tools"),
            assistant_tools,
        ):
            raise AgentError("管理员或账号权限已变更，该工具当前不可用", 403)
    except Exception:
        db.finish_pending_approval(approval_id, "failed")
        raise

    pending = PendingApproval(
        id=approval_id,
        ctx=ctx,
        messages=stored.get("messages") or [],
        calls=calls,
        tool_runs=tool_runs,
        round_count=int(stored.get("round_count") or 0),
        tool_call_total=int(stored.get("tool_call_total") or 0),
        usage=stored.get("usage") or {},
        created_at=float(stored.get("created_at") or time.time()),
        expires_at=float(stored.get("expires_at") or time.time()),
        mode=str(stored.get("mode") or "llm"),
    )

    db.log_audit(
        username=ctx.user["username"],
        action="approval.approve",
        resource=f"tool:{call['name']}",
        detail={"arguments": _display_arguments(call["name"], call.get("arguments", {}))},
    )

    if pending.mode == "demo":
        execution, run = await _execute(ctx, spec, call, pending.tool_runs)
        _ = execution
        answer = _demo_answer_for_run(spec.name, run, ctx)
        result = _response(
            ctx,
            status="ok",
            answer=answer,
            tool_runs=pending.tool_runs,
            usage=pending.usage,
        )
        db.finish_pending_approval(approval_id, "approved")
        _clear_pending_approval(session_id, approval_id, "approved")
        _record_assistant_message(ctx, result)
        return result

    result = await _llm_loop(
        ctx,
        pending.messages,
        pending.calls,
        pending.tool_runs,
        approved_ids={call["id"]},
        round_count=pending.round_count,
        tool_call_total=pending.tool_call_total,
        usage=pending.usage,
    )
    db.finish_pending_approval(approval_id, "approved")
    _clear_pending_approval(session_id, approval_id, "approved")
    _record_assistant_message(ctx, result)
    return result


async def compact_session_now(
    token: str,
    session_id: str,
    model_row_id: int | None = None,
) -> dict[str, Any]:
    with session_run(session_id):
        return await _compact_session_now(token, session_id, model_row_id)


async def _compact_session_now(
    token: str,
    session_id: str,
    model_row_id: int | None = None,
) -> dict[str, Any]:
    user = await identity_from_token(token)
    session = sessions.get_session(session_id, user["id"])
    if session is None:
        raise AgentError("会话不存在或不属于当前账号", 404)
    model = db.get_model(model_row_id) if model_row_id else None
    if model is None and session.get("last_model_id"):
        model = db.get_model(int(session["last_model_id"]))
    if model is None:
        model = db.default_model()
    if model is None:
        raise AgentError("没有可用模型，请先在 AI 配置中添加并启用模型", 400)
    provider = db.get_provider(int(model["provider_id"])) if model.get("provider_id") else None
    config = runtime_config()
    summary_model, summary_provider = _summary_target_for(model, config)
    result = await context_planner.compact_session(
        session,
        user["id"],
        model,
        config,
        summary_model=summary_model,
        summary_provider=summary_provider,
        trigger="manual",
        keep_ratio=float(config.get("compaction_keep_ratio") or 0.58),
    )
    if result.get("ok") and result.get("usage"):
        sessions.add_token_usage(session_id, result.get("usage"))
    refreshed = sessions.get_session(session_id, user["id"])
    db.log_audit(
        username=user["username"],
        action="session.compact",
        resource=f"session:{session_id}",
        detail={
            "ok": result.get("ok"),
            "before_tokens": result.get("before_tokens"),
            "after_tokens": result.get("after_tokens"),
            "saved_tokens": result.get("saved_tokens"),
            "summary_model": result.get("summary_model"),
        },
    )
    return {
        "session": refreshed,
        "compaction": result,
        "provider_ready": bool(provider),
    }


async def admin_all_tools(token: str) -> list[dict[str, Any]]:
    user = await identity_from_token(token)
    if not user.get("is_admin"):
        raise AgentError("仅管理员可查看工具配置", 403)
    mcp_error = ""
    try:
        specs = await list_tools(token)
    except Exception as exc:  # noqa: BLE001 - dynamic tools remain manageable
        mcp_error = str(exc)
        specs = []
    specs.extend(dynamic_tools.list_specs(include_disabled=True))
    specs.extend(pagepilot.local_read_specs())
    pagepilot_spec = pagepilot.spec_if_available()
    if pagepilot_spec is not None:
        specs.append(pagepilot_spec)
    settings = db.get_tool_settings()
    items = []
    for spec in specs:
        config = settings.get(spec.name) or db.default_tool_setting(
            spec.name, spec.source
        )
        item = spec.public(enabled=config["enabled"])
        item.update(
            {
                "visible": config["visible"],
                "selectable": config["selectable"],
                "default_selected": config["default_selected"],
                "definition": config.get("definition") or {},
            }
        )
        items.append(item)
    if mcp_error:
        for item in items:
            if item.get("source") == "mcp":
                item["error"] = mcp_error
    return items


async def user_tools(
    token: str, assistant_id: int | None = None
) -> list[dict[str, Any]]:
    user = await identity_from_token(token)
    try:
        specs = await list_tools(token)
    except Exception as exc:  # noqa: BLE001 - dynamic tools remain usable
        specs = []
        mcp_error = str(exc)
    else:
        mcp_error = ""
    specs.extend(dynamic_tools.list_specs(include_disabled=False))
    specs.extend(pagepilot.local_read_specs())
    pagepilot_spec = pagepilot.spec_if_enabled()
    if pagepilot_spec is not None:
        specs.append(pagepilot_spec)
    settings = db.get_tool_settings()
    assistant = db.get_assistant(assistant_id) if assistant_id else None
    assistant_tools = (
        set(assistant["tool_names"])
        if assistant and assistant.get("tool_names")
        else None
    )
    items = []
    for spec in specs:
        config = settings.get(spec.name) or db.default_tool_setting(
            spec.name, spec.source
        )
        if not _tool_available(spec, user, settings, [spec.name], assistant_tools):
            continue
        if not config.get("visible", True):
            continue
        item = spec.public(enabled=True)
        item.update(
            {
                "visible": True,
                "selectable": config["selectable"],
                "default_selected": config["default_selected"],
                "source": spec.source,
            }
        )
        items.append(item)
    if mcp_error and not items:
        raise AgentError(f"MCP 工具服务不可用：{mcp_error}", 503)
    return items
