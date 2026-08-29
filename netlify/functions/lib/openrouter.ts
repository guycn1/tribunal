import { calculateCost } from './pricing';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Retries are bounded by a total time budget rather than a fixed attempt
// count, so a call that fails fast (e.g. a burst rate limit, returned in
// under a second) gets more attempts than one where each try genuinely
// takes most of the budget.
//
// representative.ts/judge.ts now run as Netlify Background Functions
// (config.background = true), not standard synchronous invocations - the
// real, verified reason this whole file used to budget against a tight
// ~26s ceiling. That number was calibrated against a *standard* Netlify
// Function invocation limit that turned out to be wrong for what this
// project actually runs on: the real free-tier synchronous limit is 10
// seconds (verified directly against Netlify's own docs and support
// forum, not assumed), which every real completion measured on this
// project (consistently 8-18s+ per call) would have been at serious risk
// of blowing through regardless of how carefully the old budget was
// tuned - no amount of constant-tuning fixes an architecture mismatch.
// Background Functions get up to 15 minutes instead. 120000ms (2 minutes)
// is still a small fraction of that real ceiling - real margin for
// multiple genuine full-length retries, not just fast-failure ones - while
// staying far short of ever risking the actual 15-minute wall.
const TOTAL_BUDGET_MS = 120000;
// Don't start an attempt the remaining budget cannot plausibly finish.
// With a 2-minute total budget instead of a ~26s one, this no longer has
// to be tuned razor-close to the floor the way it did before (a real,
// measured mistake at the old tight budget: 8000ms turned out to be
// exactly big enough to get eaten by backoff()'s own delay between
// attempts, silently preventing the retry it existed to allow). 10000ms
// here has real slack in both directions - comfortably enough for a fast
// 429/5xx/empty-content retry, and enough margin that ordinary timing
// jitter can't quietly cancel it out again.
const MIN_REMAINING_TO_ATTEMPT_MS = 10000;

// Per-attempt ceiling, scaled to how much text the call actually asked
// for. A timeout signal passed to fetch() stays armed while the response
// body is read, so this has to cover generation time, not just
// time-to-headers. Real successful completions at the current
// AGENT_MAX_TOKENS (1400) have measured 8.2s-18.5s across every real call
// logged on this project so far - the values below give real multiples of
// margin above that range, not just enough to scrape by, since the whole
// point of moving to a background function was to stop cutting this close.
function attemptTimeoutFor(maxTokens: number): number {
  const estimateMs = 8000 + maxTokens * 25;
  const ceiling = TOTAL_BUDGET_MS - MIN_REMAINING_TO_ATTEMPT_MS;
  return Math.min(Math.max(estimateMs, 30000), ceiling);
}

export interface OpenRouterMessage {
  role: 'system' | 'user';
  content: string;
}

// Appended (as an extra user turn, not a continuation of the cut-off
// content) for exactly one retry when a response hits max_tokens before
// reaching a natural conclusion. A truncated response was previously
// accepted as a plain success with no corrective action - real testing
// found this happens to a real, non-trivial share of calls (roughly 1 in
// 4 in one batch) even with frequency_penalty/presence_penalty already
// in place, so silently accepting it was leaving a known, common failure
// mode unaddressed. Framed as a fresh attempt, not "finish what you
// started," since the model never sees its own truncated fragment here.
const CONCISENESS_REMINDER: OpenRouterMessage = {
  role: 'user',
  content:
    'Your previous attempt ran past the length target and was cut off before reaching a conclusion. Write your response again from scratch, more concisely this time, and make sure to reach a clear, complete ending well within the word count you were given.',
};

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

// label identifies the caller in the log lines below (e.g.
// "representative:jon_snow") - purely diagnostic, never sent to OpenRouter
// or returned to the client. With seven agents potentially calling this
// concurrently, a log line with no indication of which one it belongs to
// is close to useless once more than one is in flight at the same time.
export async function callOpenRouter(
  model: string,
  messages: OpenRouterMessage[],
  maxTokens: number,
  label: string
): Promise<OpenRouterResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return failure(model, 'OPENROUTER_API_KEY is not configured on the server.');
  }

  const startedAt = Date.now();
  const remainingMs = () => TOTAL_BUDGET_MS - (Date.now() - startedAt);
  let lastError = 'Unknown error';
  let lastUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;
  let attempt = 0;
  // Tracks whether the one-shot truncation retry has already been used, and
  // accumulates the real cost/tokens a discarded truncated attempt actually
  // spent, so the final logged cost reflects both attempts, not just the
  // one whose content is kept.
  let hasRetriedForTruncation = false;
  let extraCost = 0;
  let extraPromptTokens = 0;
  let extraCompletionTokens = 0;
  let extraTotalTokens = 0;

  while (remainingMs() >= MIN_REMAINING_TO_ATTEMPT_MS) {
    attempt++;
    const attemptTimeout = Math.min(attemptTimeoutFor(maxTokens), remainingMs());
    console.log(`[openrouter] ${label}: attempt ${attempt} starting, timeout=${attemptTimeout}ms, remaining budget=${remainingMs()}ms`);
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
          messages: hasRetriedForTruncation ? [...messages, CONCISENESS_REMINDER] : messages,
          max_tokens: maxTokens,
          // Reasoning models can otherwise spend hundreds to thousands of
          // hidden tokens per call before producing visible output —
          // invisible in the response, but a real driver of call latency
          // when enabled by default.
          reasoning: { enabled: false },
          // A real response was observed spiraling into the same short
          // clause repeated for its entire remaining token budget (never
          // reaching a natural stopping point) - a known small-model
          // degeneration mode, not a prompt-content problem, since the
          // system prompt already gives an explicit word-count target.
          // frequency_penalty scales with how often a token has already
          // appeared, which specifically counteracts a loop that would
          // otherwise keep reinforcing itself; presence_penalty adds a
          // smaller flat push away from anything already said, encouraging
          // the response to keep moving toward an actual conclusion. Values
          // are moderate on purpose - enough to break a runaway loop
          // without visibly distorting normal in-character prose.
          frequency_penalty: 0.4,
          presence_penalty: 0.2,
        }),
        signal: AbortSignal.timeout(attemptTimeout),
      });

      if (response.status === 429) {
        // Distinguish a short burst limit, which retrying inside this call
        // can clear, from a longer-window quota it cannot. Retrying the
        // latter just hammers a limiter that will keep refusing for a
        // while, and reports a useless "gave up after N attempts" instead
        // of the actual reason. OpenRouter tells us which it is via
        // X-RateLimit-Reset (epoch ms).
        const resetAt = Number(response.headers.get('x-ratelimit-reset'));
        const retryAfterMs = Number.isFinite(resetAt) && resetAt > 0 ? resetAt - Date.now() : 0;

        if (retryAfterMs > remainingMs()) {
          const resetIso = new Date(resetAt).toISOString();
          const limit = response.headers.get('x-ratelimit-limit') ?? 'the account';
          const message = `OpenRouter request quota exhausted (rate limit ${limit}, 0 remaining). Resets at ${resetIso}.`;
          console.log(`[openrouter] ${label}: attempt ${attempt} - ${message}`);
          return failure(model, message, lastUsage);
        }

        lastError = `OpenRouter returned HTTP 429 (rate limited)`;
        console.log(`[openrouter] ${label}: attempt ${attempt} - ${lastError}, retrying`);
        await backoff(attempt);
        continue;
      }

      if (response.status === 402) {
        // Real credit exhaustion on a paid account - the balance is
        // genuinely at $0, which won't resolve by retrying, so this
        // returns immediately rather than looping like the 429/5xx
        // branches above. The exact phrase "out of credits" is matched by
        // isOutOfCredits() in app.js - representative.ts/judge.ts wrap
        // this failure as a 502 rather than passing the 402 status
        // through directly, so the client can't rely on the status code
        // alone here the way it does for a direct 4xx from this app's own
        // endpoints.
        const message = `OpenRouter account is out of credits (HTTP 402): ${await describeErrorBody(response)}`;
        console.log(`[openrouter] ${label}: attempt ${attempt} - ${message}`);
        return failure(model, message);
      }

      if (response.status >= 500) {
        lastError = `OpenRouter returned HTTP ${response.status}`;
        console.log(`[openrouter] ${label}: attempt ${attempt} - ${lastError}, retrying`);
        await backoff(attempt);
        continue;
      }

      if (!response.ok) {
        const message = `OpenRouter returned HTTP ${response.status}: ${await describeErrorBody(response)}`;
        console.log(`[openrouter] ${label}: attempt ${attempt} - ${message}`);
        return failure(model, message);
      }

      const data = (await response.json()) as any;
      const content: string | undefined = data?.choices?.[0]?.message?.content;
      const usage = data?.usage ?? {};
      const promptTokens = usage.prompt_tokens ?? 0;
      const completionTokens = usage.completion_tokens ?? 0;
      const totalTokens = usage.total_tokens ?? promptTokens + completionTokens;

      if (!content) {
        // Two distinct shapes land here: (1) HTTP 200 carrying an `error`
        // object instead of `choices` - a transient upstream condition
        // rather than anything specific to this request; (2) a genuinely
        // empty `choices[0].message.content` with no `error` present.
        // Both get a direct retry.
        const upstreamError = data?.error?.message;
        const finishReason = data?.choices?.[0]?.finish_reason ?? 'unknown';
        lastError = upstreamError
          ? `OpenRouter/upstream error: ${upstreamError}`
          : `OpenRouter response contained no message content (finish_reason=${finishReason}, prompt_tokens=${promptTokens}, completion_tokens=${completionTokens}).`;
        lastUsage = { promptTokens, completionTokens, totalTokens };
        console.log(`[openrouter] ${label}: attempt ${attempt} - ${lastError}, retrying`);
        await backoff(attempt);
        continue;
      }

      const servingModel: string = data?.model ?? model;
      const finishReason = data?.choices?.[0]?.finish_reason;
      console.log(
        `[openrouter] ${label}: attempt ${attempt} - success, served by ${servingModel}, ${completionTokens} completion tokens, finish_reason=${finishReason ?? 'unknown'}, ${Date.now() - startedAt}ms total`
      );
      if (finishReason === 'length') {
        // The model was still generating when it hit max_tokens - the
        // content returned is real, not an error, but it's cut off
        // mid-thought rather than finished. console.warn (not .log) and a
        // distinct prefix specifically so this is easy to spot/grep in
        // terminal output without having to notice that completionTokens
        // happens to equal the configured cap.
        console.warn(`[openrouter] ${label}: TRUNCATED - response hit the max_tokens limit (${maxTokens}) before finishing naturally.`);

        if (!hasRetriedForTruncation && remainingMs() >= MIN_REMAINING_TO_ATTEMPT_MS) {
          console.warn(`[openrouter] ${label}: retrying once with an explicit conciseness reminder (${remainingMs()}ms remaining).`);
          hasRetriedForTruncation = true;
          extraCost += calculateCost(servingModel, promptTokens, completionTokens);
          extraPromptTokens += promptTokens;
          extraCompletionTokens += completionTokens;
          extraTotalTokens += totalTokens;
          // No backoff() here, same reasoning as the timeout branch below -
          // nothing about a token-cap hit suggests waiting helps, and this
          // retry is already spending real tokens/cost on top of the
          // discarded attempt, so it shouldn't also spend budget waiting.
          continue;
        }
        console.warn(
          `[openrouter] ${label}: truncated again after the conciseness retry (or no budget left for one) - returning the truncated content as final.`
        );
      }

      return {
        status: 'success',
        content,
        model: servingModel,
        promptTokens: promptTokens + extraPromptTokens,
        completionTokens: completionTokens + extraCompletionTokens,
        totalTokens: totalTokens + extraTotalTokens,
        cost: calculateCost(servingModel, promptTokens, completionTokens) + extraCost,
      };
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'TimeoutError';
      lastError = isTimeout
        ? `OpenRouter did not respond within ${attemptTimeout}ms`
        : err instanceof Error
          ? err.message
          : String(err);
      console.log(`[openrouter] ${label}: attempt ${attempt} - ${lastError}, retrying`);
      // backoff()'s delay exists to avoid hammering a rate limiter that
      // will keep refusing for a moment - a real reason to wait for the
      // 429/5xx/empty-content branches above, but not for a timeout, where
      // nothing suggests waiting helps and every remaining millisecond of a
      // fixed, already-tight budget matters more than a precautionary
      // pause. A genuine timeout skips straight to the retry check instead.
      if (!isTimeout) {
        await backoff(attempt);
      }
    }
  }

  const message = `${lastError} (gave up after ${attempt} attempt(s), ${TOTAL_BUDGET_MS}ms budget)`;
  console.log(`[openrouter] ${label}: ${message}`);
  return failure(model, message, lastUsage);
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
// unjittered backoff makes them all retry in lockstep.
function backoff(attempt: number): Promise<void> {
  const base = Math.min(400 * Math.pow(2, attempt), 2000);
  const delayMs = base + Math.random() * 300;
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
