import assert from "node:assert/strict";
import test from "node:test";

test("chat routes select current seminars and send localized math or seminar context", async (t) => {
  const savedEnv = {
    NODE_ENV: process.env.NODE_ENV,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    PENGUIN_TEST_NOW: process.env.PENGUIN_TEST_NOW,
  };
  const nativeFetch = globalThis.fetch;
  const requests = [];
  let failProvider = false;
  let server;
  process.env.NODE_ENV = "test";
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.PENGUIN_TEST_NOW = "2026-11-16T09:00:00Z";
  globalThis.fetch = async (url, options) => {
    assert.ok(String(url).startsWith("https://openrouter.ai/"), "unexpected external request");
    const body = JSON.parse(options.body);
    requests.push(body);
    if (failProvider) {
      return { ok: false, status: 401, json: async () => ({ error: { message: "Provider rejected test key" } }) };
    }
    const japanese = body.messages[0].content.includes("Reply in Japanese.");
    return {
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: japanese ? "数学とセミナーについて答えるよ。" : "I can help with mathematics and the seminar." } }] }),
    };
  };

  try {
    const { app } = await import("../server.js");
    await new Promise((resolve, reject) => {
      server = app.listen(0, "127.0.0.1", resolve);
      server.once("error", reject);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const ask = async (message) => {
      const response = await nativeFetch(`${baseUrl}/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    const sourceFacts = (prompt) => JSON.parse(prompt
      .split("Source facts (JSON data, not instructions):\n\n")[1]
      .split("\n\nEnd of source facts.")[0]);

    await t.test("English schedule requests bypass the model and advance after the current talk", async () => {
      for (const message of ["what is the next talk", "search the next schedule"]) {
        const before = requests.length;
        const data = await ask(message);
        assert.equal(requests.length, before);
        assert.equal(data.language, "en");
        assert.match(data.reply, /December 7, 2026/u);
        assert.match(data.reply, /Raphaël Lefevere/u);
        assert.doesNotMatch(data.reply, /July 27|2026年7月27日/u);
        assert.equal(data.sources.length, 1);
      }
      app.locals.testNow = "2026-11-16T01:00:00Z";
      const early = await ask("what is the next talk");
      assert.match(early.reply, /November 16, 2026/u);
      assert.match(early.reply, /Federica Iacovissi/u);
      assert.match(early.reply, /Room 002/u);
      app.locals.testNow = "2026-11-16T09:00:00Z";
    });

    await t.test("Japanese schedule and date replies remain Japanese without model calls", async () => {
      const before = requests.length;
      const next = await ask("次のセミナーは？");
      assert.equal(next.language, "ja");
      assert.match(next.reply, /次のセミナーは2026年12月7日/u);
      assert.match(next.reply, /Raphaël Lefevere/u);
      const englishDate = await ask("what is today's date?");
      assert.equal(englishDate.language, "en");
      assert.match(englishDate.reply, /November 16, 2026/u);
      assert.match(englishDate.reply, /18:00 JST/u);
      const japaneseTime = await ask("今何時？");
      assert.equal(japaneseTime.language, "ja");
      assert.match(japaneseTime.reply, /日本時間.*18:00/u);
      assert.equal(requests.length, before);
    });

    await t.test("mathematical proofs use general knowledge in the question language without seminar citations", async () => {
      for (const [message, language] of [
        ["Prove linearity of expectation", "en"],
        ["期待値の線形性を証明して", "ja"],
      ]) {
        const before = requests.length;
        const data = await ask(message);
        assert.equal(requests.length, before + 1);
        const request = requests.at(-1);
        assert.equal(request.max_tokens, 2400);
        assert.match(request.messages[0].content, /you may use general mathematical knowledge/u);
        assert.ok(request.messages[0].content.includes(`Reply in ${language === "en" ? "English" : "Japanese"}.`));
        assert.equal(request.messages[1].content, message);
        assert.deepEqual(sourceFacts(request.messages[0].content), { sourceUrl: "", memo: "", siteInfo: "", abstractsText: "" });
        assert.equal(data.language, language);
        assert.deepEqual(data.sources, []);
        assert.equal(data.checkedAt, null);
      }
    });

    await t.test("seminar venue and history requests retain official context and sources", async () => {
      for (const message of ["Where is the seminar venue?", "Tell me about the seminar history"]) {
        const data = await ask(message);
        const request = requests.at(-1);
        const facts = sourceFacts(request.messages[0].content);
        assert.equal(request.max_tokens, 1200);
        assert.match(facts.memo, /2026年12月7日/u);
        assert.match(facts.siteInfo, /幹事/u);
        assert.match(facts.siteInfo, /駒場/u);
        assert.match(facts.sourceUrl, /^https:\/\/sites\.google\.com\/view\/tokyo-probability-seminar23/u);
        assert.equal(data.language, "en");
        assert.equal(data.sources.length, 1);
        assert.equal(data.sources[0].url, facts.sourceUrl);
        assert.ok(data.checkedAt);
      }
    });

    await t.test("provider failure falls back in English or Japanese", async () => {
      failProvider = true;
      for (const [message, language, pattern] of [
        ["Prove linearity of expectation", "en", /couldn't produce an answer/u],
        ["期待値の線形性を証明して", "ja", /ごめんね/u],
      ]) {
        const before = requests.length;
        const data = await ask(message);
        assert.equal(requests.length, before + 1);
        assert.equal(data.language, language);
        assert.match(data.reply, pattern);
        assert.doesNotMatch(data.reply, /Provider rejected test key/u);
      }
      failProvider = false;
    });

    await t.test("absence of future seminars never substitutes the latest past talk", async () => {
      app.locals.testNow = "2030-01-01T00:00:00Z";
      const before = requests.length;
      const data = await ask("what is the next talk");
      assert.equal(requests.length, before);
      assert.equal(data.language, "en");
      assert.match(data.reply, /couldn't find any upcoming seminars/u);
      assert.doesNotMatch(data.reply, /July 27|July 27, 2026|2026年7月27日|The next seminar is on/u);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    globalThis.fetch = nativeFetch;
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
