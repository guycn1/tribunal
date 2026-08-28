import { getModelChainForRole } from './models';
import { calculateCost } from './pricing';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Retries are bounded by a total time budget rather than a fixed attempt
// count, because the two failure modes here have wildly different costs and
// a single attempt count cannot serve both. Measured against the real free
// tier:
//   - A saturated upstream worker pool returns in ~400-700ms. Retrying that
//     is nearly free, so a fixed low retry cap wastes recoverable calls.
//   - A genuine successful generation needs ~12-13s to stream its full body.
// The budget leaves headroom under Netlify's observed 30s platform timeout
// for the Supabase writes that surround this call.
const TOTAL_BUDGET_MS = 25000;
// Don't start an attempt the remaining budget cannot plausibly finish. A
// generation that cannot complete would just be aborted partway, spending
// free-tier quota to produce nothing.
const MIN_REMAINING_TO_ATTEMPT_MS = 8000;

// Per-attempt ceiling, scaled to how much text the call actually asked for.
// A single flat value cannot serve both call types: representatives
// complete in ~12-13s, while judges - whose prompt also carries all four
// representative arguments - were measured at 16-21s before their output
// length was reined in. A timeout sized for representatives silently aborts
// judges mid-generation, which is exactly how an earlier flat 8s value
// turned working calls into failures - note that a timeout signal passed to
// fetch() stays armed while the response body is read, so this must cover
// generation time, not just time-to-headers (~350ms).
//
// Derived from the measured throughput (~55-80 completion tokens/sec) plus
// a fixed allowance for connection and prompt processing, then clamped so
// that even the largest call leaves the surrounding Supabase writes room
// under the platform's 30s ceiling.
function attemptTimeoutFor(maxTokens: number): number {
  const estimateMs = 3000 + maxTokens * 14;
  return Math.min(Math.max(estimateMs, 12000), 22000);
}

// The last-ditch call (callOpenRouterOnce, below) is a single attempt with
// no retry loop and no TOTAL_BUDGET_MS wrapper around it, so - unlike
// attemptTimeoutFor above, which in practice is always further clamped by
// the main loop's remainingMs() - this ceiling really is the full time that
// attempt gets. Real generations have been observed legitimately taking
// 30-45s under load, well past attemptTimeoutFor's 22s ceiling, which is
// what was cutting last-ditch attempts off before a genuine (if slow)
// response could land. Flat rather than token-scaled deliberately: the
// slowness observed here isn't proportional to output length (even a
// trivial ~10-token reply from this same model was measured taking 25s+
// under load — see the "Default model switched" bug log entry), so a
// per-token formula doesn't model it; a flat ceiling close to the real
// constraint below does.
//
// That constraint is Netlify's own platform-level timeout for this
// function, observed at ~30s, which fires regardless of any AbortSignal
// this code sets. If that kill happens first, the whole invocation dies
// before any of this function's own error-logging or the Supabase writes
// that follow it can run — a silent failure, not a clean one. 26000ms is
// the most this can safely ask for while leaving real slack under that
// ~30s wall for those writes. A single Netlify Function invocation
// genuinely cannot wait a full 45s no matter what value this holds — that
// needs a different architecture (e.g. a Background Function the frontend
// polls for), not a larger number here.
const LAST_DITCH_TIMEOUT_MS = 26000;

export interface OpenRouterMessage {
  role: 'system' | 'user';
  content: string;
}

export interface OpenRouterResult {
  status: 'success' | 'failed';
  content?: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  errorMessage?: string;
}

export async function callOpenRouter(
  agentRole: string,
  messages: OpenRouterMessage[],
  maxTokens: number
): Promise<OpenRouterResult> {
  const modelChain = getModelChainForRole(agentRole);
  const model = modelChain[0];
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return failure(model, 'OPENROUTER_API_KEY is not configured on the server.');
  }

  const startedAt = Date.now();
  const remainingMs = () => TOTAL_BUDGET_MS - (Date.now() - startedAt);
  let lastError = 'Unknown error';
  let lastUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;
  let attempt = 0;

  while (remainingMs() >= MIN_REMAINING_TO_ATTEMPT_MS) {
    const attemptTimeout = Math.min(attemptTimeoutFor(maxTokens), remainingMs());
    try {
      const response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          // Header values must be ASCII/Latin-1 — no em dashes or other
          // non-Latin-1 characters here, or fetch() fails before any
          // response (and without a useful stack trace) is produced.
          'X-Title': 'Tribunal',
        },
        body: JSON.stringify({
          model,
          // Fallback chain. These free models share upstream worker pools
          // that are frequently saturated; each id has its own pool, so
          // letting OpenRouter route down the list turns the single most
          // common failure into a served request.
          models: modelChain,
          messages,
          max_tokens: maxTokens,
          // Reasoning models otherwise spend hundreds to thousands of
          // hidden tokens per call before producing visible output —
          // invisible in the response, but the reason calls were taking
          // 60+ seconds by default.
          reasoning: { enabled: false },
        }),
        signal: AbortSignal.timeout(attemptTimeout),
      });

      if (response.status === 429) {
        // Distinguish a short burst limit, which retrying inside this call
        // can clear, from a longer-window quota (free-tier daily, or a
        // paid account's own rate-limit tier), which it cannot. Retrying
        // the latter just hammers a limiter that will keep refusing for a
        // while, and reports a useless "gave up after N attempts" instead
        // of the actual reason. OpenRouter tells us which it is via
        // X-RateLimit-Reset (epoch ms) - not free-tier-specific, so the
        // message below deliberately doesn't assume which kind of account
        // is being used.
        const resetAt = Number(response.headers.get('x-ratelimit-reset'));
        const retryAfterMs = Number.isFinite(resetAt) && resetAt > 0 ? resetAt - Date.now() : 0;

        if (retryAfterMs > remainingMs()) {
          const resetIso = new Date(resetAt).toISOString();
          const limit = response.headers.get('x-ratelimit-limit') ?? 'the account';
          return failure(
            model,
            `OpenRouter request quota exhausted (rate limit ${limit}, 0 remaining). Resets at ${resetIso}.`,
            lastUsage
          );
        }

        lastError = `OpenRouter returned HTTP 429 (rate limited)`;
        await backoff(attempt++);
        continue;
      }

      if (response.status === 402) {
        // Real credit exhaustion on a paid account - the balance is
        // genuinely at $0, which won't resolve by retrying, so this
        // returns immediately rather than looping like the 429/5xx
        // branches above. The exact phrase "out of credits" is matched by
        // isOutOfCredits() in app.js to short-circuit the client's own
        // retry loop too - representative.ts/judge.ts wrap this failure as
        // a 502 rather than passing the 402 status through directly, so
        // the client can't rely on the status code alone here the way it
        // does for a direct 4xx from this app's own endpoints.
        return failure(model, `OpenRouter account is out of credits (HTTP 402): ${await describeErrorBody(response)}`);
      }

      if (response.status >= 500) {
        lastError = `OpenRouter returned HTTP ${response.status}`;
        await backoff(attempt++);
        continue;
      }

      if (!response.ok) {
        return failure(model, `OpenRouter returned HTTP ${response.status}: ${await describeErrorBody(response)}`);
      }

      const data = (await response.json()) as any;
      const content: string | undefined = data?.choices?.[0]?.message?.content;
      const usage = data?.usage ?? {};
      const promptTokens = usage.prompt_tokens ?? 0;
      const completionTokens = usage.completion_tokens ?? 0;
      const totalTokens = usage.total_tokens ?? promptTokens + completionTokens;

      if (!content) {
        // Two distinct shapes land here. (1) OpenRouter/the upstream
        // provider returns HTTP 200 with an `error` object instead of
        // `choices` - confirmed in practice to carry things like Nvidia's
        // free-tier worker pool being fully saturated (a real, transient,
        // shared-capacity condition, not anything specific to this
        // request). (2) A genuinely empty `choices[0].message.content`
        // with no `error` present. Both get a direct retry here - both
        // were confirmed to succeed on a subsequent attempt.
        const upstreamError = data?.error?.message;
        const finishReason = data?.choices?.[0]?.finish_reason ?? 'unknown';
        lastError = upstreamError
          ? `OpenRouter/upstream error: ${upstreamError}`
          : `OpenRouter response contained no message content (finish_reason=${finishReason}, prompt_tokens=${promptTokens}, completion_tokens=${completionTokens}).`;
        lastUsage = { promptTokens, completionTokens, totalTokens };
        await backoff(attempt++);
        continue;
      }

      // Report the model that actually served the request, which is not
      // necessarily the primary one - OpenRouter may have routed down the
      // fallback chain. The call log is meant to record what really ran.
      const servingModel: string = data?.model ?? model;

      return {
        status: 'success',
        content,
        model: servingModel,
        promptTokens,
        completionTokens,
        totalTokens,
        cost: calculateCost(servingModel, promptTokens, completionTokens),
      };
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'TimeoutError';
      lastError = isTimeout
        ? `OpenRouter did not respond within ${attemptTimeout}ms`
        : err instanceof Error
          ? err.message
          : String(err);
      await backoff(attempt++);
    }
  }

  return failure(model, `${lastError} (gave up after ${attempt} attempt(s), ${TOTAL_BUDGET_MS}ms budget)`, lastUsage);
}

// One attempt, one specific model, no retry and no fallback array of its
// own. Used exclusively for the frontend-orchestrated "last-ditch" call
// once its own retry-until-success ceiling against the normal chain (above)
// has been exhausted — at that point, spending more time retrying inside
// this call too would just stack additional delay on an already long wait,
// so this makes exactly one attempt and returns immediately either way.
// Reuses the same timeout scaling and response-parsing rules as the main
// loop, just without the loop around them.
export async function callOpenRouterOnce(
  messages: OpenRouterMessage[],
  maxTokens: number,
  model: string
): Promise<OpenRouterResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return failure(model, 'OPENROUTER_API_KEY is not configured on the server.');
  }

  const attemptTimeout = LAST_DITCH_TIMEOUT_MS;

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'X-Title': 'Tribunal',
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        reasoning: { enabled: false },
      }),
      signal: AbortSignal.timeout(attemptTimeout),
    });

    if (response.status === 429) {
      const resetAt = Number(response.headers.get('x-ratelimit-reset'));
      const resetIso = Number.isFinite(resetAt) && resetAt > 0 ? new Date(resetAt).toISOString() : 'unknown';
      const limit = response.headers.get('x-ratelimit-limit') ?? 'the account';
      return failure(model, `Last-ditch attempt: OpenRouter rate limit exhausted (${limit}). Resets at ${resetIso}.`);
    }

    if (response.status === 402) {
      // See the matching branch and comment in callOpenRouter above - same
      // reasoning, just prefixed to make clear which call path hit it.
      return failure(
        model,
        `Last-ditch attempt: OpenRouter account is out of credits (HTTP 402): ${await describeErrorBody(response)}`
      );
    }

    if (!response.ok) {
      return failure(model, `Last-ditch attempt: OpenRouter returned HTTP ${response.status}: ${await describeErrorBody(response)}`);
    }

    const data = (await response.json()) as any;
    const content: string | undefined = data?.choices?.[0]?.message?.content;
    const usage = data?.usage ?? {};
    const promptTokens = usage.prompt_tokens ?? 0;
    const completionTokens = usage.completion_tokens ?? 0;
    const totalTokens = usage.total_tokens ?? promptTokens + completionTokens;

    if (!content) {
      const upstreamError = data?.error?.message;
      const finishReason = data?.choices?.[0]?.finish_reason ?? 'unknown';
      const message = upstreamError
        ? `Last-ditch attempt, OpenRouter/upstream error: ${upstreamError}`
        : `Last-ditch attempt: OpenRouter response contained no message content (finish_reason=${finishReason}).`;
      return failure(model, message, { promptTokens, completionTokens, totalTokens });
    }

    const servingModel: string = data?.model ?? model;
    return {
      status: 'success',
      content,
      model: servingModel,
      promptTokens,
      completionTokens,
      totalTokens,
      cost: calculateCost(servingModel, promptTokens, completionTokens),
    };
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'TimeoutError';
    const message = isTimeout
      ? `Last-ditch attempt: OpenRouter did not respond within ${attemptTimeout}ms`
      : err instanceof Error
        ? err.message
        : String(err);
    return failure(model, message);
  }
}

function failure(
  model: string,
  errorMessage: string,
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
): OpenRouterResult {
  return {
    status: 'failed',
    model,
    promptTokens: usage?.promptTokens ?? 0,
    completionTokens: usage?.completionTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
    // Real cost is 0 regardless on this free-tier model, but computing it
    // properly (rather than hardcoding) keeps this correct if a paid
    // MODEL_* override is ever configured for a role.
    cost: usage ? calculateCost(model, usage.promptTokens, usage.completionTokens) : 0,
    errorMessage,
  };
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '(no response body)';
  }
}

// Every non-ok failure path wants a human-readable reason, not a raw
// response body - OpenRouter error responses are typically
// {"error":{"message":"..."}}, so this pulls that message out when
// present and only falls back to the raw text (still better than nothing)
// when the body isn't that shape at all.
async function describeErrorBody(response: Response): Promise<string> {
  const bodyText = await safeReadText(response);
  try {
    const parsed = JSON.parse(bodyText);
    const message = parsed?.error?.message;
    if (typeof message === 'string' && message.trim()) return message;
  } catch {
    // Not JSON, or not the expected shape - fall through to raw text.
  }
  return bodyText;
}

// Exponential backoff with jitter, capped so a long backoff never eats the
// remaining budget that an actual attempt needs. The jitter matters here:
// the seven agents fire as concurrent requests on one account, and an
// unjittered backoff makes them all retry in lockstep, re-colliding on the
// same saturated upstream pool they just bounced off.
function backoff(attempt: number): Promise<void> {
  const base = Math.min(400 * Math.pow(2, attempt), 2000);
  const delayMs = base + Math.random() * 300;
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
