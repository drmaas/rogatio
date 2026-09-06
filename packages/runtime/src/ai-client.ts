export interface AIProviderConfig {
  providerUrl: string;
  model: string;
  apiKey: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: unknown[];
  tool_call_id?: string;
}

export interface AICompletionOptions {
  messages: ChatMessage[];
  model: string;
  temperature?: number;
  stream?: boolean;
  responseFormat?: { type: "json_object" };
  signal?: AbortSignal;
}

export interface AICompletionResult {
  content: string;
  usage?: { promptTokens: number; completionTokens: number };
}

export interface AIStreamChunk {
  delta: string;
  done: boolean;
  usage?: { promptTokens: number; completionTokens: number };
}

export interface AIClient {
  complete(options: AICompletionOptions): Promise<AICompletionResult>;
  stream(options: AICompletionOptions): AsyncIterable<AIStreamChunk>;
}

const MAX_RETRIES = 2;
const RETRY_DELAY_BASE = 1000;
const COMPLETE_TIMEOUT = 60_000;
const STREAM_TIMEOUT = 120_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateRetryDelay(attempt: number): number {
  return RETRY_DELAY_BASE * 2 ** attempt + Math.random() * 100;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), COMPLETE_TIMEOUT);

      if (signal) {
        signal.addEventListener("abort", () => controller.abort());
      }

      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        return response;
      }

      // Retry on 429 (rate limit) and 5xx errors
      const shouldRetry = response.status === 429 || response.status >= 500;
      if (shouldRetry && attempt < MAX_RETRIES) {
        const retryAfter = response.headers.get("Retry-After");
        const delay = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : calculateRetryDelay(attempt);
        await sleep(Math.min(delay, 10_000));
        continue;
      }

      const errorText = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    } catch (e) {
      lastError = e as Error;
      if (e instanceof DOMException && e.name === "AbortError") {
        throw e;
      }
      if (attempt < MAX_RETRIES && (e as Error).name !== "AbortError") {
        await sleep(calculateRetryDelay(attempt));
        continue;
      }
      throw e;
    }
  }

  throw lastError;
}

async function fetchStreamWithRetry(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), STREAM_TIMEOUT);

      if (signal) {
        signal.addEventListener("abort", () => controller.abort());
      }

      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        return response;
      }

      // Retry on 429 (rate limit) and 5xx errors
      const shouldRetry = response.status === 429 || response.status >= 500;
      if (shouldRetry && attempt < MAX_RETRIES) {
        const retryAfter = response.headers.get("Retry-After");
        const delay = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : calculateRetryDelay(attempt);
        await sleep(Math.min(delay, 10_000));
        continue;
      }

      const errorText = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    } catch (e) {
      lastError = e as Error;
      if (e instanceof DOMException && e.name === "AbortError") {
        throw e;
      }
      if (attempt < MAX_RETRIES && (e as Error).name !== "AbortError") {
        await sleep(calculateRetryDelay(attempt));
        continue;
      }
      throw e;
    }
  }

  throw lastError;
}

function sanitizeResponse(text: string): string {
  return text;
}

export function createAIClient(config: AIProviderConfig): AIClient {
  const baseUrl = config.providerUrl.replace(/\/$/, "");
  const chatUrl = `${baseUrl}/chat/completions`;

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey}`,
  };

  return {
    async complete(options: AICompletionOptions): Promise<AICompletionResult> {
      const body = JSON.stringify({
        model: options.model,
        messages: options.messages,
        temperature: options.temperature ?? 0.7,
        stream: false,
        response_format: options.responseFormat,
      });

      const response = await fetchWithRetry(
        chatUrl,
        {
          method: "POST",
          headers,
          body,
        },
        options.signal,
      );

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
        usage?: { prompt_tokens: number; completion_tokens: number };
      };

      const content = data.choices[0]?.message?.content ?? "";
      const usage = data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
          }
        : undefined;

      return { content: sanitizeResponse(content), usage };
    },

    async *stream(options: AICompletionOptions): AsyncIterable<AIStreamChunk> {
      const body = JSON.stringify({
        model: options.model,
        messages: options.messages,
        temperature: options.temperature ?? 0.7,
        stream: true,
        stream_options: { include_usage: true },
      });

      const response = await fetchStreamWithRetry(
        chatUrl,
        {
          method: "POST",
          headers,
          body,
        },
        options.signal,
      );

      if (!response.body) {
        throw new Error("No response body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          if (options.signal?.aborted) {
            throw new DOMException("Aborted", "AbortError");
          }

          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data) as {
                choices: Array<{
                  delta: { content?: string };
                  finish_reason?: string;
                }>;
                usage?: { prompt_tokens: number; completion_tokens: number };
              };

              const delta = parsed.choices[0]?.delta?.content ?? "";
              const finishReason = parsed.choices[0]?.finish_reason;
              const usage = parsed.usage
                ? {
                    promptTokens: parsed.usage.prompt_tokens,
                    completionTokens: parsed.usage.completion_tokens,
                  }
                : undefined;

              if (delta) {
                yield { delta, done: false };
              }

              if (finishReason === "stop") {
                yield { delta: "", done: true, usage };
                return;
              }
            } catch {
              // Ignore parse errors for malformed chunks
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      yield { delta: "", done: true };
    },
  };
}
