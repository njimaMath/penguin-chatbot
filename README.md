Penguin Chatbot answers questions about the Tokyo Probability Seminar and mathematics. Replies follow the question's language: English or Japanese. Seminar help includes upcoming and past talks, venues, access links, organizers, and related practical information; unrelated requests are outside its scope.

Chatbot: https://penguin-chatbot-5mee.onrender.com

Official schedule: https://sites.google.com/view/tokyo-probability-seminar23

The default OpenRouter model is `deepseek/deepseek-v4.1-flash-1017`, the October 17, 2026 snapshot of DeepSeek V4.1 Flash. Model details: https://openrouter.ai/deepseek/deepseek-v4.1-flash-1017

To run locally, install dependencies with `npm ci`, copy `.env.example` to `.env`, set `OPENROUTER_API_KEY`, then run `npm start`. Open http://localhost:3000. Keep the API key on the server.

`OPENROUTER_MODEL` optionally overrides the default model without a code change. Reasoning is set to `low`, with reasoning text excluded from replies. Replies are capped at 200 segmented words in English or Japanese, and the total generation budget is 1,000 tokens including reasoning. Normal requests allow two attempts with a 20-second deadline each; web research allows one attempt with a 45-second deadline to avoid repeating a paid search.

For seminar questions, the server reads the current academic-year page, such as https://sites.google.com/view/tokyo-probability-seminar23/2026年度, and caches it for one hour. An explicit search request such as "search the next schedule" forces a refresh; failed requests have a one-minute retry cooldown. Source links and the data check time appear below answers. If the website cannot be reached, saved data remains available with a freshness warning. This does not require an additional search API key.

The live reader replaces current-year records, including removed or corrected entries, while retaining the saved seminar history. `npm run scrape` refreshes the saved snapshot and archives; the daily GitHub workflow also runs this command. Google Sites dates with split digits are supported, and individual room numbers override the general venue. `/health` reports the model, next seminar, source URL, check time, and freshness.

Math answers use general mathematical knowledge independently of seminar data. Recent advances, mathematical attribution, and explicit reference searches enable OpenRouter web search with up to three results using Parallel Turbo. Routine explanations and proofs skip search, and unrelated topics stay outside scope. Search is charged to the existing OpenRouter account; no additional API key is required. Current search details and pricing: https://openrouter.ai/docs/guides/features/plugins/web-search

Returned search citations appear as source links beneath the reply. A search with no valid source URLs produces a short verification failure instead of an unverified research answer. The policy asks for primary sources, correct dimensions and critical regimes, and no invented authors or results. Empty seminar metadata is omitted from mathematical prompts.

The supported web plugin performs one search before inference; it is deprecated in favor of OpenRouter server tools, which allow model-directed searches. This app uses the plugin to bound the number of searches and ensure a requested lookup is performed. Formula output uses dollar delimiters and MathJax, loaded from jsDelivr.

On Render, set `OPENROUTER_API_KEY` in the service environment. Remove any old `OPENROUTER_MODEL` override or set it to `deepseek/deepseek-v4.1-flash-1017`, then deploy the updated code. Keep `NODE_ENV=production`; the fixed `PENGUIN_TEST_NOW` clock is honored only with `NODE_ENV=test`.

Run `npm test` for parsing, live-source/cache behavior, English/Japanese routing, math policy, and mocked OpenRouter/chat checks. These checks do not use a real API key or incur API charges. `node test/run-regression.mjs` also checks chat routes; its LLM cases run only when `OPENROUTER_API_KEY` is set in the shell environment.
