import type { Handler } from '@netlify/functions';
import { safeHandler } from './lib/safeHandler';
import { json } from './lib/response';
import { extractParams } from './lib/extractParams';
import { getChargeSheet } from './lib/chargeSheet';
import { JUDGES } from './lib/judges';
import { buildJudgeMessages, parseJudgeOutput } from './lib/prompts';
import { callOpenRouter, callOpenRouterOnce } from './lib/openrouter';
import { getLastDitchModelForRole } from './lib/models';
import {
  getFullTrial,
  upsertJudgeRuling,
  logApiCall,
  markTrialCompletedIfJudgingDone,
  isGlobalCallCapExceeded,
  GLOBAL_CALL_CAP,
} from './lib/db';
import { isSiteGateOk } from './lib/siteGate';
import type { JudgeRole, RepresentativeRole } from './lib/types';

// Judges write the longest output of any agent in this system — a fuller
// opinion plus the leading VERDICT line — so they get the largest cap.
//
// Sized against the ~450-600 word target their prompt sets (roughly
// 600-800 tokens), but with real headroom above the typical case: a real
// run measured shamgar/elon comfortably under (617/882 completion tokens),
// but barak, served by the nemotron-3-super-120b fallback rather than the
// primary model, hit the previous 1100 cap exactly and was cut off
// mid-sentence. Since which model in the chain actually answers isn't
// something this app controls, the cap needs headroom for the most
// verbose model that might serve the request, not just the typical one.
// 1400 still sits below the old un-targeted 1600 (which corresponded to
// 1184-1317 tokens with no length instruction at all), and doesn't cost
// extra attempt-timeout budget beyond ~1357 tokens either way, since
// attemptTimeoutFor() in openrouter.ts is already clamped to its 22s
// ceiling by that point.
const MAX_TOKENS = 1400;

const rawHandler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const { id, role } = extractParams(event, 2);
  if (!id || !role) {
    return json(400, { error: 'Missing trial id or role' });
  }

  if (!(role in JUDGES)) {
    return json(400, { error: `Unknown judge role: ${role}` });
  }
  const judgeRole = role as JudgeRole;

  // See the matching comment in representative.ts - both checks run before
  // any Supabase trial lookup or OpenRouter call.
  if (!isSiteGateOk(event.headers)) {
    return json(401, { role: judgeRole, status: 'failed', error: 'Missing or invalid site gate header.' });
  }

  const cap = await isGlobalCallCapExceeded();
  if (cap.exceeded) {
    return json(429, {
      role: judgeRole,
      status: 'failed',
      error: `Site-wide call cap reached (${cap.count}/${GLOBAL_CALL_CAP} calls in the last 24h). Refusing to spend further API budget - try again later.`,
    });
  }

  const full = await getFullTrial(id);
  if (!full) {
    return json(404, { error: 'Trial not found' });
  }

  const caseDef = await getChargeSheet();

  const availableArguments: Partial<Record<RepresentativeRole, string>> = {};
  for (const arg of full.representativeArguments) {
    availableArguments[arg.role] = arg.argumentText;
  }

  const messages = buildJudgeMessages(judgeRole, caseDef, availableArguments);

  // ?lastDitch=true: see the matching comment in representative.ts.
  const isLastDitch = event.queryStringParameters?.lastDitch === 'true';
  const result = isLastDitch
    ? await callOpenRouterOnce(messages, MAX_TOKENS, getLastDitchModelForRole(judgeRole))
    : await callOpenRouter(judgeRole, messages, MAX_TOKENS);

  const parsed = result.status === 'success' && result.content ? parseJudgeOutput(result.content) : null;
  const callFailed = result.status === 'failed' || !result.content;
  const unparseable = !callFailed && !parsed;

  await logApiCall({
    trialId: id,
    agentRole: judgeRole,
    callType: 'judge',
    modelUsed: result.model,
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
    totalTokens: result.totalTokens,
    cost: result.cost,
    status: parsed ? 'success' : 'failed',
    errorMessage: callFailed
      ? result.errorMessage ?? 'Unknown failure'
      : unparseable
        ? 'Model response did not include a parseable VERDICT line.'
        : null,
  });

  // A judge call that fails outright or comes back unparseable still ends
  // this judge's slot for the run rather than leaving the trial stuck — the
  // trial is marked completed once all three have been attempted, whatever
  // the outcome, and this judge simply has no ruling recorded.
  await markTrialCompletedIfJudgingDone(id);

  if (!parsed) {
    return json(502, {
      role: judgeRole,
      status: 'failed',
      error: callFailed
        ? result.errorMessage ?? 'Unknown failure'
        : 'Model response did not include a parseable VERDICT line.',
    });
  }

  await upsertJudgeRuling({
    trialId: id,
    role: judgeRole,
    verdict: parsed.verdict,
    reasoningText: parsed.reasoningText,
    modelUsed: result.model,
  });

  return json(200, {
    role: judgeRole,
    status: 'success',
    verdict: parsed.verdict,
    reasoningText: parsed.reasoningText,
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

// See the matching config on representative.ts for the reasoning behind
// every choice here (the numbers, the path glob, the missing `: Config`
// annotation, and the "unverified in production" caveat) - the only
// difference is the function name in the path, matching how netlify.toml
// routes here.
export const config = {
  path: '/.netlify/functions/judge/*',
  rateLimit: {
    windowLimit: 30,
    windowSize: 300,
    aggregateBy: ['ip'],
  },
};
