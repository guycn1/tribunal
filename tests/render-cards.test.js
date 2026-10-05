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
 *      A trigger Netlify's per-IP rate limit rejects - a bare 429 with an
 *      empty body - shows on the agent's card as that limit.
 *   4. The call log must say what actually happened: a response the token
 *      cap stopped is "truncated" and one a detector flagged
 *      "degenerated"; a "no response" row says whether it was retried or
 *      escalated; the legacy "truncated" badge marks only rows saved
 *      before truncation became a failure; a discarded attempt is dimmed
 *      and the role's own aborted row is not; an abort endpoint's row reads "abort requested",
 *      dimmed and uncaptioned, with its model printed as "n/a" rather than
 *      shortened like a model id; every cell carries its column name for
 *      the narrow card layout; the token breakdown can break only after
 *      its slash; and a model id is shortened by rule without losing the
 *      date stamp.
 *   5. Every badge label, on the agent cards as in the call log, reads in
 *      lowercase in the text itself.
 *   6. The banner above the judges names each representative whose
 *      argument is missing, and is hidden when none is.
 */

const { installDom, loadApp } = require('./support/load-app');
const { compileBackend } = require('./support/compile-backend');

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
  app = loadApp(['state', 'el', 'renderRepresentatives', 'renderJudges', 'renderCallLog', 'agentCardSignature', 'shortModelName', 'REPRESENTATIVE_ROLES', 'JUDGE_ROLES', 'beginTrial', 'loadTrial', 'buildAgentStatusBody', 'appendTruncationNotice', 'triggerAgent', 'deriveRoleStates', 'isTruncated']);
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
// failures: one ran into the token cap, the other did not and a detector
// flagged it. Labelling a capped response "degenerated" was inaccurate.
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

/**
 * Whether `html` holds a badge reading exactly `label`. Matching the badge
 * itself rather than the word anywhere in the row, since a caption or an
 * error message can contain the same word.
 *
 * @param {string} html
 * @param {string} label
 * @returns {boolean}
 */
function hasBadge(html, label) {
  return [...html.matchAll(/<span class="badge [\w-]+">([^<]*)<\/span>/g)].some((m) => m[1] === label);
}

const truncatedHtml = statusTextFor('[degenerate-retried-same-model] This attempt hit the max_tokens limit before finishing naturally - re-tried with the same model.');
check('a capped response is labelled "truncated"', hasBadge(truncatedHtml, 'truncated') && !hasBadge(truncatedHtml, 'degenerated'), truncatedHtml.slice(0, 160));

const degenerateHtml = statusTextFor('[degenerate-retried-same-model] This attempt repeated the same sentence 5 times ("i had no other way...") - re-tried with the same model.');
check('a looping response is still labelled "degenerated"', hasBadge(degenerateHtml, 'degenerated') && !hasBadge(degenerateHtml, 'truncated'), degenerateHtml.slice(0, 160));

const runOnHtml = statusTextFor('[degenerate-final] Every model tier was tried (4 in total, ending with google/gemini-2.5-pro) and none produced a usable response - the final attempt collapsed into a 62-word run with no punctuation ("she chose to burn...").');
check('a final run-on failure is labelled "degenerated"', hasBadge(runOnHtml, 'degenerated') && !hasBadge(runOnHtml, 'truncated'), runOnHtml.slice(0, 160));

const finalCapHtml = statusTextFor('[degenerate-final] Every model tier was tried (4 in total, ending with google/gemini-2.5-pro) and none produced a usable response - the final attempt hit the max_tokens limit before finishing naturally. Nothing was saved.');
check('a final capped failure is labelled "truncated"', hasBadge(finalCapHtml, 'truncated') && !hasBadge(finalCapHtml, 'degenerated'), finalCapHtml.slice(0, 160));

console.log('\n=== The legacy "truncated" badge marks only rows saved before truncation became a failure ===');
// Until 2026-08-29 13:19 UTC a reply still capped at the end was saved as a
// success, at a completion of 1x or 2x the cap. Since then a success can
// still land on 1,400 or 2,800 tokens at a later tier, whose cap is larger,
// and finish on its own there - that one is not truncated.
{
  const { appendTruncationNotice } = app;
  state.maxTokens = 1400;
  /**
   * Whether a one-row call log for a success of `completionTokens`, logged
   * at `timestamp`, carries the legacy badge beside "success".
   * @param {number} completionTokens
   * @param {string} timestamp
   * @returns {boolean}
   */
  const legacyBadge = (completionTokens, timestamp) => {
    state.callLog = [{ agentRole: 'grey_worm', callType: 'representative', modelUsed: 'anthropic/claude-haiku-4.5', promptTokens: 1000, completionTokens, totalTokens: 1000 + completionTokens, cost: 0.001, status: 'success', errorMessage: null, durationMs: 9000, timestamp }];
    renderCallLog();
    const html = (el.callLogBody.children[0] || {}).innerHTML || '';
    return hasBadge(html, 'success') && hasBadge(html, 'truncated');
  };
  /**
   * Whether an agent card for such a success carries the truncation notice.
   * @param {number} completion
   * @param {string} loggedAt
   * @returns {boolean}
   */
  const cardNotice = (completion, loggedAt) => {
    const card = document.createElement('div');
    appendTruncationNotice(card, { status: 'success', tokens: { completion }, loggedAt });
    return card.children.some((c) => c.textContent === 'truncated');
  };
  check('a row saved at the cap before the change has it', legacyBadge(1400, '2026-08-28T20:35:06Z'));
  check('and one saved at twice the cap', legacyBadge(2800, '2026-08-29T13:04:07Z'));
  check('one minute before the change still has it', legacyBadge(1400, '2026-08-29T13:18:36Z'));
  check('a success at 1,400 after the change does not', !legacyBadge(1400, '2026-08-29T13:20:36Z'));
  check('nor a success at 2,800 today', !legacyBadge(2800, new Date().toISOString()));
  check('the card shows the notice for a row saved before the change', cardNotice(1400, '2026-08-28T20:35:06Z'));
  check('and not for a success at 1,400 today', !cardNotice(1400, new Date().toISOString()));
  // The card reads the row's time from deriveRoleStates(), which backfills
  // it from the call log alongside the token counts.
  const derived = app.deriveRoleStates({
    representativeArguments: [{ role: 'grey_worm', seat: 'prosecution', argumentText: 'Saved at the cap.', modelUsed: 'mistralai/mistral-small-24b-instruct-2501' }],
    judgeRulings: [],
    apiCallLogs: [{ agentRole: 'grey_worm', callType: 'representative', status: 'success', errorMessage: null, promptTokens: 1000, completionTokens: 1400, totalTokens: 2400, timestamp: '2026-08-28T20:35:06Z' }],
  });
  check('deriveRoleStates() carries the row\'s time to the card', app.isTruncated(derived.representatives.grey_worm), JSON.stringify(derived.representatives.grey_worm));
}

console.log('\n=== Agent-card badges read in lowercase, like the call log and sidebar ===');
// Every badge in the app starts lowercase, so the three views read as one
// set. Each card state that shows a badge is built and its text compared
// exactly.
{
  const { buildAgentStatusBody, appendTruncationNotice } = app;
  /**
   * The text of every badge directly inside `node`.
   *
   * @param {{children: {className: string, textContent: string}[]}} node
   * @returns {string[]}
   */
  const badgeTexts = (node) => node.children.filter((c) => /\bbadge\b/.test(c.className)).map((c) => c.textContent);
  const cases = [
    ['an aborted call', buildAgentStatusBody({ status: 'aborted' }, 'jon_snow', 'Arguing'), 'aborted'],
    ['a failed call', buildAgentStatusBody({ status: 'failed', error: 'HTTP 402' }, 'jon_snow', 'Arguing'), 'call failed'],
    ['a call the page stopped waiting on', buildAgentStatusBody({ status: 'timeout', error: 'no reply' }, 'jon_snow', 'Arguing'), 'no result'],
  ];
  state.maxTokens = 1400;
  const truncatedCard = document.createElement('div');
  appendTruncationNotice(truncatedCard, { status: 'success', tokens: { completion: 1400 }, loggedAt: '2026-08-28T20:35:06Z' });
  cases.push(['a historical truncated result', truncatedCard, 'truncated']);
  for (const [what, node, expected] of cases) {
    const texts = badgeTexts(node);
    check(`${what} shows the "${expected}" badge`, texts.length === 1 && texts[0] === expected, JSON.stringify(texts));
  }
}

console.log('\n=== The judges\' banner names each representative with no argument ===');
// A representative is missing whatever the reason - its reply rejected as
// degenerate, say - so the banner says whose argument is absent, not why.
{
  const saved = { status: 'success', argumentText: 'An argument.', modelUsed: 'mistralai/mistral-small-24b-instruct-2501', seat: 'defense' };
  state.representatives = { jon_snow: saved, tyrion_lannister: saved, daenerys_targaryen: saved, grey_worm: { status: 'failed', error: 'Every model tier was tried.' } };
  state.judges = {};
  app.renderJudges();
  check('shown when one is missing, naming it', !el.judgesCaveat.classList.contains('hidden') && el.judgesCaveat.textContent === 'Reached with 3 of 4 representative arguments available (none from Grey Worm) - see Representatives above.', el.judgesCaveat.textContent);
  state.representatives.grey_worm = saved;
  app.renderJudges();
  check('hidden when all four are there', el.judgesCaveat.classList.contains('hidden'));
}

console.log('\n=== An abort row\'s model reads "n/a", not a shortened "a" ===');
// The abort endpoint logs "n/a" as the model of every row it writes. Run
// through shortModelName(), its "n/" looks like a vendor prefix and the cell
// read "a". It is not a model id, so it is printed as it stands, with no
// <abbr> and no tooltip - there is no longer form to reveal.
{
  /**
   * Renders a one-row call log and returns that row's Model cell contents.
   *
   * @param {string} modelUsed
   * @returns {string}
   */
  const modelCellFor = (modelUsed) => {
    state.callLog = [{
      agentRole: 'jon_snow', callType: 'representative', modelUsed,
      promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0,
      status: 'failed', errorMessage: 'Aborted by user before this call could complete.',
      durationMs: null, timestamp: new Date().toISOString(),
    }];
    renderCallLog();
    const row = el.callLogBody.children[0];
    const match = (row ? row.innerHTML : '').match(/<td data-label="Model">([\s\S]*?)<\/td>/);
    return match ? match[1].trim() : '';
  };
  const naCell = modelCellFor('n/a');
  // The same row's status: a request to stop, not a failure.
  const abortRow = (el.callLogBody.children[0] || {}).innerHTML || '';
  check('the abort endpoint\'s row reads "abort requested", in grey', /<span class="badge badge-aborted">abort requested<\/span>/.test(abortRow) && !/badge-fail/.test(abortRow), abortRow.slice(abortRow.indexOf('Status'), abortRow.indexOf('Status') + 200));
  check('with no caption under it, and dimmed', !/status-caption/.test(abortRow.slice(abortRow.indexOf('data-label="Status"'))) && el.callLogBody.children[0].classList.contains('row-dimmed'));
  /**
   * Whether a one-row call log for the given error message is dimmed.
   * @param {string} errorMessage
   * @returns {boolean}
   */
  const dimmed = (errorMessage) => {
    state.callLog = [{ agentRole: 'jon_snow', callType: 'representative', modelUsed: 'mistralai/mistral-small-24b-instruct-2501', promptTokens: 1000, completionTokens: 400, totalTokens: 1400, cost: 0.0001, status: 'failed', errorMessage, durationMs: 9000, timestamp: new Date().toISOString() }];
    renderCallLog();
    return el.callLogBody.children[0].classList.contains('row-dimmed');
  };
  check('a discarded attempt that was retried is dimmed', dimmed('[degenerate-retried-same-model] This attempt hit the max_tokens limit before finishing naturally - re-tried with the same model.'));
  check('but the role\'s own aborted row, its outcome, is not', !dimmed('[aborted-mid-call] Finished after the user aborted this trial: the reply was complete, but it was not saved.'));
  check('the Model cell reads exactly "n/a"', naCell === 'n/a', naCell);
  check('with no <abbr> or tooltip', !/<abbr|title=/.test(naCell), naCell);
  const realCell = modelCellFor('mistralai/mistral-small-24b-instruct-2501');
  check('a real model id is still shortened, with the full id on hover', realCell.includes('<abbr class="col-short" title="mistralai/mistral-small-24b-instruct-2501">mistral-small-24b-2501</abbr>'), realCell);
}

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
// The table is narrowest at a 901px viewport (below that the sidebar
// stacks and the table gets more room, not less): 655px wide, with a 131px
// Model column, or 640px and 128px once the page has a classic scrollbar.
// Measured at 655px, the id with "-instruct" left in needed 161px and
// wrapped; every id below now fits on one line, at 640px too. These assert the rules, not
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
  /**
   * A fetch for a server that is never reached - offline, DNS, connection
   * refused. fetch() rejects then, rather than resolving with an error
   * status.
   * @returns {Promise<never>}
   */
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

  console.log('\n=== A trigger the per-IP rate limit rejects is reported as that ===');
  // Netlify answers a rate-limited trigger with a bare 429 and an empty
  // body, as measured on the live site, before the handler ever runs.
  global.fetch = async () => ({ ok: false, status: 429, json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } });
  const limited = await app.triggerAgent('/api/trials/t/representatives/jon_snow', new AbortController().signal);
  check('a rate-limited trigger is not accepted', limited.accepted === false && limited.result.status === 'failed', JSON.stringify(limited));
  check("its card names Netlify's per-IP rate limit", /per-IP rate limit/.test((limited.result || {}).error || ''), (limited.result || {}).error);

  console.log('\n=== A "no response" row says whether it was retried or escalated ===');
  // One marker covers both, so the caption is read from the message's end.
  // The messages come from the real chain, so a change to their wording
  // that the caption stops reading fails here.
  const backend = compileBackend(['lib/openrouter.ts']);
  const { callOpenRouter } = backend.load('lib/openrouter.js');
  const quiet = { log: console.log, warn: console.warn };
  console.log = console.warn = () => {};
  process.env.OPENROUTER_API_KEY = 'test-key';
  const DEFAULT = 'mistralai/mistral-small-24b-instruct-2501';
  /**
   * The messages of the attempts a chain discards when the default model
   * fails every request in the way `fail` describes, before tier 2 answers.
   * @param {(skew: {ms: number}) => object} fail
   * @returns {Promise<string[]>}
   */
  const discardedFor = async (fail) => {
    const skew = { ms: 0 };
    const realNowFn = Date.now;
    Date.now = () => realNowFn() + skew.ms;
    global.fetch = async (_u, o) => {
      const model = JSON.parse(o.body).model;
      if (model === DEFAULT) return fail(skew);
      return { ok: true, status: 200, headers: new Map(), json: async () => ({ model, choices: [{ message: { content: 'The bells had rung. That is the fact.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }) };
    };
    try {
      const r = await callOpenRouter(DEFAULT, [{ role: 'user', content: 'hi' }], 1400, 'rep:test');
      return (r.discardedAttempts || []).map((d) => d.errorMessage);
    } finally {
      Date.now = realNowFn;
    }
  };
  // Two slow timeouts: the first is retried on the same model, the second
  // spends tier 1's last attempt and escalates.
  const slow = await discardedFor((skew) => { skew.ms += 45000; const e = new Error('timeout'); e.name = 'TimeoutError'; throw e; });
  // A fast 429 is retried on the same model without spending an attempt.
  let bounces = 0;
  const fast = await discardedFor(() => (++bounces === 1 ? { ok: false, status: 429, headers: new Map(), text: async () => '{}' } : { ok: true, status: 200, headers: new Map(), json: async () => ({ model: DEFAULT, choices: [{ message: { content: 'The bells had rung. That is the fact.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }) }));
  Object.assign(console, quiet);
  backend.cleanup();
  /**
   * The caption under a one-row call log's "no response" badge.
   * @param {string} errorMessage
   * @returns {string}
   */
  const captionFor = (errorMessage) => {
    state.callLog = [{ agentRole: 'jon_snow', callType: 'representative', modelUsed: DEFAULT, promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0, status: 'failed', errorMessage, durationMs: 45000, timestamp: new Date().toISOString() }];
    renderCallLog();
    const html = (el.callLogBody.children[0] || {}).innerHTML || '';
    return hasBadge(html, 'no response') ? (html.match(/<div class="status-caption">\(([^)]*)\)<\/div>/) || [])[1] : 'no "no response" badge';
  };
  check('the chain logged a slow retry and an escalation', slow.length === 2, JSON.stringify(slow));
  check('a slow failure retried on the same model says so', captionFor(slow[0]) === 'retried with the same model', `${captionFor(slow[0])} :: ${slow[0]}`);
  check('one that spent the tier says it escalated', captionFor(slow[1]) === 'escalated to a different model', `${captionFor(slow[1])} :: ${slow[1]}`);
  check('a fast failure retried for free says retried', fast.length === 1 && captionFor(fast[0]) === 'retried with the same model', `${fast.length} :: ${fast[0]}`);
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
