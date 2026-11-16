// search.js — 要旨に対する #5(特定講演lookup) と #6(テーマ横断検索)。
// 初回ローンチは BM25 + 構造マッチのみ(意味検索=埋め込みは Step2.5 後追い)。
// 専用ベクトルDBは使わない(数百件規模はメモリ総当たりで一瞬)。

// --- トークナイズ: 英数はsplit、日本語はbi-gram(形態素解析器なし) ---
export function tokenize(text) {
  const s = String(text ?? "").toLowerCase();
  const tokens = [];
  // 英数語(neural, network, n など)
  for (const m of s.matchAll(/[a-z0-9]+/g)) {
    if (m[0].length >= 2) tokens.push(m[0]);
  }
  // CJK 連続をbi-gram化(拡散過程→拡散/散過/過程)。1字のみの連は unigram。
  for (const m of s.matchAll(/[぀-ヿ一-鿿]+/g)) {
    const run = m[0];
    if (run.length === 1) tokens.push(run);
    for (let i = 0; i + 1 < run.length; i += 1) tokens.push(run.slice(i, i + 2));
  }
  return tokens;
}

// --- 検索インデックス(要旨保有の talk を文書とする) ---
export function buildIndex(seminars) {
  const docs = [];
  for (const s of seminars) {
    for (const t of s.talks) {
      docs.push({
        year: s.year, month: s.month, day: s.day,
        dateLabel: s.dateLabel,
        venue: t.venue || s.venue,
        speaker: t.speaker || "",
        title: t.title || "",
        abstract: t.abstract || "",
        hasAbstract: Boolean(t.abstract),
        tokens: tokenize(`${t.title} ${t.abstract}`),
      });
    }
  }
  const corpus = docs.filter((d) => d.hasAbstract);
  const N = corpus.length || 1;
  const df = new Map();
  for (const d of corpus) {
    for (const term of new Set(d.tokens)) df.set(term, (df.get(term) || 0) + 1);
  }
  const avgdl = corpus.reduce((a, d) => a + d.tokens.length, 0) / N;
  return { docs, corpus, df, N, avgdl };
}

function idf(term, index) {
  const df = index.df.get(term) || 0;
  return Math.max(0, Math.log(1 + (index.N - df + 0.5) / (df + 0.5)));
}

function bm25(queryTokens, doc, index, k1 = 1.2, b = 0.75) {
  const tf = new Map();
  for (const tk of doc.tokens) tf.set(tk, (tf.get(tk) || 0) + 1);
  let score = 0;
  const dl = doc.tokens.length || 1;
  for (const q of new Set(queryTokens)) {
    const f = tf.get(q) || 0;
    if (!f) continue;
    score += idf(q, index) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * dl / index.avgdl));
  }
  return score;
}

// --- 日付/講師名の構造マッチ用ヘルパ ---
function parseQueryDate(query) {
  let m = query.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/u);
  if (m) return { year: +m[1], month: +m[2], day: +m[3] };
  m = query.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/u);
  if (m) return { month: +m[1], day: +m[2] };
  m = query.match(/(\d{1,2})[\/.](\d{1,2})/u);
  if (m) return { month: +m[1], day: +m[2] };
  return null;
}

function speakerCandidates(speaker) {
  const noSpace = speaker.replace(/\s+/g, "");
  const parts = speaker.split(/\s+/).filter((p) => p.length >= 2);
  return [noSpace, ...parts].map((x) => x.toLowerCase()).filter(Boolean);
}

function speakerMatches(query, speaker) {
  if (!speaker) return false;
  const q = query.toLowerCase().replace(/\s+/g, "");
  return speakerCandidates(speaker).some((c) => q.includes(c.replace(/\s+/g, "")));
}

// --- #5 特定講演の要旨を1件だけ返す(日付>タイトル>講師の優先) ---
export function lookupAbstract(query, index) {
  const qd = parseQueryDate(query);
  if (qd) {
    const hits = index.docs.filter(
      (d) => d.month === qd.month && d.day === qd.day && (qd.year ? d.year === qd.year : true)
    );
    if (hits.length) {
      // 年指定なしなら最新年を優先(ユーザーは直近/今期の回を指すことが多い)
      hits.sort((a, b) => b.year - a.year || b.month - a.month || b.day - a.day);
      return [hits[0]];
    }
  }
  const titleHit = index.docs.find((d) => d.title && query.includes(d.title.slice(0, 12)));
  if (titleHit) return [titleHit];
  const speakerHits = index.docs.filter((d) => speakerMatches(query, d.speaker));
  if (speakerHits.length) return speakerHits.slice(0, 3);
  return [];
}

// --- #6 テーマ横断検索(BM25 + 構造ブースト)。弱ヒットはconfidence:lowで返す ---
export function hybridSearch(query, index, k = 3) {
  const qTokens = [...new Set(tokenize(query))];
  const scored = index.corpus
    .map((d) => {
      let score = bm25(qTokens, d, index);
      if (speakerMatches(query, d.speaker)) score += 5; // 構造ブースト
      // クエリ語のうち何種類がこの文書に出現したか(カバレッジ)
      const docSet = new Set(d.tokens);
      const matched = qTokens.filter((q) => docSet.has(q)).length;
      const coverage = qTokens.length ? matched / qTokens.length : 0;
      return { doc: { ...d, score }, score, coverage };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  if (!scored.length) return { items: [], confidence: "none" };
  const best = scored[0];
  // 高信頼は「スコアが十分高く、かつクエリ語の過半が一致」した時のみ。
  // (「機械学習」のような語彙ミスマッチは部分bi-gram一致で低スコア高noise→low/none に落とす)
  let confidence = "none";
  if (best.score >= 4 && best.coverage >= 0.5) confidence = "high";
  else if (best.score >= 2.5) confidence = "low";
  return { items: scored.map((x) => x.doc), confidence };
}

// --- この質問は要旨の中身が必要か(ヒューリスティック単線) ---
export function needsAbstractRetrieval(message) {
  return /(内容|中身|要旨|概要|アブストラクト|abstract|どんな(話|研究|内容|こと)|に関係|に関連|扱った|について|テーマ|分野|研究は|話した)/iu.test(message)
    || /\b(?:about|contents?|summar(?:y|ies|ize|ise)|explain|research|topics?)\b/iu.test(message);
}

// --- ファサード: server.js から呼ぶ。lookup(特定) か search(テーマ) を判定して返す ---
export function retrieveAbstracts(message, index, { nextSeminar } = {}) {
  const asksNext = /\b(?:next|upcoming)\s+(?:seminar|talk|lecture)\b/iu.test(message)
    || /(?:次(?:回)?|今後|これから)(?:の)?(?:セミナー|講演)|次回/u.test(message);
  const isSpecific = parseQueryDate(message) || index.docs.some((d) => speakerMatches(message, d.speaker));
  let docs = [];
  let confidence = "high";
  let kind = "lookup";
  if (asksNext) {
    // A request for the next talk must not fall back to a similar past abstract.
    docs = nextSeminar ? index.docs.filter((d) => d.year === nextSeminar.year
      && d.month === nextSeminar.month && d.day === nextSeminar.day) : [];
    if (!docs.length) confidence = "none";
  } else if (isSpecific) {
    docs = lookupAbstract(message, index);
  } else {
    kind = "search";
    const r = hybridSearch(message, index);
    docs = r.items;
    confidence = r.confidence;
  }
  const items = docs.map((d) => ({
    dateLabel: d.dateLabel,
    speaker: d.speaker,
    title: d.title || "未掲載",
    abstract: d.abstract || "",
    abstractMissing: !d.abstract,
  }));
  return { items, confidence, kind };
}
