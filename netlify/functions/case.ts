import type { Handler } from '@netlify/functions';
import { safeHandler } from './lib/safeHandler';
import { json } from './lib/response';
import { getChargeSheet } from './lib/chargeSheet';

// Returns the fixed case record on its own, with no trial created and no
// agent calls made — lets the frontend show the charge sheet immediately on
// page load, before a visitor has decided to run a trial at all.
const rawHandler: Handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method not allowed' });
  }

  const caseDef = await getChargeSheet();
  return json(200, { caseDef });
};

export const handler = safeHandler(rawHandler);
