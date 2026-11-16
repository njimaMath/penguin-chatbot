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

// Ordinary requests allow one retry; searched requests use one bounded paid attempt.
export async function callOpenRouterWithSources(systemContent, userMessage, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  webSearch = false,
  timeoutMs = webSearch ? 45000 : 20000,
  maxTokens = 1000,
} = {}) {
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");

  const body = JSON.stringify({
    model: getOpenRouterModel(env),
    temperature: 0.2,
    max_tokens: maxTokens,
    reasoning: { effort: "low", exclude: true },
    messages: [
      { role: "system", content: systemContent },
      { role: "user", content: userMessage },
    ],
    ...(webSearch ? { plugins: [webSearchPlugin()] } : {}),
  });

  let lastError;
  const attempts = webSearch ? 1 : MAX_ATTEMPTS;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
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

      const message = data?.choices?.[0]?.message;
      const content = message?.content;
      if (typeof content !== "string" || !content.trim()) {
        throw new Error("OpenRouter returned no answer text");
      }
      const sources = extractWebSources(message.annotations);
      if (webSearch && !sources.length) {
        const error = new Error("Web search returned no verifiable sources");
        error.code = "WEB_SEARCH_NO_SOURCES";
        throw error;
      }
      return { reply: content.trim(), sources, webSearchUsed: webSearch && sources.length > 0 };
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
import { extractWebSources, webSearchPlugin } from "./web-search.js";


export async function callOpenRouter(...args) {
  return (await callOpenRouterWithSources(...args)).reply;
}
