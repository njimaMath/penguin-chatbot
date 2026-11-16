import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import * as cheerio from "cheerio";

test("static frontend remains available independently of the cross-origin chat backend", async (t) => {
  const savedEnv = {
    NODE_ENV: process.env.NODE_ENV,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    PENGUIN_TEST_NOW: process.env.PENGUIN_TEST_NOW,
  };
  const nativeFetch = globalThis.fetch;
  const savedConsole = { log: console.log, warn: console.warn, error: console.error };
  let staticServer;
  let backend;
  let externalCalls = 0;
  process.env.NODE_ENV = "test";
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.PENGUIN_TEST_NOW = "2026-11-16T09:00:00Z";
  console.log = console.warn = console.error = () => {};
  globalThis.fetch = async () => { externalCalls += 1; throw new Error("External requests are disabled in this test"); };
  const listen = (server) => new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const close = (server) => server?.listening ? new Promise((resolve) => server.close(resolve)) : Promise.resolve();

  try {
    const assets = new Map();
    for (const [route, file, contentType] of [
      ["/", "index.html", "text/html; charset=utf-8"],
      ["/penguin_body.png", "penguin_body.png", "image/png"],
      ["/mouth.png", "mouth.png", "image/png"],
    ]) {
      assets.set(route, { body: await readFile(new URL(`../public/${file}`, import.meta.url)), contentType });
    }
    staticServer = createServer((request, response) => {
      const asset = assets.get(request.url);
      if (!asset) { response.writeHead(404).end(); return; }
      response.writeHead(200, { "Content-Type": asset.contentType, "Content-Length": asset.body.length });
      response.end(asset.body);
    });
    await listen(staticServer);
    const staticOrigin = `http://127.0.0.1:${staticServer.address().port}`;
    const checkAssets = async () => {
      for (const [route, asset] of assets) {
        const response = await nativeFetch(staticOrigin + route);
        assert.equal(response.status, 200, route);
        assert.equal(response.headers.get("content-type"), asset.contentType);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), asset.body);
      }
    };

    await t.test("HTML and both images load before any backend has started", async () => {
      await checkAssets();
      const $ = cheerio.load(assets.get("/").body.toString("utf8"));
      const eagerMathJax = $("script[src]").filter((_, element) => /mathjax/iu.test($(element).attr("src")));
      assert.equal(eagerMathJax.length, 0);
      assert.equal($('img[src="penguin_body.png"]').length, 1);
      assert.equal($('img[src="mouth.png"]').length, 1);
    });

    const { app } = await import("../src/app.js");
    backend = createServer(app);
    await listen(backend);
    const backendOrigin = `http://127.0.0.1:${backend.address().port}`;
    assert.notEqual(backendOrigin, staticOrigin);
    const assertAllowedOrigin = (response) => {
      assert.ok(["*", staticOrigin].includes(response.headers.get("access-control-allow-origin")));
    };

    await t.test("separate static origin passes JSON POST preflight and receives a localized chat reply", async () => {
      const preflight = await nativeFetch(`${backendOrigin}/chat`, {
        method: "OPTIONS",
        headers: {
          Origin: staticOrigin,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      });
      assert.ok(preflight.status === 200 || preflight.status === 204);
      assertAllowedOrigin(preflight);
      assert.match(preflight.headers.get("access-control-allow-methods"), /(?:^|,)\s*POST\s*(?:,|$)/u);
      assert.match(preflight.headers.get("access-control-allow-headers"), /content-type/iu);
      await preflight.arrayBuffer();

      const response = await nativeFetch(`${backendOrigin}/chat`, {
        method: "POST",
        headers: { Origin: staticOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ message: "what is today's date?" }),
      });
      assert.equal(response.status, 200);
      assertAllowedOrigin(response);
      const data = await response.json();
      assert.equal(data.language, "en");
      assert.match(data.reply, /November 16, 2026/u);
      assert.match(data.reply, /18:00 JST/u);
      assert.equal(externalCalls, 0);
    });

    await close(backend);
    backend = null;
    await t.test("HTML and images stay available after the backend is closed", checkAssets);
    assert.equal(externalCalls, 0);
  } finally {
    await close(backend);
    await close(staticServer);
    globalThis.fetch = nativeFetch;
    Object.assign(console, savedConsole);
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
