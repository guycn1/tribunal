/**
 * @file HARD RULE 5's offline half: no Markdown file in the repository holds
 * source that GitHub is known to render wrongly.
 *
 * Run with `npm test`. No network. Every rule below was established by
 * rendering the defect through GitHub's own Markdown API and watching it
 * break, not by assumption; the comment on each says what GitHub does with it.
 * Each rule is checked separately on every tracked Markdown file, CLAUDE.md
 * included, so a failure names both.
 *
 * This half only knows the defects someone has already found. The other half,
 * `npm run check-render` (scripts/check-render.js), renders each file through
 * GitHub itself and compares the page with the source, which is what catches
 * a defect nobody has thought of yet. It needs the network, so it is not part
 * of `npm test`.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

let failures = 0;
/**
 * Records and prints one assertion. A failure is counted rather than thrown,
 * so every check in the file runs and reports.
 *
 * @param {string} name
 * @param {unknown} condition Truthy to pass.
 * @param {unknown} [detail] Printed after a failure, to show what was found.
 */
function check(name, condition, detail) {
  if (condition) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}${detail !== undefined ? ` :: ${detail}` : ''}`);
  }
}

/**
 * Every Markdown file that is or would be committed: tracked, plus new and
 * not ignored.
 * @returns {string[]}
 */
function markdownFiles() {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
    .trim().split('\n').filter((f) => /\.md$/i.test(f) && fs.existsSync(path.join(ROOT, f)));
}

/** The tags written on purpose in prose, which GitHub keeps: README's endpoint list and badge tables. */
const KEPT_TAGS = new Set(['code', 'b']);

/**
 * Blanks every code span in a paragraph, delimiters included, keeping its
 * length and newlines, so what is left is the paragraph's prose. A span is
 * closed by the next run of exactly as many backticks as opened it.
 * @param {string} s
 * @returns {{ prose: string, spans: string[], unclosed: number[] }} The prose,
 *   the spans' contents, and the length of every opening run left unclosed.
 */
function splitCodeSpans(s) {
  const runs = [...s.matchAll(/`+/g)].map((m) => [m.index, m[0].length]);
  const out = s.split('');
  const spans = [];
  const unclosed = [];
  let i = 0;
  while (i < runs.length) {
    let j = i + 1;
    while (j < runs.length && runs[j][1] !== runs[i][1]) j++;
    if (j >= runs.length) { unclosed.push(runs[i][1]); i++; continue; }
    spans.push(s.slice(runs[i][0] + runs[i][1], runs[j][0]));
    for (let k = runs[i][0]; k < runs[j][0] + runs[j][1]; k++) if (out[k] !== '\n') out[k] = ' ';
    i = j + 1;
  }
  return { prose: out.join(''), spans, unclosed };
}

/**
 * A file's lines with fenced code blocks blanked, so no rule reads code as
 * prose, and with HTML comments blanked, keeping every line in place.
 * @param {string} text
 * @returns {string[]}
 */
function proseLines(text) {
  const lines = text.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' ')).split('\n');
  let fence = false;
  return lines.map((line) => {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return ''; }
    return fence ? '' : line;
  });
}

/**
 * The file cut into paragraphs - runs of non-blank lines - each with the
 * number of its first line.
 * @param {string[]} lines
 * @returns {{ text: string, line: number }[]}
 */
function paragraphs(lines) {
  const out = [];
  let current = null;
  lines.forEach((line, i) => {
    if (!line.trim()) { current = null; return; }
    if (!current) { current = { text: line, line: i + 1 }; out.push(current); } else current.text += `\n${line}`;
  });
  return out;
}

const BLOCK_START = /^(?:[-*+]\s|1[.)]\s|#{1,6}\s|>)/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;
const TABLE_ROW = /^\s*\|/;
const SEPARATOR_ROW = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const THEMATIC_BREAK = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;

/**
 * Splits a table row into its cells as GitHub does: on every pipe not
 * escaped with a backslash, code spans included.
 * @param {string} row
 * @returns {string[]}
 */
const cellsOf = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/);

for (const file of markdownFiles()) {
  console.log(`\n=== ${file} ===`);
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
  const lines = proseLines(text);
  const paras = paragraphs(lines);
  const found = {
    tags: [], unclosed: [], escapes: [], setext: [], interrupts: [], ruleBeforeHeading: [], tableSeparator: [],
    tableCells: [], pipeInCode: [], bold: [], intraword: [], links: [], trailing: [], indented: [], wiki: [], imageSrc: [],
  };
  const at = (n, what) => `line ${n}: ${String(what).replace(/\s+/g, ' ').slice(0, 70)}`;

  for (const { text: para, line } of paras) {
    const { prose, spans, unclosed } = splitCodeSpans(para);
    const lineOf = (index) => line + (prose.slice(0, index).match(/\n/g) || []).length;
    // An HTML tag GitHub does not keep is dropped, content and all when it is
    // empty: "until <date>, then" renders as "until , then", and <foo>x</foo>
    // as "x". Only the tags written on purpose may appear outside a code span;
    // a literal angle bracket is written &lt; / &gt;. A backslash-escaped <
    // and an autolink such as <https://...> are not tag-shaped.
    for (const m of prose.matchAll(/(?<!\\)<\/?([A-Za-z][A-Za-z0-9-]*)(?:\s[^<>]*)?\/?>/g)) {
      if (!KEPT_TAGS.has(m[1].toLowerCase()) || /\s/.test(m[0])) found.tags.push(at(lineOf(m.index), m[0]));
    }
    // A backtick run with no closing run of the same length in its paragraph
    // pairs with nothing, or with the wrong one: "a ` b `c` d" renders "b " as
    // code and prints the last backtick.
    if (unclosed.length) found.unclosed.push(at(line, `opening run of ${unclosed[0]} backtick(s) never closed`));
    // Inside a code span nothing is parsed, so an escape is printed: `a\_b`
    // renders with its backslash.
    for (const span of spans) {
      if (/\\[!-/:-@[-`{-~]/.test(span)) found.escapes.push(at(line, `\`${span}\``));
    }
    // An unmatched ** is printed as two asterisks.
    if (((prose.match(/\*\*/g) || []).length) % 2) found.bold.push(at(line, 'odd number of **'));
    // An asterisk between two letters or digits pairs with the next one as
    // emphasis: "2*3*4" renders as 2<em>3</em>4.
    for (const m of prose.matchAll(/[\p{L}\p{N}]\*+[\p{L}\p{N}]/gu)) found.intraword.push(at(lineOf(m.index), m[0]));
    // A link whose destination holds a space, or never closes, is not a link:
    // "[link](has space)" prints as typed.
    for (const m of prose.matchAll(/\]\(([^)\n]*)(\)|\n|$)/g)) {
      if (/\s/.test(m[1].trim()) || m[2] !== ')') found.links.push(at(lineOf(m.index), m[0]));
    }
    // A wiki-style link prints its brackets: "[[note]]" stays "[[note]]".
    for (const m of prose.matchAll(/\[\[[^\]]*\]\]/g)) found.wiki.push(at(lineOf(m.index), m[0]));
    // An image whose address GitHub does not allow loses it: "![alt](data:...)"
    // and "![alt](javascript:...)" render as an <img> with no src, a broken
    // image (rendered through GitHub's API on 2026-10-06).
    for (const m of prose.matchAll(/!\[[^\]]*\]\(\s*(?:javascript|data):[^)]*\)/gi)) found.imageSrc.push(at(lineOf(m.index), m[0]));
  }

  let pipeRun = [];
  let pipeStart = 0;
  /** Checks the run of table rows gathered so far, then starts a new one. */
  const endTable = () => {
    if (pipeRun.length >= 2) {
      // Without its |---| row the whole block is one paragraph of pipes.
      if (!SEPARATOR_ROW.test(pipeRun[1])) found.tableSeparator.push(at(pipeStart, pipeRun[0]));
      else {
        // GitHub splits a cell on every unescaped pipe, inside a code span
        // too, and silently drops a cell past the header's count.
        const width = cellsOf(pipeRun[0]).length;
        pipeRun.forEach((row, k) => {
          if (k !== 1 && cellsOf(row).length !== width) found.tableCells.push(at(pipeStart + k, `${cellsOf(row).length} cells, header has ${width}`));
          for (const span of splitCodeSpans(row).spans) if (/(?<!\\)\|/.test(span)) found.pipeInCode.push(at(pipeStart + k, `\`${span}\``));
        });
      }
    }
    pipeRun = [];
  };
  lines.forEach((lineText, i) => {
    const n = i + 1;
    const prev = i > 0 ? lines[i - 1] : '';
    if (TABLE_ROW.test(lineText)) { if (!pipeRun.length) pipeStart = n; pipeRun.push(lineText); } else endTable();
    if (!lineText.trim()) return;
    const prevIsParagraph = prev.trim() && !TABLE_ROW.test(prev) && !/^#{1,6}\s/.test(prev) && !THEMATIC_BREAK.test(prev);
    // A line of only - or = under text makes that text a heading.
    if (/^\s*(-+|=+)\s*$/.test(lineText) && prevIsParagraph) found.setext.push(at(n, `"${prev.trim().slice(0, 40)}" becomes a heading`));
    // A list item, a "1." item, a heading or a quote can start in the middle
    // of a paragraph: a line wrapped so it begins with "- ", "+ ", "1. ", "# "
    // or ">" starts that block. A list here always follows a blank line, so
    // one directly under an unindented paragraph line is a wrapped line.
    if (BLOCK_START.test(lineText) && prevIsParagraph && !/^\s/.test(prev) && !LIST_ITEM.test(prev) && !/^>/.test(prev)) {
      found.interrupts.push(at(n, lineText));
    }
    // A thematic break right before a heading draws a second rule: GitHub
    // already rules every h1 and h2.
    if (THEMATIC_BREAK.test(lineText) && !prevIsParagraph) {
      const next = lines.slice(i + 1).find((l) => l.trim());
      if (next && /^#{1,6}\s/.test(next)) found.ruleBeforeHeading.push(at(n, lineText));
    }
    // Two trailing spaces are an invisible hard line break.
    if (/ {2,}$/.test(lineText)) found.trailing.push(at(n, lineText));
    // A line indented four spaces after a blank line, outside a list, is a
    // code block, not a paragraph.
    if (/^ {4,}\S/.test(lineText) && !prev.trim()) {
      const before = lines.slice(0, i).reverse().find((l) => l.trim());
      if (before !== undefined && !/^\s/.test(before) && !LIST_ITEM.test(before)) found.indented.push(at(n, lineText));
    }
  });
  endTable();

  check(`${file}: no HTML tag GitHub would drop (anything but <code> and <b>) outside a code span`, !found.tags.length, found.tags.join(' | '));
  check(`${file}: every code span is closed in its paragraph`, !found.unclosed.length, found.unclosed.join(' | '));
  check(`${file}: no backslash escape inside a code span, where it is printed`, !found.escapes.length, found.escapes.join(' | '));
  check(`${file}: no line of - or = directly under text, which turns it into a heading`, !found.setext.length, found.setext.join(' | '));
  check(`${file}: no list item, heading or quote starts in the middle of a paragraph`, !found.interrupts.length, found.interrupts.join(' | '));
  check(`${file}: no thematic break right before a heading`, !found.ruleBeforeHeading.length, found.ruleBeforeHeading.join(' | '));
  check(`${file}: every table has its |---| row`, !found.tableSeparator.length, found.tableSeparator.join(' | '));
  check(`${file}: every table row has as many cells as its header`, !found.tableCells.length, found.tableCells.join(' | '));
  check(`${file}: no pipe inside a code span in a table, which GitHub splits the cell on`, !found.pipeInCode.length, found.pipeInCode.join(' | '));
  check(`${file}: every ** is matched in its paragraph`, !found.bold.length, found.bold.join(' | '));
  check(`${file}: no asterisk between two letters or digits, which pairs up as emphasis`, !found.intraword.length, found.intraword.join(' | '));
  check(`${file}: every link destination is closed and holds no whitespace`, !found.links.length, found.links.join(' | '));
  check(`${file}: no line ends in two spaces, an invisible line break`, !found.trailing.length, found.trailing.join(' | '));
  check(`${file}: no paragraph indented four spaces outside a list, which becomes a code block`, !found.indented.length, found.indented.join(' | '));
  check(`${file}: no [[wiki-style]] link, which GitHub prints with its brackets`, !found.wiki.length, found.wiki.join(' | '));
  check(`${file}: no image at a data: or javascript: address, which GitHub strips`, !found.imageSrc.length, found.imageSrc.join(' | '));
}

// The render check sends a file too large for GitHub's API in pieces, each
// cut just before a level-2 or level-3 heading outside a code block. Cut
// small here, so every file is cut wherever it can be: the pieces must join
// back into the file, and each piece after the first must start with such a
// heading, or a piece would render differently from the same text inside the
// whole file.
const { pieces } = require('../scripts/check-render');
console.log("\n=== The render check's pieces of a large file ===");
// A heading-shaped line inside a code block is code, not a place to cut.
const fencedSample = ['# Title', 'intro', '', '```text', '## not a heading', '```', 'after', '', '## Real', 'body'].join('\n');
check('a "## " line inside a code block is not cut before', JSON.stringify(pieces(fencedSample, 1)) === JSON.stringify(['# Title\nintro\n\n```text\n## not a heading\n```\nafter\n', '## Real\nbody']), JSON.stringify(pieces(fencedSample, 1)));
for (const file of markdownFiles()) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
  const cut = pieces(text, 2000);
  let fence = false;
  const headingsOutsideCode = new Set();
  text.split('\n').forEach((line) => {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    else if (!fence && /^#{2,3} /.test(line)) headingsOutsideCode.add(line);
  });
  check(`${file}: cut into pieces, it joins back into the file`, cut.length > 1 && cut.join('\n') === text, `${cut.length} piece(s)`);
  const badStarts = cut.slice(1).map((p) => p.split('\n')[0]).filter((first) => !headingsOutsideCode.has(first));
  check(`${file}: every piece after the first starts at a heading outside a code block`, badStarts.length === 0, badStarts.join(' | '));
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
