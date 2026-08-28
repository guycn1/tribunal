import type { Handler } from '@netlify/functions';
import { safeHandler } from './lib/safeHandler';
import { json } from './lib/response';
import { extractParams } from './lib/extractParams';
import { getChargeSheet } from './lib/chargeSheet';
import { REPRESENTATIVES } from './lib/representatives';
import { buildRepresentativeMessages } from './lib/prompts';
import { callOpenRouter } from './lib/openrouter';
import { getModelForRole, AGENT_MAX_TOKENS } from './lib/models';
import { getTrial, upsertRepresentativeArgument, logApiCall, isGlobalCallCapExceeded, GLOBAL_CALL_CAP } from './lib/db';
import { isSiteGateOk } from './lib/siteGate';
import type { RepresentativeRole } from './lib/types';

// 1000 previously let a real argument (the longest of its group, 1000
// completion tokens - exactly the old cap) run out mid-sentence. Now
// shares AGENT_MAX_TOKENS with judge.ts - see the comment on that constant
// in models.ts for why one shared value.
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
  if (!isSiteGateOk(event.headers)) {
    return json(401, { role: repRole, status: 'failed', error: 'Missing or invalid site gate header.' });
  }

  const cap = await isGlobalCallCapExceeded();
  if (cap.exceeded) {
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

  const result = await callOpenRouter(getModelForRole(repRole), messages, MAX_TOKENS, `representative:${repRole}`);

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

// Per-IP rate limit on this function specifically, since it's one of the
// two that actually spend OpenRouter money (the other is judge.ts) - not
// declared on trials.ts/case.ts, which never call OpenRouter regardless of
// how often they're hit. Path matches how this function is actually
// reached: netlify.toml redirects /api/trials/:id/representatives/:role
// here as /.netlify/functions/representative/:id/:role (see netlify.toml),
// so the glob covers every id/role combination.
//
// windowLimit/windowSize are deliberately generous, not tight - this is a
// backstop against a single source hammering the function in a burst,
// not the thing meant to bound total cost (that's the global cap in
// db.ts, layered underneath this). A real user running several trials in
// a short window, or retrying after a transient failure, must keep
// working.
//
// UNVERIFIED IN PRODUCTION: local netlify dev does not simulate rate
// limiting, and this project has separately, repeatedly found that its
// redirect-based routing behaves differently locally than once deployed
// (see the "Production deployment" bug log entries). Whether this exact
// path glob is what Netlify's rate limiter actually matches against - the
// redirect's source path or the function's resolved path - is confirmed
// only by a real deploy, not by anything checked here.
// No `: Config` type annotation here on purpose: the RateLimitConfig type
// shipped by the installed @netlify/functions version (2.8.1) is missing
// `windowLimit` entirely, even though it's a real, required field in
// Netlify's own build-time schema (confirmed directly against the zod
// schema its bundler actually validates against, in
// node_modules/netlify-cli's vendored zip-it-and-ship-it package) - a
// stale type export, not a real constraint. TypeScript types are erased
// at build time (esbuild, per netlify.toml) and have no effect on what
// the platform reads from this export, so annotating against the stale
// type would only fight the type-checker over something already correct.
export const config = {
  path: '/.netlify/functions/representative/*',
  rateLimit: {
    windowLimit: 30,
    windowSize: 300,
    aggregateBy: ['ip'],
  },
};
