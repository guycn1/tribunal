import { getSupabaseClient } from './supabase';
import type {
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

  const [trialRes, argsRes, rulingsRes, logsRes] = await Promise.all([
    supabase.from('trials').select('*').eq('id', trialId).maybeSingle(),
    supabase.from('representative_arguments').select('*').eq('trial_id', trialId),
    supabase.from('judge_rulings').select('*').eq('trial_id', trialId),
    supabase.from('api_call_logs').select('*').eq('trial_id', trialId).order('timestamp', { ascending: true }),
  ]);

  for (const res of [trialRes, argsRes, rulingsRes, logsRes]) {
    if (res.error) {
      throw new Error(`Failed to load trial data: ${res.error.message}`);
    }
  }

  if (!trialRes.data) {
    return null;
  }

  return {
    trial: mapTrial(trialRes.data),
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
