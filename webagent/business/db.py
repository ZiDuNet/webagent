"""SQLite storage for the mock business system."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from webagent.common.security import hash_password
from webagent.config import BUSINESS_DB_PATH, ensure_data_dir


PERMISSIONS = {
    "admin": [
        "profile:read",
        "device:read",
        "device:create",
        "device:update",
        "device:delete",
        "user:manage",
    ],
    "user1": ["profile:read", "device:read"],
    "user2": ["profile:read", "device:read", "device:update"],
    "user3": ["profile:read", "device:read", "device:update", "device:delete"],
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect() -> sqlite3.Connection:
    ensure_data_dir()
    conn = sqlite3.connect(BUSINESS_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_db() -> None:
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                display_name TEXT NOT NULL,
                role TEXT NOT NULL,
                permissions TEXT NOT NULL,
                is_admin INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS devices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                device_type TEXT NOT NULL,
                serial_no TEXT NOT NULL UNIQUE,
                location TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT '在线',
                owner TEXT NOT NULL DEFAULT '',
                remark TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL,
                user_id INTEGER,
                username TEXT NOT NULL,
                source TEXT NOT NULL,
                action TEXT NOT NULL,
                resource TEXT NOT NULL,
                detail TEXT NOT NULL DEFAULT ''
            );
            """
        )

        count = conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]
        if count == 0:
            _seed_users(conn)
        device_count = conn.execute("SELECT COUNT(*) AS n FROM devices").fetchone()["n"]
        if device_count == 0:
            _seed_devices(conn)


def _seed_users(conn: sqlite3.Connection) -> None:
    now = utc_now()
    users = [
        ("admin", "admin123", "系统管理员", "admin", PERMISSIONS["admin"], 1),
        ("user1", "user1pass", "只读用户", "viewer", PERMISSIONS["user1"], 0),
        ("user2", "user2pass", "运维用户", "operator", PERMISSIONS["user2"], 0),
        ("user3", "user3pass", "设备管理员", "device_admin", PERMISSIONS["user3"], 0),
    ]
    for username, password, display_name, role, permissions, is_admin in users:
        conn.execute(
            """
            INSERT INTO users
                (username, password_hash, display_name, role, permissions, is_admin, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                username,
                hash_password(password),
                display_name,
                role,
                json.dumps(permissions, ensure_ascii=False),
                is_admin,
                now,
            ),
        )


def _seed_devices(conn: sqlite3.Connection) -> None:
    now = utc_now()
    devices = [
        ("核心交换机", "交换机", "SN-SW-001", "机房A-01", "在线", "网络组", "园区核心网络"),
        ("边缘路由器", "路由器", "SN-RT-002", "机房A-02", "在线", "网络组", "出口链路"),
        ("数据库服务器", "服务器", "SN-DB-003", "机房B-01", "维护中", "数据组", "计划内升级"),
        ("监控摄像头", "摄像头", "SN-CAM-004", "一楼大厅", "离线", "安保组", "待更换电源"),
        ("温湿度传感器", "传感器", "SN-SEN-005", "机房B-02", "在线", "运维组", "环境监测"),
    ]
    for device in devices:
        conn.execute(
            """
            INSERT INTO devices
                (name, device_type, serial_no, location, status, owner, remark, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (*device, now, now),
        )


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {key: row[key] for key in row.keys()}


def user_to_public(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    data = dict(row)
    permissions = data.get("permissions", [])
    if isinstance(permissions, str):
        try:
            permissions = json.loads(permissions)
        except json.JSONDecodeError:
            permissions = []
    return {
        "id": data["id"],
        "username": data["username"],
        "display_name": data["display_name"],
        "role": data["role"],
        "permissions": permissions,
        "is_admin": bool(data["is_admin"]),
        "created_at": data.get("created_at"),
    }


def log_audit(
    *,
    user_id: int | None,
    username: str,
    source: str,
    action: str,
    resource: str,
    detail: str | dict[str, Any] = "",
) -> None:
    if not isinstance(detail, str):
        detail = json.dumps(detail, ensure_ascii=False)
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO audit_log
                (ts, user_id, username, source, action, resource, detail)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (utc_now(), user_id, username, source, action, resource, detail),
        )


def db_path() -> Path:
    return BUSINESS_DB_PATH
