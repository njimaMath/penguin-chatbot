import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)]
  .filter((match) => !/\bsrc\s*=/iu.test(match[1])).map((match) => match[2]).join("\n");
const API_BASE = "https://penguin-chatbot-5mee.onrender.com";
const flush = async () => { for (let index = 0; index < 12; index += 1) await Promise.resolve(); };

function browser({ url = "https://embed.example.org/seminar", override, fetchImpl } = {}) {
  const elements = new Map();
  const createdScripts = [];
  const requests = [];
  const frames = [];
  const timers = new Map();
  let nextTimer = 0;

  class Element {
    constructor(tagName) {
      this.tagName = tagName.toUpperCase();
      this.childNodes = [];
      this.parentNode = null;
      this.listeners = new Map();
      this.disabled = false;
      this.value = "";
      this.className = "";
      this.scrollTop = 0;
      this.scrollHeight = 0;
      this.text = "";
      const classes = new Set();
      this.classList = { add: (value) => classes.add(value), remove: (value) => classes.delete(value), contains: (value) => classes.has(value) };
    }
    set id(value) { this.identifier = value; elements.set(value, this); }
    get id() { return this.identifier || ""; }
    set textContent(value) { this.text = String(value); this.childNodes = []; }
    get textContent() { return this.text + this.childNodes.map((child) => child.textContent).join(""); }
    appendChild(child) {
      child.parentNode = this;
      this.childNodes.push(child);
      if (child.tagName === "SCRIPT") createdScripts.push(child);
      return child;
    }
    removeChild(child) {
      const index = this.childNodes.indexOf(child);
      if (index >= 0) this.childNodes.splice(index, 1);
      child.parentNode = null;
      return child;
    }
    remove() { this.parentNode?.removeChild(this); if (this.id) elements.delete(this.id); }
    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }
    removeEventListener(type, listener) {
      this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item !== listener));
    }
    emit(type, details = {}) {
      const event = { type, target: this, ...details };
      this[`on${type}`]?.(event);
      for (const listener of this.listeners.get(type) || []) listener(event);
    }
    setAttribute(name, value) { this[name] = String(value); }
    getAttribute(name) { return this[name] ?? null; }
    focus() { this.focused = true; }
  }

  for (const [id, tag] of [["penguin-mouth", "img"], ["chat", "div"], ["user-input", "input"], ["send-btn", "button"]]) {
    const element = new Element(tag);
    element.id = id;
  }
  const document = {
    head: new Element("head"), body: new Element("body"),
    getElementById: (id) => elements.get(id) || null,
    createElement: (tag) => new Element(tag),
    createTextNode: (text) => ({ textContent: String(text), parentNode: null }),
  };
  const sandbox = {
    document,
    location: new URL(url),
    URL, AbortController, Date, Intl,
    console: { error() {}, warn() {}, log() {} },
    setTimeout: (callback, delay = 0) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
    requestAnimationFrame: (callback) => { frames.push(callback); return frames.length; },
    fetch: (requestUrl, options = {}) => {
      requests.push({ url: String(requestUrl), options });
      return fetchImpl ? fetchImpl(String(requestUrl), options) : Promise.resolve({ ok: true, json: async () => ({ reply: "A short answer.", language: "en" }) });
    },
  };
  if (override !== undefined) sandbox.PENGUIN_API_BASE = override;
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(inlineScripts, context, { filename: "public/index.html", timeout: 1000 });

  return {
    context, document, elements, createdScripts, requests, timers,
    frame() { const batch = frames.splice(0); for (const callback of batch) callback(0); },
    fireTimers(predicate) {
      for (const [id, timer] of [...timers]) {
        if (predicate(timer.delay)) { timers.delete(id); timer.callback(); }
      }
    },
    loadMath(typesetCalls) {
      const script = createdScripts.at(-1);
      context.MathJax.typesetPromise = async (targets) => { typesetCalls.push(Array.from(targets)); };
      context.MathJax.startup.promise = Promise.resolve();
      script.emit("load");
    },
  };
}

function descendants(element) {
  return (element.childNodes || []).flatMap((child) => [child, ...descendants(child)]);
}

test("the initial page enables input without MathJax or a chat request", () => {
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc\s*=[^>]*mathjax/iu);
  const page = browser();
  assert.equal(page.elements.get("user-input").disabled, false);
  assert.equal(page.elements.get("send-btn").disabled, false);
  assert.equal(page.createdScripts.length, 0);
  assert.equal(page.requests.length, 0);
  page.context.appendMessage("bot", "The next seminar is on Monday.");
  page.context.appendMessage("bot", "The price is \\$5.");
  assert.equal(page.createdScripts.length, 0);
});

test("API routing supports embedded production, local development and explicit overrides", () => {
  for (const [options, expected] of [
    [{}, API_BASE],
    [{ url: "http://localhost:3000/" }, ""],
    [{ url: "http://127.0.0.1:3000/" }, ""],
    [{ url: "http://[::1]:3000/" }, ""],
    [{ override: "https://api.example.org///" }, "https://api.example.org"],
    [{ override: "" }, ""],
  ]) {
    const page = browser(options);
    assert.equal(page.context.getApiBase(), expected);
    assert.equal(page.context.apiUrl("/chat"), `${expected}/chat`);
    assert.equal(page.context.apiUrl("/health"), `${expected}/health`);
  }
});

test("a delayed health warmup runs after two frames and never blocks sending", { timeout: 1000 }, async () => {
  let healthAborted = false;
  const page = browser({ fetchImpl: (url, options) => {
    if (url.endsWith("/health")) {
      return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => {
        healthAborted = true;
        reject(new DOMException("Timed out", "AbortError"));
      }, { once: true }));
    }
    return Promise.resolve({ ok: true, json: async () => ({ reply: "The next seminar is on Monday.", language: "en" }) });
  } });
  page.frame();
  await flush();
  assert.equal(page.requests.length, 0);
  page.frame();
  await flush();
  assert.equal(page.requests.length, 1);
  assert.equal(page.requests[0].url, `${API_BASE}/health`);
  assert.notEqual(page.requests[0].options.method, "POST");
  assert.ok([...page.timers.values()].some((timer) => timer.delay === 75000));
  assert.equal(page.elements.get("send-btn").disabled, false);
  page.elements.get("user-input").value = "What is the next talk?";
  await page.context.handleSend();
  assert.equal(page.requests.filter((request) => request.url.endsWith("/chat")).length, 1);
  assert.equal(page.requests[1].url, `${API_BASE}/chat`);
  assert.equal(page.requests[1].options.method, "POST");
  assert.equal(page.elements.get("send-btn").disabled, false);
  assert.ok(page.elements.get("chat").textContent.includes("The next seminar is on Monday."));
  page.fireTimers((delay) => delay === 75000);
  await flush();
  assert.equal(healthAborted, true);
  assert.equal(page.requests.filter((request) => request.url.endsWith("/health")).length, 1);
});

test("failed warmup and same-origin hosting leave the chat controls independent", { timeout: 1000 }, async () => {
  const page = browser({ fetchImpl: async (url) => {
    if (url.endsWith("/health")) throw new TypeError("Backend asleep");
    return { ok: true, json: async () => ({ reply: "2", language: "en" }) };
  } });
  page.frame(); page.frame(); await flush();
  assert.equal(page.requests.length, 1);
  assert.equal(page.elements.get("send-btn").disabled, false);
  page.elements.get("user-input").value = "1+1?";
  await page.context.handleSend();
  assert.equal(page.elements.get("send-btn").disabled, false);
  assert.ok(page.elements.get("chat").textContent.includes("2"));

  for (const options of [{ url: "http://localhost:3000/" }, { override: "" }, { override: "https://embed.example.org/" }]) {
    const local = browser(options);
    local.frame(); local.frame(); await flush();
    assert.equal(local.requests.length, 0);
  }
});

test("math loads once, waits for startup, and typesets only the new messages", async () => {
  const page = browser();
  const first = page.context.appendMessage("bot", "The result is $x+y$.");
  const second = page.context.appendMessage("bot", "Another formula: $$x^2+y^2$$.");
  await flush();
  assert.equal(page.createdScripts.length, 1);
  const script = page.createdScripts[0];
  assert.equal(script.id, "mathjax-script");
  assert.match(script.src, /mathjax@4\.0\.0\/tex-chtml\.js$/u);
  assert.equal(page.context.MathJax.startup.typeset, false);
  assert.ok(page.context.MathJax.loader.load.includes("ui/safe"));
  assert.equal(page.context.MathJax.options.safeOptions.allow.URLs, "none");
  const typesetCalls = [];
  let completeStartup;
  page.context.MathJax.typesetPromise = async (targets) => { typesetCalls.push(Array.from(targets)); };
  page.context.MathJax.startup.promise = new Promise((resolve) => { completeStartup = resolve; });
  script.emit("load");
  await flush();
  assert.equal(typesetCalls.length, 0);
  completeStartup();
  await flush();
  assert.equal(typesetCalls.length, 2);
  assert.equal(typesetCalls[0][0], first);
  assert.equal(typesetCalls[1][0], second);
  const third = page.context.appendMessage("bot", "$z=1$.");
  await flush();
  assert.equal(page.createdScripts.length, 1);
  assert.equal(typesetCalls.length, 3);
  assert.equal(typesetCalls[2][0], third);
});

test("MathJax load errors and timeouts preserve text and allow a later retry", async () => {
  for (const failure of ["error", "timeout"]) {
    const page = browser();
    const text = "Keep this readable: $x^2+y^2$.";
    const message = page.context.appendMessage("bot", text);
    await flush();
    assert.equal(page.createdScripts.length, 1);
    if (failure === "error") page.createdScripts[0].emit("error");
    else page.fireTimers((delay) => delay > 0 && delay < 75000);
    await flush();
    assert.equal(message.textContent, text);
    assert.equal(page.elements.get("send-btn").disabled, false);
    const retried = page.context.appendMessage("bot", "Try rendering $z=1$.");
    await flush();
    assert.equal(page.createdScripts.length, 2, failure);
    const typesetCalls = [];
    page.loadMath(typesetCalls);
    await flush();
    assert.equal(typesetCalls.length, 1);
    assert.equal(typesetCalls[0][0], retried);
    assert.equal(message.textContent, text);
  }
});

test("external paper citations remain clickable without loading math or injecting markup", () => {
  const page = browser();
  const message = page.context.appendMessage("bot", "Here is a verified reference.", undefined, [
    { title: "A mathematical paper", url: "https://arxiv.org/abs/2601.01234" },
    { title: "<script>unsafe()</script>", url: "https://example.org/paper" },
    { title: "Bad", url: "javascript:alert(1)" },
  ], "2026-11-16T01:00:00Z", "en");
  const links = descendants(message).filter((element) => element.tagName === "A");
  assert.equal(links.length, 2);
  assert.equal(links[0].href, "https://arxiv.org/abs/2601.01234");
  assert.equal(links[0].textContent, "A mathematical paper");
  assert.equal(links[1].textContent, "<script>unsafe()</script>");
  for (const link of links) {
    assert.equal(link.target, "_blank");
    assert.ok(link.rel.includes("noopener") && link.rel.includes("noreferrer"));
  }
  assert.equal(page.createdScripts.length, 0);
});
