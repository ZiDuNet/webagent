import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";
import { attachmentDataUrl, copySessionAttachments, externalizePiImages, hasInlinePiImages, hydratePiImages, readSessionUpload, saveAttachments } from "../src/attachments.js";
import { fixture, mockServer } from "./helpers.js";
import type { Row } from "../src/types.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAY0lEQVR4nO3PQQ3AIADAQEADYpGIrIngcVnSU9DOfe74s6UDXjWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgfVZYAdSW/MMSAAAAAElFTkSuQmCC", "base64");
const dataUrl = `data:image/png;base64,${png.toString("base64")}`;

function temporaryStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "webagent-attachments-"));
  return { dir, store: new Store(dir) };
}

test("聊天图片落到 uploads/<sessionId>，会话 JSON 只保留相对路径", () => {
  const { dir, store } = temporaryStore();
  try {
    const saved = saveAttachments(dir, "session-a", [{ name: "截图.png", mime_type: "image/png", data_url: dataUrl }]);
    assert.equal(saved.length, 1);
    assert.match(saved[0].path, /^uploads\/session-a\/[0-9a-f]+\.png$/);
    assert.equal(saved[0].size, png.length);
    assert.equal(saved[0].data_url, undefined);
    assert.deepEqual(fs.readFileSync(path.join(dir, saved[0].path)), png);
    assert.equal(attachmentDataUrl(dir, "session-a", saved[0]), dataUrl);

    store.conversations.insert("session-a", { role: "user", content: "看看这张图", attachments: saved });
    const raw = fs.readFileSync(path.join(dir, "sessions", "session-a.json"), "utf8");
    assert.equal(raw.includes("base64"), false);
    assert.ok(raw.includes("uploads/session-a/"));
    assert.equal(attachmentDataUrl(dir, "session-b", saved[0]), undefined);

    assert.equal(store.removeSession("session-a"), true);
    assert.equal(fs.existsSync(path.join(dir, "uploads", "session-a")), false);
    assert.equal(fs.existsSync(path.join(dir, "sessions", "session-a.json")), false);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("启动时把旧会话的内联 Base64 图片迁移为本地文件", () => {
  const { dir, store } = temporaryStore();
  const at = new Date().toISOString();
  store.run("INSERT INTO sessions (id,owner_key,subject,namespace,username,created_at,updated_at) VALUES (?,?,?,?,?,?,?)", ["legacy-session", "user-1", "user-1", "", "user1", at, at]);
  store.conversations.insert("legacy-session", {
    role: "user",
    content: "旧消息",
    attachments: [{ name: "old.png", mime_type: "image/png", data_url: dataUrl }],
  });
  store.conversations.savePiEntries("legacy-session", [
    { type: "session", id: "header", version: 3 },
    { type: "message", id: "m1", message: { role: "user", content: [{ type: "text", text: "旧图片" }, { type: "image", mimeType: "image/png", data: png.toString("base64") }] } },
  ]);
  store.close();
  fs.rmSync(path.join(dir, "runtime", ".attachments-local-v2"), { force: true });

  const reopened = new Store(dir);
  try {
    const raw = fs.readFileSync(path.join(dir, "sessions", "legacy-session.json"), "utf8");
    assert.equal(raw.includes("base64"), false);
    const message = reopened.conversations.messages("legacy-session")[0];
    assert.equal(message.attachments.length, 1);
    assert.match(message.attachments[0].path, /^uploads\/legacy-session\/[0-9a-f]+\.png$/);
    assert.deepEqual(fs.readFileSync(path.join(dir, message.attachments[0].path)), png);
    assert.equal(attachmentDataUrl(dir, "legacy-session", message.attachments[0]), dataUrl);
    const entries = reopened.conversations.piEntries("legacy-session");
    assert.equal(hasInlinePiImages(entries), false);
    assert.match(entries[1].message.content[1].webagent_path, /^uploads\/legacy-session\/[0-9a-f]+\.png$/);
    assert.equal(entries[1].message.content[1].data, undefined);
    hydratePiImages(dir, "legacy-session", entries);
    assert.equal(entries[1].message.content[1].data, png.toString("base64"));
    assert.equal(entries[1].message.content[1].webagent_path, undefined);
  } finally {
    reopened.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("非法图片格式在落盘前拒绝", () => {
  const { dir, store } = temporaryStore();
  try {
    assert.throws(() => saveAttachments(dir, "session-c", [{ name: "x.png", mime_type: "image/png", data_url: "data:text/plain;base64,SGk=" }]), /图片格式/);
    assert.throws(() => saveAttachments(dir, "session-c", Array.from({ length: 5 }, () => ({ name: "x.png", mime_type: "image/png", data_url: dataUrl }))), /最多 4 张/);
    assert.equal(fs.existsSync(path.join(dir, "uploads", "session-c")), false);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("PI canonical entries 中的图片按内容哈希落盘且可重复保存", () => {
  const { dir, store } = temporaryStore();
  try {
    const entries = [{ type: "message", id: "m1", message: { role: "user", content: [{ type: "image", mimeType: "image/png", data: png.toString("base64") }] } }];
    externalizePiImages(dir, "session-d", entries);
    const first = entries[0].message.content[0].webagent_path as string;
    externalizePiImages(dir, "session-d", [{ type: "message", id: "m1", message: { role: "user", content: [{ type: "image", mimeType: "image/png", data: png.toString("base64") }] } }]);
    assert.equal(fs.readdirSync(path.join(dir, "uploads", "session-d")).length, 1);
    assert.deepEqual(fs.readFileSync(path.join(dir, first)), png);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("分叉复制图片时拒绝其他会话路径、目录穿越和符号链接", () => {
  const { dir, store } = temporaryStore();
  try {
    const [own] = saveAttachments(dir, "source", [{ name: "own.png", mime_type: "image/png", data_url: dataUrl }]);
    const [foreign] = saveAttachments(dir, "foreign", [{ name: "foreign.png", mime_type: "image/png", data_url: dataUrl }]);
    assert.throws(() => copySessionAttachments(dir, "source", "fork", [foreign]), /图片附件不可用/);
    assert.throws(() => copySessionAttachments(dir, "source", "fork", [{ ...own, path: "uploads/source/../../runtime/agent.db" }]), /图片附件不可用/);
    fs.symlinkSync(path.join(dir, foreign.path), path.join(dir, "uploads", "source", "linked.png"));
    assert.throws(() => copySessionAttachments(dir, "source", "fork", [{ ...own, path: "uploads/source/linked.png" }]), /图片附件不可用/);
    fs.symlinkSync(path.join(dir, "uploads", "foreign"), path.join(dir, "uploads", "aliased"), "dir");
    assert.throws(() => copySessionAttachments(dir, "aliased", "fork", [{ ...own, path: `uploads/aliased/${path.basename(foreign.path)}` }]), /图片附件不可用/);
    assert.equal(fs.existsSync(path.join(dir, "uploads", "fork")), false);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("分叉拥有独立图片，删除原会话后历史预览与PI图片上下文仍然可用", async () => {
  const upstream = await mockServer();
  const service = await fixture(upstream.baseUrl);
  const headers = { authorization: `Bearer ${service.credential()}` };
  try {
    const original = await service.session();
    const sent = await service.app.inject({
      method: "POST",
      url: "/api/agent/chat",
      headers,
      payload: { session_id: original.id, message: "带图片的原会话", attachments: [{ name: "现场.png", mime_type: "image/png", data_url: dataUrl }] },
    });
    assert.equal(sent.statusCode, 200, sent.body);
    const originalMessage = service.store.conversations.messages(original.id).find((item) => item.role === "user")!;
    const forked = await service.app.inject({
      method: "POST",
      url: `/api/agent/sessions/${original.id}/fork`,
      headers,
      payload: { until_message_id: originalMessage.id },
    });
    assert.equal(forked.statusCode, 201, forked.body);
    const forkId = forked.json().session.id;
    const forkMessage = service.store.conversations.messages(forkId)[0];
    assert.equal(forkMessage.content, originalMessage.content);
    assert.equal(forkMessage.attachments[0].name, "现场.png");
    assert.equal(forkMessage.attachments[0].mime_type, "image/png");
    assert.equal(forkMessage.attachments[0].size, png.length);
    assert.notEqual(forkMessage.attachments[0].path, originalMessage.attachments[0].path);
    assert.ok(forkMessage.attachments[0].path.startsWith(`uploads/${forkId}/`));
    assert.equal(forkMessage.attachments[0].data_url, undefined);

    const removed = await service.app.inject({ method: "DELETE", url: `/api/agent/sessions/${original.id}`, headers });
    assert.equal(removed.statusCode, 200, removed.body);
    assert.equal(fs.existsSync(path.join(service.dir, "uploads", original.id)), false);
    const preview = await service.app.inject({
      method: "GET",
      url: `/api/agent/sessions/${forkId}/attachments/${path.basename(forkMessage.attachments[0].path)}`,
      headers,
    });
    assert.equal(preview.statusCode, 200, preview.body);
    assert.deepEqual(preview.rawPayload, png);

    const before = upstream.requests.length;
    const continued = await service.app.inject({ method: "POST", url: "/api/agent/chat", headers, payload: { session_id: forkId, message: "继续分析这张图" } });
    assert.equal(continued.statusCode, 200, continued.body);
    assert.equal(continued.json().status, "ok");
    assert.ok(upstream.requests.slice(before).some((request) => JSON.stringify(request.messages).includes(png.toString("base64"))));
    const entries = service.store.conversations.piEntries(forkId);
    const images = entries.flatMap((entry) => Array.isArray(entry.message?.content) ? entry.message.content.filter((part: Row) => part.type === "image") : []);
    assert.ok(images.length > 0);
    assert.ok(images.every((image) => String(image.webagent_path).startsWith(`uploads/${forkId}/`) && image.data === undefined));
    hydratePiImages(service.dir, forkId, entries);
    assert.ok(entries.some((entry) => Array.isArray(entry.message?.content) && entry.message.content.some((part: Row) => part.type === "image" && part.data === png.toString("base64"))));
    const raw = fs.readFileSync(path.join(service.dir, "sessions", `${forkId}.json`), "utf8");
    assert.equal(raw.includes(`uploads/${original.id}/`), false);
    assert.equal(raw.includes(png.toString("base64")), false);
  } finally {
    await service.close();
    await upstream.close();
  }
});

test("图片预览与PI上下文均拒绝跨会话符号链接及伪装的会话目录", () => {
  const { dir, store } = temporaryStore();
  try {
    saveAttachments(dir, "source", [{ name: "own.png", mime_type: "image/png", data_url: dataUrl }]);
    const [foreign] = saveAttachments(dir, "foreign", [{ name: "foreign.png", mime_type: "image/png", data_url: dataUrl }]);
    fs.symlinkSync(path.join(dir, foreign.path), path.join(dir, "uploads/source/linked.png"));
    fs.symlinkSync(path.join(dir, "uploads/foreign"), path.join(dir, "uploads/aliased"), "dir");
    assert.equal(readSessionUpload(dir, "source", "linked.png"), undefined);
    assert.equal(readSessionUpload(dir, "aliased", path.basename(foreign.path)), undefined);
    assert.equal(attachmentDataUrl(dir, "source", { path: "uploads/source/linked.png", mime_type: "image/png" }), undefined);
    const entries = [{ message: { content: [{ type: "image", mimeType: "image/png", webagent_path: "uploads/source/linked.png" }] } }];
    hydratePiImages(dir, "source", entries);
    assert.deepEqual(entries[0].message.content, []);
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("真实聊天请求把图片写入 uploads，PI 上下文与会话 JSON 都不再内联 Base64", async () => {
  const upstream = await mockServer();
  const service = await fixture(upstream.baseUrl);
  try {
    const session = await service.session();
    const response = await service.app.inject({
      method: "POST",
      url: "/api/agent/chat",
      headers: { authorization: `Bearer ${service.credential()}` },
      payload: { session_id: session.id, message: "图里是什么", attachments: [{ name: "现场.png", mime_type: "image/png", data_url: dataUrl }] },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().status, "ok");
    const raw = fs.readFileSync(path.join(service.dir, "sessions", `${session.id}.json`), "utf8");
    assert.equal(raw.includes(png.toString("base64")), false);
    const userMessage = service.store.conversations.messages(session.id).find((message) => message.role === "user")!;
    assert.match(userMessage.attachments[0].path, /^uploads\/[^/]+\/[0-9a-f]+\.png$/);
    const entries = service.store.conversations.piEntries(session.id);
    assert.equal(hasInlinePiImages(entries), false);
    assert.ok(entries.some((entry) => Array.isArray(entry.message?.content) && entry.message.content.some((part: Row) => part.type === "image" && part.webagent_path)));

    const second = await service.app.inject({
      method: "POST",
      url: "/api/agent/chat",
      headers: { authorization: `Bearer ${service.credential()}` },
      payload: { session_id: session.id, message: "继续" },
    });
    assert.equal(second.statusCode, 200, second.body);
    const imageBodies = upstream.requests.map((request) => JSON.stringify(request.messages || request)).filter((body) => body.includes(png.toString("base64")));
    assert.ok(imageBodies.some((body) => body.includes('"type":"image_url"')));
    assert.equal(fs.readFileSync(path.join(service.dir, "sessions", `${session.id}.json`), "utf8").includes(png.toString("base64")), false);
  } finally {
    await service.close();
    await upstream.close();
  }
});

test("附件预览接口只对会话所有者开放，缺失文件返回 404", async () => {
  const upstream = await mockServer();
  const service = await fixture(upstream.baseUrl);
  try {
    const session = await service.session();
    const sent = await service.app.inject({
      method: "POST",
      url: "/api/agent/chat",
      headers: { authorization: `Bearer ${service.credential()}` },
      payload: { session_id: session.id, message: "带图提问", attachments: [{ name: "现场.png", mime_type: "image/png", data_url: dataUrl }] },
    });
    assert.equal(sent.statusCode, 200, sent.body);
    const message = service.store.conversations.messages(session.id).find((item) => item.role === "user")!;
    const file = String(message.attachments[0].path).split("/").pop();

    const preview = await service.app.inject({
      method: "GET",
      url: `/api/agent/sessions/${session.id}/attachments/${file}`,
      headers: { authorization: `Bearer ${service.credential()}` },
    });
    assert.equal(preview.statusCode, 200, preview.body);
    assert.equal(preview.headers["content-type"], "image/png");
    assert.match(String(preview.headers["cache-control"]), /private/);
    assert.match(String(preview.headers["cache-control"]), /no-store/);
    assert.equal(preview.headers["x-content-type-options"], "nosniff");
    assert.deepEqual(preview.rawPayload, png);

    const stranger = await service.app.inject({
      method: "GET",
      url: `/api/agent/sessions/${session.id}/attachments/${file}`,
      headers: { authorization: `Bearer ${service.credential("user2")}` },
    });
    assert.equal(stranger.statusCode, 404);

    const missing = await service.app.inject({
      method: "GET",
      url: `/api/agent/sessions/${session.id}/attachments/${"0".repeat(32)}.png`,
      headers: { authorization: `Bearer ${service.credential()}` },
    });
    assert.equal(missing.statusCode, 404);

    const traversal = await service.app.inject({
      method: "GET",
      url: `/api/agent/sessions/${session.id}/attachments/${encodeURIComponent("../../server.json")}`,
      headers: { authorization: `Bearer ${service.credential()}` },
    });
    assert.equal(traversal.statusCode, 404);
  } finally {
    await service.close();
    await upstream.close();
  }
});
