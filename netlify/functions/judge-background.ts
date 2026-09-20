import type { Handler } from '@netlify/functions';
import { safeHandler } from './lib/safeHandler';
import { json } from './lib/response';
import { extractParams } from './lib/extractParams';
import { getChargeSheet } from './lib/chargeSheet';
import { JUDGES } from './lib/judges';
import { buildJudgeMessages, parseJudgeOutput } from './lib/prompts';
import { callOpenRouter } from './lib/openrouter';
import { getModelForRole, AGENT_MAX_TOKENS } from './lib/models';
import {
  getFullTrial,
  upsertJudgeRuling,
  logApiCall,
  upsertAgentProgress,
  markTrialCompletedIfJudgingDone,
  isGlobalCallCapExceeded,
  isTrialAborted,
  GLOBAL_CALL_CAP,
} from './lib/db';
import { isSiteGateOk } from './lib/siteGate';
import type { JudgeRole, RepresentativeRole } from './lib/types';

// Judges are asked for the longest output in this system - a fuller opinion
// plus the leading VERDICT line, against a ~450-600 word target where a
// representative gets 300-500 (roughly 600-800 tokens either way). Sized
// with headroom above that target rather than a tight fit against it,
// since a cap hit exactly mid-sentence reads far worse than a shorter
// completion under it.
//
// Asked for, not observed: in practice representatives are the ones that
// overrun. Counted across every row in api_call_logs, judges have hit the
// cap 2 times in 363 calls (0.6%), representatives 67 times in 897 (7.5%)
// - representatives run out of room about thirteen times as often as the
// role with the longer word target. Whatever drives that, it is not the
// stated targets, so do not reason about the cap from the targets alone.
//
// Shares AGENT_MAX_TOKENS with representative-background.ts - see the
// comment on that constant in models.ts for why one shared value across
// both role types.
const MAX_TOKENS = AGENT_MAX_TOKENS;

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

  // See the matching comment in representative-background.ts - both checks
  // run before
  // any Supabase trial lookup or OpenRouter call, and (now that this runs
  // as a Background Function - see config.background below) neither
  // rejection reaches the polling frontend directly, only Netlify's
  // function logs, for the same disclosed reasons as
  // representative-background.ts.
  if (!isSiteGateOk(event.headers)) {
    console.warn(`judge:${judgeRole}: rejected - missing or invalid site gate header.`);
    return json(401, { role: judgeRole, status: 'failed', error: 'Missing or invalid site gate header.' });
  }

  const cap = await isGlobalCallCapExceeded();
  if (cap.exceeded) {
    console.warn(`judge:${judgeRole}: rejected - global call cap reached (${cap.count}/${GLOBAL_CALL_CAP}).`);
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

  // Every discarded attempt gets its own real call-log row too - whatever
  // discarded it (truncation/degeneration, a plain HTTP failure at that
  // tier, a transient failure, or an abort caught between attempts) -
  // written the
  // moment callOpenRouter() decides to discard it (not batched after the
  // whole chain finishes) - this is what lets a client polling GET
  // /api/trials/:id see the escalation happening live, mid-call, instead
  // of only learning about it once this role's result is already final.
  const result = await callOpenRouter(
    getModelForRole(judgeRole),
    messages,
    MAX_TOKENS,
    `judge:${judgeRole}`,
    (discarded) =>
      logApiCall({
        trialId: id,
        agentRole: judgeRole,
        callType: 'judge',
        modelUsed: discarded.model,
        promptTokens: discarded.promptTokens,
        completionTokens: discarded.completionTokens,
        totalTokens: discarded.totalTokens,
        cost: discarded.cost,
        status: 'failed',
        errorMessage: discarded.errorMessage,
        durationMs: discarded.durationMs,
      }),
    // See the matching comment in representative-background.ts.
    (info) =>
      upsertAgentProgress({
        trialId: id,
        role: judgeRole,
        model: info.model,
        tierIndex: info.tierIndex,
        attemptInTier: info.attemptInTier,
        tierMaxAttempts: info.tierMaxAttempts,
      }),
    // See the matching comment in representative-background.ts - this is
    // what stops an abandoned trial from continuing to spend real money
    // through the escalation chain after the user has hit Abort.
    () => isTrialAborted(id)
  );

  // Same reasoning as representative-background.ts: never write a ruling
  // for a trial the user already aborted. This was a real, observed
  // problem (2026-09-20) - two judge calls finished 30s and 1m32s after
  // the abort and wrote real rulings into an aborted trial.
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
    durationMs: result.durationMs,
  });

  // Checked after logApiCall, before anything is persisted or the trial is
  // marked completed - see the matching comment in
  // representative-background.ts. An aborted trial must not be quietly
  // completed out from under the user, and must never gain a ruling it was
  // stopped before finishing: this was a real, observed problem
  // (2026-09-20), where two judge calls finished 30s and 1m32s after the
  // abort and wrote real rulings into a trial the user had left.
  if (await isTrialAborted(id)) {
    console.warn(`judge:${judgeRole}: trial was aborted by the user - discarding this result instead of saving it.`);
    return json(200, { role: judgeRole, status: 'aborted' });
  }

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

// See the matching config on representative-background.ts for the
// reasoning behind every choice here (the numbers, background:true and
// why it's now required rather than optional, the -background filename
// suffix and why local dev specifically needs it, the path glob, the
// missing `: Config` annotation, and what is and is not confirmed in
// production) - the only difference is the function name in the path,
// matching how netlify.toml routes here.
export const config = {
  path: '/.netlify/functions/judge-background/*',
  background: true,
  rateLimit: {
    windowLimit: 45,
    windowSize: 300,
    aggregateBy: ['ip'],
  },
};
