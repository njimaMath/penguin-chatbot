import assert from "node:assert/strict";
import test from "node:test";
import { createScheduleStore } from "../src/seminars/store.js";

const NOW = new Date("2026-11-16T01:00:00Z");
const later = (milliseconds) => new Date(NOW.getTime() + milliseconds);
const OLD_CHECK = new Date("2026-06-01T01:00:00Z");
const SOURCE_URL = "https://sites.google.com/view/tokyo-probability-seminar23/2026年度";
const seminar = (year, month, day, speaker) => ({
  year, month, day, speaker,
  dateLabel: `${year}年${month}月${day}日`,
  startTimestamp: Date.UTC(year, month - 1, day, 7, 0),
  endTimestamp: Date.UTC(year, month - 1, day, 8, 30),
});
const latest = (checkedAt = NOW) => ({
  seminars: [seminar(2026, 12, 7, "Current Speaker")],
  sourceUrl: SOURCE_URL,
  checkedAt,
});

test("stale snapshots refresh current academic year while removed talks stay removed", async () => {
  const stored = [
    seminar(2025, 11, 17, "Historical Speaker"),
    seminar(2026, 11, 16, "Old Speaker"),
    seminar(2026, 11, 23, "Removed Speaker"),
    seminar(2027, 2, 1, "Removed Winter Speaker"),
  ];
  let calls = 0;
  const result = latest();
  const store = createScheduleStore({
    seminars: stored,
    freshnessDate: OLD_CHECK,
    refresh: async (now) => {
      calls += 1;
      assert.equal(now.getTime(), NOW.getTime());
      return result;
    },
  });
  const before = store.getSnapshot();
  const after = await store.refreshIfNeeded(NOW);
  assert.equal(calls, 1);
  assert.equal(after, store.getSnapshot());
  assert.notEqual(after, before);
  assert.deepEqual(after.seminars.map((item) => item.speaker), ["Historical Speaker", "Current Speaker"]);
  assert.equal(after.freshnessDate, result.checkedAt);
  assert.equal(after.sourceUrl, SOURCE_URL);
  assert.equal(stored.length, 4);
  assert.equal(before.freshnessDate, OLD_CHECK);
});

test("fresh successful snapshots skip fetching until the hourly boundary", async () => {
  let calls = 0;
  const store = createScheduleStore({
    seminars: latest().seminars,
    freshnessDate: NOW,
    refresh: async (now) => { calls += 1; return latest(now); },
  });
  const before = store.getSnapshot();
  assert.equal(await store.refreshIfNeeded(NOW), before);
  assert.equal(await store.refreshIfNeeded(later(60 * 60 * 1000 - 1)), before);
  assert.equal(calls, 0);
  const refreshed = await store.refreshIfNeeded(later(60 * 60 * 1000));
  assert.equal(calls, 1);
  assert.notEqual(refreshed, before);
  assert.equal(await store.refreshIfNeeded(later(60 * 60 * 1000 + 1)), refreshed);
  assert.equal(calls, 1);
});

test("concurrent refreshes, including forced requests, share one fetch and snapshot", async () => {
  let calls = 0;
  let complete;
  const pending = new Promise((resolve) => { complete = resolve; });
  const store = createScheduleStore({
    seminars: [],
    freshnessDate: OLD_CHECK,
    refresh: () => { calls += 1; return pending; },
  });
  const first = store.refreshIfNeeded(NOW);
  const second = store.refreshIfNeeded(NOW);
  const forced = store.refreshIfNeeded(NOW, { force: true });
  assert.equal(calls, 1);
  complete(latest());
  const snapshots = await Promise.all([first, second, forced]);
  assert.equal(calls, 1);
  assert.ok(snapshots.every((snapshot) => snapshot === store.getSnapshot()));
  assert.equal(snapshots[0].freshnessDate, NOW);
});

test("failed refresh preserves data and retries only after one minute", async () => {
  let calls = 0;
  const store = createScheduleStore({
    seminars: [seminar(2026, 11, 16, "Stored Speaker")],
    freshnessDate: OLD_CHECK,
    refresh: async (now) => {
      calls += 1;
      if (calls === 1) throw new Error("Source unavailable");
      return latest(now);
    },
  });
  const before = store.getSnapshot();
  await assert.rejects(store.refreshIfNeeded(NOW), /Source unavailable/u);
  assert.equal(store.getSnapshot(), before);
  assert.equal(await store.refreshIfNeeded(later(60 * 1000 - 1)), before);
  assert.equal(calls, 1);
  const after = await store.refreshIfNeeded(later(60 * 1000));
  assert.equal(calls, 2);
  assert.notEqual(after, before);
  assert.equal(after.seminars[0].speaker, "Current Speaker");
});

test("forced requests bypass the successful snapshot cache", async () => {
  let calls = 0;
  const store = createScheduleStore({
    seminars: latest().seminars,
    freshnessDate: NOW,
    refresh: async (now) => { calls += 1; return latest(now); },
  });
  const before = store.getSnapshot();
  assert.equal(await store.refreshIfNeeded(later(1)), before);
  assert.equal(calls, 0);
  const forced = await store.refreshIfNeeded(later(2), { force: true });
  assert.equal(calls, 1);
  assert.notEqual(forced, before);
  assert.equal(forced.freshnessDate.getTime(), later(2).getTime());
  assert.equal(await store.refreshIfNeeded(later(3)), forced);
  assert.equal(calls, 1);
});

test("forced requests still observe failure cooldown even with a fresh old snapshot", async () => {
  let calls = 0;
  const store = createScheduleStore({
    seminars: latest().seminars,
    freshnessDate: NOW,
    refresh: async (now) => {
      calls += 1;
      if (calls === 1) throw new Error("Source unavailable");
      return latest(now);
    },
  });
  const before = store.getSnapshot();
  await assert.rejects(store.refreshIfNeeded(NOW, { force: true }), /Source unavailable/u);
  assert.equal(store.getSnapshot(), before);
  assert.equal(await store.refreshIfNeeded(later(60 * 1000 - 1), { force: true }), before);
  assert.equal(calls, 1);
  const after = await store.refreshIfNeeded(later(60 * 1000), { force: true });
  assert.equal(calls, 2);
  assert.notEqual(after, before);
});

test("failed forced refresh exposes error metadata and normal reads retry after cooldown", async () => {
  let calls = 0;
  const store = createScheduleStore({
    seminars: latest().seminars,
    freshnessDate: NOW,
    refresh: async (now) => {
      calls += 1;
      if (calls === 1) throw new Error("Source unavailable");
      return latest(now);
    },
  });
  assert.equal(store.hasRefreshError(), false);
  const before = store.getSnapshot();
  await assert.rejects(store.refreshIfNeeded(NOW, { force: true }), /Source unavailable/u);
  assert.equal(store.hasRefreshError(), true);
  assert.equal(store.getSnapshot(), before);
  assert.equal(await store.refreshIfNeeded(later(60 * 1000 - 1)), before);
  assert.equal(store.hasRefreshError(), true);
  assert.equal(calls, 1);
  const after = await store.refreshIfNeeded(later(60 * 1000));
  assert.equal(calls, 2);
  assert.notEqual(after, before);
  assert.equal(store.hasRefreshError(), false);
});
