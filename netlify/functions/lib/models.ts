// Model routing. DEFAULT_MODEL, the per-role MODEL_* overrides and the three
// fallback-tier variables below are public model identifiers, not
// credentials — they intentionally are not treated as secrets by the deploy
// pipeline.

const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'mistralai/mistral-small-24b-instruct-2501';

const ROLE_ENV_VAR: Record<string, string> = {
  jon_snow: 'MODEL_JON_SNOW',
  tyrion_lannister: 'MODEL_TYRION_LANNISTER',
  daenerys_targaryen: 'MODEL_DAENERYS_TARGARYEN',
  grey_worm: 'MODEL_GREY_WORM',
  barak: 'MODEL_BARAK',
  elon: 'MODEL_ELON',
  shamgar: 'MODEL_SHAMGAR',
};

// All seven agent roles, for endpoints that report model configuration
// across the whole roster (see case.ts) rather than one role at a time.
export const ALL_AGENT_ROLES = Object.keys(ROLE_ENV_VAR);

// Tier 1's completion-token cap. Shared by representative-background.ts and
// judge-background.ts, and exposed to the frontend via case.ts, so there is
// exactly one place this number is defined (test fixtures restate the
// current value, but nothing reads it from them) - the frontend derives
// "was this response truncated?" by comparing a completed call's
// completion_tokens against this same constant (see isTruncated() in
// app.js, which now fires only on historical rows), and that would
// silently go wrong if the two ever drifted apart.
// One shared value for both roles rather than two separate ones: real
// measured calls have shown both representatives and judges capable of
// running past what their stated word-count target would suggest, so
// there's no real basis for giving one role type less headroom than the
// other.
export const AGENT_MAX_TOKENS = 1400;

/**
 * The model a role's call starts on: its MODEL_<ROLE> override if set,
 * DEFAULT_MODEL otherwise.
 */
export function getModelForRole(role: string): string {
  const envVar = ROLE_ENV_VAR[role];
  const override = envVar ? process.env[envVar] : undefined;
  return override || DEFAULT_MODEL;
}

// Tier 2 of the escalation chain (see buildRetryTiers in openrouter.ts),
// reached once tier 1 is done - normally after both of its attempts are
// used up, on truncation/degeneration or on transient failures that ran
// long enough to count, though a plain HTTP failure at tier 1 escalates
// at once. Deliberately a different model from
// whatever getModelForRole() resolves to, not the same one tried again -
// and one assumed to be more capable, though that is a judgement about
// these models generally and not something measured on this workload.
// Real data showed a same-model retry doesn't behave
// like an independent second attempt: once a role's first attempt
// truncated, a same-model retry truncated again roughly 60-75% of the
// time (measured on daenerys_targaryen/grey_worm, the two roles this
// affects most) - not a fresh roll, closer to "that generation was
// already in a bad state." A genuinely different model doesn't share
// whatever drives that correlation.
//
// Was mistralai/mistral-large-2512 (chosen for the same vendor family as
// the default model, for style/formatting consistency with prompts tuned
// without a cross-vendor model in mind) until that model id was
// deprecated/removed from OpenRouter's catalog sometime after this chain
// was built - confirmed directly (2026-09-20): its own OpenRouter model
// page now 404s, and every real call that needed to escalate past tier 1
// failed outright rather than reaching the still-live tiers 3/4 (see
// HTTP_ERROR_ESCALATED_MARKER in openrouter.ts for the escalation-chain
// bug that let one dead tier kill the whole call, fixed separately from
// this).
//
// Replaced with anthropic/claude-haiku-4.5 - a genuinely different vendor,
// breaking the original same-family rationale, but the failure modes this
// tier exists to fix (truncation, repetition-loop degeneration) are small/
// weak-model behaviors that a model of this class is expected not to
// exhibit at any meaningful rate for a single ~300-600 word structured
// piece of writing. That was the reason for the choice, and it has since
// been measured on this workload rather than left as an expectation.
//
// Measured in three fixed samples, all on the exact workload this tier
// serves:
//   - a targeted batch of 16 calls (2026-09-21) that drove the real
//     callOpenRouter() with the real Grey Worm and Daenerys prompts at this
//     tier's real 2800-token allowance, omitting the CONCISENESS_REMINDER a
//     real escalation carries (so slightly harsher than production).
//     Completion lengths ran 502-789 tokens, the longest reaching 28% of
//     the cap;
//   - the 7 escalations the chain reached on its own in ordinary trials up
//     to 2026-09-26, each after 2-3 discarded attempts - five locally, and
//     two on the deployed site on 2026-09-21 (grey_worm, after a
//     repeated-sentence degeneration and then a truncation at tier 1, at
//     605 tokens in 9.3s; later that day daenerys_targaryen, after two
//     truncations, at 640 tokens in 10.1s);
//   - the 22 escalations in the targeted local trials of 2026-09-27, each
//     reply read in full.
// In all three, every call finished on its own and was kept: none was
// truncated, caught by a detector, or discarded. One of the 22 was still
// judged degenerate on reading - a daenerys_targaryen argument that spoke
// as Jon Snow ("I knew Daenerys. I loved her.") - a persona failure that
// repeats nothing, so no rule here could catch it.
//
// Read that for what it is: a real result on these samples, and no basis
// for saying this model will never truncate or degenerate - no sample
// size establishes that, here or at any other tier. What it does show is
// that the looping failure modes this tier exists to catch have not
// appeared, at a cap the model is nowhere near reaching. The predecessor
// at this tier, for contrast, logged 88 calls in its time: 74 kept, 11
// attempts discarded and retried, and 3 terminal failures.
//
// Crossing vendors here is not a new risk either - tiers 3/4 already do
// it from the default, across many real trials. Real, verified pricing
// (per pricing.ts): $1.00/$5.00 per million prompt/completion tokens vs.
// the dead Mistral Large's $0.50/$1.50 - a real 2-3x step up, which is why
// tier 1 was given a second attempt of its own (see buildRetryTiers) to
// catch more recoverable failures at the cheap default model before ever
// reaching this pricier tier.
const TRUNCATION_FALLBACK_MODEL = process.env.TRUNCATION_FALLBACK_MODEL || 'anthropic/claude-haiku-4.5';

/** Tier 2's model - see TRUNCATION_FALLBACK_MODEL above. */
export function getTruncationFallbackModel(): string {
  return TRUNCATION_FALLBACK_MODEL;
}

// Third and fourth escalation tiers, reached once the tier above is done
// with - normally because it used up every attempt allowed it, though a
// plain HTTP error there escalates at once and forfeits the rest (see the
// tiered retry loop in openrouter.ts). They exist because real measured
// data on tier 2's original model (mistralai/mistral-large-2512) found it
// not reliable enough on its own (a real, if rare, case truncated on both
// of its own attempts too). These two are
// deliberately two models from two different companies, neither an
// incremental step within the same family: escalating vendor as well as
// assumed capability removes any shared-family quirk as an explanation,
// not just a shared-size one. Their capability ranking relative to each
// other and to tier 2 is an assumption, not a measurement.
//
// What has been measured, from api_call_logs up to 2026-09-27: every
// openai/gpt-5.6-sol call was kept, none discarded; google/gemini-2.5-pro's
// only failures were the HTTP 400 "Reasoning is mandatory" rejection from
// before modelRequiresReasoning() existed below, i.e. a configuration fault
// rather than anything about the output. Neither had produced a truncated
// or degenerate result. Same caveat as tier 2: that records what was seen
// in those calls, and is not a promise about what will be.
// Reached rarely enough (only after every earlier tier has already
// failed) that the real cost impact stays small despite a materially
// higher per-token price than either the default model or tier 2 - see
// pricing.ts.
const TOP_TIER_FALLBACK_MODEL = process.env.TOP_TIER_FALLBACK_MODEL || 'openai/gpt-5.6-sol';
const LAST_RESORT_FALLBACK_MODEL = process.env.LAST_RESORT_FALLBACK_MODEL || 'google/gemini-2.5-pro';

/** Tier 3's model - see the comment above TOP_TIER_FALLBACK_MODEL. */
export function getTopTierFallbackModel(): string {
  return TOP_TIER_FALLBACK_MODEL;
}

/** Tier 4's model - see the comment above TOP_TIER_FALLBACK_MODEL. */
export function getLastResortFallbackModel(): string {
  return LAST_RESORT_FALLBACK_MODEL;
}

// Some models reject `reasoning: { enabled: false }` outright (OpenRouter
// returns HTTP 400: "Reasoning is mandatory for this endpoint and cannot
// be disabled.") rather than silently ignoring it - discovered for real
// via an isolated tier-4 sanity test on google/gemini-2.5-pro, which
// failed every single call this way. openrouter.ts checks this before
// deciding whether to include the reasoning field in a request at all.
const MODELS_WITH_MANDATORY_REASONING = new Set<string>(['google/gemini-2.5-pro']);

/**
 * Whether a model rejects a request that turns reasoning off, so the
 * reasoning field must be left out of its requests.
 */
export function modelRequiresReasoning(model: string): boolean {
  return MODELS_WITH_MANDATORY_REASONING.has(model);
}
