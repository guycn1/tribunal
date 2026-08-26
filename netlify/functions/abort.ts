import type { Handler } from '@netlify/functions';
import { safeHandler } from './lib/safeHandler';
import { json } from './lib/response';
import { extractParams } from './lib/extractParams';
import { REPRESENTATIVES } from './lib/representatives';
import { JUDGES } from './lib/judges';
import { logApiCall, ABORTED_BY_USER_MESSAGE } from './lib/db';

// POST /api/trials/:id/abort
// Body: { roles: string[] } - the agent roles still pending (loading,
// retrying, or in the last-ditch attempt) when the user clicked Abort.
//
// This does not, and cannot, reliably stop the corresponding Netlify
// function invocations server-side - a client aborting its own fetch()
// does not guarantee the request it was talking to stops running. What
// this call actually does is make the fact of the abort visible and
// persistent: one 'failed' row per pending role, with a distinct, exact
// error message the run-history sidebar checks for (see
// ABORTED_BY_USER_MESSAGE / wasAborted in db.ts) so a trial the user
// deliberately stopped reads as "Aborted," not as a generic failure or a
// falsely-clean success if the abandoned call happens to complete anyway.
const rawHandler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const { id } = extractParams(event, 1);
  if (!id) {
    return json(400, { error: 'Missing trial id' });
  }

  let body: { roles?: unknown };
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return json(400, { error: 'Malformed JSON body' });
  }

  const roles = Array.isArray(body.roles) ? body.roles.filter((r): r is string => typeof r === 'string') : [];

  const logged: string[] = [];
  for (const role of roles) {
    const callType = role in REPRESENTATIVES ? 'representative' : role in JUDGES ? 'judge' : null;
    if (!callType) continue; // unknown role - nothing sensible to log

    await logApiCall({
      trialId: id,
      agentRole: role,
      callType,
      modelUsed: 'n/a',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cost: 0,
      status: 'failed',
      errorMessage: ABORTED_BY_USER_MESSAGE,
    });
    logged.push(role);
  }

  return json(200, { ok: true, logged });
};

export const handler = safeHandler(rawHandler);
