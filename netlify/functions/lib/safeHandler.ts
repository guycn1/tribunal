import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';

// Wraps a handler so that any uncaught exception (a rejected Supabase call
// that throws instead of resolving with an {error} object, for example)
// becomes a clean JSON error response instead of a bare, unhelpful HTTP 500
// with no detail attached.
export function safeHandler(fn: Handler): Handler {
  return async (event: HandlerEvent, context: HandlerContext) => {
    try {
      const result = await fn(event, context);
      return result ?? {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Handler returned no response.' }),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Unhandled error in function:', message);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Internal error: ${message}` }),
      };
    }
  };
}
