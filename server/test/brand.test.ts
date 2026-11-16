import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";
import { brandUrl, readBrandLogo, removeBrandLogo, saveBrandLogo } from "../src/brand.js";
import { fixture } from "./helpers.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAY0lEQVR4nO3PQQ3AIADAQEADYpGIrIngcVnSU9DOfe74s6UDXjWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgfVZYAdSW/MMSAAAAAElFTkSuQmCC", "base64");
const dataUrl = `data:image/png;base64,${png.toString("base64")}`;

test("品牌徽标按内容哈希落盘，只保存相对路径", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "webagent-brand-"));
  try {
    const saved = saveBrandLogo(dir, dataUrl);
    assert.match(saved.path, /^brand\/[0-9a-f]{32}\.png$/);
    assert.equal(saved.size, png.length);
    assert.deepEqual(fs.readFileSync(path.join(dir, saved.path)), png);
    assert.equal(brandUrl(saved.path), `/api/agent/brand/${saved.path.split("/").pop()}`);
    assert.equal(brandUrl("brand/../../etc/passwd"), "");
    const file = saved.path.split("/").pop()!;
    assert.deepEqual(readBrandLogo(dir, file)?.bytes, png);
    assert.equal(readBrandLogo(dir, "..%2Fconfig.json"), undefined);
    // 重复上传同一张图不会产生第二份文件。
    saveBrandLogo(dir, dataUrl);
    assert.equal(fs.readdirSync(path.join(dir, "brand")).length, 1);
    removeBrandLogo(dir, saved.path);
    assert.equal(fs.existsSync(path.join(dir, saved.path)), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("品牌徽标拒绝非图片与超大文件", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "webagent-brand-"));
  try {
    assert.throws(() => saveBrandLogo(dir, "data:image/svg+xml;base64,PHN2Zz4="), /仅支持/);
    assert.throws(() => saveBrandLogo(dir, ""), /仅支持/);
    const huge = `data:image/png;base64,${"A".repeat(3_000_004)}`;
    assert.throws(() => saveBrandLogo(dir, huge), /过大/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("管理端上传 Logo 后，Chat 状态返回公开地址且两个前缀都能读取", async () => {
  const service = await fixture();
  try {
    const login = await service.app.inject({ method: "POST", url: "/api/control/auth/login", payload: { username: "admin", password: "admin123" } });
    assert.equal(login.statusCode, 200, login.body);
    const control = login.cookies.find((cookie) => cookie.name === "wa_control")!.value;

    const anonymous = await service.app.inject({ method: "POST", url: "/api/control/admin/brand-logo", payload: { data_url: dataUrl } });
    assert.equal(anonymous.statusCode, 401);

    const uploaded = await service.app.inject({ method: "POST", url: "/api/control/admin/brand-logo", cookies: { wa_control: control }, payload: { data_url: dataUrl } });
    assert.equal(uploaded.statusCode, 200, uploaded.body);
    const saved = uploaded.json() as { path: string; url: string };
    assert.match(saved.path, /^brand\/[0-9a-f]{32}\.png$/);
    const file = saved.path.split("/").pop()!;

    for (const prefix of ["/api/control/brand", "/api/agent/brand"]) {
      const response = await service.app.inject({ method: "GET", url: `${prefix}/${file}` });
      assert.equal(response.statusCode, 200, `${prefix} ${response.body}`);
      assert.equal(response.headers["content-type"], "image/png");
      assert.equal(response.headers["x-content-type-options"], "nosniff");
      assert.deepEqual(response.rawPayload, png);
    }
    assert.equal((await service.app.inject({ method: "GET", url: "/api/agent/brand/deadbeef.png" })).statusCode, 404);

    const assistant = (await service.app.inject({ method: "PUT", url: `/api/control/admin/assistants/${service.store.assistants()[0].id}`, cookies: { wa_control: control }, payload: { ...service.store.assistants()[0], welcome_logo: saved.path } })).json().assistant;
    assert.equal(assistant.welcome_logo, saved.path);
    const status = await service.app.inject({ method: "GET", url: "/api/agent/status", headers: { authorization: `Bearer ${service.credential()}` } });
    assert.equal(status.statusCode, 200, status.body);
    assert.equal(status.json().welcome_logo, `/api/agent/brand/${file}`);

    // 换掉 Logo 后旧文件会被回收。
    await service.app.inject({ method: "PUT", url: `/api/control/admin/assistants/${assistant.id}`, cookies: { wa_control: control }, payload: { ...assistant, welcome_logo: null } });
    assert.equal(fs.existsSync(path.join(service.dir, saved.path)), false);
  } finally {
    await service.close();
  }
});
