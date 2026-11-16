// memo.js — data.txt をパースして「構造化セミナーレコード」と
// LLM へ渡す「コンパクト構造化メモ」を生成する。
// 設計方針:
//  - 英文Abstract本文はメモに絶対に載せない(トークンの主犯)。要旨は search.js 経由で必要時のみ取得。
//  - 講師/会場の stopPattern を全ラベルで止める(これを怠ると旧アーカイブで講師欄が数百字bleedしコストが崩壊する)。
//  - 同一講演がページ重複で複数回出るため (年,月,日) の数値キーで dedup する。
//  - 1日に複数講演(ダブルヘッダー)は talks[] 配列で保持する。

const TOKYO_UTC_OFFSET_HOURS = 9;
const DEFAULT_TIME_RANGE = "16:00 - 17:30";
const DEFAULT_VENUE_SHORT = "東京大学大学院数理科学研究科 数理科学研究科棟（駒場）126号室";

// 抽出フィールドの境界に使う全ラベル(全角/半角コロンは事前に統一)
const FIELD_LABELS = ["場所", "講師", "時間", "日時", "Title", "題目", "タイトル", "Abstract", "概要", "アブストラクト"];
const STOP_LOOKAHEAD = `(?=(?:${FIELD_LABELS.join("|")})\\s*:|$)`;

export function normalizeText(value) {
  return String(value ?? "").replace(/[\s　]+/g, " ").trim();
}

// 全角コロンを半角に統一(旧アーカイブは「講師：」「日時：」を使う)
function normalizeColons(text) {
  return String(text ?? "").replace(/：/g, ":");
}

function asciiDigits(text) {
  return String(text).replace(/[０-９]/gu, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0));
}

function dateNumber(text) {
  return Number(asciiDigits(text).replace(/\s/gu, ""));
}

// label(複数別名 OR) の値を、次のラベル or 末尾まで取り出す
// 大文字小文字を無視(ABSTRACT:/Title: 等の表記ゆれで英文要旨が title に混入するのを防ぐ)
function extractField(block, labelAlternation) {
  const regex = new RegExp(`(?:${labelAlternation})\\s*:\\s*([\\s\\S]*?)${STOP_LOOKAHEAD}`, "iu");
  const match = block.match(regex);
  return match ? normalizeText(match[1]) : "";
}

function parseClock(text, fallbackHour, fallbackMinute) {
  const match = String(text).match(/(\d{1,2}):(\d{2})/);
  if (!match) return { hour: fallbackHour, minute: fallbackMinute };
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function parseTimeRange(timeText) {
  // Google Sites may split digits across text spans, e.g. "1 7:3 0".
  const normalized = asciiDigits(timeText || DEFAULT_TIME_RANGE).replace(/\s/gu, "");
  const match = normalized.match(/(\d{1,2}:\d{2})[-–~〜～](\d{1,2}:\d{2})/);
  const start = match ? parseClock(match[1], 16, 0) : null;
  const end = match ? parseClock(match[2], 17, 30) : null;
  if (!match || start.hour > 23 || end.hour > 23 || start.minute > 59 || end.minute > 59
    || end.hour * 60 + end.minute <= start.hour * 60 + start.minute) {
    return { display: DEFAULT_TIME_RANGE, start: { hour: 16, minute: 0 }, end: { hour: 17, minute: 30 } };
  }
  return {
    display: `${match[1]} - ${match[2]}`,
    start,
    end,
  };
}

function toTokyoTimestamp(year, month, day, hour, minute) {
  return Date.UTC(year, month - 1, day, hour - TOKYO_UTC_OFFSET_HOURS, minute);
}

// 会場文字列を整形: URL除去 + アクセス/地図等のノイズで切る + 80字cap
function cleanVenue(raw) {
  let v = asciiDigits(normalizeText(raw)).replace(/https?:\/\/\S+/g, "");
  v = v.replace(/(\d(?:\s*\d)*)\s*号室/gu, (_match, room) => `${room.replace(/\s/gu, "")}号室`);
  for (const sentinel of ["アクセス", "地図", "茶菓子", "https", "受付", "登録"]) {
    const i = v.indexOf(sentinel);
    if (i > 0) v = v.slice(0, i);
  }
  v = v.replace(/[\s、。]+$/u, "").trim();
  if (v.length > 80) v = v.slice(0, 80);
  return v;
}

// 1ブロック本文から talks[](1件 or ダブルヘッダーで複数)を作る
function parseTalks(body) {
  const speakerLabel = /(?:講師)\s*:/gu;
  const indices = [];
  let m;
  while ((m = speakerLabel.exec(body)) !== null) indices.push(m.index);

  // 講師ラベルが0/1個 → 単一講演として扱う
  const segments = [];
  if (indices.length <= 1) {
    segments.push(body);
  } else {
    // 最初の講師ラベル以降を各講師で分割(冒頭=会場等は各セグメントが共有)
    const head = body.slice(0, indices[0]);
    for (let i = 0; i < indices.length; i += 1) {
      const start = indices[i];
      const end = i + 1 < indices.length ? indices[i + 1] : body.length;
      segments.push(head + body.slice(start, end));
    }
  }

  return segments.map((seg) => {
    const speaker = extractField(seg, "講師").replace(/\s*(氏|先生|教授)\s*$/u, "").trim();
    const timeText = extractField(seg, "時間|日時") || DEFAULT_TIME_RANGE;
    const title = extractField(seg, "Title|題目|タイトル");
    const abstract = extractField(seg, "Abstract|概要|アブストラクト");
    const timeRange = parseTimeRange(timeText);
    return { speaker, title, abstract, timeText: timeRange.display, timeRange };
  });
}

// 会場の冗長な正式名称を短い正準表記に(情報は保持しつつトークンを圧縮)
function shortenVenue(v) {
  if (!v) return "未掲載";
  if (/(駒場|数理科学研究科)/u.test(v)) {
    const room = v.match(/\d+号室/u)?.[0] || "";
    return `東大駒場${room}`;
  }
  if (/早稲田/u.test(v)) {
    const m = v.match(/(\d{1,2}-\d{1,2})/u);
    return m ? `早稲田51号館${m[1]}` : "早稲田大学";
  }
  if (/(慶應|日吉)/u.test(v)) return "慶應日吉";
  if (/津田塾/u.test(v)) return "津田塾大学";
  return v.length > 24 ? v.slice(0, 24) : v;
}

function trimTrailingNoise(block) {
  const sentinels = ["Tokyo University Secretary", "滞在研究者情報", "滞在研究者"];
  let end = block.length;
  for (const s of sentinels) {
    const i = block.indexOf(s);
    if (i !== -1 && i < end) end = i;
  }
  return block.slice(0, end).trim();
}

// data.txt 全文 → セミナーレコード[](dedup済み・新しい順でなく古い順 sort)
export function parseSeminarSchedule(rawText) {
  const text = normalizeColons(rawText);
  const sourceStart = text.indexOf("今後の予定");
  const source = sourceStart >= 0 ? text.slice(sourceStart) : text;

  // Normalize only date fields, preserving spacing and Unicode in titles/abstracts.
  const digit = "[0-9０-９]";
  const yearDigits = `${digit}(?:\\s*${digit}){3}`;
  const dateDigits = `${digit}(?:\\s*${digit})?`;
  const markerPattern = new RegExp(`(${yearDigits})\\s*年\\s*(${dateDigits}|\\*+)\\s*月\\s*(${dateDigits}|\\*+)\\s*日\\s*[（(]([^）)]+)[）)]`, "gu");
  const markers = [...source.matchAll(markerPattern)];

  const byKey = new Map();
  let tbdCount = 0;

  for (let i = 0; i < markers.length; i += 1) {
    const startIndex = markers[i].index ?? 0;
    const endIndex = markers[i + 1]?.index ?? source.length;
    const rawBlock = trimTrailingNoise(source.slice(startIndex, endIndex));

    const dateMatch = markers[i];
    if (dateMatch[2].includes("*") || dateMatch[3].includes("*")) {
      // 「2026年*月**日」等の日程調整中の枠
      tbdCount += 1;
      continue;
    }

    const year = dateNumber(dateMatch[1]);
    const month = dateNumber(dateMatch[2]);
    const day = dateNumber(dateMatch[3]);
    const weekday = normalizeText(dateMatch[4]);
    const calendarDate = new Date(Date.UTC(year, month - 1, day));
    if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) {
      tbdCount += 1;
      continue;
    }

    const body = rawBlock.slice(dateMatch[0].length);
    const venue = cleanVenue(extractField(body, "場所")) || DEFAULT_VENUE_SHORT;
    const talks = parseTalks(body).map((t) => ({
      ...t,
      startTimestamp: toTokyoTimestamp(year, month, day, t.timeRange.start.hour, t.timeRange.start.minute),
      endTimestamp: toTokyoTimestamp(year, month, day, t.timeRange.end.hour, t.timeRange.end.minute),
    }));

    const record = {
      year, month, day, weekday,
      dateLabel: `${year}年${month}月${day}日（${weekday}）`,
      venue,
      talks,
      isDoubleHeader: talks.length > 1,
      startTimestamp: toTokyoTimestamp(year, month, day, talks[0]?.timeRange.start.hour ?? 16, talks[0]?.timeRange.start.minute ?? 0),
      endTimestamp: Math.max(...talks.map((t) => t.endTimestamp)),
    };

    // Current/root pages are scraped first. Older archives must not overwrite
    // corrections to the room, speaker or cancelled talks with richer old text.
    const key = `${year}-${month}-${day}`;
    if (!byKey.has(key)) byKey.set(key, record);
  }

  const seminars = [...byKey.values()].sort((a, b) => a.startTimestamp - b.startTimestamp);
  seminars._tbdCount = tbdCount;
  return seminars;
}

export function getNextSeminar(seminars, now = new Date()) {
  const t = now.getTime();
  return seminars.find((s) => Number.isFinite(s.endTimestamp) && s.endTimestamp >= t) ?? null;
}

function fmtTokyo(now) {
  const f = new Intl.DateTimeFormat("ja-JP-u-ca-gregory", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric",
    weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const v = {};
  for (const p of f.formatToParts(now)) if (p.type !== "literal") v[p.type] = p.value;
  return `${Number(v.year)}年${Number(v.month)}月${Number(v.day)}日（${v.weekday}）${v.hour}:${v.minute}`;
}

// 1セミナーの1行表現(要旨は載せない)
function memoLine(s) {
  const venue = shortenVenue(s.venue);
  if (s.isDoubleHeader) {
    const head = `- ${s.dateLabel} ダブルヘッダー 会場:${venue}`;
    const subs = s.talks.map(
      (t) => `    ・${t.timeText} 講師:${t.speaker || "未掲載"} ｜タイトル:${t.title || "未掲載"}`
    );
    return [head, ...subs].join("\n");
  }
  const t = s.talks[0] ?? {};
  return `- ${s.dateLabel} ${t.timeText || DEFAULT_TIME_RANGE} 講師:${t.speaker || "未掲載"} 会場:${venue} ｜タイトル:${t.title || "未掲載"}`;
}

// LLM に渡す構造化メモ(full-rich)。要旨は含めない。
export function buildCompactMemo(seminars, now = new Date(), meta = {}) {
  const nowText = fmtTokyo(now);
  const t = now.getTime();
  const future = seminars.filter((s) => Number.isFinite(s.endTimestamp) && s.endTimestamp >= t);
  const past = seminars.filter((s) => !(Number.isFinite(s.endTimestamp) && s.endTimestamp >= t))
    .sort((a, b) => b.startTimestamp - a.startTimestamp); // 新しい順
  const next = future[0] ?? null;
  const asOf = meta.dataAsOf || "不明";

  const lines = [];
  lines.push(`【現在日時】${nowText} JST`);
  lines.push(`【データ鮮度】このデータは${asOf}時点の情報です。`);
  if (meta.isStale) lines.push("（注意: データが最新でない可能性があります。最新は公式サイトをご確認ください）");

  if (next) {
    const nt = next.talks[0] ?? {};
    lines.push(`【次回セミナー】${next.dateLabel} ${nt.timeText || DEFAULT_TIME_RANGE} 講師:${nt.speaker || "未掲載"} 会場:${shortenVenue(next.venue)}`);
  } else {
    lines.push("【次回セミナー】現在のデータに今後の開催予定はありません。過去の回を次回として案内せず、最新情報は公式サイトをご確認ください。");
  }

  lines.push("【今後の予定】");
  if (future.length) future.forEach((s) => lines.push(memoLine(s)));
  else lines.push("（現在、確定済みの今後の予定はありません）");
  if (seminars._tbdCount) lines.push(`（日程調整中の枠: ${seminars._tbdCount}件）`);

  lines.push("【過去のセミナー一覧（新しい順）】");
  past.forEach((s) => lines.push(memoLine(s)));

  return lines.join("\n");
}
