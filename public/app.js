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
  representatives: {},
  judges: {},
  callLog: [],
  history: [],
  running: false,
};

const el = {
  newTrialBtn: document.getElementById('new-trial-btn'),
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

async function beginTrial() {
  if (state.running) return;
  state.running = true;
  el.newTrialBtn.disabled = true;

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

    await runRepresentativesPhase();
    await runJudgesPhase();
    await refreshFullTrial();
    await refreshHistory();
  } finally {
    state.running = false;
    el.newTrialBtn.disabled = false;
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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
// quietly burn through that budget for no benefit. 5 minutes comfortably
// covers "a few full minutes" of real waiting while keeping worst-case cost
// bounded. The one failure this does NOT retry is the daily OpenRouter
// quota being exhausted - that cannot succeed again before the reset named
// in the error, no matter how many more attempts are made, so it fails
// immediately instead of waiting out the full 5 minutes pointlessly.
const RETRY_UNTIL_SUCCESS_MS = 5 * 60 * 1000;
const RETRY_BACKOFF_BASE_MS = 2000;
const RETRY_BACKOFF_MAX_MS = 6000;
const isQuotaExhausted = (message) => /quota exhausted/i.test(message || '');

async function callAgentWithRetry(url, onUpdate) {
  const startedAt = Date.now();
  let attempt = 0;

  while (true) {
    attempt += 1;
    try {
      const res = await fetch(url, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.status !== 'failed') {
        return { status: 'success', ...data };
      }

      const error = data.error || `HTTP ${res.status}`;
      if (isQuotaExhausted(error)) {
        return { status: 'failed', error };
      }
      // A 4xx here means the request itself is malformed (missing trial id,
      // unknown role, wrong method) - our own endpoints use 502 specifically
      // for OpenRouter-side failures, which is what's actually worth
      // retrying. An identical bad request will fail identically every
      // time, so retrying it for up to 5 minutes would just waste calls.
      if (res.status >= 400 && res.status < 500) {
        return { status: 'failed', error };
      }

      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= RETRY_UNTIL_SUCCESS_MS) {
        return { status: 'failed', error: `Still failing after ${Math.round(elapsedMs / 1000)}s of retrying. Last error: ${error}` };
      }

      onUpdate({ status: 'retrying', attempt, error, elapsedMs });
      const backoff = Math.min(RETRY_BACKOFF_BASE_MS * Math.pow(1.3, attempt - 1), RETRY_BACKOFF_MAX_MS);
      await sleep(backoff + Math.random() * 500);
    } catch (err) {
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= RETRY_UNTIL_SUCCESS_MS) {
        return { status: 'failed', error: `Still failing after ${Math.round(elapsedMs / 1000)}s of retrying. Last error: ${String(err)}` };
      }
      onUpdate({ status: 'retrying', attempt, error: String(err), elapsedMs });
      const backoff = Math.min(RETRY_BACKOFF_BASE_MS * Math.pow(1.3, attempt - 1), RETRY_BACKOFF_MAX_MS);
      await sleep(backoff + Math.random() * 500);
    }
  }
}

async function runRepresentativesPhase() {
  for (const role of REPRESENTATIVE_ROLES) {
    state.representatives[role] = { status: 'loading' };
  }
  renderRepresentatives();

  await Promise.allSettled(
    REPRESENTATIVE_ROLES.map(async (role, index) => {
      await sleep(index * CONCURRENT_CALL_STAGGER_MS);
      const result = await callAgentWithRetry(`/api/trials/${state.trialId}/representatives/${role}`, (progress) => {
        state.representatives[role] = progress;
        renderRepresentatives();
      });
      state.representatives[role] = result;
      renderRepresentatives();
    })
  );
}

async function runJudgesPhase() {
  el.phaseJudges.classList.remove('hidden');
  for (const role of JUDGE_ROLES) {
    state.judges[role] = { status: 'loading' };
  }
  renderJudges();

  await Promise.allSettled(
    JUDGE_ROLES.map(async (role, index) => {
      await sleep(index * CONCURRENT_CALL_STAGGER_MS);
      const result = await callAgentWithRetry(`/api/trials/${state.trialId}/judges/${role}`, (progress) => {
        state.judges[role] = progress;
        renderJudges();
      });
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

    const body = document.createElement('div');
    if (!entry || entry.status === 'loading') {
      body.className = 'card-body dim';
      body.textContent = 'Arguing…';
    } else if (entry.status === 'retrying') {
      body.className = 'card-body dim';
      body.textContent = `Still trying (attempt ${entry.attempt}, ${Math.round(entry.elapsedMs / 1000)}s so far)… last attempt: ${entry.error}`;
    } else if (entry.status === 'failed') {
      body.innerHTML = `<span class="badge badge-fail">Call failed</span>`;
      const err = document.createElement('p');
      err.className = 'card-body dim';
      err.textContent = entry.error;
      card.appendChild(body);
      card.appendChild(err);
      el.representativeCards.appendChild(card);
      continue;
    } else {
      body.className = 'card-body';
      body.textContent = entry.argumentText;
    }
    card.appendChild(body);
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

    if (!entry || entry.status === 'loading') {
      const body = document.createElement('div');
      body.className = 'card-body dim';
      body.textContent = 'Deliberating…';
      card.appendChild(body);
    } else if (entry.status === 'retrying') {
      const body = document.createElement('div');
      body.className = 'card-body dim';
      body.textContent = `Still trying (attempt ${entry.attempt}, ${Math.round(entry.elapsedMs / 1000)}s so far)… last attempt: ${entry.error}`;
      card.appendChild(body);
    } else if (entry.status === 'failed') {
      const badge = document.createElement('span');
      badge.className = 'badge badge-fail';
      badge.textContent = 'Call failed';
      card.appendChild(badge);
      const err = document.createElement('p');
      err.className = 'card-body dim';
      err.textContent = entry.error;
      card.appendChild(err);
    } else {
      const verdict = document.createElement('p');
      verdict.className = entry.verdict === 'justified' ? 'verdict-justified' : 'verdict-not-justified';
      verdict.textContent = entry.verdict === 'justified' ? 'Justified' : 'Not justified';
      card.appendChild(verdict);

      const body = document.createElement('div');
      body.className = 'card-body';
      body.textContent = entry.reasoningText;
      card.appendChild(body);
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

// A single agent call can now legitimately retry for up to 5 minutes
// (RETRY_UNTIL_SUCCESS_MS), and a full trial runs up to 7 of them (4
// representatives, then 3 judges) - so a genuinely still-working trial can
// take close to 10 minutes end to end. This threshold has to sit safely
// above that, or a trial that's actually still retrying gets mislabeled as
// abandoned.
const INTERRUPTED_THRESHOLD_MS = 12 * 60 * 1000;

function trialStatusLabel(trial) {
  if (trial.status === 'completed') {
    return trial.hadFailures ? 'Completed — with failures' : 'Completed';
  }
  const ageMs = Date.now() - new Date(trial.createdAt).getTime();
  if (ageMs > INTERRUPTED_THRESHOLD_MS) {
    return 'Interrupted';
  }
  return 'In progress…';
}

function trialStatusClass(trial) {
  if (trial.status === 'completed') {
    return trial.hadFailures ? 'badge-warn' : 'badge-ok';
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
