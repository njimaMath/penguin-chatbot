import assert from "node:assert/strict";
import test from "node:test";
import { callOpenRouter, DEFAULT_MODEL, getOpenRouterModel } from "../src/services/openrouter.js";

const env = { OPENROUTER_API_KEY: " test-api-key " };
const success = (content = "回答だよ。") => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content } }] }),
});
const failure = (status, message = "Provider rejected the request") => ({
  ok: false,
  status,
  json: async () => ({ error: { message } }),
});

test("model defaults to the verified snapshot and accepts a trimmed override", () => {
  assert.equal(DEFAULT_MODEL, "deepseek/deepseek-v4.1-flash-1017");
  for (const config of [{}, { OPENROUTER_MODEL: "" }, { OPENROUTER_MODEL: "  " }]) {
    assert.equal(getOpenRouterModel(config), DEFAULT_MODEL);
  }
  assert.equal(getOpenRouterModel({ OPENROUTER_MODEL: " deepseek/custom-model " }), "deepseek/custom-model");
});

test("requests medium reasoning with room for a short visible answer and returns only that answer", async () => {
  let calls = 0;
  const reply = await callOpenRouter("Use the seminar facts.", "会場は？", {
    env,
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, "Bearer test-api-key");
      const body = JSON.parse(options.body);
      assert.equal(body.model, DEFAULT_MODEL);
      assert.deepEqual(body.reasoning, { effort: "medium", exclude: true });
      assert.equal(body.max_tokens, 2000);
      assert.equal(body.temperature, 0.2);
      assert.deepEqual(body.messages, [
        { role: "system", content: "Use the seminar facts." },
        { role: "user", content: "会場は？" },
      ]);
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "  回答だよ。\n", reasoning: "Private reasoning" } }] }),
      };
    },
  });
  assert.equal(reply, "回答だよ。");
  assert.equal(calls, 1);
});

test("uses the configured model in the actual request", async () => {
  await callOpenRouter("facts", "question", {
    env: { ...env, OPENROUTER_MODEL: " deepseek/another-snapshot " },
    fetchImpl: async (_url, options) => {
      assert.equal(JSON.parse(options.body).model, "deepseek/another-snapshot");
      return success();
    },
  });
});

test("missing or blank API key fails before making a request", async () => {
  for (const config of [{}, { OPENROUTER_API_KEY: "   " }]) {
    let calls = 0;
    await assert.rejects(callOpenRouter("facts", "question", {
      env: config,
      fetchImpl: async () => { calls += 1; return success(); },
    }));
    assert.equal(calls, 0);
  }
});

test("permanent HTTP errors are not retried even with custom provider messages", async (t) => {
  for (const status of [400, 401, 402, 403, 404, 408, 422]) {
    await t.test(String(status), async () => {
      let calls = 0;
      await assert.rejects(callOpenRouter("facts", "question", {
        env,
        fetchImpl: async () => { calls += 1; return failure(status); },
      }));
      assert.equal(calls, 1);
    });
  }
});

test("429 and server errors can recover with one retry", async (t) => {
  for (const status of [429, 500, 502, 503, 504]) {
    await t.test(String(status), async () => {
      let calls = 0;
      const reply = await callOpenRouter("facts", "question", {
        env,
        fetchImpl: async () => ++calls === 1 ? failure(status) : success(),
      });
      assert.equal(reply, "回答だよ。");
      assert.equal(calls, 2);
    });
  }
});

test("HTTP status still controls retries when the error body is not JSON", async () => {
  for (const status of [401, 503]) {
    let calls = 0;
    await assert.rejects(callOpenRouter("facts", "question", {
      env,
      fetchImpl: async () => {
        calls += 1;
        return { ok: false, status, json: async () => { throw new SyntaxError("HTML error page"); } };
      },
    }));
    assert.equal(calls, status === 401 ? 1 : 2);
  }
});

test("HTTP 200 error envelopes cannot masquerade as successful replies", async () => {
  for (const code of [401, 429, 503]) {
    let calls = 0;
    await assert.rejects(callOpenRouter("facts", "question", {
      env,
      fetchImpl: async () => {
        calls += 1;
        return { ok: true, status: 200, json: async () => ({ error: { code, message: "Provider error" } }) };
      },
    }));
    assert.equal(calls, code === 401 ? 1 : 2);
  }
});

test("network errors and malformed successful JSON can recover with one retry", async () => {
  for (const kind of ["network", "json"]) {
    let calls = 0;
    const reply = await callOpenRouter("facts", "question", {
      env,
      fetchImpl: async () => {
        if (++calls > 1) return success();
        if (kind === "network") throw new TypeError("Network unavailable");
        return { ok: true, status: 200, json: async () => { throw new SyntaxError("Invalid JSON"); } };
      },
    });
    assert.equal(reply, "回答だよ。");
    assert.equal(calls, 2);
  }
});

test("retries stop after two failed attempts", async () => {
  let calls = 0;
  await assert.rejects(callOpenRouter("facts", "question", {
    env,
    fetchImpl: async () => { calls += 1; throw new TypeError("Offline"); },
  }));
  assert.equal(calls, 2);
});

test("empty, non-string and reasoning-only responses never become chat answers", async () => {
  for (const content of [undefined, null, "", "  ", {}, []]) {
    let calls = 0;
    await assert.rejects(callOpenRouter("facts", "question", {
      env,
      fetchImpl: async () => {
        calls += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content, reasoning: "Private reasoning" } }] }),
        };
      },
    }));
    assert.equal(calls, 2);
  }
});

test("timeouts cover both waiting for headers and reading the response body", { timeout: 1000 }, async () => {
  for (const stage of ["headers", "body"]) {
    let calls = 0;
    let aborted = 0;
    await assert.rejects(callOpenRouter("facts", "question", {
      env,
      timeoutMs: 20,
      fetchImpl: async (_url, { signal }) => {
        calls += 1;
        const pending = () => new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted += 1;
            reject(new DOMException("Timed out", "AbortError"));
          }, { once: true });
        });
        if (stage === "headers") return pending();
        return { ok: true, status: 200, json: pending };
      },
    }));
    assert.equal(calls, 2);
    assert.equal(aborted, 2);
  }
});
