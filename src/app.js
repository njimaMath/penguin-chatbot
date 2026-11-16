import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import fs from "fs";
import path from "path";
import { DATA_DIR, PUBLIC_DIR, PROJECT_ROOT } from "./paths.js";
import { needsSeminarContext, needsPeopleContext } from "./chat/routing.js";
import {
  parseSeminarSchedule,
  getNextSeminar,
  buildCompactMemo,
  normalizeText,
} from "./seminars/schedule.js";
import { buildIndex, retrieveAbstracts, needsAbstractRetrieval } from "./seminars/abstract-search.js";
import { callOpenRouterWithSources, getOpenRouterModel, REASONING_EFFORT } from "./services/openrouter.js";
import { createScheduleStore } from "./seminars/store.js";
import { isNextSeminarQuestion } from "./seminars/intent.js";
import { buildChatSystemPrompt } from "./chat/policy.js";
import { detectReplyLanguage, getTokyoNowParts, buildCurrentDateTimeReply, buildNextSeminarReply } from "./chat/reply-language.js";
import { shouldSearchWeb } from "./chat/web-search.js";
import { limitReplyWords, MAX_REPLY_WORDS } from "./chat/reply-limit.js";
import { sanitizeConversationHistory, buildConversationRoutingContext, MAX_HISTORY_MESSAGE_CHARACTERS } from "./chat/conversation-history.js";

const dataFilePath = path.join(DATA_DIR, "data.txt");
const freshnessFilePath = path.join(DATA_DIR, "freshness.json");
const OFFICIAL_URL = "https://sites.google.com/view/tokyo-probability-seminar23";

function styleDirectReply(text) {
  const normalized = typeof text === "string" ? normalizeText(text) : "";
  if (!normalized) return "ぴーちゃん、うまくお返事できなかったの。ごめんね。";
  return normalized;
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

dotenv.config({ path: path.join(PROJECT_ROOT, ".env") });

export const app = express();
app.locals.testNow = process.env.NODE_ENV === "test" ? process.env.PENGUIN_TEST_NOW || null : null;
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(PUBLIC_DIR));

console.log("--- サーバー起動チェック ---");
console.log("PORT:", process.env.PORT);
console.log("OpenRouter model:", getOpenRouterModel());
console.log("APIキー:", process.env.OPENROUTER_API_KEY?.trim() ? "設定済み" : "設定されていません！");

app.post("/chat", async (req, res) => {
  const userMessage = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  let now = req.app.locals.testNow ? new Date(req.app.locals.testNow) : new Date();
  const language = detectReplyLanguage(userMessage);
  const sendReply = (payload) => res.json({ ...payload, reply: limitReplyWords(payload.reply, language), language });
  console.log("ユーザーからメッセージを受信:", userMessage);

  let history;
  try {
    history = sanitizeConversationHistory(req.body?.history);
    if (userMessage.length > MAX_HISTORY_MESSAGE_CHARACTERS) {
      const error = new Error("Message is too large");
      error.status = 413;
      throw error;
    }
  } catch (error) {
    res.status(error.status === 413 ? 413 : 400);
    return sendReply({ reply: language === "en"
      ? error.status === 413 ? "This conversation has reached its size limit. Start a new chat or send a shorter question." : "I couldn't read the conversation history. Start a new chat and try again."
      : error.status === 413 ? "会話が長くなりすぎたの。新しい会話を始めるか、質問を短くしてね。" : "会話の履歴を読み取れなかったの。新しい会話を始めて、もう一度試してね。" });
  }
  const routingMessage = buildConversationRoutingContext(userMessage, history);
  const useSeminarContext = needsSeminarContext(routingMessage, searchIndex);

  if (!userMessage) {
    return sendReply({ reply: "Ask me about the seminar or mathematics. セミナーや数学について聞いてね。" });
  }

  // 1) 日時の質問 → 決定論fast-path(LLM不使用)
  const dateTimeReply = buildCurrentDateTimeReply(userMessage, now);
  if (dateTimeReply) return sendReply({ reply: styleDirectReply(dateTimeReply) });

  // Refresh at most hourly. Tests use their fixed local fixtures without a network call.
  if (useSeminarContext && process.env.NODE_ENV !== "test") {
    try {
      const force = /\b(?:search|browse|look\s+up|refresh|updates?|updated|latest)\b|検索|調べ|最新|更新|公式サイト(?:を|で)確認/iu.test(userMessage);
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

  const peopleContext = needsPeopleContext(routingMessage, searchIndex);
  const webSearch = shouldSearchWeb(userMessage, {
    seminarContext: useSeminarContext, peopleContext,
    // Saved records contain schedules and abstracts, not complete access details.
    seminarFactsMissing: useSeminarContext, context: routingMessage,
  });
  let lookupMessage = routingMessage;
  if (webSearch && useSeminarContext) {
    lookupMessage += `\nOfficial seminar page: ${sourceUrl}`;
    if (peopleContext && /\b(?:next|upcoming)\s+(?:seminar|talk|lecture|speaker)|次(?:回)?(?:の)?(?:セミナー|講演|講師)/iu.test(routingMessage)) {
      const next = getNextSeminar(seminars, now);
      // Resolve the person from current official records before searching a pronoun.
      lookupMessage += `\nOfficial upcoming speakers (source data): ${JSON.stringify(next
        ? { date: next.dateLabel, speakers: next.talks.map(({ speaker }) => speaker).filter(Boolean) }
        : { speakers: [], note: "No upcoming speaker is announced in the available official records." })}`;
    }
  }

  // 3) それ以外 → コンパクトメモ + (必要時)要旨 を渡して LLM
  try {
    const memo = useSeminarContext ? buildCompactMemo(seminars, now, freshnessMeta(now)) : "";

    let abstractField;
    let abstractsText = "";
    if (useSeminarContext && needsAbstractRetrieval(userMessage)) {
      const { items, confidence, kind } = retrieveAbstracts(routingMessage, searchIndex, { nextSeminar: getNextSeminar(seminars, now) });
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
    const result = await callOpenRouterWithSources(systemPrompt, webSearch ? lookupMessage : userMessage, { webSearch, history });
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
          ? "I couldn't verify this with web sources right now. Please try again with a specific mathematical topic, academic name, or seminar detail."
          : "今はウェブ上の出典を確認できなかったの。数学のテーマ、数学者・講師の名前、セミナー情報を具体的にして、もう一度試してね。"
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
    reasoningEffort: REASONING_EFFORT,
    maxReplyWords: MAX_REPLY_WORDS,
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

