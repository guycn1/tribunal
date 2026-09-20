// Regression tests for callOpenRouter()'s retry/escalation logic.
//
// Run with `npm test`. No framework, no dependencies, no network: the real
// shipped TypeScript is compiled with the project's own tsc and exercised
// against a mocked global.fetch, so these assert the actual source rather
// than a hand-copied imitation of it.
//
// This file exists because this specific logic has now produced several
// subtle, expensive bugs that only showed up in real use - an escalation
// chain that silently never escalated, a timeout ceiling that ignored
// prompt size, a degeneration check blind to its most common signature, a
// fractional millisecond that would have crashed half of all real calls,
// and a fast-429 storm that escalated to a costlier tier within five seconds.
// Each one below is a test, so none of them can quietly come back.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'tribunal-tests-'));

// Run tsc's own JS entrypoint with this Node binary rather than the
// node_modules/.bin shim: on Windows that shim is a .cmd, which
// execFileSync cannot spawn without a shell.
const tsc = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(
  process.execPath,
  [
    tsc,
    path.join('netlify', 'functions', 'lib', 'openrouter.ts'),
    path.join('netlify', 'functions', 'lib', 'pricing.ts'),
    path.join('netlify', 'functions', 'lib', 'models.ts'),
    '--target', 'ES2020', '--module', 'commonjs', '--moduleResolution', 'node',
    '--esModuleInterop', '--skipLibCheck', '--outDir', OUT,
  ],
  { cwd: ROOT, stdio: 'inherit' }
);

process.env.OPENROUTER_API_KEY = 'test-key';
const { callOpenRouter } = require(path.join(OUT, 'openrouter.js'));

const DEFAULT = 'mistralai/mistral-small-24b-instruct-2501';
const TIER2 = 'anthropic/claude-haiku-4.5';
const TIER3 = 'openai/gpt-5.6-sol';

// Quiet the real console.log/warn chatter from the module under test; a
// failing check prints everything it needs on its own.
const realLog = console.log;
const realWarn = console.warn;
const captured = [];
console.log = (...a) => captured.push(a.join(' '));
console.warn = (...a) => captured.push(a.join(' '));
const say = (...a) => realLog(...a);

let failures = 0;
function check(name, condition, detail) {
  if (condition) say(`  PASS  ${name}`);
  else {
    failures++;
    say(`  FAIL  ${name}${detail !== undefined ? ` :: ${detail}` : ''}`);
  }
}
async function test(name, fn) {
  say(`\n=== ${name} ===`);
  captured.length = 0;
  await fn();
}

function reply(model, content, finishReason = 'stop', completionTokens = 400) {
  return {
    ok: true, status: 200, headers: new Map(),
    json: async () => ({
      model,
      choices: [{ message: { content }, finish_reason: finishReason }],
      usage: { prompt_tokens: 1000, completion_tokens: completionTokens, total_tokens: 1000 + completionTokens },
    }),
  };
}
const rateLimited = () => ({ ok: false, status: 429, headers: new Map(), text: async () => '{}' });
const notFound = (model) => ({ ok: false, status: 404, headers: new Map(), text: async () => JSON.stringify({ error: { message: `No endpoints found for ${model}.` } }) });
function throwTimeout() {
  const e = new Error('The operation was aborted due to timeout');
  e.name = 'TimeoutError';
  throw e;
}
const CLEAN = 'The bells had already rung when she turned the dragon on the city. That is the fact this tribunal cannot reason past.';

async function main() {
  // ------------------------------------------------------------------ 1
  await test('A sentence repeated many times is caught as degeneration', async () => {
    // The real shape of the miss: short, fully punctuated, repeated verbatim.
    // The older run-length check cannot see this at all.
    const degenerate = 'I was wrong about the realm. ' + 'I can only tell you that I was wrong, and I am sorry. '.repeat(8);
    const calls = [];
    global.fetch = async (_u, o) => {
      const m = JSON.parse(o.body).model;
      calls.push(m);
      return m === DEFAULT ? reply(m, degenerate) : reply(m, CLEAN);
    };
    const r = await callOpenRouter(DEFAULT, [{ role: 'user', content: 'x'.repeat(4000) }], 1400, 'rep:test');
    check('did not accept the looping response', r.content !== degenerate, 'accepted a degenerate response');
    check('spent both tier-1 attempts before escalating', calls[0] === DEFAULT && calls[1] === DEFAULT, JSON.stringify(calls));
    check('escalated and returned a clean result', r.status === 'success' && r.model === TIER2, `${r.status}/${r.model}`);
  });

  // ------------------------------------------------------------------ 2
  await test('Deliberate anaphora is NOT mistaken for degeneration', async () => {
    // Real anaphora repeats an opening and continues differently, so the
    // whole sentences differ. The abandoned 5-word-phrase heuristic used to
    // false-positive on exactly this.
    const anaphora = [
      'I ask you to consider the scale of the harm.',
      'I ask you to consider the alternatives he had.',
      'I ask you to consider his lack of any authority.',
      'I ask you to consider what he actually knew that day.',
      'I ask you to consider the bells over a surrendered city.',
    ].join(' ');
    const calls = [];
    global.fetch = async (_u, o) => { calls.push(JSON.parse(o.body).model); return reply(DEFAULT, anaphora); };
    const r = await callOpenRouter(DEFAULT, [{ role: 'user', content: 'hi' }], 1400, 'rep:test');
    check('accepted first time, no escalation', calls.length === 1 && r.status === 'success', JSON.stringify(calls));
  });

  // ------------------------------------------------------------------ 3
  await test('Repeated slow timeouts escalate instead of looping at one tier', async () => {
    // The six-minute stall: every transient failure used to retry the same
    // model without ever consuming a tier attempt.
    const calls = [];
    const starts = [];
    const realNow = Date.now;
    let skew = 0;
    Date.now = () => realNow() + skew;
    global.fetch = async (_u, o) => {
      const m = JSON.parse(o.body).model;
      calls.push(m);
      if (m === DEFAULT || m === TIER2) { skew += 45000; throwTimeout(); }
      return reply(m, CLEAN);
    };
    const r = await callOpenRouter(DEFAULT, [{ role: 'user', content: 'x'.repeat(18000) }], 1400, 'judge:test', undefined, (i) => starts.push(i));
    Date.now = realNow;
    check('tier 1 got exactly its 2 attempts', calls.filter((m) => m === DEFAULT).length === 2, String(calls.filter((m) => m === DEFAULT).length));
    check('tier 2 got exactly its 2 attempts', calls.filter((m) => m === TIER2).length === 2, String(calls.filter((m) => m === TIER2).length));
    check('reached tier 3 and succeeded', r.status === 'success' && r.model === TIER3, `${r.status}/${r.model}`);
    check('attempt counter advances (no permanent "first attempt")', starts.some((s) => s.attemptInTier === 2), JSON.stringify(starts.map((s) => s.attemptInTier)));
    check('every discarded attempt is visible in the log', (r.discardedAttempts || []).length === 4, String((r.discardedAttempts || []).length));
  });

  // ------------------------------------------------------------------ 4
  await test('Fast 429 bounces do NOT burn tier attempts', async () => {
    // The over-correction: two burst 429s (2.3s and 2.9s in the real trial)
    // consumed tier 1 entirely and escalated to a costlier tier in ~5 seconds.
    // (Every tier here is a paid model; tier 1 is simply the cheapest by far.)
    const calls = [];
    global.fetch = async (_u, o) => {
      const m = JSON.parse(o.body).model;
      calls.push(m);
      return m === DEFAULT && calls.filter((c) => c === DEFAULT).length <= 2 ? rateLimited() : reply(m, CLEAN);
    };
    const r = await callOpenRouter(DEFAULT, [{ role: 'user', content: 'hi' }], 1400, 'rep:test');
    check('stayed on the cheap default model', r.model === DEFAULT, r.model);
    check('never escalated to a costlier tier', !calls.includes(TIER2), JSON.stringify(calls));
    check('succeeded once the burst cleared', r.status === 'success', r.status);
    check('the 429s are still logged', (r.discardedAttempts || []).length === 2, String((r.discardedAttempts || []).length));
    check('logged as not counted against the tier', (r.discardedAttempts || []).every((d) => /not counted against it/.test(d.errorMessage)), (r.discardedAttempts || [])[0]?.errorMessage);
  });

  // ------------------------------------------------------------------ 5
  await test('A tier that is rate limited forever still escalates (fast path is bounded)', async () => {
    const calls = [];
    global.fetch = async (_u, o) => {
      const m = JSON.parse(o.body).model;
      calls.push(m);
      return m === DEFAULT ? rateLimited() : reply(m, CLEAN);
    };
    const r = await callOpenRouter(DEFAULT, [{ role: 'user', content: 'hi' }], 1400, 'rep:test');
    const n = calls.filter((c) => c === DEFAULT).length;
    check('was patient with the cheap model', n > 2, String(n));
    check('but bounded - did not loop forever', n <= 7, String(n));
    check('escalated and succeeded', r.status === 'success' && calls.includes(TIER2), `${r.status}/${JSON.stringify(calls.slice(-2))}`);
  });

  // ------------------------------------------------------------------ 6
  await test('A removed model id is skipped after exactly one attempt', async () => {
    const calls = [];
    global.fetch = async (_u, o) => {
      const m = JSON.parse(o.body).model;
      calls.push(m);
      if (m === DEFAULT) return reply(m, 'cut off mid-', 'length', 1400);
      if (m === TIER2) return notFound(m);
      return reply(m, CLEAN);
    };
    const r = await callOpenRouter(DEFAULT, [{ role: 'user', content: 'hi' }], 1400, 'rep:test');
    check('only one call wasted on the dead model', calls.filter((c) => c === TIER2).length === 1, String(calls.filter((c) => c === TIER2).length));
    check('succeeded at the next tier', r.status === 'success' && r.model === TIER3, `${r.status}/${r.model}`);
  });

  // ------------------------------------------------------------------ 7
  await test('Per-attempt timeout scales with prompt size, and is always an integer', async () => {
    // AbortSignal.timeout() throws on a non-integer, which would fail any
    // call whose estimated prompt token count is odd.
    const timeouts = [];
    global.fetch = async (_u, o) => { return reply(JSON.parse(o.body).model, CLEAN); };
    for (const [label, chars] of [['rep', 4120], ['judge', 18200], ['odd', 4001]]) {
      captured.length = 0;
      await callOpenRouter(DEFAULT, [{ role: 'user', content: 'x'.repeat(chars) }], 1400, `${label}:t`);
      const line = captured.find((l) => l.includes(`${label}:t`) && l.includes('timeout='));
      timeouts.push(Number(line.match(/timeout=(\d+)ms/)[1]));
    }
    const [rep, judge, odd] = timeouts;
    check('a judge prompt gets a larger ceiling than a representative', judge > rep + 5000, `${rep} vs ${judge}`);
    check('the judge ceiling clears the real 43.2s worst case', judge > 53000, String(judge));
    check('an odd token estimate still yields an integer', Number.isInteger(odd), String(odd));
  });

  // ------------------------------------------------------------------ 8
  await test('Abort stops the chain rather than spending more', async () => {
    const calls = [];
    let userAborted = false;
    global.fetch = async (_u, o) => { calls.push(JSON.parse(o.body).model); userAborted = true; throwTimeout(); };
    const r = await callOpenRouter(DEFAULT, [{ role: 'user', content: 'hi' }], 1400, 'judge:test', undefined, undefined, () => userAborted);
    check('made no further attempt after the abort', calls.length === 1, JSON.stringify(calls));
    check('reported as an abort, not a generic failure', r.status === 'failed' && r.errorMessage.startsWith('[aborted-mid-call]'), r.errorMessage);
    check('never reached a costlier tier', !calls.includes(TIER2), JSON.stringify(calls));
  });

  // ------------------------------------------------------------------ 9
  await test('When everything fails, the failure is honest about it', async () => {
    global.fetch = async () => throwTimeout();
    const r = await callOpenRouter(DEFAULT, [{ role: 'user', content: 'hi' }], 1400, 'rep:test');
    check('terminal failure', r.status === 'failed', r.status);
    check('says every tier was tried', /Every model tier was tried/.test(r.errorMessage), r.errorMessage);
  });

  console.log = realLog;
  console.warn = realWarn;
  fs.rmSync(OUT, { recursive: true, force: true });
  say(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.log = realLog;
  console.warn = realWarn;
  say('SUITE ERROR:', e);
  process.exit(1);
});
