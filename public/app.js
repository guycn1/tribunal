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
  modelInfo: null, // { [role]: { chain: string[], lastDitch: string } }, from /api/case
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

// "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free" -> "nemotron-3-nano-omni-30b-a3b-reasoning"
// Display only - the full id is what's actually sent to the backend/OpenRouter.
function shortModelName(modelId) {
  if (!modelId) return 'unknown model';
  return modelId.replace(/^nvidia\//, '').replace(/:free$/, '');
}

function formatModelChain(role) {
  const info = state.modelInfo && state.modelInfo[role];
  if (!info) return 'the configured model chain';
  return info.chain.map(shortModelName).join(' → ');
}

function formatLastDitchModel(role) {
  const info = state.modelInfo && state.modelInfo[role];
  return info ? shortModelName(info.lastDitch) : 'the last-ditch model';
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

  const isPending = (status) => status === 'loading' || status === 'retrying' || status === 'last-ditch';
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
// between kickoffs avoids bursting this free-tier model with simultaneous
// requests from the same account while every call still runs concurrently
// with the others (none waits for a prior one to finish) — still "in
// parallel" in the sense that matters, just not all launched in the same
// instant.
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
// regardless of anything our own code does (measured directly), and true
// background functions (no such ceiling) are a paid-plan-only feature - not
// an option here. So a single server call cannot itself run for minutes.
// Instead, each server call stays a short, safe, well-bounded attempt (it
// already tries a 3-model fallback chain internally, ~25s worst case), and
// *this* loop is what actually waits "however long it takes": on any
// retryable failure it just calls the same endpoint again, from the
// browser, which has no execution ceiling at all. A few minutes of waiting
// is just several fresh ~25s server calls back to back.
//
// Not truly unbounded, though: a wall-clock cap still applies, because
// every retry is real, metered compute time on a free tier with a hard
// monthly credit budget - a persistently broken model retried forever would
// quietly burn through that budget for no benefit. The Netlify side of that
// budget is the one to be most careful with: OpenRouter's quota resets
// daily (a bad day recovers by tomorrow), but Netlify's resets monthly,
// well past this project's submission deadline - there's no recovering a
// month-long mistake in a few days. 150 seconds gives real room for a
// saturated pool to clear, and for a model that's just genuinely slow that
// day (real generations have been observed legitimately taking 30-45s
// under load) to finish, without letting one stuck call run away with
// meaningful compute time. Once that ceiling is hit, exactly one further
// attempt is made against a distinct, explicitly slower fallback model
// (nemotron-3.5-lightning) via ?lastDitch=true, single-shot, no retry - see
// callOpenRouterOnce on the backend. The one failure this does NOT retry at
// all is the daily OpenRouter quota being exhausted - that cannot succeed
// again before the reset named in the error, no matter how many more
// attempts are made, so it fails immediately instead of waiting out the
// full ceiling pointlessly.
const RETRY_UNTIL_SUCCESS_MS = 150 * 1000;
const RETRY_BACKOFF_BASE_MS = 2000;
const RETRY_BACKOFF_MAX_MS = 6000;
const isQuotaExhausted = (message) => /quota exhausted/i.test(message || '');
// Matches the message callOpenRouter()/callOpenRouterOnce() produce for a
// real HTTP 402 from OpenRouter (the paid account's credit balance is
// genuinely at $0) - see openrouter.ts. representative.ts/judge.ts always
// wrap an OpenRouter-layer failure as a 502, so the res.status-based 4xx
// check below never catches this on its own; like isQuotaExhausted above,
// it needs its own text match. Running out of real money won't resolve
// itself by retrying, so this is treated as non-retryable the same way.
const isOutOfCredits = (message) => /out of credits/i.test(message || '');

function nextBackoff(attempt) {
  return Math.min(RETRY_BACKOFF_BASE_MS * Math.pow(1.3, attempt - 1), RETRY_BACKOFF_MAX_MS) + Math.random() * 500;
}

// Drives one agent's call end to end: normal retrying against the main
// model chain until RETRY_UNTIL_SUCCESS_MS, then exactly one last-ditch
// attempt, then a real, terminal outcome. onUpdate fires on every phase
// transition AND on a steady ~500ms tick throughout (via setInterval) so a
// live countdown is possible even while a request is in flight and no
// discrete event has fired - the alternative (only updating between
// requests) would make the UI look frozen for however long the current
// attempt takes, which is exactly the kind of silent-looking wait this
// whole feature exists to avoid.
async function callAgentWithRetry(url, onUpdate, signal) {
  const startedAt = Date.now();
  const local = { attempt: 0, error: null, phase: 'loading' };

  const tick = () => {
    const elapsedMs = Date.now() - startedAt;
    const remainingMs = Math.max(0, RETRY_UNTIL_SUCCESS_MS - elapsedMs);
    onUpdate({ status: local.phase, attempt: local.attempt, error: local.error, elapsedMs, remainingMs });
  };

  const intervalId = setInterval(tick, 500);
  tick();

  try {
    while (true) {
      if (signal && signal.aborted) {
        return { status: 'aborted', error: 'Stopped by user.' };
      }

      local.attempt += 1;
      const elapsedMs = Date.now() - startedAt;
      const overCeiling = elapsedMs >= RETRY_UNTIL_SUCCESS_MS;
      local.phase = overCeiling ? 'last-ditch' : local.attempt === 1 ? 'loading' : 'retrying';
      tick();

      const requestUrl = overCeiling ? `${url}?lastDitch=true` : url;
      let res, data;
      try {
        res = await fetch(requestUrl, { method: 'POST', signal, headers: SITE_GATE_HEADERS });
      } catch (err) {
        // A genuine network-level failure - offline, DNS, connection
        // refused, or the AbortController firing. Nothing came back at
        // all, so there's no response to inspect.
        if ((err && err.name === 'AbortError') || (signal && signal.aborted)) {
          return { status: 'aborted', error: 'Stopped by user.' };
        }
        local.error = String(err);
        if (overCeiling) {
          return { status: 'failed', error: local.error, lastDitchAttempted: true };
        }
        tick();
        try {
          await sleep(nextBackoff(local.attempt), signal);
        } catch {
          return { status: 'aborted', error: 'Stopped by user.' };
        }
        continue;
      }

      try {
        data = await res.json();
      } catch {
        // A response DID come back, but its body wasn't the JSON this
        // app's own functions always return. The one real way that
        // happens is Netlify's own per-IP rate limiter (see the
        // rateLimit config on representative.ts/judge.ts) blocking the
        // request before this app's function code ever runs, returning a
        // plain error page instead - give a specific, honest reason for
        // that recognizable case rather than surfacing a raw "Unexpected
        // token" parse error, and a generic-but-still-honest one for any
        // other unrecognized non-JSON response.
        data = {
          status: 'failed',
          error:
            res.status === 429
              ? "Too many requests from this network in a short time (Netlify's own per-IP rate limit, separate from this app's own call cap). Wait a few minutes and try again."
              : `Server returned an unexpected non-JSON response (HTTP ${res.status}).`,
        };
      }

      if (res.ok && data.status !== 'failed') {
        return { status: 'success', ...data, wasLastDitch: overCeiling };
      }

      const error = data.error || `HTTP ${res.status}`;
      local.error = error;

      if (isQuotaExhausted(error) || isOutOfCredits(error) || (res.status >= 400 && res.status < 500) || overCeiling) {
        // Quota-exhausted, out of real credits, a malformed request (4xx),
        // or this WAS the last-ditch attempt itself - none of these are
        // worth another round, for the reasons in the comment above this
        // function.
        return { status: 'failed', error, lastDitchAttempted: overCeiling };
      }

      tick();
      try {
        await sleep(nextBackoff(local.attempt), signal);
      } catch {
        return { status: 'aborted', error: 'Stopped by user.' };
      }
    }
  } finally {
    clearInterval(intervalId);
  }
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
      const result = await callAgentWithRetry(
        `/api/trials/${state.trialId}/representatives/${role}`,
        (progress) => {
          state.representatives[role] = progress;
          renderRepresentatives();
        },
        signal
      );
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
      const result = await callAgentWithRetry(
        `/api/trials/${state.trialId}/judges/${role}`,
        (progress) => {
          state.judges[role] = progress;
          renderJudges();
        },
        signal
      );
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
    if (log.status !== 'success') {
      const store = log.callType === 'representative' ? state.representatives : state.judges;
      if (store[log.agentRole] && store[log.agentRole].status === 'success') continue;
      const lastDitchModel = state.modelInfo && state.modelInfo[log.agentRole] && state.modelInfo[log.agentRole].lastDitch;
      store[log.agentRole] =
        log.errorMessage === ABORTED_BY_USER_MESSAGE
          ? { status: 'aborted', error: log.errorMessage }
          : {
              status: 'failed',
              error: log.errorMessage || 'Unknown failure',
              lastDitchAttempted: Boolean(lastDitchModel) && log.modelUsed === lastDitchModel,
            };
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
// Rendering here rebuilds each card's whole DOM wholesale on every ~500ms
// tick (to update the live elapsed/countdown text), which recreates the
// spinner element every time too - and a CSS animation restarts from 0%
// whenever its element is torn down and recreated, so without this it
// visibly snaps back after a fraction of a rotation instead of spinning
// continuously. Fix: a negative animation-delay keyed to the real wall
// clock tells the browser "this animation has already been running for X
// ms," so a freshly created element starts at exactly the angle a
// continuously running one would already be at - making the recreation
// invisible no matter how often it happens. Must match the animation's
// duration in styles.css (currently 0.8s / 800ms).
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
    body.innerHTML = `${spinnerHtml()}${verb}…<div class="model-chain">Trying: <span class="model-name">${formatModelChain(role)}</span></div>`;
    return body;
  }

  if (entry.status === 'retrying') {
    const secondsLeft = Math.max(0, Math.ceil((entry.remainingMs || 0) / 1000));
    body.className = 'card-body dim';
    // entry.error can echo a truncated raw response body from OpenRouter
    // (see safeReadText in openrouter.ts), which is external, unpredictable
    // text - built as its own text node below rather than interpolated
    // into the innerHTML template with everything else, which is all
    // either a number or a model id string we control.
    body.innerHTML = `
      ${spinnerHtml()}Still trying (attempt ${entry.attempt}, ${Math.round(entry.elapsedMs / 1000)}s so far)…
      <div class="model-chain">Trying: <span class="model-name">${formatModelChain(role)}</span></div>
      <div class="model-chain">Last-ditch fallback in <span class="countdown">${secondsLeft}s</span> if this keeps failing</div>
    `;
    const errLine = document.createElement('div');
    errLine.className = 'model-chain';
    errLine.textContent = `Last attempt: ${entry.error}`;
    body.appendChild(errLine);
    return body;
  }

  if (entry.status === 'last-ditch') {
    body.className = 'card-body dim';
    body.innerHTML = `
      ${spinnerHtml()}Normal chain exhausted after 150s — making one final attempt with <span class="model-name">${formatLastDitchModel(role)}</span>…
      <div class="model-chain">This model is known to be slower; this attempt may take longer than the others did.</div>
    `;
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
    err.textContent = entry.lastDitchAttempted
      ? `${entry.error} (a last-ditch attempt with ${formatLastDitchModel(role)} was also tried and also failed)`
      : entry.error;
    wrap.appendChild(err);
    return wrap;
  }

  return null; // success - caller renders its own content
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
      answeredBy.innerHTML = `Answered by: <span class="model-name">${shortModelName(entry.modelUsed)}</span>${entry.wasLastDitch ? ' (last-ditch fallback)' : ''}`;
      card.appendChild(answeredBy);
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
      answeredBy.innerHTML = `Answered by: <span class="model-name">${shortModelName(entry.modelUsed)}</span>${entry.wasLastDitch ? ' (last-ditch fallback)' : ''}`;
      card.appendChild(answeredBy);
    } else {
      const statusBody = buildAgentStatusBody(entry, role, 'Deliberating');
      if (statusBody) card.appendChild(statusBody);
    }
    el.judgeCards.appendChild(card);
  }
  updateJudgesCaveat();
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
    const statusBadge = entry.status === 'success' ? 'badge-ok' : 'badge-fail';
    const tokens = `${entry.promptTokens} / ${entry.completionTokens} / ${entry.totalTokens}`;
    tr.innerHTML = `
      <td>${entry.agentRole}</td>
      <td>${entry.callType}</td>
      <td>${entry.modelUsed}</td>
      <td>${tokens}</td>
      <td>$${Number(entry.cost).toFixed(1)}</td>
      <td><span class="badge ${statusBadge}">${entry.status}</span></td>
      <td>${formatDateTimeHtml(entry.timestamp)}</td>
    `;
    el.callLogBody.appendChild(tr);
  }
}

// Representatives run concurrently as a group - worst case per group is
// RETRY_UNTIL_SUCCESS_MS (150s) plus one last-ditch attempt (up to ~26s),
// not 4x that, since roles don't wait on each other - then judges run as
// their own concurrent group after, so a genuinely still-working trial
// takes at most roughly 2x that per-group figure (~352s) end to end. This
// threshold has to sit safely above that, or a trial that's actually still
// retrying gets mislabeled as abandoned.
const INTERRUPTED_THRESHOLD_MS = 7 * 60 * 1000;

// What "Completed - with failures" is based on: whether the trial's final,
// persisted results are actually incomplete - NOT whether any individual
// call ever logged a failure along the way. On a free tier, a transient
// failure that the retry loop recovers from within its ceiling is the
// expected case, not the exception - a label driven by hadFailures would
// fire on most runs and stop meaning anything. The call log table still
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
