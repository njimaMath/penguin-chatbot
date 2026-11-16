import { isNextSeminarQuestion } from "../seminars/intent.js";

function requestText(message) {
  const text = String(message ?? "").normalize("NFKC");
  // Labeled follow-ups carry the old topic for reference, but a newly requested
  // private or unrelated subject must not inherit that topic's permission.
  const current = text.split("\nCurrent question: ").at(-1);
  return { text, current };
}

function outsidePeopleScope(text) {
  return /\b(?:elections?|politicians?|celebrity|celebrities|actors?|actresses?|singers?|smartphones?)\b|選挙|芸能|政治家|俳優|歌手|アイドル|スマートフォン/iu.test(text)
    || /\b(?:private|personal|home)\s+(?:contact|address|e-?mail|phone|telephone|number)|\b(?:mobile|cell(?:phone)?)\s+(?:phone|number)|\b(?:wife|husband|children|girlfriend|boyfriend|dating|divorce)\b|自宅|個人(?:の)?(?:住所|連絡先|メール)|私的(?:な)?連絡先|携帯(?:電話|番号)|家族|交際|離婚/iu.test(text);
}

function mentionsKnownSpeaker(text, index) {
  const query = text.toLowerCase();
  const compact = query.replace(/\s+/gu, "");
  return (Array.isArray(index?.docs) ? index.docs : []).some(({ speaker }) => {
    if (typeof speaker !== "string") return false;
    const parts = speaker.replace(/[（(].*$/u, "").split(/\s+/u).filter((part) => part.length >= 2);
    return parts.some((part) => {
      if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(part)) return compact.includes(part);
      const escaped = part.toLowerCase().replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      return new RegExp(`(?:^|[^\\p{L}])${escaped}(?=$|[^\\p{L}])`, "u").test(query);
    });
  });
}

export function needsSeminarContext(message, index) {
  const { text, current } = requestText(message);
  if (outsidePeopleScope(current)) return false;
  const namedSpeaker = /\b(?:when|where|who|speaking|presenting)\b|いつ|どこ|誰|登壇/iu.test(text)
    && mentionsKnownSpeaker(text, index);
  const seminarWebsite = !hasNamedProfileRequest(text)
    && /\b(?:the|this|official)\s+website\b|\bwebsite\s+(?:updates?|changes?)\b|^\s*website[?.!]*\s*$/iu.test(text);
  return isNextSeminarQuestion(text)
    || namedSpeaker
    || seminarWebsite
    || /[’']s\s+(?:talk|lecture)\b/iu.test(text)
    || /\b(?:tps|seminars?|schedules?|speakers?|speaking|venues?|organizers?|participants?|campus|komaba|hiyoshi|waseda|locations?|directions|access|workshops?|talks|lectures)\b|\b(?:the|this|that|next|past|previous|whose|which)\s+(?:talk|lecture)\b|セミナー|講演|講師|先生|登壇|参加者|会場|幹事|キャンパス|アクセス|場所|行き方|日時|予定|日程|公式サイト|最寄り駅|tokyo-probability-seminar23/iu.test(text);
}

const OBJECT_WORDS = new Set((
  "the a an this that it its he she who what which next previous last current recent "
  + "seminar speaker organizer author title result theorem lemma conjecture proof equation process "
  + "critical stochastic random probability conditional expectation brownian motion matrix algebra "
  + "geometry geometric topology mathematics kpz spde pde research affiliation university of in on about news "
  + "algebraic eigenvalue eigenvalues statistics statistical analysis measure set group ring field function "
  + "integral derivative limit convergence website homepage webpage position profile biography publications"
).split(/\s+/u));

function looksLikePersonName(value) {
  const name = value.trim().replace(/^(?:professor|prof\.?|dr\.?)\s+/iu, "");
  if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}々ー・]{2,24}$/u.test(name)) {
    return !/(?:過程|定理|方程式|確率|構成|証明|セミナー|講演|この|その|あの|誰)/u.test(name);
  }
  const words = name.split(/\s+/u);
  return words.length >= 2 && words.length <= 5
    && words.every((word) => /^[\p{L}\p{M}][\p{L}\p{M}'’.-]*$/u.test(word) && !OBJECT_WORDS.has(word.toLowerCase()));
}

function hasNamedProfileRequest(text) {
  const questions = text.replace(/^(?:Previous topic|Current question):\s*/gmu, "").split(/\n+/u);
  const patterns = [
    /^(?:who\s+is|who's|tell\s+me\s+about|introduce)\s+(.+?)[?.!]*$/iu,
    /^what(?:\s+is|\s+are|'s)\s+(.+?)[’']s\s+(?:current\s+|official\s+)?(?:affiliation|position|institution|research|publications?|papers?|profile|career|homepage|website|webpage)[?.!]*$/iu,
    /^where\s+does\s+(.+?)\s+work(?:\s+now)?[?.!]*$/iu,
    /^(.+?)(?:[’']s)?\s+(?:current\s+|official\s+)?(?:affiliation|position|institution|research|publications?|profile|biography|homepage|website|webpage)[?.!]*$/iu,
    /^(.+?)(?:氏|先生|教授)?(?:は|って)(?:誰|どんな人)(?:ですか|なの|か)?[?？。]*$/u,
    /^(.+?)(?:氏|先生|教授)?の(?:所属|研究|論文|業績|経歴|略歴|プロフィール|ホームページ)(?:は|を)?(?:何|教えて|調べて|紹介して)?(?:ですか|ください)?[?？。]*$/u,
    /^(.+?)(?:氏|先生|教授)?について教えて(?:ください)?[?？。]*$/u,
  ];
  return questions.some((question) => {
    const original = question.trim();
    const action = /^(?:please\s+)?(?:search(?:\s+for)?|look\s+up|find|browse)\s+/iu;
    const candidate = original.replace(action, "").replace(/[?.!]+$/u, "");
    if (action.test(original) && looksLikePersonName(candidate)) return true;
    return [original, candidate].some((query) => patterns.some((pattern) => {
      const match = query.match(pattern);
      return match && looksLikePersonName(match[1]);
    }));
  });
}

export function needsPeopleContext(message, index) {
  const { text, current } = requestText(message);
  if (outsidePeopleScope(current)) return false;
  const profile = /\bwho(?:\s+is|'s)|\btell\s+me\s+about\b|\b(?:search|browse|look\s+up|find|profiles?|biograph(?:y|ies)|affiliations?|research|publications?|papers?|work|works|working|positions?|institutions?|universit(?:y|ies)|department|homepage|website|webpage|cv|career|contributions?)\b|\bwhat\s+did\s+(?:he|she|they)\s+(?:prove|introduce|construct)\b|誰|どんな人|プロフィール|略歴|所属|研究|論文|業績|勤務|勤め|大学|研究機関|ホームページ|経歴|紹介|について教えて/iu.test(text);
  if (!profile) return false;
  const profession = /\b(?:mathematicians?|probabilists?|mathematics?\s+(?:professors?|researchers?)|professors?\s+of\s+mathematics)\b|数学者|数学(?:の)?(?:教授|研究者)|確率論(?:の)?研究者/iu.test(text);
  const participantDetails = /\b(?:profiles?|biograph(?:y|ies)|affiliations?|research|publications?|papers?|work|works|working|positions?|institutions?|universit(?:y|ies)|department|homepage|website|webpage|cv|career|contributions?)\b|\btell\s+me\s+about\s+(?:the\s+|this\s+|that\s+)?(?:seminar\s+)?(?:speaker|organizer|participant)\b|プロフィール|略歴|所属|研究|論文|業績|勤務|勤め|大学|研究機関|ホームページ|経歴|紹介/iu.test(current);
  return profession || mentionsKnownSpeaker(text, index) || hasNamedProfileRequest(text)
    || (participantDetails && needsSeminarContext(text, index));
}
