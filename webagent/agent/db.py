"""SQLite storage for providers, models, tool switches, skills and settings."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from typing import Any

from webagent.config import AGENT_DB_PATH, ensure_data_dir


PROVIDER_TYPES = {"openai_compatible"}
DEFAULT_SETTINGS: dict[str, str] = {
    "llm_base_url": "https://api.openai.com/v1",
    "llm_api_key": "",
    "llm_temperature": "0.3",
    "max_iterations": "6",
    "max_tool_calls": "12",
    "max_run_seconds": "120",
    "context_max_tokens": "32000",
    "context_compression": "1",
    "memory_enabled": "1",
    "system_prompt_extra": "",
    "demo_mode": "1",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect() -> sqlite3.Connection:
    ensure_data_dir()
    conn = sqlite3.connect(AGENT_DB_PATH)
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
                capabilities TEXT NOT NULL DEFAULT '["text"]',
                supports_tools INTEGER NOT NULL DEFAULT 1,
                context_window INTEGER NOT NULL DEFAULT 0,
                max_output_tokens INTEGER NOT NULL DEFAULT 0,
                temperature REAL NOT NULL DEFAULT 0.3,
                top_p REAL NOT NULL DEFAULT 1.0,
                extra_params TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tool_settings (
                name TEXT PRIMARY KEY,
                enabled INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS skills (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL DEFAULT '',
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

            CREATE INDEX IF NOT EXISTS idx_sessions_user_updated
                ON sessions(user_id, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_messages_session_id
                ON messages(session_id, id ASC);
            CREATE INDEX IF NOT EXISTS idx_memories_user_id
                ON memories(user_id, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_assistants_order
                ON assistants(enabled, sort_order ASC, id ASC);
            """
        )
        _ensure_model_columns(conn)
        _ensure_session_columns(conn)
        for key, value in DEFAULT_SETTINGS.items():
            conn.execute(
                "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
                (key, value),
            )

        _seed_providers(conn)
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
        "capabilities": "TEXT NOT NULL DEFAULT '[\"text\"]'",
        "supports_tools": "INTEGER NOT NULL DEFAULT 1",
        "context_window": "INTEGER NOT NULL DEFAULT 0",
        "max_output_tokens": "INTEGER NOT NULL DEFAULT 0",
        "temperature": "REAL NOT NULL DEFAULT 0.3",
        "top_p": "REAL NOT NULL DEFAULT 1.0",
        "extra_params": "TEXT NOT NULL DEFAULT '{}'",
    }
    for name, definition in additions.items():
        if name not in columns:
            conn.execute(f"ALTER TABLE models ADD COLUMN {name} {definition}")


def _ensure_session_columns(conn: sqlite3.Connection) -> None:
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(sessions)")}
    if "assistant_id" not in columns:
        conn.execute("ALTER TABLE sessions ADD COLUMN assistant_id INTEGER")


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
            (name, provider_type, base_url, api_key, timeout_seconds, now, now),
        )


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
            "extra_params": {},
        },
    ]
    for model in models:
        conn.execute(
            """
            INSERT INTO models
                (provider_id, name, model_id, enabled, is_default, sort_order,
                 capabilities, supports_tools, context_window, max_output_tokens,
                 temperature, top_p, extra_params, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            "设备巡检规范",
            "统一设备状态判断与信息组织方式。",
            """巡检判断规则：
- 在线：运行正常，保持常规监控。
- 维护中：先确认是否处于计划维护窗口。
- 离线：优先排查供电、网络链路和最近变更。

输出设备列表时按“名称 / 编号 / 位置 / 状态”组织，先给结论再给明细。""",
        ),
        (
            "回答与安全规范",
            "约束 Agent 的数据来源、权限说明和危险操作行为。",
            """只通过已启用工具读取业务数据，不编造设备、编号、状态或权限。
涉及新增、修改、删除时，必须等待用户在审批卡中明确确认。
如果工具返回 403 或权限错误，直接说明当前账号缺少的权限，不要尝试绕过。
回答使用简洁中文，涉及数字时优先引用工具返回的真实结果。""",
        ),
    ]
    for name, description, content in skills:
        conn.execute(
            """
            INSERT INTO skills (name, description, content, enabled, created_at, updated_at)
            VALUES (?, ?, ?, 1, ?, ?)
            """,
            (name, description, content, now, now),
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
    item["capabilities"] = _json_list(item.get("capabilities"))
    item["extra_params"] = _json_object(item.get("extra_params"))
    item["provider_enabled"] = bool(item.get("provider_enabled", 0))
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
                api_key.strip(),
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
    enabled: bool = True,
    is_default: bool = False,
    capabilities: list[str] | None = None,
    supports_tools: bool = True,
    context_window: int = 0,
    max_output_tokens: int = 0,
    temperature: float = 0.3,
    top_p: float = 1.0,
    extra_params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    now = utc_now()
    with connect() as conn:
        if is_default:
            conn.execute("UPDATE models SET is_default = 0")
        cursor = conn.execute(
            """
            INSERT INTO models
                (provider_id, name, model_id, enabled, is_default, sort_order,
                 capabilities, supports_tools, context_window, max_output_tokens,
                 temperature, top_p, extra_params, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 100, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                provider_id,
                name.strip(),
                model_id.strip(),
                int(enabled),
                int(is_default),
                json.dumps(capabilities or ["text"], ensure_ascii=False),
                int(supports_tools),
                max(0, context_window),
                max(0, max_output_tokens),
                temperature,
                top_p,
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
        "enabled",
        "is_default",
        "sort_order",
        "capabilities",
        "supports_tools",
        "context_window",
        "max_output_tokens",
        "temperature",
        "top_p",
        "extra_params",
    }
    updates = {key: value for key, value in values.items() if key in allowed}
    if "enabled" in updates:
        updates["enabled"] = int(bool(updates["enabled"]))
    if "supports_tools" in updates:
        updates["supports_tools"] = int(bool(updates["supports_tools"]))
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


def get_tool_settings() -> dict[str, bool]:
    with connect() as conn:
        rows = conn.execute("SELECT name, enabled FROM tool_settings").fetchall()
    return {row["name"]: bool(row["enabled"]) for row in rows}


def set_tool_setting(name: str, enabled: bool) -> None:
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO tool_settings (name, enabled, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(name) DO UPDATE
            SET enabled = excluded.enabled, updated_at = excluded.updated_at
            """,
            (name, int(enabled), utc_now()),
        )


def get_skills(include_disabled: bool = True) -> list[dict[str, Any]]:
    sql = "SELECT * FROM skills"
    if not include_disabled:
        sql += " WHERE enabled = 1"
    sql += " ORDER BY id ASC"
    with connect() as conn:
        rows = conn.execute(sql).fetchall()
    items = []
    for row in rows:
        item = dict(row)
        item["enabled"] = bool(item["enabled"])
        items.append(item)
    return items


def get_skill(skill_id: int) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM skills WHERE id = ?", (skill_id,)).fetchone()
    if not row:
        return None
    item = dict(row)
    item["enabled"] = bool(item["enabled"])
    return item


def create_skill(
    name: str, description: str, content: str, enabled: bool = True
) -> dict[str, Any]:
    now = utc_now()
    with connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO skills (name, description, content, enabled, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (name.strip(), description.strip(), content.strip(), int(enabled), now, now),
        )
        skill_id = int(cursor.lastrowid)
    return get_skill(skill_id) or {}


def update_skill(skill_id: int, values: dict[str, Any]) -> dict[str, Any] | None:
    if not get_skill(skill_id):
        return None
    allowed = {"name", "description", "content", "enabled"}
    updates = {key: value for key, value in values.items() if key in allowed}
    if "enabled" in updates:
        updates["enabled"] = int(bool(updates["enabled"]))
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
