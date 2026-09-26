/**
 * @file Regression tests for public/app.js: its agent-card and call-log
 * render paths, how it shortens model ids, and how it reports a request
 * that fails outright.
 *
 * Run with `npm test`. No framework and no browser: app.js's real source is
 * executed against a minimal DOM stub, and the functions under test are
 * handed back out of that scope, so these assert the actual shipped file
 * rather than a copy of it.
 *
 * What this exists to protect:
 *   1. The page must still execute top-to-bottom without throwing. app.js
 *      has shipped a temporal-dead-zone crash before (a const read before
 *      its declaration line), and a syntax-only check cannot catch that -
 *      only really running the top-level code can.
 *   2. Updating one agent's card must not disturb any other agent's card.
 *      The render functions used to begin with `innerHTML = ''` and rebuild
 *      every card in the phase, so a single agent escalating made all of
 *      its siblings visibly flash - including cards already showing a
 *      finished argument.
 *   3. A request that fails outright must reach the user. Creating a trial,
 *      opening one from history, and the call-log refresh after a run all
 *      used to let a network failure escape as an uncaught rejection, so a
 *      click appeared to do nothing and the error reached only the console.
 *   4. The call log must say what actually happened: a capped response is
 *      "Truncated" and an incoherent one "Degenerated", every cell carries
 *      its column name for the narrow card layout, and a model id is
 *      shortened by rule without losing the date stamp.
 */

const { installDom, loadApp } = require('./support/load-app');

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

installDom();

console.log('\n=== app.js executes cleanly (catches a TDZ-class load crash) ===');
let app;
try {
  // Hand back exactly the pieces under test from app.js's own top-level scope.
  app = loadApp(['state', 'el', 'renderRepresentatives', 'renderJudges', 'renderCallLog', 'agentCardSignature', 'shortModelName', 'REPRESENTATIVE_ROLES', 'JUDGE_ROLES', 'beginTrial', 'loadTrial']);
  check('top-level code ran with no error', true);
} catch (error) {
  check('top-level code ran with no error', false, error.message);
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
}

const { state, el, renderRepresentatives, REPRESENTATIVE_ROLES } = app;

console.log('\n=== One agent updating leaves every other card untouched ===');

state.trialId = 'trial-under-test';
state.modelInfo = Object.fromEntries(REPRESENTATIVE_ROLES.map((r) => [r, 'mistralai/mistral-small-24b-instruct-2501']));
state.maxTokens = 1400;

// Two agents already finished, two still working - the exact mix that made
// the flashing obvious, since finished cards carry real argument text.
state.representatives = {
  jon_snow: { status: 'success', argumentText: 'A finished argument.', modelUsed: 'mistralai/mistral-small-24b-instruct-2501', seat: 'defense' },
  tyrion_lannister: { status: 'success', argumentText: 'Another finished argument.', modelUsed: 'mistralai/mistral-small-24b-instruct-2501', seat: 'defense' },
  daenerys_targaryen: { status: 'loading', currentAttempt: { model: 'mistralai/mistral-small-24b-instruct-2501', tierIndex: 0, attemptInTier: 1, tierMaxAttempts: 2 } },
  grey_worm: { status: 'loading', currentAttempt: { model: 'mistralai/mistral-small-24b-instruct-2501', tierIndex: 0, attemptInTier: 1, tierMaxAttempts: 2 } },
};

renderRepresentatives();
const container = el.representativeCards;
check('rendered one card per representative', container.children.length === REPRESENTATIVE_ROLES.length, String(container.children.length));
const before = REPRESENTATIVE_ROLES.map((_, i) => container.children[i]);

// Daenerys escalates: exactly the event that used to repaint everything.
state.representatives.daenerys_targaryen = {
  status: 'loading',
  currentAttempt: { model: 'anthropic/claude-haiku-4.5', tierIndex: 1, attemptInTier: 1, tierMaxAttempts: 2 },
};
renderRepresentatives();
const after = REPRESENTATIVE_ROLES.map((_, i) => container.children[i]);

REPRESENTATIVE_ROLES.forEach((role, i) => {
  if (role === 'daenerys_targaryen') {
    check(`${role}: card WAS rebuilt (its model line changed)`, before[i] !== after[i]);
  } else {
    check(`${role}: card node reused, no flash`, before[i] === after[i]);
  }
});
check('card order preserved', after.every((c, i) => c.dataset.cardRole === REPRESENTATIVE_ROLES[i]), JSON.stringify(after.map((c) => c.dataset.cardRole)));

console.log('\n=== A finished card is rebuilt when its own result lands ===');
const beforeResult = REPRESENTATIVE_ROLES.map((_, i) => container.children[i]);
state.representatives.grey_worm = { status: 'success', argumentText: 'Grey Worm speaks.', modelUsed: 'mistralai/mistral-small-24b-instruct-2501', seat: 'prosecution' };
renderRepresentatives();
const afterResult = REPRESENTATIVE_ROLES.map((_, i) => container.children[i]);
REPRESENTATIVE_ROLES.forEach((role, i) => {
  if (role === 'grey_worm') check(`${role}: card rebuilt when its result arrived`, beforeResult[i] !== afterResult[i]);
  else check(`${role}: untouched by a sibling's result`, beforeResult[i] === afterResult[i]);
});

console.log('\n=== A re-render with no state change touches nothing at all ===');
const beforeNoop = REPRESENTATIVE_ROLES.map((_, i) => container.children[i]);
renderRepresentatives();
const afterNoop = REPRESENTATIVE_ROLES.map((_, i) => container.children[i]);
check('every card node reused', beforeNoop.every((c, i) => c === afterNoop[i]));

console.log('\n=== Opening a different trial rebuilds every card ===');
const beforeTrial = REPRESENTATIVE_ROLES.map((_, i) => container.children[i]);
state.trialId = 'a-different-trial';
renderRepresentatives();
const afterTrial = REPRESENTATIVE_ROLES.map((_, i) => container.children[i]);
check('no stale card survives a trial change', beforeTrial.every((c, i) => c !== afterTrial[i]));

console.log('\n=== Call log distinguishes a truncation from a degeneration ===');
// Both come through the same content-quality marker, but they are different
// failures: one ran into the token cap, the other produced incoherent text.
// Labelling a capped response "Degenerated" was simply inaccurate.
const { renderCallLog } = app;
/**
 * Renders a one-row call log for a representative whose only logged attempt
 * carries `errorMessage`, and returns that row's markup.
 *
 * @param {string} errorMessage
 * @param {'success' | 'failed'} [status='failed']
 * @returns {string} The row's markup, or '' if no row was rendered.
 */
function statusTextFor(errorMessage, status = 'failed') {
  state.callLog = [{
    agentRole: 'grey_worm', callType: 'representative',
    modelUsed: 'mistralai/mistral-small-24b-instruct-2501',
    promptTokens: 1009, completionTokens: 1400, totalTokens: 2409,
    cost: 0.000162, status, errorMessage, durationMs: 24258, timestamp: new Date().toISOString(),
  }];
  renderCallLog();
  // renderCallLog builds each row by assigning a full markup string to
  // tr.innerHTML; the stub stores that verbatim rather than parsing it, so
  // the row's markup reads straight back off the property.
  const row = el.callLogBody.children[0];
  return row ? row.innerHTML : '';
}

const truncatedHtml = statusTextFor('[degenerate-retried-same-model] This attempt hit the max_tokens limit before finishing naturally - re-tried with the same model.');
check('a capped response is labelled "Truncated"', /Truncated/.test(truncatedHtml) && !/Degenerated/.test(truncatedHtml), truncatedHtml.slice(0, 160));

const degenerateHtml = statusTextFor('[degenerate-retried-same-model] This attempt repeated the same sentence 5 times ("i had no other way...") - re-tried with the same model.');
check('a looping response is still labelled "Degenerated"', /Degenerated/.test(degenerateHtml) && !/Truncated/.test(degenerateHtml), degenerateHtml.slice(0, 160));

const runOnHtml = statusTextFor('[degenerate-final] Every model tier was tried (4 in total, ending with google/gemini-2.5-pro) and none produced a usable response - the final attempt collapsed into a 62-word run with no punctuation ("she chose to burn...").');
check('a final run-on failure is labelled "Degenerated"', /Degenerated/.test(runOnHtml) && !/Truncated/.test(runOnHtml), runOnHtml.slice(0, 160));

const finalCapHtml = statusTextFor('[degenerate-final] Every model tier was tried (4 in total, ending with google/gemini-2.5-pro) and none produced a usable response - the final attempt hit the max_tokens limit before finishing naturally. Nothing was saved.');
check('a final capped failure is labelled "Truncated"', /Truncated/.test(finalCapHtml) && !/Degenerated/.test(finalCapHtml), finalCapHtml.slice(0, 160));

console.log('\n=== Every call-log cell carries the label its card layout needs ===');
// Below 720px the table becomes one card per call, and each cell prints its
// own column name from data-label because the <thead> is hidden. A new
// column added without one would render as a value with no label at all,
// and only on narrow screens - exactly the kind of thing that ships unseen.
state.callLog = [{
  agentRole: 'jon_snow', callType: 'representative',
  modelUsed: 'mistralai/mistral-small-24b-instruct-2501',
  promptTokens: 1027, completionTokens: 606, totalTokens: 1633,
  cost: 0.0000936, status: 'success', errorMessage: null, durationMs: 10000,
  timestamp: new Date().toISOString(),
}];
renderCallLog();
const bodyRow = el.callLogBody.children[0].innerHTML;
const bodyCells = bodyRow.match(/<td[^>]*>/g) || [];
const unlabelled = bodyCells.filter((td) => !td.includes('data-label='));
check('every <td> in a call row has a data-label', unlabelled.length === 0, unlabelled.join(' '));
check('all eight columns are present', bodyCells.length === 8, String(bodyCells.length));

// Type and Model each emit both spellings; the stylesheet shows the short
// one in the table and the full one in the card layout. If either half
// stopped being rendered, one of the two views would silently lose it.
check('Type renders the abbreviated form for the table', bodyRow.includes('<abbr class="col-short" title="Representative">R</abbr>'), bodyRow.slice(0, 200));
check('Type renders the full word for the card view', bodyRow.includes('<span class="col-full">Representative</span>'), bodyRow.slice(0, 200));
check('Model renders the shortened id for the table', bodyRow.includes('>mistral-small-24b-2501</abbr>'), bodyRow.slice(0, 400));
check('Model renders the full id, vendor prefix and all, for the card view', bodyRow.includes('<span class="col-full">mistralai/mistral-small-24b-instruct-2501</span>'), bodyRow.slice(0, 400));

console.log('\n=== The token breakdown can only wrap in one place ===');
// In the Tokens column's fixed width, ordinary spaces let this string wrap
// wherever it runs out of room, stranding a lone "out" on its own line.
// Binding each figure to its unit, and the slash to the first figure,
// leaves exactly one legal break point - after the slash - so it either
// fits on one line or splits evenly. The column widths are untouched.
const tokenCell = (bodyRow.match(/<td data-label="Tokens">[\s\S]*?<\/td>/) || [''])[0];
check('each figure is bound to its unit', /1,027&nbsp;in/.test(tokenCell) && /606&nbsp;out/.test(tokenCell), tokenCell.slice(0, 200));
check('the slash is bound to the first figure', /in&nbsp;\//.test(tokenCell), tokenCell.slice(0, 200));
check('exactly one breakable space remains', (tokenCell.match(/\/ \d/g) || []).length === 1, tokenCell.slice(0, 200));

// The totals row is deliberately different: its first and last cells are a
// heading and a footnote, not labelled fields, and are marked as such so
// the card layout can style them that way.
const footRow = el.callLogFoot.children[0].innerHTML;
check('totals row marks its title cell', footRow.includes('total-row-title'), footRow.slice(0, 120));
check('totals row marks its footnote cell', footRow.includes('total-row-note'), footRow.slice(0, 120));
const footLabelled = (footRow.match(/data-label=/g) || []).length;
check('totals row labels its three real value cells', footLabelled === 3, String(footLabelled));

console.log('\n=== Model ids shorten to something the table column can hold ===');
// The Model column is 131px at the narrowest this table ever renders (655px
// wide, at a 901px viewport - below that the sidebar stacks and the table
// gets more room, not less). Measured there, the full id needed 161px and
// wrapped; every id below now fits on one line. These assert the rules, not
// the pixels: a vendor prefix goes, a ":free" suffix goes, a standalone
// "-instruct" segment goes, and the date stamp stays - it is the only thing
// telling two pinned snapshots of one model apart.
const { shortModelName } = app;
[
  ['mistralai/mistral-small-24b-instruct-2501', 'mistral-small-24b-2501'],
  ['anthropic/claude-haiku-4.5', 'claude-haiku-4.5'],
  ['openai/gpt-5.6-sol', 'gpt-5.6-sol'],
  ['google/gemini-2.5-pro', 'gemini-2.5-pro'],
  // Still in real api_call_logs rows from before this tier was replaced.
  ['mistralai/mistral-large-2512', 'mistral-large-2512'],
  // "-instruct" at the very end, and alongside a ":free" suffix.
  ['meta-llama/llama-3.3-70b-instruct', 'llama-3.3-70b'],
  ['meta-llama/llama-3.3-70b-instruct:free', 'llama-3.3-70b'],
  // No vendor prefix at all, and a missing id, both must survive.
  ['some-model-2501', 'some-model-2501'],
  [undefined, 'unknown model'],
].forEach(([full, expected]) => {
  // Caught, so a shortener that throws fails this one check instead of
  // taking the rest of the suite down with it.
  let got;
  try { got = shortModelName(full); } catch (error) { got = `threw: ${error.message}`; }
  check(`${full} -> ${expected}`, got === expected, got);
});
// A name that merely contains the letters is not a segment and must survive.
check('"instructor" is not stripped', shortModelName('vendor/model-instructor-v2') === 'model-instructor-v2', shortModelName('vendor/model-instructor-v2'));

/**
 * A stub fetch Response carrying a JSON body.
 * @param {number} status
 * @param {unknown} body
 * @returns {{ok: boolean, status: number, json: () => Promise<unknown>}}
 */
function jsonReply(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/**
 * The checks that need to await app.js's own async flows. Kept apart from
 * the synchronous render checks above, which must not wait on anything.
 * @returns {Promise<void>}
 */
async function requestFailureChecks() {
  const { beginTrial, loadTrial, JUDGE_ROLES } = app;
  const alerts = [];
  global.alert = (message) => alerts.push(String(message));
  // fetch() rejects, rather than resolving with an error status, when the
  // server is never reached - offline, DNS, connection refused.
  const unreachable = async () => { throw new TypeError('Failed to fetch'); };

  /** Puts the page back as index.html starts it, with nothing running. */
  function resetToIdle() {
    state.running = false;
    state.loadingTrial = false;
    state.abortController = null;
    el.newTrialBtn.disabled = false;
    el.abortBtn.classList.add('hidden');
    el.mainLoadingOverlay.classList.add('hidden');
    el.sidebar.classList.remove('loading-locked');
  }

  /**
   * Whether the page is idle again: nothing running, both buttons back to
   * normal, and the loading overlay and sidebar lock gone.
   * @returns {boolean}
   */
  function isIdle() {
    return (
      state.running === false &&
      state.loadingTrial === false &&
      state.abortController === null &&
      el.newTrialBtn.disabled === false &&
      el.abortBtn.classList.contains('hidden') &&
      el.mainLoadingOverlay.classList.contains('hidden') &&
      !el.sidebar.classList.contains('loading-locked')
    );
  }

  /**
   * Runs one flow under a given fetch stub, from an idle page, and reports
   * whether it rejected - the failure mode being guarded against. Starting
   * each flow idle keeps one broken flow from cascading into failures in
   * every flow after it, which would hide which one actually broke.
   * @param {() => Promise<void>} flow
   * @param {typeof global.fetch} fetchStub
   * @returns {Promise<unknown>} What it rejected with, or null.
   */
  async function run(flow, fetchStub) {
    resetToIdle();
    alerts.length = 0;
    global.fetch = fetchStub;
    try {
      await flow();
      return null;
    } catch (error) {
      return error;
    }
  }

  console.log('\n=== Creating a trial: a failed request is reported, not swallowed ===');
  let rejection = await run(beginTrial, unreachable);
  check('an unreachable server does not reject', rejection === null, String(rejection));
  check('the user is told the server could not be reached', alerts.length === 1 && /could not be reached/.test(alerts[0]), JSON.stringify(alerts));
  check('the controls, overlay and sidebar are restored', isIdle());

  rejection = await run(beginTrial, async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('Unexpected token <'); } }));
  check('a non-JSON error page does not reject', rejection === null, String(rejection));
  check('the user is told the status', alerts.length === 1 && /HTTP 502/.test(alerts[0]), JSON.stringify(alerts));

  rejection = await run(beginTrial, async () => jsonReply(401, { error: 'Missing or invalid site gate header.' }));
  check("a JSON error still shows the server's own message", alerts.length === 1 && alerts[0].includes('Missing or invalid site gate header.'), JSON.stringify(alerts));

  console.log('\n=== Opening a trial from history: a failed request is reported ===');
  rejection = await run(() => loadTrial('some-trial'), unreachable);
  check('an unreachable server does not reject', rejection === null, String(rejection));
  check('the user is told the server could not be reached', alerts.length === 1 && /could not be reached/.test(alerts[0]), JSON.stringify(alerts));
  check('the loading overlay and sidebar are released', isIdle());

  rejection = await run(() => loadTrial('some-trial'), async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } }));
  check('an unreadable reply does not reject', rejection === null, String(rejection));
  check('it is reported as a trial that could not be loaded', alerts.length === 1 && alerts[0] === 'Could not load that trial.', JSON.stringify(alerts));

  console.log('\n=== A run whose final call-log refresh fails ===');
  // A whole trial, end to end, on a virtual clock. sleep() and the pollers
  // wait through setTimeout, and the pollers give up by Date.now(), so both
  // are driven here. Making the waits instant without advancing the clock
  // would turn a poll that never resolves into a real 700-second spin -
  // a hung suite rather than a failed check.
  const realSetTimeout = global.setTimeout;
  const realNow = Date.now;
  let virtualMs = 0;
  Date.now = () => realNow() + virtualMs;
  global.setTimeout = (fn, ms = 0) => { virtualMs += ms; setImmediate(fn); return 0; };
  const caseDef = { title: 'T-001', accused: 'a', deceased: 'd', actAlleged: 'x', background: 'p', agreedFacts: [], question: 'q', scopeNote: 's' };
  const record = {
    trial: { id: 'run-1' }, caseDef, agentProgress: {}, apiCallLogs: [],
    representativeArguments: REPRESENTATIVE_ROLES.map((role) => ({ role, seat: 'defense', argumentText: 'An argument.', modelUsed: 'm' })),
    judgeRulings: JUDGE_ROLES.map((role) => ({ role, verdict: 'justified', reasoningText: 'Reasons.', modelUsed: 'm' })),
  };
  let trialReads = 0;
  let historyReads = 0;
  rejection = await run(beginTrial, async (url, options = {}) => {
    const method = options.method || 'GET';
    if (method === 'POST') return url === '/api/trials' ? jsonReply(201, { trial: { id: 'run-1' }, caseDef }) : jsonReply(202, {});
    if (url === '/api/trials') { historyReads++; return jsonReply(200, { trials: [] }); }
    // One poll resolves every representative, the next every judge; the
    // read after that is the call-log refresh, which is the one that fails.
    if (url === '/api/trials/run-1' && ++trialReads <= 2) return jsonReply(200, record);
    if (url === '/api/trials/run-1') throw new TypeError('Failed to fetch');
    throw new Error(`unexpected request: ${method} ${url}`);
  });
  global.setTimeout = realSetTimeout;
  Date.now = realNow;
  check('the run does not reject', rejection === null, String(rejection));
  check('the refresh really was the request that failed', trialReads === 3, String(trialReads));
  check('the missing call log is reported', alerts.length === 1 && /call log could not be loaded/.test(alerts[0]), JSON.stringify(alerts));
  check('the run history is still refreshed after it', historyReads === 1, String(historyReads));
  check('every result from the run stays on screen', [...Object.values(state.representatives), ...Object.values(state.judges)].every((e) => e.status === 'success') && Object.keys(state.judges).length === JUDGE_ROLES.length);
  check('the controls, overlay and sidebar are restored', isIdle());
}

requestFailureChecks().then(
  () => {
    console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
    process.exit(failures === 0 ? 0 : 1);
  },
  (error) => {
    console.log('SUITE ERROR:', error);
    process.exit(1);
  }
);
