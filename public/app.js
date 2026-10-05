/**
 * @file Browser front end for the Tribunal. Shows the fixed Case T-001
 * charge sheet, runs a trial - triggering the seven agent calls as Netlify
 * Background Functions and polling for their results - and displays each
 * argument and ruling, the per-call log, and the run history. The three
 * judges' rulings are shown independently, each on its own card, and are
 * never combined.
 *
 * This file is served as-is: no build step and no modules. It cannot import
 * from the Netlify Functions, so the values both sides must agree on are
 * duplicated here, and tests/shared-constants.test.js checks them: the
 * markers and fixed messages, the roles with their names and seats, and
 * POLL_TIMEOUT_MS and INTERRUPTED_THRESHOLD_MS against the server's time
 * budget; it also checks the scrollbar's resting opacity, which styles.css
 * repeats as a fallback. The types below mirror netlify/functions/lib/types.ts for the same reason. They
 * document the JSON this page receives, for readers and editors - nothing
 * type-checks this file (tsconfig.json covers netlify/functions only).
 */

/** @typedef {'jon_snow' | 'tyrion_lannister' | 'daenerys_targaryen' | 'grey_worm'} RepresentativeRole */
/** @typedef {'barak' | 'elon' | 'shamgar'} JudgeRole */
/** @typedef {RepresentativeRole | JudgeRole} AgentRole */
/** @typedef {'defense' | 'prosecution'} Seat */
/** @typedef {'justified' | 'not justified'} Verdict */

/**
 * The fixed case record, from /api/case and the trial endpoints.
 * @typedef {object} CaseDefinition
 * @property {string} caseCode
 * @property {string} title
 * @property {string} accused
 * @property {string} deceased
 * @property {string} actAlleged
 * @property {string} background Paragraphs separated by a blank line
 *   ("\n\n").
 * @property {string[]} agreedFacts
 * @property {string} question
 * @property {string} scopeNote
 */

/**
 * One api_call_logs row: a single attempt at a single agent call. Attempts
 * that were discarded and retried get a row too.
 * @typedef {object} ApiCallLog
 * @property {string} agentRole
 * @property {'representative' | 'judge'} callType
 * @property {string} modelUsed The full OpenRouter model id.
 * @property {number} promptTokens
 * @property {number} completionTokens
 * @property {number} totalTokens
 * @property {number} cost In US dollars.
 * @property {'success' | 'failed'} status
 * @property {string | null} errorMessage May begin with one of the
 *   *_MARKER prefixes below.
 * @property {string} timestamp ISO 8601.
 * @property {number | null} durationMs Null on a row that timed no attempt
 *   (the abort endpoint's rows, and a call that ended before starting an
 *   attempt) and on rows logged before the column existed.
 */

/**
 * The attempt most recently started for one role (agent_progress), written
 * server-side the moment each attempt begins.
 * @typedef {object} AttemptProgress
 * @property {string} model
 * @property {number} tierIndex Zero-based position in the escalation chain.
 * @property {number} attemptInTier One-based.
 * @property {number} tierMaxAttempts
 */

/**
 * The body of GET /api/trials/:id.
 * @typedef {object} FullTrialResponse
 * @property {{id: string, caseCode: string, status: 'created' | 'completed', createdAt: string, updatedAt: string}} trial
 * @property {CaseDefinition} caseDef
 * @property {Array<{role: RepresentativeRole, seat: Seat, argumentText: string, modelUsed: string, createdAt: string}>} representativeArguments
 * @property {Array<{role: JudgeRole, verdict: Verdict, reasoningText: string, modelUsed: string, createdAt: string}>} judgeRulings
 * @property {ApiCallLog[]} apiCallLogs Oldest first.
 * @property {Object<string, AttemptProgress>} agentProgress Keyed by role.
 */

/**
 * One trial in the run-history sidebar, from GET /api/trials.
 * @typedef {object} TrialSummary
 * @property {string} id
 * @property {string} caseCode
 * @property {'created' | 'completed'} status
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {boolean} hadFailures Whether any of the trial's call-log rows
 *   is stored as failed: a failed attempt, recovered or not, or a row an
 *   abort wrote. Deliberately not what the sidebar label is based on - see
 *   TOTAL_EXPECTED_RESULTS.
 * @property {boolean} wasAborted
 * @property {number} resultCount How many of the seven expected results
 *   were saved.
 */

/**
 * What the page knows about one agent's call: the value kept per role in
 * state.representatives and state.judges, and rendered as that role's card.
 * Which optional fields are present depends on `status`.
 * @typedef {object} AgentEntry
 * @property {'loading' | 'success' | 'failed' | 'aborted' | 'timeout'} status
 *   'timeout' means polling gave up waiting, not that the call is known to
 *   have failed.
 * @property {string} [argumentText] A representative's argument.
 * @property {Seat} [seat] A representative's seat.
 * @property {Verdict} [verdict] A judge's ruling.
 * @property {string} [reasoningText] A judge's reasoning.
 * @property {string} [modelUsed] The model that produced the kept result.
 * @property {{prompt: number, completion: number, total: number}} [tokens]
 *   Backfilled from the call log for a success - see isTruncated().
 * @property {string} [loggedAt] When a success's call-log row was written
 *   (ISO 8601), backfilled with its tokens - see isTruncated().
 * @property {string} [error] The message shown on a failed, aborted or
 *   timed-out card, with any marker prefix already stripped.
 * @property {AttemptProgress} [currentAttempt] While loading, the attempt in
 *   flight, once the server has reported one.
 */

/**
 * What triggerAgent() learns from its POST. `accepted` means only that the
 * platform took the request; the call's real outcome arrives later, through
 * polling.
 * @typedef {object} TriggerOutcome
 * @property {boolean} accepted
 * @property {AgentEntry} [result] Only when not accepted: the failed or
 *   aborted entry to show for the role.
 */

/**
 * deriveRoleStates()'s reading of one trial record.
 * @typedef {object} DerivedRoleStates
 * @property {Object<string, AgentEntry>} representatives Only roles with a
 *   final outcome - success, failed or aborted.
 * @property {Object<string, AgentEntry>} judges Likewise.
 * @property {Object<string, AttemptProgress>} agentProgress The attempt most
 *   recently started per role. Only meaningful for a role with no final
 *   outcome yet - rows for finished roles are left in place.
 */

/**
 * A freshly built agent card, from buildRepresentativeCard() or
 * buildJudgeCard().
 * @typedef {object} BuiltCard
 * @property {HTMLDivElement} card
 * @property {HTMLDivElement | null} scrollBody The scrolling text body, if
 *   the card has one - the caller attaches its scroll fade once the card is
 *   in the document.
 */

/**
 * @typedef {object} AppState
 * @property {string | null} trialId The trial on screen, live or reopened.
 * @property {CaseDefinition | null} caseDef
 * @property {Object<string, string> | null} modelInfo The starting model id
 *   per role, from /api/case.
 * @property {number | null} maxTokens The shared completion-token cap, from
 *   /api/case - see isTruncated().
 * @property {Object<string, AgentEntry>} representatives Keyed by role.
 * @property {Object<string, AgentEntry>} judges Keyed by role.
 * @property {ApiCallLog[]} callLog
 * @property {TrialSummary[]} history
 * @property {boolean} running A trial is being run from this page.
 * @property {boolean} loadingTrial A trial is being opened from history.
 * @property {AbortController | null} abortController Aborts the running
 *   trial; null when none is running.
 * @property {Promise<void> | null} trialPromise The live beginTrial() call,
 *   so abortCurrentTrial() can await it.
 */

/**
 * The four representative roles, in display order.
 *
 * @type {RepresentativeRole[]}
 */
const REPRESENTATIVE_ROLES = ['jon_snow', 'tyrion_lannister', 'daenerys_targaryen', 'grey_worm'];
/**
 * The three judge roles, in display order.
 *
 * @type {JudgeRole[]}
 */
const JUDGE_ROLES = ['barak', 'elon', 'shamgar'];

/**
 * Must match ABORTED_BY_USER_MESSAGE in netlify/functions/lib/db.ts exactly
 * (asserted by tests/shared-constants.test.js)
 * - used to recognise an aborted call's log row (see deriveRoleStates), so
 * it renders with the distinct "aborted" badge instead of the generic
 * "call failed" one.
 */
const ABORTED_BY_USER_MESSAGE = 'Aborted by user before this call could complete.';

/**
 * Must match NO_MODEL_USED in netlify/functions/lib/db.ts exactly (asserted
 * by tests/shared-constants.test.js) - the model_used on the abort
 * endpoint's rows, where no model ran. It is not a model id, so the call
 * log prints it as written (see formatModelCellHtml): shortModelName()
 * would read the "n/" as a vendor prefix and print "a".
 */
const NO_MODEL_USED = 'n/a';

// The six marker constants below must match their exports in
// netlify/functions/lib/openrouter.ts exactly - used by deriveRoleStates()
// and renderCallLog() to tell a discarded-but-recovered attempt (the role
// went on to succeed or is still trying a further tier) from a
// discarded-and-fatal one (the chain had nothing left to try), and by
// renderCallLog() to pick the right badge for each. There is no import to
// keep them in step - this file is served as plain static JS with no build
// step - so tests/shared-constants.test.js asserts the two sets match
// instead. Add a marker there, add it here.
//
// "DEGENERATE" in these names is an umbrella for the whole content-quality
// class - it covers a response cut off at the token cap as well as one
// that genuinely degenerated - which is why the badge these produce is
// chosen from the reason text below rather than from the marker alone.
// See the fuller note at the marker definitions in openrouter.ts for why
// the names are kept as they are rather than corrected.
/** A truncated or degenerate attempt that was retried on the same model. */
const DEGENERATE_RETRIED_SAME_MODEL_MARKER = '[degenerate-retried-same-model]';
/**
 * A truncated or degenerate attempt that escalated to the next tier's
 * model.
 */
const DEGENERATE_RETRIED_DIFF_MODEL_MARKER = '[degenerate-retried-diff-model]';
/**
 * A truncated or degenerate attempt with nothing left to try - the last
 * tier, or out of time budget. Terminal.
 */
const DEGENERATE_FINAL_MARKER = '[degenerate-final]';
/**
 * A tier's model rejected the request outright (e.g. a removed model id -
 * see the `!response.ok` branch this marker comes from in openrouter.ts)
 * and the chain escalated straight to the next tier. Same
 * "not a terminal outcome" treatment as the two DEGENERATE_RETRIED_*
 * markers above.
 */
const HTTP_ERROR_ESCALATED_MARKER = '[http-error-escalated]';
/**
 * A transient failure (a timeout or network error, a 408, a 429, a 5xx, a
 * 200 with no content or with a reply an upstream error cut short) that was
 * retried or escalated. Before these were logged at all, a call that kept
 * timing out left the card frozen with nothing in the log to explain it.
 */
const TRANSIENT_RETRIED_MARKER = '[transient-retried]';
/**
 * The chain stopped itself because the user aborted the trial while it was
 * still running server-side. Terminal, not a retry - but it means "stopped
 * on purpose", not "broke", so it renders as an abort rather than a
 * failure.
 */
const ABORTED_MID_CALL_MARKER = '[aborted-mid-call]';

/**
 * Sent as the X-Site-Gate header on every call that creates a trial or
 * spends OpenRouter quota (see isSiteGateOk in
 * netlify/functions/lib/siteGate.ts). This is NOT a real secret and isn't
 * meant to be one - it's shipped in this public, unauthenticated file, so
 * anyone who looks can read it. Its only job is to reject automated
 * traffic that never loaded this page at all. Must match the SITE_GATE_TOKEN environment
 * variable configured on the Netlify Functions side exactly, or every
 * gated request is rejected (creating a trial with a 401; an agent call
 * silently, visible only in Netlify's function logs) - if that env var is
 * left unset there,
 * isSiteGateOk() fails open (allows everything through) rather than
 * locking out real users, so this constant being "wrong" server-side is a
 * silent no-op, not an outage.
 */
const SITE_GATE_TOKEN = 'g8YdtIo_-n2zLFDsgWqqfuQmVKaNsHQaQtruTybqlvY';
/**
 * Headers for every request that creates a trial or triggers an agent
 * call.
 */
const SITE_GATE_HEADERS = { 'X-Site-Gate': SITE_GATE_TOKEN };

/**
 * Ends an alert() about a request that got no response at all - fetch()
 * itself failed, so the server was never reached.
 */
const SERVER_UNREACHABLE_MESSAGE = 'the server could not be reached. Check your connection and try again.';

/**
 * Display name and seat for each representative.
 * @type {Record<RepresentativeRole, {name: string, seat: Seat}>}
 */
const REPRESENTATIVE_META = {
  jon_snow: { name: 'Jon Snow', seat: 'defense' },
  tyrion_lannister: { name: 'Tyrion Lannister', seat: 'defense' },
  daenerys_targaryen: { name: 'Daenerys Targaryen', seat: 'prosecution' },
  grey_worm: { name: 'Grey Worm', seat: 'prosecution' },
};

/**
 * Card heading for each judge.
 * @type {Record<JudgeRole, {name: string}>}
 */
const JUDGE_META = {
  barak: { name: 'Judge — Barak method' },
  elon: { name: 'Judge — Elon method' },
  shamgar: { name: 'Judge — Shamgar method' },
};

/**
 * Everything the page is currently showing or doing. Mutated in place; the
 * render functions read from it.
 * @type {AppState}
 */
const state = {
  trialId: null,
  caseDef: null,
  modelInfo: null, // { [role]: string }, from /api/case
  maxTokens: null, // shared completion-token cap, from /api/case - see isTruncated()
  representatives: {},
  judges: {},
  callLog: [],
  history: [],
  running: false,
  loadingTrial: false,
  abortController: null,
  trialPromise: null, // the live beginTrial() call, so abortCurrentTrial() can await it
};

/**
 * Every static DOM element this script reads or writes, looked up once at
 * load. All are in index.html, and none is ever replaced - only their
 * contents, classes and state change.
 */
const el = {
  sidebar: document.getElementById('sidebar'),
  mainLoadingOverlay: document.getElementById('main-loading-overlay'),
  newTrialBtn: document.getElementById('new-trial-btn'),
  abortBtn: document.getElementById('abort-btn'),
  historyList: document.getElementById('history-list'),
  caseTitle: document.getElementById('case-title'),
  caseAccused: document.getElementById('case-accused'),
  caseDeceased: document.getElementById('case-deceased'),
  caseActAlleged: document.getElementById('case-act-alleged'),
  caseBackground: document.getElementById('case-background'),
  caseFacts: document.getElementById('case-facts'),
  caseQuestion: document.getElementById('case-question'),
  caseScopeNote: document.getElementById('case-scope-note'),
  phaseRepresentatives: document.getElementById('phase-representatives'),
  representativeCards: document.getElementById('representative-cards'),
  phaseJudges: document.getElementById('phase-judges'),
  judgesCaveat: document.getElementById('judges-caveat'),
  judgeCards: document.getElementById('judge-cards'),
  phaseLog: document.getElementById('phase-log'),
  callLogBody: document.getElementById('call-log-body'),
  callLogFoot: document.getElementById('call-log-foot'),
};

el.newTrialBtn.addEventListener('click', () => {
  // Stored so abortCurrentTrial() can await the same in-flight run - see
  // its own comment for why.
  state.trialPromise = beginTrial();
});

el.abortBtn.addEventListener('click', () => {
  abortCurrentTrial();
});

/**
 * Formats a date as "DD/MM/YYYY, HH:MM:SS".
 *
 * Explicit European format (DD/MM/YYYY, 24-hour) regardless of the
 * browser's own locale - bare toLocaleString() would otherwise follow
 * whatever the browser is configured to (commonly US-style M/D/YYYY,
 * 12-hour with AM/PM), which is not what's wanted here.
 *
 * @param {string | number | Date} dateInput Anything the Date constructor
 *   accepts.
 * @returns {string}
 */
function formatDateTime(dateInput) {
  return new Date(dateInput).toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/**
 * Formats a date as formatDateTime() does, as HTML with the date and the
 * time on separate lines.
 *
 * The date and time deliberately go on their own lines, not just as a
 * narrow-viewport fallback - fitting "DD/MM/YYYY, HH:MM:SS" on one line
 * needs real column width, while the wider of the two fragments alone
 * ("DD/MM/YYYY,") needs much less, freeing width for other columns. Each
 * fragment is wrapped in its own non-wrapping span so the date and the
 * time are each protected from ever breaking internally - only the space
 * between them (the line break) is allowed to give.
 *
 * @param {string | number | Date} dateInput
 * @returns {string} HTML.
 */
function formatDateTimeHtml(dateInput) {
  const [datePart, timePart] = formatDateTime(dateInput).split(', ');
  return `<span class="datetime-part">${datePart},</span><br /><span class="datetime-part">${timePart}</span>`;
}

/**
 * Shortens an OpenRouter model id for display.
 *
 * "mistralai/mistral-small-24b-instruct-2501" -> "mistral-small-24b-2501"
 * Strips any "provider/" prefix, a trailing ":free" suffix, and a standalone
 * "-instruct" segment, if present - display only, the full id is what's
 * actually sent to the backend/OpenRouter, and is still reachable from the
 * table (the <abbr title> on hover) and shown in full in the card layout
 * below 720px.
 *
 * All three are dropped for the same reason: none of them tell a reader of
 * this log anything the rest of the id doesn't. "instruct" distinguishes an
 * instruction-tuned model from its base variant, and every model this app
 * runs on is instruction-tuned, so here it is as content-free as the vendor
 * prefix. The date stamp ("-2501") is deliberately kept: it is the only
 * thing separating two pinned snapshots of the same model, which is exactly
 * what this column exists to report.
 *
 * These are generic rules rather than a per-model lookup table on purpose.
 * Every tier's model id is env-var-configurable (see models.ts), so a table
 * covers only the ids written into it, while the rules apply to any id that
 * is configured. If some future id still reads
 * badly after these rules, an exceptions table consulted ahead of them is
 * the fallback.
 *
 * @param {string | null | undefined} modelId A full model id.
 * @returns {string} The shortened id, or 'unknown model' when there is none.
 */
function shortModelName(modelId) {
  if (!modelId) return 'unknown model';
  return modelId
    .replace(/^[^/]+\//, '')
    .replace(/:free$/, '')
    .replace(/-instruct(?=-|$)/, '');
}

/**
 * Formats prompt and completion token counts for the Tokens column's
 * secondary line.
 *
 * The result reads "1,072 in / 1,400 out".
 *
 * The spaces inside each figure are non-breaking, and the slash is bound to
 * the first figure, so the only place this string can wrap is after the
 * slash. Left to ordinary spaces it wraps wherever it runs out of room,
 * which in the Tokens column's fixed width strands a lone "out" on a line
 * of its own ("1,072 in / 1,400" + "out"). Fixing it this way keeps the
 * column widths exactly as deterministic as they were - the colgroup
 * percentages and table-layout: fixed are untouched, since the problem was
 * never the column's width but where the text was permitted to break.
 * A run that still cannot fit is broken by the cell's overflow-wrap as a
 * last resort, so this can never overflow.
 *
 * @param {number} promptTokens
 * @param {number} completionTokens
 * @returns {string} HTML, using &nbsp; for every space but the one after the
 *   slash.
 */
function formatTokenBreakdown(promptTokens, completionTokens) {
  return `${promptTokens.toLocaleString()}&nbsp;in&nbsp;/ ${completionTokens.toLocaleString()}&nbsp;out`;
}

/**
 * Renders the call log's Model cell: the shortened id for the table layout,
 * with the full id on hover, and the full id for the card layout.
 *
 * NO_MODEL_USED is not a model id, so it is printed once as it stands, with
 * nothing to hover for: there is no longer form to reveal.
 *
 * @param {string} modelUsed
 * @returns {string} HTML.
 */
function formatModelCellHtml(modelUsed) {
  if (modelUsed === NO_MODEL_USED) return modelUsed;
  return `<abbr class="col-short" title="${modelUsed}">${shortModelName(modelUsed)}</abbr><span class="col-full">${modelUsed}</span>`;
}

/** Words for ordinalWord(), indexed by the number they spell. */
const ORDINAL_WORDS = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth'];
/**
 * Spells out a small ordinal: 1 -> "first", 2 -> "second", and so on.
 *
 * Used for the "(first attempt)"/"(second attempt)" suffix on a
 * still-loading card's model line (see buildAgentStatusBody) - only ever
 * needs to cover however many attempts buildRetryTiers() in openrouter.ts
 * gives any one tier (2 at most, as of 2026-10-05), but written to degrade to a plain
 * ordinal number rather than throw if that ever changes.
 *
 * @param {number} n A one-based attempt number.
 * @returns {string}
 */
function ordinalWord(n) {
  return ORDINAL_WORDS[n] || `${n}th`;
}

/**
 * Renders the call log's Type cell: a one-letter abbreviation for the
 * table layout and the full word for the card layout.
 *
 * Both spellings of the Type value are emitted, and the stylesheet shows
 * exactly one of them - see the .col-short/.col-full pair in styles.css.
 *
 * The single letter plus an <abbr> exists only because the table view has
 * to fit eight columns across; it is a concession to width, not a better
 * way to say "Representative". The card view below 720px has a whole row
 * per field and no such constraint, so it shows the real word with no
 * tooltip to hunt for - which also matters because a tooltip is close to
 * useless on the touch devices that get the card layout in the first
 * place. Rendering both and letting CSS choose keeps this a single render
 * path with no width checks in JS.
 *
 * @param {string} callType 'representative' or 'judge'; any other value is
 *   returned unchanged.
 * @returns {string} HTML.
 */
function formatCallTypeHtml(callType) {
  const full = callType === 'representative' ? 'Representative' : callType === 'judge' ? 'Judge' : null;
  if (!full) return callType;
  const short = callType === 'representative' ? 'R' : 'J';
  return `<abbr class="col-short" title="${full}">${short}</abbr><span class="col-full">${full}</span>`;
}

/**
 * When a reply still truncated at the end of the chain stopped being saved
 * as a success and became a failure (298d2fa, 2026-08-29 13:19:36 UTC). A
 * success row logged after this can never be a truncated one: from then on
 * the server fails such a call outright, so it reaches the card as a real
 * failure. As of 2026-10-03, every success row at a multiple of the cap in
 * the call log had been logged before it, the last at 13:04 UTC that day.
 */
const TRUNCATION_BECAME_FAILURE_AT = Date.parse('2026-08-29T13:19:36Z');

/**
 * True when a success logged at `loggedAt` with this many completion tokens
 * is one of the truncated replies saved before TRUNCATION_BECAME_FAILURE_AT:
 * logged before then, with a completion that is a whole multiple of the
 * shared token cap (state.maxTokens, from /api/case). Those rows were written
 * under a 1,400-token cap, the value state.maxTokens carries - see the
 * comment on AGENT_MAX_TOKENS in models.ts.
 *
 * A multiple rather than an exact match, because some of those rows have a
 * completion of exactly 2 x maxTokens (both the original attempt and the
 * retry hit the cap, and the code of the time saved that as a success). The
 * date is what keeps a newer success out: the later tiers have larger caps,
 * so a reply there can finish on its own at exactly 1,400 or 2,800 tokens.
 *
 * @param {number} completionTokens
 * @param {string | undefined} loggedAt ISO 8601, from the call-log row.
 * @returns {boolean}
 */
function isLegacyTruncation(completionTokens, loggedAt) {
  return Boolean(
    state.maxTokens &&
      completionTokens > 0 &&
      completionTokens % state.maxTokens === 0 &&
      loggedAt &&
      Date.parse(loggedAt) < TRUNCATION_BECAME_FAILURE_AT
  );
}

/**
 * True for a successful entry that is one of the truncated replies saved
 * before TRUNCATION_BECAME_FAILURE_AT - see isLegacyTruncation(). The server
 * logs a capped reply distinctly via finish_reason (see openrouter.ts), and
 * fails it outright today; this reads the rows saved before that. It reads
 * a live entry and one reopened from history alike, since both are built by
 * deriveRoleStates(), which backfills tokens.completion and loggedAt from
 * the matching api_call_logs row for exactly this purpose.
 *
 * @param {AgentEntry | undefined} entry
 * @returns {boolean}
 */
function isTruncated(entry) {
  return Boolean(
    entry && entry.status === 'success' && entry.tokens && isLegacyTruncation(entry.tokens.completion, entry.loggedAt)
  );
}

/**
 * Creates a new trial and runs it: the four representatives, then - unless
 * the user aborts - the three judges, then a final refresh of the call log
 * and the run history.
 *
 * Does nothing while a trial is already running or one is being opened from
 * history. Progress is reported through `state` and the cards as it
 * happens, not through the returned promise. Failing to create the trial,
 * or to load its call log once it has run, is reported with alert().
 *
 * @returns {Promise<void>} Resolves once the run has fully unwound and the
 *   controls are restored, which is what abortCurrentTrial() waits for.
 *   Failed requests are reported to the user rather than rejecting it.
 */
async function beginTrial() {
  if (state.running || state.loadingTrial) return;
  state.running = true;
  updateHistoryLockState();
  el.newTrialBtn.disabled = true;
  el.abortBtn.classList.remove('hidden');
  const controller = new AbortController();
  state.abortController = controller;
  // Same loading cue as opening a trial from history (el.mainLoadingOverlay/
  // .sidebar.loading-locked) - creating the trial plus the Representatives
  // phase's first render can take a couple of real seconds, during which
  // the page previously just sat there static with no indication anything
  // was happening.
  el.mainLoadingOverlay.classList.remove('hidden');
  el.sidebar.classList.add('loading-locked');

  try {
    // A request that never reaches the server makes fetch() throw, and a
    // platform error page (a 502, say) is not JSON. Both used to escape
    // as an uncaught rejection, so the click looked as if it had done
    // nothing - the error reached only the browser console.
    let res;
    try {
      res = await fetch('/api/trials', { method: 'POST', headers: SITE_GATE_HEADERS });
    } catch {
      alert(`Failed to create trial: ${SERVER_UNREACHABLE_MESSAGE}`);
      return;
    }
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      alert(`Failed to create trial: ${(data && data.error) || `unexpected response (HTTP ${res.status})`}`);
      return;
    }

    state.trialId = data.trial.id;
    state.caseDef = data.caseDef;
    state.representatives = {};
    state.judges = {};
    state.callLog = [];

    renderCaseSheet();
    el.phaseRepresentatives.classList.remove('hidden');
    el.phaseJudges.classList.add('hidden');
    el.phaseLog.classList.add('hidden');

    // Seed and paint the "Arguing…" loading cards here, before scrolling -
    // this used to happen inside runRepresentativesPhase() as its first
    // synchronous action, called only after the scroll below, which meant
    // document.body.scrollHeight was measured while the cards didn't exist
    // yet. The page grew right out from under the just-finished scroll the
    // instant those cards painted, landing short of the real bottom (real
    // user report). Doing it here first means the cards are already part
    // of the page's height by the time scrollHeight is read.
    for (const role of REPRESENTATIVE_ROLES) {
      state.representatives[role] = { status: 'loading' };
    }
    renderRepresentatives();

    // Now that the loading cards are painted above, phaseRepresentatives'
    // real height already includes them - block: 'start' (same as
    // loadTrial()'s history-entry scroll) now lands on the section heading
    // with the cards genuinely visible below it, rather than needing the
    // window.scrollTo-the-bottom workaround this used before the cards
    // were moved earlier. The earlier attempts at block: 'end'/scrolling to
    // the page bottom were compensating for the cards not existing yet at
    // scroll time, not for 'start' itself being the wrong target.
    el.phaseRepresentatives.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Hidden here, not only in the outer finally below - the loading cards
    // are already painted above, so by the time the browser actually gets
    // to paint anything, the overlay-hidden state and the loading cards
    // land in the same frame together - no flash of "overlay gone, cards
    // not there yet" in between.
    el.mainLoadingOverlay.classList.add('hidden');
    el.sidebar.classList.remove('loading-locked');

    await runRepresentativesPhase(controller.signal);
    if (!controller.signal.aborted) {
      await runJudgesPhase(controller.signal);
    }
    const callLogLoaded = await refreshFullTrial();
    await refreshHistory();
    if (!callLogLoaded) {
      alert("This trial's call log could not be loaded. Reopen the trial from Run history to see it.");
    }
  } finally {
    state.running = false;
    updateHistoryLockState();
    state.abortController = null;
    el.newTrialBtn.disabled = false;
    el.abortBtn.classList.add('hidden');
    // Safety net for the early-failure path above (trial creation itself
    // failed, before the happy path's own earlier hide runs) - a no-op
    // once that's already fired.
    el.mainLoadingOverlay.classList.add('hidden');
    el.sidebar.classList.remove('loading-locked');
  }
}

/**
 * Greys out the run-history list while a trial is running, and restores
 * it once the run ends.
 *
 * Visual "you can't click these right now" cue for the whole run-history
 * list while a trial is running - clicking a history entry mid-run
 * already correctly does nothing (loadTrial()'s own state.running guard,
 * verified directly against the code - the only click handler a history
 * entry has), this just makes that fact visible instead of silent.
 * Toggled directly on state.running transitions (both in beginTrial())
 * rather than folded into renderHistory(), since that function only
 * actually runs on a fresh fetch/reload of the list - relying on it here
 * would leave the lock indicator not appearing until well after a trial
 * had already started, or not clearing until the next unrelated
 * re-render after one finishes.
 */
function updateHistoryLockState() {
  el.historyList.classList.toggle('running-locked', state.running);
}

/**
 * Aborts the trial currently running from this page.
 *
 * Records which roles were still pending, gives immediate visual feedback
 * (doesn't wait on the network round trip below), and persists the abort as
 * a real, visible fact.
 *
 * Persisting is not just bookkeeping - it does two jobs, and telling the
 * in-flight calls to stop is the more important one. Aborting a fetch()
 * client-side cannot stop the Netlify invocation it was talking to, so the
 * persisted row is the only channel there is: each running call checks for
 * it before each attempt and as each one ends, and stops itself
 * (isTrialAborted in db.ts). Second,
 * it makes the abort durable, so the sidebar reflects it on a later visit
 * and a stray success or failure logged after the fact can't make an
 * aborted run look like an ordinary one.
 *
 * @returns {Promise<void>} Settles once beginTrial() has finished unwinding
 *   and the loading overlay is cleared. Never rejects.
 */
async function abortCurrentTrial() {
  if (!state.abortController || !state.trialId) return;

  // Same loading cue as the other two flows (opening a trial from history,
  // beginning a new one) - the card state below updates synchronously and
  // immediately, but the page settles (the Abort button disappearing,
  // "Begin new trial" re-enabling) only after a few network round trips,
  // 2-3s in all: the abort POST below, and beginTrial()'s own unwinding,
  // which ends any poll in flight (a GET already sent finishes first), then
  // refreshes the call log and the run history before its finally block
  // runs. The overlay covers that.
  el.mainLoadingOverlay.classList.remove('hidden');
  el.sidebar.classList.add('loading-locked');

  /**
   * Whether a role's card is still waiting on its call.
   * @param {string | undefined} status
   * @returns {boolean}
   */
  const isPending = (status) => status === 'loading';
  const pendingRoles = [
    ...REPRESENTATIVE_ROLES.filter((r) => isPending(state.representatives[r] && state.representatives[r].status)),
    ...JUDGE_ROLES.filter((r) => isPending(state.judges[r] && state.judges[r].status)),
  ];

  state.abortController.abort();

  for (const role of pendingRoles) {
    const bucket = role in REPRESENTATIVE_META ? state.representatives : state.judges;
    bucket[role] = { status: 'aborted', error: 'Stopped by user.' };
  }
  renderRepresentatives();
  renderJudges();

  if (pendingRoles.length > 0 && state.trialId) {
    try {
      await fetch(`/api/trials/${state.trialId}/abort`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roles: pendingRoles }),
      });
    } catch {
      // Best-effort - the visible client-side state above already reflects
      // the abort regardless of whether this logging call itself lands.
    }
    refreshHistory();
  }

  // Wait for beginTrial()'s own async chain to actually finish unwinding
  // (its finally block is what clears state.running, re-enables "Begin
  // new trial", and hides the Abort button) before dropping the overlay -
  // otherwise it would disappear while those controls are still visibly
  // mid-transition for a moment longer. beginTrial() reports its own
  // failed requests rather than rejecting, so a rejection here would mean
  // a bug - but even then it must never leave the overlay stuck.
  try {
    await state.trialPromise;
  } catch {
    // See above - must never block clearing the overlay.
  }

  el.mainLoadingOverlay.classList.add('hidden');
  el.sidebar.classList.remove('loading-locked');
}

// Why these two constants exist: in one real run, all 4 representative
// calls fired at the exact same instant and only the first came back with
// real content - the other 3 got an immediate 429. A start-time stagger
// alone (kickoffs 400ms apart) did not fix it in a later run either: three
// of four still failed, two of them with a genuine no-response timeout
// rather than a fast 429. A few hundred ms of head start barely matters
// when each call's real generation takes 15-20s. The same run's judges
// phase - 3 calls, same stagger - all succeeded on attempt 1, which read at
// the time as "this account takes 3 simultaneous calls cleanly but not 4,"
// so a worker pool was added to cap how many were ever in flight at once.
//
// That cap no longer does that job, and hasn't since the agent endpoints
// became Background Functions. runWithConcurrencyLimit wraps triggerAgent,
// which returns the moment Netlify's automatic 202 arrives (~0.3-0.5s)
// rather than when the generation finishes - so a slot frees almost
// immediately and all 4 representatives end up genuinely in flight
// together. Measured, not assumed: as of 2026-09-21, across the 41 trials
// in this project's own api_call_logs that carry real duration data, 36 ran
// all 4 representatives simultaneously (reconstructing each call's start as
// its timestamp minus duration_ms) - including every one of the four trials
// run against the live deployed site, each of which ran 4 of 4
// representatives and 3 of 3 judges at once. What these constants
// actually bound now is how many trigger POSTs overlap - not OpenRouter's
// account-level concurrency, and not Netlify's per-IP rate limit either,
// which counts requests in a window however they overlap.
//
// Kept rather than removed or "restored," deliberately. The original
// 3-vs-4 reading came from two runs on 2026-08-28 - on the current default
// model, but while the agent calls were still synchronous functions - and
// has since been overtaken by evidence: since the move, full trials have
// run with all 4 representatives in flight together (36 of the 41 measured
// above, and all four production trials of 2026-09-21), so there is no
// demonstrated problem left to solve. Removing the pool
// would gain nothing either: a bounded, staggered dispatch costs about a
// second per phase.
/**
 * Stagger between trigger POSTs within one phase: the role at index N is
 * triggered N times this many ms after the phase starts, at the earliest.
 */
const CONCURRENT_CALL_STAGGER_MS = 400;
/**
 * How many trigger POSTs may be outstanding at once within one phase. Not a
 * bound on concurrent OpenRouter calls - see the note above.
 */
const MAX_CONCURRENT_CALLS = 3;

/**
 * Runs `worker` over `items` with at most `limit` calls to *worker*
 * outstanding at once. A fixed pool of `limit` runners each pull the next
 * item as soon as they're free, so item N+1 starts once one of the first
 * `limit` workers has returned. Every item still runs without waiting on
 * any *specific* other item, only on a free slot, so this stays real
 * concurrency, just bounded.
 *
 * What that actually bounds depends entirely on what `worker` waits for.
 * Both call sites pass triggerAgent, which returns at Netlify's 202 rather
 * than at the end of the generation it kicked off - so this bounds
 * overlapping trigger POSTs, not overlapping OpenRouter calls. See the
 * comment on MAX_CONCURRENT_CALLS above for the measurement behind that.
 *
 * @template T
 * @param {T[]} items
 * @param {number} limit The most calls to `worker` outstanding at once.
 * @param {(item: T, index: number) => Promise<void>} worker Called once per
 *   item, with the item's index in `items`.
 * @returns {Promise<void>} Resolves once every slot has finished. Never
 *   rejects - a worker that throws ends only its own slot, and the remaining
 *   items go to the other slots.
 */
async function runWithConcurrencyLimit(items, limit, worker) {
  let nextIndex = 0;
  /**
   * One pool slot: keeps taking the next unclaimed item until none remain.
   * @returns {Promise<void>}
   */
  async function runSlot() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      await worker(items[index], index);
    }
  }
  const slots = Array.from({ length: Math.min(limit, items.length) }, () => runSlot());
  await Promise.allSettled(slots);
}

/**
 * Waits for `ms` milliseconds.
 *
 * Abort-aware: rejects immediately (rather than waiting out the delay) if
 * the signal fires mid-wait, so Abort actually stops things promptly even
 * during a stagger or backoff pause, not just between HTTP requests.
 *
 * @param {number} ms
 * @param {AbortSignal} [signal] Cancels the wait when aborted.
 * @returns {Promise<void>} Rejects with an AbortError DOMException if the
 *   signal is already aborted, or aborts before the time is up.
 */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        },
        { once: true }
      );
    }
  });
}

/**
 * Starts one agent call and reports whether the platform accepted it -
 * never whether the call itself succeeded.
 *
 * The agent endpoints now run as Netlify Background Functions (declared
 * by their -background filenames) - the fix for a verified, load-bearing
 * problem: real calls on the default model at the time routinely took
 * longer per attempt, before any retry, than the synchronous function limit
 * on Netlify's free plan (as documented when checked on 2026-08-28). A
 * standard invocation could not reliably survive that gap no matter how the
 * internal retry/timeout budget was tuned. Background Functions get far
 * longer instead - but the platform responds 202 immediately and runs the
 * handler asynchronously, so its real return value never reaches this fetch()
 * call the way a normal synchronous function's did. Calling a role now
 * has two separate steps: triggerAgent() fires the request and reports
 * only what's knowable synchronously (a network failure, or a
 * platform-level rejection like Netlify's own per-IP rate limit); the
 * real, eventual outcome is discovered afterwards by polling
 * GET /api/trials/:id (see pollForRoles() and deriveRoleStates() below).
 *
 * @param {string} url The role's endpoint, e.g.
 *   /api/trials/:id/representatives/:role.
 * @param {AbortSignal} signal
 * @returns {Promise<TriggerOutcome>} Never rejects - a network error or an
 *   abort comes back as a failed or aborted result instead.
 */
async function triggerAgent(url, signal) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', signal, headers: SITE_GATE_HEADERS });
  } catch (err) {
    // A genuine network-level failure - offline, DNS, connection refused,
    // or the AbortController firing. Nothing came back at all.
    if ((err && err.name === 'AbortError') || (signal && signal.aborted)) {
      return { accepted: false, result: { status: 'aborted', error: 'Stopped by user.' } };
    }
    return { accepted: false, result: { status: 'failed', error: String(err) } };
  }

  if (res.ok) {
    // A 2xx here - including Netlify's own automatic 202 for a Background
    // Function - means only "accepted for processing," not "succeeded."
    // The real outcome is left entirely to pollForRoles().
    return { accepted: true };
  }

  // A non-2xx this early comes from the platform rather than from this
  // app's own handler code, since a Background Function's own
  // application-level outcome never reaches this response at all. Two
  // causes have been seen on this project: Netlify's per-IP rate limiter
  // (the rate_limit on the two agent routes in netlify.toml), which answers
  // 429 with an empty body, and a routing failure - an immediate 404 on
  // every call, when the function files were renamed and netlify.toml's
  // redirect targets still pointed at the old names. Any other platform
  // error (a 5xx, say) lands in the same branch. They look nothing alike,
  // so don't read every non-2xx here as rate limiting.
  let message;
  try {
    const data = await res.json();
    message = data.error || `HTTP ${res.status}`;
  } catch {
    message =
      res.status === 429
        ? "Too many requests from this network in a short time (Netlify's own per-IP rate limit, separate from this app's own call cap). Wait a few minutes and try again."
        : `Server returned an unexpected non-JSON response (HTTP ${res.status}).`;
  }
  return { accepted: false, result: { status: 'failed', error: message } };
}

/**
 * True for a 'failed' log row that represents a discarded attempt that
 * was retried or escalated (openrouter.ts's onDiscardedAttempt callback
 * writes these live, mid-escalation - see
 * representative-background.ts/judge-background.ts) - NOT a terminal
 * outcome for the role. The role is still genuinely running
 * server-side on a later attempt when a row like this exists with no
 * success/final-failure row after it yet.
 *
 * @param {ApiCallLog} log
 * @returns {boolean}
 */
function isRetriedMarkerLog(log) {
  return (
    typeof log.errorMessage === 'string' &&
    (log.errorMessage.startsWith(DEGENERATE_RETRIED_SAME_MODEL_MARKER) ||
      log.errorMessage.startsWith(DEGENERATE_RETRIED_DIFF_MODEL_MARKER) ||
      log.errorMessage.startsWith(HTTP_ERROR_ESCALATED_MARKER) ||
      log.errorMessage.startsWith(TRANSIENT_RETRIED_MARKER))
  );
}

/**
 * True for a discarded attempt's message that records an escalation to the
 * next tier's model rather than a retry of the same one. openrouter.ts
 * ends every such message with one or the other: "- escalated to
 * <model id>." or "- re-tried with the same model", the fast-failure form
 * followed by a parenthesis. Same literal-string coupling as the markers.
 *
 * @param {string} message
 * @returns {boolean}
 */
function isEscalationMessage(message) {
  return / - escalated to \S+\.$/.test(message);
}

/**
 * Strips a leading marker (plus the space after it) from an error message
 * before it's shown on an agent card - any of the six, not just the
 * DEGENERATE_* ones; the list below is the authority. Those markers exist
 * so renderCallLog() can tell attempt outcomes apart in the call log
 * table, but they're internal bookkeeping, not something a reader of the
 * card should ever see verbatim. The call log table is unaffected: it
 * reads state.callLog (the raw apiCallLogs rows) directly, never through
 * this function, so its own marker-based badge/caption logic still sees
 * the real, unstripped text.
 *
 * @param {string | null} message
 * @returns {string | null} The message without its marker; unchanged when it
 *   has none, or is not a string.
 */
function stripMarkerPrefix(message) {
  if (typeof message !== 'string') return message;
  for (const marker of [
    DEGENERATE_RETRIED_SAME_MODEL_MARKER,
    DEGENERATE_RETRIED_DIFF_MODEL_MARKER,
    DEGENERATE_FINAL_MARKER,
    HTTP_ERROR_ESCALATED_MARKER,
    TRANSIENT_RETRIED_MARKER,
    ABORTED_MID_CALL_MARKER,
  ]) {
    if (message.startsWith(marker)) return message.slice(marker.length).trimStart();
  }
  return message;
}

/**
 * Derives a {representatives, judges, agentProgress} status map from one
 * GET /api/trials/:id response - the single source of truth for "what has
 * actually happened so far in this trial," used identically whether
 * reopening a finished historical trial (loadTrial) or polling a live one
 * (pollForRoles), so the two call sites can't quietly drift into
 * disagreeing about what the same trial record means. apiCallLogs is
 * ordered ascending by timestamp (see getFullTrial in db.ts), so the last
 * matching row for a role is its most recent attempt.
 *
 * agentProgress (from db.ts's agent_progress table, via getFullTrial) is
 * deliberately separate from representatives/judges: it's live-in-flight
 * signal - the model/attempt actually running right now, overwritten in
 * place as the chain progresses - not a terminal state, and pollForRoles
 * treats any entry present in representatives/judges as "this role is
 * done." A discarded-attempt log row also isn't folded in here for the
 * same reason (for a day, 2026-09-03, the live model line did come from
 * those rows, and was one attempt behind reality as a result):
 * agentProgress is written the moment an attempt *starts*, so it's never
 * behind the real current attempt the way inferring from a *discarded* row
 * necessarily is.
 *
 * @param {FullTrialResponse} data
 * @returns {DerivedRoleStates}
 */
function deriveRoleStates(data) {
  /** @type {Object<string, AgentEntry>} */
  const representatives = {};
  /** @type {Object<string, AgentEntry>} */
  const judges = {};

  for (const arg of data.representativeArguments || []) {
    representatives[arg.role] = {
      status: 'success',
      argumentText: arg.argumentText,
      seat: arg.seat,
      modelUsed: arg.modelUsed,
    };
  }
  for (const ruling of data.judgeRulings || []) {
    judges[ruling.role] = {
      status: 'success',
      verdict: ruling.verdict,
      reasoningText: ruling.reasoningText,
      modelUsed: ruling.modelUsed,
    };
  }

  for (const log of data.apiCallLogs || []) {
    const store = log.callType === 'representative' ? representatives : judges;
    if (log.status !== 'success') {
      if (store[log.agentRole] && store[log.agentRole].status === 'success') continue;
      if (isRetriedMarkerLog(log)) {
        // Not a terminal outcome - the escalation chain is still running
        // (see agentProgress above for what actually renders "currently
        // trying X" while it does) - don't report a false "call failed"
        // for a role that's actually still in progress.
        continue;
      }
      // Two different rows can mean "the user stopped this": the one
      // abort.ts writes for every pending role at the moment Abort is
      // clicked, and the one the call writes for itself once it notices -
      // before its next attempt, as an attempt ends, or when a reply
      // finishes after the abort (see ABORTED_MID_CALL_MARKER in
      // openrouter.ts). Both are deliberate stops, not failures, so
      // both get the "aborted" treatment rather than a red "call failed".
      const abortedMidCall = typeof log.errorMessage === 'string' && log.errorMessage.startsWith(ABORTED_MID_CALL_MARKER);
      store[log.agentRole] =
        log.errorMessage === ABORTED_BY_USER_MESSAGE || abortedMidCall
          ? { status: 'aborted', error: stripMarkerPrefix(log.errorMessage) }
          : { status: 'failed', error: stripMarkerPrefix(log.errorMessage) || 'Unknown failure' };
    } else if (store[log.agentRole] && store[log.agentRole].status === 'success') {
      // representative_arguments/judge_rulings don't store token counts or
      // the call's time (only api_call_logs does) - without these,
      // isTruncated() would have nothing to compare against.
      store[log.agentRole].tokens = { prompt: log.promptTokens, completion: log.completionTokens, total: log.totalTokens };
      store[log.agentRole].loggedAt = log.timestamp;
    }
  }

  return { representatives, judges, agentProgress: data.agentProgress || {} };
}

/**
 * How long to keep polling a phase for a role that hasn't resolved yet
 * before giving up and showing it as unclear rather than waiting forever.
 * Comfortably above openrouter.ts's own TOTAL_BUDGET_MS (650s, sized for
 * the full 4-tier escalation chain - see openrouter.ts) plus real margin
 * for polling/network overhead. This drifted out of sync once before: the
 * server budget was raised from 120s to 650s to fit the escalation chain,
 * but this constant stayed at its old value (150s) - an observed
 * consequence was a role that genuinely succeeded server-side (verified
 * directly in the DB) still showing as unresolved on the client because
 * polling gave up first; tests/shared-constants.test.js keeps it above
 * TOTAL_BUDGET_MS. A role that still hasn't resolved by this
 * timeout was either turned away by the site gate or the call cap, whose
 * rejections show only in Netlify's function logs (see
 * representative-background.ts), or ran into something unexpected; either
 * way its card says the page stopped waiting, rather than spinning on.
 */
const POLL_TIMEOUT_MS = 700000;
/** Time between polls of GET /api/trials/:id, in ms. */
const POLL_INTERVAL_MS = 2500;

/**
 * Polls GET /api/trials/:id until every role in `pendingRoles` has
 * resolved (success/failed/aborted) or POLL_TIMEOUT_MS elapses, updating
 * `bucket` (state.representatives or state.judges) and calling `render`
 * incrementally as each role resolves, rather than waiting for the whole
 * batch together.
 *
 * @param {AgentRole[]} pendingRoles Roles whose calls were accepted and have
 *   no outcome yet.
 * @param {Object<string, AgentEntry>} bucket state.representatives or
 *   state.judges, updated in place.
 * @param {() => void} render Re-renders the phase's cards.
 * @param {AbortSignal} signal Stops polling when aborted. The aborted state
 *   itself is set by abortCurrentTrial(), not here.
 * @returns {Promise<void>} Resolves once every role has an outcome, polling
 *   times out (the roles still pending are marked 'timeout'), or the signal
 *   aborts.
 */
async function pollForRoles(pendingRoles, bucket, render, signal) {
  const remaining = new Set(pendingRoles);
  const startedAt = Date.now();

  while (remaining.size > 0) {
    if (signal && signal.aborted) return;
    if (Date.now() - startedAt >= POLL_TIMEOUT_MS) break;

    try {
      await sleep(POLL_INTERVAL_MS, signal);
    } catch {
      return; // aborted mid-wait - abortCurrentTrial() already set 'aborted' state directly
    }
    if (signal && signal.aborted) return;

    let data;
    try {
      const res = await fetch(`/api/trials/${state.trialId}`);
      if (!res.ok) continue;
      data = await res.json();
    } catch {
      continue; // transient - the next tick tries again rather than giving up on one blip
    }

    const derived = deriveRoleStates(data);
    let changed = false;
    for (const role of Array.from(remaining)) {
      const entry = derived.representatives[role] || derived.judges[role];
      if (entry) {
        bucket[role] = entry;
        remaining.delete(role);
        changed = true;
        continue;
      }
      // Still genuinely pending, but agent_progress may have moved on to a
      // later attempt/tier since the last tick - surface that live rather
      // than leaving buildAgentStatusBody showing the static default model
      // for the whole call regardless of how far it's actually escalated.
      const progress = derived.agentProgress[role];
      const prev = bucket[role] && bucket[role].currentAttempt;
      if (
        progress &&
        bucket[role] &&
        (!prev || prev.model !== progress.model || prev.tierIndex !== progress.tierIndex || prev.attemptInTier !== progress.attemptInTier)
      ) {
        bucket[role] = { ...bucket[role], currentAttempt: progress };
        changed = true;
      }
    }
    if (changed) render();
  }

  if (remaining.size > 0) {
    for (const role of remaining) {
      bucket[role] = {
        status: 'timeout',
        error: `No outcome was recorded for this role in the ${Math.round(POLL_TIMEOUT_MS / 1000)}s the page waits, which is longer than a call is allowed to run. Reopening this trial from history shows everything recorded for it.`,
      };
    }
    render();
  }
}

/**
 * Triggers the four representative calls - staggered, through the bounded
 * pool - then polls until each has an outcome.
 *
 * Expects beginTrial() to have already seeded and rendered the loading
 * cards. A trigger the platform rejects is shown as failed straight away
 * and is not polled for.
 *
 * @param {AbortSignal} signal
 * @returns {Promise<void>}
 */
async function runRepresentativesPhase(signal) {
  // The initial "Arguing…" loading-card seed + render used to happen right
  // here, as this function's first synchronous action. It now happens in
  // beginTrial() instead, before the section is scrolled into view - see
  // the comment there for why. beginTrial() is the only caller, so nothing
  // else depends on this function seeding state.representatives itself.
  const triggered = [];
  await runWithConcurrencyLimit(REPRESENTATIVE_ROLES, MAX_CONCURRENT_CALLS, async (role, index) => {
    try {
      await sleep(index * CONCURRENT_CALL_STAGGER_MS, signal);
    } catch {
      state.representatives[role] = { status: 'aborted', error: 'Stopped by user.' };
      renderRepresentatives();
      return;
    }
    const outcome = await triggerAgent(`/api/trials/${state.trialId}/representatives/${role}`, signal);
    if (!outcome.accepted) {
      state.representatives[role] = outcome.result;
      renderRepresentatives();
      return;
    }
    triggered.push(role);
  });

  if (triggered.length > 0) {
    await pollForRoles(triggered, state.representatives, renderRepresentatives, signal);
  }
}

/**
 * Reveals the Judges section with a loading card per judge, then triggers
 * the three judge calls and polls for their outcomes, exactly as
 * runRepresentativesPhase() does.
 *
 * Each judge's prompt is built server-side from whichever representative
 * arguments were saved, which is why beginTrial() only starts this once
 * the representatives phase has fully resolved.
 *
 * @param {AbortSignal} signal
 * @returns {Promise<void>}
 */
async function runJudgesPhase(signal) {
  el.phaseJudges.classList.remove('hidden');
  for (const role of JUDGE_ROLES) {
    state.judges[role] = { status: 'loading' };
  }
  renderJudges();

  const triggered = [];
  await runWithConcurrencyLimit(JUDGE_ROLES, MAX_CONCURRENT_CALLS, async (role, index) => {
    try {
      await sleep(index * CONCURRENT_CALL_STAGGER_MS, signal);
    } catch {
      state.judges[role] = { status: 'aborted', error: 'Stopped by user.' };
      renderJudges();
      return;
    }
    const outcome = await triggerAgent(`/api/trials/${state.trialId}/judges/${role}`, signal);
    if (!outcome.accepted) {
      state.judges[role] = outcome.result;
      renderJudges();
      return;
    }
    triggered.push(role);
  });

  if (triggered.length > 0) {
    await pollForRoles(triggered, state.judges, renderJudges, signal);
  }
}

/**
 * Re-reads the current trial and re-renders the call log from it, so the
 * log shows every attempt the server recorded during the run.
 *
 * @returns {Promise<boolean>} Whether the call log was loaded: false if the
 *   request failed or returned an error status, and true with no request
 *   at all when there is no current trial. Never rejects on a failed
 *   request - the caller decides how to report it.
 */
async function refreshFullTrial() {
  if (!state.trialId) return true;
  let data;
  try {
    const res = await fetch(`/api/trials/${state.trialId}`);
    if (!res.ok) return false;
    data = await res.json();
  } catch {
    return false;
  }
  // Outside the try on purpose: a rendering bug should surface as the bug
  // it is, not be reported as a call log that failed to load.
  state.callLog = data.apiCallLogs || [];
  renderCallLog();
  return true;
}

/**
 * Loads the case sheet, each role's starting model and the shared token
 * cap from /api/case, and renders the case sheet. Runs once at page load,
 * before any trial exists. Does nothing if the request returns an error
 * status.
 *
 * @returns {Promise<void>} Rejects on a network error.
 */
async function loadStaticCaseSheet() {
  const res = await fetch('/api/case');
  if (!res.ok) return;
  const data = await res.json();
  state.caseDef = data.caseDef;
  state.modelInfo = data.modelInfo || null;
  state.maxTokens = data.maxTokens || null;
  renderCaseSheet();
}

/**
 * Replaces the run-history list with a single status line.
 *
 * @param {string} message Inserted as HTML.
 * @param {boolean} showSpinner
 */
function renderHistoryPlaceholder(message, showSpinner) {
  el.historyList.innerHTML = `
    <li class="history-loading">
      ${showSpinner ? '<span class="spinner spinner-lg"></span>' : ''}
      <span>${message}</span>
    </li>
  `;
}

// This endpoint only touches Supabase, no OpenRouter/Netlify quota at
// stake, so a few quick retries on a transient failure are cheap and
// worthwhile - a brief failure here can clear a moment later (one was seen
// in local testing, with a manual test call landing on the dev server at
// the same moment as a page load), so it gets the same "self-heal before showing an alarming error"
// treatment representative/judge calls already get - just on a much
// shorter, lighter budget suited to a small metadata fetch rather than a
// real generation.
/** How many times to try GET /api/trials before showing an error. */
const HISTORY_RETRY_ATTEMPTS = 3;
/** Pause after a failed attempt, in ms, multiplied by the attempt number. */
const HISTORY_RETRY_BACKOFF_MS = 700;

/**
 * Fetches the run history and re-renders the sidebar, retrying a failed
 * fetch up to HISTORY_RETRY_ATTEMPTS times. If every attempt fails, a list
 * already on screen is left as it was, and an empty one shows an error
 * line instead.
 *
 * @returns {Promise<void>} Never rejects.
 */
async function refreshHistory() {
  // Only show the big "fetching" placeholder when there's genuinely
  // nothing to look at yet - this is what used to look frozen on a slow
  // fetch (observed taking up to ~10s on 2026-08-27, while listTrials in
  // db.ts still made its queries one after another - see the note there).
  // A refresh of an
  // already-populated list leaves the existing items on screen rather than
  // flickering them out while fresh data loads.
  if (state.history.length === 0) {
    renderHistoryPlaceholder('Fetching run history…', true);
  }

  for (let attempt = 1; attempt <= HISTORY_RETRY_ATTEMPTS; attempt++) {
    try {
      const res = await fetch('/api/trials');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      state.history = data.trials || [];
      renderHistory();
      return;
    } catch {
      if (attempt === HISTORY_RETRY_ATTEMPTS) {
        if (state.history.length === 0) {
          renderHistoryPlaceholder('Could not load run history.', false);
        }
        return;
      }
      await sleep(HISTORY_RETRY_BACKOFF_MS * attempt);
    }
  }
}

/**
 * Opens a trial from the run history: fetches it, rebuilds every card and
 * the call log from the stored record, and scrolls to the Representatives
 * section.
 *
 * Does nothing while a trial is running or another is being opened. A
 * trial that cannot be loaded - the server unreachable, or an error in
 * reply - is reported with alert().
 *
 * @param {string} trialId
 * @returns {Promise<void>} Resolves once the loading overlay and the
 *   sidebar are restored. Failed requests are reported to the user rather
 *   than rejecting it.
 */
async function loadTrial(trialId) {
  if (state.running || state.loadingTrial) return;
  state.loadingTrial = true;
  el.mainLoadingOverlay.classList.remove('hidden');
  el.sidebar.classList.add('loading-locked');
  try {
    // Same reasoning as trial creation in beginTrial(): a failure to reach
    // the server, or a reply that isn't JSON, is reported rather than left
    // to escape as an uncaught rejection that looks like an ignored click.
    let res;
    try {
      res = await fetch(`/api/trials/${trialId}`);
    } catch {
      alert(`Could not load that trial: ${SERVER_UNREACHABLE_MESSAGE}`);
      return;
    }
    const data = res.ok ? await res.json().catch(() => null) : null;
    if (!data) {
      alert('Could not load that trial.');
      return;
    }

    state.trialId = trialId;
    state.caseDef = data.caseDef;
    state.callLog = data.apiCallLogs || [];

    // Same derivation pollForRoles() uses for a live trial (see
    // deriveRoleStates) - a role with no success is backfilled with a real
    // 'failed'/'aborted' entry from its own last logged attempt rather than
    // left with no state entry at all, which would otherwise make
    // buildAgentStatusBody's generic "no entry" case the only thing shown
    // for it, even though the real error is sitting right there in the log.
    const derived = deriveRoleStates(data);
    state.representatives = derived.representatives;
    state.judges = derived.judges;

    renderCaseSheet();
    el.phaseRepresentatives.classList.toggle('hidden', Object.keys(state.representatives).length === 0);
    el.phaseJudges.classList.toggle('hidden', Object.keys(state.judges).length === 0);
    renderRepresentatives();
    renderJudges();
    renderCallLog();
    renderHistory();
    // Only after everything above has actually rendered - scrolling to a
    // section whose cards/content aren't painted yet would just land on
    // an empty or half-built page. A trial with zero representative
    // entries leaves .phaseRepresentatives hidden (display: none), where
    // scrollIntoView is already a harmless no-op - no extra guard needed
    // for that case. block: 'start', the same as the "Begin new trial"
    // scroll in beginTrial() - 'start' reads better than 'center' once
    // there's real content to read from the top of the section, per the
    // user's explicit comparison of both.
    el.phaseRepresentatives.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } finally {
    state.loadingTrial = false;
    el.mainLoadingOverlay.classList.add('hidden');
    el.sidebar.classList.remove('loading-locked');
  }
}

/**
 * Renders state.caseDef into the case-sheet section. Does nothing until
 * the case definition has loaded.
 */
function renderCaseSheet() {
  const c = state.caseDef;
  if (!c) return;
  el.caseTitle.textContent = c.title;
  el.caseAccused.textContent = c.accused;
  el.caseDeceased.textContent = c.deceased;
  el.caseActAlleged.textContent = c.actAlleged;
  // Real <p> elements with a controlled margin (see .case-background p in
  // styles.css) instead of textContent + white-space: pre-line - the raw
  // \n\n between paragraphs in the stored text rendered as a literal blank
  // line under pre-line, a full line-height taller than intended and much
  // more prominent than the neat 6px spacing the facts list below it uses
  // (real user report, screenshot). Split on \n\n rather than \n so a
  // future paragraph with a single internal line break (if ever added)
  // wouldn't be split into two separate <p> elements.
  el.caseBackground.innerHTML = '';
  for (const paragraph of c.background.split('\n\n')) {
    const p = document.createElement('p');
    p.textContent = paragraph;
    el.caseBackground.appendChild(p);
  }
  el.caseFacts.innerHTML = '';
  for (const fact of c.agreedFacts) {
    const li = document.createElement('li');
    li.textContent = fact;
    el.caseFacts.appendChild(li);
  }
  el.caseQuestion.textContent = c.question;
  el.caseScopeNote.textContent = c.scopeNote;
}

/**
 * Duration of one spinner rotation, in ms. Must match the `spin` animation
 * in styles.css - see spinnerHtml() for why, and
 * tests/shared-constants.test.js, which asserts the two agree.
 */
const SPINNER_ANIMATION_MS = 800;
/**
 * Duration of one spinner rotation under prefers-reduced-motion, in ms. Must
 * match the reduced-motion `animation-duration` in styles.css, and be a
 * whole multiple of SPINNER_ANIMATION_MS - see spinnerHtml() for why, and
 * tests/shared-constants.test.js, which asserts both.
 */
const SPINNER_REDUCED_MOTION_MS = 2400;
/**
 * Returns the markup for a spinner that looks continuous across
 * re-renders.
 *
 * Prepended to every "still waiting on a response" status below - a purely
 * visual, CSS-animated indicator (see .spinner in styles.css) that there's
 * real, ongoing activity, distinct from the text-only states (aborted,
 * failed, success) where nothing is in flight anymore.
 *
 * A CSS animation restarts from 0% whenever its element is torn down and
 * recreated, which would otherwise make a spinner visibly snap back to the
 * start on each re-render instead of appearing to spin continuously. Fix:
 * a negative animation-delay keyed to the real wall clock tells the
 * browser "this animation has already been running for X ms," so a freshly
 * created element starts at exactly the angle a continuously running one
 * would already be at.
 *
 * The rotation takes SPINNER_ANIMATION_MS normally and
 * SPINNER_REDUCED_MOTION_MS under prefers-reduced-motion, and the delay is
 * the wall clock taken modulo the longer of the two. Because that is a
 * whole multiple of the shorter one, the same delay lands on the
 * continuously-running angle at either speed, so the page never needs to
 * know which one the browser is using.
 *
 * @returns {string} HTML for one spinner element.
 */
function spinnerHtml() {
  const offset = -(Date.now() % SPINNER_REDUCED_MOTION_MS);
  return `<span class="spinner" style="animation-delay: ${offset}ms"></span>`;
}

/**
 * Builds the shared "what's happening with this call right now" block used
 * by both representative and judge cards - kept as one function so the two
 * card types can't quietly drift into showing different information for
 * the same underlying states.
 *
 * @param {AgentEntry | undefined} entry
 * @param {AgentRole} role Used to look up the starting model while no
 *   attempt has been reported yet.
 * @param {string} verb Shown while loading - 'Arguing' or 'Deliberating'.
 * @returns {HTMLDivElement | null} The status block, or null for a
 *   successful entry, whose content the caller renders itself.
 */
function buildAgentStatusBody(entry, role, verb) {
  const body = document.createElement('div');

  // No entry at all is NOT "hasn't started yet" - a live run always seeds
  // state.representatives/judges[role] with {status: 'loading'} the moment
  // it begins (see beginTrial), before this ever renders. A missing entry
  // means loadTrial() opened the trial from history and the role had no
  // final outcome in its record: deriveRoleStates() backfills a 'failed' or
  // 'aborted' entry only from a role's final row, so a role whose only
  // rows are discarded attempts has none either. That covers a trial that
  // ended without this role finishing, and one opened while it is still
  // running (from a second tab, or after reloading the page mid-run),
  // where the role may still be working. A trial opened from history is
  // shown as recorded at that moment and not polled, so the text below
  // holds in both cases, and no spinner is shown.
  if (!entry) {
    body.className = 'card-body dim';
    body.textContent = 'No result recorded for this role.';
    return body;
  }

  if (entry.status === 'loading') {
    body.className = 'card-body dim';
    // entry.currentAttempt (set by pollForRoles from agent_progress - see
    // deriveRoleStates) is written the moment each attempt actually
    // *starts*, server-side, so it reflects the model genuinely in flight
    // right now - not the model of whatever was last discarded, which is
    // always one step behind (that was the bug this replaces: the card
    // kept showing the previous, already-abandoned model while the next
    // one was the one actually generating).
    const attempt = entry.currentAttempt;
    let modelLine = '';
    if (attempt) {
      const suffix = attempt.tierMaxAttempts > 1 ? ` (${ordinalWord(attempt.attemptInTier)} attempt)` : '';
      modelLine = `<div class="model-chain">Model: <span class="model-name">${shortModelName(attempt.model)}${suffix}</span></div>`;
    } else {
      // No agent_progress row yet: the call's first attempt has not started
      // or its write has not reached the database - and a call turned away
      // before any attempt (by the site gate or the call cap) never writes
      // one. Falls back to the starting model rather than showing nothing.
      const modelId = state.modelInfo && state.modelInfo[role];
      modelLine = modelId ? `<div class="model-chain">Model: <span class="model-name">${shortModelName(modelId)}</span></div>` : '';
    }
    body.innerHTML = `${spinnerHtml()}${verb}…${modelLine}`;
    return body;
  }

  if (entry.status === 'aborted') {
    const wrap = document.createElement('div');
    const badge = document.createElement('span');
    badge.className = 'badge badge-aborted';
    badge.textContent = 'aborted';
    wrap.appendChild(badge);
    const note = document.createElement('p');
    note.className = 'card-body dim';
    note.textContent = 'Stopped by user before this could complete.';
    wrap.appendChild(note);
    return wrap;
  }

  if (entry.status === 'failed') {
    const wrap = document.createElement('div');
    const badge = document.createElement('span');
    badge.className = 'badge badge-fail';
    badge.textContent = 'call failed';
    wrap.appendChild(badge);
    const err = document.createElement('p');
    err.className = 'card-body dim';
    err.textContent = entry.error;
    wrap.appendChild(err);
    return wrap;
  }

  // Distinct from 'failed': the page stopped waiting without any outcome
  // being recorded for this role. Polling waits POLL_TIMEOUT_MS, longer
  // than a call's whole time budget, so by then a call that ran has ended,
  // and one with nothing recorded most likely never started - turned away
  // by the site gate or the call cap (see POLL_TIMEOUT_MS). See
  // pollForRoles() for what produces this status.
  if (entry.status === 'timeout') {
    const wrap = document.createElement('div');
    const badge = document.createElement('span');
    badge.className = 'badge badge-fail';
    badge.textContent = 'no result';
    wrap.appendChild(badge);
    const err = document.createElement('p');
    err.className = 'card-body dim';
    err.textContent = entry.error;
    wrap.appendChild(err);
    return wrap;
  }

  return null; // success - caller renders its own content
}

/**
 * Adds a "truncated" badge and note to a card whose result hit the token
 * cap. Does nothing otherwise.
 *
 * Shared by both card types, appended after their normal success content -
 * see isTruncated() for what actually triggers this and why it needs to be
 * derivable for both a live entry and one loaded from history.
 *
 * @param {HTMLElement} card
 * @param {AgentEntry} entry
 */
function appendTruncationNotice(card, entry) {
  if (!isTruncated(entry)) return;
  const badge = document.createElement('span');
  badge.className = 'badge badge-warn';
  badge.textContent = 'truncated';
  card.appendChild(badge);
  const note = document.createElement('p');
  note.className = 'card-body dim';
  note.textContent = `This response hit the ${state.maxTokens}-token limit and was cut off before finishing naturally.`;
  card.appendChild(note);
}

/**
 * Toggles a bottom fade (see .card-body-scroll-wrap in styles.css) on a
 * scrollable card body whenever there's real text hidden below the
 * visible area, and hides it once scrolled to the actual bottom - a
 * clearer "there's more" signal than a bare scrollbar track alone,
 * decided on explicitly (2026-09-03) over an in-place "Read full
 * response..." expand (would fight the fixed card-grid row heights this
 * same scroll region exists to keep consistent) or a modal (real added
 * complexity - backdrop, focus handling - for a benefit judged not worth
 * it here). The fade lives on bodyEl's parent (a plain sibling wrapper,
 * not a child of the scrolling element itself) specifically so it stays
 * visually pinned at the bottom of the visible box - an absolutely
 * positioned child of the SCROLLING element would scroll away along with
 * the text instead.
 *
 * @param {HTMLElement} bodyEl The scrolling text body. Its parent is the
 *   element that receives the has-more-below class, and it must already be
 *   in the document - see reconcileAgentCards().
 */
function attachScrollFade(bodyEl) {
  const wrapEl = bodyEl.parentElement;
  const SCROLL_END_EPSILON = 2; // sub-pixel/rounding tolerance
  /** Shows the fade only while there is text below the visible area. */
  function update() {
    const hasMore = bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight > SCROLL_END_EPSILON;
    wrapEl.classList.toggle('has-more-below', hasMore);
  }
  bodyEl.addEventListener('scroll', update);
  update();
}

/** Scrollbar thumb opacity at rest, as a percentage. */
const SCROLLBAR_REST_OPACITY = 15;
/**
 * Scrollbar thumb opacity while the pointer is over its container, as a
 * percentage.
 */
const SCROLLBAR_HOVER_OPACITY = 30;
/** How long a fade between those two takes, in ms. */
const SCROLLBAR_FADE_MS = 220;
/**
 * Fades a scrollbar thumb brighter while the pointer is over its
 * container, and back to rest when it leaves.
 *
 * An earlier version of this used a fixed hover-intent delay (wait, then
 * snap) to keep an incidental pointer pass from flashing the scrollbar
 * bright. That read as sluggish on a deliberate hover (real user
 * report, 2026-09-04): motion didn't start until the delay had already
 * elapsed. This drives the fade itself in JS instead - a plain
 * rAF loop writes progressively interpolated values into a CSS custom
 * property (--scrollbar-thumb-opacity, read by the color-mix() calls in
 * styles.css) every frame. Each individual frame is just an ordinary,
 * instant custom-property change, which every browser already handles
 * fine (that's exactly the mechanism the old .scrollbar-hover class swap
 * used) - repeating it ~13 times over SCROLLBAR_FADE_MS produces a real
 * smooth fade with no CSS transition or animation involved. This incidentally fixes the original flash problem better
 * than the delay did, with no artificial dead time: a quick pass only
 * reaches a small partial brightening before reversing back towards
 * rest, rather than either waiting through a delay or snapping to full
 * brightness instantly. animateTo() reverses smoothly from wherever the
 * fade currently is if the target flips mid-animation (e.g. the pointer
 * leaves while still fading in), not by restarting from rest.
 *
 * A bonus not asked for: this also gives Firefox the actual fade effect
 * for the first time - its scrollbar-color has no thumb-scoped
 * pseudo-classes for a genuine :hover-driven CSS rule to key off, but a
 * plain custom-property value it's already reading recalculates on
 * every write exactly like Chromium does, so the same JS loop works
 * identically there. The dragging tier is separate and untouched by any of
 * this - a ::-webkit-scrollbar-thumb:active rule, snapping instantly, since
 * direct-manipulation feedback to a physical mouse press arguably should
 * stay instant, not fade in. It did not render in Chrome, Edge or Firefox
 * as measured in September 2026 (Chrome 154, Edge 153, Firefox 155),
 * though - see the scrollbar comments in styles.css.
 *
 * @param {HTMLElement} el The element to watch for the pointer. The opacity
 *   is written to its --scrollbar-thumb-opacity custom property, which a
 *   scroll container inside it inherits. (Shadows the module-level `el`
 *   within this function.)
 */
function attachScrollbarFade(el) {
  let current = SCROLLBAR_REST_OPACITY;
  let target = SCROLLBAR_REST_OPACITY;
  let fadeFrom = current;
  let fadeStartedAt = null;
  let rafId = null;

  /**
   * Applies one opacity value.
   * @param {number} opacity A percentage.
   */
  function paint(opacity) {
    current = opacity;
    el.style.setProperty('--scrollbar-thumb-opacity', `${opacity}%`);
  }
  paint(current);

  /**
   * One animation frame: moves linearly from fadeFrom towards target, and
   * schedules the next frame until the fade is complete.
   * @param {DOMHighResTimeStamp} now
   */
  function tick(now) {
    if (fadeStartedAt === null) fadeStartedAt = now;
    const t = Math.min(1, (now - fadeStartedAt) / SCROLLBAR_FADE_MS);
    paint(fadeFrom + (target - fadeFrom) * t);
    rafId = t < 1 ? requestAnimationFrame(tick) : null;
  }

  /**
   * Starts a fade towards newTarget from wherever the current one has got to,
   * so a reversal mid-fade doesn't jump. A no-op if that is already the
   * target.
   * @param {number} newTarget A percentage.
   */
  function animateTo(newTarget) {
    if (newTarget === target) return;
    target = newTarget;
    fadeFrom = current;
    fadeStartedAt = null;
    if (rafId === null) rafId = requestAnimationFrame(tick);
  }

  el.addEventListener('mouseenter', () => animateTo(SCROLLBAR_HOVER_OPACITY));
  el.addEventListener('mouseleave', () => animateTo(SCROLLBAR_REST_OPACITY));
}

// #history-list itself is a stable, static element (only its children
// get rebuilt, by renderHistory()) - attached once here rather than
// per-render. Must come after SCROLLBAR_REST_OPACITY/etc. and the
// function itself are actually defined, not just after the function
// declaration (which is hoisted) - unlike a function declaration, a
// const's value doesn't exist until execution reaches its line, and
// calling attachScrollbarFade() from any earlier point in the script
// (this used to sit right after the button listeners near the top)
// throws a real ReferenceError reading those consts before they're
// initialised. Real bug, caught live (2026-09-04): the page failed to
// load at all, not just a visual glitch.
attachScrollbarFade(el.historyList);

/**
 * Returns a compact description of exactly the state a card was rendered
 * from. Two cards with the same signature would render byte-identically,
 * so a card whose signature hasn't changed can be left on screen untouched.
 *
 * Deliberately built from state rather than from the generated HTML: the
 * loading card's spinner embeds a wall-clock-derived animation-delay (see
 * spinnerHtml) that differs on every single render, so comparing markup
 * would never match and would defeat the whole point.
 *
 * state.trialId is included so that starting or opening a different trial
 * always rebuilds every card, rather than relying on the new trial's
 * per-role state happening to differ from the old one's.
 *
 * @param {AgentEntry | undefined} entry
 * @param {AgentRole} role
 * @returns {string}
 */
function agentCardSignature(entry, role) {
  const trial = state.trialId || '';
  if (!entry) return `${trial}|none`;
  if (entry.status === 'success') {
    return [
      trial,
      'success',
      entry.verdict || '',
      entry.modelUsed || '',
      isTruncated(entry) ? 'truncated' : '',
      // The full text, not a length or a prefix: it is fixed once a result
      // lands, and comparing it outright removes any chance of a changed
      // body being mistaken for an unchanged one.
      entry.argumentText || entry.reasoningText || '',
    ].join('|');
  }
  if (entry.status === 'loading') {
    const attempt = entry.currentAttempt;
    const progress = attempt
      ? `${attempt.model}#${attempt.tierIndex}#${attempt.attemptInTier}#${attempt.tierMaxAttempts}`
      : `default#${(state.modelInfo && state.modelInfo[role]) || ''}`;
    return [trial, 'loading', progress].join('|');
  }
  return [trial, entry.status, entry.error || ''].join('|');
}

/**
 * Replaces only the cards whose rendered state actually changed, leaving
 * every other card's DOM node exactly where it is.
 *
 * This fixes a real, long-standing annoyance: the render functions used to
 * start with `container.innerHTML = ''` and rebuild every card in the
 * phase, so a poll tick that advanced ONE agent's model/attempt line tore
 * down and recreated all of its siblings too - including cards already
 * showing a finished argument, which visibly flashed. Nothing about one
 * agent escalating requires touching another agent's card.
 *
 * Keeping untouched nodes alive also fixes two quieter side effects of the
 * old approach: a card's scroll position inside a long argument no longer
 * resets mid-read, and its already-attached fade/scrollbar listeners are
 * not repeatedly torn off and re-added.
 *
 * @param {HTMLElement} container The phase's card grid.
 * @param {AgentRole[]} roles In display order - one card per role.
 * @param {(role: AgentRole) => (AgentEntry | undefined)} entryFor
 * @param {(role: AgentRole, entry: AgentEntry | undefined) => BuiltCard} buildCard
 */
function reconcileAgentCards(container, roles, entryFor, buildCard) {
  roles.forEach((role, index) => {
    const entry = entryFor(role);
    const signature = agentCardSignature(entry, role);
    const existing = container.children[index];
    if (existing && existing.dataset.cardRole === role && existing.dataset.cardSignature === signature) {
      return;
    }

    const { card, scrollBody } = buildCard(role, entry);
    card.dataset.cardRole = role;
    card.dataset.cardSignature = signature;
    if (existing) container.replaceChild(card, existing);
    else container.appendChild(card);

    // Needs real layout to measure scrollHeight/clientHeight against, so
    // this can only run once the card is actually attached to the
    // document - a detached element (mid-build, before the insertion
    // above) has no box model at all, and both would just read 0.
    if (scrollBody) attachScrollFade(scrollBody);
  });

  // Defensive only - the role lists are fixed, so this should never fire.
  while (container.children.length > roles.length) {
    container.removeChild(container.lastElementChild);
  }
}

/**
 * Builds one representative's card: name and seat, then either the
 * argument or the call's current status.
 *
 * @param {RepresentativeRole} role
 * @param {AgentEntry | undefined} entry
 * @returns {BuiltCard}
 */
function buildRepresentativeCard(role, entry) {
  const meta = REPRESENTATIVE_META[role];
  const card = document.createElement('div');
  card.className = 'card';
  // Attached per built card, which is now only when that card's own state
  // actually changed - not on every render of the phase.
  attachScrollbarFade(card);

  const header = document.createElement('div');
  header.className = 'card-header';
  header.innerHTML = `
      <span class="card-name">${meta.name}</span>
      <span class="card-seat ${meta.seat}">${meta.seat}</span>
    `;
  card.appendChild(header);

  let scrollBody = null;
  if (entry && entry.status === 'success') {
    const bodyWrap = document.createElement('div');
    bodyWrap.className = 'card-body-scroll-wrap';
    const body = document.createElement('div');
    body.className = 'card-body card-body-scroll';
    body.textContent = entry.argumentText;
    bodyWrap.appendChild(body);
    card.appendChild(bodyWrap);
    scrollBody = body;
    const answeredBy = document.createElement('p');
    answeredBy.className = 'model-chain';
    answeredBy.innerHTML = `Answered by: <span class="model-name">${shortModelName(entry.modelUsed)}</span>`;
    card.appendChild(answeredBy);
    appendTruncationNotice(card, entry);
  } else {
    const statusBody = buildAgentStatusBody(entry, role, 'Arguing');
    if (statusBody) card.appendChild(statusBody);
  }
  return { card, scrollBody };
}

/**
 * Brings the representative cards up to date with state.representatives,
 * rebuilding only the cards whose state changed.
 */
function renderRepresentatives() {
  reconcileAgentCards(el.representativeCards, REPRESENTATIVE_ROLES, (role) => state.representatives[role], buildRepresentativeCard);
}

/**
 * Shows the banner above the judges' cards when any representative
 * argument is missing, naming which, and hides it otherwise.
 *
 * runJudgesPhase() starts only once runRepresentativesPhase() has an
 * outcome for every role - success, failure, abort, or 'timeout', the page
 * giving up waiting - and each judge's prompt carries the arguments saved
 * by the time that judge starts (see buildJudgeMessages in prompts.ts,
 * which marks a missing seat "[argument unavailable]" rather than
 * fabricating or silently omitting it). A representative call that runs
 * has finished, and saved any argument, before the page stops waiting on
 * it: polling waits POLL_TIMEOUT_MS (700s), longer than the 650s budget a
 * call runs within. So all three judges in a run see the same set of
 * arguments, the set state.representatives records, live or historical.
 * That's what makes a single banner above all three cards correct, rather
 * than a per-judge-card note or any new stored data.
 *
 * "Missing" means no saved argument, whatever the reason: a call that
 * failed (a reply rejected as truncated or degenerate included), was
 * aborted, or never ran.
 */
function updateJudgesCaveat() {
  const missing = REPRESENTATIVE_ROLES.filter(
    (role) => !(state.representatives[role] && state.representatives[role].status === 'success')
  );

  if (missing.length === 0) {
    el.judgesCaveat.classList.add('hidden');
    el.judgesCaveat.textContent = '';
    return;
  }

  const available = REPRESENTATIVE_ROLES.length - missing.length;
  const names = missing.map((role) => REPRESENTATIVE_META[role].name).join(', ');
  el.judgesCaveat.textContent = `Reached with ${available} of ${REPRESENTATIVE_ROLES.length} representative arguments available (none from ${names}) - see Representatives above.`;
  el.judgesCaveat.classList.remove('hidden');
}

/**
 * Builds one judge's card: name, then either the verdict and reasoning or
 * the call's current status.
 *
 * @param {JudgeRole} role
 * @param {AgentEntry | undefined} entry
 * @returns {BuiltCard}
 */
function buildJudgeCard(role, entry) {
  const meta = JUDGE_META[role];
  const card = document.createElement('div');
  card.className = 'card';
  // See the matching note in buildRepresentativeCard.
  attachScrollbarFade(card);

  const header = document.createElement('div');
  header.className = 'card-header';
  header.innerHTML = `<span class="card-name">${meta.name}</span>`;
  card.appendChild(header);

  let scrollBody = null;
  if (entry && entry.status === 'success') {
    const verdict = document.createElement('p');
    verdict.className = entry.verdict === 'justified' ? 'verdict-justified' : 'verdict-not-justified';
    verdict.textContent = entry.verdict === 'justified' ? 'Justified' : 'Not justified';
    card.appendChild(verdict);

    const bodyWrap = document.createElement('div');
    bodyWrap.className = 'card-body-scroll-wrap';
    const body = document.createElement('div');
    body.className = 'card-body card-body-scroll';
    body.textContent = entry.reasoningText;
    bodyWrap.appendChild(body);
    card.appendChild(bodyWrap);
    scrollBody = body;

    const answeredBy = document.createElement('p');
    answeredBy.className = 'model-chain';
    answeredBy.innerHTML = `Answered by: <span class="model-name">${shortModelName(entry.modelUsed)}</span>`;
    card.appendChild(answeredBy);
    appendTruncationNotice(card, entry);
  } else {
    const statusBody = buildAgentStatusBody(entry, role, 'Deliberating');
    if (statusBody) card.appendChild(statusBody);
  }
  return { card, scrollBody };
}

/**
 * Brings the judge cards and the missing-arguments banner up to date with
 * state.
 */
function renderJudges() {
  reconcileAgentCards(el.judgeCards, JUDGE_ROLES, (role) => state.judges[role], buildJudgeCard);
  updateJudgesCaveat();
}

/**
 * Formats a dollar cost in cents, to two decimal places: 0.000162 ->
 * "0.02¢".
 *
 * Shown in cents rather than dollars - real per-call cost on a paid model
 * is a small fraction of a cent, and "$0.0001" (four decimal places, to
 * stay meaningful rather than rounding down to indistinguishable-from-
 * zero) was both visually noisy and, at the call log's column widths,
 * prone to wrapping mid-number. Two decimal places of a cent is the same
 * real precision as four decimal places of a dollar (the database itself
 * still stores full, unrounded precision regardless of what's shown
 * here) in two fewer characters.
 *
 * @param {number} cost In US dollars.
 * @returns {string}
 */
function formatCost(cost) {
  return `${(Number(cost) * 100).toFixed(2)}¢`;
}

/**
 * Returns a role's display name for the call log's Agent column.
 *
 * "Grey Worm" instead of "grey_worm" - REPRESENTATIVE_META already has the
 * proper display name for the four representatives; judges are single
 * words, so plain capitalisation gives "Barak"/"Elon"/"Shamgar" directly
 * (deliberately not JUDGE_META's name, which is "Judge — Barak method" -
 * too long for this column and redundant with the Type column showing
 * "J" already). Also means text wraps at the space in a name like
 * "Daenerys Targaryen" instead of breaking mid-word inside
 * "daenerys_targaryen".
 *
 * @param {string} role
 * @returns {string}
 */
function formatAgentName(role) {
  if (REPRESENTATIVE_META[role]) return REPRESENTATIVE_META[role].name;
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/**
 * Formats a duration as "12,345 ms", or a dash when none was recorded.
 *
 * null on a row that timed no attempt - the abort endpoint's rows, and a
 * call that ended before starting an attempt - and on rows
 * logged before the duration_ms column existed (see ApiCallLogRecord in
 * types.ts). Shown as a plain dash rather than a fabricated 0, which would
 * misleadingly read as an instant response.
 *
 * @param {number | null | undefined} durationMs
 * @returns {string}
 */
function formatDuration(durationMs) {
  if (durationMs === null || durationMs === undefined) return '—';
  return `${Math.round(durationMs).toLocaleString()} ms`;
}

/**
 * Rebuilds the call log table from state.callLog - one row per logged
 * attempt, discarded retries included - followed by its totals row, or
 * hides the section while the log is empty.
 */
function renderCallLog() {
  if (state.callLog.length === 0) {
    el.phaseLog.classList.add('hidden');
    el.callLogFoot.innerHTML = '';
    return;
  }
  el.phaseLog.classList.remove('hidden');
  el.callLogBody.innerHTML = '';
  for (const entry of state.callLog) {
    const tr = document.createElement('tr');
    const err = entry.errorMessage || '';
    // A discarded attempt (truncated/degenerated, then retried at the
    // same tier or escalated to the next one) gets its own row, tagged
    // with one of the two "retried" markers - see the DEGENERATE_*_MARKER
    // comment above. A row tagged with the "final" marker instead means
    // the chain had nothing left to try - the last tier, or no time budget
    // for another - and this attempt was *also* truncated/degenerate: a
    // genuinely fatal outcome, not a recovered one, so it's styled
    // distinctly (red, full opacity, no retry caption) rather than folded
    // into the same "still recovering" look.
    const isRetriedSameModel = err.startsWith(DEGENERATE_RETRIED_SAME_MODEL_MARKER);
    const isRetriedDiffModel = err.startsWith(DEGENERATE_RETRIED_DIFF_MODEL_MARKER);
    const isDegenerateRetried = isRetriedSameModel || isRetriedDiffModel;
    const isDegenerateFinal = err.startsWith(DEGENERATE_FINAL_MARKER);
    // A tier's model rejected the request outright (e.g. a removed model
    // id) and the chain escalated to the next tier - see
    // HTTP_ERROR_ESCALATED_MARKER's own comment above. Always an
    // escalation to a different model, never a same-model retry (unlike
    // the degenerate/truncation case), since retrying the exact same
    // broken model id has no plausible upside.
    const isHttpErrorEscalated = err.startsWith(HTTP_ERROR_ESCALATED_MARKER);
    // A transient failure (timeout/408/429/5xx/empty or cut-short reply)
    // that was retried or escalated. These are the rows that did not exist at all before
    // 2026-09-20 - the retry branches used to loop silently, which is
    // exactly why a six-minute stall left nothing to read here afterwards.
    const isTransientRetried = err.startsWith(TRANSIENT_RETRIED_MARKER);
    const isAbortedMidCall = err.startsWith(ABORTED_MID_CALL_MARKER);
    // The row the abort endpoint writes for each role still pending when
    // Abort is clicked. It records the request to stop, not a model call -
    // no model, no tokens - so it is shown as that, in the same grey as the
    // sidebar's aborted badge, rather than as a red failure.
    const isAbortRequest = entry.errorMessage === ABORTED_BY_USER_MESSAGE;
    // The content-quality markers cover two different ways an attempt
    // ends, and calling both of them "degenerated" was inaccurate:
    // one ran into the token cap, the other did not and a detector flagged
    // it. (The capped kind is usually a repetition loop
    // too - see the NAMING note in openrouter.ts - but the cap, not a
    // detector, is what stopped it.) openrouter.ts writes this exact phrase
    // for the cap case (and quotes the offending text instead for the two
    // degeneration detectors), so it is the honest discriminator between
    // them. Same literal-string coupling as the markers themselves.
    const hitTokenCap = err.includes('max_tokens limit');

    if (isDegenerateRetried || isHttpErrorEscalated || isTransientRetried || isAbortRequest) {
      // Dims the whole row: a failure that wasn't fatal, the same call
      // likely going on to succeed on a later row, or the record of an abort
      // request, which the role's own last row follows.
      tr.classList.add('row-dimmed');
    }

    // A response still truncated after every attempt the escalation chain
    // allows is a real failure (openrouter.ts), shown via the status column
    // below. This badge marks the success rows logged before that change
    // whose completion is a whole multiple of the cap (1x from a
    // single-attempt truncation, or 2x from a retry that also truncated) -
    // see isLegacyTruncation().
    const wasTruncated = entry.status === 'success' && isLegacyTruncation(entry.completionTokens, entry.timestamp);
    // Total leads, as the one figure to read at a glance; prompt/completion
    // break it down underneath - the split that cost (priced separately for
    // each) and the token cap (on completion tokens only) turn on - in the
    // same dim, secondary-line treatment status-caption already uses for
    // "why" text, rather than three equally-weighted numbers.
    const tokens = `
      <div class="cell-stack">
        <strong>${entry.totalTokens.toLocaleString()}</strong>
        <div class="status-caption">${formatTokenBreakdown(entry.promptTokens, entry.completionTokens)}</div>
      </div>
    `;

    let statusCellHtml;
    if (isAbortRequest) {
      statusCellHtml = `<span class="badge badge-aborted">abort requested</span>`;
    } else if (isDegenerateRetried) {
      const caption = isRetriedSameModel ? 'retried with the same model' : 'escalated to a different model';
      statusCellHtml = `
        <div class="cell-stack">
          <span class="badge badge-warn">${hitTokenCap ? 'truncated' : 'degenerated'}</span>
          <div class="status-caption">(${caption})</div>
        </div>
      `;
    } else if (isHttpErrorEscalated) {
      statusCellHtml = `
        <div class="cell-stack">
          <span class="badge badge-warn">escalated</span>
          <div class="status-caption">(model error, escalated to a different model)</div>
        </div>
      `;
    } else if (isTransientRetried) {
      // One marker covers both moves here, unlike the content-quality pair
      // above, so the caption reads which one it was from the message's end.
      const caption = isEscalationMessage(err) ? 'escalated to a different model' : 'retried with the same model';
      statusCellHtml = `
        <div class="cell-stack">
          <span class="badge badge-warn">no response</span>
          <div class="status-caption">(${caption})</div>
        </div>
      `;
    } else if (isAbortedMidCall) {
      // The call's last row after an abort: it stopped before an attempt, an
      // attempt that failed was not retried, or a reply that finished was
      // not saved (see ABORTED_MID_CALL_MARKER in openrouter.ts). The row's
      // message, shown on the agent's card, says which; the caption fits
      // all three.
      statusCellHtml = `
        <div class="cell-stack">
          <span class="badge badge-warn">aborted</span>
          <div class="status-caption">(the user aborted the trial)</div>
        </div>
      `;
    } else if (isDegenerateFinal) {
      // Red, not yellow - the chain has nothing left to fall back to: the
      // last tier failed too, or the time budget ran out before another
      // tier could be tried. As with any failure that ends a call, what makes
      // this red is that the chain is out of options, not what the attempt
      // cost.
      statusCellHtml = `<span class="badge badge-fail">${hitTokenCap ? 'truncated' : 'degenerated'}</span>`;
    } else {
      const statusBadge = entry.status === 'success' ? 'badge-ok' : 'badge-fail';
      statusCellHtml = `
        <span class="badge ${statusBadge}">${entry.status}</span>
        ${wasTruncated ? '<span class="badge badge-warn">truncated</span>' : ''}
      `;
    }

    // data-label carries each column's header down to the narrow card
    // layout, where the real <thead> is hidden and every cell prints its
    // own label instead (see the max-width: 720px block in styles.css).
    // Keeping it in the markup rather than duplicating the header list in
    // CSS means the two can't drift apart.
    tr.innerHTML = `
      <td data-label="Agent">${formatAgentName(entry.agentRole)}</td>
      <td data-label="Type">${formatCallTypeHtml(entry.callType)}</td>
      <td data-label="Model">${formatModelCellHtml(entry.modelUsed)}</td>
      <td data-label="Tokens">${tokens}</td>
      <td data-label="Cost">${formatCost(entry.cost)}</td>
      <td data-label="Duration">${formatDuration(entry.durationMs)}</td>
      <td data-label="Status">${statusCellHtml}</td>
      <td data-label="Time">${formatDateTimeHtml(entry.timestamp)}</td>
    `;
    el.callLogBody.appendChild(tr);
  }

  renderCallLogTotals();
}

/**
 * Renders the call log's totals row.
 *
 * Sums every real logged attempt shown above - including discarded
 * retries/escalations, not just the kept final row per role, since those
 * discarded attempts are genuinely-spent cost/tokens too (see
 * onDiscardedAttempt in openrouter.ts). Duration is summed the same way,
 * which reports total compute time across every attempt, not wall-clock
 * elapsed time for the trial - representatives/judges within a phase run
 * concurrently, so those two numbers are expected to differ; the label
 * below says "compute time" specifically to avoid implying otherwise.
 * A row with no duration (see formatDuration) is skipped in this sum
 * rather than treated as 0: it timed no attempt, or predates the
 * duration_ms column.
 */
function renderCallLogTotals() {
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;
  let totalCost = 0;
  let totalDurationMs = 0;
  let hasDuration = false;

  for (const entry of state.callLog) {
    totalPromptTokens += entry.promptTokens || 0;
    totalCompletionTokens += entry.completionTokens || 0;
    totalTokens += entry.totalTokens || 0;
    totalCost += entry.cost || 0;
    if (entry.durationMs !== null && entry.durationMs !== undefined) {
      totalDurationMs += entry.durationMs;
      hasDuration = true;
    }
  }

  const tr = document.createElement('tr');
  tr.className = 'call-log-total-row';
  // The first and last cells are the totals row's own title and footnote
  // rather than real columns, so they get no data-label - in the narrow
  // card layout they read as a heading and a caption instead of as
  // labelled fields. See renderCallLog() above for what data-label does.
  tr.innerHTML = `
    <td colspan="3" class="total-row-title">Total (${state.callLog.length} call${state.callLog.length === 1 ? '' : 's'})</td>
    <td data-label="Tokens">
      <div class="cell-stack">
        <strong>${totalTokens.toLocaleString()}</strong>
        <div class="status-caption">${formatTokenBreakdown(totalPromptTokens, totalCompletionTokens)}</div>
      </div>
    </td>
    <td data-label="Cost">${formatCost(totalCost)}</td>
    <td data-label="Duration">${hasDuration ? formatDuration(totalDurationMs) : '—'}</td>
    <td colspan="2" class="status-caption total-row-note">(compute time, not wall clock)</td>
  `;
  el.callLogFoot.innerHTML = '';
  el.callLogFoot.appendChild(tr);
}

/**
 * How old a trial that never completed must be before the sidebar calls
 * it "interrupted" rather than "in progress".
 *
 * This once assumed TOTAL_BUDGET_MS (openrouter.ts) was ~26s, and so that a
 * whole trial finishes in a few minutes. TOTAL_BUDGET_MS is now sized for
 * the full 4-tier escalation chain, so the genuine worst case is the
 * representatives phase lasting as long as the page polls for it
 * (POLL_TIMEOUT_MS, a little longer than the budget), then the judges phase
 * running out its own budget in full. Both phases run all of their roles
 * concurrently - the representatives are not a 3-slot pool that makes the
 * 4th wait for a free slot (see the comment on MAX_CONCURRENT_CALLS above).
 * Kept at 40 minutes: real margin above that, so a trial that's actually
 * still working - however slowly - doesn't get mislabelled "interrupted" in
 * the history sidebar before it's had a real chance to finish.
 * tests/shared-constants.test.js keeps it above POLL_TIMEOUT_MS plus
 * TOTAL_BUDGET_MS.
 */
const INTERRUPTED_THRESHOLD_MS = 40 * 60 * 1000;

/**
 * How many results a complete trial has: one per representative and one
 * per judge.
 *
 * What the sidebar's status label is based on: whether the trial's final,
 * persisted results are actually incomplete - NOT whether any individual
 * call ever logged a failure along the way. A transient failure that the
 * server-side retry recovers from within its own budget is a real, logged
 * attempt that simply isn't the final outcome - a label driven by
 * hadFailures would flag a run like that as tainted even though the
 * result is complete and correct. The call log table still
 * shows every real attempt, success or failure, in full; this only changes
 * what the one-line sidebar summary reports.
 */
const TOTAL_EXPECTED_RESULTS = REPRESENTATIVE_ROLES.length + JUDGE_ROLES.length;

/**
 * Returns the status shown for a trial in the run-history sidebar - one of
 * "completed", "completed — missing N of 7", "aborted", "aborted (N of 7
 * completed)", "interrupted" or "in progress…".
 *
 * @param {TrialSummary} trial
 * @returns {string}
 */
function trialStatusLabel(trial) {
  const missing = TOTAL_EXPECTED_RESULTS - (trial.resultCount ?? 0);
  if (trial.wasAborted) {
    return trial.status === 'completed' ? `aborted (${trial.resultCount ?? 0} of ${TOTAL_EXPECTED_RESULTS} completed)` : 'aborted';
  }
  if (trial.status === 'completed') {
    return missing > 0 ? `completed — missing ${missing} of ${TOTAL_EXPECTED_RESULTS}` : 'completed';
  }
  const ageMs = Date.now() - new Date(trial.createdAt).getTime();
  if (ageMs > INTERRUPTED_THRESHOLD_MS) {
    return 'interrupted';
  }
  return 'in progress…';
}

/**
 * Returns the badge class for the status trialStatusLabel() gives the
 * same trial.
 *
 * @param {TrialSummary} trial
 * @returns {string}
 */
function trialStatusClass(trial) {
  const missing = TOTAL_EXPECTED_RESULTS - (trial.resultCount ?? 0);
  if (trial.wasAborted) {
    return 'badge-aborted';
  }
  if (trial.status === 'completed') {
    return missing > 0 ? 'badge-warn' : 'badge-ok';
  }
  const ageMs = Date.now() - new Date(trial.createdAt).getTime();
  if (ageMs > INTERRUPTED_THRESHOLD_MS) {
    return 'badge-fail';
  }
  return 'badge-progress';
}

/**
 * Rebuilds the run-history sidebar from state.history, marking the trial
 * currently shown as active.
 */
function renderHistory() {
  el.historyList.innerHTML = '';
  // innerHTML above doesn't touch classList, so running-locked would
  // already survive a rebuild regardless - this just makes that
  // self-evident rather than relying on it as an unstated invariant.
  updateHistoryLockState();
  for (const trial of state.history) {
    const li = document.createElement('li');
    li.className = 'history-item' + (trial.id === state.trialId ? ' active' : '');
    li.innerHTML = `
      <div class="history-item-date">${formatDateTime(trial.createdAt)}</div>
      <span class="badge ${trialStatusClass(trial)}">${trialStatusLabel(trial)}</span>
    `;
    li.addEventListener('click', () => loadTrial(trial.id));
    el.historyList.appendChild(li);
  }
}

loadStaticCaseSheet();
refreshHistory();
