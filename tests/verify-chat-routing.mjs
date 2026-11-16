import assert from "node:assert/strict";
import test from "node:test";
import { needsSeminarContext, needsPeopleContext } from "../src/chat/routing.js";

const index = { docs: [
  { speaker: "Raphaël Lefevere" },
  { speaker: "佐藤 ふたば" },
  { speaker: "中島 秀太" },
  { speaker: "Mo Dick Wong 氏 (private seminar)" },
] };

test("seminar routing retains schedules, known speakers, venue access and history", () => {
  for (const message of [
    "What is the next seminar?", "What is the history of TPS?", "How do I get to Komaba?", "website", "Check the official website", "Any website updates?",
    "Which station is closest to the seminar venue?", "Search Waseda campus access information",
    "When is Lefevere speaking?", "Where is Raphaël Lefevere presenting?",
    "佐藤ふたば先生の講演はいつですか", "中島秀太先生の講演会場は？", "会場の最寄り駅を教えて",
    "Previous topic: What is the next seminar?\nCurrent question: what about its location?",
  ]) assert.equal(needsSeminarContext(message, index), true, message);
  for (const message of [
    "Explain conditional expectation", "Please talk about martingales", "Explain transport equations",
    "Who constructed the critical KPZ process?", "What is algebra?", "What is Terence Tao’s website?", "What is Terence Tao's official website?",
  ]) assert.equal(needsSeminarContext(message, index), false, message);
});

test("known English and Japanese speakers support professional profile and affiliation lookups", () => {
  for (const message of [
    "Who is Raphaël Lefevere?", "Tell me about Lefevere", "Where does Lefevere work?",
    "What is Raphaël Lefevere's research?", "Search Mo Dick Wong's publications",
    "佐藤ふたば先生の所属は？", "中島秀太について教えて", "佐藤先生はどの大学に勤めていますか",
  ]) assert.equal(needsPeopleContext(message, index), true, message);
  assert.equal(needsPeopleContext("What is Cloverlefevere's research?", index), false);
});

test("structured unknown academic candidates can be looked up without a fixed name registry", () => {
  for (const message of [
    "Who is Terence Tao?", "who is terence tao?", "Tell me about Terence Tao", "tell me about terence tao",
    "What is Terence Tao's affiliation?", "Where does Jane Doe work?", "Jane Doe research",
    "Search Terence Tao", "look up terence tao", "Search Terence Tao's research", "What is Terence Tao’s website?",
    "What is Terence Tao's current position?", "Terence Tao website",
    "Who is Professor Jane Doe?", "Who is the mathematician Jane Doe?",
    "Tell me about this probabilist's publications", "山田太郎の所属を調べて", "山田太郎は誰ですか",
  ]) assert.equal(needsPeopleContext(message, index), true, message);
});

test("mathematical objects, attribution questions and routine proofs are not person names", () => {
  for (const message of [
    "Who constructed the critical KPZ process?", "Who proved the central limit theorem?",
    "Who is the next speaker?", "Who is Brownian motion?", "Tell me about conditional expectation",
    "Explain professor appointments in general", "Prove the quadratic formula", "What is a professor?",
    "臨界KPZ過程を構成したのは誰ですか", "確率過程を構成したのは誰ですか", "Search eigenvalue statistics", "Search random walks",
  ]) assert.equal(needsPeopleContext(message, index), false, message);
});

test("followups can retain a named academic subject without inheriting unrelated scope", () => {
  for (const message of [
    "Previous topic: Who is Terence Tao?\nCurrent question: what is his affiliation?",
    "Previous topic: Tell me about Raphaël Lefevere\nCurrent question: what did he prove?",
    "Previous topic: What is the next seminar?\nCurrent question: What is his current affiliation?",
    "Previous topic: What is the next seminar?\nCurrent question: Where does he work?",
    "Tell me about the seminar organizer", "What is this participant's research?", "次の講師の所属は？",
  ]) assert.equal(needsPeopleContext(message, index), true, message);
  const unrelated = "Previous topic: Who is Terence Tao?\nCurrent question: search the latest election news";
  assert.equal(needsPeopleContext(unrelated, index), false);
  assert.equal(needsSeminarContext(unrelated, index), false);
});

test("explicit celebrity, political and private requests never enable people or seminar lookup", () => {
  for (const message of [
    "Who is this celebrity?", "Search the politician's research", "Who is the actor Jane Doe?",
    "Find Lefevere's private email address", "What is the speaker's home address?", "Who is his girlfriend?",
    "佐藤先生の携帯電話を調べて", "数学者の家族について教えて", "最新の選挙の予想を調べて",
  ]) {
    assert.equal(needsPeopleContext(message, index), false, message);
    assert.equal(needsSeminarContext(message, index), false, message);
  }
});
