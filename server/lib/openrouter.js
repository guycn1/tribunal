// Thin client for the OpenRouter API. Kept isolated in one file so the
// rest of the app never talks to fetch() or the API key directly.

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

async function callModel({ model, systemPrompt, userMessage }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set. Copy .env.example to .env and add your key.');
  }

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    let detail = bodyText || response.statusText;
    // OpenRouter's error body is JSON with a human-readable message, plus
    // sometimes a provider-specific "raw" string underneath it (e.g. a
    // rate-limit notice). Extract just those instead of dumping the whole
    // JSON blob into a message a user might end up reading.
    try {
      const parsed = JSON.parse(bodyText);
      const message = parsed?.error?.message;
      const raw = parsed?.error?.metadata?.raw;
      if (message) detail = raw && raw !== message ? `${message} — ${raw}` : message;
    } catch {
      // Body wasn't JSON — keep the raw text/statusText fallback above.
    }
    throw new Error(`Model provider returned an error (HTTP ${response.status}): ${detail}`);
  }

  const data = await response.json();

  const text = data?.choices?.[0]?.message?.content ?? '';
  const usage = data?.usage || {};

  return {
    text,
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens ?? (usage.prompt_tokens || 0) + (usage.completion_tokens || 0),
  };
}

module.exports = { callModel };
