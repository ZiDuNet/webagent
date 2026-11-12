"""Decision routing, scoring protocol and model-category regressions."""

from __future__ import annotations

import json
import asyncio
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import AsyncMock, patch

import httpx2

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from webagent.agent import app as agent_app
from webagent.agent import db, decision, llm, runtime, sessions
from webagent.agent.mcp_client import ToolSpec
from webagent.agent.providers import ProviderError, guess_model_kind
from webagent.config import INTERNAL_SECRET


USER = {"id": 91, "username": "reviewer", "display_name": "测试员", "role": "admin", "is_admin": True, "permissions": ["device:read"]}
HEADERS = {"Authorization": "Bearer fixture", "X-Internal-Token": INTERNAL_SECRET}


class DecisionTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory(prefix="webagent-decision-")
        self.database = patch.object(db, "AGENT_DB_PATH", Path(self.directory.name) / "agent.db")
        self.database.start()
        db.init_db()
        self.provider = db.create_provider(name="fixture", provider_type="openai_compatible", base_url="https://provider.example/v1", api_key="fixture-key")
        self.chat_model = db.create_model(provider_id=self.provider["id"], name="对话测试", model_id="fixture-chat", is_default=True)
        self.model = db.create_model(
            provider_id=self.provider["id"], name="决策测试", model_id="fixture-decision",
            model_kind="decision", extra_params={"_decision": {"protocol": "decisions", "endpoint": "/decisions"}},
        )
        self.config = {**llm.runtime_config(), "tool_selection_mode": "decision", "demo_mode": False, "decision_min_count": 1, "decision_model_id": self.model["id"]}

    def tearDown(self) -> None:
        self.database.stop()
        self.directory.cleanup()

    async def config_request(self, body: dict) -> httpx2.Response:
        transport = httpx2.ASGITransport(app=agent_app.app)
        with patch.object(runtime, "identity_from_token", AsyncMock(return_value=USER)):
            async with httpx2.AsyncClient(transport=transport, base_url="http://test") as client:
                return await client.put("/api/config", json=body, headers=HEADERS)

    async def test_two_switches_can_both_be_off(self) -> None:
        result = await self.config_request({"bm25_enabled": False, "decision_enabled": False})
        self.assertEqual(result.status_code, 200)
        self.assertFalse(result.json()["bm25_enabled"])
        self.assertFalse(result.json()["decision_enabled"])
        self.assertEqual(llm.runtime_config()["tool_selection_mode"], "none")

    async def test_enabling_one_automatically_disables_other(self) -> None:
        result = await self.config_request({"decision_enabled": True, "decision_model_id": self.model["id"]})
        self.assertEqual(result.status_code, 200)
        self.assertFalse(result.json()["bm25_enabled"])
        result = await self.config_request({"bm25_enabled": True})
        self.assertTrue(result.json()["bm25_enabled"])
        self.assertFalse(result.json()["decision_enabled"])

    async def test_both_on_rejected_without_partial_save(self) -> None:
        before = db.get_settings()
        result = await self.config_request({"bm25_enabled": True, "decision_enabled": True, "max_iterations": 3})
        self.assertEqual(result.status_code, 422)
        self.assertEqual(db.get_settings(), before)

    async def test_conflicting_mode_and_switch_rejected(self) -> None:
        result = await self.config_request({"tool_selection_mode": "none", "bm25_enabled": True})
        self.assertEqual(result.status_code, 422)

    async def test_missing_model_and_empty_scope_rejected(self) -> None:
        result = await self.config_request({"decision_enabled": True})
        self.assertEqual(result.status_code, 422)
        result = await self.config_request({"decision_enabled": True, "decision_model_id": self.model["id"], "decision_tools": False, "decision_skills": False})
        self.assertEqual(result.status_code, 422)

    def test_legacy_bm25_setting_migrates_without_touching_database(self) -> None:
        db.set_settings({"bm25_enabled": "0"})
        self.assertEqual(llm.runtime_config()["tool_selection_mode"], "none")
        db.set_settings({"bm25_enabled": "1"})
        self.assertEqual(llm.runtime_config()["tool_selection_mode"], "bm25")
        db.set_settings({"tool_selection_mode": "decision"})
        self.assertFalse(llm.runtime_config()["bm25_enabled"])

    def test_model_defaults_exclude_specialized_models(self) -> None:
        self.assertNotEqual(db.default_model()["id"], self.model["id"])
        model = db.update_model(self.model["id"], {"is_default": True})
        self.assertFalse(model["is_default"])
        self.assertEqual(guess_model_kind("typesafe/jev-1.13"), "decision")
        self.assertEqual(guess_model_kind("microsoft/microsoft-decision-1"), "decision")

    def test_credentials_cannot_be_sent_to_another_origin(self) -> None:
        for endpoint in ("https://other.example/score", "//other.example/score", "https://provider.example/score?key=bad"):
            with self.subTest(endpoint=endpoint), self.assertRaises(ProviderError):
                decision.connection_config({"extra_params": {"_decision": {"protocol": "decisions", "endpoint": endpoint}}}, self.provider)

    def test_incomplete_invalid_or_nonfinite_scores_rejected(self) -> None:
        for scores in ({}, {"x": True}, {"x": float("nan")}, {"x": 2}, {"x": "bad"}):
            with self.subTest(scores=scores), self.assertRaises(ValueError):
                decision.parse_scores({"scores": scores}, {"x"})
        self.assertEqual(decision.parse_scores({"answers": {"x": {"answer": {"noul": "0.8"}}, "unexpected": 1}}, {"x"}), {"x": 0.8})

    async def test_native_scoring_wire_format_and_usage_log(self) -> None:
        requests = []
        original = httpx2.AsyncClient
        async def respond(request):
            requests.append(request)
            return httpx2.Response(200, json={"answers": {"tool:read": {"noul": 0.9}}, "usage": {"prompt_tokens": 10, "completion_tokens": 2}}, request=request)
        with patch.object(decision.httpx2, "AsyncClient", side_effect=lambda **kwargs: original(**kwargs, transport=httpx2.MockTransport(respond))):
            scores, usage = await decision.score_candidates(model=self.model, provider=self.provider, config=self.config, state="查设备", candidates=[{"id": "tool:read", "description": "查询设备"}], username="reviewer")
        self.assertEqual(scores["tool:read"], 0.9)
        self.assertEqual(usage["total_tokens"], 12)
        body = json.loads(requests[0].content)
        self.assertEqual(requests[0].url.path, "/decisions")
        self.assertEqual(body["questions"]["tool:read"]["type"], "noul")
        self.assertEqual(requests[0].headers["authorization"], "Bearer fixture-key")
        with db.connect() as connection:
            self.assertEqual(connection.execute("SELECT purpose FROM llm_calls ORDER BY id DESC LIMIT 1").fetchone()[0], "decision")

    async def test_chat_adapter_scores_without_exposing_raw_answer(self) -> None:
        model = {**self.model, "extra_params": {}}
        completion = AsyncMock(return_value={"content": '```json\n{"scores":{"x":0.85}}\n```', "usage": {"total_tokens": 5}})
        with patch.object(llm, "chat_completion", completion):
            scores, usage = await decision.score_candidates(model=model, provider=self.provider, config=self.config, state="test", candidates=[{"id": "x", "description": "read"}])
        self.assertEqual(scores, {"x": 0.85})
        self.assertEqual(usage["total_tokens"], 5)
        self.assertEqual(completion.call_args.kwargs["purpose"], "decision")
        self.assertEqual(completion.call_args.kwargs["tools"], [])
        self.assertNotIn("on_event", completion.call_args.kwargs)

    async def test_loopback_chat_scorer_can_run_without_key(self) -> None:
        provider = {**self.provider, "base_url": "http://127.0.0.1:8123/v1", "api_key": ""}
        model = {**self.model, "extra_params": {}}
        completion = AsyncMock(return_value={"content": '{"scores":{"x":0.85}}', "usage": {}})
        with patch.object(llm, "chat_completion", completion):
            scores, _ = await decision.score_candidates(model=model, provider=provider, config=self.config, state="查询", candidates=[{"id": "x", "description": "查询设备"}])
        self.assertEqual(scores, {"x": 0.85})

    async def test_remote_native_scorer_requires_key_before_request(self) -> None:
        with patch.object(decision.httpx2, "AsyncClient") as client:
            with self.assertRaises(llm.LLMError):
                await decision.score_candidates(model=self.model, provider={**self.provider, "api_key": ""}, config=self.config, state="查询", candidates=[{"id": "x", "description": "查询设备"}])
        client.assert_not_called()

    async def test_invalid_native_scores_keep_consumed_usage_when_falling_back(self) -> None:
        original = httpx2.AsyncClient
        tool = ToolSpec("read", "查询", {}, "", "read", "业务")
        async def respond(request):
            return httpx2.Response(200, json={"answers": {}, "usage": {"prompt_tokens": 10, "completion_tokens": 2}}, request=request)
        with patch.object(decision.httpx2, "AsyncClient", side_effect=lambda **kwargs: original(**kwargs, transport=httpx2.MockTransport(respond))):
            selected, _, info, usage = await decision.select_candidates(
                tools=[tool], skills=[], state="查询设备", config=self.config,
                session_id=None, username="reviewer", deadline=time.monotonic() + 5,
            )
        self.assertEqual(selected, [tool])
        self.assertTrue(info["fallback"])
        self.assertEqual(usage["total_tokens"], 12)
        with db.connect() as connection:
            row = connection.execute("SELECT status, total_tokens FROM llm_calls ORDER BY id DESC LIMIT 1").fetchone()
        self.assertEqual(row["status"], "error")
        self.assertEqual(row["total_tokens"], 12)

    async def test_failure_keeps_all_candidates_without_bm25(self) -> None:
        tool = ToolSpec("read", "查询", {}, "", "read", "业务")
        with patch.object(decision, "score_candidates", AsyncMock(side_effect=TimeoutError)), patch.object(runtime.tool_search, "rank_tools") as bm25:
            tools, skills, info, _ = await decision.select_candidates(tools=[tool], skills=[], state="查", config=self.config, session_id=None, username="reviewer", deadline=time.monotonic() + 10)
        self.assertEqual(tools, [tool])
        self.assertTrue(info["fallback"])
        bm25.assert_not_called()

    async def test_small_catalog_does_not_request_model(self) -> None:
        with patch.object(decision, "score_candidates", AsyncMock()) as score:
            _, _, info, _ = await decision.select_candidates(tools=[], skills=[], state="查", config=self.config, session_id=None, username="reviewer", deadline=time.monotonic() + 10)
        self.assertEqual(info["reason"], "below_min_count")
        score.assert_not_awaited()

    async def test_threshold_filters_tools_and_skills_and_counts_usage(self) -> None:
        tool = ToolSpec("read", "查询", {}, "", "read", "业务")
        skills = [{"id": 1, "name": "相关", "description": "设备"}, {"id": 2, "name": "无关", "description": "其他"}]
        with patch.object(decision, "score_candidates", AsyncMock(return_value=({"tool:read": 0.6, "skill:1": 0.8, "skill:2": 0.1}, {"total_tokens": 12}))):
            selected, selected_skills, info, usage = await decision.select_candidates(tools=[tool], skills=skills, state="设备", config=self.config, session_id=None, username="reviewer", deadline=time.monotonic() + 10)
        self.assertEqual(selected, [tool])
        self.assertEqual([item["id"] for item in selected_skills], [1])
        self.assertTrue(info["used"])
        self.assertEqual(usage["total_tokens"], 12)

    async def test_native_retries_honor_global_switch_and_log_failure(self) -> None:
        original = httpx2.AsyncClient
        requests = []
        async def respond(request):
            requests.append(request)
            if len(requests) == 1:
                return httpx2.Response(503, request=request)
            return httpx2.Response(200, json={"answers": {"x": {"noul": 0.9}}}, request=request)
        retry = {**self.config["retry"], "initial_backoff_ms": 100, "jitter": 0}
        with patch.object(decision.httpx2, "AsyncClient", side_effect=lambda **kwargs: original(**kwargs, transport=httpx2.MockTransport(respond))):
            _, usage = await decision.score_candidates(model=self.model, provider=self.provider, config={**self.config, "retry": retry}, state="设备", candidates=[{"id": "x", "description": "查询"}])
        self.assertEqual(len(requests), 2)
        self.assertEqual(usage["retry_count"], 1)

    async def test_deadline_stops_slow_native_service_and_logs_timeout(self) -> None:
        original = httpx2.AsyncClient
        async def respond(request):
            await asyncio.sleep(1)
            return httpx2.Response(200, json={"answers": {"x": {"noul": 0.9}}}, request=request)
        with patch.object(decision.httpx2, "AsyncClient", side_effect=lambda **kwargs: original(**kwargs, transport=httpx2.MockTransport(respond))):
            with self.assertRaises(TimeoutError):
                await decision.score_candidates(model=self.model, provider=self.provider, config=self.config, state="test", candidates=[{"id": "x", "description": "查询"}], deadline=time.monotonic() + 0.03)
        with db.connect() as connection:
            row = connection.execute("SELECT status, error FROM llm_calls ORDER BY id DESC LIMIT 1").fetchone()
        self.assertEqual(row["status"], "error")
        self.assertIn("时间上限", row["error"])

    async def test_recent_history_keeps_order_and_is_owner_scoped(self) -> None:
        session = sessions.create_session(USER)
        for index in range(8):
            sessions.add_message(session["id"], role="user", content=str(index))
        self.assertEqual([item["content"] for item in sessions.list_recent_messages(session["id"], USER["id"], limit=3)], ["5", "6", "7"])
        self.assertEqual(sessions.list_recent_messages(session["id"], USER["id"] + 1), [])

    async def test_chat_uses_filtered_catalog_and_persists_decision_usage(self) -> None:
        db.set_settings({"demo_mode": "0", "tool_selection_mode": "decision", "decision_model_id": str(self.model["id"]), "decision_min_count": "1"})
        tool = ToolSpec("read", "查询", {}, "device:read", "read", "业务")
        session = sessions.create_session(USER, title="决策验收")
        async def scores(**kwargs):
            return {item["id"]: 0.1 for item in kwargs["candidates"]}, {"prompt_tokens": 10, "completion_tokens": 2, "total_tokens": 12, "cost_usd": 0.001}
        completion = AsyncMock(return_value={"content": "请补充设备编号。", "tool_calls": [], "usage": {"prompt_tokens": 20, "completion_tokens": 3, "total_tokens": 23}})
        with patch.object(runtime, "identity_from_token", AsyncMock(return_value=USER)), patch.object(runtime, "list_tools", AsyncMock(return_value=[tool])), patch.object(decision, "score_candidates", AsyncMock(side_effect=scores)), patch.object(runtime, "chat_completion", completion):
            result = await runtime.chat("fixture", "你好", None, None, session_id=session["id"])
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["usage"]["total_tokens"], 35)
        self.assertEqual(completion.call_args.kwargs["tools"], [])
        self.assertEqual(sessions.get_session(session["id"], USER["id"])["total_tokens"], 35)
        last = sessions.list_messages(session["id"], USER["id"])[-1]
        self.assertTrue(last["metadata"]["tool_retrieval"]["decision"]["used"])
        self.assertEqual(last["metadata"]["tool_retrieval"]["selected"], 0)

    async def test_decision_model_can_be_created_and_not_used_as_main(self) -> None:
        transport = httpx2.ASGITransport(app=agent_app.app)
        with patch.object(runtime, "identity_from_token", AsyncMock(return_value=USER)):
            async with httpx2.AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post("/api/admin/models", headers=HEADERS, json={"provider_id": self.provider["id"], "name": "新决策", "model_id": "some-chat-model", "model_kind": "decision", "extra_params": {"_decision": {"protocol": "chat_completions"}}})
        self.assertEqual(response.status_code, 201)
        model = response.json()["model"]
        self.assertFalse(model["supports_tools"])
        self.assertFalse(model["is_default"])
        with self.assertRaisesRegex(runtime.AgentError, "不能用于对话"):
            await runtime.build_context("fixture", model["id"], None, user=USER)

    async def test_sync_keeps_decision_kind_and_protocol(self) -> None:
        transport = httpx2.ASGITransport(app=agent_app.app)
        with patch.object(runtime, "identity_from_token", AsyncMock(return_value=USER)), patch.object(agent_app, "list_remote_models", AsyncMock(return_value=[])), patch.object(agent_app, "enrich_model_defaults", AsyncMock(return_value={"model_kind": "chat", "supports_tools": True, "extra_params": {}})):
            async with httpx2.AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(f"/api/admin/models/{self.model['id']}/sync", headers=HEADERS)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["model"]["model_kind"], "decision")
        self.assertEqual(response.json()["model"]["extra_params"]["_decision"]["protocol"], "decisions")

    async def test_decision_receives_only_authorized_candidates_and_keeps_fixed_tools(self) -> None:
        tools = [ToolSpec("read", "查询", {}, "device:read", "read", "业务"), ToolSpec("delete", "删除", {}, "device:delete", "delete", "业务"), ToolSpec("fixed", "固定", {}, "", "read", "业务")]
        db.set_tool_setting("fixed", selectable=False, default_selected=True)
        db.set_settings({"demo_mode": "0", "tool_selection_mode": "decision", "decision_model_id": str(self.model["id"]), "decision_min_count": "1"})
        async def scores(**kwargs):
            return {item["id"]: 0.1 for item in kwargs["candidates"]}, {}
        score = AsyncMock(side_effect=scores)
        with patch.object(runtime, "list_tools", AsyncMock(return_value=tools)), patch.object(decision, "score_candidates", score), patch.object(runtime.tool_search, "rank_tools") as bm25:
            ctx = await runtime.build_context("fixture", None, None, user=USER)
            ctx.session_id = sessions.create_session(USER)["id"]
            await runtime._select_with_decision(ctx, "查设备")
        identifiers = {item["id"] for item in score.call_args.kwargs["candidates"]}
        self.assertNotIn("tool:delete", identifiers)
        self.assertEqual([tool.name for tool in ctx.tools], ["fixed"])
        bm25.assert_not_called()

    async def test_demo_mode_does_not_call_decision_service(self) -> None:
        with patch.object(runtime, "list_tools", AsyncMock(return_value=[])), patch.object(decision, "select_candidates", AsyncMock()) as select:
            ctx = await runtime.build_context("fixture", None, None, user=USER)
            ctx.config["tool_selection_mode"] = "decision"
            await runtime._select_with_decision(ctx, "测试")
        select.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
