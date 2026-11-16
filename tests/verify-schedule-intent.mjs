import assert from "node:assert/strict";
import test from "node:test";
import { isNextSeminarQuestion } from "../src/seminars/intent.js";

test("generic upcoming schedule questions use the deterministic route in both languages", () => {
  const questions = [
    "what is the next talk",
    "search the next schedule",
    "What is the next seminar?",
    "Can you please show me the latest seminar schedule?",
    "Tell me about the next talk.",
    "upcoming talks",
    "new seminar schedule",
    "recent seminar schedule",
    "latest schedule",
    "schedule",
    "Show me the schedule for upcoming seminars",
    "next seminar please!",
    "次のセミナーは？",
    "次回のセミナーを教えて",
    "次回",
    "今後の予定を教えて",
    "次の予定",
    "セミナー予定",
    "セミナーの予定",
    "次の講演",
    "直近のセミナー",
    "最新の予定を教えてください",
    "新しい日程",
    "これからのセミナー",
    "直近の予定",
    "次はいつ？",
    "次のセミナーの会場はどこですか？",
  ];
  for (const question of questions) {
    assert.equal(isNextSeminarQuestion(question), true, question);
  }
});

test("past, specific date, speaker, venue and research questions keep the full lookup", () => {
  const questions = [
    "please tell me about recent progress on 2d critical kpz",
    "next seminar about KPZ",
    "What is the next seminar on random walks?",
    "when is Professor X next speaking",
    "Show me Shiraishi's next seminar schedule",
    "upcoming seminars at Waseda",
    "schedule for June 22",
    "Show me the 2025 seminar schedule",
    "previous schedule",
    "What was the last talk?",
    "recent talks",
    "latest talk",
    "What is the abstract of the next talk?",
    "白石先生の次回の講演",
    "6月22日の予定",
    "2025年のセミナー予定",
    "過去の予定を教えて",
    "前回のセミナーは？",
    "次のセミナーでKPZの話はありますか？",
    "早稲田大学の今後の予定",
    "次のセミナーの要旨を教えて",
    "次回の講演の内容を説明して",
    "こんにちは",
    "",
    null,
  ];
  for (const question of questions) {
    assert.equal(isNextSeminarQuestion(question), false, String(question));
  }
});
