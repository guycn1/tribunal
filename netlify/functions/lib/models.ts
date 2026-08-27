// Model routing. DEFAULT_MODEL and the per-role MODEL_* overrides are public
// model identifiers, not credentials — they intentionally are not treated as
// secrets by the deploy pipeline.

const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free';

// Fallback chain sent to OpenRouter alongside the primary model. These
// free-tier models run on a shared upstream worker pool that is regularly
// saturated ("ResourceExhausted: Worker local total request limit reached
// (16/16)"), which is by far the most common cause of a failed call here.
// Each model id has its own independent pool, so naming alternates lets
// OpenRouter route around a full one instead of returning an error -
// measured at 6/6 successful calls with this list versus roughly 2/5
// without it.
//
// Deliberately Nvidia-only: other providers' free tiers were tested and
// found unreliably congested. nemotron-3.5-lightning is deliberately
// excluded from THIS chain despite being an Nvidia free model - measured at
// 25s+ to generate even a trivial reply, which would consume most of a
// single attempt's timeout budget on every normal call rather than help.
// See LAST_DITCH_MODEL below for where it's actually used instead.
const FALLBACK_MODELS = [
  'nvidia/nemotron-3-super-120b-a12b:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
];

// Tried exactly once, with no internal retry and no fallback array of its
// own, and only after the frontend's own retry-until-success ceiling
// against the normal chain above has been exhausted - a deliberate,
// visible last resort rather than a silent addition to every call. See
// callOpenRouterOnce in openrouter.ts.
const LAST_DITCH_MODEL = 'nvidia/nemotron-3.5-lightning:free';

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

export function getModelForRole(role: string): string {
  const envVar = ROLE_ENV_VAR[role];
  const override = envVar ? process.env[envVar] : undefined;
  return override || DEFAULT_MODEL;
}

// The primary model followed by the fallbacks, deduplicated in case the
// configured primary is itself one of the fallbacks. Order is meaningful:
// OpenRouter tries them left to right.
export function getModelChainForRole(role: string): string[] {
  const primary = getModelForRole(role);
  return [primary, ...FALLBACK_MODELS.filter((m) => m !== primary)];
}

export function getLastDitchModelForRole(_role: string): string {
  // No per-role override exists for the last-ditch escape hatch (none has
  // been needed) - routed through a function anyway, rather than exporting
  // the bare constant, so a future override slots in the same way
  // getModelForRole's does.
  return LAST_DITCH_MODEL;
}
