import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../src/store.js";

test("legacy SQLite user_id NOT NULL tables migrate to stable owner keys", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "webagent-pi-migration-"));
  const db = new DatabaseSync(path.join(dir, "agent.db"));
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '新对话',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_sessions_user_updated ON sessions(user_id, updated_at DESC);
    CREATE TABLE memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_memories_user_id ON memories(user_id, updated_at DESC);
    INSERT INTO sessions (id,user_id,username,created_at,updated_at) VALUES ('legacy-session',7,'legacy','2026-01-01','2026-01-01');
  `);
  db.close();

  const store = new Store(dir);
  try {
    const migrated = store.one("SELECT * FROM sessions WHERE id='legacy-session'")!;
    assert.equal(migrated.user_id, 7);
    assert.equal(migrated.owner_key, "user-7");
    assert.equal(migrated.subject, "user-7");
    store.insert("sessions", { id: "external-session", owner_key: "tenant-a:alice", subject: "alice", namespace: "tenant-a", username: "alice", created_at: "2026-01-02", updated_at: "2026-01-02" });
    const external = store.one("SELECT * FROM sessions WHERE id='external-session'")!;
    assert.equal(external.user_id, null);
    assert.equal(external.owner_key, "tenant-a:alice");
    assert.ok(store.one("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_sessions_owner_updated'"));
    assert.equal(store.one("SELECT count(*) AS n FROM pragma_index_list('sessions') WHERE name='idx_sessions_user_updated'")!.n, 0);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("legacy schema cleanup backs up the database, drops unused objects and preserves live data", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "webagent-pi-cleanup-"));
  const db = new DatabaseSync(path.join(dir, "agent.db"));
  db.exec(`
    CREATE TABLE assistants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '✦',
      description TEXT NOT NULL DEFAULT '',
      greeting TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL DEFAULT 'agent',
      prefetch_tools TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO assistants (name,created_at,updated_at) VALUES ('保留的助手','2026-01-01','2026-01-01');
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER,
      username TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '新对话',
      retry_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO sessions (id,user_id,username,created_at,updated_at) VALUES ('legacy-session',7,'legacy','2026-01-01','2026-01-01');
    CREATE TABLE pending_approvals (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    INSERT INTO pending_approvals VALUES ('old-approval','{}');
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO settings VALUES
      ('llm_api_key','old-secret'),
      ('llm_base_url','http://old.example'),
      ('llm_temperature','0.3'),
      ('display_mode','diagnostic'),
      ('demo_mode','0'),
      ('keep_me','yes');
  `);
  db.close();

  const store = new Store(dir);
  try {
    assert.equal(store.one("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_approvals'"), undefined);
    for (const column of ["icon", "greeting", "mode", "prefetch_tools"]) assert.ok(!store.columns("assistants").includes(column));
    for (const column of ["retry_count", "error_count"]) assert.ok(!store.columns("sessions").includes(column));
    assert.equal(store.one("SELECT name FROM assistants WHERE id=1")!.name, "保留的助手");
    assert.equal(store.one("SELECT username FROM sessions WHERE id='legacy-session'")!.username, "legacy");
    assert.equal(store.one("SELECT value FROM settings WHERE key='demo_mode'")!.value, "0");
    assert.equal(store.one("SELECT value FROM settings WHERE key='keep_me'")!.value, "yes");
    for (const key of ["llm_api_key", "llm_base_url", "llm_temperature", "display_mode"]) assert.equal(store.one("SELECT value FROM settings WHERE key=?", [key]), undefined);
    assert.ok(store.one("SELECT value FROM settings WHERE key='legacy_schema_cleanup_v1'"));

    const backups = fs.readdirSync(path.join(dir, "backups")).filter((name) => name.startsWith("agent-pre-cleanup-") && name.endsWith(".db"));
    assert.equal(backups.length, 1);
    const backup = new DatabaseSync(path.join(dir, "backups", backups[0]));
    try {
      assert.ok(backup.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_approvals'").get());
      assert.ok((backup.prepare("PRAGMA table_info(assistants)").all() as Array<{ name: string }>).some((column) => column.name === "icon"));
      assert.ok((backup.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>).some((column) => column.name === "retry_count"));
      assert.equal((backup.prepare("SELECT value FROM settings WHERE key='llm_api_key'").get() as { value: string }).value, "old-secret");
    } finally {
      backup.close();
    }
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
