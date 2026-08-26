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

async function runRepresentativesPhase() {
  for (const role of REPRESENTATIVE_ROLES) {
    state.representatives[role] = { status: 'loading' };
  }
  renderRepresentatives();

  await Promise.allSettled(
    REPRESENTATIVE_ROLES.map(async (role) => {
      try {
        const res = await fetch(`/api/trials/${state.trialId}/representatives/${role}`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok || data.status === 'failed') {
          state.representatives[role] = { status: 'failed', error: data.error || `HTTP ${res.status}` };
        } else {
          state.representatives[role] = { status: 'success', ...data };
        }
      } catch (err) {
        state.representatives[role] = { status: 'failed', error: String(err) };
      }
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
    JUDGE_ROLES.map(async (role) => {
      try {
        const res = await fetch(`/api/trials/${state.trialId}/judges/${role}`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok || data.status === 'failed') {
          state.judges[role] = { status: 'failed', error: data.error || `HTTP ${res.status}` };
        } else {
          state.judges[role] = { status: 'success', ...data };
        }
      } catch (err) {
        state.judges[role] = { status: 'failed', error: String(err) };
      }
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

function trialStatusLabel(trial) {
  if (trial.status === 'completed') {
    return trial.hadFailures ? 'Completed — with failures' : 'Completed';
  }
  const ageMs = Date.now() - new Date(trial.createdAt).getTime();
  if (ageMs > 2 * 60 * 1000) {
    return 'Interrupted';
  }
  return 'In progress…';
}

function trialStatusClass(trial) {
  if (trial.status === 'completed') {
    return trial.hadFailures ? 'badge-warn' : 'badge-ok';
  }
  const ageMs = Date.now() - new Date(trial.createdAt).getTime();
  if (ageMs > 2 * 60 * 1000) {
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
