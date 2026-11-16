const TOKYO_TIME_ZONE = "Asia/Tokyo";
const OFFICIAL_URL = "https://sites.google.com/view/tokyo-probability-seminar23";

export function detectReplyLanguage(message) {
  const text = String(message ?? "").trim();
  // An English question may contain a Japanese speaker name or technical term.
  if (/^(?:what(?:'s|’s)?|when(?:'s|’s)?|where(?:'s|’s)?|who(?:'s|’s)?|why|how|please|explain|prove|define|compute|calculate|show|tell|give|can|could|would|do|does|is|are|will)\s/iu.test(text)) {
    return "en";
  }
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) return "ja";
  if (/\b(?:what|when|where|who|why|how|please|tell|show|explain|prove|define|compute|calculate|is|are|can|could|would|do|does|will|seminar|schedule|talk|math|current|today)\b/iu.test(text)) {
    return "en";
  }
  return /\p{Script=Han}/u.test(text) ? "ja" : "en";
}

export function getTokyoNowParts(now = new Date()) {
  const formatter = new Intl.DateTimeFormat("ja-JP-u-ca-gregory", {
    timeZone: TOKYO_TIME_ZONE,
    year: "numeric", month: "numeric", day: "numeric", weekday: "short",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const values = {};
  for (const part of formatter.formatToParts(now)) {
    if (part.type !== "literal") values[part.type] = part.value;
  }
  return {
    year: Number(values.year), month: Number(values.month), day: Number(values.day),
    weekday: values.weekday, hour: values.hour, minute: values.minute, second: values.second,
  };
}

function currentDateTimeIntent(message) {
  const text = String(message ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
  const asksTime = [/今\s*何時/u, /いま\s*なんじ/u, /現在時刻/u, /今の時間/u, /いまの時間/u, /^何時(?:ですか)?[?？]?$/u]
    .some((pattern) => pattern.test(text));
  const asksDate = [/今日の日付/u, /きょうの日付/u, /今日は?何日/u, /きょうは?何日/u, /今日は?何曜日/u, /きょうは?何曜日/u, /現在の日付/u, /今の日付/u]
    .some((pattern) => pattern.test(text));
  if (asksTime && asksDate) return "datetime";
  if (asksTime) return "time";
  if (asksDate) return "date";

  const english = text.toLowerCase().replace(/’/gu, "'").replace(/[?!.]+$/gu, "")
    .replace(/^(?:(?:can|could|would) you\s+)?(?:please\s+)?(?:tell|show|give) me\s+/u, "")
    .replace(/^please\s+/u, "").replace(/\s+please$/u, "");
  if (/^(?:(?:the )?current date and time|date and time(?: now)?|what(?:'s| is) (?:today's|the current) date and time|what day and time is it)$/u.test(english)) {
    return "datetime";
  }
  if (/^(?:what time is it(?: (?:now|in (?:tokyo|japan)))?|what(?:'s| is) the (?:current )?time(?: in (?:tokyo|japan))?|(?:the )?current time|time now)$/u.test(english)) {
    return "time";
  }
  if (/^(?:what(?:'s| is) (?:today's|the current) date|what day is it(?: today)?|(?:the )?current date|today's date|what is the date(?: today)?|what date is it(?: today)?)$/u.test(english)) {
    return "date";
  }
  return null;
}

export function buildCurrentDateTimeReply(message, now = new Date()) {
  const intent = currentDateTimeIntent(message);
  if (!intent) return null;
  const { year, month, day, weekday, hour, minute } = getTokyoNowParts(now);
  const time = `${hour}:${minute}`;
  if (detectReplyLanguage(message) === "en") {
    const date = new Intl.DateTimeFormat("en-US", {
      timeZone: TOKYO_TIME_ZONE, year: "numeric", month: "long", day: "numeric", weekday: "long",
    }).format(now);
    return intent === "date"
      ? `Today is ${date} in Japan. It's ${time} JST now.`
      : `It's ${time} JST on ${date}.`;
  }
  const date = `${year}年${month}月${day}日（${weekday}）`;
  return intent === "date"
    ? `今日は日本時間で${date}だよ。今は${time}なの。`
    : `今は日本時間で${date}の${time}だよ。`;
}

function englishDate(year, month, day) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC", year: "numeric", month: "long", day: "numeric", weekday: "long",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function seminarDate(seminar, language) {
  if (language === "ja") return seminar.dateLabel || `${seminar.year}年${seminar.month}月${seminar.day}日`;
  if ([seminar.year, seminar.month, seminar.day].every(Number.isFinite)) {
    return englishDate(seminar.year, seminar.month, seminar.day);
  }
  const match = String(seminar.dateLabel ?? "").match(/(\d{4})年(\d{1,2})月(\d{1,2})日/u);
  return match ? englishDate(Number(match[1]), Number(match[2]), Number(match[3])) : seminar.dateLabel || "an unannounced date";
}

function asOfDate(dataAsOf, language) {
  if (language === "ja") return dataAsOf || "不明";
  const match = String(dataAsOf ?? "").match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/u);
  if (match) return englishDate(Number(match[1]), Number(match[2]), Number(match[3]));
  return !dataAsOf || dataAsOf === "不明" ? "an unknown date" : String(dataAsOf);
}

function venueText(venue, language) {
  if (!venue) return language === "en" ? "a venue that hasn't been announced yet" : "未掲載";
  if (language !== "en" || !/(?:東京大学|東大|駒場)/u.test(venue)) return venue;
  const room = venue.match(/([0-9０-９](?:\s*[0-9０-９])*)\s*号室/u)?.[1]
    ?.replace(/\s/gu, "").replace(/[０-９]/gu, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0));
  return `University of Tokyo, Komaba Campus${room ? `, Room ${room}` : ""}`;
}

export function buildNextSeminarReply(seminar, {
  language = "ja", dataAsOf, isStale = false, sourceUrl = OFFICIAL_URL,
} = {}) {
  const english = language === "en";
  const warning = isStale
    ? english
      ? `My schedule data is from ${asOfDate(dataAsOf, language)}, and I couldn't confirm the latest schedule on the official site. `
      : `データは${asOfDate(dataAsOf, language)}時点のもので、公式サイトから最新の予定を確認できなかったの。`
    : "";
  const sourceNote = english
    ? `Please check the official schedule for updates: ${sourceUrl}`
    : `最新の予定は公式サイトで確認してね。${sourceUrl}`;
  if (!seminar) {
    return warning + (english
      ? `I couldn't find any upcoming seminars in the current data. ${sourceNote}`
      : `今のデータには今後の開催予定が見当たらなかったの。${sourceNote}`);
  }

  const date = seminarDate(seminar, language);
  const talks = seminar.talks || [];
  const venue = venueText(seminar.venue, language);
  let answer;
  if (seminar.isDoubleHeader || talks.length > 1) {
    if (english) {
      const descriptions = talks.map((talk) => {
        const time = talk.timeText ? `${talk.timeText} JST` : "time not yet announced";
        const title = talk.title ? ` Title: ${talk.title}.` : " The title hasn't been announced yet.";
        return `${talk.speaker || "Speaker not yet announced"} (${time}).${title}`;
      });
      answer = `The next seminar is a double header on ${date} at ${venue}. ${descriptions.join(" ")}`;
    } else {
      const descriptions = talks.map((talk) => {
        const speaker = talk.speaker ? `${talk.speaker}さん` : "講師未掲載";
        const time = talk.timeText || "時間未掲載";
        const title = talk.title ? `タイトルは「${talk.title}」だよ。` : "タイトルはまだ未掲載なの。";
        return `${time}、${speaker}の講演があるの。${title}`;
      });
      answer = `次のセミナーは${date}、会場は${venue}でダブルヘッダーだよ。${descriptions.join("")}`;
    }
  } else {
    const talk = talks[0] || {};
    if (english) {
      const time = talk.timeText ? `${talk.timeText} JST` : "time not yet announced";
      const speaker = talk.speaker || "not yet announced";
      const title = talk.title ? `The title is "${talk.title}".` : "The title hasn't been announced yet.";
      answer = `The next seminar is on ${date}, ${time}, at ${venue}. The speaker is ${speaker}. ${title}`;
    } else {
      const time = talk.timeText || "時間未掲載";
      const speaker = talk.speaker ? `${talk.speaker}さん` : "未掲載";
      const title = talk.title ? `タイトルは「${talk.title}」だよ。` : "タイトルはまだ未掲載なの。";
      answer = `次のセミナーは${date}の${time}だよ。会場は${venue}、講師は${speaker}なの。${title}`;
    }
  }
  return warning + answer + (isStale ? (english ? " " : "") + sourceNote : "");
}
