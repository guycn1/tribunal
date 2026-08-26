// Per-token pricing, quoted here in USD per one million tokens (OpenRouter's
// own quoting unit) and converted down to a per-call cost in calculateCost.
//
// A model id ending in ":free" always costs $0, regardless of this table.
// Add an entry here if a paid model is ever configured via DEFAULT_MODEL or
// a MODEL_<ROLE> override; an unlisted paid model logs a cost of 0 rather
// than throwing, since an unknown price should never block a real call from
// being logged.
const PRICING_PER_MILLION_TOKENS: Record<string, { prompt: number; completion: number }> = {};

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
