#!/usr/bin/env python3
"""Smoke-test the running demo without mutating business data."""

from __future__ import annotations

import sys

import httpx2


BASE = "http://127.0.0.1:8000"


def login(username: str, password: str) -> httpx2.Client:
    client = httpx2.Client(base_url=BASE, timeout=60)
    response = client.post("/api/login", json={"username": username, "password": password})
    response.raise_for_status()
    return client


def check(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)
    print(f"  ok  {message}")


def main() -> int:
    print("1. user1 只读")
    user1 = login("user1", "user1pass")
    tools = user1.get("/api/agent/tools").json()["items"]
    names = {tool["name"] for tool in tools}
    check("list_devices" in names, "user1 能看到 list_devices")
    check("update_device" not in names, "user1 看不到 update_device")
    check("delete_device" not in names, "user1 看不到 delete_device")
    chat = user1.post(
        "/api/agent/chat",
        json={"messages": [{"role": "user", "content": "查看全部设备"}]},
    ).json()
    check(chat["status"] == "ok", "user1 查询设备成功")
    check(any(run["tool"] == "list_devices" for run in chat["tool_runs"]), "发生了真实 MCP 工具调用")
    denied = user1.post(
        "/api/agent/chat",
        json={"messages": [{"role": "user", "content": "删除 4 号设备"}]},
    ).json()
    check("缺少" in denied["answer"] and "device:delete" in denied["answer"], "user1 删除被拒绝")

    print("2. user2 修改需要审批")
    user2 = login("user2", "user2pass")
    pending = user2.post(
        "/api/agent/chat",
        json={"messages": [{"role": "user", "content": "把 2 号设备状态改为维护中"}]},
    ).json()
    check(pending["status"] == "approval_required", "user2 修改进入审批")
    check(pending["approval"]["risk"] == "write", "风险等级为 write")
    rejected = user2.post(f"/api/agent/approvals/{pending['approval']['id']}/reject").json()
    check(rejected["status"] == "ok", "user2 可以取消审批")

    print("3. user3 删除需要审批")
    user3 = login("user3", "user3pass")
    pending = user3.post(
        "/api/agent/chat",
        json={"messages": [{"role": "user", "content": "删除 4 号设备"}]},
    ).json()
    check(pending["status"] == "approval_required", "user3 删除进入审批")
    check(pending["approval"]["risk"] == "delete", "风险等级为 delete")
    rejected = user3.post(f"/api/agent/approvals/{pending['approval']['id']}/reject").json()
    check(rejected["status"] == "ok", "user3 可以取消审批")

    print("4. 管理员治理")
    admin = login("admin", "admin123")
    admin_tools = admin.get("/api/agent/admin/tools").json()
    check(admin_tools["total"] >= 8, "管理员能看到全部工具")
    check(admin.get("/api/agent/admin/models").json()["items"], "管理员能看到模型")
    check(admin.get("/api/users").json()["items"], "管理员能看到用户")
    check(admin.get("/api/audit").json()["items"], "业务审计有记录")
    check(admin.get("/api/agent/admin/audit").json()["items"], "Agent 审计有记录")

    print("\n全部冒烟测试通过。")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"\n测试失败：{exc}", file=sys.stderr)
        raise SystemExit(1)

