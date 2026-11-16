import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { htmlImageDocument } from "../src/lib/htmlImage.ts";

test("client HTML export preserves report content and puts a no-script, no-network policy before styles", () => {
  const host = new JSDOM("");
  try {
    const result = htmlImageDocument('<!doctype html><html><head><style>body{color:#123456}</style></head><body><h1>巡检报告</h1><svg viewBox="0 0 10 10"><rect width="10" height="10" /></svg></body></html>', host.window);
    const output = new JSDOM(result);
    const document = output.window.document;
    const policy = document.head.firstElementChild;
    assert.equal(policy.getAttribute("http-equiv"), "Content-Security-Policy");
    assert.match(policy.content, /script-src 'none'/); assert.match(policy.content, /connect-src 'none'/);
    assert.match(document.querySelector("style").textContent, /#123456/);
    assert.equal(document.querySelector("h1").textContent, "巡检报告");
    assert.ok(document.querySelector("svg rect"));
    output.window.close();
  } finally { host.window.close(); }
});

test("client image export strips executable, navigation and external resource HTML without evaluating it", () => {
  const host = new JSDOM("");
  try {
    const result = htmlImageDocument(`<html><head><meta http-equiv="refresh" content="0;url=https://example.invalid"><base href="https://example.invalid"><link rel="stylesheet" href="https://example.invalid/style"></head><body onload="alert(1)"><script>window.exportedSecret=true</script><iframe src="https://example.invalid"></iframe><object data="https://example.invalid"></object><img src="https://example.invalid/private" srcset="https://example.invalid/a 2x" onerror="alert(1)"><a href="javascript:alert(1)" ping="https://example.invalid">link</a><img src="data:image/png;base64,aGVsbG8="><svg onload="alert(1)"><image href="https://example.invalid/a" /></svg></body></html>`, host.window);
    const output = new JSDOM(result);
    const document = output.window.document;
    assert.equal(document.querySelector("script,iframe,object,embed,link,base,form"), null);
    assert.equal(document.querySelector("[onload],[onerror],[srcset],[ping]"), null);
    assert.equal(document.querySelector('meta[http-equiv="refresh"]'), null);
    assert.equal(document.querySelector('[src^="http"],[href^="http"],[href^="javascript:"]'), null);
    assert.equal(document.querySelectorAll('img[src^="data:image/png"]').length, 1);
    assert.equal(host.window.exportedSecret, undefined);
    output.window.close();
    assert.throws(() => htmlImageDocument("", host.window), /为空/);
    assert.throws(() => htmlImageDocument("x".repeat(3200001), host.window), /3.2 MB/);
  } finally { host.window.close(); }
});
