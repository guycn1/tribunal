// Unit tests for cost computation. The one bug this project actually
// hit here would have made an untracked model silently cost $0 — these
// tests exist specifically to keep that from regressing.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeCost } = require('../server/lib/pricing');

test('computeCost', async (t) => {
  await t.test('returns exactly 0 for a known free model', () => {
    const cost = computeCost('nvidia/nemotron-3-nano-30b-a3b:free', 1000, 1000);
    assert.equal(cost, 0);
  });

  await t.test('computes the correct cost for a known paid model', () => {
    const cost = computeCost('meta-llama/llama-3.1-8b-instruct', 1000, 1000);
    // 1000 * 0.00000005 (input) + 1000 * 0.00000008 (output) = 0.00013
    assert.equal(cost, 0.00013);
  });

  await t.test('falls back to the non-zero default rate for an unknown model', () => {
    // An untracked model must never compute as $0 by accident.
    const cost = computeCost('some-brand-new-model-not-in-the-table', 1000, 1000);
    assert.ok(cost > 0);
  });

  await t.test('scales linearly with token counts', () => {
    const single = computeCost('meta-llama/llama-3.1-8b-instruct', 100, 100);
    const doubled = computeCost('meta-llama/llama-3.1-8b-instruct', 200, 200);
    assert.equal(doubled, Math.round(single * 2 * 1e8) / 1e8);
  });
});
