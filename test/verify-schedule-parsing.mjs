import assert from "node:assert/strict";
import test from "node:test";
import { parseSeminarSchedule, getNextSeminar, buildCompactMemo } from "../memo.js";
import { buildIndex } from "../search.js";

const schedule = `今後の予定
2026年1 1月9日（月）
場所：東京大学大学院数理科学研究科（駒場）１２２号室
講師：三角 健太 氏
時間：16:00 - 17:30
Title: 過去の講演
Abstract:
2026年1 1月16日（月）
場所：東京大学大学院数理科学研究科（駒場）００ ２号室
講師：Federica Iacovissi 氏
時間：1 6:00 - 1 7:3 0
Title:
Abstract:
2026年12月7日（月）
場所：東京大学大学院数理科学研究科（駒場）１２２号室
講師：Raphaël Lefevere 氏
時間：16:00 - 17:30
Title: Formula $a_1 + a_2$ in 2 dimensions
Abstract: Keep $x_1 + x_2$ and spaced text unchanged.
2026年1 2月1 4日（月）
場所：東京大学大学院数理科学研究科（駒場）１２２号室
講師：佐藤 ふたば 氏
時間：16:00 - 17:30
Title:
Abstract:
`;

test("Google Sites split digits preserve upcoming dates, times and rooms", () => {
  const seminars = parseSeminarSchedule(schedule);
  assert.deepEqual(seminars.map((s) => s.dateLabel), [
    "2026年11月9日（月）", "2026年11月16日（月）", "2026年12月7日（月）", "2026年12月14日（月）",
  ]);
  assert.equal(seminars[1].talks[0].timeText, "16:00 - 17:30");
  assert.match(seminars[1].venue, /002号室/u);
  assert.equal(new Date(seminars[1].startTimestamp).toISOString(), "2026-11-16T07:00:00.000Z");
  assert.equal(new Date(seminars[1].endTimestamp).toISOString(), "2026-11-16T08:30:00.000Z");
  assert.equal(seminars[2].talks[0].title, "Formula $a_1 + a_2$ in 2 dimensions");
  assert.equal(seminars[2].talks[0].abstract, "Keep $x_1 + x_2$ and spaced text unchanged.");
});

test("next seminar follows actual JST time, including the end-time boundary", () => {
  const seminars = parseSeminarSchedule(schedule);
  const next = (iso) => getNextSeminar(seminars, new Date(iso))?.dateLabel ?? null;
  assert.equal(next("2026-11-16T15:00:00+09:00"), "2026年11月16日（月）");
  assert.equal(next("2026-11-16T17:30:00+09:00"), "2026年11月16日（月）");
  assert.equal(next("2026-11-16T17:30:00.001+09:00"), "2026年12月7日（月）");
  assert.equal(next("2026-12-07T17:31:00+09:00"), "2026年12月14日（月）");
  assert.equal(next("2026-12-14T17:31:00+09:00"), null);
});

test("memo preserves explicit rooms and keeps ended talks out of upcoming section", () => {
  const seminars = parseSeminarSchedule(schedule);
  const memo = buildCompactMemo(seminars, new Date("2026-11-16T15:00:00+09:00"));
  const upcoming = memo.split("【過去のセミナー一覧")[0];
  assert.match(upcoming, /東大駒場002号室/u);
  assert.match(upcoming, /東大駒場122号室/u);
  assert.doesNotMatch(upcoming, /126号室|2026年11月9日/u);
  const exhausted = buildCompactMemo(seminars, new Date("2027-01-01T00:00:00+09:00"));
  const nextLine = exhausted.split("\n").find((line) => line.startsWith("【次回セミナー】"));
  assert.doesNotMatch(nextLine, /2026年/u);
  assert.match(nextLine, /今後の開催予定はありません/u);
});

test("current first occurrence wins over richer stale archive duplicates", () => {
  const staleArchive = `2026年11月16日（月）
場所：東京大学大学院数理科学研究科（駒場）１２６号室
講師：Old Speaker 氏
時間：14:00 - 15:30
Title: Old title
Abstract: An old full abstract must not restore removed details.
講師：Cancelled Speaker 氏
時間：16:00 - 17:30
Title: Cancelled title
Abstract: This cancelled talk must not return.
`;
  const seminars = parseSeminarSchedule(schedule + staleArchive);
  const current = seminars.find((s) => s.month === 11 && s.day === 16);
  assert.equal(current.talks.length, 1);
  assert.equal(current.talks[0].speaker, "Federica Iacovissi");
  assert.equal(current.talks[0].title, "");
  assert.match(current.venue, /002号室/u);
});

test("date parsing accepts fullwidth digits and rejects impossible calendar dates", () => {
  const seminars = parseSeminarSchedule(`
２０２６年１１月１６日(月) 場所：駒場１２２号室 講師：A 時間：１６：００ ～ １７：３０ Title: A Abstract:
2026年2月30日（月） 講師：Invalid day 時間：16:00 - 17:30 Title: Invalid Abstract:
2026年13月1日（月） 講師：Invalid month 時間：16:00 - 17:30 Title: Invalid Abstract:
2026年*月**日（月） 講師：TBD 時間：16:00 - 17:30 Title: TBD Abstract:
`);
  assert.equal(seminars.length, 1);
  assert.equal(seminars[0].dateLabel, "2026年11月16日（月）");
  assert.equal(seminars[0].talks[0].timeText, "16:00 - 17:30");
  assert.equal(seminars._tbdCount, 3);
});

test("double headers preserve each talk's room in records, memo and search", () => {
  const seminars = parseSeminarSchedule(`今後の予定
2026年11月2日（月）
場所：東京大学大学院数理科学研究科（駒場）１５８号室
講師：Mo Dick Wong 氏
時間：14:00 - 15:30
Title: First title
Abstract: First abstract with $x_1 + x_2$.
場所：東京大学大学院数理科学研究科（駒場）１２２号室
講師：大石 皐遥 氏
時間：16:00 - 17:30
Title: Second title
Abstract: Second abstract with its original content.
`);
  assert.equal(seminars.length, 1);
  assert.equal(seminars[0].isDoubleHeader, true);
  assert.match(seminars[0].venue, /158号室/u);
  assert.deepEqual(seminars[0].talks.map((talk) => talk.venue.match(/\d+号室/u)[0]), ["158号室", "122号室"]);
  assert.deepEqual(seminars[0].talks.map((talk) => talk.title), ["First title", "Second title"]);
  assert.deepEqual(seminars[0].talks.map((talk) => talk.abstract), [
    "First abstract with $x_1 + x_2$.", "Second abstract with its original content.",
  ]);
  const memo = buildCompactMemo(seminars, new Date("2026-11-01T00:00:00Z"));
  assert.match(memo, /Mo Dick Wong 会場:東大駒場158号室/u);
  assert.match(memo, /大石 皐遥 会場:東大駒場122号室/u);
  const index = buildIndex(seminars);
  assert.deepEqual(index.docs.map((doc) => doc.venue.match(/\d+号室/u)[0]), ["158号室", "122号室"]);
});
