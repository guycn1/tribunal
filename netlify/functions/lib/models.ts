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
// excluded despite being an Nvidia free model - it was measured taking 25s+
// to generate even a trivial reply, which would blow the per-call time
// budget rather than help.
const FALLBACK_MODELS = [
  'nvidia/nemotron-3-super-120b-a12b:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
];

const ROLE_ENV_VAR: Record<string, string> = {
  jon_snow: 'MODEL_JON_SNOW',
  tyrion_lannister: 'MODEL_TYRION_LANNISTER',
  daenerys_targaryen: 'MODEL_DAENERYS_TARGARYEN',
  grey_worm: 'MODEL_GREY_WORM',
  barak: 'MODEL_BARAK',
  elon: 'MODEL_ELON',
  shamgar: 'MODEL_SHAMGAR',
};

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
