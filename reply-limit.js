export const MAX_REPLY_WORDS = 100;

function words(text, language) {
  const segmenter = new Intl.Segmenter(language === "ja" ? "ja" : "en", { granularity: "word" });
  return [...segmenter.segment(text)].filter((part) => part.isWordLike);
}

export function wordCount(text, language = "en") {
  return words(String(text ?? ""), language).length;
}

export function limitReplyWords(text, language = "en", maximum = MAX_REPLY_WORDS) {
  const original = String(text ?? "");
  const limit = Number.isFinite(Number(maximum)) ? Math.max(0, Math.floor(Number(maximum))) : MAX_REPLY_WORDS;
  const segments = words(original, language);
  const exceedsLimit = segments.length > limit;
  let cut = exceedsLimit ? segments[limit].index : original.length;
  let delimiter = null;
  let opening = -1;
  for (let index = 0; index < cut; index += 1) {
    if (original[index] !== "$") continue;
    let slashes = 0;
    for (let previous = index - 1; previous >= 0 && original[previous] === "\\"; previous -= 1) slashes += 1;
    if (slashes % 2) continue;
    const token = original[index + 1] === "$" ? "$$" : "$";
    if (delimiter === null) {
      delimiter = token;
      opening = index;
    } else if (delimiter === token) {
      delimiter = null;
      opening = -1;
    }
    index += token.length - 1;
  }
  // Drop a partial formula instead of sending unmatched MathJax delimiters.
  if (delimiter !== null) cut = opening;
  else if (!exceedsLimit) return original;
  const shortened = original.slice(0, cut).trimEnd();
  if (shortened) return `${shortened}…`;
  const fallback = language === "ja"
    ? "式が長いため、短い部分に分けて聞いてね。"
    : "Please ask for a shorter part of the formula.";
  return wordCount(fallback, language) <= limit ? fallback : "…";
}
