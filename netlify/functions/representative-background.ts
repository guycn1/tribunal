import type { Handler } from '@netlify/functions';
import { safeHandler } from './lib/safeHandler';
import { json } from './lib/response';
import { extractParams, cameThroughApiRoute } from './lib/extractParams';
import { getChargeSheet } from './lib/chargeSheet';
import { REPRESENTATIVES } from './lib/representatives';
import { buildRepresentativeMessages } from './lib/prompts';
import { callOpenRouter, finishedAfterAbort } from './lib/openrouter';
import { getModelForRole, AGENT_MAX_TOKENS } from './lib/models';
import { getTrial, upsertRepresentativeArgument, logApiCall, upsertAgentProgress, isGlobalCallCapExceeded, isTrialAborted, GLOBAL_CALL_CAP } from './lib/db';
import { isSiteGateOk } from './lib/siteGate';
import type { RepresentativeRole } from './lib/types';

// 1000 previously let a real argument (the longest of its group, 1000
// completion tokens - exactly the old cap) run out mid-sentence. Now
// shares AGENT_MAX_TOKENS with judge-background.ts - see the comment on
// that constant in models.ts for why one shared value. This is tier 1's
// cap only; later escalation tiers get more (see buildRetryTiers in
// openrouter.ts).
const MAX_TOKENS = AGENT_MAX_TOKENS;

/**
 * POST /api/trials/:id/representatives/:role
 *
 * Runs one representative's call, as a Background Function: the browser
 * gets Netlify's 202 at once and learns the outcome by polling
 * GET /api/trials/:id. Every attempt is logged, and the argument is saved
 * unless the call failed or the trial was aborted meanwhile.
 */
const rawHandler: Handler = async (event) => {
  // Netlify serves this function at its own address,
  // /.netlify/functions/representative-background/..., as well as through
  // its route in netlify.toml, and the per-IP rate limit is set on the
  // route. So the first check refuses any request that did not come through
  // the route, before anything else is read or written: every request this
  // handler acts on has passed the limit. Not logged, like the method and
  // role checks below - refusing costs nothing.
  if (!cameThroughApiRoute(event)) {
    return json(403, { error: 'Only accepted through /api/trials/:id/representatives/:role' });
  }

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

  // Both checks below run before any Supabase trial lookup or OpenRouter
  // call, so a request that fails either one costs nothing beyond a single
  // fast count query at most. See siteGate.ts and isGlobalCallCapExceeded
  // in db.ts for what each actually protects against and why neither
  // alone is sufficient.
  //
  // As a Background Function (see the end of this file), this JSON
  // response is no longer what the real caller sees - Netlify responds 202
  // to the client immediately and runs this handler asynchronously, so a
  // rejection here now only reaches the frontend if it's discoverable by
  // polling GET /api/trials/:id. Deliberately NOT writing either rejection
  // to api_call_logs to reach that poll: the site-gate check exists to
  // reject automated traffic for near-zero cost, which a Supabase write
  // here would undercut for exactly the traffic it's meant to filter; the
  // call-cap check has its own, separate, already-documented reason never
  // to log its own trip (self-perpetuation - see isGlobalCallCapExceeded).
  // console.warn keeps both visible in Netlify's function logs; the page
  // does not see them, by design.
  if (!isSiteGateOk(event.headers)) {
    console.warn(`representative:${repRole}: rejected - missing or invalid site gate header.`);
    return json(401, { role: repRole, status: 'failed', error: 'Missing or invalid site gate header.' });
  }

  const cap = await isGlobalCallCapExceeded();
  if (cap.exceeded) {
    console.warn(`representative:${repRole}: rejected - global call cap reached (${cap.count}/${GLOBAL_CALL_CAP}).`);
    return json(429, {
      role: repRole,
      status: 'failed',
      error: `Site-wide call cap reached (${cap.count}/${GLOBAL_CALL_CAP} call-log rows in the last 24h). Refusing to spend further API budget - try again later.`,
    });
  }

  const trial = await getTrial(id);
  if (!trial) {
    return json(404, { error: 'Trial not found' });
  }

  const caseDef = await getChargeSheet();
  const messages = buildRepresentativeMessages(repRole, caseDef);

  // Every discarded attempt gets its own real call-log row too - whatever
  // discarded it (truncation/degeneration, a plain HTTP failure at that
  // tier, or a transient failure) - written the moment callOpenRouter()
  // decides to discard it (not batched after the whole chain finishes).
  // That is what lets a client polling GET /api/trials/:id see the
  // escalation happening live, mid-call, instead of only learning about it
  // once this role's result is already final.
  let result = await callOpenRouter(
    getModelForRole(repRole),
    messages,
    MAX_TOKENS,
    `representative:${repRole}`,
    (discarded) =>
      logApiCall({
        trialId: id,
        agentRole: repRole,
        callType: 'representative',
        modelUsed: discarded.model,
        promptTokens: discarded.promptTokens,
        completionTokens: discarded.completionTokens,
        totalTokens: discarded.totalTokens,
        cost: discarded.cost,
        status: 'failed',
        errorMessage: discarded.errorMessage,
        durationMs: discarded.durationMs,
        responseText: discarded.responseText,
      }),
    // Overwrites the one agent_progress row for this role the moment each
    // attempt starts - see the "currently in flight" comment on
    // upsertAgentProgress in db.ts. This is what a client polling mid-call
    // actually reads to show the real current model/attempt, rather than
    // only learning about escalation once an attempt is discarded (which
    // is always one step behind the attempt that's actually running).
    (info) =>
      upsertAgentProgress({
        trialId: id,
        role: repRole,
        model: info.model,
        tierIndex: info.tierIndex,
        attemptInTier: info.attemptInTier,
        tierMaxAttempts: info.tierMaxAttempts,
      }),
    // Stops the escalation chain if the user abandoned this trial while it
    // was still running - see the isAborted parameter's own comment in
    // openrouter.ts for why a Background Function needs to poll for this
    // rather than being cancelled directly.
    () => isTrialAborted(id)
  );

  // A reply that finished after the user aborted the trial is logged as
  // what it now is - aborted, and not saved - rather than as a success; see
  // finishedAfterAbort in openrouter.ts.
  if (result.status === 'success' && (await isTrialAborted(id))) result = finishedAfterAbort(result);

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
    durationMs: result.durationMs,
    // Kept even when the argument is saved too: it is what makes a row
    // auditable on its own, including a result discarded below because the
    // trial was aborted meanwhile.
    responseText: result.responseText,
  });

  // Checked AFTER logApiCall above, deliberately: whatever this call
  // actually did still belongs in the log (the project's "visible failure,
  // never silent" rule doesn't stop applying because the user walked away,
  // and a role the client never listed as pending would otherwise leave no
  // trace at all). What an aborted trial must NOT get is a saved result -
  // quietly resurrecting an argument minutes after the user stopped the
  // trial would contradict both the abort row and the sidebar's `aborted`
  // badge. Re-checked here rather than inferred from the result, since the
  // call may well have completed in the window before the abort landed.
  if (await isTrialAborted(id)) {
    console.warn(`representative:${repRole}: trial was aborted by the user - discarding this result instead of saving it.`);
    return json(200, { role: repRole, status: 'aborted' });
  }

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

// This runs as a Netlify Background Function because of its filename: the
// "-background" suffix is how Netlify declares one for a function written,
// like every function in this project, with a named `handler` export.
// Locally, netlify dev reads the same suffix and gives it the much longer
// background timeout rather than the synchronous one - as read in the
// netlify-cli source installed on 2026-08-29; package.json allows later
// 17.x releases, which could change it. The same goes for
// judge-background.ts.
//
// Why a Background Function at all: the synchronous limit on Netlify's
// free plan, as documented when checked on 2026-08-28, was far shorter
// (the budget here was first built around a mistaken, longer one) than
// real calls on the default model at the time routinely took per attempt.
// No retry or timeout tuning inside callOpenRouter() could close that gap;
// Background Functions get far longer. The trade-off: the client never
// receives this handler's return value, since Netlify answers 202 at once, so the frontend learns the
// outcome by polling GET /api/trials/:id - see the comment above the
// site-gate and call-cap checks for what that means for their rejections.
// Confirmed in production on 2026-09-21: all 28 trigger POSTs across four
// live trials came back with Netlify's own 202 in ~0.3-0.5s, a status no
// handler in this repository returns.
//
// No `config` export, on purpose. Netlify's bundler reads one only from a
// function written with a default export; for a named `handler` export
// like this one it ignores everything in it (parseSource in
// @netlify/zip-it-and-ship-it 9.42.1, the version inside the installed
// netlify-cli, read on 2026-10-02; a later version could differ). An exported config here
// once declared background: true, a custom path and a per-IP rate limit,
// and none of the three ever took effect: the 202s come from the filename,
// routing comes from netlify.toml, and the rate limit was never applied -
// 75 requests in 80 seconds from one IP on 2026-10-02 all got through. The
// per-IP rate limit is on this function's redirect in netlify.toml, and the
// handler's first check accepts only requests that came that way.
//
// The filename and the redirect target in netlify.toml must name the same
// function. When this file was renamed from representative.ts, every call
// returned 404 until the redirect was updated to match.
