import assert from "node:assert/strict";
import test from "node:test";
import { shouldSearchWeb, extractWebSources } from "../web-search.js";

test("research questions search for recent mathematical advances and attribution", () => {
  for (const question of [
    "recent advance of 2D critical KPZ",
    "who constructed critical KPZ process",
    "What are the latest advances in stochastic PDEs?",
    "Search for the paper constructing the critical KPZ process",
    "Find references for the central limit theorem",
    "2次元臨界KPZの最近の進展を教えて",
    "臨界KPZ過程を構成したのは誰ですか",
    "臨界KPZ過程を構成した論文を検索して",
  ]) assert.equal(shouldSearchWeb(question), true, question);
});

test("stable mathematical explanations and proofs do not request web research", () => {
  for (const question of [
    "Expand (a+b)^2",
    "Prove the quadratic formula",
    "What is a martingale?",
    "Explain the central limit theorem",
    "Solve x^2 - 4 = 0",
    "二次方程式の解の公式を証明して",
    "条件付き期待値とは何ですか",
    "Find the roots of the equation x^2-1=0",
    "Find the integral of x^2",
    "Prove the first isomorphism theorem",
    "Define a new probability space",
  ]) assert.equal(shouldSearchWeb(question), false, question);
});

test("unrelated news and attribution do not acquire web access", () => {
  for (const question of [
    "Search for the latest election news",
    "Who constructed the tallest building?",
    "What are the recent advances in smartphone cameras?",
    "最新の選挙ニュースを検索して",
    "今週の芸能ニュースを調べて",
    "最新の選挙の予想を調べて",
    "",
    null,
  ]) assert.equal(shouldSearchWeb(question), false, String(question));
});

test("seminar schedules use the official source while explicit paper searches can use web research", () => {
  for (const question of [
    "What is the next seminar schedule?",
    "Search the latest seminar schedule",
    "Recent seminar speakers",
    "次のセミナーを検索して",
    "最新のセミナー予定を教えて",
  ]) assert.equal(shouldSearchWeb(question, { seminarContext: true }), false, question);
  for (const question of [
    "search old seminar papers",
    "過去のセミナーの論文を検索して",
  ]) assert.equal(shouldSearchWeb(question, { seminarContext: true }), true, question);
});

const citation = (url, title, content) => ({
  type: "url_citation",
  url_citation: { url, title, content },
});

test("citation extraction retains actual URLs, deduplicates exact repeats, and omits source content", () => {
  const first = "https://arxiv.org/abs/2601.01234";
  const second = "http://example.org/paper.pdf";
  assert.deepEqual(extractWebSources([
    citation(first, "A mathematical paper", "Source text that must not be exposed"),
    citation(first, "A duplicate title"),
    citation(second, "Another paper"),
    { type: "other", url_citation: { url: "https://example.org/ignored" } },
  ]), [
    { url: first, title: "A mathematical paper" },
    { url: second, title: "Another paper" },
  ]);
});

test("missing titles use the verified hostname and distinct URLs remain distinct", () => {
  assert.deepEqual(extractWebSources([
    citation("https://example.org/paper?version=1#result"),
    citation("https://example.org/paper?version=2#result", ""),
  ]), [
    { url: "https://example.org/paper?version=1#result", title: "example.org" },
    { url: "https://example.org/paper?version=2#result", title: "example.org" },
  ]);
});

test("malformed, executable and credential-bearing citation URLs are rejected", () => {
  const rejected = [
    "javascript:alert(1)", "data:text/html,test", "file:///tmp/paper.pdf", "ftp://example.org/paper.pdf",
    "not a URL", "/relative-paper", "https://", "https://user:password@example.org/paper", "https://user@example.org/paper",
  ];
  assert.deepEqual(extractWebSources([
    ...rejected.map((url) => citation(url, "Invalid source")),
    { type: "url_citation", url_citation: {} },
    { type: "url_citation" },
    null,
  ]), []);
});

test("missing or non-array annotations yield no sources", () => {
  for (const annotations of [undefined, null, "[]", {}, { length: 1 }]) {
    assert.deepEqual(extractWebSources(annotations), []);
  }
});
