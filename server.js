import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  parseSeminarSchedule,
  getNextSeminar,
  buildCompactMemo,
  normalizeText,
} from "./memo.js";
import { buildIndex, retrieveAbstracts, needsAbstractRetrieval } from "./search.js";
import { callOpenRouterWithSources, getOpenRouterModel } from "./openrouter.js";
import { createScheduleStore } from "./schedule-store.js";
import { isNextSeminarQuestion } from "./schedule-intent.js";
import { buildChatSystemPrompt } from "./chat-policy.js";
import { detectReplyLanguage, getTokyoNowParts, buildCurrentDateTimeReply, buildNextSeminarReply } from "./reply-language.js";
import { shouldSearchWeb } from "./web-search.js";
import { limitReplyWords } from "./reply-limit.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataFilePath = path.join(__dirname, "data.txt");
const freshnessFilePath = path.join(__dirname, "freshness.json");
const OFFICIAL_URL = "https://sites.google.com/view/tokyo-probability-seminar23";

function styleDirectReply(text) {
  const normalized = typeof text === "string" ? normalizeText(text) : "";
  if (!normalized) return "ぴーちゃん、うまくお返事できなかったの。ごめんね。";
  return normalized;
}

function needsSeminarContext(message) {
  const query = message.toLowerCase();
  const namedSpeaker = /\b(?:when|where|who|speaking|presenting)\b|いつ|どこ|誰|登壇/iu.test(message)
    && searchIndex.docs.some(({ speaker }) => speaker.replace(/[（(].*$/u, "").split(/\s+/u)
    .filter((part) => part.length >= 2)
    .some((part) => {
      if (/\p{Script=Han}/u.test(part)) return query.replace(/\s+/gu, "").includes(part);
      const escaped = part.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(?:^|[^\\p{L}])${escaped}(?=$|[^\\p{L}])`, "u").test(query);
    }));
  return isNextSeminarQuestion(message)
    || namedSpeaker
    || /[’']s\s+(?:talk|lecture)\b/iu.test(message)
    || /\b(?:tps|seminars?|schedules?|speakers?|speaking|venues?|organizers?|campus|komaba|hiyoshi|locations?|directions|access|workshops?|talks|lectures)\b|\b(?:the|this|that|next|past|previous|whose|which)\s+(?:talk|lecture)\b|セミナー|講演|講師|先生|登壇|会場|幹事|キャンパス|アクセス|場所|行き方|日時|予定|日程|公式サイト|tokyo-probability-seminar23/iu.test(message);
}

function loadSiteText() {
  try {
    return fs.readFileSync(dataFilePath, "utf-8");
  } catch {
    console.log("--- data.txt が読めません ---");
    return "";
  }
}

// データ鮮度(freshness.json があればそれ、無ければファイル更新時刻)
function loadFreshness() {
  try {
    const f = JSON.parse(fs.readFileSync(freshnessFilePath, "utf-8"));
    const date = new Date(f.scrapedAtJST);
    if (Number.isFinite(date.getTime())) return date;
  } catch { /* fall through */ }
  try {
    return fs.statSync(dataFilePath).mtime;
  } catch {
    return null;
  }
}

const siteText = loadSiteText();
const scheduleStore = createScheduleStore({
  seminars: parseSeminarSchedule(siteText),
  freshnessDate: loadFreshness(),
  siteInfo: siteText.slice(0, siteText.indexOf("今後の予定") < 0 ? 0 : siteText.indexOf("今後の予定")),
});
let indexedSeminars = scheduleStore.getSnapshot().seminars;
let searchIndex = buildIndex(indexedSeminars);
function freshnessMeta(now = new Date()) {
  const { freshnessDate } = scheduleStore.getSnapshot();
  if (!freshnessDate) return { dataAsOf: "不明", isStale: true };
  const p = getTokyoNowParts(freshnessDate);
  const staleHours = (now.getTime() - freshnessDate.getTime()) / 36e5;
  return { dataAsOf: `${p.year}年${p.month}月${p.day}日`, isStale: staleHours >= 1 || staleHours < 0 || scheduleStore.hasRefreshError() };
}

console.log(`抽出セミナー件数: ${indexedSeminars.length}（要旨保有: ${searchIndex.corpus.length}） / 日程調整中: ${indexedSeminars._tbdCount ?? 0}`);

dotenv.config();

export const app = express();
app.locals.testNow = process.env.NODE_ENV === "test" ? process.env.PENGUIN_TEST_NOW || null : null;
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

console.log("--- サーバー起動チェック ---");
console.log("PORT:", process.env.PORT);
console.log("OpenRouter model:", getOpenRouterModel());
console.log("APIキー:", process.env.OPENROUTER_API_KEY?.trim() ? "設定済み" : "設定されていません！");

app.post("/chat", async (req, res) => {
  const userMessage = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  let now = req.app.locals.testNow ? new Date(req.app.locals.testNow) : new Date();
  const language = detectReplyLanguage(userMessage);
  const useSeminarContext = needsSeminarContext(userMessage);
  const webSearch = shouldSearchWeb(userMessage, { seminarContext: useSeminarContext });
  const sendReply = (payload) => res.json({ ...payload, reply: limitReplyWords(payload.reply, language), language });
  console.log("ユーザーからメッセージを受信:", userMessage);

  if (!userMessage) {
    return sendReply({ reply: "Ask me about the seminar or mathematics. セミナーや数学について聞いてね。" });
  }

  // 1) 日時の質問 → 決定論fast-path(LLM不使用)
  const dateTimeReply = buildCurrentDateTimeReply(userMessage, now);
  if (dateTimeReply) return sendReply({ reply: styleDirectReply(dateTimeReply) });

  // Refresh at most hourly. Tests use their fixed local fixtures without a network call.
  if (useSeminarContext && process.env.NODE_ENV !== "test") {
    try {
      const force = /\b(?:search|browse|look\s+up)\b|検索|調べ|公式サイト(?:を|で)確認/iu.test(userMessage);
      await scheduleStore.refreshIfNeeded(now, { force });
    } catch (error) {
      console.warn("最新の予定を取得できませんでした:", error.message);
    }
  }
  if (!req.app.locals.testNow) now = new Date();
  const { seminars, sourceUrl, freshnessDate, siteInfo } = scheduleStore.getSnapshot();
  const sources = useSeminarContext ? [{ title: language === "en" ? "Tokyo Probability Seminar" : "東京確率論セミナー", url: sourceUrl }] : [];
  const checkedAt = freshnessDate?.toISOString() ?? null;
  if (indexedSeminars !== seminars) {
    indexedSeminars = seminars;
    searchIndex = buildIndex(seminars);
  }

  // 2) 次回/予定の質問 → 決定論fast-path(LLM不使用・ハルシネーション無し)
  if (isNextSeminarQuestion(userMessage)) {
    const next = getNextSeminar(seminars, now);
    return sendReply({ reply: styleDirectReply(buildNextSeminarReply(next, { ...freshnessMeta(now), language, sourceUrl })), sources, checkedAt });
  }

  // 3) それ以外 → コンパクトメモ + (必要時)要旨 を渡して LLM
  try {
    const memo = useSeminarContext ? buildCompactMemo(seminars, now, freshnessMeta(now)) : "";

    let abstractField;
    let abstractsText = "";
    if (useSeminarContext && needsAbstractRetrieval(userMessage)) {
      const { items, confidence, kind } = retrieveAbstracts(userMessage, searchIndex, { nextSeminar: getNextSeminar(seminars, now) });
      if (items.length) {
        abstractsText = items
          .map((it) => `・${it.dateLabel} ${it.speaker}「${it.title}」\n${it.abstractMissing ? "（要旨は未掲載）" : it.abstract}`)
          .join("\n\n");
        const hedge = kind === "search" && confidence !== "high"
          ? "（これらは確実に一致する回ではないかもしれません。自信がない時は『はっきり該当する回は見つからなかったけど…』と前置きしてください）"
          : "";
        abstractsText = hedge + "\n" + abstractsText;
        abstractField = items.map((it) => ({
          title: it.title, original: it.abstract, dateLabel: it.dateLabel, abstractMissing: it.abstractMissing,
        }));
      }
    }

    const date = getTokyoNowParts(now);
    const currentDate = `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
    const systemPrompt = buildChatSystemPrompt({ language, memo, sourceUrl: useSeminarContext ? sourceUrl : "", abstractsText, siteInfo: useSeminarContext ? siteInfo : "", webSearch, currentDate });
    const result = await callOpenRouterWithSources(systemPrompt, userMessage, { webSearch });
    const payload = {
      reply: result.reply,
      sources: [...sources, ...result.sources],
      checkedAt: result.webSearchUsed ? new Date().toISOString() : useSeminarContext ? checkedAt : null,
      webSearchUsed: result.webSearchUsed,
    };
    if (abstractField && abstractField.length) payload.abstract = abstractField;
    return sendReply(payload);
  } catch (error) {
    console.error("LLM呼び出し失敗:", error.message);
    // 生エラーは出さず、ペンギン口調で degrade(fast-path系は引き続き使える旨を案内)
    return sendReply({
      reply: webSearch
        ? language === "en"
          ? "I couldn't verify this with web sources right now. Please try again with a specific paper title or mathematical topic."
          : "今はウェブ上の出典を確認できなかったの。論文名や数学のテーマを具体的にして、もう一度試してね。"
        : language === "en"
        ? "I couldn't produce an answer right now. Please try again shortly. I can still help with the current time and next seminar."
        : `ごめんね、今ちょっとお返事ができないの。もう一度試してね。日時や次回の予定ならすぐ答えられるよ。${OFFICIAL_URL}`,
      language,
      webSearchUsed: false,
    });
  }
});

app.get("/health", (req, res) => {
  const meta = freshnessMeta();
  const { seminars, sourceUrl, freshnessDate } = scheduleStore.getSnapshot();
  const next = getNextSeminar(seminars);
  res.json({
    model: getOpenRouterModel(),
    reasoningEffort: "low",
    maxReplyWords: 200,
    webSearch: { engine: "parallel", mode: "turbo", maxResults: 3 },
    seminarCount: seminars.length,
    abstractCount: searchIndex.corpus.length,
    dataAsOf: meta.dataAsOf,
    isStale: meta.isStale,
    nextSeminarDate: next?.dateLabel ?? null,
    sourceUrl,
    checkedAt: freshnessDate?.toISOString() ?? null,
  });
});

const PORT = process.env.PORT || 3000;
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  app.listen(PORT, () => console.log(`サーバーがポート ${PORT} で稼働中`));
}
