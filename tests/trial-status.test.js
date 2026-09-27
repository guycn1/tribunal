/**
 * @file Regression tests for when a trial is marked completed -
 * markTrialCompletedIfJudgingDone() in netlify/functions/lib/db.ts, and the
 * judge endpoint that calls it.
 *
 * Run with `npm test`. No network: the backend is compiled from the real
 * source with the project's own tsc, the Supabase client it imports is
 * swapped for a small in-memory database, and OpenRouter is a mocked fetch.
 * So these exercise the shipped queries and the shipped logic together, not
 * a copy of either.
 *
 * What this exists to protect:
 *   1. A trial is marked completed once every judge has a final outcome, and
 *      not before. It used to flip once the trial had 3 judge rows in
 *      api_call_logs, which was right while each judge logged exactly one;
 *      once every discarded attempt got a row of its own, a single judge
 *      that needed two retries reached 3 on its own and marked the trial
 *      completed while the other two were still running.
 *   2. The judge endpoint checks for completion only after it has saved its
 *      own ruling, so a trial never reads as completed with a ruling still
 *      unwritten.
 *   3. Every model reply is kept in the call log's response_text, discarded
 *      ones included, so they can be audited in full - and the trial
 *      endpoint never sends that text to the page. A database the column
 *      has not reached yet still gets every row, without the text.
 */

const { compileBackend } = require('./support/compile-backend');
const { fakeSupabase, useFakeSupabase } = require('./support/fake-supabase');

let failures = 0;
/**
 * Records and prints one assertion. A failure is counted rather than thrown,
 * so every check in the file runs and reports.
 *
 * @param {string} name
 * @param {unknown} condition Truthy to pass.
 * @param {unknown} [detail] Printed after a failure, to show what was
 *   actually found.
 */
function check(name, condition, detail) {
  if (condition) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}${detail !== undefined ? ` :: ${detail}` : ''}`);
  }
}

const backend = compileBackend(['lib/db.ts', 'lib/openrouter.ts', 'judge-background.ts', 'representative-background.ts', 'trial.ts']);
useFakeSupabase(backend.outDir);
const { markTrialCompletedIfJudgingDone, ABORTED_BY_USER_MESSAGE, isGlobalCallCapExceeded, GLOBAL_CALL_CAP, NO_MODEL_USED } = backend.load('lib/db.js');
const markers = backend.load('lib/openrouter.js');

/**
 * One judge row in api_call_logs.
 * @param {string} role
 * @param {string | null} errorMessage Null for a success.
 * @param {string} [trialId='t1']
 * @param {string} [callType='judge']
 * @returns {object}
 */
function judgeRow(role, errorMessage, trialId = 't1', callType = 'judge') {
  return { trial_id: trialId, call_type: callType, agent_role: role, status: errorMessage ? 'failed' : 'success', error_message: errorMessage };
}

/**
 * Runs markTrialCompletedIfJudgingDone('t1') against the given log rows.
 * @param {object[]} logRows
 * @param {{failReads?: boolean}} [options]
 * @returns {Promise<{completed: boolean, updates: object[], threw: unknown}>}
 */
async function runCompletion(logRows, options) {
  const fake = fakeSupabase({ api_call_logs: logRows, trials: [{ id: 't1', status: 'created' }, { id: 't2', status: 'created' }] }, options);
  global.fakeSupabase = fake.client;
  let threw = null;
  try {
    await markTrialCompletedIfJudgingDone('t1');
  } catch (error) {
    threw = error;
  }
  const updates = fake.writes.filter((w) => w.op === 'update');
  return { completed: fake.tables.trials[0].status === 'completed', otherTouched: fake.tables.trials[1].status !== 'created', updates, threw };
}

const { TRANSIENT_RETRIED_MARKER, DEGENERATE_RETRIED_SAME_MODEL_MARKER, DEGENERATE_RETRIED_DIFF_MODEL_MARKER, HTTP_ERROR_ESCALATED_MARKER, DEGENERATE_FINAL_MARKER, ABORTED_MID_CALL_MARKER } = markers;
const retried = (marker) => `${marker} This attempt was discarded - re-tried.`;

// Quieted during the checks: the code under test logs to the console by
// design (a failed read, every OpenRouter attempt), and none of it is output
// these checks read.
const realConsole = { log: console.log, warn: console.warn, error: console.error };
const say = (...args) => realConsole.log(...args);
/**
 * Runs `fn` with the backend's own console output suppressed.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function quietly(fn) {
  console.log = console.warn = console.error = () => {};
  try {
    return await fn();
  } finally {
    Object.assign(console, realConsole);
  }
}

// ---------------------------------------------------------------- the judge endpoint
const TRIAL_ID = '0d6f6a8e-4a3c-4d7e-9b52-1f0a2b3c4d5e';
const CASE_ROW = {
  case_code: 'T-001', title: 'The Realm v. Jon Snow', accused: 'Jon Snow', deceased: 'Daenerys Targaryen',
  act_alleged: 'An act.', background: 'Some background.', agreed_facts: ['A fact.'], question: 'A question?', scope_note: 'A scope note.',
};
const GOOD_RULING = 'VERDICT: justified\n\nThe record shows a surrendered city burned after the bells rang. The question is whether a private killing can answer that, and on these facts it can.';

/**
 * Invokes the real judge handler for barak against an in-memory trial in
 * which elon and shamgar have already finished.
 *
 * @param {object} scenario
 * @param {string | string[]} scenario.reply The model's reply text, or one
 *   per attempt in order (the last one repeats).
 * @param {boolean} [scenario.aborted] Whether the trial was aborted first.
 * @param {boolean} [scenario.abortDuringCall] Whether the abort lands while
 *   the model is generating its reply, as in trial a02b8215.
 * @param {Record<string, string[]>} [scenario.missingColumns] Columns the
 *   database does not have yet - see fakeSupabase.
 * @returns {Promise<{status: number, tables: object, writes: object[]}>}
 */
async function runJudge({ reply, aborted = false, abortDuringCall = false, missingColumns }) {
  const replies = Array.isArray(reply) ? [...reply] : [reply];
  const logs = [judgeRow('elon', null, TRIAL_ID), judgeRow('shamgar', null, TRIAL_ID)];
  if (aborted) logs.push({ ...judgeRow('barak', ABORTED_BY_USER_MESSAGE, TRIAL_ID) });
  const fake = fakeSupabase({
    case_definitions: [CASE_ROW],
    trials: [{ id: TRIAL_ID, case_code: 'T-001', status: 'created' }],
    representative_arguments: [],
    judge_rulings: [],
    api_call_logs: logs,
    agent_progress: [],
  }, { missingColumns });
  global.fakeSupabase = fake.client;
  global.fetch = async (_url, request) => {
    if (abortDuringCall) fake.tables.api_call_logs.push({ ...judgeRow('barak', ABORTED_BY_USER_MESSAGE, TRIAL_ID) });
    return {
      ok: true, status: 200, headers: new Map(),
      json: async () => ({
        model: JSON.parse(request.body).model,
        choices: [{ message: { content: replies.length > 1 ? replies.shift() : replies[0] }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3000, completion_tokens: 200, total_tokens: 3200 },
      }),
    };
  };
  const response = await quietly(() => judgeHandler({
    httpMethod: 'POST', path: `/.netlify/functions/judge-background/${TRIAL_ID}/barak`, headers: {}, queryStringParameters: {},
  }, {}));
  return { status: response.statusCode, tables: fake.tables, writes: fake.writes };
}

process.env.OPENROUTER_API_KEY = 'test-key';
// Skips the site-wide call cap, which is not what these checks are about -
// the same exemption local `netlify dev` gets (see isGlobalCallCapExceeded).
process.env.NETLIFY_DEV = 'true';
const { handler: judgeHandler } = backend.load('judge-background.js');
const { handler: trialHandler } = backend.load('trial.js');
const { handler: representativeHandler } = backend.load('representative-background.js');
// A judge reply the repetition check discards: one sentence twice in a row.
const LOOPED_RULING = 'VERDICT: justified\n\nThe bells had rung before the fire. He had no lawful authority to strike her down. He had no lawful authority to strike her down.';

async function main() {
  say('\n=== One judge with retries does not complete the trial on its own ===');
  // The exact shape of the bug: three judge rows, all belonging to barak.
  let r = await quietly(() => runCompletion([
    judgeRow('barak', retried(TRANSIENT_RETRIED_MARKER)),
    judgeRow('barak', retried(DEGENERATE_RETRIED_SAME_MODEL_MARKER)),
    judgeRow('barak', null),
  ]));
  check('three rows from one judge leave the trial open', !r.completed, JSON.stringify(r.updates));

  r = await quietly(() => runCompletion([
    judgeRow('barak', null),
    judgeRow('elon', null),
    judgeRow('shamgar', retried(TRANSIENT_RETRIED_MARKER)),
    judgeRow('shamgar', retried(HTTP_ERROR_ESCALATED_MARKER)),
  ]));
  check('a judge still retrying keeps the trial open', !r.completed, JSON.stringify(r.updates));

  say('\n=== Every judge with a final outcome completes it ===');
  r = await quietly(() => runCompletion([
    judgeRow('barak', retried(DEGENERATE_RETRIED_SAME_MODEL_MARKER)),
    judgeRow('barak', null),
    judgeRow('elon', null),
    judgeRow('shamgar', retried(TRANSIENT_RETRIED_MARKER)),
    judgeRow('shamgar', null),
  ]));
  check('all three judges finished marks the trial completed', r.completed, JSON.stringify(r.updates));
  check('no other trial is touched', !r.otherTouched);

  say('\n=== A final failure is still a final outcome ===');
  r = await quietly(() => runCompletion([
    judgeRow('barak', null),
    judgeRow('elon', 'OpenRouter returned HTTP 402: insufficient credits.'),
    judgeRow('shamgar', 'Model response did not include a parseable VERDICT line.'),
  ]));
  check('failed judges count as finished', r.completed);
  r = await quietly(() => runCompletion([
    judgeRow('barak', `${DEGENERATE_FINAL_MARKER} Every model tier was tried.`),
    judgeRow('elon', `${ABORTED_MID_CALL_MARKER} Stopped before attempt 2.`),
    judgeRow('shamgar', null),
  ]));
  check('the two final markers count as finished', r.completed);

  say('\n=== Every retried marker is treated as not-yet-finished ===');
  // Each on its own, so dropping any one of them from the list is caught.
  for (const [name, marker] of Object.entries({ TRANSIENT_RETRIED_MARKER, DEGENERATE_RETRIED_SAME_MODEL_MARKER, DEGENERATE_RETRIED_DIFF_MODEL_MARKER, HTTP_ERROR_ESCALATED_MARKER })) {
    r = await quietly(() => runCompletion([judgeRow('barak', null), judgeRow('elon', null), judgeRow('shamgar', retried(marker))]));
    check(`${name} alone does not count as shamgar finishing`, !r.completed);
  }

  say('\n=== Only this trial and only judges count ===');
  r = await quietly(() => runCompletion([judgeRow('barak', null), judgeRow('elon', null), judgeRow('shamgar', null, 't2')]));
  check("another trial's judge row does not count", !r.completed);
  r = await quietly(() => runCompletion([judgeRow('barak', null), judgeRow('elon', null), judgeRow('shamgar', null, 't1', 'representative')]));
  check('a representative row does not count', !r.completed);

  say('\n=== A failed read changes nothing ===');
  r = await quietly(() => runCompletion([judgeRow('barak', null), judgeRow('elon', null), judgeRow('shamgar', null)], { failReads: true }));
  check('does not mark the trial completed', !r.completed, JSON.stringify(r.updates));
  check('does not throw', r.threw === null, String(r.threw));

  say('\n=== The call cap counts model calls, not abort requests ===');
  {
    const now = new Date().toISOString();
    const call = { status: 'success', model_used: 'mistralai/mistral-small-24b-instruct-2501', timestamp: now };
    const abortRequest = { status: 'failed', model_used: NO_MODEL_USED, error_message: ABORTED_BY_USER_MESSAGE, timestamp: now };
    /**
     * Runs the real cap check against the given log rows, with the local-dev
     * exemption this suite otherwise relies on switched off.
     * @param {object[]} rows
     * @returns {Promise<{exceeded: boolean, count: number}>}
     */
    const capWith = async (rows) => {
      global.fakeSupabase = fakeSupabase({ api_call_logs: rows }).client;
      const saved = process.env.NETLIFY_DEV;
      delete process.env.NETLIFY_DEV;
      try {
        return await isGlobalCallCapExceeded();
      } finally {
        process.env.NETLIFY_DEV = saved;
      }
    };
    const below = await capWith([...Array(GLOBAL_CALL_CAP - 1).fill(call), ...Array(8).fill(abortRequest)]);
    check('abort rows do not push the count to the cap', !below.exceeded && below.count === GLOBAL_CALL_CAP - 1, JSON.stringify(below));
    const at = await capWith(Array(GLOBAL_CALL_CAP).fill(call));
    check('real calls still reach it', at.exceeded && at.count === GLOBAL_CALL_CAP, JSON.stringify(at));
  }

  say('\n=== The judge endpoint: ruling saved first, then the trial completed ===');
  let j = await runJudge({ reply: GOOD_RULING });
  const rulingAt = j.writes.findIndex((w) => w.table === 'judge_rulings');
  const completedAt = j.writes.findIndex((w) => w.table === 'trials' && w.op === 'update');
  check('the last judge to finish saves its ruling', j.tables.judge_rulings.length === 1 && j.tables.judge_rulings[0].verdict === 'justified', JSON.stringify(j.tables.judge_rulings));
  check('and marks the trial completed', j.tables.trials[0].status === 'completed', j.tables.trials[0].status);
  check('the ruling is written before the trial is marked completed', rulingAt >= 0 && completedAt > rulingAt, JSON.stringify(j.writes.map((w) => `${w.table}:${w.op}`)));

  say('\n=== The judge endpoint: an unusable reply still completes the trial ===');
  j = await runJudge({ reply: 'The record is long and the question is hard, and I decline to reduce it to a single word.' });
  check('nothing is saved as a ruling', j.tables.judge_rulings.length === 0, JSON.stringify(j.tables.judge_rulings));
  check('the failure is logged', j.tables.api_call_logs.some((row) => row.agent_role === 'barak' && row.status === 'failed' && /VERDICT/.test(row.error_message)));
  check('the trial is still marked completed', j.tables.trials[0].status === 'completed', j.tables.trials[0].status);

  say('\n=== The judge endpoint: an aborted trial is left alone ===');
  j = await runJudge({ reply: GOOD_RULING, aborted: true });
  check('no ruling is written into it', j.tables.judge_rulings.length === 0, JSON.stringify(j.tables.judge_rulings));
  check('it is not marked completed', j.tables.trials[0].status === 'created', j.tables.trials[0].status);

  say('\n=== The judge endpoint: a ruling that finishes after the abort ===');
  // Trial a02b8215 (2026-09-21): replies that finished after the abort were
  // logged as successes, then quietly thrown away.
  j = await runJudge({ reply: GOOD_RULING, abortDuringCall: true });
  const lateRows = j.tables.api_call_logs.filter((row) => row.agent_role === 'barak' && row.error_message !== ABORTED_BY_USER_MESSAGE);
  check('it is logged once, as aborted rather than success', lateRows.length === 1 && lateRows[0].status === 'failed' && /^\[aborted-mid-call\] Finished after the user aborted this trial/.test(lateRows[0].error_message), JSON.stringify(lateRows.map((r) => [r.status, r.error_message])));
  check('with the reply and its cost kept for audit', lateRows.length === 1 && lateRows[0].response_text === GOOD_RULING && lateRows[0].completion_tokens === 200 && lateRows[0].cost > 0);
  check('and no ruling is saved', j.tables.judge_rulings.length === 0, JSON.stringify(j.tables.judge_rulings));
  check('nor the trial marked completed', j.tables.trials[0].status === 'created', j.tables.trials[0].status);

  say('\n=== The representative endpoint: an argument that finishes after the abort ===');
  {
    const ARGUMENT = 'Honorable Tribunal, the bells had rung before the fire, and he acted to stop the next one.';
    const fake = fakeSupabase({
      case_definitions: [CASE_ROW],
      trials: [{ id: TRIAL_ID, case_code: 'T-001', status: 'created' }],
      representative_arguments: [],
      judge_rulings: [],
      api_call_logs: [],
      agent_progress: [],
    });
    global.fakeSupabase = fake.client;
    global.fetch = async (_url, request) => {
      fake.tables.api_call_logs.push({ ...judgeRow('grey_worm', ABORTED_BY_USER_MESSAGE, TRIAL_ID, 'representative') });
      return {
        ok: true, status: 200, headers: new Map(),
        json: async () => ({
          model: JSON.parse(request.body).model,
          choices: [{ message: { content: ARGUMENT }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1000, completion_tokens: 60, total_tokens: 1060 },
        }),
      };
    };
    await quietly(() => representativeHandler({
      httpMethod: 'POST', path: `/.netlify/functions/representative-background/${TRIAL_ID}/grey_worm`, headers: {}, queryStringParameters: {},
    }, {}));
    const rows = fake.tables.api_call_logs.filter((row) => row.agent_role === 'grey_worm' && row.error_message !== ABORTED_BY_USER_MESSAGE);
    check('it is logged once, as aborted rather than success', rows.length === 1 && rows[0].status === 'failed' && /^\[aborted-mid-call\] Finished after the user aborted this trial/.test(rows[0].error_message), JSON.stringify(rows.map((r) => [r.status, r.error_message])));
    check('and no argument is saved', fake.tables.representative_arguments.length === 0, JSON.stringify(fake.tables.representative_arguments));
  }

  say('\n=== The judge endpoint: a call aborted before it starts ===');
  j = await runJudge({ reply: GOOD_RULING, aborted: true });
  const stopRows = j.tables.api_call_logs.filter((row) => row.agent_role === 'barak' && row.error_message !== ABORTED_BY_USER_MESSAGE);
  check('its row says it stopped before attempt 1', stopRows.length === 1 && /Stopped before attempt 1/.test(stopRows[0].error_message), JSON.stringify(stopRows.map((r) => r.error_message)));
  check('and carries no duration, since no attempt ran', stopRows.length === 1 && stopRows[0].duration_ms === null, stopRows.length ? String(stopRows[0].duration_ms) : 'no row');

  say('\n=== Every reply is kept for audit, and the page never sees it ===');
  j = await runJudge({ reply: [LOOPED_RULING, GOOD_RULING] });
  const barakRows = j.tables.api_call_logs.filter((row) => row.agent_role === 'barak');
  const discardedRow = barakRows.find((row) => row.status === 'failed');
  const keptRow = barakRows.find((row) => row.status === 'success');
  check('the discarded reply is stored word for word', discardedRow && discardedRow.response_text === LOOPED_RULING, discardedRow && discardedRow.response_text);
  check('its reason says where the copies sit', discardedRow && /2 times in a row \(sentences 2-3 of 3\)/.test(discardedRow.error_message), discardedRow && discardedRow.error_message);
  check('the kept reply is stored raw, VERDICT line included', keptRow && keptRow.response_text === GOOD_RULING, keptRow && keptRow.response_text);

  const page = await quietly(() => trialHandler({ httpMethod: 'GET', path: `/.netlify/functions/trial/${TRIAL_ID}`, headers: {}, queryStringParameters: {} }, {}));
  const pageLogs = page.statusCode === 200 ? JSON.parse(page.body).apiCallLogs : [];
  check('the trial endpoint still returns the discarded row', pageLogs.some((row) => row.agentRole === 'barak' && row.status === 'failed'), page.statusCode);
  // The row's reason quotes the start of the repeated sentence, by design;
  // the rest of the reply, like its opening, must stay out.
  check('but none of the stored reply text', page.statusCode === 200 && !page.body.includes('bells had rung before the fire') && !/response_?text/i.test(page.body), page.body.slice(0, 200));

  j = await runJudge({ reply: 'The record is long and the question is hard, and I decline to reduce it to a single word.' });
  const unparseable = j.tables.api_call_logs.find((row) => row.agent_role === 'barak');
  check('a reply with no VERDICT line is kept too', unparseable && /decline to reduce it/.test(unparseable.response_text || ''), unparseable && unparseable.response_text);

  say('\n=== A database without the column still gets every row ===');
  j = await runJudge({ reply: [LOOPED_RULING, GOOD_RULING], missingColumns: { api_call_logs: ['response_text'] } });
  const unmigrated = j.tables.api_call_logs.filter((row) => row.agent_role === 'barak');
  check("both of barak's rows are still written", unmigrated.length === 2 && unmigrated.some((row) => row.status === 'failed') && unmigrated.some((row) => row.status === 'success'), JSON.stringify(unmigrated.map((row) => row.status)));
  check('without the text', unmigrated.every((row) => !('response_text' in row)));
  check('and the ruling is still saved', j.tables.judge_rulings.length === 1);
}

main().then(
  () => {
    backend.cleanup();
    say(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
    process.exit(failures === 0 ? 0 : 1);
  },
  (error) => {
    Object.assign(console, realConsole);
    backend.cleanup();
    say('SUITE ERROR:', error);
    process.exit(1);
  }
);
