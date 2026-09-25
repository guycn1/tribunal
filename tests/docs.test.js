/**
 * @file Checks that the documentation says what the code does: README.md,
 * SPEC.md, and the requirement sections of CLAUDE.md.
 *
 * Run with `npm test`. No network. Every fact the docs restate from the code
 * - a file, a route, a column, a threshold, a price, a badge - is compared
 * against its source here, so changing one without the other fails this
 * suite instead of leaving the docs quietly wrong. Where the fact is about
 * behaviour, it is checked by running the real code (the backend compiled
 * from its TypeScript, app.js against a stub DOM), not by reading its text.
 *
 * CLAUDE.md's running status log is deliberately not checked: it records
 * what was true when each entry was written, and is not meant to change
 * afterwards.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { compileBackend, ROOT } = require('./support/compile-backend');
const { fakeSupabase, useFakeSupabase } = require('./support/fake-supabase');
const { installDom, loadApp } = require('./support/load-app');

let failures = 0;
/**
 * Records and prints one assertion. A failure is counted rather than thrown,
 * so every check in the file runs and reports.
 *
 * @param {string} name
 * @param {unknown} condition Truthy to pass.
 * @param {unknown} [detail] Printed after a failure, to show what was
 *   actually found.
 */
function check(name, condition, detail) {
  if (condition) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}${detail !== undefined ? ` :: ${detail}` : ''}`);
  }
}

/**
 * Reads a repository file as text, with line endings normalised.
 * @param {...string} parts Path segments relative to the repository root.
 * @returns {string}
 */
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');

const README = read('README.md');
const SPEC = read('SPEC.md');
const CLAUDE = read('CLAUDE.md');
const SCHEMA = read('supabase', 'schema.sql');
const TOML = read('netlify.toml');
const PKG = JSON.parse(read('package.json'));
const ENV_EXAMPLE = read('.env.example');
const OPENROUTER_SRC = read('netlify', 'functions', 'lib', 'openrouter.ts');

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
/**
 * The number a written-out word stands for ("six" -> 6), or NaN.
 * @param {string | undefined} word
 * @returns {number}
 */
const wordToNumber = (word) => (word ? NUMBER_WORDS.indexOf(word.toLowerCase()) : -1) >= 0 ? NUMBER_WORDS.indexOf(word.toLowerCase()) : NaN;

/**
 * One section of a Markdown document: from its heading line up to the next
 * heading of the same or a higher level.
 *
 * @param {string} doc
 * @param {string} heading The heading line exactly, e.g. '### Database'.
 * @returns {string} '' when the heading is not found.
 */
function section(doc, heading) {
  const lines = doc.split('\n');
  const start = lines.indexOf(heading);
  if (start < 0) return '';
  const level = heading.match(/^#+/)[0].length;
  let end = start + 1;
  while (end < lines.length && !(lines[end].match(/^(#+) /) && lines[end].match(/^#+/)[0].length <= level)) end++;
  return lines.slice(start, end).join('\n');
}

/**
 * Every value in `a` that is not in `b`.
 * @template T
 * @param {Iterable<T>} a
 * @param {Iterable<T>} b
 * @returns {T[]}
 */
const minus = (a, b) => { const bs = new Set(b); return [...new Set(a)].filter((x) => !bs.has(x)); };

/**
 * Text normalised for comparing prose across Markdown and SQL: emphasis
 * markers dropped, curly quotes straightened, whitespace collapsed.
 * @param {string} s
 * @returns {string}
 */
const norm = (s) => String(s ?? '').replace(/\*\*|\*|`/g, '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();

// ------------------------------------------------------------ the schema
/**
 * @typedef {object} TableInfo
 * @property {string[]} columns
 * @property {Record<string, string[]>} checks Allowed values, by column.
 * @property {boolean} keyedByTrialAndRole Unique or primary key on (trial_id, role).
 * @property {boolean} cascades trial_id references trials(id) on delete cascade.
 */
/** @type {Record<string, TableInfo>} */
const TABLES = {};
for (const m of SCHEMA.matchAll(/create table if not exists (\w+) \(([\s\S]*?)\n\);/g)) {
  const body = m[2];
  TABLES[m[1]] = {
    columns: [...body.matchAll(/^\s+"?([a-z_]+)"?\s+(?!\()/gm)].map((c) => c[1]).filter((c) => c !== 'primary' && c !== 'unique'),
    checks: Object.fromEntries([...body.matchAll(/check \((\w+) in \(([^)]*)\)\)/g)].map((c) => [c[1], [...c[2].matchAll(/'([^']*)'/g)].map((v) => v[1])])),
    keyedByTrialAndRole: /(unique|primary key) \(trial_id, role\)/.test(body),
    cascades: /trial_id uuid not null references trials\(id\) on delete cascade/.test(body),
  };
}

/** The case record as schema.sql seeds it. */
const SEED = (() => {
  const values = (SCHEMA.split(') values (')[1] || '').split('\non conflict')[0];
  const strings = [...values.matchAll(/E?'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
  const [, , accused, deceased, actAlleged, background, facts, question, scopeNote] = strings;
  return {
    accused, deceased, actAlleged, question, scopeNote,
    background: (background || '').split('\\n\\n'),
    agreedFacts: facts ? JSON.parse(facts) : [],
  };
})();

// ------------------------------------------------------------ the repository
/** Every file that is or would be committed: tracked, plus new and not ignored. */
const REPO_FILES = (() => {
  try {
    return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
      .trim().split('\n').filter((f) => f && fs.existsSync(path.join(ROOT, f)));
  } catch (error) {
    return null;
  }
})();

/**
 * Whether git ignores a path - true even for one that does not exist.
 * @param {string} relPath
 * @returns {boolean}
 */
function isGitIgnored(relPath) {
  try {
    execFileSync('git', ['check-ignore', '-q', relPath], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Every .ts file under netlify/functions/, as [relative path, source]. */
const FUNCTION_SOURCES = (() => {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (rel.endsWith('.ts')) out.push([rel, read(rel)]);
    }
  };
  walk('netlify/functions');
  return out;
})();
const functionSource = (name) => read('netlify', 'functions', `${name}.ts`);

async function main() {
  // The backend, compiled once for every behavioural check below, with its
  // Supabase client pointed at an in-memory stand-in.
  const backend = compileBackend(['lib/openrouter.ts', 'lib/representatives.ts', 'lib/judges.ts', 'lib/pricing.ts', 'trials.ts', 'trial.ts', 'case.ts', 'abort.ts']);
  useFakeSupabase(backend.outDir);

  // ======================================================== README: layout
  console.log('\n=== README: the project layout lists every file, and only real ones ===');
  const layout = section(README, '## Project layout');
  const treeBlock = (layout.match(/```text\n([\s\S]*?)```/) || [])[1] || '';
  check('the layout section has a file tree', treeBlock.length > 0);

  const tree = [];
  const malformed = [];
  const stack = [];
  for (const line of treeBlock.split('\n')) {
    if (!line.trim() || line.trim() === '.') continue;
    const m = line.match(/^([│ ]*)(?:├── |└── )(.*)$/);
    if (!m) { malformed.push(line); continue; }
    const depth = [...m[1]].length / 4;
    const [namePart, ...rest] = m[2].split(/ {2,}/);
    const names = namePart.split(', ');
    stack.length = depth;
    for (const name of names) tree.push({ path: [...stack, name].join('').replace(/\/$/, ''), isDir: name.endsWith('/'), comment: rest.join(' ').trim() });
    if (names.length === 1 && names[0].endsWith('/')) stack[depth] = names[0];
  }
  check('every tree line parses', malformed.length === 0, malformed.join(' | '));
  check('git could list the repository', REPO_FILES !== null);
  const treeFiles = tree.filter((t) => !t.isDir).map((t) => t.path);
  check('every repository file is in the tree', REPO_FILES && minus(REPO_FILES, treeFiles).length === 0, REPO_FILES && minus(REPO_FILES, treeFiles).join(', '));
  check('every file in the tree exists', minus(treeFiles, REPO_FILES || []).length === 0, minus(treeFiles, REPO_FILES || []).join(', '));
  const missingDirs = tree.filter((t) => t.isDir && !(fs.existsSync(path.join(ROOT, t.path)) && fs.statSync(path.join(ROOT, t.path)).isDirectory()));
  check('every directory in the tree exists', missingDirs.length === 0, missingDirs.map((t) => t.path).join(', '));

  // ======================================================== README: endpoints
  console.log('\n=== README: the endpoint table matches netlify.toml and the handlers ===');
  const api = section(README, '### API endpoints');
  const rows = [...api.matchAll(/^\| `(GET|POST|PUT|PATCH|DELETE)` \| `([^`]+)` \| `([\w-]+)\.ts` \| (.*) \|$/gm)]
    .map((m) => ({ method: m[1], path: m[2], fn: m[3], text: m[4] }));
  const redirects = [...TOML.matchAll(/from = "([^"]+)"\s*\n\s*to = "\/\.netlify\/functions\/([\w-]+)[^"]*"/g)].map((m) => ({ path: m[1], fn: m[2] }));
  check('the endpoint table has rows', rows.length > 0);
  check('netlify.toml has routes', redirects.length > 0);
  for (const r of redirects) {
    const hits = rows.filter((row) => row.path === r.path);
    check(`${r.path} is documented, as ${r.fn}.ts`, hits.length > 0 && hits.every((h) => h.fn === r.fn), hits.map((h) => h.fn).join(', ') || 'missing');
  }
  const unrouted = rows.filter((row) => !redirects.some((r) => r.path === row.path));
  check('every documented route exists in netlify.toml', unrouted.length === 0, unrouted.map((r) => r.path).join(', '));

  const documentedFns = [...new Set(rows.map((r) => r.fn))];
  // Checked first, and the rest of this section only looks at functions that
  // exist: a README row naming a missing file must fail here, not crash the
  // suite on the read or require of a file that is not there.
  const missingFns = documentedFns.filter((fn) => !fs.existsSync(path.join(ROOT, 'netlify', 'functions', `${fn}.ts`)));
  check('every function the table names exists', missingFns.length === 0, missingFns.join(', '));
  for (const fn of documentedFns.filter((f) => !missingFns.includes(f))) {
    const handled = [...functionSource(fn).matchAll(/httpMethod (?:===|!==) '([A-Z]+)'/g)].map((m) => m[1]);
    const listed = rows.filter((r) => r.fn === fn).map((r) => r.method);
    check(`${fn}.ts: the documented methods are exactly the ones it accepts`, minus(handled, listed).length === 0 && minus(listed, handled).length === 0, `accepts ${[...new Set(handled)]}, documented ${listed}`);
  }
  // Status codes and the site gate, by calling each synchronous handler
  // against an in-memory database. Reading the source cannot settle this:
  // trials.ts returns 200 for GET and 201 for POST, so "the file contains
  // json(200," would wrongly vouch for a README that said POST answers 200.
  const TRIAL_ID = '0d6f6a8e-4a3c-4d7e-9b52-1f0a2b3c4d5e';
  const UNKNOWN_ID = '9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b';
  const GATE = 'docs-test-gate';
  const caseRow = { case_code: 'T-001', title: 'The Realm v. Jon Snow', accused: SEED.accused, deceased: SEED.deceased, act_alleged: SEED.actAlleged, background: SEED.background.join('\n\n'), agreed_facts: SEED.agreedFacts, question: SEED.question, scope_note: SEED.scopeNote };
  /**
   * Calls one real handler against a fresh in-memory database holding the
   * case and one trial, and returns the status code it answers with.
   * @param {string} fn The function file's name, without .ts.
   * @param {string} method
   * @param {string} urlPath
   * @param {{headers?: Record<string, string>, body?: string}} [request]
   * @returns {Promise<number>}
   */
  const invoke = async (fn, method, urlPath, { headers = {}, body } = {}) => {
    global.fakeSupabase = fakeSupabase({
      case_definitions: [{ ...caseRow }],
      trials: [{ id: TRIAL_ID, case_code: 'T-001', status: 'created', created_at: '1', updated_at: '1' }],
      representative_arguments: [], judge_rulings: [], api_call_logs: [], agent_progress: [],
    }).client;
    const response = await backend.load(`${fn}.js`).handler({ httpMethod: method, path: urlPath, headers, queryStringParameters: {}, body }, {});
    return response.statusCode;
  };
  for (const row of rows.filter((r) => !r.fn.endsWith('-background') && !missingFns.includes(r.fn))) {
    const body = row.path.endsWith('/abort') ? JSON.stringify({ roles: ['barak'] }) : undefined;
    process.env.SITE_GATE_TOKEN = GATE;
    const correct = await invoke(row.fn, row.method, row.path.replace(':id', TRIAL_ID), { headers: { 'x-site-gate': GATE }, body });
    const withoutGate = await invoke(row.fn, row.method, row.path.replace(':id', TRIAL_ID), { body });
    const unknownTrial = row.path.includes(':id') ? await invoke(row.fn, row.method, row.path.replace(':id', UNKNOWN_ID), { headers: { 'x-site-gate': GATE }, body }) : null;
    delete process.env.SITE_GATE_TOKEN;
    const observed = [correct, withoutGate, unknownTrial].filter((c) => c !== null);
    check(`${row.method} ${row.path} succeeds when called correctly`, correct >= 200 && correct < 300, String(correct));
    for (const code of [...row.text.matchAll(/`(\d{3})`/g)].map((m) => Number(m[1]))) {
      check(`${row.method} ${row.path}: it really answers ${code}`, observed.includes(code), observed.join(', '));
    }
    const gated = withoutGate === 401;
    check(`${row.method} ${row.path}: the site-gate header is ${gated ? '' : 'not '}required, and the README agrees`, gated === /site-gate/.test(row.text), `without the header: ${withoutGate}`);
  }
  for (const fnTree of tree.filter((t) => t.path.startsWith('netlify/functions/') && !t.path.includes('/lib/') && t.path.endsWith('.ts'))) {
    const fn = path.basename(fnTree.path, '.ts');
    // Exactly, not by substring: "GET /api/cases" contains "/api/case".
    const byPath = {};
    for (const r of rows.filter((row) => row.fn === fn)) (byPath[r.path] = byPath[r.path] || []).push(r.method);
    const expected = Object.entries(byPath).map(([p, methods]) => `${methods.join(' and ')} ${p}`).join('; ');
    check(`the tree's note on ${fn}.ts is its route: "${expected}"`, expected.length > 0 && fnTree.comment === expected, fnTree.comment);
  }

  const agentPara = (api.match(/^\*\*The (\w+) agent endpoints[^\n]*$/m) || [''])[0];
  check('the agent-endpoint paragraph is there', agentPara.length > 0);
  // Read from each function's exported config only: a comment that merely
  // mentions background:true must not count.
  const configOf = (src) => (src.match(/export const config = \{[\s\S]*?\n\};/) || [''])[0];
  const topLevel = FUNCTION_SOURCES.filter(([f]) => !f.includes('/lib/'));
  const backgroundFns = topLevel.filter(([, src]) => /background:\s*true/.test(configOf(src))).map(([f]) => path.basename(f, '.ts'));
  const suffixedFns = topLevel.map(([f]) => path.basename(f, '.ts')).filter((fn) => fn.endsWith('-background'));
  const documentedBackground = documentedFns.filter((fn) => fn.endsWith('-background'));
  check('the Background Functions are the ones documented as such', minus(backgroundFns, documentedBackground).length === 0 && minus(documentedBackground, backgroundFns).length === 0, `config: ${backgroundFns}, README: ${documentedBackground}`);
  // Local `netlify dev` recognises a Background Function by its -background
  // filename; the deployed platform by config.background. If the two ever
  // disagree, one of them runs the function synchronously - under a 10s or
  // 30s ceiling instead of 15 minutes.
  check('the -background filename and config.background agree', minus(backgroundFns, suffixedFns).length === 0 && minus(suffixedFns, backgroundFns).length === 0, `config: ${backgroundFns}, filename: ${suffixedFns}`);
  check(`"the ${(agentPara.match(/^\*\*The (\w+)/) || [])[1]} agent endpoints" is the right count`, wordToNumber((agentPara.match(/^\*\*The (\w+)/) || [])[1]) === backgroundFns.length, String(backgroundFns.length));
  const spenders = FUNCTION_SOURCES.filter(([f, src]) => !f.includes('/lib/') && /callOpenRouter\(/.test(src)).map(([f]) => path.basename(f, '.ts'));
  check('only the agent endpoints spend OpenRouter quota', minus(spenders, backgroundFns).length === 0 && minus(backgroundFns, spenders).length === 0, `callOpenRouter in: ${spenders}`);

  const gated = FUNCTION_SOURCES.filter(([f, src]) => !f.includes('/lib/') && /isSiteGateOk\(/.test(src)).map(([f]) => path.basename(f, '.ts'));
  const documentedGated = [...new Set([...rows.filter((r) => /site-gate/.test(r.text)).map((r) => r.fn), ...(/site-gate/.test(agentPara) ? backgroundFns : [])])];
  check('the site-gate header is documented on exactly the endpoints that check it', minus(gated, documentedGated).length === 0 && minus(documentedGated, gated).length === 0, `code: ${gated}, README: ${documentedGated}`);

  const rate = agentPara.match(/(\d+) requests per (\d+) minutes/);
  check('the per-IP rate limit is stated', Boolean(rate));
  for (const fn of rate ? backgroundFns : []) {
    const src = functionSource(fn);
    const limit = Number((src.match(/windowLimit:\s*(\d+)/) || [])[1]);
    const windowSeconds = Number((src.match(/windowSize:\s*(\d+)/) || [])[1]);
    check(`${fn}.ts: the rate limit is ${rate && rate[1]} requests per ${rate && rate[2]} minutes`, rate && limit === Number(rate[1]) && windowSeconds === Number(rate[2]) * 60, `${limit} per ${windowSeconds}s`);
  }

  const listLimit = Number((read('netlify', 'functions', 'lib', 'db.ts').match(/function listTrials\(limit = (\d+)\)/) || [])[1]);
  check(`GET /api/trials returns the ${listLimit} most recent trials`, api.includes(`The ${listLimit} most recent trials`), String(listLimit));

  // ======================================================== README: database
  console.log('\n=== README: the database section matches schema.sql ===');
  const db = section(README, '### Database');
  const tableNames = Object.keys(TABLES);
  check('schema.sql defines tables', tableNames.length > 0);
  const countClaims = [
    ['the Database section', (db.match(/^(\w+) tables in Supabase/m) || [])[1]],
    ['Local development', (section(README, '## Local development').match(/creates the (\w+) tables/) || [])[1]],
    ['the layout tree', (treeBlock.match(/all (\w+) tables/) || [])[1]],
    ["schema.sql's own header", (SCHEMA.match(/^-- (\w+) tables:/m) || [])[1]],
  ];
  for (const [where, word] of countClaims) check(`${where} says there are ${tableNames.length} tables`, wordToNumber(word) === tableNames.length, word);

  const paragraphs = Object.fromEntries([...db.matchAll(/^\*\*`(\w+)`\*\* — (.*)$/gm)].map((m) => [m[1], m[2]]));
  check('every table has a paragraph', minus(tableNames, Object.keys(paragraphs)).length === 0, minus(tableNames, Object.keys(paragraphs)).join(', '));
  check('every paragraph is about a real table', minus(Object.keys(paragraphs), tableNames).length === 0, minus(Object.keys(paragraphs), tableNames).join(', '));
  const BOOKKEEPING = ['id', 'created_at', 'updated_at'];
  const markerValues = [...OPENROUTER_SRC.matchAll(/export const [A-Z0-9_]+_MARKER = '([^']+)'/g)].map((m) => m[1]);
  for (const [table, info] of Object.entries(TABLES)) {
    const para = paragraphs[table] || '';
    const named = [...para.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    const unnamed = info.columns.filter((c) => !BOOKKEEPING.includes(c) && !named.includes(c));
    check(`${table}: every column is named`, unnamed.length === 0, unnamed.join(', '));
    const bogus = named.filter((n) => /^[a-z][a-z0-9_]*$/.test(n) && n.includes('_') && !info.columns.includes(n) && !tableNames.includes(n));
    check(`${table}: every column named exists`, bogus.length === 0, bogus.join(', '));
    const badMarkers = named.filter((n) => n.startsWith('[') && !markerValues.includes(n));
    check(`${table}: every marker named is a real one`, badMarkers.length === 0, badMarkers.join(', '));
    for (const [column, allowed] of Object.entries(info.checks)) {
      if (column === 'role') continue; // the roles are checked against the code below, in the endpoint paragraph
      const missing = allowed.filter((v) => !named.includes(v));
      check(`${table}: every allowed ${column} value is listed`, missing.length === 0, missing.join(', '));
    }
    check(`${table}: "one row per trial and role" is claimed exactly when the schema enforces it`, /one row per trial and role/i.test(para) === info.keyedByTrialAndRole, `schema: ${info.keyedByTrialAndRole}`);
  }
  const ownershipBullet = (db.match(/^- Every table except ([^\n]*?) belongs to a single trial[^\n]*$/m) || [])[0] || '';
  const excepted = [...(ownershipBullet.split('belongs')[0] || '').matchAll(/`(\w+)`/g)].map((m) => m[1]);
  const withTrialId = tableNames.filter((t) => TABLES[t].columns.includes('trial_id'));
  check('the tables said to belong to a trial are exactly the ones with trial_id', ownershipBullet && minus(minus(tableNames, excepted), withTrialId).length === 0 && minus(withTrialId, minus(tableNames, excepted)).length === 0, `with trial_id: ${withTrialId}`);
  check('deleting a trial deletes its rows everywhere (on delete cascade)', /deleting a trial deletes its rows/.test(ownershipBullet) && withTrialId.every((t) => TABLES[t].cascades), withTrialId.filter((t) => !TABLES[t].cascades).join(', '));
  const rls = new Set([...SCHEMA.matchAll(/alter table (\w+) enable row level security/g)].map((m) => m[1]));
  check('row-level security is on for every table, with no policies', /Row-level security is on for all \w+ tables, with no policies/.test(db) && tableNames.every((t) => rls.has(t)) && !/create policy/i.test(SCHEMA));
  const logWrites = FUNCTION_SOURCES.filter(([, src]) => /from\('api_call_logs'\)\s*\.(update|upsert|delete)\(/.test(src)).map(([f]) => f);
  check('api_call_logs is appended and never updated', /appended and never updated/.test(paragraphs.api_call_logs || '') && logWrites.length === 0, logWrites.join(', '));
  check('agent_progress is overwritten in place', /overwritten/.test(paragraphs.agent_progress || '') && FUNCTION_SOURCES.some(([, src]) => /from\('agent_progress'\)\.upsert\(/.test(src)));
  const caseInCode = [...FUNCTION_SOURCES.map(([f, src]) => [f, src]), ['public/app.js', read('public', 'app.js')]].filter(([, src]) => SEED.agreedFacts.some((fact) => src.includes(fact.slice(0, 60))));
  check('the case text lives only in the database, not in code', /reads the case from here at runtime/.test(paragraphs.case_definitions || '') && caseInCode.length === 0, caseInCode.map(([f]) => f).join(', '));

  // ======================================================== README: numbers the code sets
  console.log('\n=== README: the escalation chain, detectors and prices match the code ===');
  process.env.OPENROUTER_API_KEY = 'test-key';
  const { callOpenRouter } = backend.load('lib/openrouter.js');
  const { calculateCost } = backend.load('lib/pricing.js');
  const { REPRESENTATIVES } = backend.load('lib/representatives.js');
  const { JUDGES } = backend.load('lib/judges.js');
  const realLog = console.log;
  const realWarn = console.warn;
  /**
   * Runs `fn` with the backend's per-attempt console logging suppressed.
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  const quietly = async (fn) => {
    console.log = console.warn = () => {};
    try { return await fn(); } finally { console.log = realLog; console.warn = realWarn; }
  };
  /**
   * A mocked OpenRouter reply.
   * @param {string} model
   * @param {string} content
   * @param {string} [finishReason='stop']
   */
  const reply = (model, content, finishReason = 'stop') => ({
    ok: true, status: 200, headers: new Map(),
    json: async () => ({ model, choices: [{ message: { content }, finish_reason: finishReason }], usage: { prompt_tokens: 1000, completion_tokens: 400, total_tokens: 1400 } }),
  });
  const DEFAULT = 'mistralai/mistral-small-24b-instruct-2501';
  const CLEAN = 'The bells had already rung when she turned the dragon on the city. That is the fact this tribunal cannot reason past.';

  // Every attempt truncated: the chain walks every tier, using every attempt.
  const calls = [];
  global.fetch = async (_url, request) => { const m = JSON.parse(request.body).model; calls.push(m); return reply(m, 'cut off mid-', 'length'); };
  await quietly(() => callOpenRouter(DEFAULT, [{ role: 'user', content: 'hi' }], 1400, 'docs:chain'));
  const tiers = [];
  for (const m of calls) (tiers.length && tiers[tiers.length - 1].model === m ? tiers[tiers.length - 1].attempts++ : tiers.push({ model: m, attempts: 1 }));
  const chainText = section(README, '## Architecture').match(/`default model \((\d+) attempts?\) → ([\w.-]+) \((\d+) attempts?\) → a top-tier model \((\d+) attempts?\) → a last-resort model \((\d+) attempts?\)`/);
  check('the chain is written out', Boolean(chainText));
  const tierWord = (README.match(/A (\d+)-tier model escalation chain/) || [])[1];
  check(`the chain has ${tierWord} tiers`, Number(tierWord) === tiers.length, tiers.map((t) => t.model).join(' -> '));
  if (chainText) {
    const documentedAttempts = [chainText[1], chainText[3], chainText[4], chainText[5]].map(Number);
    check('each tier gets the documented number of attempts', JSON.stringify(tiers.map((t) => t.attempts)) === JSON.stringify(documentedAttempts), `code ${tiers.map((t) => t.attempts)}, README ${documentedAttempts}`);
    check(`tier 2 is ${chainText[2]}`, tiers[1] && tiers[1].model.endsWith(`/${chainText[2]}`), tiers[1] && tiers[1].model);
  }
  const paid = tiers.filter((t) => !t.model.endsWith(':free') && calculateCost(t.model, 1e6, 1e6) > 0);
  check('every tier is a paid model', /Every tier in the chain is a paid model/.test(README) && paid.length === tiers.length, tiers.filter((t) => !paid.includes(t)).map((t) => t.model).join(', '));
  const prices = README.match(/the default is \$([\d.]+)\/\$([\d.]+) per million prompt\/completion tokens, the next is \$([\d.]+)\/\$([\d.]+)/);
  check('the prices are stated', Boolean(prices));
  if (prices && tiers.length >= 2) {
    const perMillion = (model) => [calculateCost(model, 1e6, 0), calculateCost(model, 0, 1e6)];
    check(`the default costs $${prices[1]}/$${prices[2]}`, JSON.stringify(perMillion(tiers[0].model)) === JSON.stringify([Number(prices[1]), Number(prices[2])]), perMillion(tiers[0].model).join('/'));
    check(`tier 2 costs $${prices[3]}/$${prices[4]}`, JSON.stringify(perMillion(tiers[1].model)) === JSON.stringify([Number(prices[3]), Number(prices[4])]), perMillion(tiers[1].model).join('/'));
  }

  /**
   * Whether the default model's reply is accepted on the first attempt.
   * @param {string} content
   * @returns {Promise<boolean>}
   */
  const acceptedFirstTime = async (content) => {
    const seen = [];
    global.fetch = async (_url, request) => { const m = JSON.parse(request.body).model; seen.push(m); return reply(m, m === DEFAULT ? content : CLEAN); };
    await quietly(() => callOpenRouter(DEFAULT, [{ role: 'user', content: 'hi' }], 1400, 'docs:detector'));
    return seen.length === 1;
  };
  const runOnClaims = [...README.matchAll(/a (\d+)\+ word run/g)].map((m) => Number(m[1]));
  check('the run-on threshold is stated', runOnClaims.length > 0);
  if (runOnClaims.length) {
    const n = runOnClaims[0];
    const words = (count) => Array.from({ length: count }, (_, i) => `word${i}`).join(' ');
    check(`a ${n}-word run is caught`, !(await acceptedFirstTime(`${words(n)}.`)));
    check(`a ${n - 1}-word run is not`, await acceptedFirstTime(`${words(n - 1)}.`));
  }
  const repeatClaims = [...README.matchAll(/the same whole sentence (?:repeated )?(\d+)\+ times/g)].map((m) => Number(m[1]));
  check('the repeated-sentence threshold is stated, the same everywhere', repeatClaims.length > 0 && repeatClaims.every((n) => n === repeatClaims[0]), repeatClaims.join(', '));
  if (repeatClaims.length) {
    const n = repeatClaims[0];
    const repeated = (count) => 'The record is plain on this point. ' + 'He had no lawful authority to do it. '.repeat(count);
    check(`a sentence repeated ${n} times is caught`, !(await acceptedFirstTime(repeated(n))));
    check(`one repeated ${n - 1} times is not`, await acceptedFirstTime(repeated(n - 1)));
  }
  const fastClaims = [...README.matchAll(/under (\d+) seconds/g)].map((m) => Number(m[1]));
  check('the fast-failure threshold is stated, the same everywhere', fastClaims.length > 0 && fastClaims.every((n) => n === fastClaims[0]), fastClaims.join(', '));
  if (fastClaims.length) {
    /**
     * Whether a rate limit that takes `seconds` to come back is retried for free.
     * @param {number} seconds
     * @returns {Promise<boolean>}
     */
    const freeRetryAfter = async (seconds) => {
      const realNow = Date.now;
      let skew = 0;
      Date.now = () => realNow() + skew;
      let first = true;
      global.fetch = async (_url, request) => {
        const m = JSON.parse(request.body).model;
        if (first) { first = false; skew += seconds * 1000; return { ok: false, status: 429, headers: new Map(), text: async () => '{}' }; }
        return reply(m, CLEAN);
      };
      try {
        const result = await quietly(() => callOpenRouter(DEFAULT, [{ role: 'user', content: 'hi' }], 1400, 'docs:fast'));
        return /not counted against it/.test(((result.discardedAttempts || [])[0] || {}).errorMessage || '');
      } finally {
        Date.now = realNow;
      }
    };
    const n = fastClaims[0];
    check(`a rate limit back in ${n - 0.5}s does not cost a tier attempt`, await freeRetryAfter(n - 0.5));
    check(`one back in ${n + 0.5}s does`, !(await freeRetryAfter(n + 0.5)));
  }

  const knownRoles = (agentPara.match(/role is one it knows \(([^)]*)\)/) || [])[1] || '';
  const documentedRoles = [...knownRoles.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);
  const realRoles = [...Object.keys(REPRESENTATIVES), ...Object.keys(JUDGES)];
  check('the roles listed are exactly the real ones', documentedRoles.length > 0 && minus(realRoles, documentedRoles).length === 0 && minus(documentedRoles, realRoles).length === 0, documentedRoles.join(', '));
  backend.cleanup();

  // ======================================================== README: what the UI shows
  console.log('\n=== README: the badge tables match what app.js renders ===');
  installDom();
  const app = loadApp([
    'state', 'el', 'renderCallLog', 'trialStatusLabel', 'trialStatusClass', 'POLL_TIMEOUT_MS', 'INTERRUPTED_THRESHOLD_MS', 'TOTAL_EXPECTED_RESULTS', 'ABORTED_BY_USER_MESSAGE',
    'DEGENERATE_RETRIED_SAME_MODEL_MARKER', 'DEGENERATE_RETRIED_DIFF_MODEL_MARKER', 'DEGENERATE_FINAL_MARKER', 'HTTP_ERROR_ESCALATED_MARKER', 'TRANSIENT_RETRIED_MARKER', 'ABORTED_MID_CALL_MARKER',
  ]);
  // What each badge class looks like, in the words the README uses. Each is
  // confirmed below to be the class that really uses that colour variable,
  // so renaming a class or swapping its colour fails here.
  const CLASS_COLOUR = { 'badge-ok': ['green', '--ok'], 'badge-warn': ['amber', '--warn'], 'badge-fail': ['red', '--fail'], 'badge-aborted': ['grey', '--aborted'], 'badge-progress': ['slate', '--progress'] };
  const css = read('public', 'styles.css');
  for (const [cls, [, variable]] of Object.entries(CLASS_COLOUR)) {
    const rule = (css.match(new RegExp(`\\.${cls} \\{([^}]*)\\}`)) || [])[1] || '';
    check(`.${cls} is coloured by var(${variable})`, rule.includes(`color: var(${variable})`), rule.trim());
  }
  /**
   * Every badge in a rendered call-log row, as "label|colour".
   * @param {object} row An api_call_logs row, as the API returns it.
   * @returns {string[]}
   */
  const badgesFor = (row) => {
    app.state.maxTokens = 1400;
    app.state.callLog = [{ agentRole: 'grey_worm', callType: 'representative', modelUsed: DEFAULT, promptTokens: 1000, completionTokens: 600, totalTokens: 1600, cost: 0.0001, durationMs: 1000, timestamp: new Date().toISOString(), errorMessage: null, ...row }];
    app.renderCallLog();
    const html = (app.el.callLogBody.children[0] || {}).innerHTML || '';
    return [...html.matchAll(/<span class="badge (badge-[\w-]+)">([^<]+)<\/span>/g)].map((m) => `${m[2]}|${(CLASS_COLOUR[m[1]] || ['?' + m[1]])[0]}`);
  };
  const CAP = 'This attempt hit the max_tokens limit before finishing naturally';
  const LOOP = 'This attempt repeated the same sentence 5 times ("he had no other way...")';
  const rendered = new Set([
    { status: 'success' },
    { status: 'failed', errorMessage: 'OpenRouter returned HTTP 402.' },
    { status: 'failed', errorMessage: app.ABORTED_BY_USER_MESSAGE, modelUsed: 'n/a' },
    { status: 'success', completionTokens: 1400 },
    ...['DEGENERATE_RETRIED_SAME_MODEL_MARKER', 'DEGENERATE_RETRIED_DIFF_MODEL_MARKER', 'DEGENERATE_FINAL_MARKER'].flatMap((m) => [
      { status: 'failed', errorMessage: `${app[m]} ${CAP} - re-tried.` },
      { status: 'failed', errorMessage: `${app[m]} ${LOOP} - re-tried.` },
    ]),
    { status: 'failed', errorMessage: `${app.HTTP_ERROR_ESCALATED_MARKER} HTTP 404 - escalated.` },
    { status: 'failed', errorMessage: `${app.TRANSIENT_RETRIED_MARKER} timed out - re-tried.` },
    { status: 'failed', errorMessage: `${app.ABORTED_MID_CALL_MARKER} Stopped before attempt 2.` },
  ].flatMap(badgesFor));
  const callLogSection = section(README, '### Call log');
  const documentedCallLog = new Set([...callLogSection.matchAll(/^\| `([^`]+)` \| (\w+) \|/gm)].map((m) => `${m[1]}|${m[2]}`));
  check('the call log table is there', documentedCallLog.size > 0);
  check('every call-log badge app.js can render is in the table', minus(rendered, documentedCallLog).length === 0, minus(rendered, documentedCallLog).join(', '));
  check('every badge in the call log table is one app.js renders', minus(documentedCallLog, rendered).length === 0, minus(documentedCallLog, rendered).join(', '));

  const sidebarSection = section(README, '### Run history sidebar');
  const threshold = Number((sidebarSection.match(/under (\d+) minutes old/) || [])[1]);
  check('the interrupted threshold is stated', Number.isFinite(threshold));
  // Every trial state is rendered whatever the README says, so the tables are
  // compared even when the threshold sentence is missing: aged past the
  // code's own threshold, not the (absent) documented one.
  const pastThreshold = app.INTERRUPTED_THRESHOLD_MS / 60000 + 1;
  const now = Date.now();
  const sidebar = new Set();
  for (const wasAborted of [false, true]) {
    for (const status of ['completed', 'created']) {
      for (const resultCount of [app.TOTAL_EXPECTED_RESULTS, app.TOTAL_EXPECTED_RESULTS - 2]) {
        for (const ageMinutes of [1, pastThreshold]) {
          const trial = { wasAborted, status, resultCount, createdAt: new Date(now - ageMinutes * 60000).toISOString() };
          sidebar.add(`${app.trialStatusLabel(trial).replace(/\b\d+ of (\d+)/, 'N of $1')}|${(CLASS_COLOUR[app.trialStatusClass(trial)] || ['?'])[0]}`);
        }
      }
    }
  }
  const documentedSidebar = new Set([...sidebarSection.matchAll(/^\| `([^`]+)` \| (\w+) \|/gm)].map((m) => `${m[1]}|${m[2]}`));
  check('the sidebar table is there', documentedSidebar.size > 0);
  check('every sidebar badge app.js can render is in the table', minus(sidebar, documentedSidebar).length === 0, minus(sidebar, documentedSidebar).join(', '));
  check('every badge in the sidebar table is one app.js renders', minus(documentedSidebar, sidebar).length === 0, minus(documentedSidebar, sidebar).join(', '));
  if (Number.isFinite(threshold)) {
    const labelAt = (minutes) => app.trialStatusLabel({ wasAborted: false, status: 'created', resultCount: 0, createdAt: new Date(Date.now() - minutes * 60000).toISOString() });
    check(`a run is "In progress" just under ${threshold} minutes`, labelAt(threshold - 0.1) === 'In progress…', labelAt(threshold - 0.1));
    check(`and "Interrupted" just over`, labelAt(threshold + 0.1) === 'Interrupted', labelAt(threshold + 0.1));
    check(`"over ${threshold} minutes old" agrees`, sidebarSection.includes(`over ${threshold} minutes old`));
  }
  const budgetMs = Number((OPENROUTER_SRC.match(/const TOTAL_BUDGET_MS = (\d+);/) || [])[1]);
  const worstCase = (sidebarSection.match(/about (\d+) minutes/) || [])[1];
  check(`the worst case is about ${worstCase ?? '(not stated)'} minutes: two phases of the ${budgetMs / 1000}s budget`, Math.round((2 * budgetMs) / 60000) === Number(worstCase), String((2 * budgetMs) / 60000));
  const pollClaim = (api.match(/after about (\d+) minutes/) || [])[1];
  check(`polling gives up after about ${pollClaim ?? '(not stated)'} minutes`, Math.round(app.POLL_TIMEOUT_MS / 60000) === Number(pollClaim), String(app.POLL_TIMEOUT_MS / 60000));
  const expected = app.TOTAL_EXPECTED_RESULTS;
  const resultClaims = [...README.matchAll(/(?:all|its) (\d+)(?: of (\d+))? results/g)].flatMap((m) => [m[1], m[2]].filter(Boolean).map(Number));
  check(`every "N of ${expected} results" uses ${expected}`, resultClaims.length > 0 && resultClaims.every((n) => n === expected), resultClaims.join(', '));

  // ======================================================== README: local development
  console.log('\n=== README: setup and the test suites match package.json and .env.example ===');
  const local = section(README, '## Local development');
  const suites = [...(PKG.scripts.test || '').matchAll(/node (tests\/[\w.-]+\.js)/g)].map((m) => m[1]);
  const suiteFiles = (REPO_FILES || []).filter((f) => /^tests\/[^/]+\.test\.js$/.test(f));
  check('npm test runs every suite in tests/', minus(suiteFiles, suites).length === 0, minus(suiteFiles, suites).join(', '));
  check('npm test runs only suites that exist', suites.every((f) => fs.existsSync(path.join(ROOT, f))), suites.join(', '));
  const suiteWord = (local.match(/npm test\s+# (\w+) regression suites/) || [])[1];
  check(`"${suiteWord} regression suites" is the right count`, wordToNumber(suiteWord) === suites.length, String(suites.length));
  const describedSuites = [...local.matchAll(/`(tests\/[\w.-]+\.test\.js)`/g)].map((m) => m[1]);
  check('the suite descriptions cover exactly the suites npm test runs', minus(suites, describedSuites).length === 0 && minus(describedSuites, suites).length === 0, `described: ${describedSuites}`);
  for (const m of local.matchAll(/^npm run (\w+)\s+# (.+)$/gm)) {
    check(`npm run ${m[1]} is "${(PKG.scripts[m[1]] || '').trim()}"`, PKG.scripts[m[1]] && m[2].startsWith(PKG.scripts[m[1]]), PKG.scripts[m[1]]);
  }
  const envVars = [...ENV_EXAMPLE.matchAll(/^#? ?([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]);
  const readVars = [...new Set(FUNCTION_SOURCES.flatMap(([, src]) => [...src.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1])))].filter((v) => v !== 'NETLIFY_DEV');
  const roleVars = [...read('netlify', 'functions', 'lib', 'models.ts').matchAll(/'(MODEL_[A-Z_]+)'/g)].map((m) => m[1]);
  check('.env.example lists every variable the backend reads', minus([...readVars, ...roleVars], envVars).length === 0, minus([...readVars, ...roleVars], envVars).join(', '));
  check('.env.example lists nothing the backend does not read', minus(envVars, [...readVars, ...roleVars]).length === 0, minus(envVars, [...readVars, ...roleVars]).join(', '));
  const required = ENV_EXAMPLE.split(/\n\s*\n/).filter((block) => /\(required\)/.test(block)).flatMap((block) => [...block.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
  const toFillIn = [...(local.match(/# fill in ([A-Z0-9_, ]+)/) || ['', ''])[1].matchAll(/[A-Z][A-Z0-9_]+/g)].map((m) => m[0]);
  check('README asks for exactly the required variables', required.length > 0 && minus(required, toFillIn).length === 0 && minus(toFillIn, required).length === 0, `required: ${required}, README: ${toFillIn}`);
  check('the bundler is esbuild, as the tech stack says', /esbuild/.test(section(README, '## Tech stack')) && /node_bundler = "esbuild"/.test(TOML));

  // ======================================================== paths named anywhere
  console.log('\n=== README and SPEC.md: every file they name exists ===');
  for (const [doc, text] of [['README.md', README], ['SPEC.md', SPEC]]) {
    const named = [...new Set([...text.matchAll(/`([^`\s]+)`/g)].map((m) => m[1]))]
      .filter((t) => t !== 'n/a' && !t.startsWith('/') && (t.includes('/') || /\.(ts|js|md|sql|toml|json|css|html|example)$/.test(t)))
      // Git-ignored paths are named on purpose, as things that are generated
      // locally and never committed (node_modules/, .netlify/) - so a fresh
      // clone rightly lacks them. Checking them would make this suite pass
      // or fail depending on what has been run in the working copy.
      .filter((t) => !isGitIgnored(t));
    const missing = named.filter((t) => {
      if (t.includes('/')) return !fs.existsSync(path.join(ROOT, t));
      return !(REPO_FILES || []).some((f) => path.basename(f) === t);
    });
    check(`${doc}: all ${named.length} file names resolve`, named.length > 0 && missing.length === 0, missing.join(', '));
  }

  // ======================================================== SPEC.md and CLAUDE.md
  console.log('\n=== SPEC.md and CLAUDE.md: the case is the one the app serves ===');
  const seedParts = [['accused', SEED.accused], ['deceased', SEED.deceased], ['act alleged', SEED.actAlleged], ['question', SEED.question], ['scope note', SEED.scopeNote],
    ...SEED.background.map((p, i) => [`background paragraph ${i + 1}`, p]), ...SEED.agreedFacts.map((f, i) => [`stipulated fact ${i + 1}`, f])];
  check('the seed parsed', seedParts.every(([, v]) => typeof v === 'string' && v.length > 0) && SEED.agreedFacts.length > 0, seedParts.filter(([, v]) => !v).map(([k]) => k).join(', '));
  for (const [doc, text] of [['SPEC.md section 1', section(SPEC, '## 1. The charge sheet')], ['CLAUDE.md Part 1', section(CLAUDE, '## Part 1 — The canonical charge sheet (fixed content, not user input)')]]) {
    const body = norm(text);
    const differ = seedParts.filter(([, v]) => !body.includes(norm(v))).map(([k]) => k);
    check(`${doc} matches the seeded case word for word`, text.length > 0 && differ.length === 0, differ.join(', ') || (text ? '' : 'section missing'));
  }

  console.log('\n=== SPEC.md, CLAUDE.md and README agree with the schema on what is logged ===');
  const specFields = ((SPEC.match(/Every model call is logged with: ([^.]+)\./) || [])[1] || '').split(/, (?:and )?| and /).map((f) => f.trim().replace(/ /g, '_'));
  const claudeFields = ((CLAUDE.match(/every call must log `([^`]+)`/) || [])[1] || '').split(/,\s*/);
  // Parentheticals dropped first: they hold a field's allowed values, such
  // as (`success` or `failed`), not further fields.
  const readmeFields = [...((paragraphs.api_call_logs || '').match(/requires for every call — (.*?) — plus/) || ['', ''])[1].replace(/\([^)]*\)/g, '').matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);
  const logColumns = (TABLES.api_call_logs || { columns: [] }).columns;
  for (const [doc, fields] of [['SPEC.md', specFields], ['CLAUDE.md Part 5', claudeFields], ['README', readmeFields]]) {
    check(`${doc}: every required log field is a real column`, fields.length > 1 && minus(fields, logColumns).length === 0, minus(fields, logColumns).join(', ') || String(fields.length));
  }
  check('all three list the same fields', minus(specFields, claudeFields).length === 0 && minus(claudeFields, specFields).length === 0 && minus(readmeFields, specFields).length === 0 && minus(specFields, readmeFields).length === 0, `SPEC ${specFields} | CLAUDE ${claudeFields} | README ${readmeFields}`);

  console.log('\n=== The verdict vocabulary is the same everywhere ===');
  const schemaVerdicts = ((TABLES.judge_rulings || { checks: {} }).checks.verdict) || [];
  const parserVerdicts = ((read('netlify', 'functions', 'lib', 'prompts.ts').match(/VERDICT:\\s\*\(([^)]*)\)/) || ['', ''])[1]).split('|');
  const readmeVerdicts = [...agentPara.matchAll(/`VERDICT: ([a-z ]+)`/g)].map((m) => m[1]);
  const specVocabulary = (SPEC.match(/Verdict vocabulary is \*\*([^*]+)\*\*/) || [])[1];
  check('schema.sql allows justified / not justified', JSON.stringify(schemaVerdicts) === JSON.stringify(['justified', 'not justified']), schemaVerdicts.join(', '));
  check('SPEC.md states the same vocabulary', specVocabulary === schemaVerdicts.join(' / '), specVocabulary);
  check("the judge's parser accepts exactly those", minus(parserVerdicts, schemaVerdicts).length === 0 && minus(schemaVerdicts, parserVerdicts).length === 0, parserVerdicts.join(', '));
  check('README names exactly those', minus(readmeVerdicts, schemaVerdicts).length === 0 && minus(schemaVerdicts, readmeVerdicts).length === 0, readmeVerdicts.join(', '));
}

main().then(
  () => {
    console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
    process.exit(failures === 0 ? 0 : 1);
  },
  (error) => {
    console.log('SUITE ERROR:', error);
    process.exit(1);
  }
);
