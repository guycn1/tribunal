import { getModelForRole } from './models';
import { calculateCost } from './pricing';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_RETRIES = 1;
// fetch() had no timeout at all, so a free-tier model that hangs (rather
// than erroring) blocked until Netlify's own platform-level timeout (30s,
// observed) killed the entire function invocation - bypassing the retry
// logic, failure logging, and DB write below entirely, and leaving no
// trace of the failure anywhere. This keeps each attempt well under that
// ceiling so the graceful-failure path always gets a chance to run.
const FETCH_TIMEOUT_MS = 8000;

export interface OpenRouterMessage {
  role: 'system' | 'user';
  content: string;
}

export interface OpenRouterResult {
  status: 'success' | 'failed';
  content?: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  errorMessage?: string;
}

export async function callOpenRouter(
  agentRole: string,
  messages: OpenRouterMessage[],
  maxTokens: number
): Promise<OpenRouterResult> {
  const model = getModelForRole(agentRole);
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return failure(model, 'OPENROUTER_API_KEY is not configured on the server.');
  }

  // TEMPORARY diagnostic: isolate whether outbound HTTPS from this function
  // works at all, or whether the failure is specific to openrouter.ai. Logs
  // to the Netlify function log only - does not affect the returned result.
  // Remove once the production timeout investigation is closed.
  try {
    const start = Date.now();
    const controlResponse = await fetch('https://api.github.com', {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    console.log(
      `[diagnostic] control fetch to api.github.com: HTTP ${controlResponse.status} in ${Date.now() - start}ms`
    );
  } catch (controlErr) {
    console.log(
      `[diagnostic] control fetch to api.github.com FAILED: ${describeError(controlErr)}`
    );
  }

  let lastError = 'Unknown error';

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          // Header values must be ASCII/Latin-1 — no em dashes or other
          // non-Latin-1 characters here, or fetch() fails before any
          // response (and without a useful stack trace) is produced.
          'X-Title': 'Tribunal',
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens,
          // Reasoning models otherwise spend hundreds to thousands of
          // hidden tokens per call before producing visible output —
          // invisible in the response, but the reason calls were taking
          // 60+ seconds by default.
          reasoning: { enabled: false },
        }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (response.status === 429 || response.status >= 500) {
        lastError = `OpenRouter returned HTTP ${response.status}`;
        if (attempt < MAX_RETRIES) {
          await backoff(attempt);
          continue;
        }
        return failure(model, lastError);
      }

      if (!response.ok) {
        const bodyText = await safeReadText(response);
        return failure(model, `OpenRouter returned HTTP ${response.status}: ${bodyText}`);
      }

      const data = (await response.json()) as any;
      const content: string | undefined = data?.choices?.[0]?.message?.content;
      const usage = data?.usage ?? {};

      if (!content) {
        return failure(model, 'OpenRouter response contained no message content.');
      }

      const promptTokens = usage.prompt_tokens ?? 0;
      const completionTokens = usage.completion_tokens ?? 0;
      const totalTokens = usage.total_tokens ?? promptTokens + completionTokens;

      return {
        status: 'success',
        content,
        model,
        promptTokens,
        completionTokens,
        totalTokens,
        cost: calculateCost(model, promptTokens, completionTokens),
      };
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'TimeoutError';
      lastError = isTimeout
        ? `OpenRouter did not respond within ${FETCH_TIMEOUT_MS}ms`
        : err instanceof Error
          ? err.message
          : String(err);
      // TEMPORARY diagnostic - see note above.
      console.log(`[diagnostic] openrouter fetch attempt ${attempt} failed: ${describeError(err)}`);
      if (attempt < MAX_RETRIES) {
        await backoff(attempt);
        continue;
      }
      return failure(model, lastError);
    }
  }

  return failure(model, lastError);
}

function failure(model: string, errorMessage: string): OpenRouterResult {
  return {
    status: 'failed',
    model,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cost: 0,
    errorMessage,
  };
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '(no response body)';
  }
}

function backoff(attempt: number): Promise<void> {
  const delayMs = 500 * Math.pow(2, attempt);
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

// TEMPORARY diagnostic helper - see note above.
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  const code = (err as { code?: unknown }).code;
  return `name=${err.name} message=${err.message} code=${code ?? 'n/a'} cause=${cause ? String(cause) : 'n/a'}`;
}
