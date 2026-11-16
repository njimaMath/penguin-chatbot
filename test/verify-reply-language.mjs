import assert from "node:assert/strict";
import test from "node:test";
import { detectReplyLanguage, getTokyoNowParts, buildCurrentDateTimeReply, buildNextSeminarReply } from "../reply-language.js";

const current = {
  year: 2026, month: 11, day: 16, dateLabel: "2026年11月16日（月）",
  venue: "東京大学（駒場）002号室", isDoubleHeader: false,
  talks: [{ speaker: "Federica Iacovissi", timeText: "16:00 - 17:30", title: "" }],
};
const sourceUrl = "https://example.com/official-schedule";

test("detects question language while preserving English questions with Kanji names", () => {
  for (const question of [
    "What is the next talk?", "When is 白石大典 speaking?", "Please prove 確率収束 implies this result.",
    "佐藤's talk", "Where is 西早稲田キャンパス?", "When is 佐藤 ふたば speaking?", "What is パーコレーション?",
    "P(A ∪ B) = ?", "$x^2 + y^2$", "",
  ]) assert.equal(detectReplyLanguage(question), "en", question);
  for (const question of [
    "次のセミナーは？", "Federica Iacovissi の講演はいつですか？", "確率収束", "現在時刻", "証明 E[X+Y]=E[X]+E[Y]",
  ]) assert.equal(detectReplyLanguage(question), "ja", question);
});

test("current date and time use JST across the midnight boundary in either language", () => {
  const instant = new Date("2026-11-16T15:05:00Z");
  assert.deepEqual(getTokyoNowParts(instant), {
    year: 2026, month: 11, day: 17, weekday: "火", hour: "00", minute: "05", second: "00",
  });
  for (const question of ["What time is it?", "what is today's date", "what day is it", "current date and time"]) {
    const reply = buildCurrentDateTimeReply(question, instant);
    assert.match(reply, /00:05 JST/u);
    assert.match(reply, /Tuesday, November 17, 2026/u);
    assert.doesNotMatch(reply, /日本時間|なの|だよ/u);
  }
  for (const question of ["今何時？", "今日何日？", "今日は何曜日？", "今日の日付と今の時間を教えて"]) {
    const reply = buildCurrentDateTimeReply(question, instant);
    assert.match(reply, /2026年11月17日（火）/u);
    assert.match(reply, /00:05/u);
    assert.match(reply, /日本時間/u);
  }
});

test("seminar times and mathematical questions do not become current-time answers", () => {
  for (const question of [
    "What time is the next talk?", "What day is the next seminar?", "6月22日のセミナーは何時？",
    "次回の予定", "Prove the central limit theorem", "確率収束について教えて",
  ]) assert.equal(buildCurrentDateTimeReply(question), null, question);
});

test("upcoming replies match the question language and report missing titles", () => {
  const english = buildNextSeminarReply(current, { language: "en" });
  assert.match(english, /Monday, November 16, 2026/u);
  assert.match(english, /16:00 - 17:30 JST/u);
  assert.match(english, /Federica Iacovissi/u);
  assert.match(english, /University of Tokyo, Komaba Campus, Room 002/u);
  assert.match(english, /title hasn't been announced/u);
  const japanese = buildNextSeminarReply(current, { language: "ja" });
  assert.match(japanese, /次のセミナーは2026年11月16日（月）/u);
  assert.match(japanese, /東京大学（駒場）002号室/u);
  assert.match(japanese, /タイトルはまだ未掲載/u);
  const titled = buildNextSeminarReply({ ...current, talks: [{ ...current.talks[0], title: "Stable heat kernels" }] }, { language: "en" });
  assert.match(titled, /The title is "Stable heat kernels"/u);
});

test("English venue descriptions preserve room numbers and unknown official names", () => {
  for (const venue of ["東大駒場122号室", "東京大学大学院数理科学研究科１２２号室", "駒場１２ ２号室"]) {
    const reply = buildNextSeminarReply({ ...current, venue }, { language: "en" });
    assert.match(reply, /University of Tokyo, Komaba Campus, Room 122/u);
  }
  const venue = "早稲田大学西早稲田キャンパス51号館18-06";
  const reply = buildNextSeminarReply({ ...current, venue }, { language: "en" });
  assert.ok(reply.includes(venue));
});

test("no-upcoming replies and stale data warnings point to the official source", () => {
  for (const language of ["en", "ja"]) {
    const empty = buildNextSeminarReply(null, { language, sourceUrl });
    assert.ok(empty.includes(sourceUrl));
    assert.match(empty, language === "en" ? /couldn't find any upcoming seminars/u : /今後の開催予定が見当たらなかった/u);
    const stale = buildNextSeminarReply(current, { language, sourceUrl, isStale: true, dataAsOf: "2026年6月1日" });
    assert.ok(stale.includes(sourceUrl));
    assert.match(stale, language === "en" ? /June 1, 2026/u : /2026年6月1日/u);
    assert.match(stale, language === "en" ? /couldn't confirm the latest schedule/u : /最新の予定を確認できなかった/u);
    const staleEmpty = buildNextSeminarReply(null, { language, sourceUrl, isStale: true });
    assert.match(staleEmpty, language === "en" ? /upcoming seminars/u : /今後の開催予定/u);
    assert.ok(staleEmpty.includes(sourceUrl));
  }
});

test("double headers retain each speaker, time and title in localized replies", () => {
  const double = { ...current, isDoubleHeader: true, talks: [
    { speaker: "Speaker A", timeText: "14:00 - 15:30", title: "First title" },
    { speaker: "Speaker B", timeText: "16:00 - 17:30", title: "Second title" },
  ] };
  for (const language of ["en", "ja"]) {
    const reply = buildNextSeminarReply(double, { language });
    for (const value of ["Speaker A", "Speaker B", "14:00 - 15:30", "16:00 - 17:30", "First title", "Second title"]) {
      assert.ok(reply.includes(value), `${language}: ${value}`);
    }
    assert.match(reply, language === "en" ? /double header/u : /ダブルヘッダー/u);
  }
});

test("double headers show individual rooms when the venue changes between talks", () => {
  const double = { ...current, venue: "東大駒場158号室", isDoubleHeader: true, talks: [
    { speaker: "Speaker A", timeText: "14:00 - 15:30", title: "First title", venue: "東大駒場158号室" },
    { speaker: "Speaker B", timeText: "16:00 - 17:30", title: "Second title", venue: "東大駒場122号室" },
  ] };
  const english = buildNextSeminarReply(double, { language: "en" });
  assert.match(english, /Speaker A \(14:00 - 15:30 JST, at University of Tokyo, Komaba Campus, Room 158\)/u);
  assert.match(english, /Speaker B \(16:00 - 17:30 JST, at University of Tokyo, Komaba Campus, Room 122\)/u);
  const japanese = buildNextSeminarReply(double, { language: "ja" });
  assert.match(japanese, /14:00 - 15:30、会場は東大駒場158号室で、Speaker A/u);
  assert.match(japanese, /16:00 - 17:30、会場は東大駒場122号室で、Speaker B/u);
});
