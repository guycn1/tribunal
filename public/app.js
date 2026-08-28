const REPRESENTATIVE_ROLES = ['jon_snow', 'tyrion_lannister', 'daenerys_targaryen', 'grey_worm'];
const JUDGE_ROLES = ['barak', 'elon', 'shamgar'];

// Must match ABORTED_BY_USER_MESSAGE in netlify/functions/lib/db.ts exactly
// - used to recognize an aborted call's log row when rebuilding history
// (see loadTrial) so it renders with the distinct "Aborted" badge instead
// of the generic "Call failed" one.
const ABORTED_BY_USER_MESSAGE = 'Aborted by user before this call could complete.';

// Sent as the X-Site-Gate header on every call that creates a trial or
// spends OpenRouter quota (see isSiteGateOk in
// netlify/functions/lib/siteGate.ts). This is NOT a real secret and isn't
// meant to be one - it's shipped in this public, unauthenticated file, so
// anyone who looks can read it. Its only job is to reject automated
// traffic that never loaded this page at all; a caller who did look
// defeats it trivially. Must match the SITE_GATE_TOKEN environment
// variable configured on the Netlify Functions side exactly, or every
// gated call fails with 401 - if that env var is left unset there,
// isSiteGateOk() fails open (allows everything through) rather than
// locking out real users, so this constant being "wrong" server-side is a
// silent no-op, not an outage.
const SITE_GATE_TOKEN = 'g8YdtIo_-n2zLFDsgWqqfuQmVKaNsHQaQtruTybqlvY';
const SITE_GATE_HEADERS = { 'X-Site-Gate': SITE_GATE_TOKEN };

const REPRESENTATIVE_META = {
  jon_snow: { name: 'Jon Snow', seat: 'defense' },
  tyrion_lannister: { name: 'Tyrion Lannister', seat: 'defense' },
  daenerys_targaryen: { name: 'Daenerys Targaryen', seat: 'prosecution' },
  grey_worm: { name: 'Grey Worm', seat: 'prosecution' },
};

const JUDGE_META = {
  barak: { name: 'Judge — Barak method' },
  elon: { name: 'Judge — Elon method' },
  shamgar: { name: 'Judge — Shamgar method' },
};

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
  abortController: null,
};

const el = {
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
};

el.newTrialBtn.addEventListener('click', () => {
  beginTrial();
});

el.abortBtn.addEventListener('click', () => {
  abortCurrentTrial();
});

// Explicit European format (DD/MM/YYYY, 24-hour) regardless of the
// browser's own locale - bare toLocaleString() would otherwise follow
// whatever the browser is configured to (commonly US-style M/D/YYYY,
// 12-hour with AM/PM), which is not what's wanted here.
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

// The date and time deliberately go on their own lines, not just as a
// narrow-viewport fallback - fitting "DD/MM/YYYY, HH:MM:SS" on one line
// needs real column width, while the wider of the two fragments alone
// ("DD/MM/YYYY,") needs much less, freeing width for other columns. Each
// fragment is wrapped in its own non-wrapping span so the date and the
// time are each protected from ever breaking internally - only the space
// between them (the line break) is allowed to give.
function formatDateTimeHtml(dateInput) {
  const [datePart, timePart] = formatDateTime(dateInput).split(', ');
  return `<span class="datetime-part">${datePart},</span><br /><span class="datetime-part">${timePart}</span>`;
}

// "mistralai/mistral-small-24b-instruct-2501" -> "mistral-small-24b-instruct-2501"
// Strips any "provider/" prefix and a trailing ":free" suffix, if present -
// display only, the full id is what's actually sent to the backend/OpenRouter.
function shortModelName(modelId) {
  if (!modelId) return 'unknown model';
  return modelId.replace(/^[^/]+\//, '').replace(/:free$/, '');
}

// True when a successful call's completion hit the shared token cap
// (state.maxTokens, from /api/case) rather than finishing naturally - the
// server already logs this distinctly via finish_reason (see openrouter.ts),
// but that's only visible in the terminal; this is what makes it visible
// here too. Works for both a live entry (tokens included directly in the
// success response) and a historical one loaded from a past trial (see
// loadTrial(), which backfills tokens.completion from the matching
// api_call_logs row for exactly this purpose).
function isTruncated(entry) {
  return Boolean(
    entry &&
      entry.status === 'success' &&
      state.maxTokens &&
      entry.tokens &&
      entry.tokens.completion === state.maxTokens
  );
}

async function beginTrial() {
  if (state.running) return;
  state.running = true;
  el.newTrialBtn.disabled = true;
  el.abortBtn.classList.remove('hidden');
  const controller = new AbortController();
  state.abortController = controller;

  try {
    const res = await fetch('/api/trials', { method: 'POST', headers: SITE_GATE_HEADERS });
    const data = await res.json();
    if (!res.ok) {
      alert(`Failed to create trial: ${data.error || res.status}`);
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

    await runRepresentativesPhase(controller.signal);
    if (!controller.signal.aborted) {
      await runJudgesPhase(controller.signal);
    }
    await refreshFullTrial();
    await refreshHistory();
  } finally {
    state.running = false;
    state.abortController = null;
    el.newTrialBtn.disabled = false;
    el.abortBtn.classList.add('hidden');
  }
}

// Records which roles were still pending, tells the in-flight calls to stop,
// gives immediate visual feedback (doesn't wait on the network round trip
// below), then persists the abort as a real, visible fact so the sidebar
// reflects it later too - not just for this page view. Persisting matters
// because aborting a fetch() client-side does not reliably stop the Netlify
// invocation it was talking to, so without a persisted record a stray
// success/failure logged after the fact could make an aborted run look
// like an ordinary one.
async function abortCurrentTrial() {
  if (!state.abortController || !state.trialId) return;

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
}

// In one real run, all 4 representative calls fired at the exact same
// instant and only the first came back with real content — the other 3
// (and, separately, all 3 concurrently-fired judges) failed. A small stagger
// between kickoffs avoids bursting the provider with simultaneous requests
// from the same account while every call still runs concurrently with the
// others (none waits for a prior one to finish) — still "in parallel" in
// the sense that matters, just not all launched in the same instant.
const CONCURRENT_CALL_STAGGER_MS = 400;

// Abort-aware: rejects immediately (rather than waiting out the delay) if
// the signal fires mid-wait, so Abort actually stops things promptly even
// during a stagger or backoff pause, not just between HTTP requests.
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

// Netlify's platform kills a standard function invocation at ~30s
// regardless of anything our own code does (measured directly), so a
// single server call is itself internally retried against a time budget
// (see TOTAL_BUDGET_MS in openrouter.ts, ~26s) rather than trying to retry
// from the browser across several separate invocations - the previous
// design of this function did exactly that, which made sense while
// transient failures were frequent enough to need several fresh attempts
// in a row, but adds real complexity that isn't earning its keep once the
// server-side budget alone is expected to cover the normal case.
//
// So this makes exactly one request and reports whatever comes back,
// success or failure - no client-driven retry loop, no separate fallback
// model, no elapsed-time countdown to render while waiting.
async function callAgent(url, signal) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', signal, headers: SITE_GATE_HEADERS });
  } catch (err) {
    // A genuine network-level failure - offline, DNS, connection refused,
    // or the AbortController firing. Nothing came back at all, so there's
    // no response to inspect.
    if ((err && err.name === 'AbortError') || (signal && signal.aborted)) {
      return { status: 'aborted', error: 'Stopped by user.' };
    }
    return { status: 'failed', error: String(err) };
  }

  let data;
  try {
    data = await res.json();
  } catch {
    // A response DID come back, but its body wasn't the JSON this app's
    // own functions always return. The one real way that happens is
    // Netlify's own per-IP rate limiter (see the rateLimit config on
    // representative.ts/judge.ts) blocking the request before this app's
    // function code ever runs, returning a plain error page instead -
    // give a specific, honest reason for that recognizable case rather
    // than surfacing a raw "Unexpected token" parse error, and a
    // generic-but-still-honest one for any other unrecognized non-JSON
    // response.
    data = {
      status: 'failed',
      error:
        res.status === 429
          ? "Too many requests from this network in a short time (Netlify's own per-IP rate limit, separate from this app's own call cap). Wait a few minutes and try again."
          : `Server returned an unexpected non-JSON response (HTTP ${res.status}).`,
    };
  }

  if (res.ok && data.status !== 'failed') {
    return { status: 'success', ...data };
  }

  return { status: 'failed', error: data.error || `HTTP ${res.status}` };
}

async function runRepresentativesPhase(signal) {
  for (const role of REPRESENTATIVE_ROLES) {
    state.representatives[role] = { status: 'loading' };
  }
  renderRepresentatives();

  await Promise.allSettled(
    REPRESENTATIVE_ROLES.map(async (role, index) => {
      try {
        await sleep(index * CONCURRENT_CALL_STAGGER_MS, signal);
      } catch {
        state.representatives[role] = { status: 'aborted', error: 'Stopped by user.' };
        renderRepresentatives();
        return;
      }
      const result = await callAgent(`/api/trials/${state.trialId}/representatives/${role}`, signal);
      state.representatives[role] = result;
      renderRepresentatives();
    })
  );
}

async function runJudgesPhase(signal) {
  el.phaseJudges.classList.remove('hidden');
  for (const role of JUDGE_ROLES) {
    state.judges[role] = { status: 'loading' };
  }
  renderJudges();

  await Promise.allSettled(
    JUDGE_ROLES.map(async (role, index) => {
      try {
        await sleep(index * CONCURRENT_CALL_STAGGER_MS, signal);
      } catch {
        state.judges[role] = { status: 'aborted', error: 'Stopped by user.' };
        renderJudges();
        return;
      }
      const result = await callAgent(`/api/trials/${state.trialId}/judges/${role}`, signal);
      state.judges[role] = result;
      renderJudges();
    })
  );
}

async function refreshFullTrial() {
  if (!state.trialId) return;
  const res = await fetch(`/api/trials/${state.trialId}`);
  if (!res.ok) return;
  const data = await res.json();
  state.callLog = data.apiCallLogs || [];
  renderCallLog();
}

async function loadStaticCaseSheet() {
  const res = await fetch('/api/case');
  if (!res.ok) return;
  const data = await res.json();
  state.caseDef = data.caseDef;
  state.modelInfo = data.modelInfo || null;
  state.maxTokens = data.maxTokens || null;
  renderCaseSheet();
}

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
// worthwhile - a fetch failure here is much more likely to be a passing
// blip (a real one was observed: this exact local dev setup is documented
// to occasionally contend when many requests hit the same long-running
// process, e.g. a manual test call landing at the same moment as a page
// load) than a persistent problem, so it deserves the same "self-heal
// before showing an alarming error" treatment representative/judge calls
// already get - just on a much shorter, lighter budget suited to a small
// metadata fetch rather than a real generation.
const HISTORY_RETRY_ATTEMPTS = 3;
const HISTORY_RETRY_BACKOFF_MS = 700;

async function refreshHistory() {
  // Only show the big "fetching" placeholder when there's genuinely
  // nothing to look at yet - this is what was looking frozen on a slow
  // fetch (observed up to ~10s, likely Supabase round-trip time, see the
  // query-shape note on listTrials in db.ts). A refresh of an
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

async function loadTrial(trialId) {
  if (state.running) return;
  const res = await fetch(`/api/trials/${trialId}`);
  if (!res.ok) {
    alert('Could not load that trial.');
    return;
  }
  const data = await res.json();

  state.trialId = trialId;
  state.caseDef = data.caseDef;
  state.representatives = {};
  state.judges = {};

  for (const arg of data.representativeArguments) {
    state.representatives[arg.role] = {
      status: 'success',
      argumentText: arg.argumentText,
      seat: arg.seat,
      modelUsed: arg.modelUsed,
    };
  }
  for (const ruling of data.judgeRulings) {
    state.judges[ruling.role] = {
      status: 'success',
      verdict: ruling.verdict,
      reasoningText: ruling.reasoningText,
      modelUsed: ruling.modelUsed,
    };
  }
  state.callLog = data.apiCallLogs || [];

  // Backfill a real 'failed' (or 'aborted') entry for any role that has no
  // success above, from that role's own logged attempts - apiCallLogs is
  // ordered ascending by timestamp (see getFullTrial in db.ts), so the last
  // matching row for a role is its most recent, most relevant attempt.
  // Without this, that role would have no state entry at all, and
  // buildAgentStatusBody's "no entry" case would otherwise be the only
  // thing rendered for it - a generic message with no real detail, even
  // though the actual error is sitting right there in the log.
  for (const log of state.callLog) {
    const store = log.callType === 'representative' ? state.representatives : state.judges;
    if (log.status !== 'success') {
      if (store[log.agentRole] && store[log.agentRole].status === 'success') continue;
      store[log.agentRole] =
        log.errorMessage === ABORTED_BY_USER_MESSAGE
          ? { status: 'aborted', error: log.errorMessage }
          : { status: 'failed', error: log.errorMessage || 'Unknown failure' };
    } else if (store[log.agentRole] && store[log.agentRole].status === 'success') {
      // representative_arguments/judge_rulings don't store token counts
      // (only api_call_logs does) - without this, isTruncated() would have
      // nothing to compare against for a historical trial, even though the
      // exact same data that made the live detection possible is sitting
      // right here in the log.
      store[log.agentRole].tokens = { prompt: log.promptTokens, completion: log.completionTokens, total: log.totalTokens };
    }
  }

  renderCaseSheet();
  el.phaseRepresentatives.classList.toggle('hidden', Object.keys(state.representatives).length === 0);
  el.phaseJudges.classList.toggle('hidden', Object.keys(state.judges).length === 0);
  renderRepresentatives();
  renderJudges();
  renderCallLog();
  renderHistory();
}

function renderCaseSheet() {
  const c = state.caseDef;
  if (!c) return;
  el.caseTitle.textContent = c.title;
  el.caseAccused.textContent = c.accused;
  el.caseDeceased.textContent = c.deceased;
  el.caseActAlleged.textContent = c.actAlleged;
  el.caseBackground.textContent = c.background;
  el.caseFacts.innerHTML = '';
  for (const fact of c.agreedFacts) {
    const li = document.createElement('li');
    li.textContent = fact;
    el.caseFacts.appendChild(li);
  }
  el.caseQuestion.textContent = c.question;
  el.caseScopeNote.textContent = c.scopeNote;
}

// Builds the shared "what's happening with this call right now" block used
// by both representative and judge cards - kept as one function so the two
// card types can't quietly drift into showing different information for
// the same underlying states.
// Prepended to every "still waiting on a response" status below - a purely
// visual, CSS-animated indicator (see .spinner in styles.css) that there's
// real, ongoing activity, distinct from the text-only states (aborted,
// failed, success) where nothing is in flight anymore.
//
// A CSS animation restarts from 0% whenever its element is torn down and
// recreated, which would otherwise make a spinner visibly snap back to the
// start on each re-render instead of appearing to spin continuously. Fix:
// a negative animation-delay keyed to the real wall clock tells the
// browser "this animation has already been running for X ms," so a freshly
// created element starts at exactly the angle a continuously running one
// would already be at. Must match the animation's duration in styles.css
// (currently 0.8s / 800ms).
const SPINNER_ANIMATION_MS = 800;
function spinnerHtml() {
  const offset = -(Date.now() % SPINNER_ANIMATION_MS);
  return `<span class="spinner" style="animation-delay: ${offset}ms"></span>`;
}

function buildAgentStatusBody(entry, role, verb) {
  const body = document.createElement('div');

  // No entry at all is NOT "hasn't started yet" - a live run always seeds
  // state.representatives/judges[role] with {status: 'loading'} the moment
  // it begins (see beginTrial), before this ever renders. The only way
  // this function sees a missing entry is loadTrial() viewing a completed,
  // historical trial whose call log has nothing to show for this role at
  // all (no logged attempt of any kind - loadTrial backfills a proper
  // 'failed' entry from the call log whenever one exists, below). Showing
  // the spinner here would claim this dead trial is still working.
  if (!entry) {
    body.className = 'card-body dim';
    body.textContent = 'No result recorded for this role - nothing was logged for it in this trial.';
    return body;
  }

  if (entry.status === 'loading') {
    body.className = 'card-body dim';
    const modelId = state.modelInfo && state.modelInfo[role];
    const modelLine = modelId ? `<div class="model-chain">Model: <span class="model-name">${shortModelName(modelId)}</span></div>` : '';
    body.innerHTML = `${spinnerHtml()}${verb}…${modelLine}`;
    return body;
  }

  if (entry.status === 'aborted') {
    const wrap = document.createElement('div');
    const badge = document.createElement('span');
    badge.className = 'badge badge-aborted';
    badge.textContent = 'Aborted';
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
    badge.textContent = 'Call failed';
    wrap.appendChild(badge);
    const err = document.createElement('p');
    err.className = 'card-body dim';
    err.textContent = entry.error;
    wrap.appendChild(err);
    return wrap;
  }

  return null; // success - caller renders its own content
}

// Shared by both card types, appended after their normal success content -
// see isTruncated() for what actually triggers this and why it needs to be
// derivable for both a live entry and one loaded from history.
function appendTruncationNotice(card, entry) {
  if (!isTruncated(entry)) return;
  const badge = document.createElement('span');
  badge.className = 'badge badge-warn';
  badge.textContent = 'Truncated';
  card.appendChild(badge);
  const note = document.createElement('p');
  note.className = 'card-body dim';
  note.textContent = `This response hit the ${state.maxTokens}-token limit and was cut off before finishing naturally.`;
  card.appendChild(note);
}

function renderRepresentatives() {
  el.representativeCards.innerHTML = '';
  for (const role of REPRESENTATIVE_ROLES) {
    const meta = REPRESENTATIVE_META[role];
    const entry = state.representatives[role];
    const card = document.createElement('div');
    card.className = 'card';

    const header = document.createElement('div');
    header.className = 'card-header';
    header.innerHTML = `
      <span class="card-name">${meta.name}</span>
      <span class="card-seat ${meta.seat}">${meta.seat}</span>
    `;
    card.appendChild(header);

    if (entry && entry.status === 'success') {
      const body = document.createElement('div');
      body.className = 'card-body';
      body.textContent = entry.argumentText;
      card.appendChild(body);
      const answeredBy = document.createElement('p');
      answeredBy.className = 'model-chain';
      answeredBy.innerHTML = `Answered by: <span class="model-name">${shortModelName(entry.modelUsed)}</span>`;
      card.appendChild(answeredBy);
      appendTruncationNotice(card, entry);
    } else {
      const statusBody = buildAgentStatusBody(entry, role, 'Arguing');
      if (statusBody) card.appendChild(statusBody);
    }
    el.representativeCards.appendChild(card);
  }
}

// All three judges in a given trial always see the exact same set of
// available/unavailable representative arguments - runJudgesPhase() only
// ever starts after runRepresentativesPhase() has fully resolved every
// role (success, failure, or abort), so there's no scenario where one
// judge ruled with 3/4 arguments and another ruled with 4/4 in the same
// run. That's what makes a single banner above all three cards correct,
// rather than needing a per-judge-card note or any new stored data - this
// reads directly off state.representatives, which by the time judges are
// ever shown (live or historical) already reflects exactly what every
// judge's own prompt contained (see buildJudgeMessages in prompts.ts,
// which marks a missing seat "[argument unavailable]" rather than
// fabricating or silently omitting it).
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
  el.judgesCaveat.textContent = `Reached with ${available} of ${REPRESENTATIVE_ROLES.length} representative arguments available (${names} did not respond) - see Representatives above.`;
  el.judgesCaveat.classList.remove('hidden');
}

function renderJudges() {
  el.judgeCards.innerHTML = '';
  for (const role of JUDGE_ROLES) {
    const meta = JUDGE_META[role];
    const entry = state.judges[role];
    const card = document.createElement('div');
    card.className = 'card';

    const header = document.createElement('div');
    header.className = 'card-header';
    header.innerHTML = `<span class="card-name">${meta.name}</span>`;
    card.appendChild(header);

    if (entry && entry.status === 'success') {
      const verdict = document.createElement('p');
      verdict.className = entry.verdict === 'justified' ? 'verdict-justified' : 'verdict-not-justified';
      verdict.textContent = entry.verdict === 'justified' ? 'Justified' : 'Not justified';
      card.appendChild(verdict);

      const body = document.createElement('div');
      body.className = 'card-body';
      body.textContent = entry.reasoningText;
      card.appendChild(body);

      const answeredBy = document.createElement('p');
      answeredBy.className = 'model-chain';
      answeredBy.innerHTML = `Answered by: <span class="model-name">${shortModelName(entry.modelUsed)}</span>`;
      card.appendChild(answeredBy);
      appendTruncationNotice(card, entry);
    } else {
      const statusBody = buildAgentStatusBody(entry, role, 'Deliberating');
      if (statusBody) card.appendChild(statusBody);
    }
    el.judgeCards.appendChild(card);
  }
  updateJudgesCaveat();
}

// A single decimal place was accurate but uninformative back when every
// call ran on a $0 free-tier model - real per-call cost on a paid model is
// a small fraction of a cent, which one decimal place rounds down to
// indistinguishable from zero every time. Four places keeps real cost
// visible (the database itself still stores full precision regardless of
// what's shown here).
function formatCost(cost) {
  return `$${Number(cost).toFixed(4)}`;
}

function renderCallLog() {
  if (state.callLog.length === 0) {
    el.phaseLog.classList.add('hidden');
    return;
  }
  el.phaseLog.classList.remove('hidden');
  el.callLogBody.innerHTML = '';
  for (const entry of state.callLog) {
    const tr = document.createElement('tr');
    // A truncated call is still a real success (the call log's own status
    // column reflects that correctly) - this is layered on top as its own
    // distinct badge rather than replacing "success", the same reasoning
    // as the card-level notice in appendTruncationNotice().
    const wasTruncated = entry.status === 'success' && state.maxTokens && entry.completionTokens === state.maxTokens;
    const statusBadge = entry.status === 'success' ? 'badge-ok' : 'badge-fail';
    const tokens = `${entry.promptTokens} / ${entry.completionTokens} / ${entry.totalTokens}`;
    tr.innerHTML = `
      <td>${entry.agentRole}</td>
      <td>${entry.callType}</td>
      <td>${entry.modelUsed}</td>
      <td>${tokens}</td>
      <td>${formatCost(entry.cost)}</td>
      <td>
        <span class="badge ${statusBadge}">${entry.status}</span>
        ${wasTruncated ? '<span class="badge badge-warn">truncated</span>' : ''}
      </td>
      <td>${formatDateTimeHtml(entry.timestamp)}</td>
    `;
    el.callLogBody.appendChild(tr);
  }
}

// Representatives run concurrently as a group - worst case per group is
// one server-side call's own internal retry budget (TOTAL_BUDGET_MS in
// openrouter.ts, ~26s) plus the small stagger between kickoffs, not 4x
// that, since roles don't wait on each other. Judges then run as their own
// concurrent group after, so a genuinely still-working trial takes at most
// roughly 2x that per-group figure end to end. This threshold has to sit
// safely above that, or a trial that's actually still working gets
// mislabeled as abandoned.
const INTERRUPTED_THRESHOLD_MS = 3 * 60 * 1000;

// What "Completed - with failures" is based on: whether the trial's final,
// persisted results are actually incomplete - NOT whether any individual
// call ever logged a failure along the way. A transient failure that the
// server-side retry recovers from within its own budget is a real, logged
// attempt that simply isn't the final outcome - a label driven by
// hadFailures would flag a run like that as tainted even though the
// result is complete and correct. The call log table still
// shows every real attempt, success or failure, in full; this only changes
// what the one-line sidebar summary reports.
const TOTAL_EXPECTED_RESULTS = REPRESENTATIVE_ROLES.length + JUDGE_ROLES.length;

function trialStatusLabel(trial) {
  const missing = TOTAL_EXPECTED_RESULTS - (trial.resultCount ?? 0);
  if (trial.wasAborted) {
    return trial.status === 'completed' ? `Aborted (${trial.resultCount ?? 0} of ${TOTAL_EXPECTED_RESULTS} completed)` : 'Aborted';
  }
  if (trial.status === 'completed') {
    return missing > 0 ? `Completed — missing ${missing} of ${TOTAL_EXPECTED_RESULTS}` : 'Completed';
  }
  const ageMs = Date.now() - new Date(trial.createdAt).getTime();
  if (ageMs > INTERRUPTED_THRESHOLD_MS) {
    return 'Interrupted';
  }
  return 'In progress…';
}

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

function renderHistory() {
  el.historyList.innerHTML = '';
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
