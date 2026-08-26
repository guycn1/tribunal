import type { Handler } from '@netlify/functions';
import { safeHandler } from './lib/safeHandler';
import { json } from './lib/response';
import { createTrial, listTrials } from './lib/db';
import { getChargeSheet } from './lib/chargeSheet';

const rawHandler: Handler = async (event) => {
  if (event.httpMethod === 'GET') {
    const trials = await listTrials();
    return json(200, { trials });
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const caseDef = await getChargeSheet();
  const trial = await createTrial(caseDef.caseCode);

  return json(201, { trial, caseDef });
};

export const handler = safeHandler(rawHandler);
