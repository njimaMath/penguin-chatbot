import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scrape } from "../scripts/scrape.js";
import { parseSeminarSchedule } from "../src/seminars/schedule.js";
import { getCurrentScheduleUrl, OFFICIAL_URL } from "../src/seminars/source.js";

const now = new Date("2026-11-16T01:00:00Z");
const archiveUrl = `${OFFICIAL_URL}/2019年度`;
const talk = (year, month, day, speaker) => `${year}年${month}月${day}日（月）場所: Room 122 講師: ${speaker} 氏 時間: 16:00 - 17:30 Title: Research topic Abstract: ${"A historical mathematical abstract. ".repeat(12)}`;
const history = Array.from({ length: 60 }, (_, index) => talk(2019, 4 + Math.floor(index / 20), 1 + index % 20, `Historical Speaker ${index}`)).join("\n\n");
const savedPage = (label, url, text) => `【${label}】\nURL: ${url}\n\n${text}`;
const previousText = [
  "【東京確率論セミナー スクレイプ結果】\n取得ページ数: 3",
  savedPage("Current year", getCurrentScheduleUrl(now), `今後の予定\n${talk(2026, 12, 7, "Old Speaker")}\n${talk(2026, 11, 23, "Removed Speaker")}`),
  savedPage("Home", OFFICIAL_URL, `Tokyo Probability Seminar organizers and access\n今後の予定\n${talk(2026, 11, 23, "Removed Speaker")}`),
  savedPage("Archive", archiveUrl, `今後の予定\n${history}`),
].join("\n\n");

function fixture(t) {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-weekly-"));
  fs.writeFileSync(path.join(outputDir, "data.txt"), previousText);
  const oldFreshness = '{"scrapedAtJST":"2026-06-01T00:00:00.000Z"}';
  fs.writeFileSync(path.join(outputDir, "freshness.json"), oldFreshness);
  const savedConsole = { log: console.log, error: console.error };
  console.log = console.error = () => {};
  t.after(() => {
    Object.assign(console, savedConsole);
    const resolved = path.resolve(outputDir);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith("penguin-weekly-"));
    fs.rmSync(resolved, { recursive: true });
  });
  return { outputDir, oldFreshness };
}

const currentPage = () => ({ label: "Current year", sections: ["Tokyo Probability Seminar", "今後の予定", talk(2026, 12, 7, "Updated Speaker")], links: [] });
const isCurrent = (url) => decodeURIComponent(new URL(url).pathname).endsWith("/2026年度");
const isRoot = (url) => new URL(url).pathname === new URL(OFFICIAL_URL).pathname;

test("the configured weekly cron runs on Monday at 09:15 in Tokyo", () => {
  const workflow = fs.readFileSync(new URL("../.github/workflows/daily_update.yml", import.meta.url), "utf8");
  const cron = workflow.match(/^\s*-\s*cron:\s*'([^']+)'/mu)?.[1];
  assert.ok(cron, "weekly workflow must contain a schedule");
  const [minute, hour, day, month, weekday] = cron.split(/\s+/u);
  assert.equal(day, "*");
  assert.equal(month, "*");
  const matches = [];
  for (let offset = 0; offset < 14 * 24 * 60; offset += 1) {
    const instant = new Date(Date.UTC(2026, 10, 15) + offset * 60000);
    if (instant.getUTCDay() === Number(weekday) && instant.getUTCHours() === Number(hour) && instant.getUTCMinutes() === Number(minute)) matches.push(instant);
  }
  assert.equal(matches.length, 2);
  assert.equal(matches[1] - matches[0], 7 * 24 * 60 * 60000);
  for (const instant of matches) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tokyo", weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(instant).map(({ type, value }) => [type, value]));
    assert.equal(parts.weekday, "Monday");
    assert.equal(parts.hour, "09");
    assert.equal(parts.minute, "15");
  }
  assert.match(workflow, /^\s*workflow_dispatch:/mu);
});

test("a weekly refresh updates current talks and retains an unavailable, unlinked archive", async (t) => {
  const { outputDir } = fixture(t);
  const calls = [];
  const result = await scrape({ now, outputDir, fetchPageImpl: async (url) => {
    calls.push(url);
    if (isCurrent(url)) return currentPage();
    if (isRoot(url)) return { label: "Home", sections: ["Tokyo Probability Seminar organizers and access", "今後の予定", talk(2026, 11, 23, "Removed Speaker")], links: [] };
    throw new Error("Archive temporarily unavailable");
  } });
  const updated = parseSeminarSchedule(fs.readFileSync(path.join(outputDir, "data.txt"), "utf8"));
  assert.equal(updated.filter((seminar) => seminar.year === 2019).length, 60);
  assert.equal(updated.find((seminar) => seminar.year === 2026).talks[0].speaker, "Updated Speaker");
  assert.ok(!updated.some((seminar) => seminar.talks.some((entry) => entry.speaker === "Removed Speaker")));
  assert.ok(calls.some((url) => decodeURIComponent(url).includes("2019年度")));
  assert.equal(result.retainedArchiveUrls.length, 1);
  const freshness = JSON.parse(fs.readFileSync(path.join(outputDir, "freshness.json"), "utf8"));
  assert.equal(freshness.retainedArchivePages, 1);
  assert.equal(freshness.seminarCount, 61);
  assert.equal(freshness.futureCount, 1);
  assert.equal(freshness.latestFutureDate, "2026年12月7日（月）");
  assert.ok(Number.isFinite(Date.parse(freshness.scrapedAtJST)));
});

test("an unavailable current page preserves both saved files", async (t) => {
  const { outputDir, oldFreshness } = fixture(t);
  await assert.rejects(scrape({ now, outputDir, fetchPageImpl: async () => { throw new Error("Source unavailable"); } }), /現在年度/u);
  assert.equal(fs.readFileSync(path.join(outputDir, "data.txt"), "utf8"), previousText);
  assert.equal(fs.readFileSync(path.join(outputDir, "freshness.json"), "utf8"), oldFreshness);
  assert.deepEqual(fs.readdirSync(outputDir).sort(), ["data.txt", "freshness.json"]);
});

test("a stale wrong-year source cannot be stamped as a successful current-year update", async (t) => {
  const { outputDir, oldFreshness } = fixture(t);
  await assert.rejects(scrape({ now, outputDir, fetchPageImpl: async () => ({ label: "Wrong year", sections: ["今後の予定", history], links: [] }) }), /現在年度/u);
  assert.equal(fs.readFileSync(path.join(outputDir, "data.txt"), "utf8"), previousText);
  assert.equal(fs.readFileSync(path.join(outputDir, "freshness.json"), "utf8"), oldFreshness);
});

test("a cached home-page failure cannot reintroduce a removed current-year talk", async (t) => {
  const { outputDir } = fixture(t);
  const result = await scrape({ now, outputDir, fetchPageImpl: async (url) => {
    if (isCurrent(url)) return currentPage();
    if (isRoot(url)) throw new Error("Home page unavailable");
    return { label: "Archive", sections: ["今後の予定", history], links: [] };
  } });
  assert.equal(result.seminars.length, 61);
  assert.ok(!result.seminars.some((seminar) => seminar.day === 23 && seminar.month === 11 && seminar.year === 2026));
});

test("an archive page losing its date structure reuses saved history", async (t) => {
  const { outputDir } = fixture(t);
  const result = await scrape({ now, outputDir, fetchPageImpl: async (url) => {
    if (isCurrent(url)) return currentPage();
    if (isRoot(url)) return { label: "Home", sections: ["Tokyo Probability Seminar organizers and access"], links: [] };
    return { label: "Archive", sections: ["The site layout changed and its historical dates could not be extracted."], links: [] };
  } });
  assert.equal(result.seminars.filter((seminar) => seminar.year === 2019).length, 60);
  assert.equal(result.freshness.retainedArchivePages, 1);
});
