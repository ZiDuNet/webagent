"""Server-side Agent loop, RBAC-aware tool selection and approval workflow."""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import re
import secrets
import time
from dataclasses import dataclass, field
from typing import Any

import httpx2

from webagent.agent import context as context_planner
from webagent.agent import db, sessions
from webagent.agent.llm import (
    build_system_prompt,
    chat_completion,
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


class AgentError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


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
    global_tool_settings: dict[str, bool]
    requested_tools: list[str] | None
    assistant: dict[str, Any] | None = None
    budget: dict[str, int] = field(default_factory=dict)
    memories: list[dict[str, Any]] = field(default_factory=list)
    session_id: str | None = None
    started_at: float = field(default_factory=time.time)

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
    created_at: float = field(default_factory=time.time)
    expires_at: float = field(default_factory=lambda: time.time() + APPROVAL_TTL_SECONDS)
    mode: str = "llm"


_pending: dict[str, PendingApproval] = {}
_pending_lock = asyncio.Lock()


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
    global_settings: dict[str, bool],
    requested: list[str] | None,
    assistant_tools: set[str] | None = None,
) -> bool:
    if spec.permission not in user.get("permissions", []):
        return False
    if not global_settings.get(spec.name, True):
        return False
    if requested is not None and spec.name not in requested:
        return False
    if assistant_tools is not None and spec.name not in assistant_tools:
        return False
    return True


async def build_context(
    token: str,
    model_row_id: int | None,
    requested_tools: list[str] | None,
    assistant_id: int | None = None,
) -> AgentContext:
    user = await identity_from_token(token)
    assistant = None
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
    provider_id = model.get("provider_id")
    if not provider_id:
        raise AgentError("所选模型没有关联供应商", 400)
    provider = db.get_provider(int(provider_id))
    if not provider:
        raise AgentError("所选模型没有关联供应商", 400)
    if not provider["enabled"]:
        raise AgentError("所选模型的供应商已被管理员停用", 400)

    config = runtime_config()
    if not config["demo_mode"]:
        ready, reason = provider_ready(provider)
        if not ready:
            raise AgentError(reason, 400)
    skills = db.get_skills(include_disabled=False)
    if assistant and assistant.get("skill_ids"):
        wanted = set(assistant["skill_ids"])
        skills = [skill for skill in skills if int(skill["id"]) in wanted]
    try:
        all_specs = await list_tools(token)
    except Exception as exc:  # noqa: BLE001 - surfaced as a service error
        raise AgentError(f"MCP 工具服务不可用：{exc}", 503) from exc

    global_settings = db.get_tool_settings()
    assistant_tools = (
        set(assistant["tool_names"])
        if assistant and assistant.get("tool_names")
        else None
    )
    available = (
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
    budget = resolve_budget(config, assistant)
    memories: list[dict[str, Any]] = []
    if config.get("memory_enabled", True) and (
        assistant is None or assistant.get("memory_enabled", True)
    ):
        memories = sessions.list_memories(user["id"], include_disabled=False)
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
        assistant=assistant,
        budget=budget,
        memories=memories,
    )


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
    return f"将执行工具 {spec.name}。"


def _find_run(tool_runs: list[dict[str, Any]], call_id: str) -> dict[str, Any] | None:
    return next((run for run in tool_runs if run.get("call_id") == call_id), None)


async def _execute(
    ctx: AgentContext,
    spec: ToolSpec,
    call: dict[str, Any],
    tool_runs: list[dict[str, Any]],
) -> tuple[ToolExecution, dict[str, Any]]:
    arguments = call.get("arguments") or {}
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
            "arguments": arguments,
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
        },
        "demo_mode": ctx.config["demo_mode"],
        "enabled_tools": [spec.name for spec in ctx.tools],
        "budget": {
            "max_steps": ctx.budget.get("max_steps"),
            "max_tool_calls": ctx.budget.get("max_tool_calls"),
            "max_run_seconds": ctx.budget.get("max_run_seconds"),
        },
        "usage": usage or {},
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
    async with _pending_lock:
        now = time.time()
        expired = [key for key, item in _pending.items() if item.expires_at < now]
        for key in expired:
            _pending.pop(key, None)
        _pending[pending.id] = pending


def _approval_payload(pending: PendingApproval, call: dict[str, Any]) -> dict[str, Any]:
    spec = next((item for item in pending.ctx.all_tools if item.name == call["name"]), None)
    risk = spec.risk if spec else "write"
    return {
        "id": pending.id,
        "tool": call["name"],
        "arguments": call.get("arguments", {}),
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
            "arguments": call.get("arguments", {}),
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
        mode=mode,
    )
    await _store_pending(pending)
    return _response(
        ctx,
        status="approval_required",
        answer="该操作需要你的确认，请在审批卡中批准或取消。",
        tool_runs=tool_runs,
        approval=_approval_payload(pending, call),
    )


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
    tool_schemas = openai_tools(ctx.tools)
    specs = {spec.name: spec for spec in ctx.tools}

    while True:
        if time.time() > ctx.deadline:
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
                        "arguments": call.get("arguments", {}),
                        "risk": "write",
                        "status": "error",
                        "summary": error.text,
                        "result": error.text,
                        "result_text": error.text,
                    }
                )
                calls.pop(0)
                continue

            if spec.risk in ("write", "delete") and call["id"] not in approved_ids:
                return await _create_approval(
                    ctx,
                    messages,
                    calls,
                    tool_runs,
                    round_count,
                    "llm",
                    tool_call_total,
                )

            tool_call_total += 1
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
            execution, _ = await _execute(ctx, spec, call, tool_runs)
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

        try:
            completion = await chat_completion(
                messages=messages,
                tools=tool_schemas,
                model=ctx.model,
                provider=ctx.provider,
                config=ctx.config,
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
        usage = completion.get("usage") or usage
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
    if not ctx.global_tool_settings.get(spec.name, True):
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

    if spec.risk in ("write", "delete"):
        return await _create_approval(ctx, [], [call], tool_runs, 0, "demo")

    execution, run = await _execute(ctx, spec, call, tool_runs)
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
        if time.time() > ctx.deadline:
            break
        call = {
            "id": f"prefetch-{secrets.token_hex(4)}",
            "name": name,
            "arguments": {},
        }
        execution, _run = await _execute(ctx, spec, call, tool_runs)
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
        completion = await chat_completion(
            messages=messages,
            tools=[],
            model=ctx.model,
            provider=ctx.provider,
            config=ctx.config,
        )
    except Exception as exc:  # noqa: BLE001 - surfaced to the UI
        return _response(
            ctx,
            status="error",
            answer=f"LLM 调用失败：{str(exc)[:500]}",
            tool_runs=tool_runs,
        )
    result = _response(
        ctx,
        status="ok",
        answer=(completion.get("content") or "").strip()
        or "模型没有返回报告内容。",
        tool_runs=tool_runs,
        usage=completion.get("usage") or {},
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
    sessions.add_message(
        ctx.session_id,
        role="assistant",
        content=str(result.get("answer") or "").strip(),
        tool_runs=result.get("tool_runs") or [],
        metadata={
            "status": result.get("status"),
            "model": result.get("model"),
            "assistant": result.get("assistant"),
            "usage": result.get("usage") or {},
            "budget": result.get("budget") or {},
            "context": result.get("context") or {},
            "approval": result.get("approval"),
        },
    )


async def chat(
    token: str,
    text: str,
    model_row_id: int | None,
    enabled_tools: list[str] | None,
    *,
    assistant_id: int | None = None,
    session_id: str | None = None,
    attachments: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    text = str(text or "").strip()
    if not text:
        raise AgentError("消息不能为空", 422)

    ctx = await build_context(token, model_row_id, enabled_tools, assistant_id)
    image_attachments = _validate_attachments(ctx.model, attachments or [])

    session = None
    if session_id:
        session = sessions.get_session(session_id, ctx.user["id"])
        if session is None:
            raise AgentError("会话不存在或不属于当前账号", 404)
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
    plan = context_planner.prepare_context(
        session, ctx.user["id"], ctx.model, context_config
    )

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
    result["context"] = plan.public()
    result["assistant"] = result.get("assistant") or None
    _record_assistant_message(ctx, result)

    db.log_audit(
        username=ctx.user["username"],
        action="agent.chat",
        resource=f"session:{ctx.session_id}",
        detail={
            "model": ctx.model["model_id"],
            "provider": ctx.provider["name"],
            "assistant": (ctx.assistant or {}).get("name"),
            "mode": (ctx.assistant or {}).get("mode", "agent"),
            "demo_mode": ctx.config["demo_mode"],
            "status": result.get("status"),
            "tools": result.get("enabled_tools", []),
            "images": len(image_attachments),
            "message": text[:200],
        },
    )
    return result


def _clear_pending_approval(
    ctx: AgentContext, approval_id: str, status: str
) -> None:
    if not ctx.session_id:
        return
    message = sessions.find_message_by_approval(ctx.session_id, approval_id)
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
    async with _pending_lock:
        pending = _pending.get(approval_id)
        if pending is not None and (
            pending.expires_at < time.time() or pending.ctx.user["id"] != user["id"]
        ):
            pending = None
        else:
            _pending.pop(approval_id, None)
    if pending is None:
        raise AgentError("审批已失效或不存在", 404)
    if pending.expires_at < time.time():
        raise AgentError("审批已超时，请重新发起请求", 410)
    if pending.ctx.user["id"] != user["id"]:
        raise AgentError("不能操作其他用户的审批", 403)

    ctx = pending.ctx
    call = pending.calls[0]
    spec = next((item for item in ctx.all_tools if item.name == call["name"]), None)
    if spec is None:
        raise AgentError("审批对应的工具已不可用", 400)
    if spec.permission not in user.get("permissions", []):
        raise AgentError("当前账号已不具备该工具权限", 403)
    if not db.get_tool_settings().get(spec.name, True):
        raise AgentError("管理员已停用该工具，请重新发起请求", 403)

    if not approve:
        run = _find_run(pending.tool_runs, call["id"])
        if run:
            run.update({"status": "rejected", "summary": "用户已取消该操作", "result": None})
        for remaining in pending.calls[1:]:
            other = _find_run(pending.tool_runs, remaining["id"])
            if other:
                other.update({"status": "rejected", "summary": "用户已取消该操作"})
        db.log_audit(
            username=ctx.user["username"],
            action="approval.reject",
            resource=f"tool:{call['name']}",
            detail={"arguments": call.get("arguments", {})},
        )
        result = _response(
            ctx,
            status="ok",
            answer="已取消操作，没有对业务数据做任何修改。",
            tool_runs=pending.tool_runs,
        )
        _clear_pending_approval(ctx, approval_id, "rejected")
        _record_assistant_message(ctx, result)
        return result

    db.log_audit(
        username=ctx.user["username"],
        action="approval.approve",
        resource=f"tool:{call['name']}",
        detail={"arguments": call.get("arguments", {})},
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
        )
        _clear_pending_approval(ctx, approval_id, "approved")
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
    )
    _clear_pending_approval(ctx, approval_id, "approved")
    _record_assistant_message(ctx, result)
    return result


async def admin_all_tools(token: str) -> list[dict[str, Any]]:
    user = await identity_from_token(token)
    if not user.get("is_admin"):
        raise AgentError("仅管理员可查看工具配置", 403)
    try:
        specs = await list_tools(token)
    except Exception as exc:  # noqa: BLE001
        raise AgentError(f"MCP 工具服务不可用：{exc}", 503) from exc
    settings = db.get_tool_settings()
    return [
        spec.public(enabled=settings.get(spec.name, True))
        for spec in specs
    ]


async def user_tools(
    token: str, assistant_id: int | None = None
) -> list[dict[str, Any]]:
    user = await identity_from_token(token)
    try:
        specs = await list_tools(token)
    except Exception as exc:  # noqa: BLE001
        raise AgentError(f"MCP 工具服务不可用：{exc}", 503) from exc
    settings = db.get_tool_settings()
    assistant = db.get_assistant(assistant_id) if assistant_id else None
    assistant_tools = (
        set(assistant["tool_names"])
        if assistant and assistant.get("tool_names")
        else None
    )
    return [
        spec.public(enabled=True)
        for spec in specs
        if _tool_available(spec, user, settings, None, assistant_tools)
    ]
