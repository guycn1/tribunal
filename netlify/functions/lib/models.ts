// Model routing. DEFAULT_MODEL and the per-role MODEL_* overrides are public
// model identifiers, not credentials — they intentionally are not treated as
// secrets by the deploy pipeline.

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

export function getModelForRole(role: string): string {
  const envVar = ROLE_ENV_VAR[role];
  const override = envVar ? process.env[envVar] : undefined;
  return override || DEFAULT_MODEL;
}
