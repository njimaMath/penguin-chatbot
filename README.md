Penguin Chatbot answers questions about the Tokyo Probability Seminar.

Chatbot: https://penguin-chatbot.onrender.com

Official schedule: https://sites.google.com/view/tokyo-probability-seminar23

The default OpenRouter model is `deepseek/deepseek-v4.1-flash-1017`, the October 17, 2026 snapshot of DeepSeek V4.1 Flash. Model details: https://openrouter.ai/deepseek/deepseek-v4.1-flash-1017

To run locally, install dependencies with `npm ci`, copy `.env.example` to `.env`, set `OPENROUTER_API_KEY`, then run `npm start`. Open http://localhost:3000. Keep the API key on the server.

`OPENROUTER_MODEL` optionally overrides the default model without a code change. The client requests reasoning off and allows up to 1,200 output tokens for concise seminar answers. It makes at most two attempts, each with a 20-second deadline including the response body. Authentication and other permanent HTTP errors are not retried.

On Render, set `OPENROUTER_API_KEY` in the service environment. Remove any old `OPENROUTER_MODEL` override or set it to `deepseek/deepseek-v4.1-flash-1017`, then deploy the updated code. `/health` reports the configured model and seminar data freshness.

Run `npm test` for parser, next-seminar, and mocked OpenRouter checks. These checks do not use a real API key or incur API charges. `node test/run-regression.mjs` also checks chat routes; its LLM cases run only when `OPENROUTER_API_KEY` is set in the shell environment.
