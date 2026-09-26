// Per-token pricing, quoted here in USD per one million tokens (OpenRouter's
// own quoting unit) and converted down to a per-call cost in calculateCost.
//
// A model id ending in ":free" always costs $0, regardless of this table.
// Add an entry here for any paid model configured through DEFAULT_MODEL, a
// MODEL_<ROLE> override or one of the fallback-tier variables (see
// models.ts); an unlisted paid model logs a cost of 0 rather than throwing,
// since an unknown price should never block a real call from being logged.
// Each entry carries its own source below. All were checked directly
// against the listed price rather than assumed - re-verify any of them if
// a model's pricing page ever shows a different number, since OpenRouter
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
  // Tier 2 of the escalation chain (see getTruncationFallbackModel in
  // models.ts) - only ever billed on the minority of calls where the
  // default model failed to produce a usable result.
  // Source: https://openrouter.ai/api/v1/models/anthropic/claude-haiku-4.5/endpoints
  // (checked directly against the live per-token price, not assumed -
  // consistent across all 8 routed providers/regions at the time of
  // checking).
  'anthropic/claude-haiku-4.5': { prompt: 1.0, completion: 5.0 },
  // Third and fourth escalation tiers (see getTopTierFallbackModel /
  // getLastResortFallbackModel in models.ts) - reached only after every
  // earlier tier has already failed, so real usage stays rare despite the
  // materially higher per-token price.
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
