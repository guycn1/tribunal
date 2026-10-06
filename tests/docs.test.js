/**
 * @file Checks that the documentation says what the code does: README.md,
 * SPEC.md, and the requirement sections of CLAUDE.md.
 *
 * Run with `npm test`. No network. Each file, route, role, table, column,
 * threshold, price claim, environment variable, npm script and badge the
 * docs describe is compared against its source here, as are the endpoints'
 * status codes and site-gate requirement, the agent endpoints' order of
 * checks, which of their rejections are logged and their rate limit, the
 * anti-abuse layers the code applies, the counts README states (of tables,
 * tiers, suites, anti-abuse layers, routes and agent endpoints among them),
 * the case text, the fields every call logs and the verdict vocabulary, so
 * changing one without the other fails this suite instead of leaving the
 * docs quietly wrong. Where the fact is about behaviour, it is checked by
 * running the real code (the backend compiled from its TypeScript, app.js
 * against a stub DOM), not by reading its text.
 *
 * README's own layout is held in place too: each endpoint entry a route
 * line and a description line, every path starting in the same column; the
 * database section a map of the tables in schema.sql's order, then a section
 * per table whose Columns line names exactly its columns; and each badge
 * label of more than one word joined, or wrapped only where its table allows.
 *
 * README's architecture diagram is read as nodes and arrows and held to
 * the code: every file and directory it names exists, every function is
 * drawn once, every arrow between two modules is a real import, every import
 * from a function into a module drawn has its arrow, every library module is
 * drawn or listed as not drawn, the per-IP limit sits on the arrows to the
 * rate-limited functions, the database's tables are listed, and the claims
 * beneath it hold - that the page requests only /api/ routes and loads
 * nothing from another host, and that one module each reaches OpenRouter
 * and the database and reads the secrets they need.
 *
 * It also holds every Markdown file but CLAUDE.md to HARD RULE 4: references
 * are links, and every link lands (see checkReferencesAreLinks()).
 *
 * CLAUDE.md's running status log is deliberately not checked: it records
 * what was true when each entry was written, as history rather than as a
 * claim about the current code.
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

/**
 * A Markdown file with each paragraph's and list item's wrapped lines joined
 * back into one line, the inverse of wrapping it at 80 columns: headings,
 * table rows, list-item starts, fenced code and blank lines stay as they are,
 * and a line after a hard break (one ending in a backslash) is not joined to
 * it. README and SPEC.md are wrapped for their Code view; the checks below
 * read the sentences they state whole, wherever the wrapping broke them.
 * @param {string} doc
 * @returns {string}
 */
function unwrap(doc) {
  const out = [];
  let fence = false;
  const blockStart = (line) => !line.trim() || /^#{1,6}\s/.test(line) || /^\s*\|/.test(line) || /^\s*([-*+]|\d+[.)])\s/.test(line);
  for (const line of doc.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; out.push(line); continue; }
    const prev = out[out.length - 1];
    if (!fence && !blockStart(line) && prev !== undefined && prev.trim() && !/^#{1,6}\s/.test(prev) && !/^\s*\|/.test(prev) && !/^\s*(```|~~~)/.test(prev) && !/\\$/.test(prev)) {
      out[out.length - 1] = `${prev} ${line.trim()}`;
    } else out.push(line);
  }
  return out.join('\n');
}

const README = unwrap(read('README.md'));
const SPEC = unwrap(read('SPEC.md'));
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
 * A count as README may write it, for a RegExp: in digits, or as a word from
 * zero to ten (a larger count written as a word is not read).
 */
const COUNT = `\\d+|${NUMBER_WORDS.join('|')}`;
/**
 * The number a count written in digits or as a word stands for, or NaN.
 * @param {string} count
 * @returns {number}
 */
const countOf = (count) => (/^\d+$/.test(count) ? Number(count) : wordToNumber(count));
/**
 * Every count a document states of something: a count followed within two
 * words by `noun`, a link opening anywhere in between, so a rewording ("five
 * offline test suites", "four [protective layers") is still read.
 * @param {string} doc
 * @param {string} noun Plural, as the document writes it.
 * @returns {string[]} The counts, as written.
 */
const statedCounts = (doc, noun) => [...doc.matchAll(new RegExp(`\\b(${COUNT})\\s+(?:\\[?[\\w-]+\\s+){0,2}\\[?${noun}`, 'gi'))].map((m) => m[1]);

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
 * @property {boolean} keyedByTrialAndRole Unique or primary key on
 *   (trial_id, role).
 * @property {boolean} cascades trial_id references trials(id) on delete
 *   cascade.
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
/**
 * Every file that is or would be committed: tracked, plus new and not ignored.
 */
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
  /**
   * Adds every .ts file under `dir` to `out`, recursing into folders.
   * @param {string} dir Relative to the repository root.
   */
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
/**
 * One Netlify Function's source, by function name.
 * @param {string} name The file name under netlify/functions/, without .ts.
 * @returns {string}
 */
const functionSource = (name) => read('netlify', 'functions', `${name}.ts`);

/**
 * Runs every check in order. Async because the behavioural checks drive the
 * compiled backend, whose calls return promises.
 * @returns {Promise<void>}
 */
async function main() {
  // The backend, compiled once for every behavioural check below, with its
  // Supabase client pointed at an in-memory stand-in.
  const backend = compileBackend(['lib/openrouter.ts', 'lib/representatives.ts', 'lib/judges.ts', 'lib/pricing.ts', 'trials.ts', 'trial.ts', 'case.ts', 'abort.ts', 'representative-background.ts', 'judge-background.ts']);
  useFakeSupabase(backend.outDir);

  // ============================================ README: unwrapping
  // Every check below reads README through unwrap(), so it is checked first,
  // on a sample with each kind of line it must keep apart, set directly
  // after a wrapped paragraph line.
  console.log('\n=== README: wrapped lines are joined, and nothing else ===');
  const wrapped = [
    'A paragraph', 'wrapped here.', '# Heading', 'after a heading', '| a | b |',
    'after a table row', '```', 'inside', 'a fence', '```', 'after a fence',
    '- an item', '  wrapped', '- another', '', 'route\\', 'after a hard break', '',
    'after a blank line',
  ].join('\n');
  const joined = [
    'A paragraph wrapped here.', '# Heading', 'after a heading', '| a | b |',
    'after a table row', '```', 'inside', 'a fence', '```', 'after a fence',
    '- an item wrapped', '- another', '', 'route\\', 'after a hard break', '',
    'after a blank line',
  ].join('\n');
  check('unwrap() joins wrapped lines and keeps every other line apart', unwrap(wrapped) === joined, JSON.stringify(unwrap(wrapped)));
  check('unwrap() leaves an unwrapped file as it is', unwrap(joined) === joined, JSON.stringify(unwrap(joined)));

  // ============================================ README: layout
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

  // ============================================ README: endpoints
  console.log('\n=== README: the endpoint list matches netlify.toml and the handlers ===');
  const api = section(README, '### API endpoints');
  // Each endpoint is a list item of two lines: its route, as one code
  // element with the method in bold and padded so that every path starts in
  // the same column ("<code><b>GET</b>  /api/case</code>\"), then its
  // function, linked to its own file, and what it does
  // ("  [`case.ts`](netlify/functions/case.ts): The fixed case record ...").
  // Every list item in the section is read, so one in any other shape - or
  // linking a file other than the one it names - fails here rather than
  // dropping out of the checks below unseen.
  const entries = [...api.matchAll(/^- .*(?:\n(?!- ).+)*/gm)].map((m) => m[0]);
  const ENTRY = /^- <code><b>(GET|POST|PUT|PATCH|DELETE)<\/b>( +)(\/api\/[^\s<]*)<\/code>\\\n {2}\[`([\w-]+)\.ts`\]\(netlify\/functions\/\4\.ts\): (.+)$/;
  const parsed = entries.map((entry) => ({ entry, m: entry.match(ENTRY) }));
  const rows = parsed.filter((p) => p.m).map(({ m }) => ({ method: m[1], gap: m[2].length, path: m[3], fn: m[4], text: m[5] }));
  const redirects = [...TOML.matchAll(/from = "([^"]+)"\s*\n\s*to = "\/\.netlify\/functions\/([\w-]+)[^"]*"/g)].map((m) => ({ path: m[1], fn: m[2] }));
  check('the endpoint list has entries', rows.length > 0);
  check('every endpoint entry is a route line and a description line', parsed.every((p) => p.m), parsed.filter((p) => !p.m).map((p) => JSON.stringify(p.entry.split('\n')[0])).join(' | '));
  // The column every path starts in: past the longest method, and one space.
  const pathColumn = Math.max(0, ...rows.map((r) => r.method.length)) + 1;
  const misaligned = rows.filter((r) => r.method.length + r.gap !== pathColumn);
  check('every endpoint\'s path starts in the same column', misaligned.length === 0, misaligned.map((r) => `${r.method} + ${r.gap} space(s)`).join(', '));
  check('netlify.toml has routes', redirects.length > 0);
  for (const r of redirects) {
    const hits = rows.filter((row) => row.path === r.path);
    check(`${r.path} is documented, as ${r.fn}.ts`, hits.length > 0 && hits.every((h) => h.fn === r.fn), hits.map((h) => h.fn).join(', ') || 'missing');
  }
  const unrouted = rows.filter((row) => !redirects.some((r) => r.path === row.path));
  check('every documented route exists in netlify.toml', unrouted.length === 0, unrouted.map((r) => r.path).join(', '));

  const documentedFns = [...new Set(rows.map((r) => r.fn))];
  // Checked first, and the rest of this section only looks at functions that
  // exist: a README entry naming a missing file must fail here, not crash the
  // suite on the read or require of a file that is not there.
  const missingFns = documentedFns.filter((fn) => !fs.existsSync(path.join(ROOT, 'netlify', 'functions', `${fn}.ts`)));
  check('every function the list names exists', missingFns.length === 0, missingFns.join(', '));
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
   * @param {{
   *   headers?: Record<string, string>,
   *   body?: string,
   *   trialStatus?: string
   * }} [request]
   *   trialStatus is the status the one trial holds.
   * @returns {Promise<number>}
   */
  const invoke = async (fn, method, urlPath, { headers = {}, body, trialStatus = 'created' } = {}) => {
    global.fakeSupabase = fakeSupabase({
      case_definitions: [{ ...caseRow }],
      trials: [{ id: TRIAL_ID, case_code: 'T-001', status: trialStatus, created_at: '1', updated_at: '1' }],
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
    const completedTrial = row.path.includes(':id') ? await invoke(row.fn, row.method, row.path.replace(':id', TRIAL_ID), { headers: { 'x-site-gate': GATE }, body, trialStatus: 'completed' }) : null;
    delete process.env.SITE_GATE_TOKEN;
    const observed = [correct, withoutGate, unknownTrial, completedTrial].filter((c) => c !== null);
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

  // The agent endpoints' account is the section's last subsection, over
  // several paragraphs; it is read as one run of text, from its heading to the
  // end of the section.
  const agentStart = api.search(/^#### The \w+ agent endpoints$/m);
  const agentPara = agentStart < 0 ? '' : api.slice(agentStart).replace(/\s*\n\s*/g, ' ');
  check('the agent-endpoint subsection is there', agentPara.length > 0);
  const topLevel = FUNCTION_SOURCES.filter(([f]) => !f.includes('/lib/'));
  // A function written with a named `handler` export is a Background
  // Function by its -background filename and nothing else, locally and
  // deployed alike.
  const backgroundFns = topLevel.map(([f]) => path.basename(f, '.ts')).filter((fn) => fn.endsWith('-background'));
  const documentedBackground = documentedFns.filter((fn) => fn.endsWith('-background'));
  check('the Background Functions are the ones documented as such', backgroundFns.length > 0 && minus(backgroundFns, documentedBackground).length === 0 && minus(documentedBackground, backgroundFns).length === 0, `filename: ${backgroundFns}, README: ${documentedBackground}`);
  // Netlify's bundler read a function's `config` export only when the
  // function had a default export (@netlify/zip-it-and-ship-it 9.42.1, read
  // on 2026-10-02, and every release from 15.3.3 to 16.3.0, read on
  // 2026-10-06), so next to a named `handler` export it was ignored whole - a
  // rate limit, a path or background: true declared there would read as in
  // force and do nothing.
  const ignoredConfig = topLevel.filter(([, src]) => /^export const handler\b/m.test(src) && /^export const config\b/m.test(src)).map(([f]) => path.basename(f, '.ts'));
  check('no function exports a config its bundler ignores', ignoredConfig.length === 0, ignoredConfig.join(', '));
  check(`"the ${(agentPara.match(/^#### The (\w+)/) || [])[1]} agent endpoints" is the right count`, wordToNumber((agentPara.match(/^#### The (\w+)/) || [])[1]) === backgroundFns.length, String(backgroundFns.length));
  const spenders = FUNCTION_SOURCES.filter(([f, src]) => !f.includes('/lib/') && /callOpenRouter\(/.test(src)).map(([f]) => path.basename(f, '.ts'));
  check('only the agent endpoints spend OpenRouter quota', minus(spenders, backgroundFns).length === 0 && minus(backgroundFns, spenders).length === 0, `callOpenRouter in: ${spenders}`);

  const gated = FUNCTION_SOURCES.filter(([f, src]) => !f.includes('/lib/') && /isSiteGateOk\(/.test(src)).map(([f]) => path.basename(f, '.ts'));
  const documentedGated = [...new Set([...rows.filter((r) => /site-gate/.test(r.text)).map((r) => r.fn), ...(/site-gate/.test(agentPara) ? backgroundFns : [])])];
  check('the site-gate header is documented on exactly the endpoints that check it', minus(gated, documentedGated).length === 0 && minus(documentedGated, gated).length === 0, `code: ${gated}, README: ${documentedGated}`);

  // The per-IP rate limit, read from each [[redirects]] block of
  // netlify.toml, where it has to live for these functions.
  const redirectBlocks = TOML.split(/^\[\[redirects\]\]/m).slice(1).map((block) => ({
    fn: (block.match(/to = "\/\.netlify\/functions\/([\w-]+)/) || [])[1],
    limit: /^\s*\[redirects\.rate_limit\]/m.test(block) ? {
      windowLimit: Number((block.match(/window_limit = (\d+)/) || [])[1]),
      windowSize: Number((block.match(/window_size = (\d+)/) || [])[1]),
      perIp: /aggregate_by = \[[^\]]*"ip"/.test(block),
    } : null,
  }));
  const limitedFns = redirectBlocks.filter((b) => b.limit).map((b) => b.fn);
  check('the rate-limited routes are exactly the agent endpoints', limitedFns.length > 0 && minus(limitedFns, backgroundFns).length === 0 && minus(backgroundFns, limitedFns).length === 0, `limited: ${limitedFns}, agents: ${backgroundFns}`);
  const rate = agentPara.match(/(\d+) requests per (\d+) minutes/);
  check('the per-IP rate limit is stated', Boolean(rate));
  for (const { fn, limit } of rate ? redirectBlocks.filter((b) => b.limit) : []) {
    check(`${fn}'s route: the rate limit is ${rate[1]} requests per ${rate[2]} minutes, per IP`, limit.windowLimit === Number(rate[1]) && limit.windowSize === Number(rate[2]) * 60 && limit.perIp, `${limit.windowLimit} per ${limit.windowSize}s, per IP: ${limit.perIp}`);
    // Netlify's documented maximum as of 2026-10-02; a longer window failed
    // validation at deploy time then, which did not fail the deploy, so
    // nothing else would notice.
    check(`${fn}'s route: the window is within Netlify's 180-second maximum`, limit.windowSize > 0 && limit.windowSize <= 180, `${limit.windowSize}s`);
  }

  // The agent handlers' checks: the order README gives them in, and which of
  // their rejections reach Netlify's function logs. Settled by calling the
  // real handlers with requests that fail one check, or two at once - two
  // at once answer with the status of whichever check runs first.
  const { GLOBAL_CALL_CAP } = backend.load('lib/db.js');
  const STEP_CODE = { route: 403, post: 405, role: 400, gate: 401, cap: 429, trial: 404, done: 409, address: 403 };
  // A test value for Netlify's URL variable, the site's main address; a
  // request failing 'address' comes through its route to another address
  // of the same site. 'address' is part of the route step in README.
  const MAIN_HOST = 'tribunal.example';
  const orderClause = (agentPara.match(/The handler checks, in order, (.*?)\. Because/) || [])[1] || '';
  const stepAt = { route: orderClause.indexOf('came through its rate-limited route'), post: orderClause.indexOf('a POST naming a trial and a role'), role: orderClause.indexOf('role is one it knows'), gate: orderClause.indexOf('site-gate header'), cap: orderClause.indexOf('call cap'), trial: orderClause.indexOf('trial exists'), done: orderClause.indexOf('no final outcome yet') };
  check('the order of the agent handlers\' checks is stated, naming each one', Object.values(stepAt).every((i) => i >= 0), JSON.stringify(stepAt));
  const documentedOrder = Object.keys(stepAt).sort((a, b) => stepAt[a] - stepAt[b]);
  /**
   * Calls one real agent handler with a request that fails the given checks,
   * and returns its status and whether it wrote anything to the console.
   * @param {string} fn 'representative-background' or 'judge-background'.
   * @param {string[]} failing Keys of STEP_CODE.
   * @returns {Promise<{status: number, logged: boolean}>}
   */
  const callAgent = async (fn, failing) => {
    const fails = new Set(failing);
    const role = fails.has('role') ? 'nobody' : fn === 'judge-background' ? 'barak' : 'jon_snow';
    const id = fails.has('trial') ? UNKNOWN_ID : TRIAL_ID;
    const recent = new Date().toISOString();
    // Failing 'done': the role already has a final outcome, a success - in
    // whichever trial the request names, so the order against 'trial' shows.
    const finished = fails.has('done') ? [{ trial_id: id, agent_role: role, call_type: fn === 'judge-background' ? 'judge' : 'representative', status: 'success', error_message: null, model_used: 'vendor/a-model', timestamp: recent }] : [];
    global.fakeSupabase = fakeSupabase({
      case_definitions: [{ ...caseRow }],
      trials: [{ id: TRIAL_ID, case_code: 'T-001', status: 'created', created_at: '1', updated_at: '1' }],
      representative_arguments: [], judge_rulings: [], agent_progress: [],
      api_call_logs: [...(fails.has('cap') ? Array.from({ length: GLOBAL_CALL_CAP }, () => ({ trial_id: TRIAL_ID, model_used: 'vendor/a-model', timestamp: recent })) : []), ...finished],
    }).client;
    global.fetch = async () => { throw new Error('no model call expected'); };
    process.env.SITE_GATE_TOKEN = GATE;
    process.env.URL = `https://${MAIN_HOST}`;
    delete process.env.NETLIFY_DEV;
    let logged = false;
    const saved = [console.log, console.warn, console.error];
    console.log = console.warn = console.error = () => { logged = true; };
    try {
      const response = await backend.load(`${fn}.js`).handler({
        httpMethod: fails.has('post') ? 'GET' : 'POST',
        path: fails.has('route') ? `/.netlify/functions/${fn}/${id}/${role}` : `/api/trials/${id}/${fn === 'judge-background' ? 'judges' : 'representatives'}/${role}`,
        headers: { host: fails.has('address') ? `main--${MAIN_HOST}` : MAIN_HOST, ...(fails.has('gate') ? {} : { 'x-site-gate': GATE }) },
        queryStringParameters: {},
      }, {});
      return { status: response.statusCode, logged };
    } finally {
      [console.log, console.warn, console.error] = saved;
      delete process.env.SITE_GATE_TOKEN;
      delete process.env.URL;
    }
  };
  const loggedClaim = (agentPara.match(/the ([\w-]+) and ([\w-]+) rejections are written to Netlify's function logs, the others are not logged at all/) || []).slice(1);
  const loggedSteps = loggedClaim.map((w) => ({ 'site-gate': 'gate', 'call-cap': 'cap' })[w]);
  check('which rejections are logged is stated', loggedSteps.length === 2 && loggedSteps.every(Boolean), loggedClaim.join(', '));
  for (const fn of backgroundFns) {
    for (const step of documentedOrder) {
      const { status, logged } = await callAgent(fn, [step]);
      check(`${fn}.ts: failing only the ${step} check answers ${STEP_CODE[step]}`, status === STEP_CODE[step], String(status));
      check(`${fn}.ts: the ${step} rejection is ${loggedSteps.includes(step) ? '' : 'not '}logged, as README says`, logged === loggedSteps.includes(step), `logged: ${logged}`);
    }
    for (let i = 0; i + 1 < documentedOrder.length; i++) {
      const [first, second] = [documentedOrder[i], documentedOrder[i + 1]];
      const { status } = await callAgent(fn, [first, second]);
      check(`${fn}.ts: the ${first} check runs before the ${second} check`, status === STEP_CODE[first], `answered ${status}`);
    }
    // The route step also covers the site's address: a request through the
    // route, but sent to another address of the same site, is refused the
    // same way.
    const other = await callAgent(fn, ['address']);
    check(`${fn}.ts: a request through its route to another address of the site answers ${STEP_CODE.address}, unlogged`, other.status === STEP_CODE.address && !other.logged, `${other.status}, logged: ${other.logged}`);
  }
  check('README says the route must be reached on the site\'s main address', orderClause.includes("came through its rate-limited route on the site's main address"), orderClause.slice(0, 120));

  const listLimit = Number((read('netlify', 'functions', 'lib', 'db.ts').match(/function listTrials\(limit = (\d+)\)/) || [])[1]);
  check(`GET /api/trials returns the ${listLimit} most recent trials`, api.includes(`The ${listLimit} most recent trials`), String(listLimit));

  // ============================================ README: database
  console.log('\n=== README: the database section matches schema.sql ===');
  const db = section(README, '### Database');
  const tableNames = Object.keys(TABLES);
  check('schema.sql defines tables', tableNames.length > 0);
  const countClaims = [
    ['the Database section', (db.match(/^(\w+) tables in Supabase/m) || [])[1]],
    // The count may open a link: "creates the [six tables](#database)".
    ['Local development', (section(README, '## Local development').match(/creates the \[?(\w+) tables/) || [])[1]],
    ['the layout tree', (treeBlock.match(/all (\w+) tables/) || [])[1]],
    ["schema.sql's own header", (SCHEMA.match(/^-- (\w+) tables:/m) || [])[1]],
  ];
  for (const [where, word] of countClaims) check(`${where} says there are ${tableNames.length} tables`, wordToNumber(word) === tableNames.length, word);

  // The section opens with a table of every table, each name linking to
  // that table's own "#### name" section further down. GitHub gives such a
  // heading the anchor #name, since a table name is lower case with only
  // underscores, which its anchors keep.
  const overview = [...db.matchAll(/^\| \[`(\w+)`\]\(#([^)]*)\) \| .+ \|$/gm)].map((m) => ({ table: m[1], anchor: m[2] }));
  check('the overview lists every table, in schema.sql\'s order', JSON.stringify(overview.map((o) => o.table)) === JSON.stringify(tableNames), overview.map((o) => o.table).join(', '));
  const badLinks = overview.filter((o) => o.anchor !== o.table);
  check('every name in the overview links to its own section', overview.length > 0 && badLinks.length === 0, badLinks.map((o) => `${o.table} -> #${o.anchor}`).join(', '));
  const headings = [...db.matchAll(/^#### (.+)$/gm)].map((m) => m[1]);
  check('the per-table sections follow schema.sql\'s order', JSON.stringify(headings) === JSON.stringify(tableNames), headings.join(', '));
  // Each table's section: its heading line up to the next heading.
  const sections = Object.fromEntries(headings.map((h) => [h, section(db, `#### ${h}`)]));
  const markerValues = [...OPENROUTER_SRC.matchAll(/export const [A-Z0-9_]+_MARKER = '([^']+)'/g)].map((m) => m[1]);
  for (const [table, info] of Object.entries(TABLES)) {
    const para = sections[table] || '';
    const named = [...para.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    // The Columns line is the table's full column list, bookkeeping ones
    // included, in schema.sql's order. What a parenthesis holds (a column's
    // allowed values, or a note) is not a column, so it is dropped first.
    const columnsLine = (para.match(/^\*\*Columns:\*\* (.+)$/m) || ['', ''])[1];
    const listed = [...columnsLine.replace(/\([^)]*\)/g, '').matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    check(`${table}: the Columns line lists exactly its columns, in schema.sql's order`, JSON.stringify(listed) === JSON.stringify(info.columns), listed.join(', ') || 'no Columns line');
    const bogus = named.filter((n) => /^[a-z][a-z0-9_]*$/.test(n) && n.includes('_') && !info.columns.includes(n) && !tableNames.includes(n));
    check(`${table}: every column named exists`, bogus.length === 0, bogus.join(', '));
    const badMarkers = named.filter((n) => n.startsWith('[') && !markerValues.includes(n));
    check(`${table}: every marker named is a real one`, badMarkers.length === 0, badMarkers.join(', '));
    for (const [column, allowed] of Object.entries(info.checks)) {
      if (column === 'role') continue; // the roles are checked against the code below, in the agent-endpoint subsection
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
  check('api_call_logs is appended and never updated', /appended and never updated/i.test(sections.api_call_logs || '') && logWrites.length === 0, logWrites.join(', '));
  check('agent_progress is overwritten in place', /overwritten/.test(sections.agent_progress || '') && FUNCTION_SOURCES.some(([, src]) => /from\('agent_progress'\)\.upsert\(/.test(src)));
  const caseInCode = [...FUNCTION_SOURCES.map(([f, src]) => [f, src]), ['public/app.js', read('public', 'app.js')]].filter(([, src]) => SEED.agreedFacts.some((fact) => src.includes(fact.slice(0, 60))));
  check('the case text lives only in the database, not in code', /reads the case from here at runtime/.test(sections.case_definitions || '') && caseInCode.length === 0, caseInCode.map(([f]) => f).join(', '));

  // ============================================ README: numbers the code sets
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
   * @returns {{
   *   ok: boolean,
   *   status: number,
   *   headers: Map<string, string>,
   *   json: () => Promise<object>
   * }}
   */
  const reply =(model, content, finishReason = 'stop') => ({
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
  const chainText = section(README, '## Architecture').match(/`default model \((\d+) attempts?\) → ([\w.-]+) \((\d+) attempts?\) → a third model \((\d+) attempts?\) → a last-resort model \((\d+) attempts?\)`/);
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
  check('tier 2 is said to be significantly pricier than the default', /Tier 2 is significantly pricier than the default tier/.test(README));
  if (tiers.length >= 2) {
    /**
     * A model's price per million prompt and completion tokens.
     * @param {string} model
     * @returns {[number, number]}
     */
    const perMillion = (model) => [calculateCost(model, 1e6, 0), calculateCost(model, 0, 1e6)];
    const [defaultPrices, tier2Prices] = [perMillion(tiers[0].model), perMillion(tiers[1].model)];
    // "Significantly": several times the price, for prompt and completion
    // tokens alike.
    check('tier 2 is several times the default\'s price', tier2Prices.every((p, i) => p >= 3 * defaultPrices[i]), `${defaultPrices.join('/')} vs ${tier2Prices.join('/')}`);
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
    /**
     * `count` distinct words with no punctuation between them.
     * @param {number} count
     * @returns {string}
     */
    const words = (count) => Array.from({ length: count }, (_, i) => `word${i}`).join(' ');
    check(`a ${n}-word run is caught`, !(await acceptedFirstTime(`${words(n)}.`)));
    check(`a ${n - 1}-word run is not`, await acceptedFirstTime(`${words(n - 1)}.`));
  }
  // The four verbatim-repetition rules. Each stated threshold is run just
  // above and just below, with copies kept apart by distinct filler
  // sentences so that no other rule fires.
  /**
   * Every number README states for one rule, wherever it states it.
   * @param {RegExp} re
   * @returns {number[]}
   */
  const claimed = (re) => [...README.matchAll(re)].map((m) => Number(m[1]));
  /**
   * An 8-word filler sentence sharing no word with any other, so fillers
   * never look like near-copies of each other.
   * @param {number} i
   * @returns {string}
   */
  const filler = (i) => `Note${i}a note${i}b note${i}c note${i}d note${i}e note${i}f note${i}g note${i}h.`;
  /**
   * The reason the default model's first reply was discarded, or null if it
   * was kept - for a check that must tell two rules apart.
   * @param {string} content
   * @returns {Promise<string | null>}
   */
  const discardReason = async (content) => {
    global.fetch = async (_url, request) => { const m = JSON.parse(request.body).model; return reply(m, m === DEFAULT ? content : CLEAN); };
    const r = await quietly(() => callOpenRouter(DEFAULT, [{ role: 'user', content: 'hi' }], 1400, 'docs:detector'));
    return r.discardedAttempts && r.discardedAttempts.length ? r.discardedAttempts[0].errorMessage : null;
  };
  /**
   * A sentence of exactly `count` words.
   * @param {number} count
   * @returns {string}
   */
  const sentenceOf = (count) => Array.from({ length: count }, (_, i) => `term${i}`).join(' ') + '.';
  const SHORT = 'He had no lawful authority to act.';

  check('twice in a row is stated as a rule', /the same whole sentence twice in a row/.test(README));
  check('a sentence twice in a row is caught', !(await acceptedFirstTime(`${filler(1)} ${SHORT} ${SHORT} ${filler(2)}`)));
  check('and the same sentence twice apart is not', await acceptedFirstTime(`${SHORT} ${filler(1)} ${SHORT}`));

  const longClaims = claimed(/a sentence of (\d+)\+ words twice/g);
  check('the long-sentence threshold is stated, the same everywhere', longClaims.length > 0 && longClaims.every((n) => n === longClaims[0]), longClaims.join(', '));
  if (longClaims.length) {
    const n = longClaims[0];
    /**
     * A `words`-word sentence twice, with one filler between the copies.
     * @param {number} words
     * @returns {string}
     */
    const twiceApart = (words) => `${sentenceOf(words)} ${filler(1)} ${sentenceOf(words)}`;
    check(`a ${n}-word sentence twice is caught`, !(await acceptedFirstTime(twiceApart(n))));
    check(`a ${n - 1}-word sentence twice is not`, await acceptedFirstTime(twiceApart(n - 1)));
  }

  const repeatClaims = claimed(/any sentence (\d+)\+ times/g);
  check('the repeated-sentence threshold is stated, the same everywhere', repeatClaims.length > 0 && repeatClaims.every((n) => n === repeatClaims[0]), repeatClaims.join(', '));
  if (repeatClaims.length) {
    const n = repeatClaims[0];
    /**
     * The same short sentence `count` times, each copy followed by a filler.
     * @param {number} count
     * @returns {string}
     */
    const apart = (count) => Array.from({ length: count }, (_, i) => `${SHORT} ${filler(i)}`).join(' ');
    check(`a sentence repeated ${n} times is caught`, !(await acceptedFirstTime(apart(n))));
    check(`one repeated ${n - 1} times is not`, await acceptedFirstTime(apart(n - 1)));
  }

  const passageClaims = claimed(/a passage of (\d+)\+ sentences repeated word for word/g);
  check('the repeated-passage length is stated, the same everywhere', passageClaims.length > 0 && passageClaims.every((n) => n === passageClaims[0]), passageClaims.join(', '));
  if (passageClaims.length) {
    const n = passageClaims[0];
    /**
     * A passage of `count` fillers, one more filler, then the passage again.
     * @param {number} count
     * @returns {string}
     */
    const passageTwice = (count) => { const p = Array.from({ length: count }, (_, i) => filler(i)).join(' '); return `${p} ${filler(99)} ${p}`; };
    // Named by the rule itself: a shorter passage repeated is caught too, by
    // the near-copy passage rule, which reports it differently.
    check(`a ${n}-sentence passage repeated is caught as one`, /passage word for word/.test((await discardReason(passageTwice(n))) || ''));
    check(`a ${n - 1}-sentence passage repeated is not`, !/passage word for word/.test((await discardReason(passageTwice(n - 1))) || ''));
  }

  // The two clause rules. Each copy of a clause sits in a different
  // sentence, so no sentence rule can fire.
  const clusterClaims = [...README.matchAll(/a clause of (\d+)\+ words (\d+) times close together/g)].map((m) => `${m[1]}/${m[2]}`);
  // Stated wherever the clause rules are, not merely somewhere in README.
  const inARowClauseClaims = README.match(/the same clause twice in a row, a clause of/g) || [];
  check('a clause twice in a row is stated as a rule, wherever the clause rules are', inARowClauseClaims.length > 0 && inARowClauseClaims.length === clusterClaims.length, `${inARowClauseClaims.length} of ${clusterClaims.length}`);
  check('a clause twice in a row is caught', !(await acceptedFirstTime(`${filler(1)} He had seen the city burn, he had seen the city burn, and he acted. ${filler(2)}`)));
  check('and the same clause twice apart is not', await acceptedFirstTime(`He had seen the city burn, and he acted before the council could meet. ${filler(1)} He had seen the city burn, yet the lords sat idle through a long winter.`));
  check('the clause-cluster thresholds are stated, the same everywhere', clusterClaims.length > 0 && clusterClaims.every((c) => c === clusterClaims[0]), clusterClaims.join(', '));
  if (clusterClaims.length) {
    const [words, copies] = clusterClaims[0].split('/').map(Number);
    /**
     * A clause of exactly `count` words.
     * @param {number} count
     * @returns {string}
     */
    const clauseOf = (count) => Array.from({ length: count }, (_, i) => `part${i}`).join(' ');
    /**
     * Six words of the `i`th sentence's own, to end it with. Each copy's
     * sentence ends this way, so the sentences are not near-copies of each
     * other and only the clause rules apply.
     * @param {number} i
     * @returns {string}
     */
    const tail = (i) => Array.from({ length: 6 }, (_, k) => `tail${i}w${k}`).join(' ');
    /**
     * `times` copies of a `count`-word clause, one clause apart, each in a
     * sentence of its own.
     * @param {number} count
     * @param {number} times
     * @returns {string}
     */
    const cluster = (count, times) => Array.from({ length: times }, (_, i) => `${clauseOf(count)}, ${tail(i)}.`).join(' ');
    check(`a ${words}-word clause ${copies} times close together is caught`, !(await acceptedFirstTime(cluster(words, copies))));
    check(`a ${words - 1}-word clause ${copies} times close together is not`, await acceptedFirstTime(cluster(words - 1, copies)));
    check(`a ${words}-word clause ${copies - 1} times close together is not`, await acceptedFirstTime(cluster(words, copies - 1)));
  }
  // The two near-copy rules. Likeness is the share of a sentence's words that
  // need no change to turn it into the other, so a sentence of `len` words
  // with its last `changed` words replaced is (len - changed) / len alike.
  /**
   * A sentence of `len` words unique to `tag`, with the last `changed` of
   * them swapped for words of its own. A comma every 9 words keeps a long
   * sentence clear of the run-on check.
   * @param {string} tag
   * @param {number} len
   * @param {number} [changed=0]
   * @returns {string}
   */
  const sentenceFor = (tag, len, changed = 0) =>
    Array.from({ length: len }, (_, k) => (k >= len - changed ? `${tag}x${k}` : `${tag}w${k}`) + (k % 9 === 8 && k < len - 1 ? ',' : '')).join(' ') + '.';
  /**
   * `count` fillers, numbered from `from`.
   * @param {number} from
   * @param {number} count
   * @returns {string}
   */
  const fillers = (from, count) => Array.from({ length: count }, (_, i) => filler(from + i)).join(' ');
  const passageClaims2 = [...README.matchAll(/(\d+)\+ consecutive sentences found again almost word for word \((\d+)%\+ alike, (\d+)\+ words\)/g)].map((m) => m.slice(1, 4).join('/'));
  check('the near-copy passage thresholds are stated, the same everywhere', passageClaims2.length === 2 && passageClaims2.every((c) => c === passageClaims2[0]), passageClaims2.join(', '));
  if (passageClaims2.length) {
    const [count, pct, words] = passageClaims2[0].split('/').map(Number);
    /**
     * One sentence per entry of `lens`, of that many words, then the same
     * sentences found again later with `changed` of each one's words
     * replaced, well away from the end.
     * @param {number[]} lens
     * @param {number} changed
     * @returns {string}
     */
    const nearPassage = (lens, changed) =>
      `${lens.map((len, i) => sentenceFor(`p${i}`, len)).join(' ')} ${fillers(1, 6)} ${lens.map((len, i) => sentenceFor(`p${i}`, len, changed)).join(' ')} ${fillers(10, 12)}`;
    // 100-word sentences, so likeness moves in steps of 1%.
    check(`${count} sentences found again ${pct}% alike are caught`, !(await acceptedFirstTime(nearPassage(Array(count).fill(100), 100 - pct))));
    check(`and found again ${pct - 1}% alike are not`, await acceptedFirstTime(nearPassage(Array(count).fill(100), 101 - pct)));
    check(`a single sentence found again ${pct}% alike is not`, await acceptedFirstTime(nearPassage(Array(count - 1).fill(100), 100 - pct)));
    const half = Math.ceil(words / count);
    check(`${words} words in all is caught`, !(await acceptedFirstTime(nearPassage([half, words - half], 0))));
    check(`${words - 1} is not`, await acceptedFirstTime(nearPassage([half, words - 1 - half], 0)));
  }
  const closingClaims = [...README.matchAll(/a sentence in the last (\d+)% that is (\d+)%\+ like one of the (\d+) before it \((\d+)\+ words each\)/g)].map((m) => m.slice(1, 5).join('/'));
  check('the near-copy closing thresholds are stated, the same everywhere', closingClaims.length === 2 && closingClaims.every((c) => c === closingClaims[0]), closingClaims.join(', '));
  if (closingClaims.length) {
    const [share, pct, lookback, words] = closingClaims[0].split('/').map(Number);
    /**
     * `lead` fillers, a sentence, `gap` more fillers, the sentence's copy with
     * `changed` words replaced, then `after` fillers. 100 words by default,
     * so likeness moves in steps of 1%. Each run of fillers is numbered apart
     * from the others, so no filler appears twice.
     * @param {{
     *   len?: number,
     *   changed?: number,
     *   gap?: number,
     *   after?: number,
     *   lead?: number
     * }} [options]
     *   `len` defaults to 100, `changed` to the number of words that leaves
     *   a 100-word copy exactly at the stated likeness, `gap` to 1, `after`
     *   to 0 and `lead` to 20.
     * @returns {string}
     */
    const closing = ({ len = 100, changed = 100 - pct, gap = 1, after = 0, lead = 20 } = {}) =>
      `${fillers(1000, lead)} ${sentenceFor('c', len)} ${fillers(2000, gap)} ${sentenceFor('c', len, changed)}${after ? ' ' + fillers(3000, after) : ''}`;
    check(`a closing sentence ${pct}% like one just before it is caught`, !(await acceptedFirstTime(closing())));
    check(`and ${pct - 1}% alike is not`, await acceptedFirstTime(closing({ changed: 101 - pct })));
    check(`one ${lookback} sentences back is caught`, !(await acceptedFirstTime(closing({ gap: lookback - 1 }))));
    check(`one ${lookback + 1} back is not`, await acceptedFirstTime(closing({ gap: lookback })));
    const minChanged = Math.floor((words * (100 - pct)) / 100);
    check(`${words}-word sentences are caught`, !(await acceptedFirstTime(closing({ len: words, changed: minChanged }))));
    check(`${words - 1}-word ones are not`, await acceptedFirstTime(closing({ len: words - 1, changed: Math.floor(((words - 1) * (100 - pct)) / 100) })));
    // Identical copies are the exact rules' business; twice, apart and under
    // the long-sentence minimum, none of them objects.
    check('an identical sentence is left to the exact rules', await acceptedFirstTime(closing({ len: 10, changed: 0 })));
    // 100 sentences in all, with the copy at sentence 100 - share: exactly
    // on the line. One more filler after it moves it just outside.
    check(`a copy still in the last ${share}% is caught`, !(await acceptedFirstTime(closing({ lead: 97 - share, after: share }))));
    check('one just before that is not', await acceptedFirstTime(closing({ lead: 97 - share, after: share + 1 })));
  }
  const fastClaims = [...README.matchAll(/under (\d+) seconds/g)].map((m) => Number(m[1]));
  check('the fast-failure threshold is stated, the same everywhere', fastClaims.length > 0 && fastClaims.every((n) => n === fastClaims[0]), fastClaims.join(', '));
  if (fastClaims.length) {
    /**
     * Whether a rate limit that takes `seconds` to come back is retried for
     * free.
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

  // The default model's token cap, wherever README gives it.
  const { AGENT_MAX_TOKENS } = backend.load('lib/models.js');
  const capClaims = [...README.matchAll(/the ([\d,]+) tokens the default model is given/g)].map((m) => Number(m[1].replace(/,/g, '')));
  check(`the default model's token cap is stated as ${AGENT_MAX_TOKENS}, as models.ts sets it`, capClaims.length > 0 && capClaims.every((n) => n === AGENT_MAX_TOKENS), capClaims.join(', ') || 'not stated');
  // One trigger request per agent, so a full trial sends as many requests
  // as there are agents - in README and in netlify.toml's rate-limit note.
  const agentCount = realRoles.length;
  const requestClaims = [...`${README}\n${TOML}`.matchAll(/a (?:full )?trial (?:costs|sends) (\d+)/gi)].map((m) => Number(m[1]));
  check(`every "a trial sends N" uses ${agentCount}, one request per agent`, requestClaims.length > 0 && requestClaims.every((n) => n === agentCount), requestClaims.join(', ') || 'not stated');
  backend.cleanup();

  // ============================================ README: what the UI shows
  console.log('\n=== README: the badge tables match what app.js renders ===');
  installDom();
  const app = loadApp([
    'state', 'el', 'renderCallLog', 'trialStatusLabel', 'trialStatusClass', 'POLL_TIMEOUT_MS', 'INTERRUPTED_THRESHOLD_MS', 'TOTAL_EXPECTED_RESULTS', 'ABORTED_BY_USER_MESSAGE', 'TRUNCATION_BECAME_FAILURE_AT',
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
    { status: 'success', completionTokens: 1400, timestamp: '2026-08-28T20:35:06Z' },
    ...['DEGENERATE_RETRIED_SAME_MODEL_MARKER', 'DEGENERATE_RETRIED_DIFF_MODEL_MARKER', 'DEGENERATE_FINAL_MARKER'].flatMap((m) => [
      { status: 'failed', errorMessage: `${app[m]} ${CAP} - re-tried.` },
      { status: 'failed', errorMessage: `${app[m]} ${LOOP} - re-tried.` },
    ]),
    { status: 'failed', errorMessage: `${app.HTTP_ERROR_ESCALATED_MARKER} HTTP 404 - escalated.` },
    { status: 'failed', errorMessage: `${app.TRANSIENT_RETRIED_MARKER} timed out - re-tried.` },
    { status: 'failed', errorMessage: `${app.ABORTED_MID_CALL_MARKER} Stopped before attempt 2.` },
  ].flatMap(badgesFor));
  const callLogSection = section(README, '### Call log');
  // A label of more than one word is written <code>no&nbsp;response</code>,
  // so it never wraps inside its badge and the Badge column is as wide as
  // the longest label; a one-word label is a plain code span.
  const callLogLabels = [...callLogSection.matchAll(/^\| (?:`([^`]+)`|<code>([^<]+)<\/code>) \| (\w+) \|/gm)].map((m) => ({ label: m[1] || m[2].replace(/&nbsp;/g, ' '), raw: m[1] || m[2], colour: m[3] }));
  const documentedCallLog = new Set(callLogLabels.map((l) => `${l.label}|${l.colour}`));
  check('the call log table is there', documentedCallLog.size > 0);
  const breakable = callLogLabels.filter((l) => l.label.includes(' ') && l.raw !== l.label.replace(/ /g, '&nbsp;'));
  check('every label of more than one word in the call log table is joined with &nbsp;', breakable.length === 0, breakable.map((l) => l.raw).join(', '));
  check('every call-log badge app.js can render is in the table', minus(rendered, documentedCallLog).length === 0, minus(rendered, documentedCallLog).join(', '));
  check('every badge in the call log table is one app.js renders', minus(documentedCallLog, rendered).length === 0, minus(documentedCallLog, rendered).join(', '));
  // The legacy badge, dated where README describes it, against the date the
  // code draws its line at.
  const legacyRow = (callLogSection.match(/^\| `truncated` \| amber \| Legacy only:.*$/m) || [''])[0];
  const legacyDay = new Date(app.TRUNCATION_BECAME_FAILURE_AT).toISOString().slice(0, 10);
  check(`the legacy "truncated" row dates the change to ${legacyDay}, as app.js does`, legacyRow.includes(legacyDay), legacyRow || 'row not found');
  const legacyBadges = badgesFor({ status: 'success', completionTokens: 1400, timestamp: new Date(app.TRUNCATION_BECAME_FAILURE_AT - 60000).toISOString() });
  const laterBadges = badgesFor({ status: 'success', completionTokens: 1400, timestamp: new Date(app.TRUNCATION_BECAME_FAILURE_AT + 60000).toISOString() });
  check('a success at the cap gets it just before that moment, and not just after', legacyBadges.includes('truncated|amber') && !laterBadges.includes('truncated|amber'), `${legacyBadges} / ${laterBadges}`);

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
  // A label is a plain code span or, where it needs control over where it
  // wraps, a <code> element using &nbsp;, as in the call log table.
  const sidebarLabels = [...sidebarSection.matchAll(/^\| (?:`([^`]+)`|<code>([^<]+)<\/code>) \| (\w+) \|/gm)].map((m) => ({ label: m[1] || m[2].replace(/&nbsp;/g, ' '), raw: m[1] || m[2], colour: m[3] }));
  const documentedSidebar = new Set(sidebarLabels.map((l) => `${l.label}|${l.colour}`));
  check('the sidebar table is there', documentedSidebar.size > 0);
  // A label that qualifies another label in the table ("completed" ->
  // "completed — missing N of 7") wraps in one place only, right after that
  // base label and any dash, so the qualifier moves to the next line whole;
  // every other label never wraps. Labels in long form would otherwise wrap
  // at every space, and joined whole they would make the column too wide.
  const sidebarBases = sidebarLabels.map((l) => l.label).filter((l) => !l.includes(' '));
  const wrapsWrongly = sidebarLabels.filter((l) => {
    const base = sidebarBases.find((b) => l.label.startsWith(`${b} `));
    const nb = (s) => s.replace(/ /g, '&nbsp;');
    if (!base) return l.raw !== nb(l.label);
    const rest = l.label.slice(base.length + 1);
    const expected = rest.startsWith('— ') ? `${base}&nbsp;— ${nb(rest.slice(2))}` : `${base} ${nb(rest)}`;
    return l.raw !== expected;
  });
  check('every sidebar label wraps only right after the label it qualifies, if at all', wrapsWrongly.length === 0, wrapsWrongly.map((l) => l.raw).join(', '));
  check('every sidebar badge app.js can render is in the table', minus(sidebar, documentedSidebar).length === 0, minus(sidebar, documentedSidebar).join(', '));
  check('every badge in the sidebar table is one app.js renders', minus(documentedSidebar, sidebar).length === 0, minus(documentedSidebar, sidebar).join(', '));
  if (Number.isFinite(threshold)) {
    /**
     * The sidebar label of an unfinished trial started `minutes` ago.
     * @param {number} minutes
     * @returns {string}
     */
    const labelAt = (minutes) => app.trialStatusLabel({ wasAborted: false, status: 'created', resultCount: 0, createdAt: new Date(Date.now() - minutes * 60000).toISOString() });
    check(`a run is "in progress" just under ${threshold} minutes`, labelAt(threshold - 0.1) === 'in progress…', labelAt(threshold - 0.1));
    check(`and "interrupted" just over`, labelAt(threshold + 0.1) === 'interrupted', labelAt(threshold + 0.1));
    check(`"over ${threshold} minutes old" agrees`, sidebarSection.includes(`over ${threshold} minutes old`));
  }
  const budgetMs = Number((OPENROUTER_SRC.match(/const TOTAL_BUDGET_MS = (\d+);/) || [])[1]);
  // The worst case: the representatives polled for as long as the page
  // waits, then the judges running out the server's budget.
  const worstCaseMs = app.POLL_TIMEOUT_MS + budgetMs;
  check('the threshold is said to be above the worst case', /sized well above the genuine worst case: the page waiting on the representatives for as long as it polls, then every judge running out its full time budget/.test(sidebarSection));
  check(`and it is: ${threshold} minutes against ${(worstCaseMs / 60000).toFixed(1)}`, Number(threshold) * 60000 > worstCaseMs, String(worstCaseMs));
  const pollClaim = (api.match(/after about (\d+) minutes/) || [])[1];
  check(`polling gives up after about ${pollClaim ?? '(not stated)'} minutes`, Math.round(app.POLL_TIMEOUT_MS / 60000) === Number(pollClaim), String(app.POLL_TIMEOUT_MS / 60000));
  const expected = app.TOTAL_EXPECTED_RESULTS;
  const resultClaims = [...README.matchAll(/(?:all|its) (\d+)(?: of (\d+))? results/g)].flatMap((m) => [m[1], m[2]].filter(Boolean).map(Number));
  check(`every "N of ${expected} results" uses ${expected}`, resultClaims.length > 0 && resultClaims.every((n) => n === expected), resultClaims.join(', '));

  // ============================================ README: local development
  console.log('\n=== README: setup and the test suites match package.json and .env.example ===');
  const local = section(README, '## Local development');
  const suites = [...(PKG.scripts.test || '').matchAll(/node (tests\/[\w.-]+\.js)/g)].map((m) => m[1]);
  const suiteFiles = (REPO_FILES || []).filter((f) => /^tests\/[^/]+\.test\.js$/.test(f));
  check('npm test runs every suite in tests/', minus(suiteFiles, suites).length === 0, minus(suiteFiles, suites).join(', '));
  check('npm test runs only suites that exist', suites.every((f) => fs.existsSync(path.join(ROOT, f))), suites.join(', '));
  const suiteWord = (local.match(/npm test\s+# (\w+) regression suites/) || [])[1];
  check(`"${suiteWord} regression suites" is the right count`, wordToNumber(suiteWord) === suites.length, String(suites.length));
  // The count is also stated in prose, outside the setup block ("Six offline
  // regression suites", in Status), and every statement of it is held to it.
  const suiteClaims = statedCounts(README, 'suites');
  check(`every "N regression suites" in README uses ${suites.length}`, suiteClaims.length > 0 && suiteClaims.every((w) => countOf(w) === suites.length), suiteClaims.join(', '));
  const describedSuites = [...local.matchAll(/`(tests\/[\w.-]+\.test\.js)`/g)].map((m) => m[1]);
  check('the suite descriptions cover exactly the suites npm test runs', minus(suites, describedSuites).length === 0 && minus(describedSuites, suites).length === 0, `described: ${describedSuites}`);
  // Script names may hold hyphens (check-render), so match up to the spaces,
  // and require every npm run line in the block to be read: one that slips
  // past this pattern would go unchecked without a word.
  const runLines = local.split('\n').filter((line) => /^npm run /.test(line));
  const runClaims = [...local.matchAll(/^npm run ([\w:-]+)\s+# (.+)$/gm)];
  check('every npm run line in the setup block is read', runLines.length > 0 && runClaims.length === runLines.length, runLines.filter((line) => !runClaims.some((m) => line.startsWith(`npm run ${m[1]} `))).join(' | '));
  for (const m of runClaims) {
    check(`npm run ${m[1]} is "${(PKG.scripts[m[1]] || '').trim()}"`, PKG.scripts[m[1]] && m[2].startsWith(PKG.scripts[m[1]]), PKG.scripts[m[1]]);
  }
  const listedScripts = runClaims.map((m) => m[1]);
  const unlisted = Object.keys(PKG.scripts).filter((s) => s !== 'test' && !listedScripts.includes(s));
  check('the setup block lists every npm script', unlisted.length === 0, unlisted.join(', '));
  const envVars = [...ENV_EXAMPLE.matchAll(/^#? ?([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]);
  // NETLIFY_DEV and URL are set by Netlify itself (netlify dev, and every
  // function at runtime), never by whoever runs the project.
  const NETLIFY_SET = ['NETLIFY_DEV', 'URL'];
  const readVars = [...new Set(FUNCTION_SOURCES.flatMap(([, src]) => [...src.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1])))].filter((v) => !NETLIFY_SET.includes(v));
  const roleVars = [...read('netlify', 'functions', 'lib', 'models.ts').matchAll(/'(MODEL_[A-Z_]+)'/g)].map((m) => m[1]);
  check('.env.example lists every variable the backend reads', minus([...readVars, ...roleVars], envVars).length === 0, minus([...readVars, ...roleVars], envVars).join(', '));
  check('.env.example lists nothing the backend does not read', minus(envVars, [...readVars, ...roleVars]).length === 0, minus(envVars, [...readVars, ...roleVars]).join(', '));
  const required = ENV_EXAMPLE.split(/\n\s*\n/).filter((block) => /\(required\)/.test(block)).flatMap((block) => [...block.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
  const toFillIn = [...(local.match(/# fill in ([A-Z0-9_, ]+)/) || ['', ''])[1].matchAll(/[A-Z][A-Z0-9_]+/g)].map((m) => m[0]);
  check('README asks for exactly the required variables', required.length > 0 && minus(required, toFillIn).length === 0 && minus(toFillIn, required).length === 0, `required: ${required}, README: ${toFillIn}`);
  const threeTier = README.split('\n').find((line) => line.startsWith('Three-tier:')) || '';
  check('the bundler is esbuild, as the architecture line says', /bundled by esbuild/.test(threeTier) && /node_bundler = "esbuild"/.test(TOML), threeTier || 'no "Three-tier:" line in README');

  // ============================================ README: anti-abuse layers
  console.log('\n=== README: the anti-abuse layers are the ones the code has ===');
  // Each layer, the words README names it by, and whether the code applies
  // it to every call that spends quota. The call cap and the site gate are
  // settled by running each real agent handler with a request that fails
  // only that check: it must be turned away with that check's status, so a
  // check that is called but whose answer is ignored does not count. The rate
  // limit must be set per IP, with a request limit and a window, on every
  // route to an agent function, and every agent handler must refuse a
  // request sent to its own address, which no route covers, and one sent
  // through its route to another address of the site, which Netlify counts
  // separately. None holds if there is no agent at all.
  /** Whether every agent handler turns away a request failing only `step`. */
  const everyAgentRejects = async (step) => {
    for (const fn of backgroundFns) if ((await callAgent(fn, [step])).status !== STEP_CODE[step]) return false;
    return true;
  };
  const agentRoutes = redirectBlocks.filter((b) => backgroundFns.includes(b.fn));
  const everyAgentRouteLimited = backgroundFns.every((fn) => agentRoutes.some((b) => b.fn === fn))
    && agentRoutes.every((b) => b.limit && b.limit.perIp && b.limit.windowLimit > 0 && b.limit.windowSize > 0);
  const anyAgent = backgroundFns.length > 0;
  const layers = [
    { name: 'the site-wide call cap', words: /call cap/i, inCode: anyAgent && await everyAgentRejects('cap') },
    { name: 'per-IP rate limiting', words: /rate limit/i, inCode: anyAgent && everyAgentRouteLimited && await everyAgentRejects('route') && await everyAgentRejects('address') },
    { name: 'the site-gate header', words: /site-gate/i, inCode: anyAgent && await everyAgentRejects('gate') },
  ];
  const layersInCode = layers.filter((l) => l.inCode);
  const layerBullets = (section(README, '### Anti-abuse and cost controls').match(/^- .*$/gm) || []);
  const layersNamed = (bullet) => layersInCode.filter((l) => l.words.test(bullet));
  check('the anti-abuse section lists exactly the layers the code applies, one bullet each', layerBullets.length === layersInCode.length && layerBullets.every((b) => layersNamed(b).length === 1) && layersInCode.every((l) => layerBullets.some((b) => layersNamed(b)[0] === l)), `code: ${layersInCode.map((l) => l.name).join(', ')}; README: ${layerBullets.map((b) => layersNamed(b).map((l) => l.name).join(' + ') || 'no layer').join(' | ')}`);
  const layerClaims = statedCounts(README, 'layers');
  check(`every "N anti-abuse layers" in README uses ${layersInCode.length}`, layerClaims.length > 0 && layerClaims.every((w) => countOf(w) === layersInCode.length), layerClaims.join(', ') || 'not stated');
  // The rate limit is said to sit on "the two routes" that spend quota: the
  // routes to agent functions in netlify.toml.
  const routeClaims = statedCounts(README, 'routes');
  check(`every "N routes" in README uses ${agentRoutes.length}, the routes to agent functions`, routeClaims.length > 0 && routeClaims.every((w) => countOf(w) === agentRoutes.length), routeClaims.join(', ') || 'not stated');

  // ============================================ README: the diagram
  console.log('\n=== README: the architecture diagram draws what the code does ===');
  // The Mermaid diagram under "What talks to what", read as nodes (an id,
  // its shape and its label) and arrows (from, to and any label). A node
  // stands for the files its label names; an arrow between two such nodes
  // claims that every file of the first imports a file of the second.
  const talks = section(README, '### What talks to what');
  const mermaid = (talks.match(/```mermaid\n([\s\S]*?)```/) || [])[1] || '';
  const nodes = new Map([...mermaid.matchAll(/^\s*(\w+)(\["|\[\("|\(\[")(.*?)("\]|"\)\]|"\]\))\s*$/gm)]
    .map((m) => [m[1], { shape: m[2], label: m[3] }]));
  const arrows = [...mermaid.matchAll(/^\s*(\w+)\s*(?:-->|-\.->)\s*(?:\|"([^"]*)"\|\s*)?(\w+)\s*$/gm)]
    .map((m) => ({ from: m[1], to: m[3], label: m[2] || '' }));
  check('README draws the architecture as a Mermaid diagram', nodes.size > 0 && arrows.length > 0, `${nodes.size} nodes, ${arrows.length} arrows`);
  check('every arrow joins two nodes the diagram declares', arrows.every((a) => nodes.has(a.from) && nodes.has(a.to)), arrows.filter((a) => !nodes.has(a.from) || !nodes.has(a.to)).map((a) => `${a.from} -> ${a.to}`).join(', '));
  // A file under netlify/functions/ by its name alone, as a label gives it.
  const tsByName = new Map(FUNCTION_SOURCES.map(([rel, src]) => [path.posix.basename(rel), { rel, src }]));
  /** The files a node's label names. */
  const filesOf = (id) => [...((nodes.get(id) || { label: '' }).label.matchAll(/[\w-]+\.(?:ts|toml)\b/g))].map((m) => m[0]);
  const named = [...nodes.keys()].flatMap(filesOf);
  const unknown = named.filter((f) => !(tsByName.has(f) || (REPO_FILES || []).includes(f)));
  check('every file the diagram names is in the repository', named.length > 0 && unknown.length === 0, unknown.join(', '));
  const dirsNamed = [...nodes.values()].flatMap((n) => [...n.label.matchAll(/(?:^|<br\/>)([\w-]+\/)/g)].map((m) => m[1]));
  check('every directory the diagram names is in the repository', dirsNamed.every((d) => (REPO_FILES || []).some((f) => f.startsWith(d))), dirsNamed.join(', '));
  const fnFiles = FUNCTION_SOURCES.filter(([rel]) => path.posix.dirname(rel) === 'netlify/functions').map(([rel]) => path.posix.basename(rel));
  const libFiles = FUNCTION_SOURCES.filter(([rel]) => path.posix.dirname(rel) === 'netlify/functions/lib').map(([rel]) => path.posix.basename(rel));
  const drawnOnce = (f) => [...nodes.keys()].filter((id) => filesOf(id).includes(f)).length === 1;
  check('every function is drawn, once', fnFiles.length > 0 && fnFiles.every(drawnOnce), fnFiles.filter((f) => !drawnOnce(f)).join(', '));
  /** The files under netlify/functions/ that `file` imports, by name. */
  const importsOf = (file) => [...((tsByName.get(file) || { src: '' }).src.matchAll(/from '\.\/(?:lib\/)?([\w-]+)'/g))].map((m) => `${m[1]}.ts`);
  const fileNodes = [...nodes.keys()].filter((id) => filesOf(id).some((f) => f.endsWith('.ts')));
  /** The files of node `from` that import a file of node `to`. */
  const nodeImports = (from, to) => filesOf(from).filter((f) => importsOf(f).some((i) => filesOf(to).includes(i)));
  const unsound = arrows.filter((a) => fileNodes.includes(a.from) && fileNodes.includes(a.to) && nodeImports(a.from, a.to).length !== filesOf(a.from).length);
  check('every arrow between two modules is a real import, from every file of the first', unsound.length === 0, unsound.map((a) => `${a.from} -> ${a.to}`).join(', '));
  const fnNodes = fileNodes.filter((id) => filesOf(id).every((f) => fnFiles.includes(f)));
  const libNodes = fileNodes.filter((id) => filesOf(id).every((f) => libFiles.includes(f)));
  check('every node holds functions or library modules, not both', fileNodes.every((id) => fnNodes.includes(id) || libNodes.includes(id)), fileNodes.filter((id) => !fnNodes.includes(id) && !libNodes.includes(id)).join(', '));
  const undrawn = fnNodes.flatMap((from) => libNodes.filter((to) => nodeImports(from, to).length > 0 && !arrows.some((a) => a.from === from && a.to === to)).map((to) => `${from} -> ${to}`));
  check('every import from a function into a module drawn has its arrow', undrawn.length === 0, undrawn.join(', '));
  // The modules left out are named as such, so a new one has to be drawn or
  // listed.
  const notDrawnBullet = (talks.match(/^- \*\*Not drawn:\*\*.*$/m) || [''])[0].split(/, and the imports/)[0];
  const notDrawn = [...notDrawnBullet.matchAll(/`([\w-]+\.ts)`/g)].map((m) => m[1]);
  const libDrawn = libFiles.filter((f) => named.includes(f));
  const neither = minus(libFiles, [...libDrawn, ...notDrawn]);
  const wrongly = notDrawn.filter((f) => !libFiles.includes(f) || libDrawn.includes(f));
  check('every library module is drawn or listed as not drawn, not both', notDrawn.length > 0 && neither.length === 0 && wrongly.length === 0, `neither: ${neither}; listed but drawn or unknown: ${wrongly}`);

  // The code the claims below the diagram rest on, with its comments
  // removed by TypeScript's own printer, so that a comment naming a key or a
  // host counts for nothing.
  const ts = require('typescript');
  const codeOf = (file, text) => ts.createPrinter({ removeComments: true }).printFile(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true));
  const backendCode = FUNCTION_SOURCES.map(([rel, src]) => [path.posix.basename(rel), codeOf(rel, src)]);
  const appCode = codeOf('app.js', read('public', 'app.js'));
  const nodeOf = (file) => [...nodes.keys()].find((id) => filesOf(id).includes(file));
  const into = (id) => arrows.filter((a) => a.to === id).map((a) => a.from);

  // The browser: its one arrow goes to the routes, and the page asks nothing
  // of any other host.
  const browser = [...nodes.keys()].find((id) => /^Browser\b/.test(nodes.get(id).label));
  const routesNode = nodeOf('netlify.toml');
  const fromBrowser = arrows.filter((a) => a.from === browser);
  check('the browser\'s one arrow goes to netlify.toml\'s routes', Boolean(browser) && Boolean(routesNode) && fromBrowser.length === 1 && fromBrowser[0].to === routesNode, fromBrowser.map((a) => a.to).join(', '));
  // triggerAgent() passes its url parameter on to fetch(); every caller of it
  // gives a literal.
  const fetchArgs = [...appCode.matchAll(/\bfetch\(\s*([^,)]+)/g)].map((m) => m[1].trim());
  const triggerArgs = [...appCode.matchAll(/\btriggerAgent\(\s*([^,)]+)/g)].map((m) => m[1].trim()).filter((a) => a !== 'url');
  const toApi = (arg) => /^['"`]\/api\//.test(arg);
  check('app.js requests only routes under /api/', fetchArgs.length > 0 && fetchArgs.every((a) => toApi(a) || a === 'url') && triggerArgs.length > 0 && triggerArgs.every(toApi), [...fetchArgs, ...triggerArgs].filter((a) => !toApi(a) && a !== 'url').join(', '));
  check('app.js names no other host', !/:\/\//.test(appCode), (appCode.match(/\S*:\/\/\S*/) || [''])[0]);
  const loads = [...read('public', 'index.html').matchAll(/<(?:script|img|iframe)\b[^>]*\bsrc="([^"]*)"|<link\b[^>]*\bhref="([^"]*)"/g)].map((m) => m[1] || m[2]);
  check('index.html loads nothing from another host', loads.length > 0 && loads.every((u) => /^\/(?!\/)/.test(u)), loads.join(', '));
  check('styles.css loads nothing from another host', !/:\/\/|@import/.test(read('public', 'styles.css').replace(/\/\*[\s\S]*?\*\//g, '')));

  // The routes: one arrow to each function node, and the per-IP limit on the
  // arrows to exactly the functions whose routes carry it.
  const fromRoutes = arrows.filter((a) => a.from === routesNode);
  check('netlify.toml\'s routes reach every function node, and only those', fnNodes.length > 0 && fnNodes.every((id) => fromRoutes.some((a) => a.to === id)) && fromRoutes.every((a) => fnNodes.includes(a.to)), fromRoutes.map((a) => a.to).join(', '));
  const limitDrawn = fromRoutes.filter((a) => /per-IP limit/.test(a.label)).flatMap((a) => filesOf(a.to)).map((f) => path.basename(f, '.ts'));
  check('the per-IP limit is drawn on the arrows to exactly the rate-limited functions', limitDrawn.length > 0 && minus(limitDrawn, limitedFns).length === 0 && minus(limitedFns, limitDrawn).length === 0, `drawn: ${limitDrawn}; netlify.toml: ${limitedFns}`);

  // OpenRouter and the database: one arrow into each, from the one module
  // that reaches it, and the secrets each needs read there alone.
  const outside = (shape) => [...nodes.keys()].find((id) => nodes.get(id).shape === shape);
  const openRouterNode = outside('(["');
  const databaseNode = outside('[("');
  const readsVar = (name) => backendCode.filter(([, code]) => code.includes(`process.env.${name}`)).map(([f]) => f);
  const codeMatching = (re) => backendCode.filter(([, code]) => re.test(code)).map(([f]) => f);
  const onlyIn = (files, file) => files.length === 1 && files[0] === file;
  check('the one arrow into OpenRouter comes from openrouter.ts', Boolean(openRouterNode) && into(openRouterNode).length === 1 && filesOf(into(openRouterNode)[0]).join() === 'openrouter.ts', into(openRouterNode || '').join(', '));
  check('openrouter.ts makes the backend\'s one outgoing request', onlyIn(codeMatching(/\bfetch\(/), 'openrouter.ts') && onlyIn(codeMatching(/openrouter\.ai/), 'openrouter.ts'), `fetch: ${codeMatching(/\bfetch\(/)}; openrouter.ai: ${codeMatching(/openrouter\.ai/)}`);
  check('the OpenRouter key is read in openrouter.ts alone', onlyIn(readsVar('OPENROUTER_API_KEY'), 'openrouter.ts'), readsVar('OPENROUTER_API_KEY').join(', '));
  check('the one arrow into the database comes from supabase.ts', Boolean(databaseNode) && into(databaseNode).length === 1 && filesOf(into(databaseNode)[0]).join() === 'supabase.ts', into(databaseNode || '').join(', '));
  check('the Supabase client is made in supabase.ts alone', onlyIn(codeMatching(/\bcreateClient\(/), 'supabase.ts'), codeMatching(/\bcreateClient\(/).join(', '));
  check('the Supabase URL and key are read in supabase.ts alone', onlyIn(readsVar('SUPABASE_URL'), 'supabase.ts') && onlyIn(readsVar('SUPABASE_SERVICE_ROLE_KEY'), 'supabase.ts'), `${readsVar('SUPABASE_URL')} | ${readsVar('SUPABASE_SERVICE_ROLE_KEY')}`);
  const supabaseImporters = [...tsByName.keys()].filter((f) => importsOf(f).includes('supabase.ts'));
  const drawnIntoSupabase = into(nodeOf('supabase.ts') || '').flatMap(filesOf);
  check('the arrows into supabase.ts come from exactly the modules that import it', supabaseImporters.length > 0 && minus(supabaseImporters, drawnIntoSupabase).length === 0 && minus(drawnIntoSupabase, supabaseImporters).length === 0, `import it: ${supabaseImporters}; drawn: ${drawnIntoSupabase}`);
  const databaseTables = (nodes.get(databaseNode || '') || { label: '' }).label.split('<br/>').slice(1);
  check('the database node lists every table, in schema order', JSON.stringify(databaseTables) === JSON.stringify(Object.keys(TABLES)), databaseTables.join(', '));

  // ============================================ paths named anywhere
  console.log('\n=== README, SPEC.md and CLAUDE.md\'s requirement parts: every file and route they name exists ===');
  const CLAUDE_REQUIREMENTS = `${section(CLAUDE, '## Part 1 — The canonical charge sheet (fixed content, not user input)')}\n${section(CLAUDE, '## Part 5 — Core technical requirements')}`;
  check('CLAUDE.md Parts 1 and 5 were found', /^## Part 1 /m.test(CLAUDE_REQUIREMENTS) && /^## Part 5 /m.test(CLAUDE_REQUIREMENTS));
  const docsNamingThings = [['README.md', README], ['SPEC.md', SPEC], ['CLAUDE.md Parts 1 and 5', CLAUDE_REQUIREMENTS]];
  // A route is named with or without its method ("`GET /api/trials/:id`"),
  // in backticks or, as README's endpoint list names them, in a <code>
  // element with the method in bold ("<code><b>GET</b>  /api/case</code>").
  // It must be one netlify.toml serves, with a method README's endpoint list
  // gives it; a concrete segment such as jon_snow fills a placeholder such
  // as :role.
  for (const [doc, text] of docsNamingThings) {
    const routesNamed = new Map([
      ...text.matchAll(/`(?:(GET|POST|PUT|PATCH|DELETE) )?(\/api\/[^`\s]*)`/g),
      ...text.matchAll(/<code>(?:<b>(GET|POST|PUT|PATCH|DELETE)<\/b> +)?(\/api\/[^\s<]*)<\/code>/g),
    ].map((m) => [`${m[1] || ''} ${m[2]}`, m]));
    for (const [, [, method, named]] of routesNamed) {
      const served = redirects.filter((r) => new RegExp(`^${r.path.replace(/:\w+/g, '[^/]+')}$`).test(named));
      const methods = rows.filter((row) => served.some((r) => r.path === row.path)).map((row) => row.method);
      check(`${doc}: ${method ? `${method} ` : ''}${named} is a real route`, served.length > 0 && (!method || methods.includes(method)), served.length ? `methods: ${methods}` : 'not in netlify.toml');
    }
  }
  for (const [doc, text] of docsNamingThings) {
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

  // ============================================ SPEC.md and CLAUDE.md
  console.log('\n=== SPEC.md and CLAUDE.md: the case is the one the app serves ===');
  const seedParts = [['accused', SEED.accused], ['deceased', SEED.deceased], ['act alleged', SEED.actAlleged], ['question', SEED.question], ['scope note', SEED.scopeNote],
    ...SEED.background.map((p, i) => [`background paragraph ${i + 1}`, p]), ...SEED.agreedFacts.map((f, i) => [`stipulated fact ${i + 1}`, f])];
  check('the seed parsed', seedParts.every(([, v]) => typeof v === 'string' && v.length > 0) && SEED.agreedFacts.length > 0, seedParts.filter(([, v]) => !v).map(([k]) => k).join(', '));
  for (const [doc, text] of [['SPEC.md section 1', section(SPEC, '## 1. The charge sheet')], ['CLAUDE.md Part 1', section(CLAUDE, '## Part 1 — The canonical charge sheet (fixed content, not user input)')]]) {
    // A quoted passage wrapped over several lines carries a "> " on each one;
    // the marker is markup, not part of the quotation.
    const body = norm(text.replace(/^> ?/gm, ''));
    const differ = seedParts.filter(([, v]) => !body.includes(norm(v))).map(([k]) => k);
    check(`${doc} matches the seeded case word for word`, text.length > 0 && differ.length === 0, differ.join(', ') || (text ? '' : 'section missing'));
  }

  console.log('\n=== SPEC.md, CLAUDE.md and README agree with the schema on what is logged ===');
  const specFields = ((SPEC.match(/Every model call is logged with: ([^.]+)\./) || [])[1] || '').split(/, (?:and )?| and /).map((f) => f.trim().replace(/ /g, '_'));
  // CLAUDE.md is wrapped at 80 columns, so the line may break before the list.
  const claudeFields = ((CLAUDE.match(/every\s+call\s+must\s+log\s+`([^`]+)`/) || [])[1] || '').split(/,\s*/);
  // Parentheticals dropped first: they would hold a field's allowed values,
  // such as (`success` or `failed`), not further fields. "The spec" may be a
  // link to SPEC.md.
  const readmeFields = [...((sections.api_call_logs || '').match(/^- The fields (?:the spec|\[the spec\]\([^)\s]*\)) requires for every call: (.*)$/m) || ['', ''])[1].replace(/\([^)]*\)/g, '').matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);
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

  checkReferencesAreLinks();
}

// ======================================================== HARD RULE 4
/**
 * The anchors GitHub gives a Markdown file's headings: lower case, anything
 * but letters, digits, spaces, hyphens and underscores dropped, spaces turned
 * into hyphens, and a repeat suffixed -1, -2 and so on.
 * @param {string} doc
 * @returns {Set<string>}
 */
function headingAnchors(doc) {
  const seen = new Map();
  const anchors = new Set();
  for (const { text, kind } of markdownUnits(doc)) {
    if (kind !== 'heading') continue;
    const plain = text.replace(/^#+\s+/, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/`/g, '');
    const base = plain.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    anchors.add(n ? `${base}-${n}` : base);
  }
  return anchors;
}

/**
 * A Markdown file cut into the units HARD RULE 4 counts as paragraphs: a
 * heading, a table row, a list item with its continuation lines, or a
 * paragraph. Fenced code blocks are left out, since they cannot hold a link.
 * @param {string} doc
 * @returns {{
 *   text: string,
 *   kind: 'heading' | 'row' | 'item' | 'para',
 *   headings: string[]
 * }[]}
 */
function markdownUnits(doc) {
  const units = [];
  const headings = [];
  let fence = false;
  let current = null;
  for (const line of doc.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; current = null; continue; }
    if (fence || !line.trim()) { current = null; continue; }
    const heading = line.match(/^(#{1,6}) /);
    if (heading) {
      headings.splice(heading[1].length - 1);
      headings[heading[1].length - 1] = line;
      units.push({ text: line, kind: 'heading', headings: [...headings] });
      current = null;
      continue;
    }
    const kind = /^\s*\|/.test(line) ? 'row' : /^\s*([-*+]|\d+[.)]) /.test(line) ? 'item' : 'para';
    if (current && kind === 'para' && current.kind !== 'row') { current.text += `\n${line}`; continue; }
    current = { text: line, kind, headings: [...headings.filter(Boolean)] };
    units.push(current);
  }
  return units;
}

/** Whether a string names a commit in this repository. */
function isCommit(hash) {
  try {
    execFileSync('git', ['cat-file', '-e', `${hash}^{commit}`], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * HARD RULE 4 in CLAUDE.md: in every Markdown file but CLAUDE.md, a mention
 * of something with a home of its own is a link to that home, at its first
 * mention in each paragraph, and every link lands. Checked here: that every
 * link resolves (a file or directory in the repository, a heading's anchor,
 * a commit by its full hash, or a compare page by full hashes whose base is
 * an ancestor of its head); that no link destination holds whitespace; and,
 * for the kinds of mention a script can recognise, that the first mention in
 * each paragraph is linked to the right place - a file or directory in the
 * repository, another Markdown file, `npm test`, a database table outside
 * its own README section, an API route outside README's endpoint list, and
 * the thing a README section's heading names ("The escalation chain")
 * outside that section - and that a commit hash is linked at every mention.
 * Whether a prose mention of a commit is linked, or a link's words describe
 * its target, stays a reading job.
 */
function checkReferencesAreLinks() {
  console.log('\n=== Every Markdown file but CLAUDE.md: references are links (HARD RULE 4) ===');
  const docs = (REPO_FILES || []).filter((f) => /\.md$/i.test(f) && f !== 'CLAUDE.md');
  check('the rule covers README.md and SPEC.md', docs.includes('README.md') && docs.includes('SPEC.md'), docs.join(', '));
  const tracked = new Set(REPO_FILES || []);
  const trackedDirs = new Set((REPO_FILES || []).flatMap((f) => f.split('/').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/'))));
  const byBasename = new Map();
  for (const f of tracked) byBasename.set(path.posix.basename(f), [...(byBasename.get(path.posix.basename(f)) || []), f]);
  const COMMIT_URL = /^https:\/\/github\.com\/guycn1\/tribunal\/commit\/([0-9a-f]+)$/;
  const COMPARE_URL = /^https:\/\/github\.com\/guycn1\/tribunal\/compare\/([0-9a-f]+)\.\.\.([0-9a-f]+)$/;
  const anchorCache = new Map();
  const anchorsOf = (file) => {
    if (!anchorCache.has(file)) anchorCache.set(file, headingAnchors(read(...file.split('/'))));
    return anchorCache.get(file);
  };

  for (const doc of docs) {
    const text = read(...doc.split('/'));
    const dir = path.posix.dirname(doc);
    const units = markdownUnits(text);
    /**
     * Where a link destination lands, as a repository path with an optional
     * anchor ('README.md#database', '#call-log' for this file), or null when
     * it is an outside URL.
     */
    const landing = (dest) => {
      if (/^[a-z]+:/i.test(dest)) return null;
      const [p, anchor] = dest.split('#');
      const file = p ? path.posix.normalize(path.posix.join(dir, p)).replace(/\/$/, '') : doc;
      return { file, anchor: anchor === undefined ? null : anchor };
    };

    const broken = [];
    const spaced = [];
    for (const { text: unit } of units) {
      for (const m of unit.matchAll(/\]\(([^)]*)\)/g)) {
        const dest = m[1];
        if (/\s/.test(dest)) { spaced.push(dest); continue; }
        const commit = dest.match(COMMIT_URL);
        const compare = dest.match(COMPARE_URL);
        if (commit) {
          if (commit[1].length !== 40 || !isCommit(commit[1])) broken.push(dest);
        } else if (compare) {
          const [, base, head] = compare;
          let ancestor = false;
          try { execFileSync('git', ['merge-base', '--is-ancestor', base, head], { cwd: ROOT, stdio: 'ignore' }); ancestor = true; } catch { /* not an ancestor */ }
          if (base.length !== 40 || head.length !== 40 || !isCommit(base) || !isCommit(head) || !ancestor) broken.push(dest);
        } else if (/^https:\/\/github\.com\/guycn1\/tribunal\//.test(dest)) {
          broken.push(`${dest} (a link into this repository is relative, or a commit or compare page by full hash)`);
        } else {
          const to = landing(dest);
          if (!to) continue;
          if (!tracked.has(to.file) && !trackedDirs.has(to.file)) broken.push(dest);
          else if (to.anchor !== null && (!/\.md$/i.test(to.file) || !anchorsOf(to.file).has(to.anchor))) broken.push(dest);
        }
      }
    }
    check(`${doc}: every link lands - a tracked file or directory, a heading's anchor, or a commit or compare page by full hashes`, broken.length === 0, broken.join(' | '));
    check(`${doc}: no link destination holds whitespace`, spaced.length === 0, spaced.join(' | '));

    /**
     * The mentions in one unit, in order: each backticked span and each bare
     * Markdown file name, with the destination of the link it sits in, if any.
     */
    const mentions = (unit) => {
      const links = [...unit.matchAll(/\[((?:[^\]`]|`[^`]*`)*)\]\(([^)\s]*)\)/g)].map((m) => ({ start: m.index, end: m.index + m[1].length + 1, dest: m[2] }));
      const linkOf = (i) => (links.find((l) => i > l.start && i < l.end) || {}).dest;
      const inDest = (i) => [...unit.matchAll(/\]\([^)]*\)/g)].some((m) => i > m.index && i < m.index + m[0].length);
      const found = [];
      for (const m of unit.matchAll(/`([^`]+)`|\b([\w-]+\.md)\b/g)) {
        if (inDest(m.index)) continue;
        if (m[2] && unit.slice(0, m.index).split('`').length % 2 === 0) continue;
        found.push({ token: m[1] || m[2], dest: linkOf(m.index) });
      }
      return found;
    };
    const unlinked = { files: [], hashes: [], npmTest: [], tables: [], routes: [] };
    for (const { text: unit, kind, headings } of units) {
      if (kind === 'heading') continue;
      const done = new Set();
      const section = headings[headings.length - 1] || '';
      /**
       * Requires the first mention of `target` in this unit to link where `ok`
       * says.
       */
      const firstMustLink = (bucket, target, dest, ok, label) => {
        if (done.has(target)) return;
        done.add(target);
        if (!dest || !ok(dest)) bucket.push(`${label}${dest ? ` -> ${dest}` : ''}`);
      };
      for (const { token, dest } of mentions(unit)) {
        const bare = token.replace(/\/$/, '');
        const file = tracked.has(bare) || trackedDirs.has(bare) ? bare
          : (byBasename.get(bare) || []).length === 1 ? byBasename.get(bare)[0] : null;
        if (file && file !== doc && !/\s/.test(token)) {
          firstMustLink(unlinked.files, `file:${file}`, dest, (d) => { const to = landing(d); return to && to.file === file; }, token);
        }
        const hash = token.match(/^[0-9a-f]{7,40}$/) && /[a-f]/.test(token) && /\d/.test(token) && isCommit(token) ? token : null;
        if (hash) {
          firstMustLink(unlinked.hashes, `hash:${hash}`, dest, (d) => { const c = d.match(COMMIT_URL); return c && c[1].startsWith(hash); }, hash);
          done.delete(`hash:${hash}`); // a hash is linked at every mention, not only the first
        }
        if (token === 'npm test') {
          firstMustLink(unlinked.npmTest, 'npm test', dest, (d) => { const to = landing(d); return to && to.file === 'tests'; }, token);
        }
        if (TABLES[token] && section !== `#### ${token}`) {
          const home = doc === 'README.md' ? '' : 'README.md';
          firstMustLink(unlinked.tables, `table:${token}`, dest, (d) => { const to = landing(d); return to && to.file === (home || doc) && to.anchor === token; }, token);
        }
        const route = token.match(/^(?:(?:GET|POST|PUT|PATCH|DELETE) )?(\/api\/\S*)$/);
        if (route && !(doc === 'README.md' && headings.includes('### API endpoints'))) {
          firstMustLink(unlinked.routes, `route:${route[1]}`, dest, (d) => { const to = landing(d); return to && to.file === 'README.md' && to.anchor === 'api-endpoints'; }, token);
        }
      }
    }
    check(`${doc}: the first mention of a file, a directory or another Markdown file in each paragraph links to it`, unlinked.files.length === 0, unlinked.files.join(' | '));
    check(`${doc}: every commit hash links to its commit page by the full hash`, unlinked.hashes.length === 0, unlinked.hashes.join(' | '));
    check(`${doc}: the first \`npm test\` in each paragraph links to tests/`, unlinked.npmTest.length === 0, unlinked.npmTest.join(' | '));
    check(`${doc}: a database table named outside its own README section links there`, unlinked.tables.length === 0, unlinked.tables.join(' | '));
    check(`${doc}: an API route named outside README's endpoint list links to it`, unlinked.routes.length === 0, unlinked.routes.join(' | '));

    // A README section whose heading names a thing ("The escalation chain")
    // is that thing's home: outside the section, the first mention of it in
    // each paragraph, with or without its article, links to the section.
    const unlinkedSections = [];
    for (const { heading, anchor, phrase } of NAMED_README_SECTIONS) {
      const pattern = new RegExp(`\\b${phrase.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')}\\b`, 'i');
      for (const { text: unit, kind, headings } of units) {
        if (kind === 'heading' || (doc === 'README.md' && headings.includes(heading))) continue;
        const at = unit.search(pattern);
        if (at < 0) continue;
        const link = [...unit.matchAll(/\[((?:[^\]`]|`[^`]*`)*)\]\(([^)\s]*)\)/g)].find((m) => at > m.index && at < m.index + m[1].length + 1);
        const to = link && landing(link[2]);
        if (!to || to.file !== 'README.md' || to.anchor !== anchor) unlinkedSections.push(`"${unit.slice(at, at + phrase.length + 10).replace(/\s+/g, ' ')}"${link ? ` -> ${link[2]}` : ''}`);
      }
    }
    check(`${doc}: a README section whose heading names a thing is linked where that thing is named`, unlinkedSections.length === 0, unlinkedSections.join(' | '));
  }
}

/**
 * README's sections whose heading names a thing ("The escalation chain"):
 * the heading line, its anchor, and the thing's name without its article.
 */
const NAMED_README_SECTIONS = (() => {
  const anchors = [...headingAnchors(README)];
  const units = markdownUnits(README).filter((u) => u.kind === 'heading');
  return units.map((u, i) => ({ heading: u.text, anchor: anchors[i], m: u.text.match(/^#{2,6} The (.+)$/) }))
    .filter((s) => s.m)
    .map(({ heading, anchor, m }) => ({ heading, anchor, phrase: m[1].toLowerCase() }));
})();

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
