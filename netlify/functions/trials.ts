import type { Handler } from '@netlify/functions';
import { safeHandler } from './lib/safeHandler';
import { json } from './lib/response';
import { createTrial, listTrials } from './lib/db';
import { getChargeSheet } from './lib/chargeSheet';
import { isSiteGateOk } from './lib/siteGate';

const rawHandler: Handler = async (event) => {
  if (event.httpMethod === 'GET') {
    // Read-only history listing stays fully open, gate or no gate -
    // browsing past runs spends no OpenRouter quota and only trivial
    // Netlify/Supabase cost either way, regardless of who's looking.
    const trials = await listTrials();
    return json(200, { trials });
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  // Trial creation itself never calls OpenRouter - the global call cap in
  // db.ts doesn't apply here - but gating it too costs nothing and means
  // a bot can't even get as far as holding a trial id to attack the
  // representative/judge endpoints with.
  if (!isSiteGateOk(event.headers)) {
    return json(401, { error: 'Missing or invalid site gate header.' });
  }

  const caseDef = await getChargeSheet();
  const trial = await createTrial(caseDef.caseCode);

  return json(201, { trial, caseDef });
};

export const handler = safeHandler(rawHandler);
