// LLM非依存: 「次回」決定論ロジックを検証する(過去を未来と言わない=最重要GO基準)。
import fs from "fs";
import { parseSeminarSchedule, getNextSeminar } from "../memo.js";

const text = fs.readFileSync(new URL("../data.txt", import.meta.url), "utf-8");
const seminars = parseSeminarSchedule(text);

let fail = 0;
const check = (name, cond) => {
  if (cond) console.log("  ok -", name);
  else { console.error("  NG -", name); fail += 1; }
};

const now = new Date("2026-06-01T01:00:00Z");
const next = getNextSeminar(seminars, now);
check("2026-06-01時点で次回が存在する", Boolean(next));
check("次回は未来である (endTimestamp >= now)", next && next.endTimestamp >= now.getTime());
check("次回は最古の未来回である", next && !seminars.some((s) => s.endTimestamp >= now.getTime() && s.startTimestamp < next.startTimestamp));
console.log("    → 次回:", next ? `${next.dateLabel} ${next.talks[0]?.speaker}` : "なし");

const farFuture = new Date("2030-01-01T00:00:00Z");
check("遠い未来時点では次回なし(null=棄権し公式サイト誘導)", getNextSeminar(seminars, farFuture) === null);

console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"}: ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
