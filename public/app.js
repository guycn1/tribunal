const form = document.getElementById('charge-form');
const submitBtn = document.getElementById('submit-btn');
const formError = document.getElementById('form-error');
const loading = document.getElementById('loading');
const resultSection = document.getElementById('result');
const verdictsEl = document.getElementById('verdicts');
const argumentsEl = document.getElementById('arguments');
const callLogBody = document.querySelector('#call-log tbody');

submitBtn.addEventListener('click', async () => {
  const defendant = document.getElementById('defendant').value.trim();
  const act = document.getElementById('act').value.trim();
  const question = document.getElementById('question').value.trim();

  formError.classList.add('hidden');
  resultSection.classList.add('hidden');
  loading.classList.remove('hidden');
  submitBtn.disabled = true;

  try {
    const res = await fetch('/api/trial', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defendant, act, question }),
    });
    const data = await res.json();

    if (!res.ok) {
      formError.textContent = data.details ? data.details.join(' ') : data.error;
      formError.classList.remove('hidden');
      return;
    }

    renderResult(data);
  } catch (err) {
    formError.textContent = 'The tribunal failed to respond: ' + err.message;
    formError.classList.remove('hidden');
  } finally {
    loading.classList.add('hidden');
    submitBtn.disabled = false;
  }
});

function renderResult(data) {
  // Verdicts render FIRST in the DOM, per spec: verdict before reasoning/arguments.
  verdictsEl.innerHTML = '';
  data.verdicts.forEach((v) => {
    const card = document.createElement('div');
    let cls = 'verdict-error';
    let label = 'Failed';
    let reasoning = v.error || '';

    if (v.status === 'ok') {
      if (v.parsed) {
        cls = v.verdict === 'guilty' ? 'verdict-guilty' : 'verdict-not-guilty';
        label = v.verdict === 'guilty' ? 'Guilty' : 'Not guilty';
        reasoning = v.reasoning;
      } else {
        cls = 'verdict-error';
        label = 'Unparsed response';
        reasoning = v.raw;
      }
    }

    card.className = `verdict-card ${cls}`;
    card.innerHTML = `
      <span class="verdict-role">${v.role}</span>
      <span class="verdict-label">${label}</span>
      <p class="verdict-reasoning">${escapeHtml(reasoning || '')}</p>
    `;
    verdictsEl.appendChild(card);
  });

  // Arguments render below the verdicts.
  argumentsEl.innerHTML = '';
  data.arguments.forEach((a) => {
    const block = document.createElement('div');
    block.className = 'argument-block';
    const text = a.status === 'ok' ? a.text : `(failed: ${a.error})`;
    block.innerHTML = `<span class="argument-role">${a.role}</span><p>${escapeHtml(text)}</p>`;
    argumentsEl.appendChild(block);
  });

  // Call log — full audit trail with tokens and cost per call.
  callLogBody.innerHTML = '';
  const allCalls = [...data.arguments, ...data.verdicts];
  allCalls.forEach((c) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${c.role}</td>
      <td>${c.model || '-'}</td>
      <td>${c.tokens ?? '-'}</td>
      <td>${c.cost !== undefined ? '$' + c.cost.toFixed(6) : '-'}</td>
      <td>${c.status}</td>
    `;
    callLogBody.appendChild(row);
  });

  resultSection.classList.remove('hidden');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
