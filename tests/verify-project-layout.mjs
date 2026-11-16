import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const moduleUrl = (filename) => pathToFileURL(path.join(projectRoot, filename)).href;
const childEnv = () => ({ ...process.env, NODE_ENV: "test", PORT: "0", OPENROUTER_API_KEY: "", PENGUIN_TEST_NOW: "2026-11-16T09:00:00Z" });

function foreignDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-layout-"));
  t.after(() => {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith("penguin-layout-"));
    fs.rmSync(resolved, { recursive: true });
  });
  return directory;
}

function observeProcess(child) {
  const output = { stdout: "", stderr: "" };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output.stdout += chunk; });
  child.stderr.on("data", (chunk) => { output.stderr += chunk; });
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code));
  });
  return { output, closed };
}

test("legacy entry-point imports share the organized modules without listening or scraping", { timeout: 10000 }, async (t) => {
  const cwd = foreignDirectory(t);
  const child = spawn(process.execPath, ["--input-type=module", "-"], {
    cwd, env: childEnv(), windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
  });
  const { output, closed } = observeProcess(child);
  const timer = setTimeout(() => child.kill(), 7000);
  child.stdin.end(`
    import assert from 'node:assert/strict';
    import http from 'node:http';
    import https from 'node:https';
    let networkCalls = 0;
    const unexpected = () => { networkCalls += 1; throw new Error('Imports must not start servers or network requests'); };
    http.Server.prototype.listen = unexpected;
    http.request = https.request = unexpected;
    globalThis.fetch = unexpected;
    const legacyServer = await import(${JSON.stringify(moduleUrl("server.js"))});
    const organizedApp = await import(${JSON.stringify(moduleUrl("src/app.js"))});
    const legacyScraper = await import(${JSON.stringify(moduleUrl("scrape.js"))});
    const organizedScraper = await import(${JSON.stringify(moduleUrl("scripts/scrape.js"))});
    assert.equal(legacyServer.app, organizedApp.app);
    assert.equal(legacyScraper.scrape, organizedScraper.scrape);
    assert.equal(typeof legacyServer.app, 'function');
    assert.equal(typeof legacyScraper.scrape, 'function');
    assert.equal(networkCalls, 0);
    process.stdout.write('LAYOUT_IMPORTS_OK\\n');
  `);
  try {
    assert.equal(await closed, 0, output.stderr || output.stdout);
    assert.match(output.stdout, /LAYOUT_IMPORTS_OK/u);
    assert.deepEqual(fs.readdirSync(cwd), []);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill();
  }
});

test("the legacy server launcher serves static files and saved seminars from an unrelated directory", { timeout: 15000 }, async (t) => {
  const cwd = foreignDirectory(t);
  // Observe the actual ephemeral port while executing the real legacy launcher.
  const observer = `
    import http from 'node:http';
    const listen = http.Server.prototype.listen;
    http.Server.prototype.listen = function (...args) {
      this.once('listening', () => process.stdout.write('LAYOUT_READY ' + JSON.stringify({ port: this.address().port }) + '\\n'));
      return listen.apply(this, args);
    };
    globalThis.fetch = () => { throw new Error('External requests are disabled in the layout test'); };
  `;
  const child = spawn(process.execPath, [
    "--import", `data:text/javascript,${encodeURIComponent(observer)}`, path.join(projectRoot, "server.js"),
  ], { cwd, env: childEnv(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const { output, closed } = observeProcess(child);
  let timer;
  try {
    const port = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Server did not become ready: ${output.stderr || output.stdout}`)), 7000);
      const inspect = () => {
        const match = output.stdout.match(/LAYOUT_READY (\{[^\n]+\})/u);
        if (match) resolve(JSON.parse(match[1]).port);
      };
      child.stdout.on("data", inspect);
      child.once("error", reject);
      child.once("close", (code) => reject(new Error(`Server exited (${code}): ${output.stderr || output.stdout}`)));
      inspect();
    });
    clearTimeout(timer);
    assert.ok(Number.isInteger(port) && port > 0);
    const origin = `http://127.0.0.1:${port}`;
    for (const [route, file, type] of [
      ["/", "index.html", /text\/html/iu],
      ["/penguin_body.png", "penguin_body.png", /image\/png/iu],
      ["/mouth.png", "mouth.png", /image\/png/iu],
    ]) {
      const response = await fetch(origin + route, { signal: AbortSignal.timeout(3000) });
      assert.equal(response.status, 200, route);
      assert.match(response.headers.get("content-type"), type);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), fs.readFileSync(path.join(projectRoot, "public", file)));
    }
    const healthResponse = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(3000) });
    assert.equal(healthResponse.status, 200);
    const health = await healthResponse.json();
    assert.ok(health.seminarCount > 50, "saved seminars must resolve independently of the working directory");
    assert.notEqual(health.dataAsOf, "不明");
    assert.deepEqual(fs.readdirSync(cwd), []);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill();
    await closed;
  }
});
