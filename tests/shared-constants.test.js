/**
 * @file Asserts that values deliberately duplicated across files still agree,
 * and that the page's timeouts outlast the server's time budget.
 *
 * Run with `npm test`. No framework, no network, no build: every check
 * reads the real source files as text and compares what it finds.
 *
 * Why these duplications exist and can't simply be removed: public/app.js is
 * served as a plain static file with no build step, so it cannot import from
 * the esbuild-bundled Netlify Functions, and CSS cannot read a JS constant.
 * Each pair below is therefore a hand-maintained copy with a comment asking
 * the next person to keep it in step - and a comment cannot enforce anything.
 * That is what this file is for.
 *
 * The marker strings are the ones that actually matter at runtime. They are a
 * wire format: the backend writes them into api_call_logs.error_message and
 * the frontend matches on the prefix to decide what a row means. A marker
 * that exists on the backend but is missing or misspelled in app.js falls
 * straight past isRetriedMarkerLog()'s guard in deriveRoleStates() and lands
 * in the terminal-failure branch, so an agent card reads "call failed" while
 * its escalation chain is still running and about to succeed.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
/**
 * Reads a repository file as UTF-8 text.
 * @param {...string} p Path segments, relative to the repository root.
 * @returns {string}
 */
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

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

const openrouter = read('netlify', 'functions', 'lib', 'openrouter.ts');
const db = read('netlify', 'functions', 'lib', 'db.ts');
const appJs = read('public', 'app.js');
const css = read('public', 'styles.css');

// --- 1. The six marker strings: openrouter.ts <-> app.js ------------------
console.log('\n=== Marker strings agree between backend and frontend ===');

/**
 * Finds every `const *_MARKER = '...'` declaration in a source file,
 * exported or not.
 * @param {string} source
 * @returns {Map<string, string>} Each marker's name, mapped to its string.
 */
function markers(source) {
  const found = new Map();
  const re = /(?:export\s+)?const\s+([A-Z0-9_]*MARKER)\s*=\s*'([^']*)'/g;
  let m;
  while ((m = re.exec(source)) !== null) found.set(m[1], m[2]);
  return found;
}

const backendMarkers = markers(openrouter);
const frontendMarkers = markers(appJs);

// A regex that silently matched nothing would make every check below pass
// vacuously, which is the one failure mode a test like this must not have.
check('found markers in openrouter.ts at all', backendMarkers.size > 0, String(backendMarkers.size));
check('found markers in app.js at all', frontendMarkers.size > 0, String(frontendMarkers.size));

const onlyBackend = [...backendMarkers.keys()].filter((k) => !frontendMarkers.has(k));
const onlyFrontend = [...frontendMarkers.keys()].filter((k) => !backendMarkers.has(k));
check(
  'every backend marker is declared in app.js',
  onlyBackend.length === 0,
  `missing from app.js: ${onlyBackend.join(', ')} - a discarded attempt carrying one of these would be shown as a terminal "call failed"`
);
check(
  'app.js declares no marker the backend does not',
  onlyFrontend.length === 0,
  `not in openrouter.ts: ${onlyFrontend.join(', ')}`
);

for (const [name, value] of backendMarkers) {
  if (!frontendMarkers.has(name)) continue;
  check(`${name} has the same value in both`, frontendMarkers.get(name) === value, `backend '${value}' vs frontend '${frontendMarkers.get(name)}'`);
}

// --- 1b. Which markers mean "discarded and retried": the same set on both sides
console.log('\n=== Both sides agree which markers are retries, not outcomes ===');

// A row carrying one of these is not a role's final outcome. The frontend
// uses its list (isRetriedMarkerLog) to keep polling a role instead of
// showing "call failed"; the backend uses its own (RETRIED_ATTEMPT_MARKERS)
// to decide when every judge has finished and the trial is complete. If the
// two disagree, one side calls a role finished while the other is still
// waiting on it.
const frontendRetried = new Set(((appJs.match(/function isRetriedMarkerLog[\s\S]*?\n\}/) || [''])[0].match(/[A-Z0-9_]+_MARKER\b/g) || []));
const backendRetried = new Set(((openrouter.match(/export const RETRIED_ATTEMPT_MARKERS = \[[\s\S]*?\];/) || [''])[0].match(/[A-Z0-9_]+_MARKER\b/g) || []));
check('found the retried markers in app.js', frontendRetried.size > 0, String(frontendRetried.size));
check('found the retried markers in openrouter.ts', backendRetried.size > 0, String(backendRetried.size));
check(
  'both name the same markers',
  frontendRetried.size === backendRetried.size && [...frontendRetried].every((name) => backendRetried.has(name)),
  `app.js: ${[...frontendRetried].join(', ')} | openrouter.ts: ${[...backendRetried].join(', ')}`
);

// --- 2. ABORTED_BY_USER_MESSAGE and NO_MODEL_USED: db.ts <-> app.js -----
console.log('\n=== The abort rows\' marker message and model agree ===');

const abortRe = /(?:export\s+)?const\s+ABORTED_BY_USER_MESSAGE\s*=\s*'([^']*)'/;
const abortBackend = (db.match(abortRe) || [])[1];
const abortFrontend = (appJs.match(abortRe) || [])[1];
check('ABORTED_BY_USER_MESSAGE found in db.ts', Boolean(abortBackend));
check('ABORTED_BY_USER_MESSAGE found in app.js', Boolean(abortFrontend));
check(
  'ABORTED_BY_USER_MESSAGE is identical in both',
  Boolean(abortBackend) && abortBackend === abortFrontend,
  `db.ts '${abortBackend}' vs app.js '${abortFrontend}' - deriveRoleStates() compares this by exact equality to show "aborted" rather than "call failed"`
);

// The abort rows' model_used: app.js compares it by exact equality to print
// it as written instead of shortening it like a model id ("n/a" -> "a").
const noModelRe = /(?:export\s+)?const\s+NO_MODEL_USED\s*=\s*'([^']*)'/;
const noModelBackend = (db.match(noModelRe) || [])[1];
const noModelFrontend = (appJs.match(noModelRe) || [])[1];
check('NO_MODEL_USED found in db.ts', Boolean(noModelBackend));
check('NO_MODEL_USED found in app.js', Boolean(noModelFrontend));
check(
  'NO_MODEL_USED is identical in both',
  Boolean(noModelBackend) && noModelBackend === noModelFrontend,
  `db.ts '${noModelBackend}' vs app.js '${noModelFrontend}' - the call log would shorten the abort rows' model like a model id`
);

// --- 3. Spinner duration: app.js <-> styles.css --------------------------
console.log('\n=== Spinner duration agrees between JS and CSS ===');

// app.js gives a freshly recreated spinner a negative animation-delay keyed
// to the wall clock, so it starts at the angle a continuously-running one
// would already be at. That only works if it knows the real CSS duration.
const spinnerMs = Number((appJs.match(/const\s+SPINNER_ANIMATION_MS\s*=\s*(\d+)/) || [])[1]);
const spinSeconds = Number((css.match(/animation:\s*spin\s+([\d.]+)s/) || [])[1]);
check('SPINNER_ANIMATION_MS found in app.js', Number.isFinite(spinnerMs), String(spinnerMs));
check('spin animation duration found in styles.css', Number.isFinite(spinSeconds), String(spinSeconds));
check(
  'the two describe the same duration',
  spinnerMs === spinSeconds * 1000,
  `app.js ${spinnerMs}ms vs styles.css ${spinSeconds}s - a mismatch makes the spinner visibly jump on every re-render`
);

// Under prefers-reduced-motion the rotation slows, and spinnerHtml() takes
// the wall clock modulo that longer duration. One delay then suits both
// speeds only while the longer is a whole multiple of the shorter.
const reducedMs = Number((appJs.match(/const\s+SPINNER_REDUCED_MOTION_MS\s*=\s*(\d+)/) || [])[1]);
const reducedSeconds = Number((css.match(/prefers-reduced-motion:\s*reduce\)\s*\{\s*\.spinner\s*\{\s*animation-duration:\s*([\d.]+)s/) || [])[1]);
check('SPINNER_REDUCED_MOTION_MS found in app.js', Number.isFinite(reducedMs), String(reducedMs));
check('reduced-motion spinner duration found in styles.css', Number.isFinite(reducedSeconds), String(reducedSeconds));
check(
  'the two reduced-motion durations agree',
  reducedMs === Math.round(reducedSeconds * 1000),
  `app.js ${reducedMs}ms vs styles.css ${reducedSeconds}s - a mismatch makes the spinner jump on every re-render under reduced motion`
);
check(
  'the reduced-motion duration is a whole multiple of the normal one',
  Number.isFinite(reducedMs) && Number.isFinite(spinnerMs) && spinnerMs > 0 && reducedMs % spinnerMs === 0,
  `${reducedMs} is not a multiple of ${spinnerMs} - one animation-delay can no longer suit both speeds`
);

// --- 4. Sidebar width: .sidebar <-> .main-loading-overlay ----------------
console.log('\n=== The loading overlay starts where the sidebar ends ===');

// .main-loading-overlay is position: fixed, so it is out of flow and cannot
// inherit the sidebar's width - it restates the same clamp() to line its
// left edge up with the sidebar's right edge.
const sidebarWidth = (css.match(/width:\s*(clamp\([^)]*\))/) || [])[1];
const overlayLeft = (css.match(/left:\s*(clamp\([^)]*\))/) || [])[1];
check('a width: clamp() was found', Boolean(sidebarWidth), String(sidebarWidth));
check('a left: clamp() was found', Boolean(overlayLeft), String(overlayLeft));
check(
  'the overlay offset matches the sidebar width',
  Boolean(sidebarWidth) && sidebarWidth === overlayLeft,
  `sidebar '${sidebarWidth}' vs overlay '${overlayLeft}' - a mismatch leaves the overlay covering the sidebar or leaving a strip of .main uncovered`
);

// --- 5. Dimmed call-log rows: app.js <-> styles.css -----------------------
console.log('\n=== The class that dims a call-log row is the one styled ===');

// renderCallLog() dims a non-final row by adding a class; a rename on one
// side only would leave those rows at full opacity with nothing failing.
const dimClass = (appJs.match(/tr\.classList\.add\('([\w-]+)'\)/) || [])[1];
check('app.js adds a class to dim a row', Boolean(dimClass), String(dimClass));
check(
  'styles.css styles that class',
  Boolean(dimClass) && new RegExp(`tr\\.${dimClass}\\s*\\{[^}]*opacity`).test(css),
  `app.js adds '${dimClass}', but no 'tr.${dimClass} { opacity ... }' rule was found in styles.css`
);

// --- 6. The roles: the backend's definitions <-> everywhere they recur ----
console.log('\n=== Every copy of the roles names the same roles ===');

// representatives.ts and judges.ts define the roles. app.js lists them to
// draw a card per role and to know which phase a row belongs to, the schema
// rejects any other role, and types.ts and prompts.ts name them again. A
// role missing from one copy shows up only when that role runs.
const representativesTs = read('netlify', 'functions', 'lib', 'representatives.ts');
const judgesTs = read('netlify', 'functions', 'lib', 'judges.ts');
const typesTs = read('netlify', 'functions', 'lib', 'types.ts');
const promptsTs = read('netlify', 'functions', 'lib', 'prompts.ts');
const schema = read('supabase', 'schema.sql');
/**
 * Every quoted string in a stretch of source, in order.
 * @param {string} text
 * @returns {string[]}
 */
const quoted = (text) => [...String(text || '').matchAll(/'([^']*)'/g)].map((m) => m[1]);
/**
 * Whether two lists hold the same values, in any order.
 * @param {string[]} a
 * @param {string[]} b
 * @returns {boolean}
 */
const sameSet = (a, b) => a.length === b.length && new Set(a).size === a.length && a.every((x) => b.includes(x));

const backendReps = [...representativesTs.matchAll(/^ {2}(\w+): \{\r?\n {4}role: '(\w+)',\r?\n {4}name: '([^']+)',\r?\n {4}seat: '(\w+)'/gm)].map((m) => ({ key: m[1], role: m[2], name: m[3], seat: m[4] }));
const backendJudges = [...judgesTs.matchAll(/^ {2}(\w+): \{\r?\n {4}role: '(\w+)',/gm)].map((m) => ({ key: m[1], role: m[2] }));
check('found the representatives in representatives.ts', backendReps.length > 0, String(backendReps.length));
check('found the judges in judges.ts', backendJudges.length > 0, String(backendJudges.length));
check('each definition is keyed by its own role', [...backendReps, ...backendJudges].every((d) => d.key === d.role), JSON.stringify([...backendReps, ...backendJudges].filter((d) => d.key !== d.role)));
const repRoles = backendReps.map((d) => d.role);
const judgeRoles = backendJudges.map((d) => d.role);

const copies = {
  representatives: [
    ["app.js's REPRESENTATIVE_ROLES", quoted((appJs.match(/const REPRESENTATIVE_ROLES = \[([^\]]*)\]/) || [])[1])],
    ["app.js's REPRESENTATIVE_META", [...((appJs.match(/const REPRESENTATIVE_META = \{([\s\S]*?)\};/) || [])[1] || '').matchAll(/^ {2}(\w+):/gm)].map((m) => m[1])],
    ["prompts.ts's REPRESENTATIVE_ORDER", quoted((promptsTs.match(/const REPRESENTATIVE_ORDER: RepresentativeRole\[\] = \[([^\]]*)\]/) || [])[1])],
    ["types.ts's RepresentativeRole", quoted((typesTs.match(/export type RepresentativeRole = ([^;]*);/) || [])[1])],
    ["schema.sql's representative_arguments", quoted((schema.match(/create table if not exists representative_arguments[\s\S]*?role text not null check \(role in \(([^)]*)\)\)/) || [])[1])],
  ],
  judges: [
    ["app.js's JUDGE_ROLES", quoted((appJs.match(/const JUDGE_ROLES = \[([^\]]*)\]/) || [])[1])],
    ["app.js's JUDGE_META", [...((appJs.match(/const JUDGE_META = \{([\s\S]*?)\};/) || [])[1] || '').matchAll(/^ {2}(\w+):/gm)].map((m) => m[1])],
    ["types.ts's JudgeRole", quoted((typesTs.match(/export type JudgeRole = ([^;]*);/) || [])[1])],
    ["schema.sql's judge_rulings", quoted((schema.match(/create table if not exists judge_rulings[\s\S]*?role text not null check \(role in \(([^)]*)\)\)/) || [])[1])],
  ],
};
for (const [kind, list] of Object.entries(copies)) {
  const roles = kind === 'representatives' ? repRoles : judgeRoles;
  for (const [where, found] of list) {
    check(`${where} names the same ${kind}`, roles.length > 0 && sameSet(found, roles), `${where}: ${found.join(', ')} | backend: ${roles.join(', ')}`);
  }
}

// models.ts maps every role, of both kinds, to its model override variable.
const roleEnvVarRoles = [...((read('netlify', 'functions', 'lib', 'models.ts').match(/const ROLE_ENV_VAR: Record<string, string> = \{([\s\S]*?)\};/) || [])[1] || '').matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]);
check("models.ts's ROLE_ENV_VAR names every role, and only those", repRoles.length > 0 && sameSet(roleEnvVarRoles, [...repRoles, ...judgeRoles]), roleEnvVarRoles.join(', '));

// Each card shows its representative's name and seat from app.js's own copy.
const metaBlock = (appJs.match(/const REPRESENTATIVE_META = \{([\s\S]*?)\};/) || [])[1] || '';
const frontendMeta = Object.fromEntries([...metaBlock.matchAll(/^ {2}(\w+): \{ name: '([^']+)', seat: '(\w+)' \}/gm)].map((m) => [m[1], { name: m[2], seat: m[3] }]));
for (const d of backendReps) {
  const f = frontendMeta[d.role];
  check(`${d.role}: app.js shows the same name and seat`, Boolean(f) && f.name === d.name && f.seat === d.seat, f ? `${f.name}/${f.seat} vs ${d.name}/${d.seat}` : 'missing from REPRESENTATIVE_META');
}

// --- 7. The page's timeouts outlast the server's budget ------------------
console.log('\n=== The page waits longer than a call can run ===');

// Polling gives up after POLL_TIMEOUT_MS. Were it shorter than the server's
// budget, a call could succeed after the page had stopped waiting; this
// happened once, when the budget was raised and this constant was not. The
// sidebar's "interrupted" label needs more still: both phases, one after the
// other.
/**
 * A numeric constant's value from source, products such as 40 * 60 * 1000
 * included.
 * @param {string} source
 * @param {string} name
 * @returns {number}
 */
const numericConst = (source, name) => {
  const expr = (source.match(new RegExp(`const ${name} = ([\\d\\s*]+);`)) || [])[1];
  return expr ? expr.split('*').reduce((product, n) => product * Number(n.trim()), 1) : NaN;
};
const budgetMs = numericConst(openrouter, 'TOTAL_BUDGET_MS');
const pollMs = numericConst(appJs, 'POLL_TIMEOUT_MS');
const interruptedMs = numericConst(appJs, 'INTERRUPTED_THRESHOLD_MS');
check('TOTAL_BUDGET_MS found in openrouter.ts', Number.isFinite(budgetMs) && budgetMs > 0, String(budgetMs));
check('POLL_TIMEOUT_MS is above it', Number.isFinite(pollMs) && pollMs > budgetMs, `${pollMs} vs ${budgetMs}`);
check('INTERRUPTED_THRESHOLD_MS is above twice it', Number.isFinite(interruptedMs) && interruptedMs > 2 * budgetMs, `${interruptedMs} vs ${2 * budgetMs}`);

// --- 8. The scrollbar's resting opacity: app.js <-> styles.css -----------
console.log('\n=== The scrollbar rests at the same opacity in JS and CSS ===');

// styles.css falls back to its own copy when the custom property is unset.
const restOpacity = Number((appJs.match(/const SCROLLBAR_REST_OPACITY = (\d+);/) || [])[1]);
const cssFallbacks = [...css.matchAll(/var\(--scrollbar-thumb-opacity, (\d+)%\)/g)].map((m) => Number(m[1]));
check('SCROLLBAR_REST_OPACITY found in app.js', Number.isFinite(restOpacity), String(restOpacity));
check('styles.css has a fallback for it', cssFallbacks.length > 0, String(cssFallbacks.length));
check('every fallback is the resting opacity', cssFallbacks.length > 0 && cssFallbacks.every((n) => n === restOpacity), `app.js ${restOpacity}, styles.css ${cssFallbacks.join(', ')}`);

// --- 9. The phrase that tells a truncation from a degeneration -----------
console.log('\n=== The call log reads a truncation by the phrase the backend writes ===');

// Both reach the call log under the same marker; renderCallLog() picks the
// badge by looking for this phrase in the message.
const capPhrase = (appJs.match(/const hitTokenCap = err\.includes\('([^']+)'\)/) || [])[1];
const truncationReason = (openrouter.match(/TRUNCATED[^\n]*\r?\n\s*reason = '([^']+)'/) || [])[1];
check('app.js keys on a phrase', Boolean(capPhrase), String(capPhrase));
check('found the truncation reason in openrouter.ts', Boolean(truncationReason), String(truncationReason));
check('the truncation reason contains that phrase', Boolean(capPhrase) && Boolean(truncationReason) && truncationReason.includes(capPhrase), `'${capPhrase}' in '${truncationReason}'`);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
