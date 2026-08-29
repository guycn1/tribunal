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
  // The truncation-retry fallback model (see getTruncationFallbackModel in
  // models.ts) - only ever billed on the minority of calls that truncate
  // once on the default model.
  // Source: https://openrouter.ai/mistralai/mistral-large-2512
  'mistralai/mistral-large-2512': { prompt: 0.5, completion: 1.5 },
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
