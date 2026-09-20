import type { Handler } from '@netlify/functions';
import { safeHandler } from './lib/safeHandler';
import { json } from './lib/response';
import { extractParams } from './lib/extractParams';
import { REPRESENTATIVES } from './lib/representatives';
import { JUDGES } from './lib/judges';
import { logApiCall, ABORTED_BY_USER_MESSAGE } from './lib/db';

// POST /api/trials/:id/abort
// Body: { roles: string[] } - the agent roles still pending (loading, or
// mid-retry/mid-escalation) when the user clicked Abort.
//
// What this endpoint writes is one 'failed' row per pending role, carrying
// a distinct, exact error message (see ABORTED_BY_USER_MESSAGE / wasAborted
// in db.ts), which does two separate jobs:
//
//   1. It makes the abort visible and persistent, so a trial the user
//      deliberately stopped reads as "Aborted" in the run-history sidebar
//      rather than as a generic failure - or as a falsely-clean success, if
//      an abandoned call happens to finish anyway.
//   2. It is also the ONLY durable, server-visible signal that the abort
//      happened, and the agent Background Functions poll for it: a client
//      aborting its own fetch() cannot stop a Background Function, so each
//      in-flight call checks isTrialAborted() between attempts and stops
//      itself (see the isAborted callback on callOpenRouter, and
//      isTrialAborted in db.ts).
//
// So this call does stop server-side work, just indirectly - by leaving a
// record the running calls notice, not by cancelling anything. It cannot
// interrupt an HTTP request already in flight; it stops the next attempt,
// which is where the escalation chain's real cost lives. An earlier version
// of this comment said the abort could not stop server-side work at all,
// which was true before that mechanism was added (2026-09-20) and is not
// true now.
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
