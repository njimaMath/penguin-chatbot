import { fetchCurrentSchedule, mergeCurrentSchedule, OFFICIAL_URL } from "./site-source.js";

// Refresh current-year information independently of the archived GitHub snapshot.
export function createScheduleStore({
  seminars,
  freshnessDate,
  siteInfo = "",
  refresh = fetchCurrentSchedule,
  refreshIntervalMs = 60 * 60 * 1000,
  retryIntervalMs = 60 * 1000,
}) {
  let snapshot = { seminars, freshnessDate, sourceUrl: OFFICIAL_URL, siteInfo };
  let lastFailure = -Infinity;
  let inFlight = null;

  return {
    getSnapshot: () => snapshot,
    hasRefreshError: () => lastFailure !== -Infinity,
    async refreshIfNeeded(now = new Date(), { force = false } = {}) {
      if (inFlight) return inFlight;
      const age = now.getTime() - snapshot.freshnessDate?.getTime();
      if (!force && lastFailure === -Infinity && Number.isFinite(age) && age >= 0 && age < refreshIntervalMs) return snapshot;
      if (now.getTime() - lastFailure < retryIntervalMs) return snapshot;

      inFlight = (async () => {
        const latest = await refresh(now);
        snapshot = {
          seminars: mergeCurrentSchedule(snapshot.seminars, latest.seminars, now),
          freshnessDate: latest.checkedAt,
          sourceUrl: latest.sourceUrl,
          siteInfo: latest.siteInfo || "",
        };
        lastFailure = -Infinity;
        return snapshot;
      })();
      try {
        return await inFlight;
      } catch (error) {
        lastFailure = now.getTime();
        throw error;
      } finally {
        inFlight = null;
      }
    },
  };
}
