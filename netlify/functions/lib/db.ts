import { getSupabaseClient } from './supabase';
import type {
  AgentProgressRecord,
  ApiCallLogRecord,
  CallStatus,
  CallType,
  JudgeRole,
  RepresentativeRole,
  Seat,
  TrialRecord,
  Verdict,
} from './types';

// Written by abort.ts, one row per role still pending when the user clicked
// Abort. This is a factual record of a client-side decision ("the browser
// stopped waiting on this call, at the user's request") rather than a claim
// about what happened server-side - the Netlify invocation for that role
// may separately still complete on its own and log its own real outcome,
// since aborting a fetch() client-side does not reliably stop the function
// invocation it was talking to. Both rows are legitimate; this schema
// already allows multiple api_call_logs rows per role per trial (each
// retry attempt already produces its own row).
//
// No trials.status enum change needed for this - "aborted" is derived here
// the same way hadFailures already is, by checking api_call_logs for this
// exact marker, rather than adding a new stored status value.
export const ABORTED_BY_USER_MESSAGE = 'Aborted by user before this call could complete.';

export async function createTrial(caseCode: string): Promise<TrialRecord> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('trials')
    .insert({ case_code: caseCode })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Failed to create trial: ${error?.message ?? 'unknown error'}`);
  }

  return mapTrial(data);
}

export interface TrialSummary extends TrialRecord {
  // Whether any individual call for this trial ever logged status='failed'
  // - including one that was immediately retried and fully recovered. Kept
  // as a real, honest low-level fact, but deliberately NOT what the
  // frontend's "Completed" vs "Completed - with failures" label is based
  // on: on a free tier, a transient failure that self-heals within the
  // retry ceiling is the expected case, not the exception, so a label
  // driven by this would fire on most runs and stop meaning anything. See
  // resultCount below for what the sidebar actually uses.
  hadFailures: boolean;
  wasAborted: boolean;
  // How many of the 7 expected results (4 representative_arguments + 3
  // judge_rulings) this trial actually has, counted directly from those
  // tables rather than from api_call_logs. Retries collapse to one row per
  // role there (unique(trial_id, role)), so this reflects the real, final
  // output regardless of how many attempts it took to get there - which is
  // what "is this trial actually complete" should mean.
  resultCount: number;
}

export async function listTrials(limit = 50): Promise<TrialSummary[]> {
  const supabase = getSupabaseClient();
  const { data: trials, error } = await supabase
    .from('trials')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to list trials: ${error.message}`);
  }

  const ids = (trials ?? []).map((t) => t.id);
  let failedTrialIds = new Set<string>();
  let abortedTrialIds = new Set<string>();
  const resultCounts = new Map<string, number>();

  // Four follow-up queries, none of which depend on each other's results -
  // only on `ids` from the trials query above - so there is no reason for
  // them to run one after another. They previously did (three sequential
  // round trips, one of them two separate queries against the same table),
  // which was a real, measured contributor to the run-history sidebar
  // occasionally taking several seconds to populate. Now: one combined
  // query against api_call_logs (status and error_message both pulled in
  // one pass, since failedTrialIds and abortedTrialIds are both derived
  // from it) plus the two result-count queries, all fired together.
  if (ids.length > 0) {
    const [
      { data: logs, error: logsError },
      { data: repRows, error: repError },
      { data: judgeRows, error: judgeError },
    ] = await Promise.all([
      supabase.from('api_call_logs').select('trial_id, status, error_message').in('trial_id', ids),
      supabase.from('representative_arguments').select('trial_id').in('trial_id', ids),
      supabase.from('judge_rulings').select('trial_id').in('trial_id', ids),
    ]);

    if (logsError) {
      throw new Error(`Failed to list trial call logs: ${logsError.message}`);
    }
    if (repError) {
      throw new Error(`Failed to count representative results: ${repError.message}`);
    }
    if (judgeError) {
      throw new Error(`Failed to count judge results: ${judgeError.message}`);
    }

    for (const row of logs ?? []) {
      const trialId = row.trial_id as string;
      if (row.status === 'failed') failedTrialIds.add(trialId);
      if (row.error_message === ABORTED_BY_USER_MESSAGE) abortedTrialIds.add(trialId);
    }

    for (const row of [...(repRows ?? []), ...(judgeRows ?? [])]) {
      const trialId = row.trial_id as string;
      resultCounts.set(trialId, (resultCounts.get(trialId) ?? 0) + 1);
    }
  }

  return (trials ?? []).map((row) => ({
    ...mapTrial(row),
    hadFailures: failedTrialIds.has(row.id),
    wasAborted: abortedTrialIds.has(row.id),
    resultCount: resultCounts.get(row.id) ?? 0,
  }));
}

export async function getTrial(trialId: string): Promise<TrialRecord | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('trials').select('*').eq('id', trialId).maybeSingle();

  if (error) {
    throw new Error(`Failed to load trial: ${error.message}`);
  }

  return data ? mapTrial(data) : null;
}

export async function getFullTrial(trialId: string) {
  const supabase = getSupabaseClient();

  const [trialRes, argsRes, rulingsRes, logsRes, progressRes] = await Promise.all([
    supabase.from('trials').select('*').eq('id', trialId).maybeSingle(),
    supabase.from('representative_arguments').select('*').eq('trial_id', trialId),
    supabase.from('judge_rulings').select('*').eq('trial_id', trialId),
    supabase.from('api_call_logs').select('*').eq('trial_id', trialId).order('timestamp', { ascending: true }),
    supabase.from('agent_progress').select('*').eq('trial_id', trialId),
  ]);

  for (const res of [trialRes, argsRes, rulingsRes, logsRes, progressRes]) {
    if (res.error) {
      throw new Error(`Failed to load trial data: ${res.error.message}`);
    }
  }

  if (!trialRes.data) {
    return null;
  }

  // Keyed by role, not an array - deriveRoleStates() in app.js only ever
  // wants "what's currently happening for role X," a direct lookup, not a
  // list to search. One row per role at most (primary key (trial_id, role)
  // in schema.sql), so no data is lost collapsing this into a map.
  const agentProgress: Record<string, AgentProgressRecord> = {};
  for (const row of progressRes.data ?? []) {
    agentProgress[row.role as string] = {
      model: row.model as string,
      tierIndex: row.tier_index as number,
      attemptInTier: row.attempt_in_tier as number,
      tierMaxAttempts: row.tier_max_attempts as number,
    };
  }

  return {
    trial: mapTrial(trialRes.data),
    agentProgress,
    representativeArguments: (argsRes.data ?? []).map((row) => ({
      role: row.role as RepresentativeRole,
      seat: row.seat as Seat,
      argumentText: row.argument_text as string,
      modelUsed: row.model_used as string,
      createdAt: row.created_at as string,
    })),
    judgeRulings: (rulingsRes.data ?? []).map((row) => ({
      role: row.role as JudgeRole,
      verdict: row.verdict as Verdict,
      reasoningText: row.reasoning_text as string,
      modelUsed: row.model_used as string,
      createdAt: row.created_at as string,
    })),
    apiCallLogs: (logsRes.data ?? []).map((row): ApiCallLogRecord => ({
      agentRole: row.agent_role,
      callType: row.call_type as CallType,
      modelUsed: row.model_used,
      promptTokens: row.prompt_tokens,
      completionTokens: row.completion_tokens,
      totalTokens: row.total_tokens,
      cost: Number(row.cost),
      status: row.status as CallStatus,
      errorMessage: row.error_message,
      timestamp: row.timestamp,
      // Nullable for rows logged before this column existed - the
      // frontend shows a plain "—" for those rather than a fabricated 0,
      // which would misleadingly read as an instant response.
      durationMs: row.duration_ms ?? null,
    })),
  };
}

export async function upsertRepresentativeArgument(params: {
  trialId: string;
  role: RepresentativeRole;
  seat: Seat;
  argumentText: string;
  modelUsed: string;
}): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('representative_arguments').upsert(
    {
      trial_id: params.trialId,
      role: params.role,
      seat: params.seat,
      argument_text: params.argumentText,
      model_used: params.modelUsed,
    },
    { onConflict: 'trial_id,role' }
  );

  if (error) {
    throw new Error(`Failed to save representative argument: ${error.message}`);
  }
}

export async function upsertJudgeRuling(params: {
  trialId: string;
  role: JudgeRole;
  verdict: Verdict;
  reasoningText: string;
  modelUsed: string;
}): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('judge_rulings').upsert(
    {
      trial_id: params.trialId,
      role: params.role,
      verdict: params.verdict,
      reasoning_text: params.reasoningText,
      model_used: params.modelUsed,
    },
    { onConflict: 'trial_id,role' }
  );

  if (error) {
    throw new Error(`Failed to save judge ruling: ${error.message}`);
  }
}

// Overwrites (not appends - see agent_progress in schema.sql) the one row
// for this trial/role with whichever attempt is now actually in flight.
// Called from openrouter.ts's onAttemptStart callback the moment each
// attempt begins, so a client polling mid-call sees the real current
// model/attempt rather than only learning about it once that attempt is
// later discarded or kept. Errors are swallowed by the caller (see the
// onAttemptStart wiring in representative-background.ts/judge-
// background.ts), not here - this is a best-effort live-progress signal,
// never allowed to interrupt the actual retry logic.
export async function upsertAgentProgress(params: {
  trialId: string;
  role: string;
  model: string;
  tierIndex: number;
  attemptInTier: number;
  tierMaxAttempts: number;
}): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('agent_progress').upsert(
    {
      trial_id: params.trialId,
      role: params.role,
      model: params.model,
      tier_index: params.tierIndex,
      attempt_in_tier: params.attemptInTier,
      tier_max_attempts: params.tierMaxAttempts,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'trial_id,role' }
  );

  if (error) {
    throw new Error(`Failed to save agent progress: ${error.message}`);
  }
}

// A hard, site-wide ceiling on how many agent calls (representative or
// judge, successful or failed) are allowed to reach OpenRouter in any
// rolling window - independent of which trial, which role, or which IP
// they come from. This is what actually bounds worst-case spend on a
// public URL with no login: per-IP measures (see the rateLimit config on
// representative.ts/judge.ts) slow down a single source, but only this
// count-against-real-persisted-state check can't be defeated by spreading
// requests across many IPs or by reading/replaying the site-gate header
// (see siteGate.ts) - it's checked against what actually happened, not
// against anything the caller can present.
//
// Sized generously above any realistic legitimate day (manual testing plus
// repeated real usage from other visitors) while staying well short of
// meaningfully denting a small prepaid balance - tune GLOBAL_CALL_CAP down
// once the real per-call cost of whichever paid model is in use is known.
export const GLOBAL_CALL_CAP = 350;
const GLOBAL_CALL_WINDOW_MS = 24 * 60 * 60 * 1000;

// Deliberately does NOT log anything when the cap is hit (unlike every
// other outcome in this file) - a logged row here would itself count
// toward the very total this function checks, which would make a trip of
// the cap self-perpetuating: once tripped, every subsequent check would
// see its own past rejections and stay tripped for the rest of the
// window even if real traffic had stopped. The caller still returns a
// clear, real error to the client either way (see representative.ts /
// judge.ts) - it just isn't persisted.
//
// This whole cap exists to bound worst-case spend on the real, public,
// deployed site - not to constrain the developer's own local testing,
// which already needs its own explicit go-ahead before any OpenRouter
// quota is spent (a separate, stricter gate than this one). NETLIFY_DEV
// is injected as 'true' by the Netlify CLI itself for every invocation
// under `netlify dev` (confirmed directly in its own source,
// commands/dev/dev.js) and is not something a real deployed invocation
// - or a client request - could ever set; a genuine hang chasing this
// exact cap during local testing is what prompted checking for a way to
// exempt local calls instead of only ever raising the number.
export async function isGlobalCallCapExceeded(): Promise<{ exceeded: boolean; count: number }> {
  if (process.env.NETLIFY_DEV === 'true') {
    return { exceeded: false, count: 0 };
  }

  const supabase = getSupabaseClient();
  const since = new Date(Date.now() - GLOBAL_CALL_WINDOW_MS).toISOString();
  const { count, error } = await supabase
    .from('api_call_logs')
    .select('*', { count: 'exact', head: true })
    .gte('timestamp', since);

  if (error) {
    // Fail open: a Supabase hiccup here must not take the whole app down.
    // The other two layers (per-IP rate limiting, the site-gate header)
    // still stand even if this particular check can't run for a moment.
    console.error('isGlobalCallCapExceeded: count query failed, failing open:', error.message);
    return { exceeded: false, count: 0 };
  }

  return { exceeded: (count ?? 0) >= GLOBAL_CALL_CAP, count: count ?? 0 };
}

export async function logApiCall(params: {
  trialId: string;
  agentRole: string;
  callType: CallType;
  modelUsed: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  status: CallStatus;
  errorMessage?: string | null;
  // Optional: an abort (see abort.ts) has no real generation time to
  // report, since it's logging the fact of a client-side cancellation,
  // not a completed attempt.
  durationMs?: number | null;
}): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('api_call_logs').insert({
    trial_id: params.trialId,
    agent_role: params.agentRole,
    call_type: params.callType,
    model_used: params.modelUsed,
    prompt_tokens: params.promptTokens,
    completion_tokens: params.completionTokens,
    total_tokens: params.totalTokens,
    cost: params.cost,
    status: params.status,
    error_message: params.errorMessage ?? null,
    duration_ms: params.durationMs ?? null,
  });

  if (error) {
    // Logging failure is itself worth surfacing, but it must never mask
    // the outcome of the underlying model call, so this only logs to the
    // function's own console rather than throwing.
    console.error('Failed to write api_call_logs row:', error.message);
  }
}

// A trial is marked completed once all three judges have been attempted
// (successfully or not) — a failed judge call still ends the run for that
// seat rather than leaving the trial stuck "in progress" forever.
export async function markTrialCompletedIfJudgingDone(trialId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { count, error } = await supabase
    .from('api_call_logs')
    .select('id', { count: 'exact', head: true })
    .eq('trial_id', trialId)
    .eq('call_type', 'judge');

  if (error) {
    console.error('Failed to count judge call attempts:', error.message);
    return;
  }

  if ((count ?? 0) >= 3) {
    const { error: updateError } = await supabase
      .from('trials')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', trialId);

    if (updateError) {
      console.error('Failed to mark trial completed:', updateError.message);
    }
  }
}

function mapTrial(row: any): TrialRecord {
  return {
    id: row.id,
    caseCode: row.case_code,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
