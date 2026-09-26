/**
 * @file Compiles backend TypeScript from netlify/functions/ with the
 * project's own tsc, so a test can require the real shipped source rather
 * than a hand-copied imitation of it. Shared by every suite that needs the
 * backend's behaviour rather than just its text.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

// Run tsc's own JS entrypoint with this Node binary rather than the
// node_modules/.bin shim: on Windows that shim is a .cmd, which
// execFileSync cannot spawn without a shell.
const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

/**
 * @typedef {object} CompiledBackend
 * @property {string} outDir Where the compiled .js files were written.
 * @property {(file: string) => any} load Requires one compiled file, by
 *   its path relative to netlify/functions/ with a .js extension (e.g.
 *   'lib/openrouter.js').
 * @property {() => void} cleanup Deletes the compiled output.
 */

/**
 * Compiles the given files, and everything they import, into a fresh
 * temporary directory that mirrors netlify/functions/.
 *
 * @param {string[]} files Paths relative to netlify/functions/, e.g.
 *   'lib/db.ts' or 'judge-background.ts'.
 * @returns {CompiledBackend}
 */
function compileBackend(files) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tribunal-tests-'));
  execFileSync(
    process.execPath,
    [
      TSC,
      ...files.map((file) => path.join('netlify', 'functions', file)),
      '--target', 'ES2020', '--module', 'commonjs', '--moduleResolution', 'node',
      '--esModuleInterop', '--skipLibCheck',
      // Transpile only. Type-checking is `npm run typecheck`'s job, against
      // the project's own tsconfig.json; checking again here under different
      // module-resolution flags reports errors that config does not have
      // (@netlify/functions' types resolve differently) and would fail a
      // suite over something that is not what it tests.
      '--noCheck',
      // Pinned so the output layout never depends on which files were asked
      // for: lib/ files always land in <outDir>/lib/.
      '--rootDir', path.join('netlify', 'functions'),
      '--outDir', outDir,
    ],
    { cwd: ROOT, stdio: 'inherit' }
  );
  return {
    outDir,
    load: (file) => require(path.join(outDir, file)),
    cleanup: () => fs.rmSync(outDir, { recursive: true, force: true }),
  };
}

module.exports = { compileBackend, ROOT };
