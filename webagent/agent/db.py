"""SQLite storage for providers, models, tool switches, skills and settings."""

from __future__ import annotations

import json
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from webagent.agent.crypto import decrypt_secret, encrypt_secret, is_encrypted
from webagent.common.storage import SQLiteConnection
from webagent.config import AGENT_DB_PATH, ensure_data_dir


PROVIDER_TYPES = {"openai_compatible"}
DEFAULT_SETTINGS: dict[str, str] = {
    "llm_base_url": "https://api.openai.com/v1",
    "llm_api_key": "",
    "llm_temperature": "0.3",
    "max_iterations": "6",
    "max_tool_calls": "12",
    "max_run_seconds": "120",
    "context_max_tokens": "0",
    "context_compression": "1",
    "bm25_enabled": "1",
    "memory_enabled": "1",
    "system_prompt_extra": "",
    "demo_mode": "1",
    "default_reasoning_effort": "",
    "default_approval_mode": "confirm",
    "allow_full_access": "1",
    "welcome_title": "有什么我能帮你的吗？",
    "welcome_subtitle": "",
    "welcome_prompts": "",
    "asr_model_id": "",
    "title_model_id": "",
    "fallback_model_id": "",
    "context_reserve_tokens": "1600",
    "compaction_model_id": "",
    "compaction_keep_ratio": "0.58",
    "session_retention_days": "30",
    "admin_session_content": "1",
    "user_daily_token_limit": "0",
    "retry_enabled": "1",
    "retry_max_attempts": "3",
    "retry_initial_backoff_ms": "800",
    "retry_max_backoff_ms": "8000",
    "retry_multiplier": "2.0",
    "retry_jitter": "0.2",
    "retry_honor_retry_after": "1",
    "retry_max_elapsed_seconds": "60",
    "store_reasoning": "0",
    "pagepilot_base_url": "",
    "pagepilot_token": "",
    "pagepilot_enabled": "0",
    "pagepilot_default_title": "",
    "pagepilot_default_description": "",
    "pagepilot_default_visibility": "unlisted",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect() -> sqlite3.Connection:
    ensure_data_dir()
    conn = sqlite3.connect(AGENT_DB_PATH, timeout=15, factory=SQLiteConnection)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS providers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                provider_type TEXT NOT NULL DEFAULT 'openai_compatible',
                base_url TEXT NOT NULL,
                api_key TEXT NOT NULL DEFAULT '',
                extra_headers TEXT NOT NULL DEFAULT '{}',
                timeout_seconds REAL NOT NULL DEFAULT 90,
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS models (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                provider_id INTEGER REFERENCES providers(id),
                name TEXT NOT NULL,
                model_id TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                is_default INTEGER NOT NULL DEFAULT 0,
                sort_order INTEGER NOT NULL DEFAULT 0,
                model_kind TEXT NOT NULL DEFAULT 'chat',
                capabilities TEXT NOT NULL DEFAULT '["text"]',
                supports_tools INTEGER NOT NULL DEFAULT 1,
                context_window INTEGER NOT NULL DEFAULT 0,
                max_output_tokens INTEGER NOT NULL DEFAULT 0,
                temperature REAL NOT NULL DEFAULT 0.3,
                top_p REAL NOT NULL DEFAULT 1.0,
                input_price_per_1m REAL NOT NULL DEFAULT 0,
                output_price_per_1m REAL NOT NULL DEFAULT 0,
                supports_reasoning INTEGER NOT NULL DEFAULT 0,
                reasoning_style TEXT NOT NULL DEFAULT 'effort',
                reasoning_efforts TEXT NOT NULL DEFAULT '[]',
                default_reasoning_effort TEXT NOT NULL DEFAULT '',
                supports_reasoning_summary INTEGER NOT NULL DEFAULT 1,
                supports_transcription INTEGER NOT NULL DEFAULT 0,
                metadata_source TEXT NOT NULL DEFAULT '',
                extra_params TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tool_settings (
                name TEXT PRIMARY KEY,
                enabled INTEGER NOT NULL DEFAULT 1,
                visible INTEGER NOT NULL DEFAULT 1,
                selectable INTEGER NOT NULL DEFAULT 1,
                default_selected INTEGER NOT NULL DEFAULT 1,
                source TEXT NOT NULL DEFAULT 'mcp',
                definition TEXT NOT NULL DEFAULT '{}',
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS dynamic_tools (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                category TEXT NOT NULL DEFAULT '业务连接器',
                permission TEXT NOT NULL DEFAULT '',
                risk TEXT NOT NULL DEFAULT 'read',
                method TEXT NOT NULL DEFAULT 'GET',
                url_template TEXT NOT NULL,
                headers TEXT NOT NULL DEFAULT '{}',
                input_schema TEXT NOT NULL DEFAULT '{"type":"object","properties":{}}',
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS skills (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                slug TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL DEFAULT '',
                kind TEXT NOT NULL DEFAULT 'prompt',
                license TEXT NOT NULL DEFAULT '',
                metadata TEXT NOT NULL DEFAULT '{}',
                files TEXT NOT NULL DEFAULT '{}',
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL,
                username TEXT NOT NULL,
                action TEXT NOT NULL,
                resource TEXT NOT NULL,
                detail TEXT NOT NULL DEFAULT '',
                source TEXT NOT NULL DEFAULT 'agent'
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                username TEXT NOT NULL,
                assistant_id INTEGER,
                title TEXT NOT NULL DEFAULT '新对话',
                summary TEXT NOT NULL DEFAULT '',
                summary_until_id INTEGER NOT NULL DEFAULT 0,
                last_context_tokens INTEGER NOT NULL DEFAULT 0,
                last_compacted_at TEXT,
                last_model_id INTEGER,
                last_model_name TEXT NOT NULL DEFAULT '',
                total_input_tokens INTEGER NOT NULL DEFAULT 0,
                total_output_tokens INTEGER NOT NULL DEFAULT 0,
                total_tokens INTEGER NOT NULL DEFAULT 0,
                total_cost_usd REAL NOT NULL DEFAULT 0,
                tool_calls INTEGER NOT NULL DEFAULT 0,
                tool_failures INTEGER NOT NULL DEFAULT 0,
                approval_rejections INTEGER NOT NULL DEFAULT 0,
                retry_count INTEGER NOT NULL DEFAULT 0,
                compaction_count INTEGER NOT NULL DEFAULT 0,
                error_count INTEGER NOT NULL DEFAULT 0,
                last_status TEXT NOT NULL DEFAULT '',
                last_error TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS assistants (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                icon TEXT NOT NULL DEFAULT '✦',
                description TEXT NOT NULL DEFAULT '',
                greeting TEXT NOT NULL DEFAULT '',
                system_prompt TEXT NOT NULL DEFAULT '',
                mode TEXT NOT NULL DEFAULT 'agent',
                model_row_id INTEGER,
                allow_model_switch INTEGER NOT NULL DEFAULT 1,
                prefetch_tools TEXT NOT NULL DEFAULT '[]',
                tool_names TEXT NOT NULL DEFAULT '[]',
                skill_ids TEXT NOT NULL DEFAULT '[]',
                max_steps INTEGER NOT NULL DEFAULT 0,
                max_tool_calls INTEGER NOT NULL DEFAULT 0,
                max_run_seconds INTEGER NOT NULL DEFAULT 0,
                context_max_tokens INTEGER NOT NULL DEFAULT 0,
                memory_enabled INTEGER NOT NULL DEFAULT 1,
                allowed_roles TEXT NOT NULL DEFAULT '["*"]',
                enabled INTEGER NOT NULL DEFAULT 1,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                reasoning TEXT NOT NULL DEFAULT '',
                attachments TEXT NOT NULL DEFAULT '[]',
                tool_runs TEXT NOT NULL DEFAULT '[]',
                metadata TEXT NOT NULL DEFAULT '{}',
                token_estimate INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                username TEXT NOT NULL,
                content TEXT NOT NULL,
                kind TEXT NOT NULL DEFAULT 'fact',
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS publications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                username TEXT NOT NULL,
                session_id TEXT,
                remote_base_url TEXT NOT NULL,
                code TEXT NOT NULL DEFAULT '',
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                filename TEXT NOT NULL DEFAULT 'index.html',
                url TEXT NOT NULL DEFAULT '',
                detail_url TEXT NOT NULL DEFAULT '',
                visibility TEXT NOT NULL DEFAULT 'unlisted',
                password_set INTEGER NOT NULL DEFAULT 0,
                version INTEGER,
                publish_count INTEGER NOT NULL DEFAULT 0,
                size INTEGER NOT NULL DEFAULT 0,
                latest_version_id INTEGER,
                source TEXT NOT NULL DEFAULT 'preview',
                status TEXT NOT NULL DEFAULT 'publishing',
                last_error TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS publication_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                publication_id INTEGER NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
                html TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                filename TEXT NOT NULL DEFAULT 'index.html',
                visibility TEXT NOT NULL DEFAULT 'unlisted',
                password_set INTEGER NOT NULL DEFAULT 0,
                code TEXT NOT NULL DEFAULT '',
                url TEXT NOT NULL DEFAULT '',
                detail_url TEXT NOT NULL DEFAULT '',
                version INTEGER,
                size INTEGER NOT NULL DEFAULT 0,
                source TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'publishing',
                error TEXT NOT NULL DEFAULT '',
                response TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_publications_owner
                ON publications(user_id, updated_at DESC, id DESC);
            CREATE INDEX IF NOT EXISTS idx_publications_session
                ON publications(user_id, session_id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_publications_remote_code
                ON publications(remote_base_url, code) WHERE code != '';
            CREATE INDEX IF NOT EXISTS idx_publication_versions
                ON publication_versions(publication_id, id DESC);

            CREATE TABLE IF NOT EXISTS compaction_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                trigger TEXT NOT NULL,
                before_tokens INTEGER NOT NULL DEFAULT 0,
                after_tokens INTEGER NOT NULL DEFAULT 0,
                summarized_messages INTEGER NOT NULL DEFAULT 0,
                summary_model TEXT NOT NULL DEFAULT '',
                duration_ms INTEGER NOT NULL DEFAULT 0,
                ok INTEGER NOT NULL DEFAULT 1,
                error TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS llm_calls (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT,
                username TEXT NOT NULL DEFAULT '',
                model TEXT NOT NULL DEFAULT '',
                provider TEXT NOT NULL DEFAULT '',
                purpose TEXT NOT NULL DEFAULT 'chat',
                attempt INTEGER NOT NULL DEFAULT 1,
                status TEXT NOT NULL DEFAULT 'ok',
                input_tokens INTEGER NOT NULL DEFAULT 0,
                output_tokens INTEGER NOT NULL DEFAULT 0,
                total_tokens INTEGER NOT NULL DEFAULT 0,
                cost_usd REAL NOT NULL DEFAULT 0,
                latency_ms INTEGER NOT NULL DEFAULT 0,
                error TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS pending_approvals (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                username TEXT NOT NULL,
                session_id TEXT NOT NULL,
                assistant_id INTEGER,
                model_row_id INTEGER,
                requested_tools TEXT NOT NULL DEFAULT '[]',
                reasoning_effort TEXT NOT NULL DEFAULT '',
                mode TEXT NOT NULL DEFAULT 'llm',
                messages TEXT NOT NULL DEFAULT '[]',
                calls TEXT NOT NULL DEFAULT '[]',
                tool_runs TEXT NOT NULL DEFAULT '[]',
                round_count INTEGER NOT NULL DEFAULT 0,
                tool_call_total INTEGER NOT NULL DEFAULT 0,
                usage TEXT NOT NULL DEFAULT '{}',
                status TEXT NOT NULL DEFAULT 'pending',
                created_at REAL NOT NULL,
                expires_at REAL NOT NULL,
                resolved_at REAL
            );

            CREATE INDEX IF NOT EXISTS idx_sessions_user_updated
                ON sessions(user_id, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_messages_session_id
                ON messages(session_id, id ASC);
            CREATE INDEX IF NOT EXISTS idx_memories_user_id
                ON memories(user_id, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_assistants_order
                ON assistants(enabled, sort_order ASC, id ASC);
            CREATE INDEX IF NOT EXISTS idx_compaction_session
                ON compaction_events(session_id, id DESC);
            CREATE INDEX IF NOT EXISTS idx_llm_calls_session
                ON llm_calls(session_id, id DESC);
            CREATE INDEX IF NOT EXISTS idx_llm_calls_created
                ON llm_calls(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_pending_approvals_user
                ON pending_approvals(user_id, status, expires_at);
            """
        )
        _ensure_model_columns(conn)
        _ensure_session_columns(conn)
        _ensure_message_columns(conn)
        _clean_legacy_reasoning(conn)
        _ensure_skill_columns(conn)
        _ensure_tool_columns(conn)
        _backfill_skill_slugs(conn)
        for key, value in DEFAULT_SETTINGS.items():
            conn.execute(
                "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
                (key, value),
            )
        # The first release kept sessions forever by default. Move existing
        # installations to the new 30-day default once; administrators can
        # still set 0 explicitly afterwards.
        migrated = conn.execute(
            "SELECT value FROM settings WHERE key = 'session_retention_migrated'"
        ).fetchone()
        if migrated is None:
            conn.execute(
                "UPDATE settings SET value = '30' "
                "WHERE key = 'session_retention_days' AND value = '0'"
            )
            conn.execute(
                "INSERT INTO settings (key, value) VALUES "
                "('session_retention_migrated', '1')"
            )

        _seed_providers(conn)
        _migrate_provider_secrets(conn)
        model_count = conn.execute("SELECT COUNT(*) AS n FROM models").fetchone()["n"]
        if model_count == 0:
            _seed_models(conn)
        _assign_legacy_models(conn)

        skill_count = conn.execute("SELECT COUNT(*) AS n FROM skills").fetchone()["n"]
        if skill_count == 0:
            _seed_skills(conn)

        assistant_count = conn.execute(
            "SELECT COUNT(*) AS n FROM assistants"
        ).fetchone()["n"]
        if assistant_count == 0:
            _seed_assistants(conn)


def _ensure_model_columns(conn: sqlite3.Connection) -> None:
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(models)")}
    additions = {
        "provider_id": "INTEGER",
        "model_kind": "TEXT NOT NULL DEFAULT 'chat'",
        "capabilities": "TEXT NOT NULL DEFAULT '[\"text\"]'",
        "supports_tools": "INTEGER NOT NULL DEFAULT 1",
        "context_window": "INTEGER NOT NULL DEFAULT 0",
        "max_output_tokens": "INTEGER NOT NULL DEFAULT 0",
        "temperature": "REAL NOT NULL DEFAULT 0.3",
        "top_p": "REAL NOT NULL DEFAULT 1.0",
        "input_price_per_1m": "REAL NOT NULL DEFAULT 0",
        "output_price_per_1m": "REAL NOT NULL DEFAULT 0",
        "supports_reasoning": "INTEGER NOT NULL DEFAULT 0",
        "reasoning_style": "TEXT NOT NULL DEFAULT 'effort'",
        "reasoning_efforts": "TEXT NOT NULL DEFAULT '[]'",
        "default_reasoning_effort": "TEXT NOT NULL DEFAULT ''",
        "supports_reasoning_summary": "INTEGER NOT NULL DEFAULT 1",
        "supports_transcription": "INTEGER NOT NULL DEFAULT 0",
        "metadata_source": "TEXT NOT NULL DEFAULT ''",
        "extra_params": "TEXT NOT NULL DEFAULT '{}'",
    }
    for name, definition in additions.items():
        if name not in columns:
            conn.execute(f"ALTER TABLE models ADD COLUMN {name} {definition}")


def _ensure_session_columns(conn: sqlite3.Connection) -> None:
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(sessions)")}
    additions = {
        "assistant_id": "INTEGER",
        "last_model_id": "INTEGER",
        "last_model_name": "TEXT NOT NULL DEFAULT ''",
        "total_input_tokens": "INTEGER NOT NULL DEFAULT 0",
        "total_output_tokens": "INTEGER NOT NULL DEFAULT 0",
        "total_tokens": "INTEGER NOT NULL DEFAULT 0",
        "total_cost_usd": "REAL NOT NULL DEFAULT 0",
        "tool_calls": "INTEGER NOT NULL DEFAULT 0",
        "tool_failures": "INTEGER NOT NULL DEFAULT 0",
        "approval_rejections": "INTEGER NOT NULL DEFAULT 0",
        "retry_count": "INTEGER NOT NULL DEFAULT 0",
        "compaction_count": "INTEGER NOT NULL DEFAULT 0",
        "error_count": "INTEGER NOT NULL DEFAULT 0",
        "last_status": "TEXT NOT NULL DEFAULT ''",
        "last_error": "TEXT NOT NULL DEFAULT ''",
    }
    for name, definition in additions.items():
        if name not in columns:
            conn.execute(f"ALTER TABLE sessions ADD COLUMN {name} {definition}")


def _clean_legacy_reasoning(conn: sqlite3.Connection) -> None:
    if conn.execute("SELECT 1 FROM settings WHERE key = 'reasoning_metadata_cleaned_v1'").fetchone():
        return
    for row in conn.execute("SELECT id, metadata FROM messages WHERE metadata LIKE '%\"reasoning\"%'").fetchall():
        try:
            metadata = json.loads(row["metadata"])
        except (TypeError, ValueError):
            continue
        run = metadata.get("run") if isinstance(metadata, dict) else None
        if isinstance(run, dict) and "reasoning" in run:
            run.pop("reasoning")
            conn.execute("UPDATE messages SET metadata = ? WHERE id = ?", (json.dumps(metadata, ensure_ascii=False), row["id"]))
    conn.execute("INSERT INTO settings (key, value) VALUES ('reasoning_metadata_cleaned_v1', '1')")


def _ensure_message_columns(conn: sqlite3.Connection) -> None:
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(messages)")}
    additions = {
        "reasoning": "TEXT NOT NULL DEFAULT ''",
    }
    for name, definition in additions.items():
        if name not in columns:
            conn.execute(f"ALTER TABLE messages ADD COLUMN {name} {definition}")


def _ensure_skill_columns(conn: sqlite3.Connection) -> None:
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(skills)")}
    additions = {
        "slug": "TEXT NOT NULL DEFAULT ''",
        "kind": "TEXT NOT NULL DEFAULT 'prompt'",
        "license": "TEXT NOT NULL DEFAULT ''",
        "metadata": "TEXT NOT NULL DEFAULT '{}'",
        "files": "TEXT NOT NULL DEFAULT '{}'",
    }
    for name, definition in additions.items():
        if name not in columns:
            conn.execute(f"ALTER TABLE skills ADD COLUMN {name} {definition}")


def _ensure_tool_columns(conn: sqlite3.Connection) -> None:
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(tool_settings)")}
    additions = {
        "visible": "INTEGER NOT NULL DEFAULT 1",
        "selectable": "INTEGER NOT NULL DEFAULT 1",
        "default_selected": "INTEGER NOT NULL DEFAULT 1",
        "source": "TEXT NOT NULL DEFAULT 'mcp'",
        "definition": "TEXT NOT NULL DEFAULT '{}'",
    }
    for name, definition in additions.items():
        if name not in columns:
            conn.execute(
                f"ALTER TABLE tool_settings ADD COLUMN {name} {definition}"
            )


def _provider_rows(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute("SELECT * FROM providers ORDER BY id ASC").fetchall()


def _seed_providers(conn: sqlite3.Connection) -> None:
    if conn.execute("SELECT COUNT(*) AS n FROM providers").fetchone()["n"]:
        return
    settings = {
        row["key"]: row["value"]
        for row in conn.execute("SELECT key, value FROM settings").fetchall()
    }
    legacy_key = settings.get("llm_api_key", "").strip()
    legacy_base = settings.get("llm_base_url", "").strip()
    now = utc_now()
    providers = [
        ("OpenAI", "openai_compatible", "https://api.openai.com/v1", "", 90),
        ("DeepSeek", "openai_compatible", "https://api.deepseek.com/v1", "", 90),
        (
            "通义千问",
            "openai_compatible",
            "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "",
            90,
        ),
    ]
    if legacy_key:
        providers.insert(
            0,
            (
                "原连接配置",
                "openai_compatible",
                legacy_base or "https://api.openai.com/v1",
                legacy_key,
                90,
            ),
        )
    for name, provider_type, base_url, api_key, timeout_seconds in providers:
        conn.execute(
            """
            INSERT INTO providers
                (name, provider_type, base_url, api_key, extra_headers,
                 timeout_seconds, enabled, created_at, updated_at)
            VALUES (?, ?, ?, ?, '{}', ?, 1, ?, ?)
            """,
            (
                name,
                provider_type,
                base_url,
                encrypt_secret(api_key),
                timeout_seconds,
                now,
                now,
            ),
        )
    conn.execute("UPDATE settings SET value = '' WHERE key = 'llm_api_key'")


def _migrate_provider_secrets(conn: sqlite3.Connection) -> None:
    rows = conn.execute("SELECT id, api_key FROM providers").fetchall()
    for row in rows:
        value = str(row["api_key"] or "")
        if value and not is_encrypted(value):
            conn.execute(
                "UPDATE providers SET api_key = ? WHERE id = ?",
                (encrypt_secret(value), row["id"]),
            )
    conn.execute("UPDATE settings SET value = '' WHERE key = 'llm_api_key'")


def _seed_models(conn: sqlite3.Connection) -> None:
    now = utc_now()
    providers = {
        row["name"]: row["id"]
        for row in conn.execute("SELECT id, name FROM providers").fetchall()
    }
    fallback = providers.get("OpenAI") or next(iter(providers.values()), None)
    models = [
        {
            "provider_id": providers.get("OpenAI", fallback),
            "name": "GPT-4o mini",
            "model_id": "gpt-4o-mini",
            "enabled": 1,
            "is_default": 1,
            "sort_order": 10,
            "capabilities": ["text", "image"],
            "supports_tools": 1,
            "context_window": 128000,
            "max_output_tokens": 16384,
            "temperature": 0.3,
            "top_p": 1.0,
            "input_price_per_1m": 0,
            "output_price_per_1m": 0,
            "extra_params": {},
        },
        {
            "provider_id": providers.get("DeepSeek", fallback),
            "name": "DeepSeek Chat",
            "model_id": "deepseek-chat",
            "enabled": 1,
            "is_default": 0,
            "sort_order": 20,
            "capabilities": ["text"],
            "supports_tools": 1,
            "context_window": 65536,
            "max_output_tokens": 8192,
            "temperature": 0.3,
            "top_p": 1.0,
            "input_price_per_1m": 0,
            "output_price_per_1m": 0,
            "extra_params": {},
        },
        {
            "provider_id": providers.get("通义千问", fallback),
            "name": "Qwen Plus",
            "model_id": "qwen-plus",
            "enabled": 1,
            "is_default": 0,
            "sort_order": 30,
            "capabilities": ["text"],
            "supports_tools": 1,
            "context_window": 32768,
            "max_output_tokens": 8192,
            "temperature": 0.3,
            "top_p": 1.0,
            "input_price_per_1m": 0,
            "output_price_per_1m": 0,
            "extra_params": {},
        },
    ]
    for model in models:
        conn.execute(
            """
            INSERT INTO models
                (provider_id, name, model_id, enabled, is_default, sort_order,
                 capabilities, supports_tools, context_window, max_output_tokens,
                 temperature, top_p, input_price_per_1m, output_price_per_1m,
                 extra_params, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                model["provider_id"],
                model["name"],
                model["model_id"],
                model["enabled"],
                model["is_default"],
                model["sort_order"],
                json.dumps(model["capabilities"], ensure_ascii=False),
                model["supports_tools"],
                model["context_window"],
                model["max_output_tokens"],
                model["temperature"],
                model["top_p"],
                model["input_price_per_1m"],
                model["output_price_per_1m"],
                json.dumps(model["extra_params"], ensure_ascii=False),
                now,
                now,
            ),
        )


def _assign_legacy_models(conn: sqlite3.Connection) -> None:
    providers = _provider_rows(conn)
    if not providers:
        return
    by_name = {row["name"]: row["id"] for row in providers}
    fallback = (
        by_name.get("原连接配置")
        or by_name.get("OpenAI")
        or providers[0]["id"]
    )
    unmatched = conn.execute(
        "SELECT id, model_id FROM models WHERE provider_id IS NULL"
    ).fetchall()
    for row in unmatched:
        model_id = str(row["model_id"]).lower()
        provider_id = fallback
        if "deepseek" in model_id and "DeepSeek" in by_name:
            provider_id = by_name["DeepSeek"]
        elif ("qwen" in model_id or "qwq" in model_id) and "通义千问" in by_name:
            provider_id = by_name["通义千问"]
        conn.execute(
            "UPDATE models SET provider_id = ? WHERE id = ?",
            (provider_id, row["id"]),
        )
    conn.execute(
        """
        UPDATE models
        SET provider_id = ?
        WHERE provider_id NOT IN (SELECT id FROM providers)
        """,
        (fallback,),
    )


def _seed_skills(conn: sqlite3.Connection) -> None:
    now = utc_now()
    skills = [
        (
            "device-inspection",
            "设备巡检规范",
            "统一设备状态判断与信息组织方式。",
            """巡检判断规则：
- 在线：运行正常，保持常规监控。
- 维护中：先确认是否处于计划维护窗口。
- 离线：优先排查供电、网络链路和最近变更。

输出设备列表时按“名称 / 编号 / 位置 / 状态”组织，先给结论再给明细。""",
            {
                "references/status-codes.md": (
                    "# 设备状态码\n\n"
                    "- 在线：心跳正常，最近 5 分钟内有上报。\n"
                    "- 维护中：处于计划维护窗口，暂停告警。\n"
                    "- 离线：超过 10 分钟无心跳，需排查供电与网络。\n"
                )
            },
        ),
        (
            "answer-safety",
            "回答与安全规范",
            "约束 Agent 的数据来源、权限说明和危险操作行为。",
            """只通过已启用工具读取业务数据，不编造设备、编号、状态或权限。
涉及新增、修改、删除时，必须等待用户在审批卡中明确确认。
如果工具返回 403 或权限错误，直接说明当前账号缺少的权限，不要尝试绕过。
回答使用简洁中文，涉及数字时优先引用工具返回的真实结果。""",
            {},
        ),
    ]
    for slug, name, description, content, files in skills:
        conn.execute(
            """
            INSERT INTO skills
                (name, slug, description, content, kind, license, metadata,
                 files, enabled, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'prompt', '', '{}', ?, 1, ?, ?)
            """,
            (
                name,
                slug,
                description,
                content,
                json.dumps(files, ensure_ascii=False),
                now,
                now,
            ),
        )


def _backfill_skill_slugs(conn: sqlite3.Connection) -> None:
    known = {
        "设备巡检规范": "device-inspection",
        "回答与安全规范": "answer-safety",
    }
    rows = conn.execute(
        "SELECT id, name FROM skills WHERE slug = '' OR slug IS NULL"
    ).fetchall()
    for row in rows:
        slug = known.get(row["name"], f"skill-{row['id']}")
        conn.execute(
            "UPDATE skills SET slug = ? WHERE id = ?",
            (slug, row["id"]),
        )
    reference = conn.execute(
        "SELECT id, files FROM skills WHERE slug = 'device-inspection'"
    ).fetchone()
    if reference and not _json_object(reference["files"]):
        conn.execute(
            "UPDATE skills SET files = ? WHERE id = ?",
            (
                json.dumps(
                    {
                        "references/status-codes.md": (
                            "# 设备状态码\n\n"
                            "- 在线：心跳正常，最近 5 分钟内有上报。\n"
                            "- 维护中：处于计划维护窗口，暂停告警。\n"
                            "- 离线：超过 10 分钟无心跳，需排查供电与网络。\n"
                        )
                    },
                    ensure_ascii=False,
                ),
                reference["id"],
            ),
        )


def _seed_assistants(conn: sqlite3.Connection) -> None:
    now = utc_now()
    assistants = [
        {
            "name": "设备管理助手",
            "icon": "🛠",
            "description": "查询、统计、修改和删除设备，工具范围跟随账号权限与管理员开关。",
            "greeting": "我可以查询设备、统计状态，并在你审批后执行修改或删除。",
            "system_prompt": (
                "你负责设备信息表的日常运维。优先使用工具获取真实数据，"
                "涉及写入和删除时说明影响范围，等待用户在审批卡中确认。"
            ),
            "mode": "agent",
            "allow_model_switch": 1,
            "prefetch_tools": [],
            "tool_names": [],
            "skill_ids": [],
            "sort_order": 10,
        },
        {
            "name": "只读分析员",
            "icon": "🔍",
            "description": "只使用查询类工具做统计和解读，不具备任何写入能力。",
            "greeting": "我只看不改。可以帮你看设备台账、状态分布和单台详情。",
            "system_prompt": (
                "你是一名只读数据分析助手。只调用查询类工具，"
                "不要建议用户直接执行修改命令，需要变更时提示切换到设备管理助手。"
            ),
            "mode": "agent",
            "allow_model_switch": 1,
            "prefetch_tools": [],
            "tool_names": [
                "get_my_profile",
                "list_devices",
                "get_device",
                "get_device_stats",
            ],
            "skill_ids": [],
            "sort_order": 20,
        },
        {
            "name": "设备健康报告",
            "icon": "📋",
            "description": "一键采集设备台账并生成健康报告，只读、单步、结果稳定。",
            "greeting": "点击开始，我会先采集设备数据，再生成一份健康报告。",
            "system_prompt": (
                "你负责输出设备健康报告。基于预采集数据给出总体结论、"
                "异常设备清单和优先处理建议，不要编造未提供的数据。"
            ),
            "mode": "report",
            "allow_model_switch": 1,
            "prefetch_tools": ["get_device_stats", "list_devices"],
            "tool_names": ["get_device_stats", "list_devices"],
            "skill_ids": [],
            "sort_order": 30,
        },
    ]
    for item in assistants:
        conn.execute(
            """
            INSERT INTO assistants
                (name, icon, description, greeting, system_prompt, mode,
                 model_row_id, allow_model_switch, prefetch_tools, tool_names,
                 skill_ids, max_steps, max_tool_calls, max_run_seconds,
                 context_max_tokens, memory_enabled, allowed_roles, enabled,
                 sort_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 0, 0, 0, 0, 1,
                    '["*"]', 1, ?, ?, ?)
            """,
            (
                item["name"],
                item["icon"],
                item["description"],
                item["greeting"],
                item["system_prompt"],
                item["mode"],
                item["allow_model_switch"],
                json.dumps(item["prefetch_tools"], ensure_ascii=False),
                json.dumps(item["tool_names"], ensure_ascii=False),
                json.dumps(item["skill_ids"], ensure_ascii=False),
                item["sort_order"],
                now,
                now,
            ),
        )


def _decorate_assistant(row: sqlite3.Row) -> dict[str, Any]:
    item = dict(row)
    item["prefetch_tools"] = _json_list(item.get("prefetch_tools"))
    item["tool_names"] = _json_list(item.get("tool_names"))
    item["skill_ids"] = [
        int(value)
        for value in _json_list(item.get("skill_ids"))
        if str(value).lstrip("-").isdigit()
    ]
    item["allowed_roles"] = _json_list(item.get("allowed_roles")) or ["*"]
    item["allow_model_switch"] = bool(item.get("allow_model_switch"))
    item["memory_enabled"] = bool(item.get("memory_enabled"))
    item["enabled"] = bool(item.get("enabled"))
    return item


def _json_object(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if not isinstance(value, str) or not value.strip():
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _json_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value]
    if not isinstance(value, str):
        return []
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return []
    return [str(item) for item in parsed] if isinstance(parsed, list) else []


def _decorate_provider(row: sqlite3.Row, model_count: int = 0) -> dict[str, Any]:
    item = dict(row)
    item["api_key"] = decrypt_secret(str(item.get("api_key") or ""))
    item["extra_headers"] = _json_object(item.get("extra_headers"))
    item["enabled"] = bool(item.get("enabled"))
    item["api_key_set"] = bool(str(item.get("api_key", "")).strip())
    item["model_count"] = model_count
    return item


def _decorate_model(row: sqlite3.Row) -> dict[str, Any]:
    item = dict(row)
    item["enabled"] = bool(item.get("enabled"))
    item["is_default"] = bool(item.get("is_default"))
    item["supports_tools"] = bool(item.get("supports_tools", 1))
    item["supports_reasoning"] = bool(item.get("supports_reasoning", 0))
    item["supports_reasoning_summary"] = bool(
        item.get("supports_reasoning_summary", 1)
    )
    item["supports_transcription"] = bool(item.get("supports_transcription", 0))
    item["model_kind"] = item.get("model_kind") or (
        "asr" if item["supports_transcription"] else "chat"
    )
    item["reasoning_efforts"] = _json_list(item.get("reasoning_efforts"))
    item["input_price_per_1m"] = float(item.get("input_price_per_1m") or 0)
    item["output_price_per_1m"] = float(item.get("output_price_per_1m") or 0)
    item["capabilities"] = _json_list(item.get("capabilities"))
    item["extra_params"] = _json_object(item.get("extra_params"))
    item["provider_enabled"] = bool(item.get("provider_enabled", 0))
    return item


def _decorate_skill(row: sqlite3.Row) -> dict[str, Any]:
    item = dict(row)
    item["enabled"] = bool(item.get("enabled"))
    item["metadata"] = _json_object(item.get("metadata"))
    files = _json_object(item.get("files"))
    item["files"] = {
        str(path): str(content)
        for path, content in files.items()
        if isinstance(path, str) and isinstance(content, str)
    }
    item["kind"] = item.get("kind") or "prompt"
    item["slug"] = item.get("slug") or f"skill-{item['id']}"
    return item


def get_settings() -> dict[str, str]:
    with connect() as conn:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
    values = dict(DEFAULT_SETTINGS)
    values.update({row["key"]: row["value"] for row in rows})
    return values


def set_settings(values: dict[str, str]) -> None:
    with connect() as conn:
        for key, value in values.items():
            conn.execute(
                """
                INSERT INTO settings (key, value) VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """,
                (key, str(value)),
            )


def get_providers(include_disabled: bool = True) -> list[dict[str, Any]]:
    sql = """
        SELECT p.*, COUNT(m.id) AS model_count
        FROM providers p
        LEFT JOIN models m ON m.provider_id = p.id
    """
    if not include_disabled:
        sql += " WHERE p.enabled = 1"
    sql += " GROUP BY p.id ORDER BY p.id ASC"
    with connect() as conn:
        rows = conn.execute(sql).fetchall()
    return [_decorate_provider(row, int(row["model_count"])) for row in rows]


def get_provider(provider_id: int) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute(
            """
            SELECT p.*, COUNT(m.id) AS model_count
            FROM providers p
            LEFT JOIN models m ON m.provider_id = p.id
            WHERE p.id = ?
            GROUP BY p.id
            """,
            (provider_id,),
        ).fetchone()
    return _decorate_provider(row, int(row["model_count"])) if row else None


def create_provider(
    name: str,
    provider_type: str,
    base_url: str,
    api_key: str = "",
    extra_headers: dict[str, str] | None = None,
    timeout_seconds: float = 90,
    enabled: bool = True,
) -> dict[str, Any]:
    now = utc_now()
    with connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO providers
                (name, provider_type, base_url, api_key, extra_headers,
                 timeout_seconds, enabled, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                name.strip(),
                provider_type,
                base_url.strip().rstrip("/"),
                encrypt_secret(api_key),
                json.dumps(extra_headers or {}, ensure_ascii=False),
                timeout_seconds,
                int(enabled),
                now,
                now,
            ),
        )
        provider_id = int(cursor.lastrowid)
    return get_provider(provider_id) or {}


def update_provider(
    provider_id: int, values: dict[str, Any]
) -> dict[str, Any] | None:
    if not get_provider(provider_id):
        return None
    allowed = {
        "name",
        "provider_type",
        "base_url",
        "api_key",
        "extra_headers",
        "timeout_seconds",
        "enabled",
    }
    updates = {key: value for key, value in values.items() if key in allowed}
    if "extra_headers" in updates:
        updates["extra_headers"] = json.dumps(
            updates["extra_headers"] or {}, ensure_ascii=False
        )
    if "enabled" in updates:
        updates["enabled"] = int(bool(updates["enabled"]))
    if "base_url" in updates:
        updates["base_url"] = str(updates["base_url"]).strip().rstrip("/")
    if "api_key" in updates:
        updates["api_key"] = encrypt_secret(str(updates["api_key"]))
    updates["updated_at"] = utc_now()
    assignments = ", ".join(f"{key} = ?" for key in updates)
    with connect() as conn:
        conn.execute(
            f"UPDATE providers SET {assignments} WHERE id = ?",
            [*updates.values(), provider_id],
        )
    return get_provider(provider_id)


def delete_provider(provider_id: int) -> tuple[bool, str]:
    with connect() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS n FROM models WHERE provider_id = ?", (provider_id,)
        ).fetchone()
        if row["n"]:
            return False, f"该供应商下还有 {row['n']} 个模型，请先删除或迁移模型"
        cursor = conn.execute("DELETE FROM providers WHERE id = ?", (provider_id,))
        return (cursor.rowcount > 0, "供应商不存在" if cursor.rowcount == 0 else "")


def get_models(include_disabled: bool = True) -> list[dict[str, Any]]:
    sql = """
        SELECT m.*, p.name AS provider_name, p.provider_type AS provider_type,
               p.enabled AS provider_enabled
        FROM models m
        LEFT JOIN providers p ON p.id = m.provider_id
    """
    conditions = []
    if not include_disabled:
        conditions.append("m.enabled = 1")
        conditions.append("p.enabled = 1")
    if conditions:
        sql += " WHERE " + " AND ".join(conditions)
    sql += " ORDER BY m.is_default DESC, m.sort_order ASC, m.id ASC"
    with connect() as conn:
        rows = conn.execute(sql).fetchall()
    return [_decorate_model(row) for row in rows]


def get_model(model_row_id: int) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute(
            """
            SELECT m.*, p.name AS provider_name, p.provider_type AS provider_type,
                   p.enabled AS provider_enabled
            FROM models m
            LEFT JOIN providers p ON p.id = m.provider_id
            WHERE m.id = ?
            """,
            (model_row_id,),
        ).fetchone()
    return _decorate_model(row) if row else None


def find_model_by_external_id(provider_id: int, model_id: str) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute(
            "SELECT id FROM models WHERE provider_id = ? AND model_id = ?",
            (provider_id, model_id),
        ).fetchone()
    return get_model(int(row["id"])) if row else None


def default_model() -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute(
            """
            SELECT m.*, p.name AS provider_name, p.provider_type AS provider_type,
                   p.enabled AS provider_enabled
            FROM models m
            JOIN providers p ON p.id = m.provider_id
            WHERE m.enabled = 1 AND p.enabled = 1
            ORDER BY m.is_default DESC, m.sort_order ASC, m.id ASC
            LIMIT 1
            """
        ).fetchone()
    return _decorate_model(row) if row else None


def create_model(
    *,
    provider_id: int,
    name: str,
    model_id: str,
    model_kind: str = "chat",
    enabled: bool = True,
    is_default: bool = False,
    capabilities: list[str] | None = None,
    supports_tools: bool = True,
    context_window: int = 0,
    max_output_tokens: int = 0,
    temperature: float = 0.3,
    top_p: float = 1.0,
    input_price_per_1m: float = 0,
    output_price_per_1m: float = 0,
    supports_reasoning: bool = False,
    reasoning_style: str = "effort",
    reasoning_efforts: list[str] | None = None,
    default_reasoning_effort: str = "",
    supports_reasoning_summary: bool = True,
    supports_transcription: bool = False,
    metadata_source: str = "",
    extra_params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    now = utc_now()
    with connect() as conn:
        if is_default:
            conn.execute("UPDATE models SET is_default = 0")
        cursor = conn.execute(
            """
            INSERT INTO models
                (provider_id, name, model_id, model_kind, enabled, is_default, sort_order,
                 capabilities, supports_tools, context_window, max_output_tokens,
                 temperature, top_p, input_price_per_1m, output_price_per_1m,
                 supports_reasoning, reasoning_style, reasoning_efforts,
                 default_reasoning_effort, supports_reasoning_summary,
                 supports_transcription, metadata_source,
                 extra_params, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 100,
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                provider_id,
                name.strip(),
                model_id.strip(),
                model_kind or "chat",
                int(enabled),
                int(is_default),
                json.dumps(capabilities or ["text"], ensure_ascii=False),
                int(supports_tools),
                max(0, context_window),
                max(0, max_output_tokens),
                temperature,
                top_p,
                max(0.0, float(input_price_per_1m or 0)),
                max(0.0, float(output_price_per_1m or 0)),
                int(supports_reasoning),
                reasoning_style or "effort",
                json.dumps(reasoning_efforts or [], ensure_ascii=False),
                default_reasoning_effort or "",
                int(supports_reasoning_summary),
                int(supports_transcription),
                metadata_source or "",
                json.dumps(extra_params or {}, ensure_ascii=False),
                now,
                now,
            ),
        )
        model_pk = int(cursor.lastrowid)
    return get_model(model_pk) or {}


def update_model(model_row_id: int, values: dict[str, Any]) -> dict[str, Any] | None:
    current = get_model(model_row_id)
    if not current:
        return None
    allowed = {
        "provider_id",
        "name",
        "model_id",
        "model_kind",
        "enabled",
        "is_default",
        "sort_order",
        "capabilities",
        "supports_tools",
        "context_window",
        "max_output_tokens",
        "temperature",
        "top_p",
        "input_price_per_1m",
        "output_price_per_1m",
        "supports_reasoning",
        "reasoning_style",
        "reasoning_efforts",
        "default_reasoning_effort",
        "supports_reasoning_summary",
        "supports_transcription",
        "metadata_source",
        "extra_params",
    }
    updates = {key: value for key, value in values.items() if key in allowed}
    if "enabled" in updates:
        updates["enabled"] = int(bool(updates["enabled"]))
    if "supports_tools" in updates:
        updates["supports_tools"] = int(bool(updates["supports_tools"]))
    if "supports_reasoning" in updates:
        updates["supports_reasoning"] = int(bool(updates["supports_reasoning"]))
    if "supports_reasoning_summary" in updates:
        updates["supports_reasoning_summary"] = int(
            bool(updates["supports_reasoning_summary"])
        )
    if "supports_transcription" in updates:
        updates["supports_transcription"] = int(
            bool(updates["supports_transcription"])
        )
    if "reasoning_efforts" in updates:
        updates["reasoning_efforts"] = json.dumps(
            updates["reasoning_efforts"] or [], ensure_ascii=False
        )
    if "is_default" in updates:
        updates["is_default"] = int(bool(updates["is_default"]))
    if "capabilities" in updates:
        updates["capabilities"] = json.dumps(
            updates["capabilities"] or ["text"], ensure_ascii=False
        )
    if "extra_params" in updates:
        updates["extra_params"] = json.dumps(
            updates["extra_params"] or {}, ensure_ascii=False
        )
    for key in ("input_price_per_1m", "output_price_per_1m"):
        if key in updates:
            updates[key] = max(0.0, float(updates[key] or 0))
    if updates.get("is_default"):
        with connect() as conn:
            conn.execute("UPDATE models SET is_default = 0")
    updates["updated_at"] = utc_now()
    assignments = ", ".join(f"{key} = ?" for key in updates)
    with connect() as conn:
        conn.execute(
            f"UPDATE models SET {assignments} WHERE id = ?",
            [*updates.values(), model_row_id],
        )
    return get_model(model_row_id)


def delete_model(model_row_id: int) -> bool:
    with connect() as conn:
        row = conn.execute("SELECT * FROM models WHERE id = ?", (model_row_id,)).fetchone()
        if not row:
            return False
        conn.execute(
            "UPDATE assistants SET model_row_id = NULL WHERE model_row_id = ?",
            (model_row_id,),
        )
        conn.execute("DELETE FROM models WHERE id = ?", (model_row_id,))
        if row["is_default"]:
            fallback = conn.execute(
                """
                SELECT m.id FROM models m
                JOIN providers p ON p.id = m.provider_id
                WHERE m.enabled = 1 AND p.enabled = 1
                ORDER BY m.id ASC LIMIT 1
                """
            ).fetchone()
            if fallback:
                conn.execute(
                    "UPDATE models SET is_default = 1 WHERE id = ?", (fallback["id"],)
                )
    return True


def default_tool_setting(name: str = "", source: str = "mcp") -> dict[str, Any]:
    return {
        "name": name,
        "enabled": True,
        "visible": True,
        "selectable": True,
        "default_selected": True,
        "source": source,
        "definition": {},
    }


def _decorate_tool_setting(row: sqlite3.Row) -> dict[str, Any]:
    item = dict(row)
    for key in ("enabled", "visible", "selectable", "default_selected"):
        item[key] = bool(item.get(key, 1))
    item["definition"] = _json_object(item.get("definition"))
    return item


def get_tool_settings() -> dict[str, dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute("SELECT * FROM tool_settings ORDER BY name ASC").fetchall()
    return {row["name"]: _decorate_tool_setting(row) for row in rows}


def get_tool_setting(name: str, source: str = "mcp") -> dict[str, Any]:
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM tool_settings WHERE name = ?", (name,)
        ).fetchone()
    return _decorate_tool_setting(row) if row else default_tool_setting(name, source)


def set_tool_setting(
    name: str,
    *,
    enabled: bool | None = None,
    visible: bool | None = None,
    selectable: bool | None = None,
    default_selected: bool | None = None,
    source: str = "mcp",
    definition: dict[str, Any] | None = None,
) -> dict[str, Any]:
    current = get_tool_setting(name, source=source)
    values = {
        "enabled": current["enabled"] if enabled is None else bool(enabled),
        "visible": current["visible"] if visible is None else bool(visible),
        "selectable": current["selectable"] if selectable is None else bool(selectable),
        "default_selected": (
            current["default_selected"]
            if default_selected is None
            else bool(default_selected)
        ),
        "source": source or current.get("source") or "mcp",
        "definition": (
            current.get("definition") or {}
            if definition is None
            else definition
        ),
    }
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO tool_settings
                (name, enabled, visible, selectable, default_selected,
                 source, definition, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(name) DO UPDATE SET
                enabled = excluded.enabled,
                visible = excluded.visible,
                selectable = excluded.selectable,
                default_selected = excluded.default_selected,
                source = excluded.source,
                definition = excluded.definition,
                updated_at = excluded.updated_at
            """,
            (
                name,
                int(values["enabled"]),
                int(values["visible"]),
                int(values["selectable"]),
                int(values["default_selected"]),
                values["source"],
                json.dumps(values["definition"], ensure_ascii=False),
                utc_now(),
            ),
        )
    return get_tool_setting(name, source=source)


def _decorate_dynamic_tool(row: sqlite3.Row) -> dict[str, Any]:
    item = dict(row)
    item["enabled"] = bool(item.get("enabled"))
    item["headers"] = _json_object(item.get("headers"))
    item["input_schema"] = _json_object(item.get("input_schema")) or {
        "type": "object",
        "properties": {},
    }
    return item


def get_dynamic_tools(include_disabled: bool = True) -> list[dict[str, Any]]:
    sql = "SELECT * FROM dynamic_tools"
    if not include_disabled:
        sql += " WHERE enabled = 1"
    sql += " ORDER BY id ASC"
    with connect() as conn:
        rows = conn.execute(sql).fetchall()
    return [_decorate_dynamic_tool(row) for row in rows]


def get_dynamic_tool(tool_id: int) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM dynamic_tools WHERE id = ?", (tool_id,)
        ).fetchone()
    return _decorate_dynamic_tool(row) if row else None


def get_dynamic_tool_by_name(name: str) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM dynamic_tools WHERE name = ?", (name,)
        ).fetchone()
    return _decorate_dynamic_tool(row) if row else None


def create_dynamic_tool(
    *,
    name: str,
    display_name: str,
    description: str,
    category: str,
    permission: str,
    risk: str,
    method: str,
    url_template: str,
    headers: dict[str, str] | None = None,
    input_schema: dict[str, Any] | None = None,
    enabled: bool = True,
) -> dict[str, Any]:
    now = utc_now()
    with connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO dynamic_tools
                (name, display_name, description, category, permission, risk,
                 method, url_template, headers, input_schema, enabled,
                 created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                name,
                display_name,
                description,
                category,
                permission,
                risk,
                method,
                url_template,
                json.dumps(headers or {}, ensure_ascii=False),
                json.dumps(
                    input_schema
                    or {"type": "object", "properties": {}},
                    ensure_ascii=False,
                ),
                int(enabled),
                now,
                now,
            ),
        )
        tool_id = int(cursor.lastrowid)
    set_tool_setting(
        name,
        enabled=enabled,
        visible=True,
        selectable=True,
        default_selected=True,
        source="dynamic",
        definition={"dynamic_tool_id": tool_id},
    )
    return get_dynamic_tool(tool_id) or {}


def update_dynamic_tool(
    tool_id: int, values: dict[str, Any]
) -> dict[str, Any] | None:
    current = get_dynamic_tool(tool_id)
    if not current:
        return None
    allowed = {
        "name",
        "display_name",
        "description",
        "category",
        "permission",
        "risk",
        "method",
        "url_template",
        "headers",
        "input_schema",
        "enabled",
    }
    updates = {key: value for key, value in values.items() if key in allowed}
    if not updates:
        return current
    for key in ("headers", "input_schema"):
        if key in updates:
            updates[key] = json.dumps(updates[key] or {}, ensure_ascii=False)
    if "enabled" in updates:
        updates["enabled"] = int(bool(updates["enabled"]))
    updates["updated_at"] = utc_now()
    assignments = ", ".join(f"{key} = ?" for key in updates)
    with connect() as conn:
        conn.execute(
            f"UPDATE dynamic_tools SET {assignments} WHERE id = ?",
            [*updates.values(), tool_id],
        )
        if "name" in updates and updates["name"] != current["name"]:
            conn.execute(
                "UPDATE tool_settings SET name = ? WHERE name = ?",
                (updates["name"], current["name"]),
            )
        if "enabled" in values:
            conn.execute(
                """
                INSERT INTO tool_settings (name, enabled, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(name) DO UPDATE SET
                    enabled = excluded.enabled,
                    updated_at = excluded.updated_at
                """,
                (str(values.get("name") or current["name"]), int(bool(values["enabled"])), utc_now()),
            )
    if "name" in updates or "enabled" in values:
        set_tool_setting(
            str(values.get("name") or current["name"]),
            enabled=bool(values.get("enabled", current["enabled"])),
            source="dynamic",
            definition={"dynamic_tool_id": tool_id},
        )
    return get_dynamic_tool(tool_id)


def delete_dynamic_tool(tool_id: int) -> bool:
    current = get_dynamic_tool(tool_id)
    if not current:
        return False
    with connect() as conn:
        conn.execute("DELETE FROM dynamic_tools WHERE id = ?", (tool_id,))
        conn.execute("DELETE FROM tool_settings WHERE name = ?", (current["name"],))
    return True


def get_skills(include_disabled: bool = True) -> list[dict[str, Any]]:
    sql = "SELECT * FROM skills"
    if not include_disabled:
        sql += " WHERE enabled = 1"
    sql += " ORDER BY id ASC"
    with connect() as conn:
        rows = conn.execute(sql).fetchall()
    return [_decorate_skill(row) for row in rows]


def get_skill(skill_id: int) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM skills WHERE id = ?", (skill_id,)).fetchone()
    if not row:
        return None
    return _decorate_skill(row)


def skill_slug_exists(slug: str, *, exclude_id: int | None = None) -> bool:
    slug = str(slug or "").strip()
    if not slug:
        return False
    with connect() as conn:
        if exclude_id is None:
            row = conn.execute(
                "SELECT 1 FROM skills WHERE slug = ? LIMIT 1", (slug,)
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT 1 FROM skills WHERE slug = ? AND id != ? LIMIT 1",
                (slug, exclude_id),
            ).fetchone()
    return row is not None


def create_skill(
    name: str,
    description: str,
    content: str,
    enabled: bool = True,
    *,
    slug: str = "",
    kind: str = "prompt",
    license: str = "",
    metadata: dict[str, Any] | None = None,
    files: dict[str, str] | None = None,
) -> dict[str, Any]:
    now = utc_now()
    with connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO skills
                (name, slug, description, content, kind, license, metadata,
                 files, enabled, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                name.strip(),
                slug.strip(),
                description.strip(),
                content.strip(),
                kind or "prompt",
                license.strip(),
                json.dumps(metadata or {}, ensure_ascii=False),
                json.dumps(files or {}, ensure_ascii=False),
                int(enabled),
                now,
                now,
            ),
        )
        skill_id = int(cursor.lastrowid)
        if not slug.strip():
            conn.execute(
                "UPDATE skills SET slug = ? WHERE id = ?",
                (f"skill-{skill_id}", skill_id),
            )
    return get_skill(skill_id) or {}


def update_skill(skill_id: int, values: dict[str, Any]) -> dict[str, Any] | None:
    if not get_skill(skill_id):
        return None
    allowed = {
        "name",
        "slug",
        "description",
        "content",
        "kind",
        "license",
        "metadata",
        "files",
        "enabled",
    }
    updates = {key: value for key, value in values.items() if key in allowed}
    if "enabled" in updates:
        updates["enabled"] = int(bool(updates["enabled"]))
    if "metadata" in updates:
        updates["metadata"] = json.dumps(updates["metadata"] or {}, ensure_ascii=False)
    if "files" in updates:
        updates["files"] = json.dumps(updates["files"] or {}, ensure_ascii=False)
    if "slug" in updates and not str(updates["slug"]).strip():
        updates["slug"] = f"skill-{skill_id}"
    updates["updated_at"] = utc_now()
    assignments = ", ".join(f"{key} = ?" for key in updates)
    with connect() as conn:
        conn.execute(
            f"UPDATE skills SET {assignments} WHERE id = ?",
            [*updates.values(), skill_id],
        )
    return get_skill(skill_id)


def delete_skill(skill_id: int) -> bool:
    with connect() as conn:
        cursor = conn.execute("DELETE FROM skills WHERE id = ?", (skill_id,))
    return cursor.rowcount > 0


ASSISTANT_MODES = {"agent", "report"}


def get_assistants(include_disabled: bool = True) -> list[dict[str, Any]]:
    sql = """
        SELECT a.*, m.name AS model_name, m.model_id AS model_external_id,
               p.name AS provider_name
        FROM assistants a
        LEFT JOIN models m ON m.id = a.model_row_id
        LEFT JOIN providers p ON p.id = m.provider_id
    """
    if not include_disabled:
        sql += " WHERE a.enabled = 1"
    sql += " ORDER BY a.sort_order ASC, a.id ASC"
    with connect() as conn:
        rows = conn.execute(sql).fetchall()
    return [_decorate_assistant(row) for row in rows]


def get_assistant(assistant_id: int) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute(
            """
            SELECT a.*, m.name AS model_name, m.model_id AS model_external_id,
                   p.name AS provider_name
            FROM assistants a
            LEFT JOIN models m ON m.id = a.model_row_id
            LEFT JOIN providers p ON p.id = m.provider_id
            WHERE a.id = ?
            """,
            (assistant_id,),
        ).fetchone()
    return _decorate_assistant(row) if row else None


def assistants_for_user(user: dict[str, Any]) -> list[dict[str, Any]]:
    role = str(user.get("role", ""))
    username = str(user.get("username", ""))
    items = []
    for item in get_assistants(include_disabled=False):
        allowed = item["allowed_roles"]
        if "*" in allowed or role in allowed or username in allowed:
            items.append(item)
    return items


def _assistant_values(values: dict[str, Any]) -> dict[str, Any]:
    allowed = {
        "name",
        "icon",
        "description",
        "greeting",
        "system_prompt",
        "mode",
        "model_row_id",
        "allow_model_switch",
        "prefetch_tools",
        "tool_names",
        "skill_ids",
        "max_steps",
        "max_tool_calls",
        "max_run_seconds",
        "context_max_tokens",
        "memory_enabled",
        "allowed_roles",
        "enabled",
        "sort_order",
    }
    updates = {key: value for key, value in values.items() if key in allowed}
    for key in ("prefetch_tools", "tool_names", "skill_ids", "allowed_roles"):
        if key in updates:
            updates[key] = json.dumps(updates[key] or [], ensure_ascii=False)
    for key in (
        "allow_model_switch",
        "memory_enabled",
        "enabled",
    ):
        if key in updates:
            updates[key] = int(bool(updates[key]))
    return updates


def create_assistant(values: dict[str, Any]) -> dict[str, Any]:
    now = utc_now()
    data = {
        "name": "未命名助手",
        "icon": "✦",
        "description": "",
        "greeting": "",
        "system_prompt": "",
        "mode": "agent",
        "model_row_id": None,
        "allow_model_switch": 1,
        "prefetch_tools": [],
        "tool_names": [],
        "skill_ids": [],
        "max_steps": 0,
        "max_tool_calls": 0,
        "max_run_seconds": 0,
        "context_max_tokens": 0,
        "memory_enabled": 1,
        "allowed_roles": ["*"],
        "enabled": 1,
        "sort_order": 100,
    }
    data.update(_assistant_values(values))
    data["created_at"] = now
    data["updated_at"] = now
    keys = list(data.keys())
    placeholders = ", ".join("?" for _ in keys)
    with connect() as conn:
        cursor = conn.execute(
            f"INSERT INTO assistants ({', '.join(keys)}) VALUES ({placeholders})",
            [data[key] for key in keys],
        )
        assistant_id = int(cursor.lastrowid)
    return get_assistant(assistant_id) or {}


def update_assistant(
    assistant_id: int, values: dict[str, Any]
) -> dict[str, Any] | None:
    if not get_assistant(assistant_id):
        return None
    updates = _assistant_values(values)
    if not updates:
        return get_assistant(assistant_id)
    updates["updated_at"] = utc_now()
    assignments = ", ".join(f"{key} = ?" for key in updates)
    with connect() as conn:
        conn.execute(
            f"UPDATE assistants SET {assignments} WHERE id = ?",
            [*updates.values(), assistant_id],
        )
    return get_assistant(assistant_id)


def delete_assistant(assistant_id: int) -> bool:
    with connect() as conn:
        conn.execute(
            "UPDATE sessions SET assistant_id = NULL WHERE assistant_id = ?",
            (assistant_id,),
        )
        cursor = conn.execute(
            "DELETE FROM assistants WHERE id = ?", (assistant_id,)
        )
    return cursor.rowcount > 0


def log_audit(
    *,
    username: str,
    action: str,
    resource: str,
    detail: str | dict[str, Any] = "",
    source: str = "agent",
) -> None:
    if not isinstance(detail, str):
        detail = json.dumps(detail, ensure_ascii=False)
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO audit_log (ts, username, action, resource, detail, source)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (utc_now(), username, action, resource, detail, source),
        )


def list_audit(limit: int = 300) -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM audit_log ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(row) for row in rows]


def record_llm_call(
    *,
    session_id: str | None,
    username: str,
    model: str,
    provider: str,
    purpose: str,
    attempt: int,
    status: str,
    input_tokens: int = 0,
    output_tokens: int = 0,
    total_tokens: int = 0,
    cost_usd: float = 0,
    latency_ms: int = 0,
    error: str = "",
) -> None:
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO llm_calls
                (session_id, username, model, provider, purpose, attempt,
                 status, input_tokens, output_tokens, total_tokens, cost_usd,
                 latency_ms, error, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                session_id,
                username,
                model,
                provider,
                purpose,
                attempt,
                status,
                input_tokens,
                output_tokens,
                total_tokens,
                cost_usd,
                latency_ms,
                error[:2000],
                utc_now(),
            ),
        )


def list_llm_calls(
    session_id: str | None = None,
    *,
    limit: int = 300,
) -> list[dict[str, Any]]:
    sql = "SELECT * FROM llm_calls"
    params: list[Any] = []
    if session_id:
        sql += " WHERE session_id = ?"
        params.append(session_id)
    sql += " ORDER BY id DESC LIMIT ?"
    params.append(max(1, min(limit, 1000)))
    with connect() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [dict(row) for row in rows]


def record_compaction_event(
    *,
    session_id: str,
    trigger: str,
    before_tokens: int,
    after_tokens: int,
    summarized_messages: int,
    summary_model: str,
    duration_ms: int,
    ok: bool,
    error: str = "",
) -> None:
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO compaction_events
                (session_id, trigger, before_tokens, after_tokens,
                 summarized_messages, summary_model, duration_ms, ok, error,
                 created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                session_id,
                trigger,
                before_tokens,
                after_tokens,
                summarized_messages,
                summary_model,
                duration_ms,
                int(ok),
                error[:2000],
                utc_now(),
            ),
        )


def list_compaction_events(
    session_id: str, *, limit: int = 100
) -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM compaction_events
            WHERE session_id = ?
            ORDER BY id DESC LIMIT ?
            """,
            (session_id, max(1, min(limit, 500))),
        ).fetchall()
    items = []
    for row in rows:
        item = dict(row)
        item["ok"] = bool(item["ok"])
        items.append(item)
    return items


def user_daily_usage(username: str) -> int:
    today = utc_now()[:10]
    with connect() as conn:
        row = conn.execute(
            """
            SELECT COALESCE(SUM(total_tokens), 0) AS n
            FROM llm_calls
            WHERE username = ? AND created_at >= ?
            """,
            (username, today),
        ).fetchone()
    return int(row["n"] or 0)


def user_usage(username: str, days: int = 7) -> dict[str, Any]:
    days = max(1, min(days, 90))
    cutoff = (
        datetime.now(timezone.utc).replace(microsecond=0) - timedelta(days=days)
    ).isoformat(timespec="seconds")
    with connect() as conn:
        total = conn.execute(
            """
            SELECT COUNT(*) AS calls,
                   COALESCE(SUM(input_tokens), 0) AS input_tokens,
                   COALESCE(SUM(output_tokens), 0) AS output_tokens,
                   COALESCE(SUM(total_tokens), 0) AS total_tokens,
                   COALESCE(SUM(cost_usd), 0) AS cost_usd
            FROM llm_calls WHERE username = ? AND created_at >= ?
            """,
            (username, cutoff),
        ).fetchone()
        by_day = conn.execute(
            """
            SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS calls,
                   COALESCE(SUM(total_tokens), 0) AS total_tokens,
                   COALESCE(SUM(cost_usd), 0) AS cost_usd
            FROM llm_calls WHERE username = ? AND created_at >= ?
            GROUP BY day ORDER BY day ASC
            """,
            (username, cutoff),
        ).fetchall()
    return {
        "days": days,
        "totals": dict(total),
        "by_day": [dict(row) for row in by_day],
    }


def usage_summary(days: int = 7) -> dict[str, Any]:
    days = max(1, min(days, 90))
    cutoff = (
        datetime.now(timezone.utc).replace(microsecond=0) - timedelta(days=days)
    ).isoformat(timespec="seconds")
    with connect() as conn:
        totals = conn.execute(
            """
            SELECT COUNT(*) AS calls,
                   COALESCE(SUM(input_tokens), 0) AS input_tokens,
                   COALESCE(SUM(output_tokens), 0) AS output_tokens,
                   COALESCE(SUM(total_tokens), 0) AS total_tokens,
                   COALESCE(SUM(cost_usd), 0) AS cost_usd,
                   COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0)
                       AS errors,
                   COALESCE(SUM(CASE WHEN attempt > 1 THEN 1 ELSE 0 END), 0)
                       AS retries
            FROM llm_calls WHERE created_at >= ?
            """,
            (cutoff,),
        ).fetchone()
        by_user = conn.execute(
            """
            SELECT username, COUNT(*) AS calls,
                   COALESCE(SUM(total_tokens), 0) AS total_tokens,
                   COALESCE(SUM(cost_usd), 0) AS cost_usd
            FROM llm_calls WHERE created_at >= ?
            GROUP BY username ORDER BY total_tokens DESC LIMIT 10
            """,
            (cutoff,),
        ).fetchall()
        by_model = conn.execute(
            """
            SELECT model, COUNT(*) AS calls,
                   COALESCE(SUM(total_tokens), 0) AS total_tokens,
                   COALESCE(SUM(cost_usd), 0) AS cost_usd
            FROM llm_calls WHERE created_at >= ?
            GROUP BY model ORDER BY total_tokens DESC LIMIT 10
            """,
            (cutoff,),
        ).fetchall()
        by_day = conn.execute(
            """
            SELECT substr(created_at, 1, 10) AS day,
                   COUNT(*) AS calls,
                   COALESCE(SUM(total_tokens), 0) AS total_tokens,
                   COALESCE(SUM(cost_usd), 0) AS cost_usd
            FROM llm_calls WHERE created_at >= ?
            GROUP BY day ORDER BY day ASC
            """,
            (cutoff,),
        ).fetchall()
    return {
        "days": days,
        "totals": dict(totals),
        "by_user": [dict(row) for row in by_user],
        "by_model": [dict(row) for row in by_model],
        "by_day": [dict(row) for row in by_day],
    }


def purge_old_sessions(days: int) -> int:
    if days <= 0:
        return 0
    cutoff = (
        datetime.now(timezone.utc).replace(microsecond=0) - timedelta(days=days)
    ).isoformat(timespec="seconds")
    with connect() as conn:
        rows = conn.execute(
            "SELECT id FROM sessions WHERE updated_at < ?", (cutoff,)
        ).fetchall()
        for row in rows:
            conn.execute("DELETE FROM pending_approvals WHERE session_id = ?", (row["id"],))
            conn.execute("DELETE FROM sessions WHERE id = ?", (row["id"],))
            conn.execute(
                "DELETE FROM compaction_events WHERE session_id = ?", (row["id"],)
            )
            conn.execute("DELETE FROM llm_calls WHERE session_id = ?", (row["id"],))
    return len(rows)


def _approval_public(row: sqlite3.Row) -> dict[str, Any]:
    item = dict(row)
    for key, fallback in (
        ("requested_tools", None),
        ("messages", []),
        ("calls", []),
        ("tool_runs", []),
        ("usage", {}),
    ):
        raw = item.get(key)
        if raw is None:
            item[key] = fallback
            continue
        try:
            item[key] = json.loads(raw)
        except (TypeError, json.JSONDecodeError):
            item[key] = fallback
    return item


def cleanup_pending_approvals() -> None:
    now = time.time()
    with connect() as conn:
        conn.execute(
            """
            UPDATE pending_approvals
            SET status = 'expired', resolved_at = ?
            WHERE status = 'pending' AND expires_at < ?
            """,
            (now, now),
        )


def create_pending_approval(data: dict[str, Any]) -> None:
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO pending_approvals
                (id, user_id, username, session_id, assistant_id, model_row_id,
                 requested_tools, reasoning_effort, mode, messages, calls,
                 tool_runs, round_count, tool_call_total, usage, status,
                 created_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
            """,
            (
                data["id"],
                int(data["user_id"]),
                str(data.get("username") or ""),
                str(data.get("session_id") or ""),
                data.get("assistant_id"),
                data.get("model_row_id"),
                json.dumps(data.get("requested_tools"), ensure_ascii=False),
                str(data.get("reasoning_effort") or ""),
                str(data.get("mode") or "llm"),
                json.dumps(data.get("messages") or [], ensure_ascii=False),
                json.dumps(data.get("calls") or [], ensure_ascii=False),
                json.dumps(data.get("tool_runs") or [], ensure_ascii=False),
                int(data.get("round_count") or 0),
                int(data.get("tool_call_total") or 0),
                json.dumps(data.get("usage") or {}, ensure_ascii=False),
                float(data["created_at"]),
                float(data["expires_at"]),
            ),
        )


def claim_pending_approval(
    approval_id: str, user_id: int
) -> tuple[dict[str, Any] | None, str]:
    now = time.time()
    with connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT * FROM pending_approvals WHERE id = ?", (approval_id,)
        ).fetchone()
        if row is None:
            return None, "missing"
        if int(row["user_id"]) != int(user_id):
            return None, "forbidden"
        if row["status"] != "pending":
            return None, str(row["status"] or "processed")
        if float(row["expires_at"]) < now:
            conn.execute(
                """
                UPDATE pending_approvals
                SET status = 'expired', resolved_at = ?
                WHERE id = ?
                """,
                (now, approval_id),
            )
            return None, "expired"
        conn.execute(
            """
            UPDATE pending_approvals
            SET status = 'processing'
            WHERE id = ? AND status = 'pending'
            """,
            (approval_id,),
        )
        claimed = dict(row)
        claimed["status"] = "processing"
    return _approval_public_from_dict(claimed), ""


def _approval_public_from_dict(item: dict[str, Any]) -> dict[str, Any]:
    for key, fallback in (
        ("requested_tools", None),
        ("messages", []),
        ("calls", []),
        ("tool_runs", []),
        ("usage", {}),
    ):
        raw = item.get(key)
        if raw is None:
            item[key] = fallback
            continue
        try:
            item[key] = json.loads(raw)
        except (TypeError, json.JSONDecodeError):
            item[key] = fallback
    return item


def finish_pending_approval(approval_id: str, status: str) -> None:
    with connect() as conn:
        conn.execute(
            """
            UPDATE pending_approvals
            SET status = ?, resolved_at = ?
            WHERE id = ?
            """,
            (status, time.time(), approval_id),
        )
