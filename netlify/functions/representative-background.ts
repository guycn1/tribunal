import type { Handler } from '@netlify/functions';
import { safeHandler } from './lib/safeHandler';
import { json } from './lib/response';
import { extractParams } from './lib/extractParams';
import { getChargeSheet } from './lib/chargeSheet';
import { REPRESENTATIVES } from './lib/representatives';
import { buildRepresentativeMessages } from './lib/prompts';
import { callOpenRouter } from './lib/openrouter';
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

  // Both checks below run before any Supabase trial lookup or OpenRouter
  // call, so a request that fails either one costs nothing beyond a single
  // fast count query at most. See siteGate.ts and isGlobalCallCapExceeded
  // in db.ts for what each actually protects against and why neither
  // alone is sufficient.
  //
  // As a Background Function (see config.background below), this JSON
  // response is no longer what the real caller sees - Netlify responds 202
  // to the client immediately and runs this handler asynchronously, so a
  // rejection here now only reaches the frontend if it's discoverable by
  // polling GET /api/trials/:id. Deliberately NOT writing either rejection
  // to api_call_logs to reach that poll: the site-gate check exists to
  // reject automated traffic for near-zero cost, which a Supabase write
  // here would undercut for exactly the traffic it's meant to filter; the
  // call-cap check has its own, separate, already-documented reason never
  // to log its own trip (self-perpetuation - see isGlobalCallCapExceeded).
  // console.warn keeps both visible in Netlify's function logs, just not
  // in the poll-driven UI - a real, disclosed trade-off, not an oversight.
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
      error: `Site-wide call cap reached (${cap.count}/${GLOBAL_CALL_CAP} calls in the last 24h). Refusing to spend further API budget - try again later.`,
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
  const result = await callOpenRouter(
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
  });

  // Checked AFTER logApiCall above, deliberately: whatever this call
  // actually did still belongs in the log (the project's "visible failure,
  // never silent" rule doesn't stop applying because the user walked away,
  // and a role the client never listed as pending would otherwise leave no
  // trace at all). What an aborted trial must NOT get is a saved result -
  // quietly resurrecting an argument minutes after the user stopped the
  // trial would contradict both the abort row and the sidebar's "Aborted"
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

// Per-IP rate limit on this function specifically, since it's one of the
// two that actually spend OpenRouter money (the other is
// judge-background.ts) - not
// declared on trials.ts/case.ts, which never call OpenRouter regardless of
// how often they're hit. Path matches how this function is actually
// reached: netlify.toml redirects /api/trials/:id/representatives/:role
// here as /.netlify/functions/representative-background/:id/:role,
// so the glob covers every id/role combination.
//
// windowLimit/windowSize are deliberately generous, not tight - this is a
// backstop against a single source hammering the function in a burst,
// not the thing meant to bound total cost (that's the global cap in
// db.ts, layered underneath this). A real user running several trials in
// a short window, or retrying after a transient failure, must keep
// working.
//
// background: true is the real fix for a verified, load-bearing problem:
// Netlify's free-tier synchronous function limit is 10 seconds (confirmed
// against Netlify's own docs and support forum - not the ~30s this file
// used to assume), while every real OpenRouter call measured on this
// project at the time had taken 8-18s+ per attempt. A standard invocation
// could not reliably survive that gap regardless of any retry/timeout tuning inside
// callOpenRouter() - only a genuinely different execution model
// (Background Functions, up to 15 minutes) closes it. The tradeoff: the
// client no longer receives this handler's return value directly (Netlify
// responds 202 immediately) - the frontend now discovers the real outcome
// by polling GET /api/trials/:id instead of awaiting this call's response
// body. See the comment above the site-gate/call-cap checks for the one
// real, disclosed gap this introduces (those two rejections are no longer
// visible to the poller, only in function logs).
//
// The file is named representative-background.ts, not representative.ts,
// for a real, load-bearing reason found by reading netlify-cli's own
// source directly: locally, netlify dev decides whether a function gets
// the 900-second background timeout or the 30-second synchronous one
// purely by checking whether the function's name ends in "-background" -
// it does not read this config.background export at all for that
// decision. Without the suffix, local dev was silently giving these calls
// the synchronous 30s ceiling regardless of this file's own config,
// which is exactly what was killing real, otherwise-successful calls in
// local testing. Both config.background here and the filename suffix are
// kept together, since Netlify's own docs list the filename suffix as a
// still-supported legacy convention alongside the modern config property.
//
// The `path` below was also updated to match this file's new name
// (representative-background, not representative) - a first attempt at
// this rename assumed a custom `path` fully overrides a function's
// default name-derived URL regardless of the file's actual name, which
// is what Netlify's own docs describe, but that assumption produced a
// real, observed regression: every call returned a synchronous 404
// immediately after the rename, with netlify.toml's redirect still
// pointing at the old name-based URL. Fixed by updating both this `path`
// and the matching redirect target in netlify.toml to the new name,
// rather than relying on the old path continuing to resolve under a
// renamed file - not yet root-caused exactly why the override didn't
// hold locally, but keeping `path` and the actual filename in agreement
// avoids depending on that assumption at all.
//
// SINCE CONFIRMED IN PRODUCTION (this used to read "unverified"): the
// deployed site has run real trials on this exact shape - config.background
// plus the -background filename plus the matching netlify.toml redirect -
// and the calls genuinely ran as Background Functions there. The direct
// proof came on 2026-09-21: across four full 7-agent trials against the
// live site, all 28 trigger POSTs returned Netlify's own automatic HTTP
// 202 in roughly 0.3-0.5s, rather than blocking for the real 9-21s
// generation. No handler in this repository ever returns 202, so that
// status can only have come from the platform treating these as Background
// Functions. (An earlier, incidental proof pointed the same way: a
// production trial on 2026-09-20 had two judge calls run for roughly six
// unbroken minutes server-side - impossible for a synchronous invocation,
// which dies at the 10-second ceiling.) So whatever the platform keys off,
// this combination works deployed.
//
// What is still genuinely unknown, and no longer matters much: whether the
// platform needs the filename suffix or merely tolerates it alongside
// config.background. Both are present and the pair is confirmed working, so
// there is nothing to act on - only a reason not to drop either one
// casually.
//
// STILL UNVERIFIED: whether the rate-limit path glob below is what
// Netlify's rate limiter actually matches against. Local netlify dev does
// not simulate rate limiting at all, and nothing has exercised it against
// the deployed site, so this one is unchanged from when it was written. If
// it turns out not to match, the consequence is the quiet loss of one of
// three anti-abuse layers - the global call cap in db.ts and the site gate
// both still apply - not a break of anything.
// No `: Config` type annotation here on purpose: the RateLimitConfig type
// shipped by the installed @netlify/functions version (2.8.2, checked
// 2026-09-26) is missing `windowLimit` entirely, even though it's a real,
// required field in
// Netlify's own build-time schema (confirmed directly against the zod
// schema its bundler actually validates against, in
// node_modules/netlify-cli's vendored zip-it-and-ship-it package) - a
// stale type export, not a real constraint. TypeScript types are erased
// at build time (esbuild, per netlify.toml) and have no effect on what
// the platform reads from this export, so annotating against the stale
// type would only fight the type-checker over something already correct.
export const config = {
  path: '/.netlify/functions/representative-background/*',
  background: true,
  rateLimit: {
    windowLimit: 45,
    windowSize: 300,
    aggregateBy: ['ip'],
  },
};
