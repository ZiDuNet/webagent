import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.js";
import { config } from "../src/config.js";
import type { Row } from "../src/types.js";

async function administrator(service: Awaited<ReturnType<typeof fixture>>) {
  const response = await service.app.inject({ method: "POST", url: "/api/control/auth/login", payload: { username: "admin", password: config.adminPassword } });
  assert.equal(response.statusCode, 200);
  return { cookie: response.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ") };
}

test("business users aggregate sessions, messages and memories, and support query paging", async () => {
  const service = await fixture();
  try {
    const headers = await administrator(service);
    const user1 = await service.auth.identity(service.credential("user1"));
    const user2 = await service.auth.identity(service.credential("user2"));
    const first = await service.session("user1");
    const second = await service.session("user1");
    const third = await service.session("user2");
    service.store.conversations.insert(first.id, { role: "user", content: "第一条消息" });
    service.store.conversations.insert(first.id, { role: "assistant", content: "第二条消息" });
    service.store.conversations.insert(second.id, { role: "user", content: "第三条消息" });
    service.store.conversations.insert(third.id, { role: "user", content: "user2 的消息" });
    service.store.insert("memories", { ...service.store.ownerColumns(user1), content: "用户一偏好中文", kind: "fact", enabled: true });
    service.store.insert("memories", { ...service.store.ownerColumns(user1), content: "用户一偏好表格", kind: "extracted", enabled: false });

    const listing = await service.app.inject({ url: "/api/control/admin/business-users", headers });
    assert.equal(listing.statusCode, 200, listing.body);
    const body = listing.json();
    assert.equal(body.total, 2);
    assert.equal(body.items.length, 2);
    const owner1 = body.items.find((item: Row) => item.owner_key === user1.owner_key)!;
    const owner2 = body.items.find((item: Row) => item.owner_key === user2.owner_key)!;
    assert.ok(owner1 && owner2);
    assert.equal(owner1.display_name, "user1");
    assert.equal(owner1.sessions, 2);
    assert.equal(owner1.messages, 3);
    assert.equal(owner1.memories, 2);
    assert.equal(owner2.sessions, 1);
    assert.equal(owner2.messages, 1);
    assert.equal(owner2.memories, 0);
    assert.ok(owner1.last_active_at);

    const filtered = await service.app.inject({ url: "/api/control/admin/business-users?query=user2", headers });
    assert.equal(filtered.statusCode, 200);
    assert.equal(filtered.json().total, 1);
    assert.equal(filtered.json().items[0].owner_key, user2.owner_key);

    const paged = await service.app.inject({ url: "/api/control/admin/business-users?limit=1&offset=0", headers });
    assert.equal(paged.statusCode, 200);
    assert.equal(paged.json().items.length, 1);
    assert.equal(paged.json().total, 2);
    assert.equal((await service.app.inject({ url: "/api/control/admin/business-users?query=nobody", headers })).json().items.length, 0);
  } finally { await service.close(); }
});

test("admin can list, edit, disable and delete business user memories with 404 isolation", async () => {
  const service = await fixture();
  try {
    const headers = await administrator(service);
    const user1 = await service.auth.identity(service.credential("user1"));
    await service.session("user1");
    const memory = service.store.insert("memories", { ...service.store.ownerColumns(user1), content: "原始记忆内容", kind: "fact", enabled: true });

    const listed = await service.app.inject({ url: `/api/control/admin/business-users/${encodeURIComponent(user1.owner_key)}/memories`, headers });
    assert.equal(listed.statusCode, 200, listed.body);
    assert.equal(listed.json().items.length, 1);
    assert.deepEqual(Object.keys(listed.json().items[0]).sort(), ["content", "created_at", "enabled", "id", "kind", "source", "updated_at"]);
    assert.equal(listed.json().items[0].source, "user");

    const updated = await service.app.inject({ method: "PATCH", url: `/api/control/admin/memories/${memory.id}`, headers, payload: { content: "更新后的记忆内容", enabled: false } });
    assert.equal(updated.statusCode, 200, updated.body);
    assert.equal(updated.json().memory.content, "更新后的记忆内容");
    assert.equal(updated.json().memory.enabled, false);
    const stored = service.store.one("SELECT * FROM memories WHERE id=?", [memory.id])!;
    assert.equal(stored.content, "更新后的记忆内容");
    assert.equal(stored.enabled, false);

    const tooLong = await service.app.inject({ method: "PATCH", url: `/api/control/admin/memories/${memory.id}`, headers, payload: { content: "x".repeat(2001) } });
    assert.equal(tooLong.statusCode, 422);
    assert.equal((await service.app.inject({ method: "PATCH", url: "/api/control/admin/memories/999999", headers, payload: { content: "不存在" } })).statusCode, 404);
    assert.equal((await service.app.inject({ url: "/api/control/admin/business-users/owner-missing/memories", headers })).statusCode, 404);

    const removed = await service.app.inject({ method: "DELETE", url: `/api/control/admin/memories/${memory.id}`, headers });
    assert.equal(removed.statusCode, 200, removed.body);
    assert.equal(service.store.one("SELECT id FROM memories WHERE id=?", [memory.id]), undefined);
    assert.equal((await service.app.inject({ method: "DELETE", url: `/api/control/admin/memories/${memory.id}`, headers })).statusCode, 404);
  } finally { await service.close(); }
});
