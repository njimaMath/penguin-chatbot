import assert from "node:assert/strict";
import test from "node:test";
import { buildIndex, needsAbstractRetrieval, retrieveAbstracts } from "../search.js";

const next = {
  year: 2026, month: 11, day: 16, dateLabel: "2026年11月16日（月）", venue: "Room 002",
  talks: [{ speaker: "Federica Iacovissi", title: "The Matrix Product Ansatz", abstract: "A probabilistic characterization using a Markov bridge." }],
};
const index = buildIndex([
  { year: 2026, month: 7, day: 27, dateLabel: "2026年7月27日（月）", venue: "Old room", talks: [
    { speaker: "Past Speaker", title: "About the next seminar research topic", abstract: "A past abstract with next seminar research and topic keywords." },
  ] },
  next,
]);

test("recognizes ordinary English content and summary questions", () => {
  for (const question of [
    "What is the next seminar about?", "Explain the next talk", "Summarize Federica Iacovissi's research",
    "What is the content of this lecture?", "Give me a summary of the topic", "次のセミナーの内容を教えて",
  ]) assert.equal(needsAbstractRetrieval(question), true, question);
});

test("upcoming content uses the chosen next date instead of a keyword-matching past talk", () => {
  for (const question of ["What is the next seminar about?", "Explain the upcoming talk", "次のセミナーの内容を教えて", "次回の要旨は？"]) {
    const result = retrieveAbstracts(question, index, { nextSeminar: next });
    assert.equal(result.kind, "lookup");
    assert.equal(result.confidence, "high");
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].speaker, "Federica Iacovissi");
    assert.match(result.items[0].abstract, /Markov bridge/u);
  }
});

test("an absent next seminar yields no abstract rather than a past substitute", () => {
  for (const options of [undefined, { nextSeminar: null }]) {
    const result = retrieveAbstracts("What is the next seminar about?", index, options);
    assert.deepEqual(result.items, []);
    assert.equal(result.confidence, "none");
  }
});

test("specific English speaker summaries still retrieve that speaker's abstract", () => {
  const result = retrieveAbstracts("Summarize Federica Iacovissi's research", index);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].speaker, "Federica Iacovissi");
  assert.match(result.items[0].abstract, /Markov bridge/u);
});

test("an unannounced upcoming abstract remains missing", () => {
  const missing = { ...next, talks: [{ speaker: "Next Speaker", title: "", abstract: "" }] };
  const result = retrieveAbstracts("What is the next seminar about?", buildIndex([missing]), { nextSeminar: missing });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].abstractMissing, true);
  assert.equal(result.items[0].abstract, "");
});
