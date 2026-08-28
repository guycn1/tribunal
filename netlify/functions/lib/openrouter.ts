import { calculateCost } from './pricing';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Retries are bounded by a total time budget rather than a fixed attempt
// count, so a call that fails fast (e.g. a burst rate limit, returned in
// under a second) gets more attempts than one where each try genuinely
// takes most of the budget.
//
// 26000ms is the most this can safely ask for, not an arbitrary round
// number: Netlify's own platform-level timeout for a standard function
// invocation was directly observed at ~30s, and it fires regardless of any
// AbortSignal this code sets - if that kill happens first, the whole
// invocation dies before any of this function's own error-logging or the
// Supabase writes that run after callOpenRouter() resolves can execute,
// which is a silent failure rather than a clean one. The ~4s of margin
// below the observed ceiling is deliberately kept, not spent, for exactly
// those writes plus general timing imprecision - there is no larger safe
// value to raise this to on this platform; genuinely accommodating a
// longer wait would need a different architecture (e.g. a Netlify
// Background Function the frontend polls for, which has no such ceiling
// but isn't available on every plan).
const TOTAL_BUDGET_MS = 26000;
// Don't start an attempt the remaining budget cannot plausibly finish. This
// mostly exists to admit a *fast* retry - 429/5xx/empty-content responses
// have consistently resolved in well under a second in every real call this
// project has logged - not to guarantee a second full generation: real
// successful completions at the current AGENT_MAX_TOKENS (1400) have taken
// as little as ~11.9s and as much as ~17.6s (see the per-attempt
// console.log lines below), both already well above what a fixed 26s
// budget can spare for a second attempt once a meaningful first one has
// run. A real, measured case confirmed the old 8000ms value here was
// actually too high for its own stated purpose: a genuine attempt-1 hang
// left just over 8000ms remaining, but backoff()'s own delay (up to
// ~1100ms) plus normal overhead pushed the loop's next check just under
// that floor, so the retry this constant exists to admit never actually
// started. Lowered to 3000ms, which is still ample for the fast-failure
// case this is really for.
const MIN_REMAINING_TO_ATTEMPT_MS = 3000;

// Per-attempt ceiling, scaled to how much text the call actually asked for
// - a single flat value can't serve both call types here, since judges
// (whose prompt also carries all four representative arguments, and whose
// max_tokens is set higher) need more generation time than representatives
// do. A timeout signal passed to fetch() stays armed while the response
// body is read, so this has to cover generation time, not just
// time-to-headers. In practice a single attempt's timeout is also always
// further clamped by whatever's left of TOTAL_BUDGET_MS (see remainingMs()
// below), so this upper bound only matters for how long the very first
// attempt is allowed to run.
//
// Calibrated against real measured calls against the currently configured
// model (see the per-attempt console.log lines below), not assumed -
// three successful representative calls (max_tokens 1000) landed at
// 13858/14461/16289ms, and three successful judge calls (max_tokens 1400)
// landed at 10899/12311/16741ms. That's roughly 20-31ms per completion
// token including connection and prompt-processing overhead, well above
// what an earlier, un-measured estimate assumed - which is exactly what
// let a representative call whose real length happened to land on the
// slow side of that range get cut off by a timeout that had as little as
// ~700ms of real margin over an otherwise-successful call. The fixed
// allowance and per-token rate below are sized with real margin above the
// slowest of those six measurements, not just the average.
function attemptTimeoutFor(maxTokens: number): number {
  const estimateMs = 6000 + maxTokens * 18;
  // Never let a single attempt's ceiling claim the entire remaining budget.
  // Both role types now share AGENT_MAX_TOKENS (1400), and at that value
  // the raw estimate (31200ms) already exceeds TOTAL_BUDGET_MS - so without
  // a reserve, attempt 1 gets clamped to the full 26000ms with nothing left
  // over, and a real attempt that genuinely times out at that ceiling
  // leaves the retry loop with no budget to admit a second attempt at all.
  // The reserve is MIN_REMAINING_TO_ATTEMPT_MS itself plus real headroom
  // for the backoff() delay and general overhead that happen between a
  // failed attempt and the loop's next remainingMs() check - a first
  // version of this reserved only the bare floor and, measured live, still
  // gave up after one attempt, because that gap alone was enough to push
  // the post-backoff remainder just under it. 20500ms leaves real margin
  // (2900ms+) above every representative/judge completion measured so far
  // at this max_tokens value (11.9s-17.6s), while still guaranteeing a
  // genuine retry gets attempted after a worst-case full-length timeout.
  const ceiling = TOTAL_BUDGET_MS - MIN_REMAINING_TO_ATTEMPT_MS - 2500;
  return Math.min(Math.max(estimateMs, 12000), ceiling);
}

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
          messages,
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
      }

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
