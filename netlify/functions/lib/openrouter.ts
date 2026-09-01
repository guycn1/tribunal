import { calculateCost } from './pricing';
import { getTruncationFallbackModel, getTopTierFallbackModel, getLastResortFallbackModel, modelRequiresReasoning } from './models';

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
// Raised to fit the full escalation chain (see RETRY_TIERS below): worst
// case, roughly 43s (default, 1400 tokens) + 78s x2 (mistral-large, 2800
// tokens) + 95.5s x2 (first top-tier model, 3500 tokens) + 108s x1 (last-
// resort model, 4000 tokens) = ~498s of attempt ceilings alone, before
// counting backoff delays between attempts - a real, observed case hit
// ~20 consecutive fast 429 retries at one tier alone. 650000ms (650s,
// ~10.8 minutes) leaves real margin above that worst case while staying
// comfortably under the real 900s (15 minute) background-function
// ceiling, not razor-close to it.
const TOTAL_BUDGET_MS = 650000;
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
// A single same-model retry measurably wasn't enough: real data showed
// that once a role's first attempt truncated, a same-model retry
// truncated again 60-75% of the time - not an independent second roll,
// closer to "that generation was already in a bad state." A single
// different-model fallback (Mistral Large) helped a lot but still wasn't
// reliable enough on its own either: of 8 real escalations measured, 7
// succeeded and 1 truncated on both of its own attempts too. Rather than
// one fallback, this is a genuine escalation chain - each tier a
// different, more capable (and pricier) model, reached only once every
// attempt at the tier before it has already truncated. The last two
// tiers are deliberately from two different companies, not two models in
// the same family, so a shared-vendor quirk can't explain a failure that
// makes it that far. Every tier also gets more token headroom than the
// one before it - some truncations may be genuinely-long-but-coherent
// content hitting an arbitrary ceiling, not only degeneration, and a
// bigger cap directly fixes that case regardless of which model is
// generating. Reached rarely enough, given how many tiers already stand
// before it, that the real cost stays small despite each tier being
// meaningfully pricier than the last - see pricing.ts for the real
// numbers.
interface RetryTier {
  getModel: () => string;
  maxTokens: number;
  maxAttempts: number;
}

function buildRetryTiers(defaultModel: string, defaultMaxTokens: number): RetryTier[] {
  return [
    { getModel: () => defaultModel, maxTokens: defaultMaxTokens, maxAttempts: 1 },
    { getModel: getTruncationFallbackModel, maxTokens: 2800, maxAttempts: 2 },
    { getModel: getTopTierFallbackModel, maxTokens: 3500, maxAttempts: 2 },
    { getModel: getLastResortFallbackModel, maxTokens: 4000, maxAttempts: 1 },
  ];
}

// A second, independent failure signal alongside finish_reason==='length'.
// A real response was found (Grey Worm, 2026-09-01) that finished on its
// own (finish_reason='stop', well under the token cap) but degenerated
// mid-response into one long, comma-less run-on sentence collapsing into
// an immediately-repeated word ("...nonetheless nonetheless
// nonetheless...") - a genuine coherence failure finish_reason cannot see
// at all, since the model did reach a real stopping point, just a bad
// one. Re-scanning every one of the 168 real texts this project had
// already generated (every representative argument and judge ruling
// across 50 real trials, zero additional OpenRouter cost since it only
// reads already-stored content) found exactly one earlier, unnoticed
// occurrence of the same signature (also grey_worm, also on the
// mistral-large-2512 tier) - 2 of 168 total (166 and 85 words). The next
// highest real run, at 62 words, was inspected in full and is itself a
// genuine borderline case (a comma-less run-on trailing into a tonally
// strange, semi-incoherent invocation) rather than clean prose - it is
// deliberately NOT treated as the safe ceiling. Every run of 28 words or
// fewer across the entire corpus, by contrast, was a completely normal,
// coherent sentence on inspection - a real cliff, not a continuum.
// DEGENERATE_RUN_THRESHOLD is set at 40: real margin (12+ words) above
// every text actually confirmed clean, while also catching the 62-word
// borderline case rather than gambling on it, per the deliberate choice
// to risk an occasional unnecessary escalation over risking a missed
// degeneration.
const DEGENERATE_RUN_THRESHOLD = 40;
// Anything that plausibly ends a clause/sentence, or is markdown noise,
// counts as a break for this purpose - matches the calibration script
// this threshold was measured with.
const PUNCTUATION_BREAK_CHARS = /[.,;:!?()"'“”‘’—–\-\n*]+/g;

function detectDegenerateRun(content: string): { degenerate: boolean; runLength: number; sample: string } {
  const chunks = content.split(PUNCTUATION_BREAK_CHARS);
  let max = 0;
  let sample = '';
  for (const chunk of chunks) {
    const words = chunk.trim().split(/\s+/).filter(Boolean);
    if (words.length > max) {
      max = words.length;
      sample = words.slice(0, 12).join(' ');
    }
  }
  return { degenerate: max >= DEGENERATE_RUN_THRESHOLD, runLength: max, sample };
}

// Sent on every fallback-tier attempt, regardless of which of the two
// failure modes above triggered escalation - kept deliberately general
// rather than naming a specific cause, since a wrong guess (e.g. telling
// a degenerate-but-not-truncated response it was "cut off") would be
// actively misleading to the model on the retry.
const CONCISENESS_REMINDER: OpenRouterMessage = {
  role: 'user',
  content:
    'Your previous attempt did not produce a usable response - it either ran past the length target and was cut off, or trailed into repetitive, run-on text without normal punctuation before finishing. Write your response again from scratch: stay well within the word count you were given, use clear sentences with normal punctuation throughout, and make sure to reach a clear, complete ending.',
};

// Every discarded attempt (one that truncated or degenerated and was
// abandoned in favor of a retry/escalation) gets logged as its own real
// row via logApiCall(), not folded silently into whichever attempt was
// eventually kept - the whole point being that a reader of the call log
// can see that a role needed a fallback at all, not just its final
// outcome. The three marker prefixes below are duplicated as literal
// strings in app.js (same pattern as ABORTED_BY_USER_MESSAGE in abort.ts)
// so the frontend can tell a discarded-but-recovered attempt from a
// discarded-and-fatal one without any shared module between the two.
export const DEGENERATE_RETRIED_SAME_MODEL_MARKER = '[degenerate-retried-same-model]';
export const DEGENERATE_RETRIED_DIFF_MODEL_MARKER = '[degenerate-retried-diff-model]';
export const DEGENERATE_FINAL_MARKER = '[degenerate-final]';

export interface DiscardedAttempt {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  errorMessage: string;
  durationMs: number;
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
  // Wall-clock time for this specific attempt (the one this result
  // actually reports on), not the cumulative time across every attempt
  // in the chain - consistent with promptTokens/completionTokens/cost
  // above, which are likewise this attempt's own, not a running total.
  durationMs: number;
  // Attempts that truncated/degenerated and were discarded before this
  // result was reached - each one gets its own logApiCall() row alongside
  // this result's own row. Empty on the common path (no escalation
  // needed).
  discardedAttempts?: DiscardedAttempt[];
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
  // Which escalation tier we're on (0 = the default model) and how many
  // attempts have been made at that tier so far - see buildRetryTiers
  // above. Every discarded attempt (truncated or degenerated, then
  // retried/escalated) is recorded here rather than folded into whichever
  // attempt is eventually kept - each becomes its own real logApiCall()
  // row, so the call log shows the fallback happening rather than only
  // its final outcome.
  const tiers = buildRetryTiers(model, maxTokens);
  let tierIndex = 0;
  let attemptsAtTier = 0;
  const discardedAttempts: DiscardedAttempt[] = [];
  // Tracks which model the most recent attempt actually used, so a failure
  // path reached after the chain has moved to a later tier (see
  // attemptModel below) reports and costs against the model that really
  // made that attempt, not always the original.
  let lastAttemptModel = model;
  // Wall-clock start of the current/most recent attempt only, reset at
  // the top of every loop iteration - the basis for every durationMs
  // this function reports, always this attempt's own time, never the
  // cumulative time since callOpenRouter() itself was first called.
  let lastAttemptStartedAt = Date.now();

  while (remainingMs() >= MIN_REMAINING_TO_ATTEMPT_MS) {
    attempt++;
    lastAttemptStartedAt = Date.now();
    const tier = tiers[tierIndex];
    const isFallbackAttempt = tierIndex > 0;
    const attemptModel = tier.getModel();
    const attemptMaxTokens = tier.maxTokens;
    const attemptTimeout = Math.min(attemptTimeoutFor(attemptMaxTokens), remainingMs());
    lastAttemptModel = attemptModel;
    console.log(
      `[openrouter] ${label}: attempt ${attempt} starting, tier=${tierIndex + 1}/${tiers.length}, model=${attemptModel}, maxTokens=${attemptMaxTokens}, timeout=${attemptTimeout}ms, remaining budget=${remainingMs()}ms`
    );
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
          model: attemptModel,
          messages: isFallbackAttempt ? [...messages, CONCISENESS_REMINDER] : messages,
          max_tokens: attemptMaxTokens,
          // Reasoning models can otherwise spend hundreds to thousands of
          // hidden tokens per call before producing visible output —
          // invisible in the response, but a real driver of call latency
          // when enabled by default. Some models reject this outright
          // rather than ignoring it (google/gemini-2.5-pro returns HTTP
          // 400 - see modelRequiresReasoning in models.ts) - omitted
          // entirely for those rather than forced off.
          ...(modelRequiresReasoning(attemptModel) ? {} : { reasoning: { enabled: false } }),
          // A real response was observed spiraling into the same short
          // clause repeated for its entire remaining token budget (never
          // reaching a natural stopping point) - a known small-model
          // degeneration mode, not a prompt-content problem, since the
          // system prompt already gives an explicit word-count target.
          // frequency_penalty scales with how often a token has already
          // appeared, which specifically counteracts a loop that would
          // otherwise keep reinforcing itself; presence_penalty adds a
          // smaller flat push away from anything already said, encouraging
          // the response to keep moving toward an actual conclusion.
          //
          // Raised from an earlier 0.4/0.2 after real testing showed that
          // pair wasn't reliably enough: a live response still spiralled
          // into "He knew that I was a threat to the realm. He knew that I
          // was a threat to his sisters..." repeated for the entire
          // remaining budget, on both the original attempt and the
          // truncation retry below - the retry's added instruction only
          // addresses length, not repetition, so it couldn't have fixed
          // this on its own. Still comfortably short of values (near the
          // +/-2.0 ends) that visibly distort normal prose.
          frequency_penalty: 0.7,
          presence_penalty: 0.35,
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
          return failure(attemptModel, message, lastUsage, discardedAttempts, Date.now() - lastAttemptStartedAt);
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
        return failure(attemptModel, message, undefined, discardedAttempts, Date.now() - lastAttemptStartedAt);
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
        return failure(attemptModel, message, undefined, discardedAttempts, Date.now() - lastAttemptStartedAt);
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

      const servingModel: string = data?.model ?? attemptModel;
      const finishReason = data?.choices?.[0]?.finish_reason;
      console.log(
        `[openrouter] ${label}: attempt ${attempt} - success, served by ${servingModel}, ${completionTokens} completion tokens, finish_reason=${finishReason ?? 'unknown'}, ${Date.now() - startedAt}ms total`
      );
      const lengthTruncated = finishReason === 'length';
      // Only worth checking when the model didn't already hit the token
      // cap - that failure is already caught above, and a real cut-off
      // response is likely to contain an in-progress, comma-less clause
      // of its own that would otherwise trigger a false positive here.
      const degenerateCheck = !lengthTruncated ? detectDegenerateRun(content) : null;
      if (lengthTruncated || degenerateCheck?.degenerate) {
        if (lengthTruncated) {
          // The model was still generating when it hit max_tokens - the
          // content returned is real, not an error, but it's cut off
          // mid-thought rather than finished. console.warn (not .log) and
          // a distinct prefix specifically so this is easy to spot/grep
          // in terminal output without having to notice that
          // completionTokens happens to equal the configured cap.
          console.warn(`[openrouter] ${label}: TRUNCATED - response hit the max_tokens limit (${attemptMaxTokens}) before finishing naturally.`);
        } else {
          console.warn(
            `[openrouter] ${label}: DEGENERATE - response finished on its own (finish_reason=${finishReason}) but contains a ${degenerateCheck!.runLength}-word run with no punctuation ("${degenerateCheck!.sample}...") - treating as a failure rather than trusting a technically-complete but incoherent result.`
          );
        }

        attemptsAtTier++;
        let nextTierIndex = tierIndex;
        if (attemptsAtTier >= tier.maxAttempts) {
          nextTierIndex = tierIndex + 1;
        }

        if (nextTierIndex < tiers.length && remainingMs() >= MIN_REMAINING_TO_ATTEMPT_MS) {
          // Record this discarded attempt as its own row - only once we
          // know it's being discarded in favor of another attempt, so the
          // final return below (for whichever attempt is actually kept,
          // success or fatal failure) never double-reports it.
          const sameModel = nextTierIndex === tierIndex;
          const nextModel = tiers[nextTierIndex].getModel();
          const reason = lengthTruncated
            ? 'hit the max_tokens limit before finishing naturally'
            : `collapsed into a ${degenerateCheck!.runLength}-word run with no punctuation`;
          discardedAttempts.push({
            model: servingModel,
            promptTokens,
            completionTokens,
            totalTokens,
            cost: calculateCost(servingModel, promptTokens, completionTokens),
            errorMessage: `${sameModel ? DEGENERATE_RETRIED_SAME_MODEL_MARKER : DEGENERATE_RETRIED_DIFF_MODEL_MARKER} This attempt ${reason} - ${sameModel ? 're-tried with the same model' : `escalated to ${nextModel}`}.`,
            durationMs: Date.now() - lastAttemptStartedAt,
          });
          if (nextTierIndex !== tierIndex) {
            tierIndex = nextTierIndex;
            attemptsAtTier = 0;
          }
          console.warn(
            `[openrouter] ${label}: retrying at tier ${tierIndex + 1}/${tiers.length} (${tiers[tierIndex].getModel()}), ${remainingMs()}ms remaining.`
          );
          // No backoff() here, same reasoning as the timeout branch below -
          // nothing about a token-cap hit suggests waiting helps, and this
          // retry is already spending real tokens/cost on top of the
          // discarded attempt, so it shouldn't also spend budget waiting.
          continue;
        }
        // Still bad (truncated or degenerate) after using every attempt at
        // every tier (or there was no budget left for another) - neither
        // failure mode is a degraded-but-usable result, and an argument or
        // ruling that's cut off, or that collapses into repetitive
        // run-on text, isn't fair to present as the character's actual
        // position. This is the fatal case: there is no further tier to
        // fall back to, unlike every discarded attempt already recorded
        // above. Treated as a real failure, not returned as a
        // technically-successful result for the caller to badge and move
        // on - representative.ts/judge.ts already treat any `status:
        // 'failed'` result as a normal, visible failure, so this needs no
        // special handling on their side. This attempt's own tokens/cost
        // are reported on its own row here - every earlier discarded
        // attempt already has its own row via discardedAttempts, so
        // nothing is folded in here to avoid double-reporting spend.
        console.warn(`[openrouter] ${label}: still ${lengthTruncated ? 'truncated' : 'degenerate'} after every tier - returning failed rather than an unusable result.`);
        return {
          status: 'failed',
          model: servingModel,
          promptTokens,
          completionTokens,
          totalTokens,
          cost: calculateCost(servingModel, promptTokens, completionTokens),
          errorMessage: `${DEGENERATE_FINAL_MARKER} ${
            lengthTruncated
              ? `Response was still truncated after ${attempt} attempt(s) across ${tierIndex + 1} escalation tier(s). The generated content was incomplete and was not saved.`
              : `Response was still incoherent (a long run-on with no punctuation) after ${attempt} attempt(s) across ${tierIndex + 1} escalation tier(s). The generated content was not saved.`
          } This was the last available tier - no further fallback exists.`,
          discardedAttempts,
          durationMs: Date.now() - lastAttemptStartedAt,
        };
      }

      return {
        status: 'success',
        content,
        model: servingModel,
        promptTokens,
        completionTokens,
        totalTokens,
        cost: calculateCost(servingModel, promptTokens, completionTokens),
        discardedAttempts,
        durationMs: Date.now() - lastAttemptStartedAt,
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
  return failure(lastAttemptModel, message, lastUsage, discardedAttempts, Date.now() - lastAttemptStartedAt);
}

function failure(
  model: string,
  errorMessage: string,
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number },
  discardedAttempts?: DiscardedAttempt[],
  durationMs = 0
): OpenRouterResult {
  return {
    status: 'failed',
    model,
    promptTokens: usage?.promptTokens ?? 0,
    completionTokens: usage?.completionTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
    cost: usage ? calculateCost(model, usage.promptTokens, usage.completionTokens) : 0,
    errorMessage,
    discardedAttempts,
    durationMs,
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
