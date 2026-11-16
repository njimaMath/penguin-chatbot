import assert from "node:assert/strict";
import test from "node:test";
import { shouldSearchWeb, extractWebSources } from "../src/chat/web-search.js";

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
    "Search the seminar history",
    "セミナーについて検索して",
  ]) assert.equal(shouldSearchWeb(question, { seminarContext: true }), true, question);
});

test("academic-person lookup context permits checking identity and professional profiles", () => {
  for (const [question, options] of [
    ["Who is Terence Tao?", { peopleContext: true }],
    ["Search Terence Tao", { peopleContext: true }],
    ["look up terence tao", { peopleContext: true }],
    ["What is Terence Tao’s website?", { peopleContext: true }],
    ["What is Terence Tao's current position?", { peopleContext: true }],
    ["Who is an unverified academic person?", { peopleContext: true }],
    ["Where does the known speaker work?", { peopleContext: true, seminarContext: true }],
    ["What is her current affiliation?", { peopleContext: true }],
    ["Search this seminar organizer's publications", { peopleContext: true, seminarContext: true }],
    ["Who is mathematician Jane Doe?", {}],
    ["Which university employs this probability professor?", {}],
    ["数学者の山田氏の所属を調べて", {}],
    ["この講師の研究分野は何ですか", { peopleContext: true, seminarContext: true }],
    ["What is his current affiliation?", { seminarContext: true, context: "What is the next seminar?" }],
    ["Where does the next speaker work?", { seminarContext: true }],
    ["Tell me about the seminar organizer", { seminarContext: true }],
  ]) assert.equal(shouldSearchWeb(question, options), true, question);
  assert.equal(shouldSearchWeb("Who is an arbitrary unknown person?"), false);
});

test("seminar access lookups can use primary pages without searching generic next schedules", () => {
  for (const [question, options] of [
    ["Search the seminar venue access directions", { seminarContext: true }],
    ["How do I get from Komaba station to the seminar venue?", { seminarContext: true }],
    ["How do I get to Komaba?", { seminarContext: true }],
    ["Which bus goes to the campus?", { seminarContext: true }],
    ["会場への行き方を調べて", { seminarContext: true }],
    ["What is the venue address?", { seminarContext: true, seminarFactsMissing: true }],
    ["会場の入口はどこですか", { seminarContext: true, seminarFactsMissing: true }],
  ]) assert.equal(shouldSearchWeb(question, options), true, question);
  for (const question of ["What is the next seminar schedule?", "最新のセミナー予定を教えて"]) {
    assert.equal(shouldSearchWeb(question, { seminarContext: true, seminarFactsMissing: true }), false, question);
  }
  assert.equal(shouldSearchWeb("What is the venue address?", { seminarContext: true }), false);
});

test("people and seminar context never authorize unrelated profiles or private information", () => {
  for (const question of [
    "Search the celebrity's biography", "Search this politician's affiliation", "最新の選挙の予想を調べて",
    "Find the mathematician's private email address", "What is the speaker's home address?", "Who is his girlfriend?",
    "講師の携帯電話を調べて", "数学者の家族について調べて",
  ]) assert.equal(shouldSearchWeb(question, { peopleContext: true, seminarContext: true }), false, question);
  assert.equal(shouldSearchWeb("Prove the quadratic formula", { peopleContext: true }), false);
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
