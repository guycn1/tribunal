const REPRESENTATIVE_ROLES = ['jon_snow', 'tyrion_lannister', 'daenerys_targaryen', 'grey_worm'];
const JUDGE_ROLES = ['barak', 'elon', 'shamgar'];

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
    const res = await fetch('/api/trials', { method: 'POST' });
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
// month-long mistake in a few days. 100 seconds gives real room for a
// saturated pool to clear without letting one stuck call run away with
// meaningful compute time. Once that ceiling is hit, exactly one further
// attempt is made against a distinct, explicitly slower fallback model
// (nemotron-3.5-lightning) via ?lastDitch=true, single-shot, no retry - see
// callOpenRouterOnce on the backend. The one failure this does NOT retry at
// all is the daily OpenRouter quota being exhausted - that cannot succeed
// again before the reset named in the error, no matter how many more
// attempts are made, so it fails immediately instead of waiting out the
// full ceiling pointlessly.
const RETRY_UNTIL_SUCCESS_MS = 100 * 1000;
const RETRY_BACKOFF_BASE_MS = 2000;
const RETRY_BACKOFF_MAX_MS = 6000;
const isQuotaExhausted = (message) => /quota exhausted/i.test(message || '');

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
        res = await fetch(requestUrl, { method: 'POST', signal });
        data = await res.json();
      } catch (err) {
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

      if (res.ok && data.status !== 'failed') {
        return { status: 'success', ...data, wasLastDitch: overCeiling };
      }

      const error = data.error || `HTTP ${res.status}`;
      local.error = error;

      if (isQuotaExhausted(error) || (res.status >= 400 && res.status < 500) || overCeiling) {
        // Quota-exhausted, a malformed request (4xx), or this WAS the
        // last-ditch attempt itself - none of these are worth another
        // round, for the reasons in the comment above this function.
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

async function refreshHistory() {
  const res = await fetch('/api/trials');
  if (!res.ok) return;
  const data = await res.json();
  state.history = data.trials || [];
  renderHistory();
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
const SPINNER_HTML = '<span class="spinner"></span>';

function buildAgentStatusBody(entry, role, verb) {
  const body = document.createElement('div');

  if (!entry || entry.status === 'loading') {
    body.className = 'card-body dim';
    body.innerHTML = `${SPINNER_HTML}${verb}…<div class="model-chain">Trying: <span class="model-name">${formatModelChain(role)}</span></div>`;
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
      ${SPINNER_HTML}Still trying (attempt ${entry.attempt}, ${Math.round(entry.elapsedMs / 1000)}s so far)…
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
      ${SPINNER_HTML}Normal chain exhausted after 100s — making one final attempt with <span class="model-name">${formatLastDitchModel(role)}</span>…
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
      <td>$${Number(entry.cost).toFixed(6)}</td>
      <td><span class="badge ${statusBadge}">${entry.status}</span></td>
      <td>${new Date(entry.timestamp).toLocaleString()}</td>
    `;
    el.callLogBody.appendChild(tr);
  }
}

// Representatives run concurrently as a group - worst case per group is
// RETRY_UNTIL_SUCCESS_MS (100s) plus one last-ditch attempt (up to ~22s),
// not 4x that, since roles don't wait on each other - then judges run as
// their own concurrent group after, so a genuinely still-working trial
// takes at most roughly 2x that per-group figure (~244s) end to end. This
// threshold has to sit safely above that, or a trial that's actually still
// retrying gets mislabeled as abandoned.
const INTERRUPTED_THRESHOLD_MS = 5 * 60 * 1000;

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
      <div class="history-item-date">${new Date(trial.createdAt).toLocaleString()}</div>
      <span class="badge ${trialStatusClass(trial)}">${trialStatusLabel(trial)}</span>
    `;
    li.addEventListener('click', () => loadTrial(trial.id));
    el.historyList.appendChild(li);
  }
}

loadStaticCaseSheet();
refreshHistory();
