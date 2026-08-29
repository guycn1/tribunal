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
//
// A response still truncated after the one conciseness retry is now
// returned by the server as a real failure (openrouter.ts), not a
// "success" for this function to badge - so this can no longer fire for
// any newly-generated result. It's kept, and checks a *multiple* of
// state.maxTokens rather than an exact match, specifically for trials
// recorded before that change: some real historical rows have a
// completion of exactly 2 x maxTokens (both the original attempt and the
// retry hit the cap, and the older code still saved that as a success) -
// an exact `===` check would silently miss those on reopen.
function isTruncated(entry) {
  return Boolean(
    entry &&
      entry.status === 'success' &&
      state.maxTokens &&
      entry.tokens &&
      entry.tokens.completion > 0 &&
      entry.tokens.completion % state.maxTokens === 0
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
// instant and only the first came back with real content - the other 3
// got an immediate 429. A start-time stagger alone (kickoffs 400ms apart)
// did not fix this on its own in a later run: three of four still failed,
// two of them not with a fast 429 this time but with a genuine no-response
// timeout on their retry. A few hundred ms of head start barely matters
// when each call's real generation takes 15-20s - four calls started even a
// second apart still spend nearly all of that time overlapping in flight,
// so a start-time stagger doesn't meaningfully reduce concurrent load on
// the account. What the same run's judges phase showed instead: 3 calls
// fired together with the same stagger all succeeded on attempt 1, no rate
// limit at all. That contrast is the actual signal - this account handles
// roughly 3 simultaneous in-flight calls cleanly but not 4. So the real fix
// is a hard cap on how many calls are ever in flight at once
// (MAX_CONCURRENT_CALLS below, via runWithConcurrencyLimit), not just a
// stagger on when each one starts - the stagger is kept underneath it as a
// cheap extra precaution against the pool's initial batch still landing in
// the same instant, but it is not what does the real work here. This is
// about OpenRouter's own account-level concurrency limit specifically, and
// still applies regardless of the trigger/poll rewrite below - moving
// representative.ts/judge.ts to Background Functions changes how this app
// waits for a result, not how many calls the OpenRouter account can take
// at once.
const CONCURRENT_CALL_STAGGER_MS = 400;
const MAX_CONCURRENT_CALLS = 3;

// Runs `worker` over `items` with at most `limit` invocations actually in
// flight at once. A fixed pool of `limit` runners each pull the next item
// as soon as they're free, so item N+1 only starts once one of the first
// `limit` items has genuinely finished - not merely after its own stagger
// delay - which is what actually bounds concurrent load on the account
// regardless of how long any individual call takes. Every item still runs
// without waiting on any *specific* other item, only on a free slot, so
// this stays real concurrency, just bounded.
async function runWithConcurrencyLimit(items, limit, worker) {
  let nextIndex = 0;
  async function runSlot() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      await worker(items[index], index);
    }
  }
  const slots = Array.from({ length: Math.min(limit, items.length) }, () => runSlot());
  await Promise.allSettled(slots);
}

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

// representative.ts/judge.ts now run as Netlify Background Functions (see
// config.background in each) - the fix for a verified, load-bearing
// problem: Netlify's real free-tier synchronous function limit is 10
// seconds, while every real OpenRouter call measured on this project has
// taken 8-18s+ per attempt, before any retry. A standard invocation could
// not reliably survive that gap no matter how the internal retry/timeout
// budget was tuned. Background Functions get up to 15 minutes instead -
// but the platform responds 202 immediately and runs the handler
// asynchronously, so its real return value never reaches this fetch()
// call the way a normal synchronous function's did. Calling a role now
// has two separate steps: triggerAgent() fires the request and reports
// only what's knowable synchronously (a network failure, or a
// platform-level rejection like Netlify's own per-IP rate limit); the
// real, eventual outcome is discovered afterward by polling
// GET /api/trials/:id (see pollForRoles() and deriveRoleStates() below).
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

  // A non-2xx this early can only be a platform-level rejection (Netlify's
  // per-IP rate limiter, most likely - see the rateLimit config on
  // representative.ts/judge.ts) rather than anything from this app's own
  // handler code, since a Background Function's own application-level
  // outcome never reaches this response at all.
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

// Derives a {representatives, judges} status map from one GET
// /api/trials/:id response - the single source of truth for "what has
// actually happened so far in this trial," used identically whether
// reopening a finished historical trial (loadTrial) or polling a live one
// (pollForRoles), so the two call sites can't quietly drift into
// disagreeing about what the same trial record means. apiCallLogs is
// ordered ascending by timestamp (see getFullTrial in db.ts), so the last
// matching row for a role is its most recent attempt.
function deriveRoleStates(data) {
  const representatives = {};
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
      store[log.agentRole] =
        log.errorMessage === ABORTED_BY_USER_MESSAGE
          ? { status: 'aborted', error: log.errorMessage }
          : { status: 'failed', error: log.errorMessage || 'Unknown failure' };
    } else if (store[log.agentRole] && store[log.agentRole].status === 'success') {
      // representative_arguments/judge_rulings don't store token counts
      // (only api_call_logs does) - without this, isTruncated() would have
      // nothing to compare against.
      store[log.agentRole].tokens = { prompt: log.promptTokens, completion: log.completionTokens, total: log.totalTokens };
    }
  }

  return { representatives, judges };
}

// How long to keep polling a phase for a role that hasn't resolved yet
// before giving up and showing it as unclear rather than waiting forever.
// Comfortably above openrouter.ts's own TOTAL_BUDGET_MS (650s, sized for
// the full 4-tier escalation chain - see openrouter.ts) plus real margin
// for polling/network overhead. This drifted out of sync once before: the
// server budget was raised from 120s to 650s to fit the escalation chain,
// but this constant stayed at its old value (150s) - a real, observed
// consequence was a role that genuinely succeeded server-side (verified
// directly in the DB) still showing as unresolved on the client because
// polling gave up first. A role that still hasn't resolved by the new
// timeout either genuinely failed in a way this page can't see (the
// disclosed site-gate/call-cap gap documented in representative.ts/
// judge.ts - a rejection there is no longer visible to the poller, only
// in Netlify's function logs) or is a real anomaly worth surfacing
// honestly rather than silently waiting past.
const POLL_TIMEOUT_MS = 700000;
const POLL_INTERVAL_MS = 2500;

// Polls GET /api/trials/:id until every role in `pendingRoles` has
// resolved (success/failed/aborted) or POLL_TIMEOUT_MS elapses, updating
// `bucket` (state.representatives or state.judges) and calling `render`
// incrementally as each role resolves, rather than waiting for the whole
// batch together.
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
      }
    }
    if (changed) render();
  }

  if (remaining.size > 0) {
    for (const role of remaining) {
      bucket[role] = {
        status: 'timeout',
        error: `No result after ${Math.round(POLL_TIMEOUT_MS / 1000)}s of polling. The background call may still finish server-side and become visible if you reopen this trial from history later.`,
      };
    }
    render();
  }
}

async function runRepresentativesPhase(signal) {
  for (const role of REPRESENTATIVE_ROLES) {
    state.representatives[role] = { status: 'loading' };
  }
  renderRepresentatives();

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

  // Distinct from 'failed': this role's background call may genuinely
  // still be running server-side (Background Functions get up to 15
  // minutes) - polling just stopped waiting on this page. Worded to say
  // that honestly rather than implying the call itself is known to have
  // failed, since it may not have. See pollForRoles() in the trigger/poll
  // rewrite for what actually produces this status.
  if (entry.status === 'timeout') {
    const wrap = document.createElement('div');
    const badge = document.createElement('span');
    badge.className = 'badge badge-fail';
    badge.textContent = 'No response yet';
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
    // A response still truncated after the conciseness retry is now a
    // real failure (openrouter.ts), correctly shown via the status column
    // below - this badge only still fires for historical rows recorded
    // before that change, where the log genuinely says 'success' with a
    // completion that's an exact multiple of the cap (1x from an older,
    // single-attempt truncation, or 2x from a retry that also truncated
    // before this fix existed). Same reasoning and formula as isTruncated().
    const wasTruncated =
      entry.status === 'success' &&
      state.maxTokens &&
      entry.completionTokens > 0 &&
      entry.completionTokens % state.maxTokens === 0;
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
