import { calculateCost } from './pricing';
import { getTruncationFallbackModel, getTopTierFallbackModel, getLastResortFallbackModel, modelRequiresReasoning } from './models';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Retries are bounded by a total time budget rather than a fixed attempt
// count, so a call that fails fast (e.g. a burst rate limit, returned in
// under a second) gets more attempts than one where each try genuinely
// takes most of the budget.
//
// representative-background.ts/judge-background.ts now run as Netlify
// Background Functions (config.background = true), not standard
// synchronous invocations - the
// real, verified reason this whole file used to budget against a tight
// ~26s ceiling. That number was calibrated against a *standard* Netlify
// Function invocation limit that turned out to be wrong for what this
// project actually runs on: the real free-tier synchronous limit is 10
// seconds (verified directly against Netlify's own docs and support
// forum, not assumed), which every real completion measured on this
// project (consistently 8-18s+ per call) would have been at serious risk
// of blowing through regardless of how carefully the old budget was
// tuned - no amount of constant-tuning fixes an architecture mismatch.
// Background Functions get up to 15 minutes instead, which is what makes
// the current value possible at all: this was first set to 120000ms (2
// minutes) on that move, then raised again to fit the full escalation
// chain (see buildRetryTiers below).
// Worst case is sized by attemptTimeoutFor()'s prompt-aware formula -
// see its own comment for the arithmetic: ~649s of attempt ceilings for a
// judge across all four tiers, ~587s for a representative, both before
// backoff delays. 650000ms (650s, ~10.8 minutes) is deliberately sized
// against that, and stays comfortably under the real 900s (15 minute)
// background-function ceiling rather than razor-close to it. A chain that
// still overruns degrades gracefully rather than silently: remainingMs()
// clamps the final attempt, and the loop says plainly that the budget ran
// out before a further tier could be tried.
const TOTAL_BUDGET_MS = 650000;
// Don't start an attempt the remaining budget cannot plausibly finish.
// With a budget measured in minutes rather than the old ~26s, this no
// longer has to be tuned razor-close to the floor the way it did before
// (a real, measured mistake at the old tight budget: 8000ms turned out to be
// exactly big enough to get eaten by backoff()'s own delay between
// attempts, silently preventing the retry it existed to allow). 10000ms
// here has real slack in both directions - comfortably enough for a fast
// 429/5xx/empty-content retry, and enough margin that ordinary timing
// jitter can't quietly cancel it out again.
const MIN_REMAINING_TO_ATTEMPT_MS = 10000;

// Splits "this model bounced us instantly" from "this model genuinely tried
// and failed", because the right response to each is opposite.
//
// Counting EVERY transient failure against a tier's attempt budget (the
// first version of the escalation fix) turned out to over-correct badly:
// two burst 429s, returned in 2.3s and 2.9s, consumed both of tier 1's
// attempts and pushed a representative onto a tier costing roughly 20x
// more per prompt token, roughly five seconds after the user pressed
// Begin new trial - for a rate limit that clears on its own in a moment.
// A burst limit is exactly the failure that deserves a patient retry on
// the cheapest model, not an immediate escalation to a pricier one.
//
// A genuine hang is the opposite case and is what the escalation budget
// exists for: it consumes the whole per-attempt ceiling before failing.
// Real measurements make the two trivially separable - observed 429
// bounces landed at 1.7-4.3s, while a real timeout runs the full
// per-attempt ceiling, which was 43s flat when this was measured and is
// longer still now that attemptTimeoutFor() scales with prompt size
// (~50s for a representative, ~58s for a judge, more at later tiers). So
// a 10s line sits in open space with wide margin on both sides rather
// than splitting a continuum, and the gap has only widened since.
//
// The fast path is strictly bounded (see MAX_FAST_TRANSIENT_RETRIES_PER_TIER)
// so it can never recreate the original unbounded-retry bug: a tier gets at
// most a few free fast retries before its failures start counting normally.
const FAST_FAILURE_THRESHOLD_MS = 10000;
// Per tier, and reset on every escalation. With backoff() this is roughly
// 6s of patience per tier before a persistently-failing tier is escalated
// off anyway - enough to ride out a burst limit, far too little to hide a
// real outage.
const MAX_FAST_TRANSIENT_RETRIES_PER_TIER = 4;

// Per-attempt ceiling, scaled to how much text the call actually asked for
// AND to how much it has to read first. A timeout signal passed to fetch()
// stays armed while the response body is read, so this has to cover
// generation time, not just time-to-headers.
//
// The prompt-size term is not cosmetic - it was added (2026-09-20) after a
// real incident where judge calls timed out repeatedly against a ceiling
// that only ever considered max_tokens. A judge's prompt carries the full
// case record plus all four representative arguments (~4500 real prompt
// tokens measured), roughly 4.5x a representative's (~1000), but the old
// formula gave both the identical 43000ms. Real measured judge completions
// on the default model in that incident: 26.9s, 33.9s, and 43.2s - the
// last of those finishing with under 0ms to spare against that very
// ceiling, with several sibling attempts timing out outright just past it.
// A ceiling that half the real distribution overruns isn't a safety limit,
// it's a coin flip, so prompt size now feeds it directly.
//
// Worst-case sum across the whole escalation chain stays inside
// TOTAL_BUDGET_MS by construction: for a judge (~4550 prompt tokens) the
// four tiers come to roughly 58s x2 + 93s x2 + 111s x2 + 123s = ~649s,
// just inside the 650s budget; a representative (~1030 prompt tokens) sums
// to ~587s. Anything that still overruns is handled gracefully rather than
// silently - remainingMs() clamps the last attempt, and the loop reports
// honestly that the budget ran out before a further tier could be tried.
// Math.round is load-bearing, not tidiness: the prompt term uses a
// fractional multiplier, so an odd token estimate yields a half
// millisecond - and AbortSignal.timeout() throws outright on a
// non-integer ("The value of 'delay' is out of range"), before fetch() is
// even called. That would have failed roughly half of all real calls,
// deterministically, on prompt length alone. Caught by the offline suite
// before deploy; do not remove.
function attemptTimeoutFor(promptTokens: number, maxTokens: number): number {
  const estimateMs = 12000 + promptTokens * 2.5 + maxTokens * 25;
  const ceiling = TOTAL_BUDGET_MS - MIN_REMAINING_TO_ATTEMPT_MS;
  return Math.round(Math.min(Math.max(estimateMs, 30000), ceiling));
}

// Rough token estimate from raw characters (~4 chars/token) - only ever
// used to size the timeout above, never to bill or cap anything, so an
// approximation is fine and avoids shipping a tokenizer for it.
function estimatePromptTokens(messages: OpenRouterMessage[]): number {
  const chars = messages.reduce((total, m) => total + m.content.length, 0);
  return Math.ceil(chars / 4);
}

export interface OpenRouterMessage {
  role: 'system' | 'user';
  content: string;
}

// Appended (as an extra user turn, not a continuation of the cut-off
// content) to every attempt after the first - see isFallbackAttempt
// below. It began life as a single retry for a response that hit
// max_tokens before reaching a natural conclusion, which is where the
// wording comes from. A truncated response was previously
// accepted as a plain success with no corrective action - real testing
// found this happens to a real, non-trivial share of calls (roughly 1 in
// 4 in one batch) even with frequency_penalty/presence_penalty already
// in place, so silently accepting it was leaving a known, common failure
// mode unaddressed. Framed as a fresh attempt, not "finish what you
// started," since the model never sees its own truncated fragment here.
// A single same-model retry measurably wasn't enough on its own: real data
// showed that once a role's first attempt truncated, a same-model retry
// truncated again 60-75% of the time - not an independent second roll,
// closer to "that generation was already in a bad state." Still worth
// having as tier 1's own second attempt (see maxAttempts below) precisely
// because it's the cheapest possible recovery to try first, before paying
// for a pricier tier - it just isn't relied on alone. A single
// different-model fallback helped a lot but still wasn't reliable enough
// on its own either: of 8 real escalations measured (then against Mistral
// Large, tier 2's original model), 7 succeeded and 1 truncated on both of
// its own attempts too. Rather than one fallback, this is a genuine
// escalation chain - each tier a different model, reached once the tier
// before it is done - which usually means it
// spent every attempt allowed it, on truncation, degeneration or a slow
// transient failure, but not always: a plain HTTP error (a removed model
// id, say) escalates immediately and forfeits that tier's remaining
// attempts, since re-asking a model that just 404'd cannot help. The last two tiers are deliberately from two
// different companies, not two models in the same family, so a
// shared-vendor quirk can't explain a failure that makes it that far.
// Every tier also gets more token headroom than the one before it - some
// truncations may be genuinely-long-but-coherent content hitting an
// arbitrary ceiling, not only degeneration, and a bigger cap directly
// fixes that case regardless of which model is generating. Reached rarely
// enough, given how many tiers already stand before it, that the real
// cost stays small despite the later tiers being far pricier than the
// default - see pricing.ts for the real numbers.
//
// Note the chain is NOT monotonically pricier, despite reading that way:
// per million tokens it runs $0.05/$0.08, then $1.00/$5.00, then
// $2.00/$10.00, then $1.25/$10.00. Tier 4 is cheaper per prompt token
// than tier 3 and identical per completion token, so for a judge-shaped
// call (~4550 in, ~900 out) tier 4 costs about $0.0147 against tier 3's
// $0.0181. The ordering is by expected capability and by wanting the last
// two tiers to come from different vendors, not by price - if you are
// reasoning about worst-case spend, tier 3 is the expensive one.
//
// "More capable" is the premise the ordering rests on, and it is a
// judgement about these models in general, not something this project has
// measured. Nothing here ranks them on this workload.
interface RetryTier {
  getModel: () => string;
  maxTokens: number;
  maxAttempts: number;
}

// Tier 1's maxAttempts raised 1 -> 2 (2026-09-20), specifically to
// compensate for tier 2's own cost going up when its model was replaced
// (mistralai/mistral-large-2512, deprecated/removed from OpenRouter -
// see getTruncationFallbackModel's comment in models.ts - was $0.50/$1.50
// per million prompt/completion tokens; its replacement,
// anthropic/claude-haiku-4.5, is $1.00/$5.00, a real 2-3x step up). A
// second attempt at the default model catches more recoverable
// truncations/degeneracies before reaching for a costlier tier. Note that
// every tier in this chain is a genuinely paid model - nothing here runs
// on a free tier - so this is about relative cost, not about avoiding
// spend altogether: the default model is simply the cheapest of the four
// by a wide margin ($0.05/$0.08 per million prompt/completion tokens
// against tier 2's $1.00/$5.00 - see pricing.ts). This is also what surfaced
// the isFallbackAttempt fix below: with tier 1 now allowed more than one
// attempt, "is this attempt a retry" could no longer be inferred from
// tierIndex alone.
function buildRetryTiers(defaultModel: string, defaultMaxTokens: number): RetryTier[] {
  return [
    { getModel: () => defaultModel, maxTokens: defaultMaxTokens, maxAttempts: 2 },
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

// A THIRD failure signal, and the one that had been missing entirely: the
// same whole sentence emitted over and over, with ordinary punctuation
// between each copy.
//
// detectDegenerateRun above only ever catches ONE degeneration signature -
// a single unbroken run of 40+ words with no punctuation at all (the
// "...nonetheless nonetheless nonetheless..." collapse it was built for in
// 2026-09-01). It is structurally blind to a short, well-punctuated clause
// repeated dozens of times, because every individual chunk between the
// periods is short. That second signature is not hypothetical and not
// rare: re-scanning the entire real corpus this project has generated (689
// stored texts - 500 representative arguments, 189 judge rulings) found 30
// texts (4.4%) with a whole sentence repeated 4+ times, topping out at one
// argument that repeated "I had no other way" 195 times - and the existing
// run detector scored every single one of them clean (their longest
// punctuation-free runs were only 10-24 words, nowhere near the 40-word
// threshold). This is the failure mode behind the original
// frequency_penalty/presence_penalty work, and it had been shipping
// undetected the whole time since.
//
// Threshold calibrated against that same real corpus rather than guessed,
// the same way DEGENERATE_RUN_THRESHOLD was: at 4+ verbatim repeats,
// inspection of every borderline case (4x through 8x, read in full with
// surrounding context) found genuine degeneration in each - consecutive
// identical sentences closing out a text, or the model looping the same
// paragraph-sized block over and over. Deliberate rhetorical repetition
// does NOT trip this: real anaphora repeats an opening phrase and then
// continues differently ("I ask you to consider the scale..." / "I ask you
// to consider the evidence..."), which produces different whole sentences
// and is therefore invisible here - unlike the earlier, abandoned 5-word
// phrase heuristic, which flagged exactly that pattern as a false
// positive. Only genuinely verbatim whole-sentence repetition counts.
// Sentences under 5 words are ignored outright, so a short refrain ("Thank
// you.", "I agree.") can never trip it either.
//
// It works on real output, not just on the corpus it was calibrated
// against: counted from api_call_logs, this check has caught five natural
// live cases - all on the day it shipped, all on the tier-1 default model,
// tyrion_lannister twice and grey_worm three times, at 4 to 8 verbatim
// repeats each. The older run-on check above has caught two, both
// grey_worm, both on the tier-2 model of the time. Seven real catches
// between them, and no false positive has been identified in any of the
// live runs since.
const REPEATED_SENTENCE_THRESHOLD = 4;
const MIN_WORDS_FOR_REPEAT_CHECK = 5;

function normalizeSentenceForRepeatCheck(sentence: string): string {
  return sentence.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[^\w\s]/g, '');
}

function detectRepeatedSentences(content: string): { degenerate: boolean; count: number; sample: string } {
  const counts = new Map<string, number>();
  for (const raw of content.split(/[.!?]+/)) {
    const normalized = normalizeSentenceForRepeatCheck(raw);
    if (normalized.split(' ').filter(Boolean).length < MIN_WORDS_FOR_REPEAT_CHECK) continue;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }

  let count = 0;
  let sample = '';
  for (const [sentence, n] of counts) {
    if (n > count) {
      count = n;
      sample = sentence;
    }
  }
  return { degenerate: count >= REPEATED_SENTENCE_THRESHOLD, count, sample };
}

// Sent on every attempt after the first, whatever caused the retry - a
// same-tier retry as much as an escalation to the next tier. Kept
// deliberately general rather than naming a specific cause, since a wrong
// guess (e.g. telling a degenerate-but-not-truncated response it was "cut
// off") would be actively misleading to the model on the retry.
//
// Worth knowing, since the wording does not fit every case it now
// reaches: `attempt > 1` is the gate, so this is also appended after a
// transient failure - a timeout, a 429, an empty-content 200 - where the
// previous attempt produced no content at all and there was nothing to be
// too long or too repetitive. The text is wrong for that case, though
// harmlessly so: it asks for a concise, well-punctuated answer, which is
// what was wanted anyway. Narrowing the gate to content-quality failures
// specifically would be a behaviour change, not a comment fix, and has
// not been made.
const CONCISENESS_REMINDER: OpenRouterMessage = {
  role: 'user',
  content:
    'Your previous attempt did not produce a usable response - it either ran past the length target and was cut off, or trailed into repetitive, run-on text without normal punctuation before finishing. Write your response again from scratch: stay well within the word count you were given, use clear sentences with normal punctuation throughout, and make sure to reach a clear, complete ending.',
};

// Every discarded attempt - whatever discarded it: truncation or
// degeneration, a plain HTTP failure at that tier, a transient failure, or
// an abort caught between attempts - gets logged as its own real row via
// logApiCall(), not folded silently into whichever attempt was
// eventually kept - the whole point being that a reader of the call log
// can see that a role needed a fallback at all, not just its final
// outcome. All six marker prefixes below are duplicated as literal strings
// in app.js (same pattern as ABORTED_BY_USER_MESSAGE, which is defined in
// db.ts and copied there too) so the frontend can tell a
// discarded-but-recovered attempt from a discarded-and-fatal one without
// any shared module between the two. Adding a marker here means adding it
// there as well; there is no build step that would catch a mismatch.
//
// NAMING, worth knowing before trusting the word: "DEGENERATE" in these
// three constants is an umbrella for the whole content-quality class, NOT
// the narrower failure the detectors above look for. It covers both
//   - truncation: finish_reason === 'length'. The model was still going
//     when max_tokens stopped it. The prose is usually fine; an external
//     limit cut it off. Not a quality failure at all.
//   - degeneration proper: detectDegenerateRun / detectRepeatedSentences.
//     The model finished on its own and produced unusable text.
// Those are orthogonal, not nested - each occurs without the other, and a
// repetition loop that runs until it hits the cap is both at once. The
// umbrella name is a holdover from when the run-on detector was the only
// content check there was.
//
// The names are deliberately NOT being corrected: these exact strings are
// persisted into api_call_logs.error_message on every historical row, so
// they are effectively a wire format, and renaming them would either break
// the rendering of past trials or mean carrying both spellings forever.
// The distinction is made where it actually reaches a reader instead -
// renderCallLog() in app.js picks its badge ("Truncated" vs "Degenerated")
// from the reason text, since only the cap case says "max_tokens limit".
export const DEGENERATE_RETRIED_SAME_MODEL_MARKER = '[degenerate-retried-same-model]';
export const DEGENERATE_RETRIED_DIFF_MODEL_MARKER = '[degenerate-retried-diff-model]';
export const DEGENERATE_FINAL_MARKER = '[degenerate-final]';
// A plain HTTP-level failure (bad/removed model id, permissions, etc.) at a
// fallback tier, discarded in favor of escalating to the next tier - see
// the `!response.ok` branch below for why this needed its own marker
// rather than falling straight to a terminal failure() the way it used to.
// No same-model variant: unlike truncation/degeneracy, retrying the exact
// same model that just returned e.g. a 404 has no plausible upside, so
// this always escalates straight to the next tier rather than spending
// the current tier's remaining attempts first.
export const HTTP_ERROR_ESCALATED_MARKER = '[http-error-escalated]';
// A transient failure (timeout, 429, 5xx, or an empty-content 200) that was
// retried or escalated. These used to leave no trace at all: the retry
// branches simply `continue`d without logging anything, so a call that
// timed out repeatedly showed the user a frozen card and left nothing in
// the call log to explain it afterward - the exact situation that made a
// real 6-minute stall (2026-09-20) impossible to diagnose from the UI. Now
// every discarded attempt is a real row, whatever discarded it.
export const TRANSIENT_RETRIED_MARKER = '[transient-retried]';
// Written when the user aborted the trial while this call was still
// running server-side. A Background Function cannot be cancelled by the
// client, so the only way to stop spending real money on an abandoned
// trial is for the call itself to notice and bail - see the isAborted
// callback on callOpenRouter().
export const ABORTED_MID_CALL_MARKER = '[aborted-mid-call]';

// Passed to onAttemptStart the moment each attempt begins - see the
// parameter's own comment on callOpenRouter() for why this exists
// alongside DiscardedAttempt rather than being folded into it.
export interface AttemptStartInfo {
  model: string;
  tierIndex: number;
  // 1-based within the current tier (the tier's first attempt is 1, not
  // 0) - matches how a human would count "first attempt, second attempt."
  attemptInTier: number;
  tierMaxAttempts: number;
}

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
  // Attempts discarded before this result was reached, whatever discarded
  // them - truncation/degeneration, a plain HTTP failure at that tier, a
  // transient failure, or an abort caught between attempts. Each one gets
  // its own logApiCall() row alongside this result's own row. Empty on the
  // common path (no retry or escalation needed).
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
  label: string,
  // Fired the moment a discarded attempt is decided (see the `continue`
  // branch below), before the chain moves on to the next attempt/tier -
  // lets the caller persist it to the DB immediately, rather than only
  // after this whole function returns. That is what puts each discarded
  // attempt in the call log as it happens, rather than the whole batch
  // appearing at once after the chain finishes - without it, every
  // discarded attempt only became visible once the entire chain had
  // already finished.
  //
  // Note what this does NOT do, since it used to claim otherwise: it is
  // not what shows a live card "currently trying X". A discarded attempt
  // is by definition over, so this is always one step behind whatever is
  // actually in flight. onAttemptStart below is what covers that, and the
  // two exist separately for exactly this reason. (see representative-
  // background.ts/judge-background.ts, which used to log the whole
  // discardedAttempts array in one batch after awaiting this function).
  // Optional and fire-and-forget-tolerant (awaited if it returns a
  // promise, but a rejection here should never break the actual retry
  // logic) - a caller that doesn't care about live progress can simply
  // omit it and rely on the returned discardedAttempts array instead.
  onDiscardedAttempt?: (attempt: DiscardedAttempt) => Promise<void> | void,
  // Fired right before each attempt's fetch(), with the model/tier info for
  // the attempt about to run - the moment-it-starts counterpart to
  // onDiscardedAttempt (which only fires once an attempt is over and being
  // thrown away). This is what a client polling mid-call actually needs to
  // show "currently trying X" instead of "the last thing that failed was
  // Y" - onDiscardedAttempt alone is always one step behind, since the
  // attempt that's actually in flight right now has nothing to report yet.
  // Same fire-and-forget-tolerant contract as onDiscardedAttempt: awaited,
  // but a rejection here must never block or fail the real call.
  onAttemptStart?: (info: AttemptStartInfo) => Promise<void> | void,
  // Checked before every attempt (including the first). Returning true
  // means the user aborted this trial while this call was still running,
  // and the chain stops immediately instead of spending more real money on
  // a result nobody is waiting for any more.
  //
  // This exists because a Netlify Background Function genuinely cannot be
  // cancelled from the browser: the client gets its 202 the instant the
  // call is accepted, and abort.ts can only record that the user gave up -
  // it has no channel to stop the invocation itself. A real incident
  // (2026-09-20) showed exactly how expensive that gap is: two judge calls
  // kept running for a further 30s and 1m32s after the user hit Abort,
  // completed, and wrote real rulings to the database. With a full
  // escalation chain now able to run for up to 650s across four
  // increasingly expensive models, an abandoned trial could otherwise keep
  // billing for ten more minutes against the priciest tiers in the chain.
  // A cheap poll between attempts closes most of that: it cannot cancel an
  // HTTP request already in flight, but it does stop the *next* one - and
  // the next one is where all the escalation cost lives.
  //
  // Same fault-tolerance contract as the callbacks above: a rejection here
  // must never take down the real call, so a failing abort check is
  // treated as "not aborted" and logged, rather than aborting the work on
  // the strength of a failed lookup.
  isAborted?: () => Promise<boolean> | boolean
): Promise<OpenRouterResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return failure(model, 'OPENROUTER_API_KEY is not configured on the server.');
  }

  const startedAt = Date.now();
  const remainingMs = () => TOTAL_BUDGET_MS - (Date.now() - startedAt);
  const estimatedPromptTokens = estimatePromptTokens(messages);

  async function checkAborted(): Promise<boolean> {
    if (!isAborted) return false;
    try {
      return await isAborted();
    } catch (err) {
      console.warn(`[openrouter] ${label}: abort check failed, assuming not aborted: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
  let lastError = 'Unknown error';
  let lastUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;
  let attempt = 0;
  // Which escalation tier we're on (0 = the default model) and how many
  // attempts have been made at that tier so far - see buildRetryTiers
  // above. Every discarded attempt is recorded here - whatever kind of
  // failure discarded it - rather than folded into whichever
  // attempt is eventually kept - each becomes its own real logApiCall()
  // row, so the call log shows the fallback happening rather than only
  // its final outcome.
  const tiers = buildRetryTiers(model, maxTokens);
  let tierIndex = 0;
  let attemptsAtTier = 0;
  // Fast transient failures forgiven at the current tier (see
  // FAST_FAILURE_THRESHOLD_MS). Reset on every escalation, so each tier
  // gets its own small allowance rather than inheriting a spent one.
  let fastRetriesAtTier = 0;
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

  // Records one failed attempt and moves the chain forward, for EVERY kind
  // of failure rather than only the content-quality ones.
  //
  // This unification is the fix for a real, load-bearing bug (2026-09-20):
  // `attemptsAtTier++` used to live exclusively inside the
  // truncation/degeneracy branch, so every other retry path - timeout, 429,
  // 5xx, an empty-content 200 - looped with `continue` while leaving both
  // `attemptsAtTier` and `tierIndex` untouched. A call whose attempts kept
  // timing out therefore retried the SAME model at the SAME tier until the
  // entire 650s budget drained, never once escalating, while
  // `attemptInTier` (reported as `attemptsAtTier + 1`) stayed pinned at 1 -
  // which is why two judge cards sat on "Model: mistral-small (first
  // attempt)" for six unbroken minutes through roughly nine separate
  // 43-second timeouts. The escalation chain existed but was unreachable
  // for the most common failure modes it should have been covering.
  //
  // `skipRestOfTier` is for failures where retrying this exact model is
  // pointless rather than merely unlucky - currently a plain HTTP error
  // such as a removed model id, which will fail identically every time.
  async function recordFailedAttemptAndAdvance(opts: {
    marker: string;
    // Used instead of `marker` when this failure actually moves the chain
    // to a different model, so the call log can distinguish "re-tried the
    // same model" from "escalated" - the two read very differently to
    // someone reading the log afterward.
    escalatedMarker?: string;
    model: string;
    reason: string;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    cost?: number;
    skipRestOfTier?: boolean;
    // Set only for genuinely transient failures: a 429, a 5xx, an
    // empty-content/upstream-error 200, and the fetch-level catch (a
    // timeout or a network error). That last one is included on purpose
    // even though a real timeout can never be "fast" - a network error
    // that fails instantly, like a DNS blip or a connection reset, is
    // exactly the case worth a cheap same-model retry.
    // A fast one of these gets a free same-model retry that does not spend
    // a tier attempt - see FAST_FAILURE_THRESHOLD_MS. Deliberately NOT set
    // for a plain HTTP error like a removed model id (permanent - retrying
    // is pointless) or for truncation/degeneracy (a real generation that
    // genuinely used its turn).
    allowFastRetry?: boolean;
  }): Promise<{ canContinue: boolean; allTiersExhausted: boolean }> {
    const attemptDurationMs = Date.now() - lastAttemptStartedAt;

    // A fast bounce from an otherwise-working model: retry it without
    // spending one of this tier's real attempts, so a burst rate limit
    // can't shove the call onto a pricier tier within seconds. Still
    // recorded as its own visible row, and still hard-bounded.
    if (
      opts.allowFastRetry &&
      attemptDurationMs < FAST_FAILURE_THRESHOLD_MS &&
      fastRetriesAtTier < MAX_FAST_TRANSIENT_RETRIES_PER_TIER &&
      remainingMs() >= MIN_REMAINING_TO_ATTEMPT_MS
    ) {
      fastRetriesAtTier++;
      const discarded: DiscardedAttempt = {
        model: opts.model,
        promptTokens: opts.usage?.promptTokens ?? 0,
        completionTokens: opts.usage?.completionTokens ?? 0,
        totalTokens: opts.usage?.totalTokens ?? 0,
        cost: opts.cost ?? 0,
        errorMessage: `${opts.marker} ${opts.reason} after ${attemptDurationMs}ms - re-tried with the same model (fast failure ${fastRetriesAtTier}/${MAX_FAST_TRANSIENT_RETRIES_PER_TIER} at this tier, not counted against it).`,
        durationMs: attemptDurationMs,
      };
      discardedAttempts.push(discarded);
      if (onDiscardedAttempt) {
        try {
          await onDiscardedAttempt(discarded);
        } catch (err) {
          console.warn(`[openrouter] ${label}: onDiscardedAttempt callback failed, continuing anyway: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      console.warn(
        `[openrouter] ${label}: fast transient failure (${attemptDurationMs}ms) - retrying tier ${tierIndex + 1}/${tiers.length} (${tiers[tierIndex].getModel()}) without spending a tier attempt (${fastRetriesAtTier}/${MAX_FAST_TRANSIENT_RETRIES_PER_TIER}).`
      );
      return { canContinue: true, allTiersExhausted: false };
    }

    if (opts.skipRestOfTier) {
      attemptsAtTier = tiers[tierIndex].maxAttempts;
    } else {
      attemptsAtTier++;
    }
    const nextTierIndex = attemptsAtTier >= tiers[tierIndex].maxAttempts ? tierIndex + 1 : tierIndex;
    const canContinue = nextTierIndex < tiers.length && remainingMs() >= MIN_REMAINING_TO_ATTEMPT_MS;

    if (canContinue) {
      const sameModel = nextTierIndex === tierIndex;
      const nextModel = tiers[nextTierIndex].getModel();
      const marker = sameModel ? opts.marker : (opts.escalatedMarker ?? opts.marker);
      const discarded: DiscardedAttempt = {
        model: opts.model,
        promptTokens: opts.usage?.promptTokens ?? 0,
        completionTokens: opts.usage?.completionTokens ?? 0,
        totalTokens: opts.usage?.totalTokens ?? 0,
        cost: opts.cost ?? 0,
        errorMessage: `${marker} ${opts.reason} - ${sameModel ? 're-tried with the same model' : `escalated to ${nextModel}`}.`,
        durationMs: Date.now() - lastAttemptStartedAt,
      };
      discardedAttempts.push(discarded);
      if (onDiscardedAttempt) {
        try {
          await onDiscardedAttempt(discarded);
        } catch (err) {
          // Never let a logging failure interrupt the actual escalation -
          // this callback exists purely to make progress visible sooner,
          // not to gate whether the chain can keep going. The final row
          // logged by the caller still carries the complete
          // discardedAttempts array as a fallback if a live write is lost.
          console.warn(`[openrouter] ${label}: onDiscardedAttempt callback failed, continuing anyway: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (nextTierIndex !== tierIndex) {
        tierIndex = nextTierIndex;
        attemptsAtTier = 0;
        fastRetriesAtTier = 0;
      }
      console.warn(
        `[openrouter] ${label}: retrying at tier ${tierIndex + 1}/${tiers.length} (${tiers[tierIndex].getModel()}), ${remainingMs()}ms remaining.`
      );
    }

    return { canContinue, allTiersExhausted: nextTierIndex >= tiers.length };
  }

  while (remainingMs() >= MIN_REMAINING_TO_ATTEMPT_MS) {
    if (await checkAborted()) {
      const message = `${ABORTED_MID_CALL_MARKER} Stopped before attempt ${attempt + 1}: the user aborted this trial while the call was still running server-side. Nothing further was requested and nothing was saved.`;
      console.warn(`[openrouter] ${label}: aborted by user mid-call - stopping the chain rather than spending further budget.`);
      return failure(lastAttemptModel, message, lastUsage, discardedAttempts, Date.now() - lastAttemptStartedAt);
    }
    attempt++;
    lastAttemptStartedAt = Date.now();
    const tier = tiers[tierIndex];
    // "Is this a retry, not the pristine first try of the whole call" -
    // determines whether CONCISENESS_REMINDER gets appended below. Used to
    // be `tierIndex > 0`, which was correct only as long as tier 1 had
    // exactly one attempt (the only way to reach attempt 2+ was to change
    // tierIndex). Now that tier 1 gets a second attempt of its own (see
    // buildRetryTiers), a tier-1 retry keeps tierIndex at 0 - that old
    // condition would have silently skipped the reminder on exactly the
    // attempt it exists for. `attempt` (the running 1-based counter,
    // already incremented above) is the actually-correct signal regardless
    // of which tier's own attempt budget produced the retry.
    const isFallbackAttempt = attempt > 1;
    const attemptModel = tier.getModel();
    const attemptMaxTokens = tier.maxTokens;
    const attemptTimeout = Math.min(attemptTimeoutFor(estimatedPromptTokens, attemptMaxTokens), remainingMs());
    lastAttemptModel = attemptModel;
    console.log(
      `[openrouter] ${label}: attempt ${attempt} starting, tier=${tierIndex + 1}/${tiers.length}, model=${attemptModel}, maxTokens=${attemptMaxTokens}, timeout=${attemptTimeout}ms, remaining budget=${remainingMs()}ms`
    );
    if (onAttemptStart) {
      try {
        await onAttemptStart({ model: attemptModel, tierIndex, attemptInTier: attemptsAtTier + 1, tierMaxAttempts: tier.maxAttempts });
      } catch (err) {
        // Same tolerance as onDiscardedAttempt below - a failure to record
        // "this attempt started" must never block or fail the actual call.
        console.warn(`[openrouter] ${label}: onAttemptStart callback failed, continuing anyway: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
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
          return failure(attemptModel, message, lastUsage, discardedAttempts, Date.now() - lastAttemptStartedAt, { tierIndex, tierCount: tiers.length });
        }

        lastError = `OpenRouter returned HTTP 429 (rate limited)`;
        console.log(`[openrouter] ${label}: attempt ${attempt} - ${lastError}, retrying`);
        await backoff(attempt);
        {
          // Counted against this tier's attempt budget like any other
          // failure, so a rate-limited tier escalates to the next model
          // instead of hammering the same one until the budget drains.
          // Escalating is a genuinely good response to a rate limit: the
          // next tier is a different model, often on a different provider
          // path entirely.
          const next = await recordFailedAttemptAndAdvance({
            marker: TRANSIENT_RETRIED_MARKER,
            model: attemptModel,
            reason: 'was rate limited (HTTP 429)',
            allowFastRetry: true,
          });
          if (next.canContinue) continue;
          return failure(attemptModel, lastError, lastUsage, discardedAttempts, Date.now() - lastAttemptStartedAt, { tierIndex, tierCount: tiers.length });
        }
      }

      if (response.status === 402) {
        // Real credit exhaustion on a paid account - the balance is
        // genuinely at $0, which won't resolve by retrying, so this
        // returns immediately rather than looping like the 429/5xx
        // branches above. The wording matters because it is what a reader
        // actually sees: this message is persisted to
        // api_call_logs.error_message and rendered verbatim on the agent's
        // card, so it has to explain itself without a status code beside
        // it. (It used to be matched by an isOutOfCredits() helper in
        // app.js, which existed because the agent endpoints wrap an
        // OpenRouter-layer failure as a 502 and the client therefore could
        // not read the 402 directly. That helper went away with the move to
        // Background Functions - the client no longer sees the agent's
        // response at all, only what polling reads back out of the log -
        // so nothing parses this string today.)
        const message = `OpenRouter account is out of credits (HTTP 402): ${await describeErrorBody(response)}`;
        console.log(`[openrouter] ${label}: attempt ${attempt} - ${message}`);
        return failure(attemptModel, message, undefined, discardedAttempts, Date.now() - lastAttemptStartedAt, { tierIndex, tierCount: tiers.length });
      }

      if (response.status >= 500) {
        lastError = `OpenRouter returned HTTP ${response.status}`;
        console.log(`[openrouter] ${label}: attempt ${attempt} - ${lastError}, retrying`);
        await backoff(attempt);
        {
          const next = await recordFailedAttemptAndAdvance({
            marker: TRANSIENT_RETRIED_MARKER,
            model: attemptModel,
            reason: `failed upstream (HTTP ${response.status})`,
            allowFastRetry: true,
          });
          if (next.canContinue) continue;
          return failure(attemptModel, lastError, lastUsage, discardedAttempts, Date.now() - lastAttemptStartedAt, { tierIndex, tierCount: tiers.length });
        }
      }

      if (!response.ok) {
        const message = `OpenRouter returned HTTP ${response.status}: ${await describeErrorBody(response)}`;
        console.log(`[openrouter] ${label}: attempt ${attempt} - ${message}`);

        // Real incident (2026-09-20): mistralai/mistral-large-2512, tier
        // 2's model at the time (it is anthropic/claude-haiku-4.5 now -
        // see models.ts), was deprecated/removed from OpenRouter's
        // catalog sometime after this chain was built, so every call that
        // needed to escalate past tier 1 failed outright here with HTTP
        // 404 "No endpoints found for mistralai/mistral-large-2512" - even
        // though tier 3 (openai/gpt-5.6-sol) and tier 4
        // (google/gemini-2.5-pro) were both still real, live models the
        // entire time. This branch used to return a terminal failure()
        // unconditionally, which is what let one dead model id at one
        // tier kill the whole call regardless of how many working tiers
        // stood after it - the tier-escalation mechanism below only ever
        // covered the two content-quality failure modes
        // (truncation/degeneracy), never a plain HTTP failure at a
        // fallback tier. Escalates straight to the next tier (skipping any
        // remaining attempts at this one, unlike the degenerate/truncation
        // path) since retrying the exact same broken model id would just
        // fail identically again - see HTTP_ERROR_ESCALATED_MARKER's own
        // comment for why there's no same-model variant here.
        const next = await recordFailedAttemptAndAdvance({
          marker: HTTP_ERROR_ESCALATED_MARKER,
          model: attemptModel,
          reason: message,
          // Unlike a timeout or a 429, this one says something specific and
          // permanent about this model, so the tier's remaining attempts
          // are skipped rather than spent re-asking a model that just told
          // us it does not exist.
          skipRestOfTier: true,
        });
        if (next.canContinue) continue;
        return failure(attemptModel, message, undefined, discardedAttempts, Date.now() - lastAttemptStartedAt, { tierIndex, tierCount: tiers.length });
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
        {
          const next = await recordFailedAttemptAndAdvance({
            marker: TRANSIENT_RETRIED_MARKER,
            model: attemptModel,
            reason: upstreamError ? 'returned an upstream error instead of content' : 'returned no message content',
            usage: lastUsage,
            allowFastRetry: true,
          });
          if (next.canContinue) continue;
          return failure(attemptModel, lastError, lastUsage, discardedAttempts, Date.now() - lastAttemptStartedAt, { tierIndex, tierCount: tiers.length });
        }
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
      // The second degeneration signature, and the one the run-length check
      // above is structurally blind to - see detectRepeatedSentences. Also
      // skipped for an already-truncated response, for the same reason: a
      // response cut off mid-thought is being discarded anyway.
      const repeatCheck = !lengthTruncated ? detectRepeatedSentences(content) : null;
      if (lengthTruncated || degenerateCheck?.degenerate || repeatCheck?.degenerate) {
        let reason: string;
        if (lengthTruncated) {
          // The model was still generating when it hit max_tokens - the
          // content returned is real, not an error, but it's cut off
          // mid-thought rather than finished. console.warn (not .log) and
          // a distinct prefix specifically so this is easy to spot/grep
          // in terminal output without having to notice that
          // completionTokens happens to equal the configured cap.
          console.warn(`[openrouter] ${label}: TRUNCATED - response hit the max_tokens limit (${attemptMaxTokens}) before finishing naturally.`);
          reason = 'hit the max_tokens limit before finishing naturally';
        } else if (degenerateCheck?.degenerate) {
          console.warn(
            `[openrouter] ${label}: DEGENERATE - response finished on its own (finish_reason=${finishReason}) but contains a ${degenerateCheck.runLength}-word run with no punctuation ("${degenerateCheck.sample}...") - treating as a failure rather than trusting a technically-complete but incoherent result.`
          );
          // The offending text is quoted into the persisted reason, not just
          // the console line, for a specific reason: a discarded attempt's
          // content is never stored anywhere, so without a sample there is
          // no way to audit a degeneration discard after the fact and tell a
          // genuine catch from a false positive. The count alone ("repeated
          // the same sentence 5 times") is unfalsifiable once the text is
          // gone. Kept short so the call log stays readable.
          reason = `collapsed into a ${degenerateCheck.runLength}-word run with no punctuation ("${degenerateCheck.sample.slice(0, 60)}...")`;
        } else {
          console.warn(
            `[openrouter] ${label}: DEGENERATE - response finished on its own (finish_reason=${finishReason}) but repeats the same sentence ${repeatCheck!.count} times ("${repeatCheck!.sample.slice(0, 80)}...") - treating as a failure rather than trusting a technically-complete but looping result.`
          );
          // Same reasoning as the run-on case above - the repeated sentence
          // itself is what makes this checkable later.
          reason = `repeated the same sentence ${repeatCheck!.count} times ("${repeatCheck!.sample.slice(0, 60)}...")`;
        }

        const next = await recordFailedAttemptAndAdvance({
          marker: DEGENERATE_RETRIED_SAME_MODEL_MARKER,
          escalatedMarker: DEGENERATE_RETRIED_DIFF_MODEL_MARKER,
          model: servingModel,
          reason: `This attempt ${reason}`,
          usage: { promptTokens, completionTokens, totalTokens },
          cost: calculateCost(servingModel, promptTokens, completionTokens),
        });
        if (next.canContinue) continue;
        // Still bad (truncated or degenerate) after using every attempt at
        // every tier (or there was no budget left for another) - neither
        // failure mode is a degraded-but-usable result, and an argument or
        // ruling that's cut off, or that collapses into repetitive
        // run-on text, isn't fair to present as the character's actual
        // position. This is the fatal case: there is no further tier to
        // fall back to, unlike every discarded attempt already recorded
        // above. Treated as a real failure, not returned as a
        // technically-successful result for the caller to badge and move
        // on - the agent Background Functions already treat any `status:
        // 'failed'` result as a normal, visible failure, so this needs no
        // special handling on their side. This attempt's own tokens/cost
        // are reported on its own row here - every earlier discarded
        // attempt already has its own row via discardedAttempts, so
        // nothing is folded in here to avoid double-reporting spend.
        console.warn(`[openrouter] ${label}: still unusable after every tier - returning failed rather than an unusable result.`);
        // Two genuinely different situations were previously conflated into
        // one message here: allTiersExhausted means every tier this chain
        // offers really was tried; otherwise the time budget ran out before
        // a real further tier could even be attempted - a tier still
        // existed, it just was never reached. Claiming "no further fallback
        // exists" in the second case would be false, so each gets its own
        // accurate wording.
        const allTiersExhausted = next.allTiersExhausted;
        const errorMessage = allTiersExhausted
          ? `${DEGENERATE_FINAL_MARKER} Every model tier was tried (${tiers.length} in total, ending with ${servingModel}) and none produced a usable response - the final attempt ${reason}. Nothing was saved.`
          : `${DEGENERATE_FINAL_MARKER} This attempt (tier ${tierIndex + 1} of ${tiers.length}, ${servingModel}) ${reason}, and the remaining time budget ran out before a further escalation tier could be tried. Nothing was saved.`;
        return {
          status: 'failed',
          model: servingModel,
          promptTokens,
          completionTokens,
          totalTokens,
          cost: calculateCost(servingModel, promptTokens, completionTokens),
          errorMessage,
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
      // This branch is the one that produced the real 6-minute stall: it
      // used to fall straight through to the next loop iteration without
      // touching attemptsAtTier or tierIndex, so a model that kept timing
      // out was simply re-asked, at the same tier, until the entire budget
      // was gone. A timeout is exactly the signal that this model is not
      // working right now and a different one should get a turn.
      {
        const next = await recordFailedAttemptAndAdvance({
          marker: TRANSIENT_RETRIED_MARKER,
          model: attemptModel,
          reason: isTimeout ? `did not respond within ${attemptTimeout}ms` : `failed to complete (${lastError})`,
          // A genuine timeout is never "fast" so this is a no-op for it,
          // but a network-level error that fails instantly (DNS blip,
          // connection reset) is exactly the transient case worth a cheap
          // same-model retry rather than an immediate escalation.
          allowFastRetry: true,
        });
        if (next.canContinue) continue;
        return failure(attemptModel, lastError, lastUsage, discardedAttempts, Date.now() - lastAttemptStartedAt, { tierIndex, tierCount: tiers.length });
      }
    }
  }

  const message = `${lastError} (gave up after ${attempt} attempt(s), ${TOTAL_BUDGET_MS}ms budget)`;
  console.log(`[openrouter] ${label}: ${message}`);
  return failure(lastAttemptModel, message, lastUsage, discardedAttempts, Date.now() - lastAttemptStartedAt, { tierIndex, tierCount: tiers.length });
}

// Applied to a terminal failure only when it happened on the LAST
// escalation tier (tierIndex === tierCount - 1) - i.e. every tier this
// chain offers was genuinely tried and none of them produced a kept
// result, regardless of which specific failure mode ended it (a plain
// HTTP error, exhausted quota, a timeout, or truncation/degeneracy - see
// the dedicated wording in the DEGENERATE_FINAL_MARKER branch above for
// that last one specifically). A failure that happens on an EARLIER tier
// (most commonly: the total time budget ran out before the chain even
// reached the last tier) is a different, less complete situation and
// keeps its own specific message instead of falsely claiming every tier
// was exhausted.
function withTierContext(rawMessage: string, tierIndex: number, tierCount: number, attemptModel: string): string {
  if (tierIndex !== tierCount - 1) return rawMessage;
  return `Every model tier was tried (${tierCount} in total, ending with ${attemptModel}) and none produced a usable response. Last attempt: ${rawMessage}`;
}

function failure(
  model: string,
  errorMessage: string,
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number },
  discardedAttempts?: DiscardedAttempt[],
  durationMs = 0,
  tierContext?: { tierIndex: number; tierCount: number }
): OpenRouterResult {
  return {
    status: 'failed',
    model,
    promptTokens: usage?.promptTokens ?? 0,
    completionTokens: usage?.completionTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
    cost: usage ? calculateCost(model, usage.promptTokens, usage.completionTokens) : 0,
    errorMessage: tierContext ? withTierContext(errorMessage, tierContext.tierIndex, tierContext.tierCount, model) : errorMessage,
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
