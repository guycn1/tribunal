import type { Handler } from '@netlify/functions';
import { safeHandler } from './lib/safeHandler';
import { json } from './lib/response';
import { getChargeSheet } from './lib/chargeSheet';
import { ALL_AGENT_ROLES, getModelChainForRole, getLastDitchModelForRole } from './lib/models';

// Returns the fixed case record on its own, with no trial created and no
// agent calls made — lets the frontend show the charge sheet immediately on
// page load, before a visitor has decided to run a trial at all.
//
// Also returns the real model configuration per role, so the frontend can
// show which models are actually in play (normal chain, last-ditch) without
// hardcoding a copy of models.ts that could silently drift out of sync -
// this is itself just a config read, no OpenRouter call involved.
const rawHandler: Handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method not allowed' });
  }

  const caseDef = await getChargeSheet();

  const modelInfo: Record<string, { chain: string[]; lastDitch: string }> = {};
  for (const role of ALL_AGENT_ROLES) {
    modelInfo[role] = {
      chain: getModelChainForRole(role),
      lastDitch: getLastDitchModelForRole(role),
    };
  }

  return json(200, { caseDef, modelInfo });
};

export const handler = safeHandler(rawHandler);
