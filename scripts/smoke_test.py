#!/usr/bin/env python3
"""Smoke-test the running demo without permanently mutating business data.

The script exercises the same-origin Agent proxy exactly like the browser does.
It creates and removes one temporary chat session for compaction coverage and
restores any temporary runtime settings even when an assertion fails.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import httpx2


BASE = os.getenv("WEBAGENT_SMOKE_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
AGENT_DB_PATH = Path(
    os.getenv(
        "WEBAGENT_AGENT_DB",
        Path(__file__).resolve().parents[1] / "data" / "agent.db",
    )
)


class FakePagePilot(BaseHTTPRequestHandler):
    last_deploy: dict = {}
    last_update: dict = {}
    last_access: dict = {}
    last_visibility: dict = {}

    def _json(self, data: dict, status: int = 200) -> None:
        raw = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:  # noqa: N802 - http.server API
        if self.path == "/api/health":
            self._json({"success": True, "status": "ok"})
        elif self.path == "/api/tokens":
            if self.headers.get("Authorization") == "Bearer smoke-pagepilot-token":
                self._json({"success": True, "items": []})
            else:
                self._json({"success": False, "detail": "token not recognized"}, 401)
        else:
            self._json({"success": False, "detail": "not found"}, 404)

    def do_POST(self) -> None:  # noqa: N802 - http.server API
        if self.path != "/api/deploy":
            self._json({"success": False, "detail": "not found"}, 404)
            return
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")
        if self.headers.get("Authorization") != "Bearer smoke-pagepilot-token":
            self._json({"success": False, "detail": "unauthorized"}, 401)
            return
        if body.get("createVersion"):
            if body.get("customCode") != "smoke" or body.get("enableCustomCode") is not True:
                self._json({"success": False, "detail": "invalid version target"}, 422)
                return
            type(self).last_update = body
        else:
            type(self).last_deploy = body
        self._json(
            {
                "success": True,
                "url": "https://pagepilot.test/s/smoke",
                "detailUrl": "https://pagepilot.test/d/smoke",
                "code": "smoke",
                "versionNumber": 2 if body.get("createVersion") else 1,
                "size": len(body.get("content", "")),
            }
        )

    def do_PATCH(self) -> None:  # noqa: N802 - http.server API
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")
        if self.headers.get("Authorization") != "Bearer smoke-pagepilot-token":
            self._json({"success": False, "detail": "unauthorized"}, 401)
            return
        if self.path == "/api/deploys/smoke/access":
            type(self).last_access = body
            self._json({"success": True})
            return
        if self.path == "/api/deploys/smoke/visibility":
            type(self).last_visibility = body
            self._json({"success": True})
            return
        if self.path == "/api/deploy/content":
            type(self).last_update = body
            self._json(
                {
                    "success": True,
                    "url": "https://pagepilot.test/s/smoke",
                    "detailUrl": "https://pagepilot.test/d/smoke",
                    "code": "smoke",
                    "versionNumber": 2,
                    "size": len(body.get("content", "")),
                }
            )
            return
        self._json({"success": False, "detail": "not found"}, 404)

    def log_message(self, *_args) -> None:
        return


def login(username: str, password: str) -> httpx2.Client:
    client = httpx2.Client(base_url=BASE, timeout=60)
    response = client.post("/api/login", json={"username": username, "password": password})
    response.raise_for_status()
    return client


def check(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)
    print(f"  ok  {message}")


def agent_json(client: httpx2.Client, method: str, path: str, **kwargs):
    response = client.request(method, f"/api/agent{path}", **kwargs)
    response.raise_for_status()
    return response.json()


def parse_sse(lines):
    event = ""
    data_lines: list[str] = []
    event_id = 0
    for line in lines:
        if line.startswith("id: "):
            event_id = int(line[4:].strip() or 0)
        elif line.startswith("event: "):
            event = line[7:].strip()
        elif line.startswith("data: "):
            data_lines.append(line[6:])
        elif line == "" and event:
            raw = "\n".join(data_lines)
            try:
                payload = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                payload = {"raw": raw}
            yield event_id, event, payload
            event = ""
            data_lines = []
            event_id = 0


def run_checks(admin: httpx2.Client) -> None:
    print("1. user1 只读")
    user1 = login("user1", "user1pass")
    tools = agent_json(user1, "GET", "/tools")["items"]
    names = {tool["name"] for tool in tools}
    check("list_devices" in names, "user1 能看到 list_devices")
    check("update_device" not in names, "user1 看不到 update_device")
    check("delete_device" not in names, "user1 看不到 delete_device")
    chat = agent_json(
        user1, "POST", "/chat", json={"message": "查看全部设备"}
    )
    check(chat["status"] == "ok", "user1 查询设备成功")
    check(any(run["tool"] == "list_devices" for run in chat["tool_runs"]), "发生了真实 MCP 工具调用")
    denied = agent_json(user1, "POST", "/chat", json={"message": "删除 4 号设备"})
    check("缺少" in denied["answer"] and "device:delete" in denied["answer"], "user1 删除被拒绝")

    print("2. user2 修改需要审批")
    user2 = login("user2", "user2pass")
    pending = agent_json(
        user2, "POST", "/chat", json={"message": "把 2 号设备状态改为维护中"}
    )
    check(pending["status"] == "approval_required", "user2 修改进入审批")
    check(pending["approval"]["risk"] == "write", "风险等级为 write")
    rejected = agent_json(
        user2, "POST", f"/approvals/{pending['approval']['id']}/reject"
    )
    check(rejected["status"] == "ok", "user2 可以取消审批")

    print("3. user3 删除需要审批")
    user3 = login("user3", "user3pass")
    pending = agent_json(
        user3, "POST", "/chat", json={"message": "删除 4 号设备"}
    )
    check(pending["status"] == "approval_required", "user3 删除进入审批")
    check(pending["approval"]["risk"] == "delete", "风险等级为 delete")
    rejected = agent_json(
        user3, "POST", f"/approvals/{pending['approval']['id']}/reject"
    )
    check(rejected["status"] == "ok", "user3 可以取消审批")

    print("4. 管理员治理")
    admin_tools = agent_json(admin, "GET", "/admin/tools")
    check(admin_tools["total"] >= 8, "管理员能看到全部工具")
    check(agent_json(admin, "GET", "/admin/models")["items"], "管理员能看到模型")
    check(admin.get("/api/users").json()["items"], "管理员能看到用户")
    check(admin.get("/api/audit").json()["items"], "业务审计有记录")
    check(agent_json(admin, "GET", "/admin/audit")["items"], "Agent 审计有记录")

    print("5. Skill 渐进式加载元数据")
    skills = agent_json(admin, "GET", "/admin/skills")["items"]
    inspection = next(
        (skill for skill in skills if skill.get("slug") == "device-inspection"),
        None,
    )
    check(inspection is not None, "管理员能看到 device-inspection")
    check(
        "references/status-codes.md" in (inspection.get("files") or {}),
        "Skill 参考文件已登记",
    )
    duplicate_skill = admin.post(
        "/api/agent/admin/skills",
        json={
            "name": "重复标识测试",
            "slug": "device-inspection",
            "content": "不应被创建",
        },
    )
    check(duplicate_skill.status_code == 409, "Skill slug 唯一性生效")

    print("6. 管理员会话管理")
    all_sessions = agent_json(admin, "GET", "/admin/sessions?limit=5")
    check(bool(all_sessions["items"]), "管理员能看到所有用户会话")
    target = all_sessions["items"][0]
    check(target.get("username") in {"admin", "user1", "user2", "user3"}, "会话带用户归属")
    detail = agent_json(admin, "GET", f"/admin/sessions/{target['id']}")
    check("messages" in detail and "session" in detail, "管理员能查看会话详情")
    check(
        all(key in detail for key in ("compaction_events", "llm_calls", "privacy")),
        "会话详情包含压缩、LLM 调用和隐私状态",
    )
    export_response = admin.get(
        f"/api/agent/admin/sessions/{target['id']}/export?format=markdown"
    )
    export_response.raise_for_status()
    check("# 会话" in export_response.text, "管理员能导出 Markdown 会话记录")
    denied_sessions = user1.get("/api/agent/admin/sessions")
    check(denied_sessions.status_code == 403, "普通用户不能查看全局会话")

    print("7. 用量统计")
    usage = agent_json(admin, "GET", "/usage/me?days=7")
    check("totals" in usage["usage"] and "by_day" in usage["usage"], "个人用量统计可用")
    check("daily_limit" in usage and "used_today" in usage, "每日额度状态可用")

    print("8. 上下文压缩")
    original = agent_json(admin, "GET", "/config")
    temp_session = None
    temp_text = "查看全部设备。" + "这是用于验证上下文压缩的长文本。" * 250
    try:
        agent_json(
            admin,
            "PUT",
            "/config",
            json={
                "context_max_tokens": 4096,
                "context_reserve_tokens": 0,
                "compaction_keep_ratio": 0.2,
                "demo_mode": True,
            },
        )
        temp_session = agent_json(
            admin, "POST", "/sessions", json={"title": "冒烟测试-上下文压缩"}
        )["session"]
        compacted = False
        for _ in range(4):
            result = agent_json(
                admin,
                "POST",
                "/chat",
                json={"message": temp_text, "session_id": temp_session["id"]},
            )
            if (result.get("context") or {}).get("compressed"):
                compacted = True
        session = agent_json(
            admin, "GET", f"/sessions/{temp_session['id']}/messages"
        )["session"]
        check(
            compacted and int(session.get("compaction_count") or 0) >= 1,
            "历史过长时自动压缩并记录事件",
        )
        manual = agent_json(
            admin, "POST", f"/sessions/{temp_session['id']}/compact", json={}
        )
        check("compaction" in manual, "手动压缩接口可用")
    finally:
        if temp_session is not None:
            admin.delete(f"/api/agent/sessions/{temp_session['id']}")
        agent_json(
            admin,
            "PUT",
            "/config",
            json={
                "context_max_tokens": original["context_max_tokens"],
                "context_reserve_tokens": original["context_reserve_tokens"],
                "compaction_keep_ratio": original["compaction_keep_ratio"],
                "demo_mode": original["demo_mode"],
            },
        )

    print("9. 默认助手与工具四态")
    tool_items = agent_json(admin, "GET", "/admin/tools")["items"]
    list_device = next(item for item in tool_items if item["name"] == "list_devices")
    original_tool = {
        "enabled": list_device["enabled"],
        "visible": list_device["visible"],
        "selectable": list_device["selectable"],
        "default_selected": list_device["default_selected"],
    }
    fixed_session = None
    try:
        agent_json(
            admin,
            "PUT",
            "/admin/tools/list_devices",
            json={
                "enabled": True,
                "visible": True,
                "selectable": False,
                "default_selected": True,
            },
        )
        created = agent_json(
            admin, "POST", "/sessions", json={"title": "冒烟测试-默认助手"}
        )["session"]
        fixed_session = created
        check(bool(created.get("assistant_id")), "未传助手时自动绑定默认助手")
        visible_tools = agent_json(
            admin, "GET", f"/tools?assistant_id={created['assistant_id']}"
        )["items"]
        fixed_tool = next(
            item for item in visible_tools if item["name"] == "list_devices"
        )
        check(
            fixed_tool["visible"] is True and fixed_tool["selectable"] is False,
            "可见固定工具仍出现在用户工具列表",
        )
        fixed_chat = agent_json(
            admin,
            "POST",
            "/chat",
            json={
                "message": "查看全部设备",
                "session_id": created["id"],
                "enabled_tools": ["list_devices"],
            },
        )
        check(
            any(run["tool"] == "list_devices" for run in fixed_chat["tool_runs"]),
            "可见固定工具不会被 selectable=false 错误过滤",
        )
    finally:
        agent_json(
            admin,
            "PUT",
            "/admin/tools/list_devices",
            json=original_tool,
        )
        if fixed_session is not None:
            admin.delete(f"/api/agent/sessions/{fixed_session['id']}")

    write_tool = next(item for item in tool_items if item["name"] == "delete_device")
    original_write = {
        "enabled": write_tool["enabled"],
        "visible": write_tool["visible"],
        "selectable": write_tool["selectable"],
        "default_selected": write_tool["default_selected"],
    }
    try:
        agent_json(
            admin,
            "PUT",
            "/admin/tools/delete_device",
            json={
                "enabled": True,
                "visible": False,
                "selectable": False,
                "default_selected": True,
            },
        )
        refreshed = agent_json(admin, "GET", "/admin/tools")["items"]
        hidden_write = next(item for item in refreshed if item["name"] == "delete_device")
        check(
            hidden_write["enabled"] is True
            and hidden_write["visible"] is False
            and hidden_write["default_selected"] is True,
            "写/删工具也支持不可见默认启用",
        )
    finally:
        agent_json(admin, "PUT", "/admin/tools/delete_device", json=original_write)

    original_bm25 = agent_json(admin, "GET", "/status").get("bm25_enabled", True)
    try:
        agent_json(admin, "PUT", "/config", json={"bm25_enabled": False})
        check(
            agent_json(admin, "GET", "/status").get("bm25_enabled") is False,
            "BM25 可以关闭",
        )
    finally:
        agent_json(admin, "PUT", "/config", json={"bm25_enabled": original_bm25})

    print("10. SSE 完整输出与断线重放")
    stream_session = agent_json(
        admin, "POST", "/sessions", json={"title": "冒烟测试-SSE"}
    )["session"]
    run_id = ""
    events = []
    try:
        with admin.stream(
            "POST",
            "/api/agent/chat/stream",
            json={
                "message": "查看全部设备",
                "session_id": stream_session["id"],
                "enabled_tools": ["list_devices"],
            },
            headers={"Accept": "text/event-stream"},
        ) as response:
            response.raise_for_status()
            run_id = response.headers.get("x-run-id", "")
            for event_id, event_name, payload in parse_sse(response.iter_lines()):
                events.append((event_id, event_name, payload))
        check(events and events[0][1] == "run.started", "SSE 收到 run.started")
        check(
            any(event == "tool.finished" for _, event, _ in events),
            "SSE 收到工具执行事件",
        )
        check(events[-1][1] == "run.completed", "SSE 以 run.completed 正常结束")
        replay_from = max(0, events[-1][0] - 2)
        with admin.stream(
            "GET",
            f"/api/agent/chat/stream/{run_id}",
            headers={
                "Accept": "text/event-stream",
                "Last-Event-ID": str(replay_from),
            },
        ) as resumed:
            resumed.raise_for_status()
            replayed = list(parse_sse(resumed.iter_lines()))
        check(
            replayed and replayed[-1][1] == "run.completed",
            "断线后可按 Last-Event-ID 恢复并收到完成事件",
        )
        user1 = login("user1", "user1pass")
        denied = user1.get(
            f"/api/agent/chat/stream/{run_id}",
            headers={"Accept": "text/event-stream"},
        )
        check(denied.status_code == 403, "不能恢复其他用户的运行流")
    finally:
        admin.delete(f"/api/agent/sessions/{stream_session['id']}")

    print("11. API Key 加密存储")
    provider = None
    try:
        provider = agent_json(
            admin,
            "POST",
            "/admin/providers",
            json={
                "name": "冒烟测试供应商",
                "base_url": "http://127.0.0.1:9/v1",
                "api_key": "smoke-test-secret-key",
                "enabled": False,
            },
        )["provider"]
        with sqlite3.connect(AGENT_DB_PATH) as conn:
            raw_key = conn.execute(
                "SELECT api_key FROM providers WHERE id = ?", (provider["id"],)
            ).fetchone()[0]
        check(raw_key.startswith("enc:v1:"), "供应商 API Key 以密文落库")
        check(
            "smoke-test-secret-key" not in raw_key,
            "数据库中没有明文 API Key",
        )
        public = agent_json(admin, "GET", "/admin/providers")["items"]
        current = next(item for item in public if item["id"] == provider["id"])
        check(
            "api_key" not in current
            and "smoke-test-secret-key" not in json.dumps(current, ensure_ascii=False),
            "管理接口不会下发明文 API Key",
        )
    finally:
        if provider is not None:
            admin.delete(f"/api/agent/admin/providers/{provider['id']}")

    print("12. 完全访问只跳过审批")
    settings = agent_json(admin, "GET", "/config")
    original_mode = settings.get("default_approval_mode", "confirm")
    original_allow = settings.get("allow_full_access", True)
    try:
        agent_json(
            admin,
            "PUT",
            "/config",
            json={"default_approval_mode": "confirm", "allow_full_access": True},
        )
        user2 = login("user2", "user2pass")
        devices = user2.get("/api/devices").json()["items"]
        device = next(item for item in devices if int(item["id"]) == 2)
        result = agent_json(
            user2,
            "POST",
            "/chat",
            json={
                "message": f"把 2 号设备状态改为{device['status']}",
                "approval_mode": "full_access",
            },
        )
        check(result["status"] == "ok", "完全访问下写操作不再进入审批")
        check(result.get("approval") is None, "完全访问响应不包含审批卡")
        check(
            any(
                run.get("tool") == "update_device" and run.get("status") == "ok"
                for run in result.get("tool_runs", [])
            ),
            "完全访问仍真实执行写工具",
        )
        check(
            result.get("approval_mode") == "full_access",
            "响应回显当前执行模式",
        )
        agent_json(admin, "PUT", "/config", json={"allow_full_access": False})
        forced = agent_json(
            user2,
            "POST",
            "/chat",
            json={
                "message": f"把 2 号设备状态改为{device['status']}",
                "approval_mode": "full_access",
            },
        )
        check(
            forced["status"] == "approval_required"
            and forced.get("approval_mode") == "confirm",
            "管理员关闭后，客户端不能强行使用完全访问",
        )
        agent_json(
            user2,
            "POST",
            f"/approvals/{forced['approval']['id']}/reject",
        )
    finally:
        agent_json(
            admin,
            "PUT",
            "/config",
            json={
                "default_approval_mode": original_mode,
                "allow_full_access": original_allow,
            },
        )

    print("13. 交互配置下发")
    settings = agent_json(admin, "GET", "/config")
    original_welcome = {
        "welcome_title": settings.get("welcome_title", ""),
        "welcome_subtitle": settings.get("welcome_subtitle", ""),
        "welcome_prompts": settings.get("welcome_prompts", ""),
        "default_reasoning_effort": settings.get("default_reasoning_effort", ""),
    }
    try:
        agent_json(
            admin,
            "PUT",
            "/config",
            json={
                "welcome_title": "冒烟测试标题",
                "welcome_subtitle": "冒烟测试副标题",
                "welcome_prompts": "查看全部设备\n统计设备状态",
                "default_reasoning_effort": "minimal",
            },
        )
        user1 = login("user1", "user1pass")
        status = agent_json(user1, "GET", "/status")
        check(status["welcome_title"] == "冒烟测试标题", "空态标题可从后台下发")
        check(
            status["welcome_prompts"].splitlines() == ["查看全部设备", "统计设备状态"],
            "空态问题可从后台下发",
        )
        check(
            status["default_reasoning_effort"] == "minimal",
            "推理等级支持 minimal",
        )
    finally:
        agent_json(admin, "PUT", "/config", json=original_welcome)

    print("13b. 模型类型与分类测试")
    admin_models = agent_json(admin, "GET", "/admin/models")["items"]
    chat_model = next(item for item in admin_models if item.get("model_kind") == "chat")
    tested = agent_json(admin, "POST", f"/admin/models/{chat_model['id']}/test")
    check(tested.get("ok") is True and tested.get("kind") == "chat", "对话模型测试返回类型与结果")
    suggested = agent_json(
        admin,
        "GET",
        "/admin/model-suggest?model_id=qwen3-asr-flash-realtime",
    )["suggested"]
    check(
        suggested.get("model_kind") == "asr_realtime"
        and suggested.get("supports_transcription") is True,
        "实时语音模型可被识别为 asr_realtime",
    )

    print("13c. 思考落库与会话消息操作")
    original_store_reasoning = agent_json(admin, "GET", "/config").get(
        "store_reasoning", False
    )
    try:
        updated = agent_json(admin, "PUT", "/config", json={"store_reasoning": True})
        check(updated.get("store_reasoning") is True, "思考原文保存开关可开启")
        status = agent_json(admin, "GET", "/status")
        check(status.get("store_reasoning") is True, "状态接口返回思考保存开关")
    finally:
        agent_json(admin, "PUT", "/config", json={"store_reasoning": original_store_reasoning})

    sessions_now = agent_json(user1, "GET", "/sessions")["items"]
    source = sessions_now[0]
    forked = agent_json(
        user1,
        "POST",
        f"/sessions/{source['id']}/fork",
        json={"title": "冒烟分叉"},
    )["session"]
    check(forked["title"] == "冒烟分叉", "会话可从已有会话分叉")
    forked_messages = agent_json(user1, "GET", f"/sessions/{forked['id']}/messages")["items"]
    user_message = next((m for m in forked_messages if m["role"] == "user"), None)
    if user_message:
        edited = agent_json(
            user1,
            "PATCH",
            f"/sessions/{forked['id']}/messages/{user_message['id']}",
            json={"content": "冒烟编辑消息"},
        )["message"]
        check(edited["content"] == "冒烟编辑消息", "用户消息可编辑")
        agent_json(
            user1,
            "DELETE",
            f"/sessions/{forked['id']}/messages/{user_message['id']}",
        )
        remaining = agent_json(user1, "GET", f"/sessions/{forked['id']}/messages")["items"]
        check(
            all(m["id"] != user_message["id"] for m in remaining),
            "用户消息可删除",
        )
    agent_json(user1, "DELETE", f"/sessions/{forked['id']}")
    check(
        all(item["id"] != forked["id"] for item in agent_json(user1, "GET", "/sessions")["items"]),
        "分叉会话可删除",
    )

    print("14. PagePilot 连接器与 HTML 截图")
    # 用户可能已经配置了真实 PagePilot。测试前快照 settings 里的密文配置，
    # 结束后原样回写，避免把真实 Token 覆盖或清空。
    pilot_tool = next(
        (
            item
            for item in agent_json(admin, "GET", "/admin/tools")["items"]
            if item["name"] == "publish_to_pagepilot"
        ),
        None,
    )
    with sqlite3.connect(AGENT_DB_PATH) as conn:
        saved_pilot_settings = dict(
            conn.execute(
                "SELECT key, value FROM settings WHERE key GLOB 'pagepilot_*'"
            ).fetchall()
        )
    server = ThreadingHTTPServer(("127.0.0.1", 0), FakePagePilot)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        saved = agent_json(
            admin,
            "PUT",
            "/admin/pagepilot",
            json={
                "base_url": f"http://127.0.0.1:{port}",
                "token": "smoke-pagepilot-token",
                "enabled": True,
                "default_description": "冒烟测试发布",
                "default_visibility": "unlisted",
            },
        )["config"]
        check(saved["configured"] and saved["token_set"], "PagePilot Token 已加密保存")
        agent_json(
            admin,
            "PUT",
            "/admin/tools/publish_to_pagepilot",
            json={
                "enabled": True,
                "visible": True,
                "selectable": True,
                "default_selected": True,
            },
        )
        test = agent_json(admin, "POST", "/admin/pagepilot/test")
        check(test["ok"], "PagePilot 测试连接成功")
        admin_tools = agent_json(admin, "GET", "/admin/tools")["items"]
        check(
            any(item["name"] == "publish_to_pagepilot" for item in admin_tools),
            "PagePilot 工具出现在管理员工具治理中",
        )
        user1 = login("user1", "user1pass")
        user_tools = agent_json(user1, "GET", "/tools")["items"]
        check(
            any(item["name"] == "publish_to_pagepilot" for item in user_tools),
            "普通用户可看到 PagePilot 发布工具",
        )
        with sqlite3.connect(AGENT_DB_PATH) as conn:
            raw_token = conn.execute(
                "SELECT value FROM settings WHERE key = 'pagepilot_token'"
            ).fetchone()[0]
        check(raw_token.startswith("enc:v1:"), "PagePilot Token 以密文落库")
        html = (
            "<!doctype html><html><head><title>冒烟报告</title></head>"
            "<body><h1>设备日报</h1></body></html>"
        )
        published = agent_json(
            user1,
            "POST",
            "/pagepilot/publish",
            json={
                "html": html,
                "title": "冒烟报告",
                "description": "接口测试",
                "access_password": "smoke-pass",
                "visibility": "public",
            },
        )
        check(published["url"].startswith("https://pagepilot.test/"), "预览发布返回公开地址")
        check(published["password_set"], "发布结果标记已设置访问密码")
        check(FakePagePilot.last_access.get("password") == "smoke-pass", "访问密码已提交 PagePilot")
        check(FakePagePilot.last_visibility.get("visibility") == "public", "可见范围已提交 PagePilot")
        check(
            FakePagePilot.last_deploy.get("content") == html,
            "PagePilot 收到原始 HTML",
        )
        updated = agent_json(
            user1,
            "POST",
            "/pagepilot/publish",
            json={
                "html": "<!doctype html><html><body><h1>更新后的报告</h1></body></html>",
                "title": "冒烟报告",
                "code": "smoke",
                "access_password": "",
                "visibility": "unlisted",
            },
        )
        check(updated["updated"], "PagePilot 更新已有页面")
        check(FakePagePilot.last_update.get("customCode") == "smoke", "更新请求携带已归属页面 customCode")
        check(FakePagePilot.last_update.get("createVersion") is True and FakePagePilot.last_update.get("enableCustomCode") is True, "按 PagePilot 官方版本发布协议追加内容")
        check(FakePagePilot.last_access.get("password") == "", "空密码会清除访问密码")
        agent_json(
            admin,
            "PUT",
            "/admin/tools/publish_to_pagepilot",
            json={
                "enabled": False,
                "visible": False,
                "selectable": False,
                "default_selected": False,
            },
        )
        user_tools = agent_json(user1, "GET", "/tools")["items"]
        check(
            all(item["name"] != "publish_to_pagepilot" for item in user_tools),
            "停用后普通用户看不到 PagePilot 工具",
        )
        admin_tools = agent_json(admin, "GET", "/admin/tools")["items"]
        check(
            any(item["name"] == "publish_to_pagepilot" for item in admin_tools),
            "停用后管理员仍能重新启用 PagePilot 工具",
        )
        agent_json(
            admin,
            "PUT",
            "/admin/tools/publish_to_pagepilot",
            json={
                "enabled": True,
                "visible": True,
                "selectable": True,
                "default_selected": True,
            },
        )
    finally:
        server.shutdown()
        server.server_close()
        try:
            agent_json(
                admin,
                "PUT",
                "/admin/tools/publish_to_pagepilot",
                json={
                    "enabled": True,
                    "visible": True,
                    "selectable": True,
                    "default_selected": True,
                },
            )
        except Exception:
            pass
        with sqlite3.connect(AGENT_DB_PATH) as conn:
            conn.execute("DELETE FROM settings WHERE key GLOB 'pagepilot_*'")
            conn.executemany(
                "INSERT INTO settings (key, value) VALUES (?, ?)",
                saved_pilot_settings.items(),
            )
        if pilot_tool:
            try:
                agent_json(
                    admin,
                    "PUT",
                    "/admin/tools/publish_to_pagepilot",
                    json={
                        key: pilot_tool.get(key, True)
                        for key in (
                            "enabled",
                            "visible",
                            "selectable",
                            "default_selected",
                        )
                    },
                )
            except Exception:
                pass

    html = "<!doctype html><html><body><h1>截图测试</h1></body></html>"
    screenshot = admin.post("/api/agent/artifacts/screenshot", json={"html": html})
    check(
        screenshot.status_code == 200
        and screenshot.headers.get("content-type", "").startswith("image/png")
        and screenshot.content.startswith(b"\x89PNG"),
        "服务端 HTML 截图返回 PNG",
    )

    print("\n全部冒烟测试通过。")


def main() -> int:
    admin = login("admin", os.getenv("WEBAGENT_SMOKE_ADMIN_PASSWORD", "admin123"))
    original = agent_json(admin, "GET", "/config")
    agent_json(admin, "PUT", "/config", json={"demo_mode": True})
    try:
        run_checks(admin)
    finally:
        agent_json(
            admin,
            "PUT",
            "/config",
            json={"demo_mode": original["demo_mode"]},
        )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"\n测试失败：{exc}", file=sys.stderr)
        raise SystemExit(1)
