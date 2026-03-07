import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOKYO_UTC_OFFSET_HOURS = 9;
const DEFAULT_SITE_TEXT = "セミナーの詳細はWebサイトを確認してください。";
const DEFAULT_TIME_RANGE = "16:00 - 17:30";
const dataFilePath = path.join(__dirname, "data.txt");

function normalizeText(value) {
  return value.replace(/[\s\u3000]+/g, " ").trim();
}

function loadSiteText() {
  try {
    if (!fs.existsSync(dataFilePath)) {
      throw new Error("データファイルが存在しません");
    }

    const text = fs.readFileSync(dataFilePath, "utf-8");
    console.log(`--- ファイルから情報を読み込みました: ${path.basename(dataFilePath)} ---`);
    return text;
  } catch (error) {
    console.log("--- データファイルが見つからないため、初期値を使用します ---");
    return DEFAULT_SITE_TEXT;
  }
}

function trimTrailingNoise(block) {
  const sentinels = ["Tokyo University Secretary", "滞在研究者情報", "滞在研究者"];
  let endIndex = block.length;

  for (const sentinel of sentinels) {
    const index = block.indexOf(sentinel);
    if (index !== -1 && index < endIndex) {
      endIndex = index;
    }
  }

  return block.slice(0, endIndex).trim();
}

function extractField(block, label, stopPattern) {
  const regex = new RegExp(`${label}[：:]\\s*([\\s\\S]*?)${stopPattern}`, "u");
  const match = block.match(regex);
  return match ? normalizeText(match[1]) : "";
}

function parseClock(text, fallbackHour, fallbackMinute) {
  const match = text.match(/(\d{1,2}):(\d{2})/);
  if (!match) {
    return { hour: fallbackHour, minute: fallbackMinute };
  }

  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
  };
}

function parseTimeRange(timeText) {
  const normalized = normalizeText(timeText || DEFAULT_TIME_RANGE);
  const match = normalized.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);

  if (!match) {
    return {
      display: DEFAULT_TIME_RANGE,
      start: { hour: 16, minute: 0 },
      end: { hour: 17, minute: 30 },
    };
  }

  return {
    display: `${match[1]} - ${match[2]}`,
    start: parseClock(match[1], 16, 0),
    end: parseClock(match[2], 17, 30),
  };
}

function toTokyoTimestamp(year, month, day, hour, minute) {
  return Date.UTC(year, month - 1, day, hour - TOKYO_UTC_OFFSET_HOURS, minute);
}

function parseSeminarSchedule(text) {
  const sourceStart = text.indexOf("今後の予定");
  const source = sourceStart >= 0 ? text.slice(sourceStart) : text;
  const markerPattern = /\d{4}年(?:\d{1,2}|\*+)月(?:\d{1,2}|\*+)日（[^）]+）/gu;
  const markers = [...source.matchAll(markerPattern)];
  const seminars = [];

  for (let index = 0; index < markers.length; index += 1) {
    const currentMarker = markers[index];
    const nextMarker = markers[index + 1];
    const startIndex = currentMarker.index ?? 0;
    const endIndex = nextMarker?.index ?? source.length;
    const rawBlock = trimTrailingNoise(source.slice(startIndex, endIndex));
    const dateMatch = rawBlock.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日（([^）]+)）/u);

    if (!dateMatch) {
      continue;
    }

    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const day = Number(dateMatch[3]);
    const weekday = dateMatch[4];
    const venue = extractField(rawBlock, "場所", "(?=講師[：:]|時間[：:]|Title[：:]|Abstract[：:]|$)");
    const speaker = extractField(rawBlock, "講師", "(?=時間[：:]|Title[：:]|Abstract[：:]|$)");
    const timeText = extractField(rawBlock, "時間", "(?=場所[：:]|講師[：:]|Title[：:]|Abstract[：:]|$)") || DEFAULT_TIME_RANGE;
    const title = extractField(rawBlock, "Title", "(?=Abstract[：:]|$)");
    const abstract = extractField(rawBlock, "Abstract", "$");
    const timeRange = parseTimeRange(timeText);

    seminars.push({
      year,
      month,
      day,
      weekday,
      dateLabel: `${year}年${month}月${day}日（${weekday}）`,
      venue,
      speaker,
      timeText: timeRange.display,
      title,
      abstract,
      startTimestamp: toTokyoTimestamp(year, month, day, timeRange.start.hour, timeRange.start.minute),
      endTimestamp: toTokyoTimestamp(year, month, day, timeRange.end.hour, timeRange.end.minute),
    });
  }

  return seminars.sort((left, right) => left.startTimestamp - right.startTimestamp);
}

function isSeminarScheduleQuestion(message) {
  const normalizedMessage = normalizeText(message);

  const directPatterns = [
    /次のセミナー/u,
    /次回のセミナー/u,
    /次回/u,
    /今後の予定/u,
    /次の予定/u,
    /セミナー予定/u,
    /次の講演/u,
  ];

  if (directPatterns.some((pattern) => pattern.test(normalizedMessage))) {
    return true;
  }

  const seminarKeywords = /(セミナー|講演|TPS|東京確率論)/u;
  const scheduleKeywords = /(予定|日程|日時|いつ|場所|会場|どこ|講師|タイトル|概要)/u;
  return seminarKeywords.test(normalizedMessage) && scheduleKeywords.test(normalizedMessage);
}

function getNextSeminar(seminars, now = new Date()) {
  const nowTimestamp = now.getTime();
  return seminars.find((seminar) => seminar.endTimestamp >= nowTimestamp) ?? null;
}

function buildTitleAndAbstractSentence(seminar) {
  const hasTitle = Boolean(seminar.title);
  const hasAbstract = Boolean(seminar.abstract);

  if (hasTitle && hasAbstract) {
    return `タイトルは「${seminar.title}」で、概要は${seminar.abstract}です。`;
  }

  if (hasTitle) {
    return `タイトルは「${seminar.title}」で、概要は未掲載です。`;
  }

  if (hasAbstract) {
    return `タイトルは未掲載ですが、概要は${seminar.abstract}です。`;
  }

  return "タイトルと概要は未掲載です。";
}

function buildNextSeminarReply(seminar) {
  if (!seminar) {
    return "次のセミナー情報は、現在の掲載内容からは確認できませんでした。公式サイトの最新情報をご確認ください。";
  }

  const venueSentence = seminar.venue
    ? `会場は${seminar.venue}です。`
    : "会場は未掲載です。";
  const speakerSentence = seminar.speaker
    ? `講師は${seminar.speaker}です。`
    : "講師は未掲載です。";

  return [
    `次のセミナーは${seminar.dateLabel}の${seminar.timeText}に予定されています。`,
    venueSentence,
    speakerSentence,
    buildTitleAndAbstractSentence(seminar),
  ].join("");
}

const siteText = loadSiteText();
const seminarSchedule = parseSeminarSchedule(siteText);

console.log(`抽出した今後のセミナー件数: ${seminarSchedule.length}`);

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

console.log("--- サーバー起動チェック ---");
console.log("PORT:", process.env.PORT);
console.log(
  "APIキー(頭5文字):",
  process.env.OPENROUTER_API_KEY ? process.env.OPENROUTER_API_KEY.slice(0, 5) : "設定されていません！",
);

app.post("/chat", async (req, res) => {
  const userMessage = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  console.log("ユーザーからメッセージを受信:", userMessage);

  if (!userMessage) {
    return res.status(400).json({ error: "message is required" });
  }

  if (isSeminarScheduleQuestion(userMessage)) {
    const nextSeminar = getNextSeminar(seminarSchedule);
    return res.json({ reply: buildNextSeminarReply(nextSeminar) });
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://render.com",
        "X-Title": "Penguin Chatbot",
      },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-001",
        messages: [
          {
            role: "system",
            content: [
              "あなたはアシスタントのピーチャンです。",
              "セミナー情報を説明するときは、箇条書きやMarkdown記号を使わず、自然な日本語の文で答えてください。",
              "場所は省略せず、会場名や部屋番号を自然な文として説明してください。",
              `参考情報: ${siteText}`,
            ].join(" "),
          },
          { role: "user", content: userMessage },
        ],
      }),
    });

    const data = await response.json();
    console.log("OpenRouterからの生レスポンス:", JSON.stringify(data));

    if (!response.ok) {
      const errorMessage = data?.error?.message || `OpenRouter API error: ${response.status}`;
      console.error("OpenRouter側でエラーが発生しています:", errorMessage);
      return res.status(response.status).json({ error: errorMessage });
    }

    const reply = data?.choices?.[0]?.message?.content || "AIからの返答が空でした。";
    return res.json({ reply: `${reply} 🐧` });
  } catch (error) {
    console.error("重大なエラーが発生しました:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`サーバーがポート ${PORT} で稼働中`));
