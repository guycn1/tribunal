import type { Handler } from '@netlify/functions';
import { safeHandler } from './lib/safeHandler';
import { json } from './lib/response';
import { extractParams } from './lib/extractParams';
import { getChargeSheet } from './lib/chargeSheet';
import { JUDGES } from './lib/judges';
import { buildJudgeMessages, parseJudgeOutput } from './lib/prompts';
import { callOpenRouter, callOpenRouterOnce } from './lib/openrouter';
import { getLastDitchModelForRole } from './lib/models';
import { getFullTrial, upsertJudgeRuling, logApiCall, markTrialCompletedIfJudgingDone } from './lib/db';
import type { JudgeRole, RepresentativeRole } from './lib/types';

// Judges write the longest output of any agent in this system — a fuller
// opinion plus the leading VERDICT line — so they get the largest cap.
//
// Sized against the ~450-600 word target their prompt now sets (roughly
// 600-800 tokens), leaving real headroom above it so a ruling is never
// clipped mid-sentence. The previous 1600 predated that target: with no
// length guidance at all, rulings ran to 1184-1317 tokens, and generating
// that much text took 16-21s, which is what kept pushing judge calls past
// the per-call time budget on a congested free tier.
const MAX_TOKENS = 1100;

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
