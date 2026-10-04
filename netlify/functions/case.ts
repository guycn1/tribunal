import type { Handler } from '@netlify/functions';
import { safeHandler } from './lib/safeHandler';
import { json } from './lib/response';
import { getChargeSheet } from './lib/chargeSheet';
import { ALL_AGENT_ROLES, getModelForRole, AGENT_MAX_TOKENS } from './lib/models';

/**
 * GET /api/case
 *
 * Returns the fixed case record on its own, with no trial created and no
 * agent calls made — lets the frontend show the charge sheet immediately on
 * page load, before a visitor has decided to run a trial at all.
 *
 * Also returns the starting model configured per role and tier 1's shared
 * token cap, read from models.ts, so the frontend shows which model a call
 * starts on (a live card then follows the chain through agent_progress)
 * without a copy of models.ts that would fall out of step with a model
 * changed through its environment variable, and flags a row saved
 * truncated before that became a failure (a completion that is a multiple
 * of maxTokens - see isLegacyTruncation() in app.js, and the comment on
 * AGENT_MAX_TOKENS in models.ts). This is itself just a config read, no
 * OpenRouter call involved.
 */
const rawHandler: Handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method not allowed' });
  }

  const caseDef = await getChargeSheet();

  const modelInfo: Record<string, string> = {};
  for (const role of ALL_AGENT_ROLES) {
    modelInfo[role] = getModelForRole(role);
  }

  return json(200, { caseDef, modelInfo, maxTokens: AGENT_MAX_TOKENS });
};

export const handler = safeHandler(rawHandler);
