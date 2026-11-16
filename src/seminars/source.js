import * as cheerio from "cheerio";
import { parseSeminarSchedule } from "./schedule.js";

export const OFFICIAL_URL = "https://sites.google.com/view/tokyo-probability-seminar23";

function academicYear(now) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "numeric",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year").value);
  const month = Number(parts.find((part) => part.type === "month").value);
  return month >= 4 ? year : year - 1;
}

function isInAcademicYear(seminar, year) {
  return (seminar.year === year && seminar.month >= 4)
    || (seminar.year === year + 1 && seminar.month <= 3);
}

export function getCurrentScheduleUrl(now = new Date()) {
  return `${OFFICIAL_URL}/${academicYear(now)}年度`;
}

// Google Sites repeats navigation dates outside its actual content sections.
export function extractSections($) {
  const sections = [];
  const cleanText = (element) => {
    const copy = element.clone();
    copy.find("script, style, noscript, nav, footer").remove();
    return copy.text().replace(/\s+/gu, " ").trim();
  };
  $("section").each((_, element) => {
    if ($(element).closest("nav, footer").length) return;
    const text = cleanText($(element));
    if (text.length > 10) sections.push(text);
  });
  if (!sections.length) {
    const text = cleanText($("body"));
    if (text.length > 10) sections.push(text);
  }
  return sections;
}

function extractSiteInfo($, text, sourceUrl) {
  const introduction = text.slice(0, text.indexOf("今後の予定")).trim();
  let siteInfo = introduction.slice(0, 6000);
  const seen = new Set();
  $("section a[href]").each((_, element) => {
    if (seen.size >= 40 || $(element).closest("nav, footer").length) return;
    const href = $(element).attr("href")?.trim();
    if (!href || href.startsWith("#")) return;
    try {
      const url = new URL(href, sourceUrl);
      if (!new Set(["http:", "https:"]).has(url.protocol) || seen.has(url.href)) return;
      const label = $(element).text().replace(/\s+/gu, " ").trim().slice(0, 160) || url.hostname;
      const line = `\n${label}: ${url.href}`;
      if (siteInfo.length + line.length > 12000) return;
      seen.add(url.href);
      siteInfo += line;
    } catch { /* Ignore malformed links. */ }
  });
  return siteInfo.trim();
}

export async function fetchCurrentSchedule(now = new Date(), {
  fetchImpl = globalThis.fetch,
  timeoutMs = 8000,
} = {}) {
  const sourceUrl = getCurrentScheduleUrl(now);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(sourceUrl, {
      headers: { Accept: "text/html" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Schedule source returned HTTP ${response.status}`);
    const html = await response.text();
    const $ = cheerio.load(html);
    const text = extractSections($).join("\n\n");
    if (!text.includes("今後の予定")) throw new Error("Schedule source has no upcoming-schedule section");
    const parsed = parseSeminarSchedule(text);
    const year = academicYear(now);
    const seminars = parsed.filter((seminar) => isInAcademicYear(seminar, year));
    seminars._tbdCount = parsed._tbdCount ?? 0;
    if (!seminars.length) throw new Error("Schedule source has no dates in the current academic year");
    return { seminars, sourceUrl, siteInfo: extractSiteInfo($, text, sourceUrl), checkedAt: new Date() };
  } finally {
    clearTimeout(timer);
  }
}

// Replace the entire current year so removed/cancelled dates cannot survive
// in the older disk snapshot. Historical years remain available for searches.
export function mergeCurrentSchedule(stored, latest, now = new Date()) {
  const year = academicYear(now);
  const byDate = new Map();
  for (const seminar of stored) {
    if (!isInAcademicYear(seminar, year)) {
      byDate.set(`${seminar.year}-${seminar.month}-${seminar.day}`, seminar);
    }
  }
  for (const seminar of latest) {
    if (isInAcademicYear(seminar, year)) {
      byDate.set(`${seminar.year}-${seminar.month}-${seminar.day}`, seminar);
    }
  }
  const merged = [...byDate.values()].sort((a, b) => a.startTimestamp - b.startTimestamp);
  merged._tbdCount = latest._tbdCount ?? 0;
  return merged;
}
