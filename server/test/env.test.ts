import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initializeEnv } from "../../scripts/init-env.mjs";

test("environment initialization only extends missing keys and never rotates saved secrets", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "webagent-env-test-"));
  const destination = path.join(directory, ".env");
  try {
    const original = "WEBAGENT_SECRET_KEY=existing-encryption-key\nexport WEBAGENT_ADMIN_PASSWORD=existing-business-password\nCUSTOM_SETTING=keep-me";
    fs.writeFileSync(destination, original);
    assert.throws(() => initializeEnv(destination), /已存在/);
    const added = initializeEnv(destination, true);
    const extended = fs.readFileSync(destination, "utf8");
    assert.ok(extended.startsWith(`${original}\n`));
    assert.ok(added.includes("WEBAGENT_CONTROL_PASSWORD"));
    assert.equal(added.includes("WEBAGENT_SECRET_KEY"), false);
    assert.equal(added.includes("WEBAGENT_ADMIN_PASSWORD"), false);
    assert.equal((extended.match(/WEBAGENT_SECRET_KEY=/g) || []).length, 1);
    assert.equal(fs.statSync(destination).mode & 0o777, 0o600);
    assert.deepEqual(initializeEnv(destination, true), []);
    assert.equal(fs.readFileSync(destination, "utf8"), extended);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
