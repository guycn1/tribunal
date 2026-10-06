#!/usr/bin/env node
/**
 * @file HARD RULE 5's render half: renders each Markdown file through
 * GitHub's own Markdown API and compares the page with the source.
 *
 *   npm run check-render              every tracked Markdown file
 *   npm run check-render -- FILE...   just these
 *
 * The offline half (tests/markdown.test.js, in `npm test`) only knows the
 * defects someone has already found. This one asks GitHub, so it also
 * catches one nobody has thought of yet - such as the `<date>` that HARD
 * RULE 3 printed for nine days as "until ," because GitHub drops a tag it does
 * not know. For each file it asserts:
 *
 * - every word of the source reaches the page;
 * - no Markdown syntax is printed as text (**, __, a backtick, "](", "][", "[[",
 *   an HTML comment, a table left as a paragraph of pipes);
 * - the page has as many headings, tables, table cells, rules, code blocks,
 *   list items, quotes, line breaks, links, images and bold spans as the
 *   source asks for.
 *
 * It needs the network, so it is not part of `npm test`: run it before every
 * commit that touches a Markdown file, and before every merge to main. It
 * uses GitHub's unauthenticated API (60 requests an hour), one request per
 * file, or per piece of one over PIECE_LIMIT characters (see pieces()
 * below), and spends no quota of this project's. Exits 1 on a defect, and 2
 * when GitHub could not be reached, so an unreachable API never passes.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
// The tags written on purpose, which GitHub keeps and which hold no words of
// their own: <code> and <b> in README's endpoint list and badge tables, the
// div that centres its live link, and the <br> below it.
const KEPT_TAGS = /<\/?(code|b)>|<div align="center">|<\/div>|<br>/g;
const THEMATIC_BREAK = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const SEPARATOR_ROW = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+\S/;

/**
 * Decodes the HTML entities GitHub's output and this repository's source use.
 * @param {string} s
 * @returns {string}
 */
const decode = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

/**
 * The words of a text: runs of letters and digits.
 * @param {string} s
 * @returns {string[]}
 */
const words = (s) => s.match(/[\p{L}\p{N}]+/gu) || [];

/**
 * Splits a paragraph into prose and code spans (CommonMark: a span closes at
 * the next run of exactly as many backticks).
 * @param {string} s
 * @returns {{ prose: string, spans: string[] }} Spans blanked out of the prose.
 */
function splitCodeSpans(s) {
  const runs = [...s.matchAll(/`+/g)].map((m) => [m.index, m[0].length]);
  let prose = '';
  const spans = [];
  let at = 0;
  let i = 0;
  while (i < runs.length) {
    let j = i + 1;
    while (j < runs.length && runs[j][1] !== runs[i][1]) j++;
    if (j >= runs.length) { i++; continue; }
    prose += `${s.slice(at, runs[i][0])} `;
    spans.push(s.slice(runs[i][0] + runs[i][1], runs[j][0]));
    at = runs[j][0] + runs[j][1];
    i = j + 1;
  }
  return { prose: prose + s.slice(at), spans };
}

/**
 * What the source asks GitHub to show: its words, and how many of each
 * structure it should produce.
 * @param {string} source
 */
function expectFromSource(source) {
  const lines = source.replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' ')).split('\n');
  const expected = { words: [], heading: 0, table: 0, cell: 0, hr: 0, pre: 0, li: 0, blockquote: 0, br: 0, link: 0, image: 0, strong: 0 };
  let fence = false;
  const proseLines = [];
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      if (!fence) expected.pre++;
      fence = !fence;
      proseLines.push('');
      return;
    }
    if (fence) { expected.words.push(...words(line)); proseLines.push(''); return; }
    proseLines.push(line);
    const prev = i > 0 ? lines[i - 1] : '';
    const next = i + 1 < lines.length ? lines[i + 1] : '';
    if (/^#{1,6}\s/.test(line)) expected.heading++;
    if (/^\s*\|/.test(line) && SEPARATOR_ROW.test(next) && /\|/.test(next)) expected.table++;
    if (THEMATIC_BREAK.test(line) && !prev.trim()) expected.hr++;
    if (LIST_ITEM.test(line)) expected.li++;
    if (/^>/.test(line) && !/^>/.test(prev)) expected.blockquote++;
    if (line.trim() && next.trim() && (/\\$/.test(line) || / {2,}$/.test(line))) expected.br++;
  });
  // Table cells: every row's own cells, as written.
  let inTable = false;
  proseLines.forEach((line, i) => {
    const next = proseLines[i + 1] || '';
    if (!inTable && /^\s*\|/.test(line) && SEPARATOR_ROW.test(next)) inTable = true;
    if (inTable && !/^\s*\|/.test(line)) inTable = false;
    if (inTable && !SEPARATOR_ROW.test(line)) expected.cell += line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).length;
  });
  // Paragraph by paragraph, so a code span may run across a line break.
  const paras = proseLines.join('\n').split(/\n\s*\n/);
  for (const para of paras) {
    const cleaned = para.split('\n').map((l) => l.replace(/^\s*(?:\d+[.)]|[-*+])\s+/, '').replace(/^>\s?/, '').replace(/^#{1,6}\s+/, '')).join('\n');
    const { prose, spans } = splitCodeSpans(cleaned);
    for (const span of spans) expected.words.push(...words(span));
    // Only [text](destination) counts as a link here, so a link the page has
    // and this count does not - an angle-bracket destination, a reference
    // link - is reported too: this repository writes every link as
    // [text](destination).
    // An image, ![alt](destination), is counted as an image rather than a
    // link: GitHub wraps it in a link to the file, but one that starts with
    // other attributes, which the page's link count below does not read.
    const images = (prose.match(/!\[[^\]]*\]\([^)\s]*\)/g) || []).length;
    expected.image += images;
    expected.link += (prose.match(/\]\([^)\s]*\)/g) || []).length - images;
    // A bare URL is a link too - GitHub autolinks it, in parentheses or not.
    expected.link += (prose.replace(/\]\([^)\s]*\)/g, ']').match(/\bhttps?:\/\/[^\s)<>]+/g) || []).length;
    expected.strong += Math.floor((prose.match(/\*\*/g) || []).length / 2);
    // A <br> written in the source is a line break on the page, alone on its
    // line or within one.
    expected.br += (prose.match(/<br>/g) || []).length;
    const visible = decode(prose.replace(/\]\([^)\s]*\)/g, ']').replace(/<(https?:\/\/[^>]+)>/g, '$1').replace(KEPT_TAGS, ' '));
    expected.words.push(...words(visible));
  }
  return expected;
}

/**
 * What GitHub actually shows: the page's words, the syntax printed as text,
 * and its structures.
 * @param {string} html
 */
function readRendered(html) {
  const count = (re) => (html.match(re) || []).length;
  const prose = decode(html.replace(/<pre[\s\S]*?<\/pre>/g, ' ').replace(/<code>[\s\S]*?<\/code>/g, ' ').replace(/<[^>]+>/g, ' '));
  const leaks = [];
  for (const [what, re] of [['**', /\*\*/g], ['__', /__/g], ['a backtick', /`/g], ['"]("', /\]\(/g], ['"]["', /\]\[/g], ['"[["', /\[\[/g], ['an HTML comment', /<!--/g]]) {
    for (const m of prose.matchAll(re)) leaks.push(`${what}: ...${prose.slice(Math.max(0, m.index - 40), m.index + 30).replace(/\s+/g, ' ')}...`);
  }
  // A table GitHub did not recognise is a paragraph that starts with a pipe.
  for (const m of html.matchAll(/<p>\s*\|([^<]{0,60})/g)) leaks.push(`a table printed as a paragraph of pipes: |${decode(m[1])}...`);
  // An image's alt text is on the page as its alt attribute, which a reader
  // of the page meets in place of the image (rendered through GitHub's API
  // on 2026-10-06: ![text](file) becomes <img src="file" alt="text">, every
  // word kept), so it counts among the page's words.
  const withAlt = html.replace(/<img\b[^>]*\balt="([^"]*)"[^>]*>/g, ' $1 ');
  return {
    words: words(decode(withAlt.replace(/<[^>]+>/g, ' '))),
    leaks,
    heading: count(/<h[1-6][ >]/g), table: count(/<table[ >]/g), cell: count(/<t[hd][ >]/g), hr: count(/<hr[ >/]/g),
    pre: count(/<pre[ >]/g), li: count(/<li[ >]/g), blockquote: count(/<blockquote[ >]/g), br: count(/<br[ >/]/g),
    link: count(/<a href="(?!#)[^"]*"(?![^>]*class="anchor")/g) + count(/<a href="#[^"]*"(?![^>]*class="anchor")/g),
    // Only an image that kept its address counts: GitHub strips one it does
    // not allow (a javascript: or data: URL, rendered through its API on
    // 2026-10-06) and leaves an <img> with no src, a broken image with all of
    // its alt text still there.
    image: count(/<img\b[^>]*\bsrc="[^"]+"/g),
    strong: count(/<strong[ >]/g),
  };
}

/**
 * Compares one file's source with GitHub's rendering of it.
 * @param {string} source
 * @param {string} html
 * @returns {string[]} The defects found; empty when the page matches.
 */
function compare(source, html) {
  const want = expectFromSource(source);
  const got = readRendered(html);
  const defects = [];
  const have = new Map();
  for (const w of got.words) have.set(w, (have.get(w) || 0) + 1);
  const lost = new Map();
  for (const w of want.words) {
    const n = have.get(w) || 0;
    if (n) have.set(w, n - 1); else lost.set(w, (lost.get(w) || 0) + 1);
  }
  if (lost.size) defects.push(`words of the source missing from the page: ${[...lost].map(([w, n]) => (n > 1 ? `${w} x${n}` : w)).join(', ')}`);
  for (const leak of got.leaks) defects.push(`Markdown printed as text, ${leak}`);
  for (const key of ['heading', 'table', 'cell', 'hr', 'pre', 'li', 'blockquote', 'br', 'link', 'image', 'strong']) {
    if (want[key] !== got[key]) defects.push(`${key}: the source asks for ${want[key]}, the page has ${got[key]}`);
  }
  return defects;
}

/**
 * Renders Markdown through GitHub's API, in the default mode, whose line
 * breaks match a file's page on github.com.
 * @param {string} text
 * @returns {Promise<string>}
 */
async function render(text) {
  const res = await fetch('https://api.github.com/markdown', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'tribunal-check-render' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.text();
}

/**
 * The most characters sent to GitHub in one request. Its Markdown API renders
 * at most 400 KB of text - a larger file was refused on 2026-10-06 with a 403,
 * "too_large" - and CLAUDE.md has grown past that.
 */
const PIECE_LIMIT = 200000;

/**
 * A file cut into pieces small enough to render, each ending just before a
 * level-2 or level-3 heading outside a code block, so the pieces joined are
 * the file. Nothing in this repository's Markdown carries across a heading -
 * every link is written inline, and a heading ends any paragraph, list, table
 * or quote - so each piece renders as it does inside the whole file, and is
 * compared with its own source. A file within the limit is one piece.
 * @param {string} source With LF line endings.
 * @param {number} [limit]
 * @returns {string[]}
 */
function pieces(source, limit = PIECE_LIMIT) {
  const sections = [];
  let current = [];
  let fence = false;
  for (const line of source.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (!fence && /^#{2,3} /.test(line) && current.length) { sections.push(current.join('\n')); current = []; }
    current.push(line);
  }
  sections.push(current.join('\n'));
  const out = [];
  for (const section of sections) {
    if (out.length && out[out.length - 1].length + 1 + section.length <= limit) out[out.length - 1] += `\n${section}`;
    else out.push(section);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const files = args.length ? args : execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
    .trim().split('\n').filter((f) => /\.md$/i.test(f));
  let defects = 0;
  for (const file of files) {
    // GitHub stores the file with LF line endings, whatever the working copy
    // has, so that is what it renders.
    const source = fs.readFileSync(path.resolve(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
    const parts = pieces(source);
    const found = [];
    for (const [i, part] of parts.entries()) {
      let html;
      try {
        html = await render(part);
      } catch (error) {
        console.error(`\ncheck-render: could not render ${file}${parts.length > 1 ? ` (part ${i + 1} of ${parts.length})` : ''}: ${error.message}`);
        // process.exitCode, not process.exit(): on Windows, exiting while a
        // fetch is still closing its handle aborts Node with code 127.
        process.exitCode = 2;
        return;
      }
      found.push(...compare(part, html).map((d) => (parts.length > 1 ? `part ${i + 1} of ${parts.length}: ${d}` : d)));
    }
    defects += found.length;
    console.log(found.length ? `\n${file}: ${found.length} defect(s)` : `${file}: renders as written`);
    for (const d of found) console.log(`  DEFECT  ${d}`);
  }
  if (defects) {
    console.log(`\ncheck-render: ${defects} defect(s). See HARD RULE 5 in CLAUDE.md.`);
    process.exitCode = 1;
    return;
  }
  console.log('\ncheck-render: every file renders as written.');
}

if (require.main === module) main();
module.exports = { compare, expectFromSource, readRendered, pieces, PIECE_LIMIT };
