import Anthropic from "@anthropic-ai/sdk";

/**
 * Shared Claude AI configuration for the RadioRevise app.
 * Centralises model version, client creation, and retry logic
 * so upgrades only need a single change.
 */

// ── Model configuration ──────────────────────────────────────────────────────
export const CLAUDE_MODEL = "claude-sonnet-4-20250514";
export const CLAUDE_MODEL_FAST = "claude-haiku-4-5-20251001";

// ── Client factory ───────────────────────────────────────────────────────────
export function getClaudeClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not configured. Add it in Vercel → Settings → Environment Variables and redeploy."
    );
  }
  return new Anthropic();
}

// ── Timeout helper ───────────────────────────────────────────────────────────
export function withTimeout<T>(promise: Promise<T>, ms: number, label = "operation"): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms / 1000}s`)),
      ms
    );
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

// ── Non-streaming retry wrapper ──────────────────────────────────────────────
export async function callClaudeWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  timeoutMs = 180_000
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await withTimeout(fn(), timeoutMs, "Claude API call");
    } catch (err: unknown) {
      const apiErr = err as { status?: number; message?: string };
      const isTimeout = apiErr.message?.includes("timed out");
      const isRetryable =
        isTimeout ||
        apiErr.status === 429 ||
        apiErr.status === 529 ||
        (apiErr.status != null && apiErr.status >= 500);
      if (!isRetryable || attempt === maxRetries) throw err;
      const delay = Math.pow(2, attempt) * 5000; // 5 s, 10 s, 20 s
      console.warn(
        `Claude API ${isTimeout ? "timed out" : `returned ${apiErr.status}`}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("callClaudeWithRetry: unreachable");
}

// ── Streaming retry wrapper ──────────────────────────────────────────────────
export async function callClaudeStreamWithRetry(
  client: Anthropic,
  params: {
    model: string;
    max_tokens: number;
    messages: Anthropic.Messages.MessageParam[];
  },
  onProgress?: (charCount: number) => void,
  maxRetries = 3,
  stallTimeoutMs = 90_000,   // abort if no data chunk for 90s
  overallTimeoutMs = 300_000, // abort if a single call exceeds 5 min
): Promise<string> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const text = await new Promise<string>((resolve, reject) => {
        const stream = client.messages.stream(params);
        let accumulated = "";
        let lastReport = 0;
        let settled = false;

        const settle = (fn: () => void) => {
          if (!settled) { settled = true; fn(); }
        };

        // Overall timeout: cap each individual API call
        const overallTimer = setTimeout(() => {
          settle(() => {
            console.warn(`Claude stream overall timeout (${overallTimeoutMs / 1000}s), aborting...`);
            stream.abort();
            reject(new Error(`Claude stream timed out after ${overallTimeoutMs / 1000}s`));
          });
        }, overallTimeoutMs);

        // Stall detection: abort if no data chunk received for stallTimeoutMs
        let stallTimer = setTimeout(() => {
          settle(() => {
            console.warn(`Claude stream stalled (no data for ${stallTimeoutMs / 1000}s), aborting...`);
            stream.abort();
            reject(new Error(`Claude stream stalled (no data for ${stallTimeoutMs / 1000}s)`));
          });
        }, stallTimeoutMs);

        const resetStallTimer = () => {
          clearTimeout(stallTimer);
          stallTimer = setTimeout(() => {
            settle(() => {
              console.warn(`Claude stream stalled (no data for ${stallTimeoutMs / 1000}s), aborting...`);
              stream.abort();
              reject(new Error(`Claude stream stalled (no data for ${stallTimeoutMs / 1000}s)`));
            });
          }, stallTimeoutMs);
        };

        stream.on("text", (chunk) => {
          accumulated += chunk;
          resetStallTimer();
          if (onProgress && accumulated.length - lastReport > 500) {
            lastReport = accumulated.length;
            onProgress(accumulated.length);
          }
        });

        stream.finalMessage().then(
          () => {
            clearTimeout(overallTimer);
            clearTimeout(stallTimer);
            settle(() => {
              if (onProgress) onProgress(accumulated.length);
              resolve(accumulated);
            });
          },
          (err) => {
            clearTimeout(overallTimer);
            clearTimeout(stallTimer);
            settle(() => reject(err));
          },
        );
      });

      return text;
    } catch (err: unknown) {
      const apiErr = err as { status?: number; headers?: Record<string, string>; message?: string };
      const isStall = apiErr.message?.includes("stalled") || apiErr.message?.includes("timed out");
      const isRetryable =
        isStall ||
        apiErr.status === 429 ||
        apiErr.status === 529 ||
        (apiErr.status != null && apiErr.status >= 500);
      if (!isRetryable || attempt === maxRetries) throw err;

      let delay: number;
      if (apiErr.status === 429) {
        const retryAfter = apiErr.headers?.["retry-after"];
        delay = retryAfter ? Math.min(parseInt(retryAfter, 10) * 1000 || 15000, 30000) : 15000;
      } else if (isStall) {
        delay = 5000; // quick retry after stall
      } else {
        delay = Math.pow(2, attempt) * 5000;
      }

      console.warn(
        `Claude streaming ${isStall ? "stalled/timed out" : `returned ${apiErr.status}`}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("callClaudeStreamWithRetry: unreachable");
}

// ── Streaming retry wrapper (event-based, used by ingest) ────────────────────
export async function callClaudeStreamingWithRetry(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fn: () => Promise<any>,
  onTextDelta?: (text: string) => void,
  maxRetries = 5
): Promise<string> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      let fullText = "";
      const stream = await fn();
      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta?.type === "text_delta"
        ) {
          fullText += event.delta.text;
          onTextDelta?.(event.delta.text);
        }
      }
      return fullText;
    } catch (err: unknown) {
      const apiErr = err as { status?: number; headers?: Record<string, string> };
      const isRetryable =
        apiErr.status === 429 ||
        apiErr.status === 529 ||
        (apiErr.status != null && apiErr.status >= 500);
      if (!isRetryable || attempt === maxRetries) throw err;

      let delay: number;
      if (apiErr.status === 429) {
        const retryAfter = apiErr.headers?.["retry-after"];
        delay = retryAfter ? Math.max(parseInt(retryAfter, 10) * 1000, 30000) : 60000;
      } else {
        delay = Math.pow(2, attempt) * 5000;
      }

      console.warn(
        `Claude streaming returned ${apiErr.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("callClaudeStreamingWithRetry: unreachable");
}

// ── Anthropic error message extraction ───────────────────────────────────────
export function getAnthropicErrorMessage(err: unknown): string | null {
  if (!err) return null;
  const e = err as {
    status?: number;
    message?: string;
    error?: { type?: string; message?: string };
  };
  const detail = e.error?.message || e.message || null;
  if (e.status && detail) {
    return `Anthropic API error (${e.status}): ${detail}`;
  }
  return detail;
}
