// Per-agent-role model assignment. Kept in one place and NOT hardcoded
// into orchestration logic, per TRIBUNAL_SPEC.md Part 2 criterion 5:
// "the progression from one model toward several must be visible."
//
// PHASE A (current default): every role uses the same single model.
// PHASE B: give each advocate role its own MODEL_ADVOCATE_FOR_1 etc.
// env var to override — see .env.example. This lets you demonstrate
// the 1-model -> several-models progression without changing code,
// only environment configuration, which is exactly what the spec asks
// to be visible in commit history over time.

const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'meta-llama/llama-3.1-8b-instruct:free';

const MODELS = {
  advocate_for_1: process.env.MODEL_ADVOCATE_FOR_1 || DEFAULT_MODEL,
  advocate_for_2: process.env.MODEL_ADVOCATE_FOR_2 || DEFAULT_MODEL,
  advocate_against_1: process.env.MODEL_ADVOCATE_AGAINST_1 || DEFAULT_MODEL,
  advocate_against_2: process.env.MODEL_ADVOCATE_AGAINST_2 || DEFAULT_MODEL,
  judge_1: process.env.MODEL_JUDGE_1 || DEFAULT_MODEL,
  judge_2: process.env.MODEL_JUDGE_2 || DEFAULT_MODEL,
  judge_3: process.env.MODEL_JUDGE_3 || DEFAULT_MODEL,
};

module.exports = { MODELS, DEFAULT_MODEL };
