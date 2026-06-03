// LLM非依存: パーサ/メモの不変条件を実データ(data.txt)で検証する。
import fs from "fs";
import { parseSeminarSchedule, buildCompactMemo } from "../memo.js";
import { buildIndex } from "../search.js";

const text = fs.readFileSync(new URL("../data.txt", import.meta.url), "utf-8");
const seminars = parseSeminarSchedule(text);
const allTalks = seminars.flatMap((s) => s.talks);
const NOW = new Date("2026-06-01T01:00:00Z");
const memo = buildCompactMemo(seminars, NOW, { dataAsOf: "2026年6月1日", isStale: false });
const index = buildIndex(seminars);

let pass = 0;
let fail = 0;
const check = (name, cond) => {
  if (cond) { pass += 1; console.log("  ok -", name); }
  else { fail += 1; console.error("  NG -", name); }
};

check("セミナー件数 >= 100", seminars.length >= 100);
check("NaN timestamp が0件", seminars.every((s) => Number.isFinite(s.startTimestamp) && Number.isFinite(s.endTimestamp)));
check("講師フィールド最大長 < 80 (bleed無し)", allTalks.every((t) => (t.speaker || "").length < 80));
check("タイトル最大長 < 300 (英文要旨のtitle混入無し)", allTalks.every((t) => (t.title || "").length < 300));
check("会場に http を含まない", seminars.every((s) => !/https?:/.test(s.venue)));
check("abstract保有 talk >= 140件", allTalks.filter((t) => t.abstract).length >= 140);
check("2026/1/26 が1件にdedup", seminars.filter((s) => s.year === 2026 && s.month === 1 && s.day === 26).length === 1);
check("メモに【今後の予定】と【過去のセミナー一覧】がある", memo.includes("【今後の予定】") && memo.includes("【過去のセミナー一覧"));
const abstractLeak = allTalks.some((t) => t.abstract && t.abstract.length > 40 && memo.includes(t.abstract.slice(0, 40)));
check("メモに英文Abstract本文が混入しない", !abstractLeak);
check("検索index corpus(要旨保有) >= 140", index.corpus.length >= 140);

console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
