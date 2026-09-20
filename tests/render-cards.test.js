// Regression tests for the agent-card render path in public/app.js.
//
// Run with `npm test`. No framework and no browser: app.js's real source is
// executed against a minimal DOM stub, and the functions under test are
// handed back out of that scope, so these assert the actual shipped file
// rather than a copy of it.
//
// What this exists to protect:
//   1. The page must still execute top-to-bottom without throwing. app.js
//      has shipped a temporal-dead-zone crash before (a const read before
//      its declaration line), and a syntax-only check cannot catch that -
//      only really running the top-level code can.
//   2. Updating one agent's card must not disturb any other agent's card.
//      The render functions used to begin with `innerHTML = ''` and rebuild
//      every card in the phase, so a single agent escalating made all of
//      its siblings visibly flash - including cards already showing a
//      finished argument.

const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

let failures = 0;
function check(name, condition, detail) {
  if (condition) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}${detail !== undefined ? ` :: ${detail}` : ''}`);
  }
}

// --- the smallest DOM that app.js's card path actually touches ------------
function makeElement(tag = 'div') {
  const kids = [];
  const el = {
    tagName: String(tag).toUpperCase(),
    kids,
    dataset: {},
    style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' },
    className: '',
    textContent: '',
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
    hidden: false,
    parentElement: null,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }),
    scrollIntoView() {},
    appendChild(child) { kids.push(child); child.parentElement = el; return child; },
    removeChild(child) {
      const i = kids.indexOf(child);
      if (i >= 0) kids.splice(i, 1);
      return child;
    },
    replaceChild(next, old) {
      const i = kids.indexOf(old);
      if (i >= 0) kids[i] = next;
      next.parentElement = el;
      return old;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  // Assigning innerHTML replaces an element's children in a real DOM. The
  // stub does not parse the markup, but it must still clear them, or a
  // render that starts with `container.innerHTML = ''` would silently
  // accumulate rows across calls and every assertion would read a stale one.
  let html = '';
  Object.defineProperty(el, 'innerHTML', {
    get: () => html,
    set(value) { html = String(value); kids.length = 0; },
  });
  Object.defineProperty(el, 'children', { get: () => kids });
  Object.defineProperty(el, 'lastElementChild', { get: () => kids[kids.length - 1] || null });
  Object.defineProperty(el, 'firstElementChild', { get: () => kids[0] || null });
  return el;
}

const byId = new Map();
global.document = {
  getElementById: (id) => {
    if (!byId.has(id)) byId.set(id, makeElement());
    return byId.get(id);
  },
  createElement: (tag) => makeElement(tag),
  querySelector: () => makeElement(),
  querySelectorAll: () => [],
  addEventListener() {},
  body: makeElement(),
  documentElement: makeElement(),
  readyState: 'complete',
};
global.window = {
  addEventListener() {},
  requestAnimationFrame: () => 0,
  cancelAnimationFrame() {},
  scrollTo() {},
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  location: { href: 'http://localhost/' },
};
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};
global.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
global.alert = () => {};
global.AbortController = class { constructor() { this.signal = { aborted: false, addEventListener() {} }; } abort() {} };
global.DOMException = class extends Error {};

console.log('\n=== app.js executes cleanly (catches a TDZ-class load crash) ===');
let app;
try {
  // Hand back exactly the pieces under test from app.js's own top-level scope.
  app = new Function(`${SRC}\n;return { state, el, renderRepresentatives, renderJudges, renderCallLog, agentCardSignature, REPRESENTATIVE_ROLES, JUDGE_ROLES };`)();
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
check('Model renders the shortened id for the table', bodyRow.includes('>mistral-small-24b-instruct-2501</abbr>'), bodyRow.slice(0, 400));
check('Model renders the full id, vendor prefix and all, for the card view', bodyRow.includes('<span class="col-full">mistralai/mistral-small-24b-instruct-2501</span>'), bodyRow.slice(0, 400));

// The totals row is deliberately different: its first and last cells are a
// heading and a footnote, not labelled fields, and are marked as such so
// the card layout can style them that way.
const footRow = el.callLogFoot.children[0].innerHTML;
check('totals row marks its title cell', footRow.includes('total-row-title'), footRow.slice(0, 120));
check('totals row marks its footnote cell', footRow.includes('total-row-note'), footRow.slice(0, 120));
const footLabelled = (footRow.match(/data-label=/g) || []).length;
check('totals row labels its three real value cells', footLabelled === 3, String(footLabelled));

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
