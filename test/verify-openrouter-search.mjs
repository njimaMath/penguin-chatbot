import assert from "node:assert/strict";
import test from "node:test";
import { callOpenRouter, callOpenRouterWithSources } from "../openrouter.js";

const env = { OPENROUTER_API_KEY: "test-api-key" };
const citation = (url, title) => ({ type: "url_citation", url_citation: { url, title } });
const success = (content, annotations) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content, annotations } }] }),
});

test("research requests enable the bounded web plugin and return verified citations", async () => {
  let calls = 0;
  const result = await callOpenRouterWithSources("Use verified mathematical research sources.", "Who constructed the critical KPZ process?", {
    env,
    webSearch: true,
    fetchImpl: async (_url, options) => {
      calls += 1;
      const body = JSON.parse(options.body);
      assert.deepEqual(body.reasoning, { effort: "low", exclude: true });
      assert.equal(body.max_tokens, 1000);
      assert.equal(body.plugins.length, 1);
      const plugin = body.plugins[0];
      assert.equal(plugin.id, "web");
      assert.equal(plugin.engine, "parallel");
      assert.equal(plugin.mode, "turbo");
      assert.equal(plugin.max_results, 3);
      assert.equal(typeof plugin.search_prompt, "string");
      assert.ok(plugin.search_prompt.trim());
      return success("  Verified answer with sources.\n", [
        citation("https://arxiv.org/abs/2601.01234", "A mathematical paper"),
        citation("https://arxiv.org/abs/2601.01234", "Duplicate"),
        citation("http://example.org/paper.pdf"),
        citation("javascript:alert(1)", "Unsafe"),
        citation("https://user:password@example.org/paper", "Credential URL"),
      ]);
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, {
    reply: "Verified answer with sources.",
    sources: [
      { url: "https://arxiv.org/abs/2601.01234", title: "A mathematical paper" },
      { url: "http://example.org/paper.pdf", title: "example.org" },
    ],
    webSearchUsed: true,
  });
});

test("ordinary replies omit the plugin and the string wrapper remains compatible", async () => {
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.plugins, undefined);
    assert.deepEqual(body.reasoning, { effort: "low", exclude: true });
    assert.equal(body.max_tokens, 1000);
    return success("  2  ");
  };
  assert.deepEqual(await callOpenRouterWithSources("Answer the math question.", "1+1?", { env, fetchImpl }), {
    reply: "2", sources: [], webSearchUsed: false,
  });
  assert.equal(await callOpenRouter("Answer the math question.", "1+1?", { env, fetchImpl }), "2");
});

test("web research without valid sources never returns unverified answer text or retries", async () => {
  for (const annotations of [undefined, [], [citation("javascript:alert(1)", "Invalid source")]]) {
    let calls = 0;
    await assert.rejects(callOpenRouterWithSources("Use research sources.", "Recent advances in 2D critical KPZ?", {
      env,
      webSearch: true,
      fetchImpl: async () => { calls += 1; return success("Unverified claims must not be returned.", annotations); },
    }), { code: "WEB_SEARCH_NO_SOURCES" });
    assert.equal(calls, 1);
  }
});

test("web requests do not retry rate limits or server errors", async () => {
  for (const status of [429, 503]) {
    let calls = 0;
    await assert.rejects(callOpenRouterWithSources("Use research sources.", "Search for a mathematical paper", {
      env,
      webSearch: true,
      fetchImpl: async () => {
        calls += 1;
        return { ok: false, status, json: async () => ({ error: { message: "Provider unavailable" } }) };
      },
    }));
    assert.equal(calls, 1);
  }
});

test("web search deadlines cover response-body reading without another paid attempt", { timeout: 1000 }, async () => {
  let calls = 0;
  let aborted = 0;
  await assert.rejects(callOpenRouterWithSources("Use research sources.", "Who constructed the critical KPZ process?", {
    env,
    webSearch: true,
    timeoutMs: 20,
    fetchImpl: async (_url, { signal }) => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        json: () => new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted += 1;
            reject(new DOMException("Timed out", "AbortError"));
          }, { once: true });
        }),
      };
    },
  }), { name: "AbortError" });
  assert.equal(calls, 1);
  assert.equal(aborted, 1);
});
