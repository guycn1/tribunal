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

const backend = compileBackend(['lib/db.ts', 'lib/openrouter.ts', 'judge-background.ts']);
useFakeSupabase(backend.outDir);
const { markTrialCompletedIfJudgingDone, ABORTED_BY_USER_MESSAGE } = backend.load('lib/db.js');
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
 * @param {string} scenario.reply The model's reply text.
 * @param {boolean} [scenario.aborted] Whether the trial was aborted first.
 * @returns {Promise<{status: number, tables: object, writes: object[]}>}
 */
async function runJudge({ reply, aborted = false }) {
  const logs = [judgeRow('elon', null, TRIAL_ID), judgeRow('shamgar', null, TRIAL_ID)];
  if (aborted) logs.push({ ...judgeRow('barak', ABORTED_BY_USER_MESSAGE, TRIAL_ID) });
  const fake = fakeSupabase({
    case_definitions: [CASE_ROW],
    trials: [{ id: TRIAL_ID, case_code: 'T-001', status: 'created' }],
    representative_arguments: [],
    judge_rulings: [],
    api_call_logs: logs,
    agent_progress: [],
  });
  global.fakeSupabase = fake.client;
  global.fetch = async (_url, request) => ({
    ok: true, status: 200, headers: new Map(),
    json: async () => ({
      model: JSON.parse(request.body).model,
      choices: [{ message: { content: reply }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3000, completion_tokens: 200, total_tokens: 3200 },
    }),
  });
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
