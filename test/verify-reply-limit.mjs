import assert from "node:assert/strict";
import test from "node:test";
import { MAX_REPLY_WORDS, limitReplyWords, wordCount } from "../reply-limit.js";

test("English replies default to 100 words without another model request", () => {
  assert.equal(MAX_REPLY_WORDS, 100);
  const long = Array.from({ length: 250 }, (_, index) => `word${index}`).join(" ");
  const limited = limitReplyWords(long);
  assert.equal(wordCount(limited), 100);
  assert.ok(limited.endsWith("…"));
});

test("Japanese replies count word segments rather than requiring spaces", () => {
  const long = "確率変数の期待値を計算します。".repeat(80);
  assert.ok(wordCount(long, "ja") > 100);
  const limited = limitReplyWords(long, "ja");
  assert.equal(wordCount(limited, "ja"), 100);
  assert.ok(limited.endsWith("…"));
});

test("short and exactly bounded replies remain unchanged", () => {
  for (const text of ["", "A short answer with $x+y$.", "  短い回答です。\n", "hello ".repeat(100)]) {
    assert.equal(limitReplyWords(text), text);
  }
  assert.equal(wordCount(null), 0);
  assert.equal(limitReplyWords(undefined), "");
  assert.equal(limitReplyWords(null), "");
});

test("truncation backs up before an inline or display formula", () => {
  for (const delimiter of ["$", "$$"]) {
    const prefix = "A useful explanation. ";
    const long = prefix + delimiter + "x + ".repeat(220) + "y" + delimiter;
    const limited = limitReplyWords(long);
    assert.equal(limited, prefix.trimEnd() + "…");
    assert.ok(!limited.includes("$"));
    assert.ok(wordCount(limited) <= 100);
  }
});

test("short replies with a token-cutoff inline formula remove the incomplete math", () => {
  const limited = limitReplyWords("Here is the explanation. $x+y");
  assert.equal(limited, "Here is the explanation.…");
  assert.ok(!limited.includes("$"));
});

test("short replies with a token-cutoff display formula remove the incomplete math", () => {
  const limited = limitReplyWords("The result follows from this identity:\n$$x+y=z");
  assert.equal(limited, "The result follows from this identity:…");
  assert.ok(!limited.includes("$"));
});

test("complete formulas stay balanced and escaped dollars do not start math", () => {
  const prefix = "This gives $$x+y$$. ";
  const limited = limitReplyWords(prefix + "word ".repeat(220));
  assert.ok(limited.startsWith(prefix));
  assert.equal(limited.match(/\$\$/gu).length, 2);
  assert.equal(wordCount(limited), 100);
  const escaped = limitReplyWords("The price is \\$5. " + "word ".repeat(220));
  assert.ok(escaped.startsWith("The price is \\$5."));
  assert.equal(wordCount(escaped), 100);
});

test("a formula larger than the limit still produces a short nonempty reply", () => {
  for (const language of ["en", "ja"]) {
    const limited = limitReplyWords("$$" + "x + ".repeat(220) + "y$$", language);
    assert.ok(limited.trim());
    assert.ok(!limited.includes("$"));
    assert.ok(wordCount(limited, language) <= 100);
  }
});
