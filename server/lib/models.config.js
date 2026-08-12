// Per-agent-role model assignment. Kept in one place and not hardcoded
// into orchestration logic, so the model used per role stays
// configurable.
//
// PHASE A (current default): every role uses the same single model.
// PHASE B: give each advocate role its own MODEL_ADVOCATE_FOR_1 etc.
// env var to override — see .env.example. This lets the progression
// from one shared model to several happen through configuration
// alone, with no code changes.

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
