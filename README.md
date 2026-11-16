Penguin Chatbot answers questions about the Tokyo Probability Seminar, mathematics, and the public academic work of mathematicians and seminar participants. Replies follow the question's language: English or Japanese. Seminar help includes upcoming and past talks, venues, directions, organizers, contacts, registration, and related practical information; unrelated requests are outside its scope.

Chatbot: https://penguin-chatbot-5mee.onrender.com

Official schedule: https://sites.google.com/view/tokyo-probability-seminar23

The default OpenRouter model is `deepseek/deepseek-v4.1-flash-1017`, the October 17, 2026 snapshot of DeepSeek V4.1 Flash. Model details: https://openrouter.ai/deepseek/deepseek-v4.1-flash-1017

To run locally, install dependencies with `npm ci`, copy `.env.example` to `.env`, set `OPENROUTER_API_KEY`, then run `npm start`. Open http://localhost:3000. Keep the API key on the server.

`OPENROUTER_MODEL` optionally overrides the default model without a code change. The requested reasoning effort is `medium`, with reasoning text excluded from replies. [DeepSeek maps that compatibility setting to its native `high` effort](https://api-docs.deepseek.com/guides/thinking_mode/). Replies are capped at 100 segmented words in English or Japanese, and the total generation budget is 2,000 tokens including reasoning. Normal requests allow two attempts with a 20-second deadline each; web research allows one attempt with a 45-second deadline to avoid repeating a paid search.

For seminar questions, the server reads the current academic-year page, such as https://sites.google.com/view/tokyo-probability-seminar23/2026年度, and caches it for one hour. An explicit search request such as "search the next schedule" forces a refresh; failed requests have a one-minute retry cooldown. Source links and the data check time appear below answers. If the website cannot be reached, saved data remains available with a freshness warning. This does not require an additional search API key.

The live reader replaces current-year records, including removed or corrected entries, while retaining the saved seminar history. `npm run scrape` refreshes the saved snapshot and archives. The `Weekly Seminar Update` GitHub workflow runs every Monday at 09:15 Japan time (00:15 UTC) and also supports manual runs. It validates the current academic-year page, preserves saved archives when those pages temporarily fail, and commits updated `data/data.txt` and `data/freshness.json` to `main`. Normal Render auto-deploys can then pick up that commit. GitHub schedules run after the workflow reaches the default branch, can be delayed, and may be disabled after extended inactivity in a public repository; check the workflow's Actions page if updates stop. Google Sites dates with split digits are supported, and individual room numbers override the general venue. `/health` reports the model, next seminar, source URL, check time, and freshness.

Conversation memory stays in the current browser tab, including page reloads, using `sessionStorage`. The transcript includes user messages, completed replies, source links, and original abstract panels. Each request sends the earlier conversation to the model, so follow-up questions can refer to previous explanations and talks. A new chat clears that tab's transcript. Conversations are not stored in a shared server session or shared with other visitors. If embedded browser storage is blocked, memory works until that page is reloaded.

The model receives all accepted prior message text and source links. To bound request size and cost, a conversation can contain up to 1,000 prior messages, 250,000 total characters, and 16,000 characters per message. Oversized conversations produce a visible request to start a new chat rather than silently discarding earlier turns. Fresh official seminar information takes precedence over older answers in the conversation. Replies remain capped at 100 words.

Math answers use general mathematical knowledge independently of seminar data. Recent advances, mathematical attribution, explicit reference searches, and public academic profiles of mathematicians or seminar participants enable OpenRouter web search with up to three results using Parallel Turbo. Practical seminar questions can search official venue, university, and transport pages when directions are requested, facts are missing, or a lookup is explicit. Current official seminar dates and rooms take precedence over other sources. Routine explanations and proofs skip search, and unrelated topics stay outside scope. Search is charged to the existing OpenRouter account; no additional API key is required. Current search details and pricing: https://openrouter.ai/docs/guides/features/plugins/web-search

Returned search citations appear as source links beneath the reply. A search with no valid source URLs produces a short verification failure instead of an unverified research answer. The policy asks for primary sources, correct dimensions and critical regimes, and no invented authors or results. Empty seminar metadata is omitted from mathematical prompts.

The supported web plugin performs one search before inference; OpenRouter also offers server tools that allow model-directed searches. This app uses the plugin to bound the number of searches and ensure a requested lookup is performed. Formula output uses dollar delimiters and MathJax, loaded from jsDelivr when formula rendering is needed.

On Render, set `OPENROUTER_API_KEY` in the service environment. Remove any old `OPENROUTER_MODEL` override or set it to `deepseek/deepseek-v4.1-flash-1017`, then deploy the updated code. Keep `NODE_ENV=production`; the fixed `PENGUIN_TEST_NOW` clock is honored only with `NODE_ENV=test`.

For a fast-loading Google Sites embed, deploy the frontend as a separate Render Static Site. [render.yaml](render.yaml) defines the new `penguin-chatbot-ui` static service, publishing only `public/`. The existing backend at https://penguin-chatbot-5mee.onrender.com and its API key remain separately managed. Static hosting has no compute charge, subject to Render's bandwidth and build allowances. See [Render Static Sites](https://render.com/docs/static-sites) and the [Blueprint reference](https://render.com/docs/blueprint-spec).

1. After these files reach `main`, open Render's dashboard, choose New > Blueprint, connect this repository, select `main`, and review the proposed static service before creating it. Alternatively, choose New > Static Site with this repository and branch `main`: leave Root Directory blank, set Build Command to `echo "Publishing static chatbot files"`, Publish Directory to `public`, and environment variable `SKIP_INSTALL_DEPS` to `true`. Choose one creation method. No frontend compilation or npm installation is needed.
2. Open the static site's URL assigned by Render; copy it from the dashboard instead of assuming a URL from the service name. Verify that the penguin and input appear without waiting for the backend, send English and Japanese questions, and check that a mathematical answer renders correctly. Verify the new URL inside the Google Sites embed preview as well.
3. In the Google Sites editor, replace only the existing chatbot embed URL with the verified static URL, then publish the Google Site. Keep the existing backend service and `OPENROUTER_API_KEY` setting. This Blueprint does not deploy or reconfigure that backend.

The frontend uses the existing production backend by default when hosted remotely. On `localhost`, it uses the same origin. To use another backend, set the public `window.PENGUIN_API_BASE` value in an inline script in `public/index.html` before the client script runs, for example `window.PENGUIN_API_BASE = "https://penguin-chatbot-5mee.onrender.com";`. This is a public API address, not a secret; never place an API key in the static frontend. Changing a Render environment variable does not rewrite this browser setting.

After the frontend paints, it sends one background `/health` request to wake the backend without calling a model. MathJax loads only when needed. The page can display while a free backend wakes; the first chat response may still wait. [Render's free-service limits](https://render.com/docs/free) describe idle sleep and startup delays.

The static Blueprint adds no frame-blocking headers. Keep the frontend embeddable: do not add `X-Frame-Options: DENY` or `SAMEORIGIN`, or a Content Security Policy whose `frame-ancestors` excludes Google Sites. The backend must accept cross-origin requests from the static site's origin; its current CORS configuration does so.

The project is organized by responsibility:

```text
src/app.js          Express app and chat routes
src/paths.js        Absolute repository, public, and data paths
src/chat/           Conversation, language, scope, search, and reply limits
src/seminars/       Schedule parsing, official sources, cache, and abstracts
src/services/      OpenRouter integration
scripts/           Scraper and test runner
data/              Saved seminar records and freshness metadata
public/            Chat interface and penguin images
tests/             Offline checks and optional live regression cases
```

Root `server.js` and `scrape.js` remain compatible launchers. Use `npm start`, `npm run scrape`, and `npm test` for normal development. Paths resolve from the repository, so data and public files do not depend on the launch directory.

Run `npm test` for parsing, live-source/cache behavior, English/Japanese routing, conversation memory, weekly refresh safeguards, math and people policy, mocked OpenRouter/chat checks, nonblocking frontend startup, lazy formulas, and cross-origin static hosting. These checks do not use a real API key or incur API charges. `npm run test:regression` also checks chat routes; its LLM cases run only when `OPENROUTER_API_KEY` is set in the shell environment.
