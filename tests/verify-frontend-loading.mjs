import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)]
  .filter((match) => !/\bsrc\s*=/iu.test(match[1])).map((match) => match[2]).join("\n");
const API_BASE = "https://penguin-chatbot-5mee.onrender.com";
const CONVERSATION_KEY = "penguin-chatbot:conversation:v1";
const flush = async () => { for (let index = 0; index < 12; index += 1) await Promise.resolve(); };

function sessionStorage(initial = {}) {
  const entries = new Map(Object.entries(initial));
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: (key) => entries.delete(key),
  };
}

function browser({ url = "https://embed.example.org/seminar", override, fetchImpl, storage = sessionStorage() } = {}) {
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
    replaceChildren(...children) {
      this.text = "";
      for (const child of this.childNodes) child.parentNode = null;
      this.childNodes = [];
      for (const child of children) this.appendChild(child);
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

  for (const [id, tag] of [["penguin-mouth", "img"], ["chat", "div"], ["user-input", "input"], ["send-btn", "button"], ["new-chat-btn", "button"]]) {
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
    sessionStorage: storage,
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
    context, document, elements, createdScripts, requests, timers, storage,
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

test("each request includes completed earlier turns and source URLs but not its current question or status text", async () => {
  const source = { title: "A mathematical paper", url: "https://arxiv.org/abs/2601.01234" };
  const replies = [
    { reply: "The paper constructs a stochastic process.", sources: [source], language: "en" },
    { reply: "Here is an explanation of that process.", language: "en" },
  ];
  const page = browser({ fetchImpl: async () => ({ ok: true, json: async () => replies.shift() }) });
  page.elements.get("user-input").value = "Tell me about this mathematical paper.";
  await page.context.handleSend();
  const first = JSON.parse(page.requests[0].options.body);
  assert.deepEqual(first, { message: "Tell me about this mathematical paper.", history: [] });
  const saved = JSON.parse(page.storage.getItem(CONVERSATION_KEY));
  assert.deepEqual(saved.map((message) => message.role), ["user", "assistant"]);
  assert.equal(saved[1].content, "The paper constructs a stochastic process.");
  assert.deepEqual(saved[1].sources, [source]);

  page.elements.get("user-input").value = "Who constructed it?";
  await page.context.handleSend();
  const second = JSON.parse(page.requests[1].options.body);
  assert.equal(second.message, "Who constructed it?");
  assert.equal(second.history.length, 2);
  assert.deepEqual(second.history.map((message) => message.role), ["user", "assistant"]);
  assert.equal(second.history[0].content, first.message);
  assert.ok(second.history[1].content.includes("The paper constructs a stochastic process."));
  assert.ok(second.history[1].content.includes(source.url));
  assert.doesNotMatch(JSON.stringify(second.history), /Who constructed it\?|Thinking|Still working|考え中/u);
  assert.equal(JSON.parse(page.storage.getItem(CONVERSATION_KEY)).length, 4);
});

test("reload restores the current tab transcript and citation metadata without sharing it with another tab", async () => {
  const storage = sessionStorage({ [CONVERSATION_KEY]: JSON.stringify([
    { role: "user", content: "Which paper discusses this process?" },
    { role: "assistant", content: "This paper discusses it.", language: "en",
      sources: [{ title: "The paper", url: "https://arxiv.org/abs/2601.01234" }], checkedAt: "2026-11-16T01:00:00Z",
      abstract: [{ original: "The original abstract describes the construction.", dateLabel: "2026年11月16日", abstractMissing: false }] },
  ]) });
  const restored = browser({ storage });
  const chat = restored.elements.get("chat");
  assert.equal(chat.childNodes.length, 2);
  assert.ok(chat.textContent.includes("Which paper discusses this process?"));
  assert.ok(chat.textContent.includes("This paper discusses it."));
  assert.ok(chat.textContent.includes("The original abstract describes the construction."));
  const links = descendants(chat).filter((element) => element.tagName === "A");
  assert.equal(links.length, 1);
  assert.equal(links[0].href, "https://arxiv.org/abs/2601.01234");
  assert.equal(links[0].textContent, "The paper");
  assert.equal(restored.requests.length, 0);
  assert.equal(JSON.parse(storage.getItem(CONVERSATION_KEY)).length, 2);
  restored.elements.get("user-input").value = "Explain that result.";
  await restored.context.handleSend();
  const followup = JSON.parse(restored.requests[0].options.body);
  assert.equal(followup.history.length, 2);
  assert.ok(followup.history[1].content.includes(links[0].href));

  const separate = browser();
  assert.equal(separate.elements.get("chat").textContent, "");
  separate.elements.get("user-input").value = "Explain a martingale.";
  await separate.context.handleSend();
  assert.deepEqual(JSON.parse(separate.requests[0].options.body).history, []);
});

test("unavailable or corrupt session storage leaves conversation memory working in the open tab", async () => {
  const denied = () => { throw new Error("Storage access denied"); };
  for (const storage of [
    { getItem: denied, setItem: denied, removeItem: denied },
    sessionStorage({ [CONVERSATION_KEY]: "{invalid JSON" }),
  ]) {
    const page = browser({ storage });
    assert.equal(page.elements.get("send-btn").disabled, false);
    assert.equal(page.elements.get("chat").textContent, "");
    page.elements.get("user-input").value = "Explain expectation.";
    await page.context.handleSend();
    page.elements.get("user-input").value = "Give an example.";
    await page.context.handleSend();
    const followup = JSON.parse(page.requests[1].options.body);
    assert.equal(followup.history.length, 2);
    assert.equal(followup.history[0].content, "Explain expectation.");
    assert.equal(followup.history[1].content, "A short answer.");
    assert.equal(page.elements.get("send-btn").disabled, false);
    page.elements.get("new-chat-btn").emit("click");
    assert.equal(page.elements.get("chat").textContent, "");
  }
});

test("a longer saved chat sends its first and most recent turns without silently forgetting old messages", async () => {
  const messages = Array.from({ length: 40 }, (_, index) => [
    { role: "user", content: `Mathematical question ${index + 1}` },
    { role: "assistant", content: `Mathematical answer ${index + 1}`, language: "en" },
  ]).flat();
  const page = browser({ storage: sessionStorage({ [CONVERSATION_KEY]: JSON.stringify(messages) }) });
  assert.equal(page.elements.get("chat").childNodes.length, 80);
  page.elements.get("user-input").value = "Compare the first result with the last one.";
  await page.context.handleSend();
  const request = JSON.parse(page.requests[0].options.body);
  assert.equal(request.history.length, 80);
  assert.deepEqual(request.history[0], messages[0]);
  assert.equal(request.history.at(-1).content, messages.at(-1).content);
});

test("network failures do not enter assistant memory and retrying the same question does not duplicate its user turn", async () => {
  let attempt = 0;
  const page = browser({ fetchImpl: async () => {
    if (++attempt === 1) throw new TypeError("Offline");
    return { ok: true, json: async () => ({ reply: "Expectation is linear.", language: "en" }) };
  } });
  const question = "Explain linearity of expectation.";
  page.elements.get("user-input").value = question;
  await page.context.handleSend();
  const failed = JSON.parse(page.storage.getItem(CONVERSATION_KEY));
  assert.equal(failed.length, 1);
  assert.equal(failed[0].role, "user");
  assert.equal(failed[0].content, question);
  assert.ok(page.elements.get("chat").textContent.includes("couldn't send your question"));

  page.elements.get("user-input").value = question;
  await page.context.handleSend();
  const retried = JSON.parse(page.requests[1].options.body);
  assert.equal(retried.message, question);
  assert.deepEqual(retried.history, []);
  const saved = JSON.parse(page.storage.getItem(CONVERSATION_KEY));
  assert.deepEqual(saved.map((message) => message.role), ["user", "assistant"]);
  assert.equal(saved[1].content, "Expectation is linear.");
  assert.doesNotMatch(JSON.stringify(saved), /Offline|couldn't send your question|Thinking/u);
  assert.equal(page.elements.get("chat").childNodes.filter((element) => element.className === "message user").length, 1);
});

test("new chat is disabled while a reply is pending and clears only this tab's completed conversation", async () => {
  let complete;
  const page = browser({ fetchImpl: () => new Promise((resolve) => { complete = resolve; }) });
  page.elements.get("user-input").value = "Explain a martingale.";
  const sending = page.context.handleSend();
  await flush();
  assert.equal(page.elements.get("new-chat-btn").disabled, true);
  complete({ ok: true, json: async () => ({ reply: "A martingale has constant conditional expectation.", language: "en" }) });
  await sending;
  assert.equal(page.elements.get("new-chat-btn").disabled, false);
  assert.equal(JSON.parse(page.storage.getItem(CONVERSATION_KEY)).length, 2);
  page.elements.get("new-chat-btn").emit("click");
  assert.equal(page.elements.get("chat").textContent, "");
  assert.ok(page.storage.getItem(CONVERSATION_KEY) === null || JSON.parse(page.storage.getItem(CONVERSATION_KEY)).length === 0);
  page.elements.get("user-input").value = "What is expectation?";
  const waiting = page.context.handleSend();
  await flush();
  const request = JSON.parse(page.requests.at(-1).options.body);
  assert.deepEqual(request.history, []);
  complete({ ok: true, json: async () => ({ reply: "A weighted average.", language: "en" }) });
  await waiting;
});
