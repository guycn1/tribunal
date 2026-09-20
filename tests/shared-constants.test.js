// Asserts that values deliberately duplicated across files still agree.
//
// Run with `npm test`. No framework, no network, no build: every check
// reads the real source files as text and compares what it finds.
//
// Why these duplications exist and can't simply be removed: public/app.js is
// served as a plain static file with no build step, so it cannot import from
// the esbuild-bundled Netlify Functions, and CSS cannot read a JS constant.
// Each pair below is therefore a hand-maintained copy with a comment asking
// the next person to keep it in step - and a comment cannot enforce anything.
// That is what this file is for.
//
// The marker strings are the ones that actually matter at runtime. They are a
// wire format: the backend writes them into api_call_logs.error_message and
// the frontend matches on the prefix to decide what a row means. A marker
// that exists on the backend but is missing or misspelled in app.js falls
// straight past isRetriedMarkerLog()'s guard in deriveRoleStates() and lands
// in the terminal-failure branch, so an agent card reads "Call failed" while
// its escalation chain is still running and about to succeed. That is the
// exact bug 197609b and c1155f3 were written to fix, it fails silently, and
// it only shows on the escalation path - the path a developer sees least.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

let failures = 0;
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
  `missing from app.js: ${onlyBackend.join(', ')} - a discarded attempt carrying one of these would be shown as a terminal "Call failed"`
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

// --- 2. ABORTED_BY_USER_MESSAGE: db.ts <-> app.js ------------------------
console.log('\n=== The abort marker message agrees ===');

const abortRe = /(?:export\s+)?const\s+ABORTED_BY_USER_MESSAGE\s*=\s*'([^']*)'/;
const abortBackend = (db.match(abortRe) || [])[1];
const abortFrontend = (appJs.match(abortRe) || [])[1];
check('ABORTED_BY_USER_MESSAGE found in db.ts', Boolean(abortBackend));
check('ABORTED_BY_USER_MESSAGE found in app.js', Boolean(abortFrontend));
check(
  'ABORTED_BY_USER_MESSAGE is identical in both',
  Boolean(abortBackend) && abortBackend === abortFrontend,
  `db.ts '${abortBackend}' vs app.js '${abortFrontend}' - loadTrial() compares this by exact equality to show "Aborted" rather than "Call failed"`
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

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
