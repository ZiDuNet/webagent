import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fixture } from "./helpers.js";

test("conversation bodies and PI entries are stored as per-session JSON files, not SQLite message tables", async () => {
  const service = await fixture();
  try {
    const session = await service.session();
    const userMessage = service.store.conversations.insert(session.id, { role: "user", content: "文件存储验证" });
    service.store.conversations.insert(session.id, { role: "assistant", content: "正文只写 JSON 文件" });
    service.store.conversations.savePiEntries(session.id, [{ type: "session" }, { type: "message" }]);

    const file = path.join(service.dir, "conversations", `${session.id}.json`);
    assert.equal(fs.existsSync(file), true, "conversation JSON must exist");
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(data.messages.length, 2);
    assert.equal(data.pi_entries.length, 2);
    assert.equal(data.messages[0].content, "文件存储验证");

    assert.equal(service.store.one("SELECT name FROM sqlite_master WHERE type='table' AND name='messages'"), undefined);
    assert.equal(service.store.one("SELECT name FROM sqlite_master WHERE type='table' AND name='pi_state'"), undefined);

    const response = await service.app.inject({
      url: `/api/agent/sessions/${session.id}/messages`,
      headers: { authorization: `Bearer ${service.credential()}` },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().items.length, 2);

    const fork = await service.app.inject({
      method: "POST",
      url: `/api/agent/sessions/${session.id}/fork`,
      headers: { authorization: `Bearer ${service.credential()}` },
      payload: { until_message_id: userMessage.id },
    });
    assert.equal(fork.statusCode, 201, fork.body);
    const forkFile = path.join(service.dir, "conversations", `${fork.json().session.id}.json`);
    assert.equal(fs.existsSync(forkFile), true);
    assert.equal(JSON.parse(fs.readFileSync(forkFile, "utf8")).messages.length, 1);

    const removed = await service.app.inject({
      method: "DELETE",
      url: `/api/agent/sessions/${session.id}/messages/${userMessage.id}`,
      headers: { authorization: `Bearer ${service.credential()}` },
    });
    assert.equal(removed.statusCode, 200);
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).messages.length, 0);

    const deleted = await service.app.inject({
      method: "DELETE",
      url: `/api/agent/sessions/${session.id}`,
      headers: { authorization: `Bearer ${service.credential()}` },
    });
    assert.equal(deleted.statusCode, 200);
    assert.equal(fs.existsSync(file), false);
  } finally {
    await service.close();
  }
});

test("legacy SQLite messages migrate into JSON files with a backup and are dropped from the DB", async () => {
  const service = await fixture();
  const sessionId = "legacy-message-session";
  const dir = service.dir;
  try {
    // Close the fixture DB before constructing a legacy table in the same data directory.
    await service.app.close();
    service.store.close();
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(dir, "agent.db"));
    db.exec(`
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE pi_state (
        session_id TEXT PRIMARY KEY,
        entries TEXT NOT NULL
      );
      INSERT INTO messages (session_id,role,content,created_at)
        VALUES ('${sessionId}','user','旧消息','2026-01-01T00:00:00.000Z');
      INSERT INTO pi_state (session_id,entries)
        VALUES ('${sessionId}','[{"type":"session"}]');
    `);
    db.close();

    const { Store } = await import("../src/store.js");
    const migrated = new Store(dir);
    try {
      const file = path.join(dir, "conversations", `${sessionId}.json`);
      assert.equal(fs.existsSync(file), true);
      assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).messages[0].content, "旧消息");
      assert.equal(fs.existsSync(path.join(dir, "conversations", ".legacy-conversations.json")), true);
      assert.equal(migrated.one("SELECT name FROM sqlite_master WHERE type='table' AND name='messages'"), undefined);
      assert.equal(migrated.one("SELECT name FROM sqlite_master WHERE type='table' AND name='pi_state'"), undefined);
    } finally {
      migrated.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
