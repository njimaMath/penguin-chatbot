export const MAX_HISTORY_MESSAGES = 1000;
export const MAX_HISTORY_CHARACTERS = 250000;
export const MAX_HISTORY_MESSAGE_CHARACTERS = 16000;

export class ConversationHistoryError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ConversationHistoryError";
    this.status = status;
  }
}

// Keep every accepted message. Oversized histories fail visibly instead of
// silently dropping the beginning of the conversation.
export function sanitizeConversationHistory(history = []) {
  if (!Array.isArray(history)) throw new ConversationHistoryError("History must be an array");
  if (history.length > MAX_HISTORY_MESSAGES) {
    throw new ConversationHistoryError("History has too many messages", 413);
  }
  let characters = 0;
  return history.map((entry) => {
    if (!entry || typeof entry !== "object" || !["user", "assistant"].includes(entry.role)
      || typeof entry.content !== "string" || !entry.content.trim()) {
      throw new ConversationHistoryError("History messages require a user or assistant role and nonempty text");
    }
    characters += entry.content.length;
    if (entry.content.length > MAX_HISTORY_MESSAGE_CHARACTERS || characters > MAX_HISTORY_CHARACTERS) {
      throw new ConversationHistoryError("History is too large", 413);
    }
    return { role: entry.role, content: entry.content };
  });
}

const FOLLOWUP_WORDS = new Set((
  "a an the and but or about of for from in on to at with by as is are was were be been "
  + "what what's when where who why how which can could would will do does did you me i "
  + "it its that this these those there their them he she his her him hers please again retry repeat try one more time "
  + "explain explanation clarify elaborate show tell give summarize summary prove proof check "
  + "constructed construct introduced introduce proved written published discovered author authors "
  + "title location venue room speaker talk lecture schedule paper article abstract result theorem notation definition "
  + "meaning date assumptions source sources reference references link url dimension construction "
  + "details detail implication implications application applications example examples formula "
  + "same further briefly simply simpler carefully step continue go next then not correct wrong "
  + "search browse look up find available online current affiliation affiliations research publications work works working "
  + "profile biography career university institution department homepage website get reach access directions station nearest"
).split(/\s+/u));

export function isConversationFollowup(message) {
  const text = String(message ?? "").normalize("NFKC").trim().toLowerCase()
    .replace(/’/gu, "'").replace(/[?!.,:;。！？]+$/gu, "");
  if (!text || text.length > 240) return false;
  if (/^(?:please )?(?:try again|retry|again|one more time|repeat(?: (?:that|it))?|continue|go on|explain more|explain further|give more details|why|how so|where|when|who|what time)(?: please)?$/u.test(text)) return true;
  if (/^(?:もう一度|再度)(?:説明して|教えて|お願いします|お願い|試して)?$|^(?:もっと)?詳しく(?:説明して|教えて)?$|^続き(?:を)?(?:説明して|教えて)?$/u.test(text)) return true;
  if (/^(?:どこ|いつ|誰|なに|何時|何)(?:ですか|なの|か)?$/u.test(text)) return true;
  if (/^(?:講師|登壇者|発表者|スピーカー)(?:は|って)?誰(?:ですか|なの|か)?$/u.test(text)) return true;
  if (/^(?:彼|彼女|その人|この人|その講師|この講師|その数学者)(?:は|の)?(?:所属|研究|論文|業績|経歴|大学|ホームページ)(?:は|を|について)?(?:どこ|何|教えて|調べて|検索して)?(?:ですか|なの|か|ください)?$/u.test(text)) return true;
  if (/^(?:そこ|その会場|この会場)(?:への|までの|に)?(?:アクセス|行き方|最寄り駅)(?:は|を)?(?:何|どこ|教えて|調べて|検索して)?(?:ですか|なの|か|ください)?$/u.test(text)) return true;
  if (/^(?:題目|タイトル|日付|日時|時間|会場|場所|部屋)(?:は|って)?(?:何|何時|どこ|いつ)?(?:ですか|なの|か)?$/u.test(text)) return true;
  if (/^(?:それ|これ|あれ)(?:は|を|の)?(?:どこ|いつ|誰|何|なに|どういう意味|なぜ|どうして)(?:なの|です|ですか|か)?$/u.test(text)) return true;
  if (/^(?:その|この|あの)(?:会場|場所|部屋|講師|論文|著者|題目|タイトル|要旨|結果|定理|証明|記号|意味|日付|時間|仮定|出典|文献|リンク|構成|詳細)(?:は|を|について)?(?:どこ|いつ|誰|何|なに|教えて|説明して|検索して|調べて|確認して)?(?:ですか|なの|か|ください)?$/u.test(text)) return true;

  // An unfamiliar noun signals a new explicit topic. This prevents a previous
  // mathematical topic from supplying scope to a new news or travel request.
  const tokens = text.match(/[a-z0-9]+(?:'[a-z]+)?/gu) || [];
  if (!tokens.length || tokens.some((token) => !FOLLOWUP_WORDS.has(token))) return false;
  if (/\b(?:it|its|that|this|these|those|there|their|them|he|she|his|her|him|hers)\b/u.test(text)) return true;
  if (/^(?:what(?: is|'s) (?:the )?(?:title|time|date|location|venue|room|speaker|author)|who(?: is|'s) (?:the )?(?:speaker|author))$/u.test(text)) return true;
  return /^(?:and|what about|how about) (?:the )?(?:title|location|venue|room|speaker|author|paper|abstract|proof|result|notation|date|time|source|sources|link|url|details)$/u.test(text);
}

export function buildConversationRoutingContext(message, history = []) {
  const current = typeof message === "string" ? message : "";
  if (!isConversationFollowup(current)) return current;
  const users = (Array.isArray(history) ? history : [])
    .filter((entry) => entry?.role === "user" && typeof entry.content === "string" && entry.content.trim());
  const topic = users.reverse().find((entry) => !isConversationFollowup(entry.content));
  return topic ? `Previous topic: ${topic.content}\nCurrent question: ${current}` : current;
}
