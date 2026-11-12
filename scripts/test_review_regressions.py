#!/usr/bin/env python3
"""Review regressions against temporary storage and mocked upstream services."""

from __future__ import annotations

import asyncio
import json
import sqlite3
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import AsyncMock, patch

import httpx2
from fastapi import FastAPI, HTTPException
from starlette.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from webagent.agent import app as agent_app
from webagent.agent import context, db, dynamic_tools, llm, pagepilot, runtime, sessions
from webagent.agent.mcp_client import ToolSpec
from webagent import sdk
from webagent.config import INTERNAL_SECRET
from webagent.mcp_server import server as mcp_server


USER = {"id": 31, "username": "reviewer", "is_admin": True, "permissions": ["device:delete"]}


class ReviewRegressions(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory(prefix="webagent-review-")
        self.database = patch.object(db, "AGENT_DB_PATH", Path(self.directory.name) / "agent.db")
        self.database.start()
        db.init_db()
        self.session = sessions.create_session(USER, title="测试会话")

    def tearDown(self) -> None:
        self.database.stop()
        self.directory.cleanup()

    def pending(self, approval_id: str = "review-approval") -> None:
        db.create_pending_approval({
            "id": approval_id, "user_id": USER["id"], "username": USER["username"],
            "session_id": self.session["id"], "created_at": time.time(),
            "expires_at": time.time() + 600,
        })

    def compacted_history(self) -> dict:
        message = sessions.add_message(self.session["id"], role="user", content="原始机房地址")
        sessions.add_message(self.session["id"], role="assistant", content="已记录")
        sessions.add_message(self.session["id"], role="user", content="最近问题")
        sessions.update_compaction(
            self.session["id"], summary="机房地址为原始地址", summary_until_id=message["id"],
            last_context_tokens=300,
        )
        return message

    async def test_existing_summary_is_actually_sent_to_model(self) -> None:
        self.compacted_history()
        session = sessions.get_session(self.session["id"], USER["id"])
        plan = await context.prepare_context(
            session, USER["id"], {"context_window": 32768},
            {"context_compression": False},
        )
        self.assertIn("机房地址为原始地址", plan.messages[0]["content"])
        self.assertNotEqual(plan.messages[0]["role"], "system")

    async def test_auto_compaction_keeps_earlier_facts_in_context(self) -> None:
        sessions.add_message(self.session["id"], role="user", content="关键事实：机房 A。" + "历史内容" * 2000)
        sessions.add_message(self.session["id"], role="assistant", content="旧回答" * 1200)
        sessions.add_message(self.session["id"], role="user", content="现在开始下一步")
        plan = await context.prepare_context(
            sessions.get_session(self.session["id"], USER["id"]), USER["id"],
            {"context_window": 4096}, {"context_compression": True, "demo_mode": True},
        )
        self.assertTrue(plan.compressed)
        self.assertIn("关键事实：机房 A", plan.messages[0]["content"])
        self.assertEqual(plan.messages[-1]["content"], "现在开始下一步")

    async def test_compaction_announces_the_real_slow_stage(self) -> None:
        sessions.add_message(self.session["id"], role="user", content="旧信息" * 2500)
        sessions.add_message(self.session["id"], role="assistant", content="旧回复" * 2500)
        sessions.add_message(self.session["id"], role="user", content="最新问题")
        announce = AsyncMock()
        await context.prepare_context(
            sessions.get_session(self.session["id"], USER["id"]), USER["id"],
            {"context_window": 4096}, {"context_compression": True, "demo_mode": True},
            on_compaction=announce,
        )
        announce.assert_awaited_once()

    async def test_short_context_does_not_announce_fake_compaction(self) -> None:
        announce = AsyncMock()
        await context.prepare_context(
            sessions.get_session(self.session["id"], USER["id"]), USER["id"],
            {"context_window": 32768}, {"context_compression": True}, on_compaction=announce,
        )
        announce.assert_not_awaited()

    async def test_stream_announces_identity_before_waiting_for_it(self) -> None:
        events = []
        async def emit(name, payload):
            events.append((name, payload))
        async def identity(_token):
            self.assertEqual(events[0][0], "run.phase")
            self.assertEqual(events[0][1]["phase"], "identity")
            raise runtime.AgentError("fixture identity blocked", 401)
        with patch.object(runtime, "identity_from_token", side_effect=identity):
            with self.assertRaises(runtime.AgentError):
                await runtime.chat("fixture", "hello", None, None, emit=emit)

    async def test_preparation_announces_tools_before_discovery(self) -> None:
        events = []
        async def emit(name, payload):
            events.append((name, payload))
        async def discover(_token):
            self.assertEqual(events[-1][1]["phase"], "tools")
            return []
        with patch.object(runtime, "list_tools", side_effect=discover):
            await runtime.build_context("fixture", None, None, user=USER, emit=emit)

    async def test_disconnected_stage_listener_does_not_break_the_run(self) -> None:
        emit = AsyncMock(side_effect=ConnectionError("client disconnected"))
        await runtime._emit_callback(emit, "run.phase", {"phase": "tools"})
        emit.assert_awaited_once()

    def test_same_port_root_opens_react_and_preserves_the_configuration_entry(self) -> None:
        from webagent.business import app as business_app
        async def check():
            with patch.object(business_app, "FRONTEND_DIST_DIR", Path(self.directory.name)), patch.object(
                business_app, "WEB_DIR", Path(self.directory.name),
            ):
                (Path(self.directory.name) / "index.html").write_text("<main>test config</main>")
                response = await business_app.index()
                self.assertEqual(response.headers["location"], "/react/")
                configuration = await business_app.admin_index()
                self.assertEqual(configuration.path, Path(self.directory.name) / "index.html")
        asyncio.run(check())

    def test_tool_governance_four_states_and_rbac(self) -> None:
        spec = ToolSpec("delete_device", "删除设备", {}, "device:delete", "delete", "业务")
        cases = [
            ({"visible": True, "selectable": True, "default_selected": False}, None, False),
            ({"visible": True, "selectable": True, "default_selected": False}, [spec.name], True),
            ({"visible": True, "selectable": False, "default_selected": True}, [], True),
            ({"visible": False, "selectable": False, "default_selected": True}, [], True),
            ({"visible": False, "selectable": False, "default_selected": True}, [spec.name], True),
            ({"visible": False, "selectable": False, "default_selected": False}, [spec.name], False),
            ({"enabled": False, "visible": True, "default_selected": True}, [spec.name], False),
        ]
        for setting, requested, expected in cases:
            with self.subTest(setting=setting, requested=requested):
                self.assertEqual(runtime._tool_available(spec, USER, {spec.name: setting}, requested), expected)
        self.assertFalse(runtime._tool_available(spec, {"permissions": []}, {}, [spec.name]))
        self.assertFalse(runtime._tool_available(spec, USER, {}, [spec.name], {"other_tool"}))

    async def test_hidden_disabled_tool_can_be_saved_without_reenabling(self) -> None:
        tool = {
            "name": "delete_device", "source": "mcp", "enabled": True,
            "visible": True, "selectable": True, "default_selected": True,
        }
        transport = httpx2.ASGITransport(app=agent_app.app)
        with patch.object(runtime, "identity_from_token", AsyncMock(return_value=USER)), patch.object(
            runtime, "admin_all_tools", AsyncMock(return_value=[tool]),
        ):
            async with httpx2.AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.put(
                    "/api/admin/tools/delete_device",
                    headers={"Authorization": "Bearer fixture", "X-Internal-Token": INTERNAL_SECRET},
                    json={"visible": False, "selectable": False, "default_selected": False},
                )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["tool"]["default_selected"])

    async def test_visible_default_off_tool_remains_in_user_catalog(self) -> None:
        spec = ToolSpec("optional_tool", "可选工具", {}, "", "read", "业务")
        settings = {spec.name: {"enabled": True, "visible": True, "selectable": True, "default_selected": False}}
        with patch.object(runtime, "identity_from_token", AsyncMock(return_value=USER)), patch.object(
            runtime, "list_tools", AsyncMock(return_value=[spec]),
        ), patch.object(db, "get_tool_settings", return_value=settings), patch.object(
            dynamic_tools, "list_specs", return_value=[],
        ), patch.object(pagepilot, "local_read_specs", return_value=[]), patch.object(
            pagepilot, "spec_if_enabled", return_value=None,
        ):
            tools = await runtime.user_tools("fixture")
        self.assertEqual([item["name"] for item in tools], [spec.name])
        self.assertFalse(tools[0]["default_selected"])

    def test_mcp_transport_accepts_configured_container_origin_only(self) -> None:
        app = mcp_server.mcp.streamable_http_app(
            json_response=True, stateless_http=True,
            transport_security=mcp_server.transport_security("http://mcp:8020/mcp"),
        )
        payload = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": "2025-03-26", "capabilities": {},
            "clientInfo": {"name": "review", "version": "1"},
        }}
        with TestClient(app, base_url="http://mcp:8020") as client:
            response = client.post("/mcp", json=payload, headers={"Accept": "application/json, text/event-stream"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["result"]["serverInfo"]["name"], "webagent-device-tools")
            denied = client.post("/mcp", json=payload, headers={"Host": "untrusted.example", "Accept": "application/json, text/event-stream"})
            self.assertEqual(denied.status_code, 421)

    def test_editing_summarized_message_invalidates_summary_and_pending_action(self) -> None:
        message = self.compacted_history()
        self.pending()
        sessions.update_message_owned(self.session["id"], message["id"], USER["id"], content="新的地址")
        session = sessions.get_session(self.session["id"], USER["id"])
        self.assertEqual(session["summary"], "")
        self.assertEqual(session["summary_until_id"], 0)
        self.assertEqual(db.claim_pending_approval("review-approval", USER["id"])[1], "cancelled")

    def test_deleting_summarized_message_invalidates_summary(self) -> None:
        message = self.compacted_history()
        self.assertTrue(sessions.delete_message(self.session["id"], message["id"], USER["id"]))
        self.assertEqual(sessions.get_session(self.session["id"], USER["id"])["summary"], "")

    def test_edit_clears_stale_approval_cards(self) -> None:
        message = sessions.add_message(self.session["id"], role="user", content="修改设备")
        assistant = sessions.add_message(
            self.session["id"], role="assistant", content="等待确认",
            metadata={"approval": {"id": "review-approval"}},
            tool_runs=[{"tool": "update_device", "status": "pending"}],
        )
        self.pending()
        sessions.update_message_owned(self.session["id"], message["id"], USER["id"], content="不修改了")
        updated = sessions.get_message(self.session["id"], assistant["id"])
        self.assertIsNone(updated["metadata"]["approval"])
        self.assertEqual(updated["tool_runs"][0]["status"], "cancelled")

    def test_clear_removes_pending_approvals(self) -> None:
        self.pending()
        sessions.clear_messages(self.session["id"], USER["id"])
        self.assertEqual(db.claim_pending_approval("review-approval", USER["id"])[1], "missing")

    def test_session_delete_removes_pending_approvals(self) -> None:
        self.pending()
        sessions.delete_session(self.session["id"], USER["id"])
        self.assertEqual(db.claim_pending_approval("review-approval", USER["id"])[1], "missing")

    def test_fork_copies_only_until_selected_message_and_no_pending_approval(self) -> None:
        first = sessions.add_message(self.session["id"], role="user", content="第一问")
        sessions.add_message(self.session["id"], role="assistant", content="回答")
        branch = sessions.fork_session(self.session["id"], USER["id"], until_message_id=first["id"])
        self.assertEqual(len(sessions.list_messages(branch["id"], USER["id"])), 1)
        sessions.add_message(
            self.session["id"], role="assistant", content="待审批",
            metadata={"approval": {"id": "old-approval"}},
            tool_runs=[{"status": "pending"}],
        )
        complete_branch = sessions.fork_session(self.session["id"], USER["id"])
        copied = sessions.list_messages(complete_branch["id"], USER["id"])[-1]
        self.assertIsNone(copied["metadata"]["approval"])
        self.assertEqual(copied["tool_runs"][0]["status"], "cancelled")

    def test_fork_rejects_unknown_or_other_session_message(self) -> None:
        other = sessions.create_session(USER, title="另一个会话")
        message = sessions.add_message(other["id"], role="user", content="其他会话内容")
        self.assertIsNone(sessions.fork_session(self.session["id"], USER["id"], until_message_id=message["id"]))

    def test_admin_content_privacy_also_redacts_reasoning_approvals_and_errors(self) -> None:
        marker = "private-content-fixture"
        sessions.rename_session(self.session["id"], USER["id"], marker)
        sessions.add_message(
            self.session["id"], role="assistant", content=marker, reasoning=marker,
            metadata={"approval": {"arguments": marker}, "custom": marker, "run": {"reasoning": marker}},
            tool_runs=[{"arguments": {"value": marker}, "result": marker, "summary": marker}],
        )
        db.record_llm_call(
            session_id=self.session["id"], username=USER["username"], model="fixture",
            provider="fixture", purpose="chat", attempt=1, status="error", error=marker,
        )
        detail = agent_app._session_detail(self.session["id"], include_content=False)
        self.assertNotIn(marker, json.dumps(detail, ensure_ascii=False))
        self.assertIn(marker, json.dumps(agent_app._session_detail(self.session["id"], include_content=True)))

    def test_dynamic_variables_cannot_change_host_or_inject_credentials(self) -> None:
        base = {"name": "lookup_device", "url_template": "https://business.example/api/{device_id}"}
        dynamic_tools.validate_dynamic_tool(base)
        for template in ("https://{host}/api", "https://user:password@example.com/api"):
            with self.subTest(template=template), self.assertRaises(dynamic_tools.DynamicToolError):
                dynamic_tools.validate_dynamic_tool({**base, "url_template": template})

    def test_dynamic_path_parameters_are_encoded_and_dot_segments_rejected(self) -> None:
        url, used = dynamic_tools._replace_path("https://example.com/items/{name}", {"name": "a/b?secret=true"})
        self.assertEqual(url, "https://example.com/items/a%2Fb%3Fsecret%3Dtrue")
        self.assertEqual(used, {"name"})
        with self.assertRaises(dynamic_tools.DynamicToolError):
            dynamic_tools._replace_path("https://example.com/{name}", {"name": ".."})

    async def test_missing_dynamic_parameter_is_a_tool_error_not_a_crash(self) -> None:
        row = {"name": "lookup_device", "enabled": True, "url_template": "https://example.com/{device_id}"}
        spec = ToolSpec("lookup_device", "测试", {}, "", "read", "业务", source="dynamic")
        with patch.object(db, "get_dynamic_tool_by_name", return_value=row):
            result = await dynamic_tools.call_dynamic_tool("fixture", spec, {})
        self.assertFalse(result.ok)
        self.assertIn("缺少路径参数", result.text)

    async def test_model_request_obeys_hard_run_deadline(self) -> None:
        async def slow_completion(**_kwargs):
            await asyncio.sleep(2)
        with patch.object(llm, "_chat_completion", side_effect=slow_completion):
            started = time.monotonic()
            with self.assertRaises(llm.LLMError):
                await llm.chat_completion(
                    messages=[], tools=[], model={}, provider={}, config={},
                    deadline=time.monotonic() + 0.02,
                )
        self.assertLess(time.monotonic() - started, 0.5)

    def test_agent_deadline_uses_monotonic_clock(self) -> None:
        ctx = runtime.AgentContext(
            token="fixture", user=USER, model={}, provider={}, config={}, skills=[],
            all_tools=[], tools=[], global_tool_settings={}, requested_tools=None,
        )
        self.assertLess(abs(ctx.started_at - time.monotonic()), 1)

    async def test_background_title_does_not_overwrite_manual_rename(self) -> None:
        sessions.rename_session(self.session["id"], USER["id"], "新对话")
        ctx = runtime.AgentContext(
            token="fixture", user=USER, model={}, provider={}, config={}, skills=[],
            all_tools=[], tools=[], global_tool_settings={}, requested_tools=None,
            session_id=self.session["id"],
        )
        async def generate(**_kwargs):
            sessions.rename_session(self.session["id"], USER["id"], "用户手动命名")
            return "自动标题"
        with patch.object(runtime, "generate_title", side_effect=generate):
            await runtime._maybe_generate_title(ctx, "问题", "回答")
        self.assertEqual(sessions.get_session(self.session["id"], USER["id"])["title"], "用户手动命名")

    def test_database_context_releases_connection(self) -> None:
        with db.connect() as connection:
            self.assertEqual(connection.execute("SELECT 1").fetchone()[0], 1)
        with self.assertRaises(sqlite3.ProgrammingError):
            connection.execute("SELECT 1")

    def test_reasoning_only_persists_in_dedicated_field_when_enabled(self) -> None:
        model = {"id": 1, "name": "fixture", "model_id": "fixture", "context_window": 32768}
        for store in (False, True):
            ctx = runtime.AgentContext(
                token="fixture", user=USER, model=model, provider={"name": "fixture"},
                config={"store_reasoning": store, "demo_mode": False}, skills=[],
                all_tools=[], tools=[], global_tool_settings={}, requested_tools=None,
                session_id=self.session["id"], had_reasoning=True, reasoning_text="private-reasoning",
            )
            result = runtime._response(ctx, status="ok", answer="最终回答", usage={})
            runtime._record_assistant_message(ctx, result)
            message = sessions.list_messages(self.session["id"], USER["id"])[-1]
            self.assertNotIn("private-reasoning", json.dumps(message["metadata"]))
            self.assertEqual(message["reasoning"], "private-reasoning" if store else "")
            self.assertEqual(message["metadata"]["reasoning"]["stored"], store)

    def test_legacy_duplicate_reasoning_is_removed_without_erasing_opt_in_field(self) -> None:
        message = sessions.add_message(
            self.session["id"], role="assistant", content="回答", reasoning="opt-in-reasoning",
            metadata={"run": {"reasoning": "legacy-duplicate", "elapsed_seconds": 1}},
        )
        with db.connect() as connection:
            connection.execute("DELETE FROM settings WHERE key = 'reasoning_metadata_cleaned_v1'")
        db.init_db()
        updated = sessions.get_message(self.session["id"], message["id"])
        self.assertNotIn("legacy-duplicate", json.dumps(updated["metadata"]))
        self.assertEqual(updated["reasoning"], "opt-in-reasoning")

    def test_context_uses_last_model_input_not_accumulated_step_usage(self) -> None:
        ctx = runtime.AgentContext(
            token="fixture", user=USER,
            model={"id": 1, "name": "fixture", "model_id": "fixture", "context_window": 32768, "max_output_tokens": 4096},
            provider={"name": "fixture"}, config={"demo_mode": False}, skills=[],
            all_tools=[], tools=[], global_tool_settings={}, requested_tools=None,
            last_prompt_tokens=1234,
        )
        result = runtime._response(ctx, status="ok", answer="完成", usage={"prompt_tokens": 2500})
        self.assertEqual(result["context"]["context_tokens"], 1234)
        self.assertEqual(result["context"]["budget_tokens"], 27072)

    def test_sdk_login_understands_httponly_business_session(self) -> None:
        response = httpx2.Response(
            200, json={"user": USER}, headers={"Set-Cookie": "wa_session=fixture-token; HttpOnly; Path=/"},
            request=httpx2.Request("POST", "http://test/api/login"),
        )
        with patch.object(sdk.httpx2, "post", return_value=response):
            self.assertEqual(sdk.AgentAdminClient().login("fixture", "fixture"), "fixture-token")

    def test_sdk_login_accepts_custom_cookie_name(self) -> None:
        response = httpx2.Response(
            200, json={"user": USER}, headers={"Set-Cookie": "wa_container_session=fixture-container-token; HttpOnly; Path=/"},
            request=httpx2.Request("POST", "http://test/api/login"),
        )
        with patch.object(sdk.httpx2, "post", return_value=response):
            client = sdk.AgentAdminClient(session_cookie_name="wa_container_session")
            self.assertEqual(client.login("fixture", "fixture"), "fixture-container-token")

    async def test_sdk_routes_authenticate_registered_tools_and_async_handlers(self) -> None:
        app = FastAPI()
        spec = sdk.ToolSpec("get_own_data", "查询当前用户", {"type": "object"})
        async def authorize(request, _spec):
            if request.headers.get("Authorization") != "Bearer fixture-user":
                raise HTTPException(status_code=401, detail="登录失效")
            return USER
        async def handler(name, arguments, user):
            return {"tool": name, "user_id": user["id"], "arguments": arguments}
        sdk.serve_tools([spec], handler, authorize=authorize)(app)
        async with httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app), base_url="http://test") as client:
            self.assertEqual((await client.post("/agent-tools/get_own_data", json={})).status_code, 401)
            response = await client.post("/agent-tools/get_own_data", json={"q": "fixture"}, headers={"Authorization": "Bearer fixture-user"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["user_id"], USER["id"])
            self.assertEqual((await client.post("/agent-tools/not_registered", json={})).status_code, 404)

    async def test_run_cache_does_not_evict_executing_jobs(self) -> None:
        with patch.dict(agent_app.RUNS, clear=True):
            active = agent_app.RunChannel("active", 999)
            active.created_at -= 300
            agent_app.RUNS[active.run_id] = active
            for index in range(119):
                channel = agent_app.RunChannel(f"finished-{index}", 999)
                channel.closed = True
                agent_app.RUNS[channel.run_id] = channel
            await agent_app._new_run_channel(USER["id"])
            self.assertIn("active", agent_app.RUNS)
            self.assertEqual(len(agent_app.RUNS), 120)

    async def test_user_run_limit_has_explicit_backpressure(self) -> None:
        with patch.dict(agent_app.RUNS, clear=True):
            for _index in range(4):
                await agent_app._new_run_channel(USER["id"])
            with self.assertRaises(runtime.AgentError) as failure:
                await agent_app._new_run_channel(USER["id"])
            self.assertEqual(failure.exception.status_code, 429)

    async def test_builtin_tool_names_cannot_be_shadowed_by_dynamic_tools(self) -> None:
        with patch.object(runtime, "admin_all_tools", AsyncMock(return_value=[{"name": "existing_tool", "source": "mcp"}])):
            with self.assertRaises(runtime.AgentError) as failure:
                await agent_app._check_dynamic_tool_name("fixture", "existing_tool")
            self.assertEqual(failure.exception.status_code, 409)
            await agent_app._check_dynamic_tool_name("fixture", "new_business_tool")

    async def test_same_session_rejects_concurrent_runs_and_releases_lock(self) -> None:
        started = asyncio.Event()
        finish = asyncio.Event()
        async def hold(*_args, **_kwargs):
            started.set()
            await finish.wait()
            return {"ok": True}
        with patch.object(runtime, "_chat", side_effect=hold):
            task = asyncio.create_task(runtime.chat("fixture", "hello", None, None, session_id=self.session["id"]))
            await started.wait()
            try:
                with self.assertRaises(runtime.AgentError) as failure:
                    await runtime.chat("fixture", "again", None, None, session_id=self.session["id"])
                self.assertEqual(failure.exception.status_code, 409)
            finally:
                finish.set()
                await task
        self.assertNotIn(self.session["id"], runtime.ACTIVE_SESSIONS)

    async def test_running_session_rejects_history_mutations(self) -> None:
        message = sessions.add_message(self.session["id"], role="user", content="原问题")
        transport = httpx2.ASGITransport(app=agent_app.app)
        with runtime.session_run(self.session["id"]), patch.object(
            runtime, "identity_from_token", AsyncMock(return_value=USER),
        ):
            async with httpx2.AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.delete(
                    f"/api/sessions/{self.session['id']}/messages/{message['id']}",
                    headers={"Authorization": "Bearer fixture", "X-Internal-Token": INTERNAL_SECRET},
                )
        self.assertEqual(response.status_code, 409)
        self.assertIsNotNone(sessions.get_message(self.session["id"], message["id"]))

    async def test_streamed_publish_arguments_do_not_expose_password_or_large_html(self) -> None:
        captured = []
        async def emit(event, payload):
            captured.append((event, payload))
        ctx = runtime.AgentContext(
            token="fixture", user=USER, model={}, provider={}, config={}, skills=[],
            all_tools=[], tools=[], global_tool_settings={}, requested_tools=None, emit=emit,
        )
        spec = ToolSpec(pagepilot.TOOL_NAME, "发布", {}, "", "write", "发布", source="pagepilot")
        with patch.object(pagepilot, "publish_html", AsyncMock(return_value={"ok": True})):
            await runtime._execute_emitting(ctx, spec, {
                "id": "fixture", "arguments": {
                    "html": "<!doctype html><html><body>private-html</body></html>",
                    "access_password": "private-password", "visibility": "unlisted",
                },
            }, [])
        rendered = json.dumps(captured)
        self.assertNotIn("private-password", rendered)
        self.assertNotIn("private-html", rendered)


if __name__ == "__main__":
    unittest.main(verbosity=2)
