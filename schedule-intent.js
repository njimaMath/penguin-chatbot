// Only generic schedule requests bypass the LLM. A date, speaker or topic in
// the question needs the full seminar lookup instead of the next event alone.
export function isNextSeminarQuestion(message) {
  const text = String(message ?? "").normalize("NFKC").trim().toLowerCase();
  const english = text.replace(/\s+/gu, " ")
    .replace(/[?!.]+$/gu, "")
    .replace(/\s+please$/u, "")
    .replace(/^(?:(?:can|could|would) you\s+)?(?:please\s+)?(?:(?:tell|show|give) me(?:\s+about)?|search(?:\s+for)?|find|check|look up|what(?:\s+is|\s+are|'s)|when(?:\s+is|\s+are|'s)|where(?:\s+is|\s+are|'s)|who(?:\s+is|\s+are|'s))\s+/u, "")
    .replace(/^please\s+/u, "")
    .replace(/^the\s+/u, "");

  if (/^(?:next|upcoming|future) (?:seminars?|talks?|lectures?|speakers?)(?: schedule)?$/u.test(english)
    || /^(?:(?:new|latest|recent|current|updated|next|upcoming|future) )?(?:(?:seminar|talk|lecture) )?schedule$/u.test(english)
    || /^schedule (?:of|for) (?:the )?(?:next|upcoming|future) (?:seminars?|talks?|lectures?)$/u.test(english)) {
    return true;
  }

  const japanese = text.replace(/\s+/gu, "").replace(/[?？!！。]+$/gu, "");
  const request = "(?:は|を|について)?(?:教えて(?:ください)?|知りたい(?:です)?|確認したい(?:です)?|お願い(?:します)?|(?:いつ|どこ|誰|何時)(?:ですか)?|ありますか|ですか)?";
  const schedule = "(?:(?:次(?:回)?|今後|これから|直近|最新|新しい)(?:の)?(?:セミナー|講演|予定|日程|スケジュール)(?:の(?:予定|日程|スケジュール))?|(?:セミナー|講演)(?:の)?(?:予定|日程|スケジュール)|予定|日程|スケジュール|次回|次はいつ)";
  return new RegExp(`^${schedule}(?:の(?:時間|日時|会場|場所|講師|タイトル))?${request}$`, "u").test(japanese);
}
