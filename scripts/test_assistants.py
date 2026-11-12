"""Default assistant selection, permissions and persistent configuration."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

import httpx2

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from webagent.agent import app as agent_app
from webagent.agent import db, runtime, sessions
from webagent.config import INTERNAL_SECRET


ADMIN = {"id": 211, "username": "assistant-admin", "role": "admin", "is_admin": True, "permissions": []}
USER = {"id": 212, "username": "assistant-user", "role": "viewer", "is_admin": False, "permissions": []}
HEADERS = {"Authorization": "Bearer fixture", "X-Internal-Token": INTERNAL_SECRET}


class AssistantTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory(prefix="webagent-assistants-")
        self.database = patch.object(db, "AGENT_DB_PATH", Path(self.directory.name) / "agent.db")
        self.database.start()
        db.init_db()
        self.first, self.second, self.third = db.get_assistants()

    def tearDown(self) -> None:
        self.database.stop()
        self.directory.cleanup()

    async def request(self, method: str, path: str, body=None, *, user=None):
        with patch.object(runtime, "identity_from_token", AsyncMock(return_value=user or ADMIN)):
            async with httpx2.AsyncClient(transport=httpx2.ASGITransport(app=agent_app.app), base_url="http://test") as client:
                return await client.request(method, path, json=body, headers=HEADERS)

    def test_seed_and_migration_preserve_the_previous_first_assistant(self) -> None:
        self.assertTrue(self.first["is_default"])
        self.assertEqual(db.default_assistant(USER)["id"], self.first["id"])
        with db.connect() as conn:
            conn.execute("DROP INDEX idx_assistants_default")
            conn.execute("ALTER TABLE assistants DROP COLUMN is_default")
        db.init_db()
        self.assertEqual(db.default_assistant(USER)["id"], self.first["id"])
        db.update_assistant(self.second["id"], {"is_default": True})
        db.init_db()
        self.assertEqual(db.default_assistant(USER)["id"], self.second["id"])

    async def test_admin_can_select_default_independently_of_sort_order(self) -> None:
        response = await self.request("PUT", f"/api/admin/assistants/{self.second['id']}", {"is_default": True})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["assistant"]["is_default"])
        listing = await self.request("GET", "/api/admin/assistants")
        items = listing.json()["items"]
        self.assertEqual(items[0]["id"], self.first["id"])
        self.assertEqual([item["id"] for item in items if item["is_default"]], [self.second["id"]])
        listing = await self.request("GET", "/api/assistants", user=USER)
        self.assertTrue(next(item for item in listing.json()["items"] if item["id"] == self.second["id"])["is_default"])

    async def test_new_assistant_can_be_default_without_resetting_other_settings(self) -> None:
        response = await self.request("POST", "/api/admin/assistants", {"name": "通用助手", "is_default": True, "tool_names": ["list_devices"]})
        self.assertEqual(response.status_code, 201)
        assistant = response.json()["assistant"]
        self.assertTrue(assistant["is_default"])
        self.assertEqual(assistant["allowed_roles"], ["*"])
        self.assertEqual(assistant["tool_names"], ["list_devices"])
        self.assertEqual(db.default_assistant(USER)["id"], assistant["id"])
        self.assertFalse(db.get_assistant(self.first["id"])["is_default"])

    async def test_default_selection_is_admin_only(self) -> None:
        response = await self.request("PUT", f"/api/admin/assistants/{self.second['id']}", {"is_default": True}, user=USER)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(db.default_assistant(USER)["id"], self.first["id"])

    async def test_session_uses_default_and_keeps_existing_binding(self) -> None:
        existing = sessions.create_session(USER, assistant_id=self.first["id"])
        db.update_assistant(self.second["id"], {"is_default": True})
        for body in ({"title": "默认"}, {"assistant_id": None}):
            response = await self.request("POST", "/api/sessions", body, user=USER)
            self.assertEqual(response.status_code, 201)
            self.assertEqual(response.json()["session"]["assistant_id"], self.second["id"])
        self.assertEqual(sessions.get_session(existing["id"], USER["id"])["assistant_id"], self.first["id"])

    async def test_explicit_assistant_overrides_default_but_cannot_bypass_permissions(self) -> None:
        db.update_assistant(self.second["id"], {"is_default": True})
        response = await self.request("POST", "/api/sessions", {"assistant_id": self.first["id"]}, user=USER)
        self.assertEqual(response.json()["session"]["assistant_id"], self.first["id"])
        db.update_assistant(self.third["id"], {"allowed_roles": ["admin"]})
        response = await self.request("POST", "/api/sessions", {"assistant_id": self.third["id"]}, user=USER)
        self.assertEqual(response.status_code, 403)

    async def test_restricted_default_falls_back_without_exposing_it(self) -> None:
        db.update_assistant(self.second["id"], {"is_default": True, "allowed_roles": ["admin"]})
        response = await self.request("POST", "/api/sessions", {}, user=USER)
        self.assertEqual(response.json()["session"]["assistant_id"], self.first["id"])
        listing = await self.request("GET", "/api/assistants", user=USER)
        self.assertNotIn(self.second["id"], [item["id"] for item in listing.json()["items"]])

    async def test_disabled_assistant_cannot_be_default_and_failure_is_atomic(self) -> None:
        response = await self.request("POST", "/api/admin/assistants", {"name": "停用助手", "enabled": False, "is_default": True})
        self.assertEqual(response.status_code, 422)
        db.update_assistant(self.second["id"], {"enabled": False})
        response = await self.request("PUT", f"/api/admin/assistants/{self.second['id']}", {"is_default": True, "name": "不应保存"})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(db.get_assistant(self.second["id"])["name"], self.second["name"])
        self.assertEqual(db.default_assistant(USER)["id"], self.first["id"])
        response = await self.request("PUT", f"/api/admin/assistants/{self.second['id']}", {"enabled": True, "is_default": True})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(db.default_assistant(USER)["id"], self.second["id"])

    async def test_disabling_default_clears_it_and_falls_back(self) -> None:
        response = await self.request("PUT", f"/api/admin/assistants/{self.first['id']}", {"enabled": False})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["assistant"]["is_default"])
        self.assertEqual(db.default_assistant(USER)["id"], self.second["id"])

    async def test_deleting_default_falls_back_to_remaining_assistant(self) -> None:
        response = await self.request("DELETE", f"/api/admin/assistants/{self.first['id']}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(db.default_assistant(USER)["id"], self.second["id"])

    async def test_clearing_default_stays_cleared_after_restart(self) -> None:
        response = await self.request("PUT", f"/api/admin/assistants/{self.first['id']}", {"is_default": False})
        self.assertEqual(response.status_code, 200)
        db.init_db()
        self.assertFalse(any(item["is_default"] for item in db.get_assistants()))
        self.assertEqual(db.default_assistant(USER)["id"], self.first["id"])

    async def test_unknown_target_does_not_clear_existing_default(self) -> None:
        response = await self.request("PUT", "/api/admin/assistants/999999", {"is_default": True})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(db.default_assistant(USER)["id"], self.first["id"])

    def test_unique_constraint_and_concurrent_changes_keep_one_default(self) -> None:
        with self.assertRaises(sqlite3.IntegrityError), db.connect() as conn:
            conn.execute("UPDATE assistants SET is_default = 1 WHERE id = ?", (self.second["id"],))
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda assistant: db.update_assistant(assistant["id"], {"is_default": True}), [self.second, self.third]))
        self.assertTrue(all(results))
        self.assertEqual(sum(item["is_default"] for item in db.get_assistants()), 1)

    async def test_runtime_without_assistant_uses_same_default_and_permission_fallback(self) -> None:
        db.update_assistant(self.second["id"], {"is_default": True})
        with patch.object(runtime, "list_tools", AsyncMock(return_value=[])):
            context = await runtime.build_context("fixture", None, None, user=USER)
            self.assertEqual(context.assistant["id"], self.second["id"])
            db.update_assistant(self.second["id"], {"allowed_roles": ["admin"]})
            context = await runtime.build_context("fixture", None, None, user=USER)
            self.assertEqual(context.assistant["id"], self.first["id"])

    async def test_no_available_assistants_does_not_bind_an_unauthorized_assistant(self) -> None:
        for assistant in db.get_assistants():
            db.update_assistant(assistant["id"], {"allowed_roles": ["admin"]})
        self.assertIsNone(db.default_assistant(USER))
        response = await self.request("POST", "/api/sessions", {}, user=USER)
        self.assertEqual(response.status_code, 201)
        self.assertIsNone(response.json()["session"]["assistant_id"])


if __name__ == "__main__":
    unittest.main()
