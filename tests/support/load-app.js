/**
 * @file Runs public/app.js's real source against the smallest DOM it
 * touches, and hands chosen top-level names back out of its scope. Shared by
 * every suite that needs the shipped frontend's behaviour, so all of them
 * exercise the same file under the same stub rather than private copies of
 * either.
 */

const fs = require('node:fs');
const path = require('node:path');

const APP_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'app.js'), 'utf8');

/**
 * Builds a stub element carrying just the DOM surface app.js's render path
 * touches. Children are tracked, so node identity can be asserted across
 * renders; markup assigned to innerHTML is stored verbatim, not parsed.
 *
 * @param {string} [tag='div']
 * @returns {object}
 */
function makeElement(tag = 'div') {
  const kids = [];
  const classes = new Set();
  const el = {
    tagName: String(tag).toUpperCase(),
    kids,
    dataset: {},
    style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' },
    className: '',
    textContent: '',
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
    hidden: false,
    parentElement: null,
    // Tracked for real, not a no-op: the loading overlay, the sidebar lock
    // and the Abort button are all shown and hidden through classes, and a
    // no-op here once let a check pass with the overlay stuck on screen.
    // className stays a separate plain string, unlike a real DOM - no check
    // reads a class that was set through className.
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle(name, force) {
        const on = force === undefined ? !classes.has(name) : Boolean(force);
        if (on) classes.add(name);
        else classes.delete(name);
        return on;
      },
      contains: (name) => classes.has(name),
    },
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }),
    scrollIntoView() {},
    appendChild(child) { kids.push(child); child.parentElement = el; return child; },
    removeChild(child) {
      const i = kids.indexOf(child);
      if (i >= 0) kids.splice(i, 1);
      return child;
    },
    replaceChild(next, old) {
      const i = kids.indexOf(old);
      if (i >= 0) kids[i] = next;
      next.parentElement = el;
      return old;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  // Assigning innerHTML replaces an element's children in a real DOM. The
  // stub does not parse the markup, but it must still clear them, or a
  // render that starts with `container.innerHTML = ''` would silently
  // accumulate rows across calls and every assertion would read a stale one.
  let html = '';
  Object.defineProperty(el, 'innerHTML', {
    get: () => html,
    set(value) { html = String(value); kids.length = 0; },
  });
  Object.defineProperty(el, 'children', { get: () => kids });
  Object.defineProperty(el, 'lastElementChild', { get: () => kids[kids.length - 1] || null });
  Object.defineProperty(el, 'firstElementChild', { get: () => kids[0] || null });
  return el;
}

/**
 * Installs the stub DOM and browser globals app.js reads, including a
 * harmless default fetch for the requests it makes while loading. Must run
 * before loadApp().
 */
function installDom() {
  const byId = new Map();
  global.document = {
    getElementById: (id) => {
      if (!byId.has(id)) byId.set(id, makeElement());
      return byId.get(id);
    },
    createElement: (tag) => makeElement(tag),
    querySelector: () => makeElement(),
    querySelectorAll: () => [],
    addEventListener() {},
    body: makeElement(),
    documentElement: makeElement(),
    readyState: 'complete',
  };
  global.window = {
    addEventListener() {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
    scrollTo() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    location: { href: 'http://localhost/' },
  };
  global.requestAnimationFrame = () => 0;
  global.cancelAnimationFrame = () => {};
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  global.alert = () => {};
  global.AbortController = class { constructor() { this.signal = { aborted: false, addEventListener() {} }; } abort() {} };
  global.DOMException = class extends Error {};
}

/**
 * Executes app.js's whole top level - so a load-time crash throws here -
 * and returns the named top-level bindings from inside its scope.
 *
 * @param {string[]} names Top-level names declared in app.js.
 * @returns {Record<string, any>}
 */
function loadApp(names) {
  return new Function(`${APP_SRC}\n;return { ${names.join(', ')} };`)();
}

module.exports = { makeElement, installDom, loadApp, APP_SRC };
