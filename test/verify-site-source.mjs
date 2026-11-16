import assert from "node:assert/strict";
import test from "node:test";
import * as cheerio from "cheerio";
import { parseSeminarSchedule } from "../memo.js";
import {
  OFFICIAL_URL, getCurrentScheduleUrl, extractSections,
  fetchCurrentSchedule, mergeCurrentSchedule,
} from "../site-source.js";

const now = new Date("2026-11-16T01:00:00Z");
const talk = (date, speaker, venue = "東京大学数理科学研究科122号室") => (
  `${date}（月）場所：${venue} 講師：${speaker} 氏 時間：16:00 - 17:30 Title: Seminar Abstract:`
);
const html = (content) => `<nav>2030年5月6日（月）</nav><section>今後の予定 ${content}</section>`;
const response = (body) => ({ ok: true, status: 200, text: async () => body });

test("academic year changes on April 1 in Tokyo", () => {
  for (const [instant, year] of [
    ["2026-11-16T00:00:00Z", 2026],
    ["2027-01-01T00:00:00Z", 2026],
    ["2027-03-31T14:59:59Z", 2026],
    ["2027-03-31T15:00:00Z", 2027],
  ]) {
    assert.equal(getCurrentScheduleUrl(new Date(instant)), `${OFFICIAL_URL}/${year}年度`);
  }
});

test("content extraction excludes navigation when Google Sites sections exist", () => {
  const sections = extractSections(cheerio.load(html(talk("2026年11月16日", "Current Speaker"))));
  assert.equal(sections.length, 1);
  assert.ok(sections[0].includes("Current Speaker"));
  assert.ok(!sections[0].includes("2030年"));
  assert.deepEqual(extractSections(cheerio.load("<body> Plain page without section markup </body>")),
    ["Plain page without section markup"]);
  assert.deepEqual(extractSections(cheerio.load("<body>Useful seminar information<script>Hidden script</script><footer>Footer noise</footer><nav>Navigation noise</nav></body>")),
    ["Useful seminar information"]);
});

test("site information retains venue and organizer context with safe source links", async () => {
  const result = await fetchCurrentSchedule(now, {
    fetchImpl: async () => response(`<nav><a href="https://navigation.example/">Navigation</a></nav>
      <section>東京確率論セミナー 場所: 駒場キャンパス122号室 幹事: Example Organizer
        <a href="https://www.ms.u-tokyo.ac.jp/access/">会場へのアクセス</a>
        <a href="/view/tokyo-probability-seminar23/contact">連絡先</a>
        <a href="javascript:alert(1)">Unsafe link</a>
      </section>
      <section>今後の予定 ${talk("2026年11月16日", "Current Speaker")}
        <a href="https://www.ms.u-tokyo.ac.jp/access/">会場へのアクセス</a>
      </section>`),
  });
  assert.match(result.siteInfo, /駒場キャンパス122号室/u);
  assert.match(result.siteInfo, /Example Organizer/u);
  assert.match(result.siteInfo, /https:\/\/www\.ms\.u-tokyo\.ac\.jp\/access\//u);
  assert.match(result.siteInfo, /https:\/\/sites\.google\.com\/view\/tokyo-probability-seminar23\/contact/u);
  assert.doesNotMatch(result.siteInfo, /navigation\.example|javascript:/u);
  assert.equal(result.siteInfo.match(/https:\/\/www\.ms\.u-tokyo\.ac\.jp\/access\//gu).length, 1);
  assert.ok(result.siteInfo.length <= 12000);
});

test("fetches the current source and returns its parsed year with the actual check time", async () => {
  const started = Date.now();
  const result = await fetchCurrentSchedule(now, {
    fetchImpl: async (url, options) => {
      assert.equal(url, `${OFFICIAL_URL}/2026年度`);
      assert.ok(options.signal instanceof AbortSignal);
      return response(html([
        talk("2026年11月16日", "Current Speaker"),
        talk("2027年2月1日", "Winter Speaker"),
        talk("2025年11月17日", "Wrong Year"),
      ].join(" ")));
    },
  });
  assert.deepEqual(result.seminars.map((seminar) => seminar.talks[0].speaker), ["Current Speaker", "Winter Speaker"]);
  assert.equal(result.sourceUrl, `${OFFICIAL_URL}/2026年度`);
  assert.ok(result.checkedAt.getTime() >= started && result.checkedAt.getTime() <= Date.now());
});

test("fresh current-year data replaces stale dates including deletions, preserving history", async () => {
  const stored = parseSeminarSchedule([
    talk("2025年11月17日", "Historical Speaker"),
    talk("2026年11月16日", "Old Speaker", "東京大学数理科学研究科126号室"),
    talk("2026年11月23日", "Removed Speaker"),
    talk("2027年2月1日", "Removed Winter Speaker"),
  ].join("\n"));
  stored._tbdCount = 8;
  const fresh = await fetchCurrentSchedule(now, {
    fetchImpl: async () => response(html(talk("2026年11月16日", "Current Speaker"))),
  });
  const merged = mergeCurrentSchedule(stored, fresh.seminars, now);
  assert.deepEqual(merged.map((seminar) => seminar.talks[0].speaker), ["Historical Speaker", "Current Speaker"]);
  assert.ok(merged[1].venue.includes("122号室"));
  assert.equal(merged._tbdCount, 0);
  assert.equal(stored.length, 4);
});

test("invalid or failed source never becomes a successful refresh", async () => {
  for (const fetchImpl of [
    async () => ({ ok: false, status: 503, text: async () => "unavailable" }),
    async () => response(""),
    async () => response("<section>今後の予定は現在ありません。</section>"),
    async () => response(html(talk("2025年11月17日", "Wrong Year"))),
    async () => { throw new TypeError("Network unavailable"); },
  ]) {
    await assert.rejects(fetchCurrentSchedule(now, { fetchImpl }));
  }
});

test("source timeout includes reading the page body", { timeout: 1000 }, async () => {
  let aborted = false;
  await assert.rejects(fetchCurrentSchedule(now, {
    timeoutMs: 20,
    fetchImpl: async (_url, { signal }) => ({
      ok: true,
      status: 200,
      text: () => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("Timed out", "AbortError"));
        }, { once: true });
      }),
    }),
  }), { name: "AbortError" });
  assert.equal(aborted, true);
});
