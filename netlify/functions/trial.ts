import type { Handler } from '@netlify/functions';
import { safeHandler } from './lib/safeHandler';
import { json } from './lib/response';
import { extractParams } from './lib/extractParams';
import { getFullTrial } from './lib/db';
import { getChargeSheet } from './lib/chargeSheet';

/**
 * GET /api/trials/:id
 *
 * One trial in full - its arguments, rulings, call log and live progress
 * (see getFullTrial in db.ts) - with the case record. This is what the page
 * polls while a trial runs, and what it reads to open one from history.
 */
const rawHandler: Handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method not allowed' });
  }

  const { id } = extractParams(event, 1);
  if (!id) {
    return json(400, { error: 'Missing trial id' });
  }

  const data = await getFullTrial(id);
  if (!data) {
    return json(404, { error: 'Trial not found' });
  }

  const caseDef = await getChargeSheet();

  return json(200, { ...data, caseDef });
};

export const handler = safeHandler(rawHandler);
