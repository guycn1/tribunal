import { calculateCost } from './pricing';
import { getTruncationFallbackModel, getTopTierFallbackModel, getLastResortFallbackModel, modelRequiresReasoning } from './models';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Retries are bounded two ways: each escalation tier's own attempt count
// (see buildRetryTiers below), and a total time budget over the whole
// chain. A call that fails fast (e.g. a burst rate limit, returned in
// under a second) gets a few extra same-model retries that don't count
// against its tier - up to MAX_FAST_TRANSIENT_RETRIES_PER_TIER at each
// tier, while the budget has room for another attempt; see
// FAST_FAILURE_THRESHOLD_MS. Every other failed attempt - one that took
// 10s or longer, or a fast one past those - uses up one of its tier's
// attempts.
//
// representative-background.ts/judge-background.ts run as Netlify
// Background Functions (declared by their -background filenames), not
// standard synchronous invocations. Before that move this file budgeted against a
// tight ~26s ceiling, calibrated against a *standard* Netlify Function
// invocation limit that turned out to be wrong for what this project
// actually runs on: the real free-tier synchronous limit is 10
// seconds (verified directly against Netlify's own docs and support
// forum, not assumed), which real calls on the default model routinely
// ran past, however carefully the old budget was tuned - no amount of
// constant-tuning fixes an architecture mismatch.
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
// (a measured mistake at the old tight budget: 8000ms turned out to be
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
// The line was set from those two: the 429 bounces observed when it was
// set landed at 1.7-4.3s (every 429 logged by 2026-10-04 came back in
// 0.4-3.6s), while a timeout runs the full per-attempt ceiling, which was
// 43s flat then and is longer now that attemptTimeoutFor() scales with
// prompt size (~50s for a representative, ~58s for a judge, more at later
// tiers). The same 10s line applies to every other transient failure - a
// 408, a 5xx, a network error, a 200 with no usable content: one back in
// under 10s gets the free same-model retry, and one that took longer
// counts against its tier.
//
// The fast path is strictly bounded (see MAX_FAST_TRANSIENT_RETRIES_PER_TIER)
// so it can never recreate the original unbounded-retry behaviour: a tier gets at
// most a few free fast retries before its failures start counting normally.
const FAST_FAILURE_THRESHOLD_MS = 10000;
// Per tier, and reset on every escalation. The backoff() pauses between
// these retries add up to about 6.5-7.5s at tier 1 and 8-9s at later tiers
// (backoff() grows with the call's overall attempt count, not the tier's)
// before a persistently-failing tier is escalated off anyway - enough to
// ride out a burst limit, far too little to hide a real outage.
const MAX_FAST_TRANSIENT_RETRIES_PER_TIER = 4;

/**
 * Per-attempt ceiling, scaled to how much text the call actually asked for
 * AND to how much it has to read first. A timeout signal passed to fetch()
 * stays armed while the response body is read, so this has to cover
 * generation time, not just time-to-headers.
 *
 * The prompt-size term is not cosmetic - it was added (2026-09-20) after a
 * real incident where judge calls timed out repeatedly against a ceiling
 * that only ever considered max_tokens. A judge's prompt carries the full
 * case record plus all four representative arguments. Counted across every
 * successful call in api_call_logs as of 2026-09-21: a judge prompt runs a
 * median of 3896 tokens (mean 3943, p90 4483), a representative's 1028
 * (mean 1166, p90 2068) - so a judge carries something like 3.8x a
 * representative's prompt. The old formula gave both the identical 43000ms.
 * Real measured judge completions on the default model in that incident:
 * 26.9s, 33.9s, and 43.2s - the last of those at that very ceiling (a
 * logged duration can read slightly over it, since it also covers the
 * progress write made just before the request starts), with several sibling
 * attempts timing out outright just past it. A ceiling that half the real
 * distribution overruns isn't a safety limit, it's a coin flip, so prompt
 * size now feeds it directly.
 *
 * Sum of attempt ceilings across the whole escalation chain: a judge at
 * 4550 prompt tokens (the incident's judges - above p90, so a deliberately
 * generous case) comes to 648.6s, and a representative at 1030 (about the
 * median) to 587.0s, both just inside the 650s budget. Those two figures
 * are what the budget was sized against.
 *
 * It is NOT inside the budget by construction. The ceiling scales with
 * prompt size and real prompts have a long tail - the largest judge prompt
 * in the log (as of 2026-09-21) is 11318 tokens, which sums to 767s, over
 * budget by nearly two minutes. Even p90 (4483) only reaches 647.5s, so the
 * tail has to be genuinely unusual before this bites, and it bites safely
 * when it does: remainingMs() clamps the last attempt and the loop reports
 * honestly that the budget ran out before a further tier could be tried.
 * The effect of an outsized prompt is fewer tiers actually reached, not a
 * silent overrun.
 *
 * The result is also clamped: never under 30000ms, and never over the
 * whole budget less MIN_REMAINING_TO_ATTEMPT_MS.
 *
 * Math.round is load-bearing, not tidiness: the prompt term uses a
 * fractional multiplier, so an odd token estimate yields a half
 * millisecond - and AbortSignal.timeout() throws outright on a
 * non-integer ("The value of 'delay' is out of range"), before fetch() is
 * even called. That would have failed roughly half of all real calls,
 * deterministically, on prompt length alone. Caught by the offline suite
 * before deploy; do not remove.
 */
function attemptTimeoutFor(promptTokens: number, maxTokens: number): number {
  const estimateMs = 12000 + promptTokens * 2.5 + maxTokens * 25;
  const ceiling = TOTAL_BUDGET_MS - MIN_REMAINING_TO_ATTEMPT_MS;
  return Math.round(Math.min(Math.max(estimateMs, 30000), ceiling));
}

/**
 * Rough token estimate from raw characters (~4 chars/token) - only ever
 * used to size the timeout above, never to bill or cap anything, so an
 * approximation is fine and avoids shipping a tokeniser for it.
 */
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
// A single same-model retry was not enough on its own: in a test on
// 2026-08-29, once daenerys_targaryen's or grey_worm's first attempt
// truncated, a same-model retry truncated again 3 times in 5 and 3 times
// in 4 - closer to "that generation was already in a bad state" than to
// an independent second roll. That test ran under that day's settings,
// not today's: the token cap was the only check on a reply, and the
// retry's added instruction spoke of length alone. Still worth
// having as tier 1's own second attempt (see maxAttempts below) precisely
// because it's the cheapest possible recovery to try first, before paying
// for a pricier tier - it just isn't relied on alone. A single
// different-model fallback helped a lot but still wasn't reliable enough
// on its own either: of 8 real escalations measured (then against Mistral
// Large, tier 2's original model), 7 succeeded and 1 truncated on both of
// its own attempts too. Rather than one fallback, this is a genuine
// escalation chain - each tier a different model, reached once the tier
// before it is done - which usually means it spent every attempt allowed
// it, on truncation, degeneration or a transient failure that counted (a
// slow one, or a fast one past its tier's free retries), but not always:
// a plain HTTP error (a removed model id, say) escalates
// immediately and forfeits that tier's remaining attempts, since
// re-asking a model that just 404'd cannot help. The last two tiers are
// deliberately from two different companies, not two models in the same
// family, so a shared-vendor quirk can't explain a failure that makes it
// that far.
// Every tier also gets more token headroom than the one before it, as a
// safeguard in case a sound response ever runs past the cap. None has been
// seen to: all 48 capped replies whose text was stored, as of 2026-09-27,
// are repetition loops that ran until the cap stopped them, and no tier-1
// reply that finished on its own had gone past 1,147 of its 1,400 tokens.
// For a loop, a bigger cap only means a longer loop; what recovers it is
// the fresh attempt itself, on the same model or the next. Reached rarely
// enough, given how many tiers already stand before it, that the real
// cost stays small despite the later tiers being far pricier than the
// default - see pricing.ts for the real numbers.
//
// Tier 2 measured far ahead of the default model on this workload - see
// models.ts for the measurements.
interface RetryTier {
  getModel: () => string;
  maxTokens: number;
  maxAttempts: number;
}

/**
 * The escalation chain, cheapest model first: each tier's model, token cap
 * and number of attempts. callOpenRouter() moves to the next tier once the
 * current one's attempts are spent, or at once on a plain HTTP error.
 *
 * Tier 1's maxAttempts raised 1 -> 2 (2026-09-20), when tier 2's model
 * was replaced (mistralai/mistral-large-2512, deprecated/removed from
 * OpenRouter - see getTruncationFallbackModel's comment in models.ts - by
 * anthropic/claude-haiku-4.5). A second attempt at the default model
 * catches more recoverable truncations/degeneracies before reaching for a
 * costlier tier. Note that
 * every tier in this chain is a genuinely paid model - nothing here runs
 * on a free tier - so this is about relative cost, not about avoiding
 * spend altogether: the default model is simply the cheapest of the four
 * by a wide margin ($0.05/$0.08 per million prompt/completion tokens
 * against tier 2's $1.00/$5.00 - see pricing.ts). This is also what surfaced
 * the isFallbackAttempt fix below: with tier 1 now allowed more than one
 * attempt, "is this attempt a retry" could no longer be inferred from
 * tierIndex alone.
 */
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
// reads already-stored content) found exactly one earlier
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

/**
 * The longest run of words with no punctuation between them, whether it
 * reaches DEGENERATE_RUN_THRESHOLD, and the start of that run as a sample.
 */
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

// A THIRD failure signal: the same whole sentence emitted over and over,
// with ordinary punctuation between each copy.
//
// detectDegenerateRun above only ever catches ONE degeneration signature -
// a single unbroken run of 40+ words with no punctuation at all (the
// "...nonetheless nonetheless nonetheless..." collapse it was built for in
// 2026-09-01). It cannot spot a short, well-punctuated clause
// repeated dozens of times, because every individual chunk between the
// periods is short. That second signature is not hypothetical and not
// rare: re-scanning the entire real corpus this project has generated (689
// stored texts - 500 representative arguments, 189 judge rulings) found 30
// texts (4.4%) with a whole sentence repeated 4+ times, topping out at one
// argument that repeated "I had no other way" 195 times - and the existing
// run detector scored every single one of them clean (their longest
// punctuation-free runs were only 10-24 words, nowhere near the 40-word
// threshold). This is the failure mode behind the original
// frequency_penalty/presence_penalty work.
//
// It flags a text on any of four verbatim-repetition patterns in its
// sentences, two more in its clauses (see CLAUSE_SPLIT below), and two
// near-verbatim ones (see NEAR_COPY_SIMILARITY below). The four:
//   1. the same sentence twice in a row;
//   2. a long sentence (18+ words) twice anywhere in the text;
//   3. any sentence 3+ times anywhere in the text;
//   4. a passage of 3+ consecutive sentences (12+ words) that appears again
//      later, word for word.
// Only sentences of 5+ words count for 1-3, so a short refrain ("Thank
// you.", "I agree.") can never trip them. The longer a sentence, the less
// likely a verbatim restatement of it is deliberate, hence 2 copies for a
// long one against 3 for a short one.
//
// Calibrated against the real corpus, and deliberately tuned to miss as
// little as possible: a degenerate text saved and shown as a successful
// argument is far worse than a sound one discarded and retried, which
// costs a cheap same-model attempt or, at worst, an escalation.
// - The first version (2026-09-20) flagged only 4+ copies anywhere, after
//   every 4x-8x case in the corpus read as genuine degeneration. Below 4
//   was never examined, and a 3-copy loop got through in trial e4a20a68
//   (2026-09-26 22:25 UTC): daenerys_targaryen's closing sentence three
//   times back to back, a fourth copy differing by one word.
// - Re-measured on 2026-09-27 across 830 stored texts. Every text holding
//   a 5+ word sentence twice in a row was read, and each is a loop - an
//   identical sentence restated with nothing between, never a stylistic
//   choice (11 texts). A repeated 3+ sentence passage is the model
//   re-emitting a paragraph (48 texts, among them 5 of the 70 saved since
//   the first version shipped - a 3-5 sentence block pasted again later,
//   twice directly after itself). A sentence 3 times spread across a text
//   is usually a refrain ("He acted to save lives.") rather than a loop,
//   and some are sound ("This test is not met." closing each of Barak's
//   tests) - flagged anyway, on the priority above. A 15+ word sentence
//   twice is at 20+ words a whole thought pasted again (a 41-word one in
//   an Elon ruling); at 15-19 words mostly a refrain ("He had only the
//   knowledge of what must be done and the courage to do it.") and
//   occasionally a structural line ("We will grant this point for the sake
//   of argument and proceed to the next test.") - flagged, on the same
//   priority. Run over the same 830 texts, the four rules, with the
//   long-sentence minimum then at 15, flagged 149 (18%, and 12 of the 70
//   saved since the first version shipped), against 30 for the first
//   version.
// - Measured on live output later on 2026-09-27: 20 local trials of
//   daenerys_targaryen, grey_worm and barak, every one of the 105 replies
//   read. Of the 84 that stopped on their own, the rules rejected 24: 15
//   degenerate and 9 sound, 8 of those 9 on a 16-22 word sentence stated
//   twice (a callback, a bookend, Barak restating each test's question as
//   its heading). Every degenerate reply was rejected except two that
//   repeat nothing - a persona slip and a self-contradicting ruling - which
//   no repetition rule can see. The long-sentence minimum was then raised
//   from 15 to 18 words: re-scored, that clears 2 of the 9 with no
//   degenerate reply lost, and the 24 older stored texts it stops flagging
//   were all read and are all sound. 19 would be one word too far: a
//   looping closing in the stored corpus turns on an 18-word sentence.
// - Measured again at 18 words the same day: 16 more trials, every one of
//   the 74 replies read. Of the 60 that stopped on their own, the rules
//   rejected 12: 10 degenerate and 2 sound. They missed one degenerate
//   reply - a daenerys_targaryen closing re-emitting a 16-word sentence
//   after a single sentence in between, which the 15-word minimum would
//   have caught. That is the recall trade-off of the 18-word minimum, and the
//   first live case of it.
// Anaphora does NOT trip the sentence rules: real anaphora repeats an
// opening phrase and then continues differently ("I ask you to
// consider the scale..." / "I ask you to consider the evidence..."), which
// produces different whole sentences and is therefore invisible to the
// sentence rules - unlike the earlier, abandoned 5-word phrase heuristic,
// which flagged exactly that pattern as a false positive. Two kinds of rule
// below are exceptions. The clause rules: an opening that ends at a comma
// is a clause of its own, and three copies of it close together are
// flagged. And the near-copy rules: anaphora whose sentences share most of
// their words - a closing that restates a line from just above, most often
// - reads as a near-copy, and most of the sound replies they reject are
// exactly that.
//
// Near-verbatim looping, where each copy differs by a word or two ("Jon
// Snow's actions" / "his actions"), is left to the two near-copy rules
// further below, with their own calibration.
//
// It works on real output, not just on the corpus it was calibrated
// against: it catches natural live cases, in local testing and on the
// deployed site alike. Its first live catches were all on the tier-1
// default model. The first seven, under the original 4-copy rule,
// repeated a sentence 4 to 8 times: five in local testing on the day it
// shipped (tyrion_lannister twice, grey_worm three times), then two on the
// deployed site the next day - grey_worm again, at 4 repeats, and later
// the first catch on a judge (shamgar, 5 repeats). The first production
// catch shows what a miss costs: the response had finish_reason=stop at
// 604 tokens, so without this check it would have been saved and shown as
// a perfectly ordinary successful argument. Four more came late on
// 2026-09-26 (UTC): barak (a sentence 4 times), grey_worm (a 17-word
// sentence 4 times), and daenerys_targaryen and elon (an 18-word and a
// 40-word sentence, twice each) - those last two caught only by the
// widened rules. The targeted trials of 2026-09-27 above added many more.
// The older run-on check above had its first two live catches on
// grey_worm, both on the tier-2 model of the time, at 180 and 84 words -
// far past the 40-word line, and the 84-word one was read in full and
// confirmed degenerate.
//
// On false positives: the thresholds above deliberately accept some (a
// refrain, a structural line) in exchange for missing as little as
// possible, and their precision was measured on live output in the two
// runs above. Of the replies these rules rejected in the 20-trial run, 15
// of 24 were degenerate with the long-sentence minimum at 15, and 15 of 22
// at 18; in the 16-trial run, at 18, 10 of 12 - while the whole quality
// gate caught 94.7% and 96.0% of the degenerate replies. Deliberate
// anaphora is safe from the sentence rules by construction: it varies the
// continuation, so the whole sentences differ, and every stored catch of
// those rules shows a full sentence repeated verbatim. The clause and
// near-copy rules work differently, as above. Since 2026-09-27 every discarded reply is
// stored in full (api_call_logs.response_text), so any catch can be read
// and judged after the fact.
const REPEATED_SENTENCE_THRESHOLD = 3;
const CONSECUTIVE_REPEAT_THRESHOLD = 2;
const LONG_SENTENCE_WORDS = 18;
const LONG_SENTENCE_REPEAT_THRESHOLD = 2;
const MIN_WORDS_FOR_REPEAT_CHECK = 5;
const REPEATED_PASSAGE_SENTENCES = 3;
const MIN_WORDS_FOR_REPEATED_PASSAGE = 12;

// The same checks one level down, on clauses: the text cut at commas,
// semicolons and colons as well as at sentence ends. A loop can repeat a
// clause without ever ending a sentence - "...and who had seen the
// destruction she would choose to cause, and who had seen the destruction
// she would choose to cause, ..." 84 times over in a stored grey_worm reply
// (2026-08-29) - which the sentence rules read as one long sentence and
// the run-on check never sees, since every comma resets its count. That
// one ran into the token cap and was discarded as truncated; the same
// loop ending on its own would have been saved as a success.
//
// Two rules, calibrated on 2026-09-27 against the 692 of 844 stored texts
// the rules above pass:
//   1. the same clause (5+ words) twice in a row - matches exactly one of
//      the 692, that loop;
//   2. the same clause (6+ words) 3 times, the third copy no more than 6
//      clauses after the first - matches 5: that loop again, two
//      daenerys_targaryen closings saved as successes on 2026-09-20 that
//      loop a clause with small variations
//      ("...and to render a verdict that reflects the reality of what
//      happened in that throne room" three times over), and two sound but
//      repetitive enumerations ("He knew that if he did not act, more would
//      die. He knew that if he did not act, the realm would suffer...").
//      Those two are accepted false positives, on the priority above:
//      anaphora whose shared opening ends at a comma looks, clause by
//      clause, exactly like a loop.
// With them, and the long-sentence minimum at 15 as it then was, the
// detector flagged 157 of the 844 texts (18.6%), against 152 without; with
// the minimum at 18, 133 (15.8%). The near-copy rules below were measured
// on a larger set, with its own figures.
// Copies spread across a text are left alone: a thesis line restated at
// the start and the end, or a phrase quoted from the Question for
// Judgment ("the presence or absence of safer alternatives"), repeats 3
// times far apart in sound arguments. A 5-word clause 3 times close
// together is left alone too - Barak's "He could have attempted to detain
// Daenerys, but he chose not to" three times over is deliberate.
const CLAUSE_SPLIT = /[.!?;:,]+/;
const MIN_WORDS_FOR_CLAUSE_IN_A_ROW = 5;
const MIN_WORDS_FOR_CLAUSE_CLUSTER = 6;
const CLAUSE_CLUSTER_COPIES = 3;
const CLAUSE_CLUSTER_SPAN = 6;

// Near-verbatim looping: copies that differ by a word or two, which every
// rule above misses because it compares whole sentences or clauses
// exactly. Two sentences count as near-copies by word-level edit distance
// (the number of words to insert, delete or replace to turn one into the
// other), over the length of the longer one. Two rules:
//   1. a near-verbatim passage: 2+ consecutive sentences found again later,
//      each aligned pair at least 80% alike, 10+ words in all (counting the
//      shorter of each pair);
//   2. a looping close: a sentence in the last 10% of the text that is at
//      least 60% like one of the 4 sentences before it, both of 8+ words
//      and not identical. This is the shape the passage rule misses: a
//      closing paragraph that reshuffles the one before it ("I ask you to
//      consider the legacy of a woman who was a threat, who was a
//      liberator..." then "...the legacy of a realm that was torn apart by
//      the actions of a woman who was a threat, who was a liberator...").
// Calibrated on 2026-09-27 against the 959 replies ever kept as a success
// (851 in the database, 108 from deleted targeted trials), of which the
// rules above flag 133 and pass 826. Every reply these two rules flag
// among the 826 was read, 109 in all: 27 clear near-verbatim loops (of 28
// known in the corpus), 44 borderline (a sentence or two re-emitted near
// the end), and 38 sound, mostly a closing that restates a line from the
// paragraph above. Read on the recall-first priority above, and chosen by
// the user over a stricter setting (the last 5%, 12+ words) that, in its
// prototype, rejected 14 sound replies but caught only 24 of the 28. The
// one known loop it misses (a daenerys_targaryen closing, trial dc1cb897)
// re-emits its lines too early for the closing rule and too loosely for
// the passage rule. Neither rule catches a loop that never re-emits a
// sentence, such as an escalating list ("It was the only way to save the
// realm... to save the people... to save the world").
const NEAR_COPY_SIMILARITY = 0.8;
const NEAR_PASSAGE_SENTENCES = 2;
const MIN_WORDS_FOR_NEAR_PASSAGE = 10;
const CLOSING_COPY_SIMILARITY = 0.6;
const CLOSING_SHARE = 0.1;
const CLOSING_LOOKBACK = 4;
const MIN_WORDS_FOR_CLOSING_COPY = 8;

/**
 * Word-level similarity of two normalised sentences, given as their words:
 * one less their word edit distance over the longer one's length - 1 for
 * identical, 0 for nothing in common.
 */
function sentenceSimilarity(a: string[], b: string[]): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length, 1);
}

/**
 * A sentence reduced for comparison: trimmed, lower-cased, whitespace
 * collapsed and punctuation dropped.
 */
function normalizeSentenceForRepeatCheck(sentence: string): string {
  return sentence.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[^\w\s]/g, '');
}

/** The number of words in a sentence already normalised. */
function wordCount(normalized: string): number {
  return normalized.split(' ').filter(Boolean).length;
}

/**
 * The first repetition pattern found, verbatim or near-verbatim, as the
 * reason text a discarded attempt is logged with: the repeated text
 * quoted, and where its copies sit ("sentences 3 and 31 of 32"), so the
 * call log alone shows a closing restatement apart from a loop. The whole
 * reply is stored too (DiscardedAttempt.responseText). The in-a-row check
 * comes first because it names a loop most precisely, and the near-copy
 * checks last, so an exact repeat is reported as one.
 */
function detectRepeatedSentences(content: string): { degenerate: boolean; reason: string } {
  const sentences = content.split(/[.!?]+/).map(normalizeSentenceForRepeatCheck).filter((s) => wordCount(s) > 0);
  const total = sentences.length;
  /** The first 60 characters of a sentence or clause, quoted for a reason text. */
  const quote = (s: string) => `("${s.slice(0, 60)}...")`;
  /** 0-based indexes in, "sentences 3, 17 and 31 of 32" out. */
  const where = (indexes: number[]) => {
    const labels = indexes.map((i) => String(i + 1));
    const list = labels.length > 1 ? `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}` : labels[0];
    return `(sentences ${list} of ${total})`;
  };
  /** A run of sentences or clauses as "4-6", from a 0-based start. */
  const span = (from: number, length: number) => `${from + 1}-${from + length}`;
  /** The article a number takes when read aloud: "an 18-word", "a 6-word". */
  const aOrAn = (n: number) => (n === 11 || n === 18 || String(n).startsWith('8') ? 'an' : 'a');

  let run = 1;
  let longestRun = 1;
  let runEnd = 0;
  for (let i = 1; i < total; i++) {
    run = sentences[i] === sentences[i - 1] && wordCount(sentences[i]) >= MIN_WORDS_FOR_REPEAT_CHECK ? run + 1 : 1;
    if (run > longestRun) {
      longestRun = run;
      runEnd = i;
    }
  }
  if (longestRun >= CONSECUTIVE_REPEAT_THRESHOLD) {
    const from = runEnd - longestRun + 1;
    return {
      degenerate: true,
      reason: `repeated the same sentence ${longestRun} times in a row (sentences ${span(from, longestRun)} of ${total}) ${quote(sentences[runEnd])}`,
    };
  }

  const positions = new Map<string, number[]>();
  sentences.forEach((s, i) => {
    if (wordCount(s) < MIN_WORDS_FOR_REPEAT_CHECK) return;
    positions.set(s, [...(positions.get(s) ?? []), i]);
  });
  for (const [sentence, at] of positions) {
    const words = wordCount(sentence);
    if (words >= LONG_SENTENCE_WORDS && at.length >= LONG_SENTENCE_REPEAT_THRESHOLD) {
      return { degenerate: true, reason: `repeated ${aOrAn(words)} ${words}-word sentence ${at.length} times ${where(at)} ${quote(sentence)}` };
    }
  }
  let most: [string, number[]] = ['', []];
  for (const entry of positions) {
    if (entry[1].length > most[1].length) most = entry;
  }
  if (most[1].length >= REPEATED_SENTENCE_THRESHOLD) {
    return { degenerate: true, reason: `repeated the same sentence ${most[1].length} times ${where(most[1])} ${quote(most[0])}` };
  }

  // A window of consecutive sentences seen again later, without the two
  // copies overlapping, then widened to the full length of the repeat.
  const firstSeen = new Map<string, number>();
  const n = REPEATED_PASSAGE_SENTENCES;
  for (let i = 0; i + n <= total; i++) {
    const window = sentences.slice(i, i + n);
    if (wordCount(window.join(' ')) < MIN_WORDS_FOR_REPEATED_PASSAGE) continue;
    const key = window.join('|');
    const earlier = firstSeen.get(key);
    if (earlier === undefined) {
      firstSeen.set(key, i);
      continue;
    }
    if (earlier + n > i) continue;
    let length = n;
    while (i + length < total && earlier + length < i && sentences[earlier + length] === sentences[i + length]) length++;
    return {
      degenerate: true,
      reason: `repeated a ${length}-sentence passage word for word (sentences ${span(earlier, length)} and ${span(i, length)} of ${total}) ${quote(sentences[i])}`,
    };
  }

  // Clause rules after the sentence rules, so a loop the sentence rules
  // already name is reported in sentences.
  const clauses = content.split(CLAUSE_SPLIT).map(normalizeSentenceForRepeatCheck).filter((c) => wordCount(c) > 0);
  const clauseTotal = clauses.length;
  let clauseRun = 1;
  let longestClauseRun = 1;
  let clauseRunEnd = 0;
  for (let i = 1; i < clauseTotal; i++) {
    clauseRun = clauses[i] === clauses[i - 1] && wordCount(clauses[i]) >= MIN_WORDS_FOR_CLAUSE_IN_A_ROW ? clauseRun + 1 : 1;
    if (clauseRun > longestClauseRun) {
      longestClauseRun = clauseRun;
      clauseRunEnd = i;
    }
  }
  if (longestClauseRun >= CONSECUTIVE_REPEAT_THRESHOLD) {
    const from = clauseRunEnd - longestClauseRun + 1;
    return {
      degenerate: true,
      reason: `repeated the same clause ${longestClauseRun} times in a row (clauses ${span(from, longestClauseRun)} of ${clauseTotal}) ${quote(clauses[clauseRunEnd])}`,
    };
  }

  const clausePositions = new Map<string, number[]>();
  clauses.forEach((c, i) => {
    if (wordCount(c) < MIN_WORDS_FOR_CLAUSE_CLUSTER) return;
    clausePositions.set(c, [...(clausePositions.get(c) ?? []), i]);
  });
  for (const [clause, at] of clausePositions) {
    for (let k = 0; k + CLAUSE_CLUSTER_COPIES <= at.length; k++) {
      const copies = at.slice(k, k + CLAUSE_CLUSTER_COPIES);
      if (copies[copies.length - 1] - copies[0] > CLAUSE_CLUSTER_SPAN) continue;
      const words = wordCount(clause);
      const labels = copies.map((i) => String(i + 1));
      const list = `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
      return {
        degenerate: true,
        reason: `repeated ${aOrAn(words)} ${words}-word clause ${copies.length} times close together (clauses ${list} of ${clauseTotal}) ${quote(clause)}`,
      };
    }
  }

  // Near-copy rules last of all, so an exact repeat is reported as one.
  const tokens = sentences.map((s) => s.split(' ').filter(Boolean));
  /** How alike sentences i and j are - see sentenceSimilarity(). */
  const similar = (i: number, j: number) => sentenceSimilarity(tokens[i], tokens[j]);
  for (let i = 0; i < total; i++) {
    for (let j = i + 1; j < total; j++) {
      let length = 0;
      let words = 0;
      while (i + length < j && j + length < total && similar(i + length, j + length) >= NEAR_COPY_SIMILARITY) {
        words += Math.min(tokens[i + length].length, tokens[j + length].length);
        length++;
      }
      if (length >= NEAR_PASSAGE_SENTENCES && words >= MIN_WORDS_FOR_NEAR_PASSAGE) {
        return {
          degenerate: true,
          reason: `repeated a ${length}-sentence passage almost word for word (sentences ${span(i, length)} and ${span(j, length)} of ${total}) ${quote(sentences[j])}`,
        };
      }
    }
  }

  for (let j = 0; j < total; j++) {
    if ((j + 1) / total < 1 - CLOSING_SHARE || tokens[j].length < MIN_WORDS_FOR_CLOSING_COPY) continue;
    for (let i = Math.max(0, j - CLOSING_LOOKBACK); i < j; i++) {
      if (tokens[i].length < MIN_WORDS_FOR_CLOSING_COPY || sentences[i] === sentences[j]) continue;
      if (similar(i, j) >= CLOSING_COPY_SIMILARITY) {
        return {
          degenerate: true,
          reason: `closed on a near-copy of a sentence just before it (sentences ${i + 1} and ${j + 1} of ${total}) ${quote(sentences[j])}`,
        };
      }
    }
  }

  return { degenerate: false, reason: '' };
}

// Sent on every attempt after the first, whatever caused the retry - a
// same-tier retry as much as an escalation to the next tier. It names both
// content failures it was written for, a reply cut off at the length limit
// and one that trailed into repetitive, run-on text, rather than the one
// that occurred: the retry is not told which, and a single guess (telling
// a looping reply it was "cut off", say) would point the model the wrong
// way.
//
// `attempt > 1` is the gate, so this is also appended after a transient
// failure - a timeout, a 429, an empty-content 200 - where the previous
// attempt produced no content at all. What the reminder asks for - a
// concise, well-punctuated answer that reaches a clear ending - is what
// every retry wants, whatever discarded the attempt before it.
const CONCISENESS_REMINDER: OpenRouterMessage = {
  role: 'user',
  content:
    'Your previous attempt did not produce a usable response - it either ran past the length target and was cut off, or trailed into repetitive, run-on text without normal punctuation before finishing. Write your response again from scratch: stay well within the word count you were given, use clear sentences with normal punctuation throughout, and make sure to reach a clear, complete ending.',
};

// Every discarded attempt - whatever discarded it: truncation or
// degeneration, a plain HTTP failure at that tier, or a transient failure
// - gets logged as its own real row via logApiCall(), not folded silently
// into whichever attempt was eventually kept, and so does a call that
// stops itself because the trial was aborted - the whole point being that
// a reader of the call log can see that a role needed a fallback at all,
// not just its final outcome. All six marker prefixes below are
// duplicated as literal strings in app.js (same pattern as
// ABORTED_BY_USER_MESSAGE, which is defined in db.ts and copied there too) so the frontend can tell a
// discarded-but-recovered attempt from a discarded-and-fatal one without
// any shared module between the two. Adding a marker here means adding it
// there as well. No build step catches a mismatch, but
// tests/shared-constants.test.js does - it reads both files and asserts
// the two sets are identical.
//
// NAMING, worth knowing before trusting the word: "DEGENERATE" in these
// three constants is an umbrella for the whole content-quality class, NOT
// the narrower failure the detectors above look for. It covers both
//   - truncation: finish_reason === 'length'. The model was still going
//     when max_tokens stopped it. That says how the attempt ended, not
//     what the text was like - though a capped reply is usually a
//     repetition loop that ran until the cap stopped it (all 48 whose text
//     was stored, as of 2026-09-27).
//   - degeneration proper: detectDegenerateRun / detectRepeatedSentences.
//     The reply did not hit the cap, and a detector found it unusable.
// They are told apart by how the attempt ended: a reply that hits the cap
// is reported as truncated whatever it contains, a reply that an upstream
// error cut short (finish_reason 'error') is a transient failure, and the
// detectors run on every other reply with text - finish_reason 'stop', the
// usual one, 'content_filter', or none at all. The umbrella name is a
// holdover from when the run-on detector was the only content check there
// was.
//
// The names are kept: these exact strings open the error_message of every
// api_call_logs row they were ever written to, so they are
// effectively a wire format, and renaming them would either break the
// rendering of past trials or mean carrying both spellings forever.
// The distinction is made where it actually reaches a reader instead -
// renderCallLog() in app.js picks its badge (`truncated` vs `degenerated`)
// from the reason text, since only the cap case says "max_tokens limit".
export const DEGENERATE_RETRIED_SAME_MODEL_MARKER = '[degenerate-retried-same-model]';
export const DEGENERATE_RETRIED_DIFF_MODEL_MARKER = '[degenerate-retried-diff-model]';
export const DEGENERATE_FINAL_MARKER = '[degenerate-final]';
// An HTTP error other than a 402, a 408, a 429 or a 5xx (a removed model
// id, a request the endpoint refuses, a key it will not take) at any tier
// but the last, discarded in favour of escalating to the next
// tier - see the `!response.ok` branch below for why this needed its own
// marker rather than falling straight to a terminal failure() the way it
// used to.
// No same-model variant: unlike truncation/degeneracy, retrying the exact
// same model that just returned e.g. a 404 has no plausible upside, so
// this always escalates straight to the next tier rather than spending
// the current tier's remaining attempts first.
export const HTTP_ERROR_ESCALATED_MARKER = '[http-error-escalated]';
// A transient failure (a timeout or network error, a 408, a 429, a 5xx, a
// 200 with no content, or a reply an upstream error cut short) that was
// retried or escalated. These used to leave no trace at all: the retry
// branches simply `continue`d without logging anything, so a call that
// timed out repeatedly showed the user a frozen card and left nothing in
// the call log to explain it afterwards - the exact situation that made a
// real 6-minute stall (2026-09-20) impossible to diagnose from the UI. Now
// each discarded attempt is written as a row of its own the moment it is
// discarded, whatever discarded it (see onDiscardedAttempt below).
export const TRANSIENT_RETRIED_MARKER = '[transient-retried]';
// Written when the user aborted the trial while this call was still
// running server-side. A Background Function cannot be cancelled by the
// client, so the only way to stop spending real money on an abandoned
// trial is for the call itself to notice and bail - see the isAborted
// callback on callOpenRouter(). It ends the role's row sequence in one of
// three ways: the call stopped before starting an attempt ("Stopped before
// attempt N"); an attempt that failed while the abort landed is not
// retried; or a reply that finished after it is not saved
// (finishedAfterAbort below). In every case the call makes no further
// request.
export const ABORTED_MID_CALL_MARKER = '[aborted-mid-call]';

/**
 * A successful result whose trial was aborted while the call was running,
 * turned into the aborted row it now is. The reply ran and was paid for,
 * so it keeps its tokens, cost, duration and text for the log; it is just
 * not a success any more, since nothing will be saved. Any other result
 * is returned unchanged.
 */
export function finishedAfterAbort(result: OpenRouterResult): OpenRouterResult {
  if (result.status !== 'success') return result;
  return {
    ...result,
    status: 'failed',
    content: undefined,
    errorMessage: `${ABORTED_MID_CALL_MARKER} Finished after the user aborted this trial: the reply was complete, but it was not saved.`,
  };
}

// The four markers above that mean "this attempt was thrown away and the
// chain went on to another one" - a row carrying one of them is never a
// role's final outcome. DEGENERATE_FINAL_MARKER and ABORTED_MID_CALL_MARKER
// are final. app.js draws the same line in isRetriedMarkerLog(), and
// tests/shared-constants.test.js asserts the two lists agree.
export const RETRIED_ATTEMPT_MARKERS = [
  DEGENERATE_RETRIED_SAME_MODEL_MARKER,
  DEGENERATE_RETRIED_DIFF_MODEL_MARKER,
  HTTP_ERROR_ESCALATED_MARKER,
  TRANSIENT_RETRIED_MARKER,
];

/**
 * Whether a call-log error message marks an attempt that was discarded and
 * retried, rather than a role's final outcome.
 */
export function isRetriedAttemptMessage(errorMessage: string | null | undefined): boolean {
  return typeof errorMessage === 'string' && RETRIED_ATTEMPT_MARKERS.some((marker) => errorMessage.startsWith(marker));
}

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
  // The model's reply, word for word, when this attempt got one (a
  // truncated or degenerate response). Stored in the call log for audit
  // and never shown on the page; absent for a timeout, an HTTP error or
  // any other attempt that returned no text.
  responseText?: string;
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
  // Absent when the result is not an attempt at all: a call that ended
  // before starting one, because the trial had been aborted or because no
  // OpenRouter key is configured.
  durationMs?: number;
  // Attempts discarded before this result was reached, whatever discarded
  // them - truncation/degeneration, a plain HTTP failure at that tier, or a
  // transient failure. Each one gets its own logApiCall() row alongside
  // this result's own row (written live, through onDiscardedAttempt). An
  // abort is not in here: it ends the chain, so it is this result itself.
  // Empty on the common path (no retry or escalation needed).
  discardedAttempts?: DiscardedAttempt[];
  // The final attempt's reply, word for word, whenever it returned text -
  // on success (where it equals `content`) and on a failure that rejected
  // the text, such as a response still degenerate at the last tier. For
  // the call log, like DiscardedAttempt.responseText.
  responseText?: string;
}

/**
 * Asks OpenRouter for one agent's reply, walking the escalation chain
 * (buildRetryTiers) until an attempt is kept, every tier is spent, the time
 * budget runs out or the trial is aborted - or at once, on a failure no
 * retry can fix: not enough credit (HTTP 402), a rate limit whose reset
 * outlasts the budget, or no OpenRouter key configured. Never throws for an API failure:
 * every outcome, success or failure, comes back as an OpenRouterResult, with
 * the attempts discarded on the way listed in it.
 *
 * @param label Identifies the caller in the log lines below (e.g.
 *   "representative:jon_snow") - purely diagnostic, never sent to OpenRouter
 *   or returned to the client. With seven agents potentially calling this
 *   concurrently, a log line with no indication of which one it belongs to
 *   is close to useless once more than one is in flight at the same time.
 */
export async function callOpenRouter(
  model: string,
  messages: OpenRouterMessage[],
  maxTokens: number,
  label: string,
  // Fired the moment a discarded attempt is decided (see
  // recordFailedAttemptAndAdvance below), before the chain moves on to the
  // next attempt/tier - lets the caller persist it to the DB immediately,
  // rather than only after this whole function returns. That is what puts
  // each discarded attempt in the call log as it happens: before it
  // existed, representative-background.ts/judge-background.ts logged the
  // whole discardedAttempts array in one batch after awaiting this
  // function, so every discarded attempt only became visible once the
  // entire chain had already finished.
  //
  // Note what this does NOT do: it is not what shows a live card
  // "currently trying X". A discarded attempt is by definition over, so
  // this is always one step behind whatever is actually in flight. For a
  // day (2026-09-03) the card's model line did come from these rows, and
  // lagged one attempt behind as a result. onAttemptStart below is what
  // covers that now, and the two exist separately for exactly this reason.
  //
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
  // Checked before every attempt (including the first), and again as each
  // failed attempt is recorded (see recordFailedAttemptAndAdvance), so an
  // attempt that fails as the abort lands is not retried. Returning true
  // means the user aborted this trial while this call was still running,
  // and the chain stops immediately instead of spending more real money on
  // a result nobody is waiting for any more. A reply that succeeds after
  // the abort is caught by the agent handler instead (finishedAfterAbort).
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
  /** How much of TOTAL_BUDGET_MS this call has left. */
  const remainingMs = () => TOTAL_BUDGET_MS - (Date.now() - startedAt);
  const estimatedPromptTokens = estimatePromptTokens(messages);

  /**
   * Whether the trial has been aborted, through the caller's isAborted.
   * False when there is no such callback, and when the check itself fails.
   */
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

  /**
   * Records one failed attempt and moves the chain forward, for EVERY kind
   * of failure rather than only the content-quality ones.
   *
   * This unification is the fix for a real, load-bearing bug (2026-09-20):
   * `attemptsAtTier++` used to live exclusively inside the
   * truncation/degeneracy branch, so every other retry path - timeout, 429,
   * 5xx, an empty-content 200 - looped with `continue` while leaving both
   * `attemptsAtTier` and `tierIndex` untouched. A call whose attempts kept
   * timing out therefore retried the SAME model at the SAME tier until the
   * entire 650s budget drained, never once escalating, while
   * `attemptInTier` (reported as `attemptsAtTier + 1`) stayed pinned at 1 -
   * which is why two judge cards sat on "Model: mistral-small (first
   * attempt)" for six unbroken minutes through roughly nine separate
   * 43-second timeouts. The escalation chain existed but was unreachable
   * for the most common failure modes it should have been covering.
   *
   * `skipRestOfTier` is for failures where the same request to the same
   * model gets the same answer - the HTTP errors the `!response.ok` branch
   * handles, such as a removed model id (404), a refused request (400,
   * 403) or a key the endpoint will not take (401).
   */
  async function recordFailedAttemptAndAdvance(opts: {
    marker: string;
    // Used instead of `marker` when this failure actually moves the chain
    // to a different model, so the call log can distinguish "re-tried the
    // same model" from "escalated" - the two read very differently to
    // someone reading the log afterwards.
    escalatedMarker?: string;
    model: string;
    reason: string;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    cost?: number;
    responseText?: string;
    skipRestOfTier?: boolean;
    // Set only for genuinely transient failures: a 408, a 429, a 5xx, a 200
    // with no content or with a reply an upstream error cut short, and the
    // fetch-level catch (a timeout or a network error). That last one is included on purpose
    // even though a real timeout can never be "fast" - a network error
    // that fails instantly, like a DNS blip or a connection reset, is
    // exactly the case worth a cheap same-model retry.
    // A fast one of these gets a free same-model retry that does not spend
    // a tier attempt - see FAST_FAILURE_THRESHOLD_MS. Deliberately NOT set
    // for an HTTP error like a removed model id (the same request gets the
    // same answer) or for truncation/degeneracy (a real generation that
    // genuinely used its turn).
    allowFastRetry?: boolean;
  }): Promise<{ canContinue: boolean; allTiersExhausted: boolean; aborted?: OpenRouterResult }> {
    const attemptDurationMs = Date.now() - lastAttemptStartedAt;

    // An abort that landed while this attempt was running ends the call
    // here, with this attempt as its final row - checked before anything
    // is logged as "re-tried" or "escalated", since neither will now
    // happen. The attempt keeps its real tokens, cost and reply: it ran
    // and was paid for. Every caller returns `aborted` as the result.
    if (await checkAborted()) {
      const r = opts.reason.replace(/\.$/, '');
      const what = /^This attempt /.test(r) ? r : /^(was|did|failed|returned) /.test(r) ? `This attempt ${r}` : `This attempt failed: ${r}`;
      console.warn(`[openrouter] ${label}: aborted by user while an attempt was running - not retrying.`);
      return {
        canContinue: false,
        allTiersExhausted: false,
        aborted: {
          status: 'failed',
          model: opts.model,
          promptTokens: opts.usage?.promptTokens ?? 0,
          completionTokens: opts.usage?.completionTokens ?? 0,
          totalTokens: opts.usage?.totalTokens ?? 0,
          cost: opts.cost ?? 0,
          errorMessage: `${ABORTED_MID_CALL_MARKER} ${what}. Not retried: the user aborted this trial while it was running. Nothing was saved.`,
          discardedAttempts,
          durationMs: attemptDurationMs,
          responseText: opts.responseText,
        },
      };
    }

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
        responseText: opts.responseText,
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
        responseText: opts.responseText,
      };
      discardedAttempts.push(discarded);
      if (onDiscardedAttempt) {
        try {
          await onDiscardedAttempt(discarded);
        } catch (err) {
          // Never let a logging failure interrupt the actual escalation -
          // this callback exists purely to make progress visible sooner,
          // not to gate whether the chain can keep going. The cost is that
          // an attempt whose write fails is missing from the call log: the
          // agent functions log only their final result afterwards, not
          // the returned discardedAttempts array, so nothing re-writes it.
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
    // Reached with no attempt in progress: before the first one, or after
    // a backoff pause. (An abort that lands while an attempt is running is
    // caught when that attempt is recorded - see recordFailedAttemptAndAdvance
    // - or, after a success, by the agent handler before it logs the reply.)
    // The row this returns is not an attempt, so it has no duration and no
    // tokens; it used to carry the previous attempt's duration again, which
    // the call log's total then counted twice.
    //
    // An abort never cancels a request already in flight, deliberately. This
    // app does not stream, and OpenRouter documents that cancelling a
    // non-streaming request does not stop the model or its billing - "you
    // will be billed for the complete response" - so an abort cannot save
    // that money, only lose track of it. The attempt is left to finish and
    // is logged truthfully, and nothing further is requested.
    if (await checkAborted()) {
      const message = `${ABORTED_MID_CALL_MARKER} Stopped before attempt ${attempt + 1}: the user aborted this trial while the call was still running server-side. Nothing further was requested and nothing was saved.`;
      console.warn(`[openrouter] ${label}: aborted by user mid-call - stopping the chain rather than spending further budget.`);
      return failure(lastAttemptModel, message, undefined, discardedAttempts);
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
        // Same tolerance as onDiscardedAttempt (in
        // recordFailedAttemptAndAdvance above) - a failure to record
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
          // A real response was observed spiralling into the same short
          // clause repeated for its entire remaining token budget (never
          // reaching a natural stopping point) - a known small-model
          // degeneration mode, not a prompt-content problem, since the
          // system prompt already gives an explicit word-count target.
          // frequency_penalty scales with how often a token has already
          // appeared, which specifically counteracts a loop that would
          // otherwise keep reinforcing itself; presence_penalty adds a
          // smaller flat push away from anything already said, encouraging
          // the response to keep moving towards an actual conclusion.
          //
          // Raised from an earlier 0.4/0.2 after real testing showed that
          // pair wasn't reliably enough: a live response still spiralled
          // into "He knew that I was a threat to the realm. He knew that I
          // was a threat to his sisters..." repeated for the entire
          // remaining budget, on both the original attempt and the
          // truncation retry of the time - whose added instruction then
          // addressed only length, not repetition, so it couldn't have
          // fixed this on its own (CONCISENESS_REMINDER covers both now).
          // Still comfortably short of values (near the +/-2.0 ends) that
          // visibly distort normal prose.
          frequency_penalty: 0.7,
          presence_penalty: 0.35,
        }),
        signal: AbortSignal.timeout(attemptTimeout),
      });

      if (response.status === 429) {
        // Distinguish a limit that clears while this call can still wait
        // from one that does not. A 429 from one of OpenRouter's own
        // platform limits carries X-RateLimit-Limit, -Remaining and -Reset,
        // describing the limit that was hit (OpenRouter's limits docs, read
        // 2026-10-03; the reset is in epoch ms, as read from a real 429 on
        // this project in its free-tier days). A 429 passed on from an
        // upstream provider carries no reset, and goes to the retry path
        // below like any burst limit. When the reset is later than this
        // call's remaining time budget, retrying would only hammer a limiter
        // that will keep refusing until after the call has to end, and
        // report a useless "gave up after N attempts" instead of the actual
        // reason, so the call ends here with that reason.
        const resetAt = Number(response.headers.get('x-ratelimit-reset'));
        const retryAfterMs = Number.isFinite(resetAt) && resetAt > 0 ? resetAt - Date.now() : 0;

        if (retryAfterMs > remainingMs()) {
          const resetIso = new Date(resetAt).toISOString();
          const limit = response.headers.get('x-ratelimit-limit');
          const message = `OpenRouter rate-limited this request (HTTP 429${limit ? `, limit ${limit}` : ''}) until ${resetIso}, later than this call's remaining time budget.`;
          console.log(`[openrouter] ${label}: attempt ${attempt} - ${message}`);
          return failure(attemptModel, message, lastUsage, discardedAttempts, Date.now() - lastAttemptStartedAt, { tierIndex, tierCount: tiers.length });
        }

        lastError = `OpenRouter returned HTTP 429 (rate limited)`;
        console.log(`[openrouter] ${label}: attempt ${attempt} - ${lastError}, retrying`);
        {
          // A fast bounce gets a few free same-model retries first (see
          // FAST_FAILURE_THRESHOLD_MS); past those, or for a slow one, it
          // counts against this tier's attempt budget like any other
          // failure, so a rate-limited tier escalates to the next model
          // instead of hammering the same one until the budget drains.
          // Escalating is a genuinely good response to a persistent rate
          // limit: the next tier is a different model, often on a
          // different provider path entirely.
          const next = await recordFailedAttemptAndAdvance({
            marker: TRANSIENT_RETRIED_MARKER,
            model: attemptModel,
            reason: 'was rate limited (HTTP 429)',
            allowFastRetry: true,
          });
          if (next.aborted) return next.aborted;
          // The pause comes after the attempt is recorded, never before:
          // recordFailedAttemptAndAdvance() times the attempt, and a backoff
          // taken first was counted as part of it - inflating the logged
          // duration by up to 2.3s, and meaning a failure had to come back
          // in about 8s, not the intended FAST_FAILURE_THRESHOLD_MS, to
          // count as fast. The same holds at every backoff() below.
          if (next.canContinue) {
            await backoff(attempt);
            continue;
          }
          return failure(attemptModel, lastError, lastUsage, discardedAttempts, Date.now() - lastAttemptStartedAt, { tierIndex, tierCount: tiers.length });
        }
      }

      if (response.status === 402) {
        // Not enough credit for this request: OpenRouter answers 402 when
        // what is left of the account's balance, or of this key's own
        // spending limit, cannot cover the request at its max_tokens -
        // which can happen before the balance reaches zero - and when the
        // balance is negative. Retrying within this call cannot change
        // that: a same-tier retry would ask for the same, and each later
        // tier for a larger max_tokens. So this returns immediately rather
        // than retrying like the 429 branch above and the 5xx branch below,
        // with OpenRouter's own message appended. The wording matters
        // because it is what a reader actually sees: this message is persisted to
        // api_call_logs.error_message and rendered verbatim on the agent's
        // card, so it has to explain itself without a status code beside
        // it. (It used to be matched by an isOutOfCredits() helper in
        // app.js, which existed because the agent endpoints wrap an
        // OpenRouter-layer failure as a 502 and the client therefore could
        // not read the 402 directly. That helper went away with the move to
        // Background Functions - the client no longer sees the agent's
        // response at all, only what polling reads back out of the log -
        // so nothing parses this string today.)
        const message = `OpenRouter declined the request: not enough credit to cover it (HTTP 402): ${await describeErrorBody(response)}`;
        console.log(`[openrouter] ${label}: attempt ${attempt} - ${message}`);
        return failure(attemptModel, message, undefined, discardedAttempts, Date.now() - lastAttemptStartedAt, { tierIndex, tierCount: tiers.length });
      }

      // A 408 is OpenRouter's own "your request timed out" - the same
      // failure as an attempt this code times out itself - so it is
      // retried, not skipped like a refused request (the !response.ok
      // branch below). It shares this branch with the 5xx errors, the
      // backoff() pause after it included.
      if (response.status >= 500 || response.status === 408) {
        lastError = `OpenRouter returned HTTP ${response.status}`;
        console.log(`[openrouter] ${label}: attempt ${attempt} - ${lastError}, retrying`);
        {
          const next = await recordFailedAttemptAndAdvance({
            marker: TRANSIENT_RETRIED_MARKER,
            model: attemptModel,
            reason: response.status === 408 ? 'timed out at OpenRouter (HTTP 408)' : `failed upstream (HTTP ${response.status})`,
            allowFastRetry: true,
          });
          if (next.aborted) return next.aborted;
          if (next.canContinue) {
            await backoff(attempt);
            continue;
          }
          return failure(attemptModel, lastError, lastUsage, discardedAttempts, Date.now() - lastAttemptStartedAt, { tierIndex, tierCount: tiers.length });
        }
      }

      if (!response.ok) {
        const message = `OpenRouter returned HTTP ${response.status}: ${await describeErrorBody(response)}`;
        console.log(`[openrouter] ${label}: attempt ${attempt} - ${message}`);

        // Every other HTTP error lands here: a removed model id (404), a
        // request the endpoint refuses (400, or 403 for a moderation or
        // guardrail block), a key it will not take (401).
        //
        // Real incident (2026-09-20): mistralai/mistral-large-2512, tier
        // 2's model at the time (it is anthropic/claude-haiku-4.5 now -
        // see models.ts), was deprecated/removed from OpenRouter's
        // catalogue sometime after this chain was built, so every call that
        // needed to escalate past tier 1 failed outright here with HTTP
        // 404 "No endpoints found for mistralai/mistral-large-2512" - even
        // though tier 3 (openai/gpt-5.6-sol) and tier 4
        // (google/gemini-2.5-pro) were both still real, live models the
        // entire time. This branch used to return a terminal failure()
        // unconditionally, which is what let one dead model id at one
        // tier kill the whole call regardless of how many working tiers
        // stood after it - at the time, tier escalation covered only the
        // content-quality failures (truncation/degeneracy), never a plain
        // HTTP failure. Escalates straight to the next tier (skipping any
        // remaining attempts at this one, unlike the degenerate/truncation
        // path) since retrying the exact same broken model id would just
        // fail identically again - see HTTP_ERROR_ESCALATED_MARKER's own
        // comment for why there's no same-model variant here.
        const next = await recordFailedAttemptAndAdvance({
          marker: HTTP_ERROR_ESCALATED_MARKER,
          model: attemptModel,
          reason: message,
          // Unlike a timeout or a 429, each of these is the endpoint's answer
          // to this request - the model does not exist, refuses it, or will
          // not take this key - and the same request gets the same answer,
          // so the tier's remaining attempts are skipped rather than spent
          // asking again.
          skipRestOfTier: true,
        });
        if (next.aborted) return next.aborted;
        if (next.canContinue) continue;
        return failure(attemptModel, message, undefined, discardedAttempts, Date.now() - lastAttemptStartedAt, { tierIndex, tierCount: tiers.length });
      }

      const data = (await response.json()) as any;
      const content: string | undefined = data?.choices?.[0]?.message?.content;
      const usage = data?.usage ?? {};
      const promptTokens = usage.prompt_tokens ?? 0;
      const completionTokens = usage.completion_tokens ?? 0;
      const totalTokens = usage.total_tokens ?? promptTokens + completionTokens;

      // OpenRouter answers 200 as soon as a provider accepts the request, so
      // an error after that point arrives in the body, not the status
      // (OpenRouter's errors docs, read 2026-10-04): as a top-level `error`
      // object, or as an `error` inside the choice, which then has
      // finish_reason 'error' and carries whatever text came before it.
      const choice = data?.choices?.[0];
      const upstreamError: string | undefined = data?.error?.message ?? choice?.error?.message;
      const cutShort = Boolean(content) && (choice?.finish_reason === 'error' || Boolean(choice?.error));

      if (!content || cutShort) {
        // Four shapes land here: (1) a 200 whose body carries an error and
        // no text; (2) a genuinely empty `choices[0].message.content` with
        // no `error` present; (3) a reasoning model that spent all of
        // max_tokens on its reasoning and returned no visible text, as
        // google/gemini-2.5-pro (tier 4, see modelRequiresReasoning in
        // models.ts) did on 2026-09-20 at a 20-token cap. Tier 4's 4000
        // leaves that model room: its six calls on this project used
        // 2,053-2,564 tokens, reasoning included; (4) text that an upstream
        // error cut short, which is only part of a reply, so it is never
        // kept. All four are logged as `no response` and retried or
        // escalated like any transient failure, and a call that ends on one
        // names the error or the finish_reason in its message. A capped
        // reply with text goes to the truncation check below instead.
        const finishReason = choice?.finish_reason ?? 'unknown';
        lastError = cutShort
          ? `OpenRouter/upstream error partway through the reply: ${upstreamError ?? 'finish_reason=error'}`
          : upstreamError
            ? `OpenRouter/upstream error: ${upstreamError}`
            : `OpenRouter response contained no message content (finish_reason=${finishReason}, prompt_tokens=${promptTokens}, completion_tokens=${completionTokens}).`;
        lastUsage = { promptTokens, completionTokens, totalTokens };
        console.log(`[openrouter] ${label}: attempt ${attempt} - ${lastError}, retrying`);
        {
          const next = await recordFailedAttemptAndAdvance({
            marker: TRANSIENT_RETRIED_MARKER,
            model: attemptModel,
            reason: cutShort
              ? 'was cut short by an upstream error partway through its reply'
              : upstreamError
                ? 'returned an upstream error instead of content'
                : 'returned no message content',
            usage: lastUsage,
            // The partial text, kept for audit like any discarded reply.
            responseText: content || undefined,
            allowFastRetry: true,
          });
          if (next.aborted) return next.aborted;
          if (next.canContinue) {
            await backoff(attempt);
            continue;
          }
          return {
            ...failure(attemptModel, lastError, lastUsage, discardedAttempts, Date.now() - lastAttemptStartedAt, { tierIndex, tierCount: tiers.length }),
            responseText: content || undefined,
          };
        }
      }

      const servingModel: string = data?.model ?? attemptModel;
      const finishReason = data?.choices?.[0]?.finish_reason;
      console.log(
        `[openrouter] ${label}: attempt ${attempt} - success, served by ${servingModel}, ${completionTokens} completion tokens, finish_reason=${finishReason ?? 'unknown'}, ${Date.now() - startedAt}ms total`
      );
      const lengthTruncated = finishReason === 'length';
      // Not run on a reply that hit the token cap: that reply is reported
      // as truncated whatever its text holds, and discarded either way.
      const degenerateCheck = !lengthTruncated ? detectDegenerateRun(content) : null;
      // The second degeneration signature, and the one the run-length check
      // above cannot spot - see detectRepeatedSentences. Skipped for a
      // capped reply too, for the same reason.
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
            `[openrouter] ${label}: DEGENERATE - response did not hit the cap (finish_reason=${finishReason}) but contains a ${degenerateCheck.runLength}-word run with no punctuation ("${degenerateCheck.sample}...") - treating as a failure rather than trusting a technically-complete but incoherent result.`
          );
          // The offending text is quoted into the persisted reason, not just
          // the console line, so the call log itself shows what tripped the
          // check - a count alone ("repeated the same sentence 5 times")
          // says nothing about whether the catch was genuine. The whole
          // reply is stored alongside it (responseText below, the call log's
          // response_text) for a full read. Kept short so the call log
          // stays readable.
          reason = `collapsed into a ${degenerateCheck.runLength}-word run with no punctuation ("${degenerateCheck.sample.slice(0, 60)}...")`;
        } else {
          console.warn(
            `[openrouter] ${label}: DEGENERATE - response did not hit the cap (finish_reason=${finishReason}) but ${repeatCheck!.reason} - treating as a failure rather than trusting a technically-complete but looping result.`
          );
          // Same reasoning as the run-on case above: the quote, and where
          // the copies sit, show at a glance what tripped the check.
          reason = repeatCheck!.reason;
        }

        const next = await recordFailedAttemptAndAdvance({
          marker: DEGENERATE_RETRIED_SAME_MODEL_MARKER,
          escalatedMarker: DEGENERATE_RETRIED_DIFF_MODEL_MARKER,
          model: servingModel,
          reason: `This attempt ${reason}`,
          usage: { promptTokens, completionTokens, totalTokens },
          cost: calculateCost(servingModel, promptTokens, completionTokens),
          responseText: content,
        });
        if (next.aborted) return next.aborted;
        if (next.canContinue) continue;
        // Still bad (truncated or degenerate) after using every attempt at
        // every tier (or there was no budget left for another) - neither
        // failure mode is a degraded-but-usable result, and an argument or
        // ruling that's cut off, or that collapses into repetitive
        // run-on text, isn't fair to present as the character's actual
        // position. This is the fatal case: the chain has nothing further
        // to try, unlike every discarded attempt already recorded above.
        // Treated as a real failure, not returned as a
        // technically-successful result for the caller to badge and move
        // on - the agent Background Functions already treat any `status:
        // 'failed'` result as a normal, visible failure, so this needs no
        // special handling on their side. This attempt's own tokens/cost
        // are reported on its own row here - every earlier discarded
        // attempt already has its own row via discardedAttempts, so
        // nothing is folded in here to avoid double-reporting spend.
        // Two different situations end here, and each gets its own wording:
        // allTiersExhausted means every tier this chain offers was tried;
        // otherwise the time budget ran out while another attempt was still
        // allowed - on this tier or a later one - so "every tier was tried"
        // would be false.
        const allTiersExhausted = next.allTiersExhausted;
        console.warn(
          `[openrouter] ${label}: still unusable ${allTiersExhausted ? 'after every tier' : 'with no time budget left for another attempt'} - returning failed rather than an unusable result.`
        );
        const errorMessage = allTiersExhausted
          ? `${DEGENERATE_FINAL_MARKER} Every model tier was tried (${tiers.length} in total, ending with ${servingModel}) and none produced a usable response - the final attempt ${reason}. Nothing was saved.`
          : `${DEGENERATE_FINAL_MARKER} This attempt (tier ${tierIndex + 1} of ${tiers.length}, ${servingModel}) ${reason}, and the remaining time budget ran out before another attempt could be made. Nothing was saved.`;
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
          responseText: content,
        };
      }

      return {
        status: 'success',
        content,
        responseText: content,
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
        if (next.aborted) return next.aborted;
        if (next.canContinue) {
          // backoff()'s delay exists to avoid hammering a rate limiter that
          // will keep refusing for a moment - a real reason to wait after
          // the 429/408/5xx/empty-content branches above, which can come
          // back in moments. A timeout here has already run its attempt's
          // whole ceiling, so a further pause would only spend budget the
          // next attempt can use. A network error that failed at once
          // still gets the pause.
          if (!isTimeout) await backoff(attempt);
          continue;
        }
        return failure(attemptModel, lastError, lastUsage, discardedAttempts, Date.now() - lastAttemptStartedAt, { tierIndex, tierCount: tiers.length });
      }
    }
  }

  const message = `${lastError} (gave up after ${attempt} attempt(s), ${TOTAL_BUDGET_MS}ms budget)`;
  console.log(`[openrouter] ${label}: ${message}`);
  return failure(lastAttemptModel, message, lastUsage, discardedAttempts, Date.now() - lastAttemptStartedAt, { tierIndex, tierCount: tiers.length });
}

/**
 * A terminal failure's message, prefixed with the fact that every tier was
 * tried when that is so, and returned unchanged otherwise.
 *
 * Applied to a terminal failure only when it happened on the LAST
 * escalation tier (tierIndex === tierCount - 1) - i.e. every tier this
 * chain offers was genuinely tried and none of them produced a kept
 * result, regardless of which specific failure mode ended it (an HTTP
 * error, a rate limit, not enough credit, a timeout or network error, an
 * empty response, or a reply an upstream error cut short). Truncation and degeneration never come through
 * here: the DEGENERATE_FINAL_MARKER branch above words that case itself.
 * A failure that happens on an EARLIER tier (the time budget running out
 * before the chain reached the last tier, say, or a failure no retry can
 * fix, such as not enough credit) is a different, less complete situation and keeps its
 * own specific message instead of falsely claiming every tier was
 * exhausted.
 */
function withTierContext(rawMessage: string, tierIndex: number, tierCount: number, attemptModel: string): string {
  if (tierIndex !== tierCount - 1) return rawMessage;
  return `Every model tier was tried (${tierCount} in total, ending with ${attemptModel}) and none produced a usable response. Last attempt: ${rawMessage}`;
}

/**
 * A failed OpenRouterResult, priced from the attempt's own usage when it got
 * any, and with withTierContext() applied when tierContext is given.
 */
function failure(
  model: string,
  errorMessage: string,
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number },
  discardedAttempts?: DiscardedAttempt[],
  durationMs?: number,
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

/** A response's body as text, or a placeholder if it cannot be read. */
async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '(no response body)';
  }
}

/**
 * The reason a failed response gives, as readable text.
 *
 * Every non-ok failure path wants a human-readable reason, not a raw
 * response body - OpenRouter error responses are typically
 * {"error":{"message":"..."}}, so this pulls that message out when
 * present and only falls back to the raw text (still better than nothing)
 * when the body isn't that shape at all.
 */
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

/**
 * Exponential backoff with jitter, capped at 2-2.3s, which keeps the
 * fast-failure retries (MAX_FAST_TRANSIENT_RETRIES_PER_TIER) to a few
 * seconds of waiting per tier. The jitter matters here:
 * the agents in each phase (all four representatives, then all three
 * judges) run concurrently on one account, and an unjittered backoff
 * makes them all retry in lockstep.
 */
function backoff(attempt: number): Promise<void> {
  const base = Math.min(400 * Math.pow(2, attempt), 2000);
  const delayMs = base + Math.random() * 300;
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
