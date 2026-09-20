// Per-token pricing, quoted here in USD per one million tokens (OpenRouter's
// own quoting unit) and converted down to a per-call cost in calculateCost.
//
// A model id ending in ":free" always costs $0, regardless of this table.
// Add an entry here if a paid model is ever configured via DEFAULT_MODEL or
// a MODEL_<ROLE> override; an unlisted paid model logs a cost of 0 rather
// than throwing, since an unknown price should never block a real call from
// being logged.
// Source: https://openrouter.ai/mistralai/mistral-small-24b-instruct-2501
// (checked directly against the listed price, not assumed) - re-verify if
// this model's pricing page ever shows a different number, since OpenRouter
// can reprice a model without notice.
const PRICING_PER_MILLION_TOKENS: Record<string, { prompt: number; completion: number }> = {
  'mistralai/mistral-small-24b-instruct-2501': { prompt: 0.05, completion: 0.08 },
  // No longer used (see getTruncationFallbackModel in models.ts) -
  // mistralai/mistral-large-2512 was deprecated/removed from OpenRouter's
  // catalog (confirmed 2026-09-20, its model page now 404s). Entry kept,
  // not deleted, since real historical api_call_logs rows already
  // reference this model id and this table's only consumer
  // (calculateCost) is never called retroactively against stored rows.
  // Source (as it was): https://openrouter.ai/mistralai/mistral-large-2512
  'mistralai/mistral-large-2512': { prompt: 0.5, completion: 1.5 },
  // The truncation-retry fallback model (see getTruncationFallbackModel in
  // models.ts) - only ever billed on the minority of calls that truncate
  // on the default model after using both of its own attempts.
  // Source: https://openrouter.ai/api/v1/models/anthropic/claude-haiku-4.5/endpoints
  // (checked directly against the live per-token price, not assumed -
  // consistent across all 8 routed providers/regions at the time of
  // checking).
  'anthropic/claude-haiku-4.5': { prompt: 1.0, completion: 5.0 },
  // Third and fourth escalation tiers (see getTopTierFallbackModel /
  // getLastResortFallbackModel in models.ts) - reached only after every
  // earlier tier has already truncated, so real usage stays rare despite
  // the materially higher per-token price.
  // Source: https://openrouter.ai/openai
  'openai/gpt-5.6-sol': { prompt: 2, completion: 10 },
  // Source: https://openrouter.ai/google
  'google/gemini-2.5-pro': { prompt: 1.25, completion: 10 },
};

export function calculateCost(model: string, promptTokens: number, completionTokens: number): number {
  if (model.endsWith(':free')) {
    return 0;
  }

  const pricing = PRICING_PER_MILLION_TOKENS[model];
  if (!pricing) {
    return 0;
  }

  const promptCost = (promptTokens / 1_000_000) * pricing.prompt;
  const completionCost = (completionTokens / 1_000_000) * pricing.completion;
  return Number((promptCost + completionCost).toFixed(6));
}
