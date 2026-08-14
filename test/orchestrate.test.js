// Unit tests for the pure, deterministic pieces of the trial pipeline:
// charge sheet validation and judge-output parsing. No OpenRouter calls
// happen here — these target the exact failure modes this project has
// actually hit (off-spec verdict values, malformed model output).
//
// Note: requiring orchestrate.js also loads db.js as a side effect
// (it opens/creates the local SQLite file and ensures tables exist).
// That's a harmless, idempotent operation, not something these tests
// rely on — flagged here so it isn't a surprise.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateChargeSheet, parseJudgeOutput } = require('../server/lib/orchestrate');

test('validateChargeSheet', async (t) => {
  await t.test('accepts a complete charge sheet', () => {
    const errors = validateChargeSheet({
      defendant: 'Jaime Lannister',
      act: 'Slew King Aerys II from behind',
      question: 'Is the defendant guilty of regicide?',
    });
    assert.deepEqual(errors, []);
  });

  await t.test('rejects a missing defendant', () => {
    const errors = validateChargeSheet({ defendant: '', act: 'Act', question: 'Question?' });
    assert.ok(errors.includes('Defendant is required.'));
  });

  await t.test('rejects a missing act', () => {
    const errors = validateChargeSheet({ defendant: 'Defendant', act: '', question: 'Question?' });
    assert.ok(errors.includes('Act is required.'));
  });

  await t.test('rejects a missing question', () => {
    const errors = validateChargeSheet({ defendant: 'Defendant', act: 'Act', question: '' });
    assert.ok(errors.includes('Question is required.'));
  });

  await t.test('rejects whitespace-only fields, not just empty ones', () => {
    const errors = validateChargeSheet({ defendant: '   ', act: 'Act', question: 'Question?' });
    assert.ok(errors.includes('Defendant is required.'));
  });

  await t.test('reports all three errors when everything is missing', () => {
    const errors = validateChargeSheet({ defendant: '', act: '', question: '' });
    assert.equal(errors.length, 3);
  });
});

test('parseJudgeOutput', async (t) => {
  await t.test('parses clean valid JSON', () => {
    const result = parseJudgeOutput('{"verdict": "justified", "reasoning": "Because reasons."}');
    assert.equal(result.parsed, true);
    assert.equal(result.verdict, 'justified');
    assert.equal(result.reasoning, 'Because reasons.');
  });

  await t.test('parses JSON wrapped in a markdown code fence', () => {
    const raw = '```json\n{"verdict": "not justified", "reasoning": "Because other reasons."}\n```';
    const result = parseJudgeOutput(raw);
    assert.equal(result.parsed, true);
    assert.equal(result.verdict, 'not justified');
  });

  await t.test('normalizes verdict casing and surrounding whitespace', () => {
    const result = parseJudgeOutput('{"verdict": "  Justified  ", "reasoning": "Reasons."}');
    assert.equal(result.parsed, true);
    assert.equal(result.verdict, 'justified');
  });

  await t.test('falls back to unparsed on malformed JSON, preserving the raw text', () => {
    const raw = '{verdict: justified, reasoning: "no quotes on keys"';
    const result = parseJudgeOutput(raw);
    assert.equal(result.parsed, false);
    assert.equal(result.raw, raw);
  });

  await t.test('falls back to unparsed on prose instead of JSON', () => {
    const raw = 'I believe the defendant was justified in their actions.';
    const result = parseJudgeOutput(raw);
    assert.equal(result.parsed, false);
    assert.equal(result.raw, raw);
  });

  await t.test('rejects an off-spec verdict value instead of guessing', () => {
    // This is the exact class of bug this project fixed earlier: a naive
    // === 'guilty' check would have silently treated an unexpected value
    // like "innocent" as a confident ruling the model never actually gave.
    const result = parseJudgeOutput('{"verdict": "innocent", "reasoning": "Reasons."}');
    assert.equal(result.parsed, false);
  });

  await t.test('rejects a valid verdict value with no reasoning field', () => {
    const result = parseJudgeOutput('{"verdict": "justified"}');
    assert.equal(result.parsed, false);
  });
});
