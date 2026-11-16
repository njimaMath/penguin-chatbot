export const DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash-1017";

const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const SITE_URL = "https://sites.google.com/view/tokyo-probability-seminar23";
const MAX_ATTEMPTS = 2;

export function getOpenRouterModel(env = process.env) {
  return env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL;
}

class OpenRouterError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "OpenRouterError";
    this.status = status;
    this.retryable = status === 429 || (status >= 500 && status < 600);
  }
}

// Both attempts together fit within the chat UI's 60-second timeout.
export async function callOpenRouter(systemContent, userMessage, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = 20000,
} = {}) {
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");

  const body = JSON.stringify({
    model: getOpenRouterModel(env),
    temperature: 0.2,
    max_tokens: 1200,
    // Short factual answers should not spend their output budget on thinking.
    reasoning: { enabled: false },
    messages: [
      { role: "system", content: systemContent },
      { role: "user", content: userMessage },
    ],
  });

  let lastError;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(API_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": SITE_URL,
          "X-Title": "Penguin Chatbot",
        },
        body,
      });

      let data;
      try {
        data = await response.json();
      } catch (error) {
        // Keep permanent HTTP errors permanent even when the body is not JSON.
        if (!response.ok) {
          throw new OpenRouterError(`OpenRouter API error: ${response.status}`, response.status);
        }
        throw error;
      }

      // OpenRouter can also send an error envelope with HTTP 200.
      if (!response.ok || data?.error) {
        const status = response.ok ? Number(data.error.code) : response.status;
        throw new OpenRouterError(data?.error?.message || `OpenRouter API error: ${status}`, status);
      }

      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        throw new Error("OpenRouter returned no answer text");
      }
      return content.trim();
    } catch (error) {
      if (error instanceof OpenRouterError && !error.retryable) throw error;
      lastError = error;
    } finally {
      // The deadline includes reading the response body, not just the headers.
      clearTimeout(timer);
    }
  }
  throw lastError;
}
