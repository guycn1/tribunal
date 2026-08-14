// Approximate per-token pricing for a handful of OpenRouter models,
// used to compute the per-call cost logged for each trial.
//
// IMPORTANT: these numbers are illustrative and WILL drift out of date.
// OpenRouter publishes live pricing at https://openrouter.ai/models —
// verify against that before treating any number here as accurate for
// a real cost report. Prices are USD per token (not per million).

const PRICING = {
  // Free-tier models (":free" suffix models on OpenRouter are $0)
  // NOTE: 'meta-llama/llama-3.1-8b-instruct:free' and
  // 'google/gemma-2-9b-it:free' were retired from the free tier as of
  // Aug 2026 (OpenRouter now 404s them, pointing at the paid slug
  // instead) — left here only as a historical note, do not rely on them.
  'meta-llama/llama-3.1-8b-instruct:free': { input: 0, output: 0 },
  'google/gemma-2-9b-it:free': { input: 0, output: 0 },
  'mistralai/mistral-7b-instruct:free': { input: 0, output: 0 },
  // Verified live against OpenRouter's /api/v1/models on Aug 12, 2026:
  'google/gemma-4-31b-it:free': { input: 0, output: 0 },
  'google/gemma-4-26b-a4b-it:free': { input: 0, output: 0 },
  'openai/gpt-oss-20b:free': { input: 0, output: 0 },
  // google/gemma-4-31b-it:free hit persistent 429s from its upstream
  // (Google AI Studio's shared free pool) on Aug 12, 2026 — switched
  // to an NVIDIA-served free model to use a different upstream pool.
  'nvidia/nemotron-3-nano-30b-a3b:free': { input: 0, output: 0 },

  // Cheap paid models (illustrative rates — verify before relying on these)
  'meta-llama/llama-3.1-8b-instruct': { input: 0.00000005, output: 0.00000008 },
  'google/gemini-flash-1.5': { input: 0.000000075, output: 0.0000003 },

  // Fallback used if a model isn't in this table — set to a conservative
  // non-zero rate so cost never silently reports as free when it isn't.
  __default: { input: 0.0000005, output: 0.0000015 },
};

function computeCost(model, promptTokens, completionTokens) {
  const rates = PRICING[model] || PRICING.__default;
  const cost = promptTokens * rates.input + completionTokens * rates.output;
  return Math.round(cost * 1e8) / 1e8; // round to 8 decimal places
}

module.exports = { computeCost, PRICING };
