import type { Handler } from '@netlify/functions';
import { safeHandler } from './lib/safeHandler';
import { json } from './lib/response';
import { extractParams } from './lib/extractParams';
import { getChargeSheet } from './lib/chargeSheet';
import { REPRESENTATIVES } from './lib/representatives';
import { buildRepresentativeMessages } from './lib/prompts';
import { callOpenRouter } from './lib/openrouter';
import { getTrial, upsertRepresentativeArgument, logApiCall } from './lib/db';
import type { RepresentativeRole } from './lib/types';

// Real headroom for this model's natural verbosity — a tighter cap cut
// arguments off mid-sentence.
const MAX_TOKENS = 1000;

const rawHandler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const { id, role } = extractParams(event, 2);
  if (!id || !role) {
    return json(400, { error: 'Missing trial id or role' });
  }

  if (!(role in REPRESENTATIVES)) {
    return json(400, { error: `Unknown representative role: ${role}` });
  }
  const repRole = role as RepresentativeRole;
  const def = REPRESENTATIVES[repRole];

  const trial = await getTrial(id);
  if (!trial) {
    return json(404, { error: 'Trial not found' });
  }

  const caseDef = await getChargeSheet();
  const messages = buildRepresentativeMessages(repRole, caseDef);
  const result = await callOpenRouter(repRole, messages, MAX_TOKENS);

  await logApiCall({
    trialId: id,
    agentRole: repRole,
    callType: 'representative',
    modelUsed: result.model,
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
    totalTokens: result.totalTokens,
    cost: result.cost,
    status: result.status,
    errorMessage: result.errorMessage ?? null,
  });

  if (result.status === 'failed' || !result.content) {
    return json(502, {
      role: repRole,
      status: 'failed',
      error: result.errorMessage ?? 'Unknown failure',
    });
  }

  await upsertRepresentativeArgument({
    trialId: id,
    role: repRole,
    seat: def.seat,
    argumentText: result.content,
    modelUsed: result.model,
  });

  return json(200, {
    role: repRole,
    seat: def.seat,
    status: 'success',
    argumentText: result.content,
    modelUsed: result.model,
    tokens: {
      prompt: result.promptTokens,
      completion: result.completionTokens,
      total: result.totalTokens,
    },
    cost: result.cost,
  });
};

export const handler = safeHandler(rawHandler);
