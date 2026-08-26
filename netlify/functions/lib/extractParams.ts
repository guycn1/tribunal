import type { HandlerEvent } from '@netlify/functions';

// :id/:role reach the function as extra path segments (see netlify.toml —
// the deployed redirect engine does not reliably rewrite named placeholders
// into a target's query string, only into the target path). The query
// string is checked first regardless, since local dev's redirect simulator
// does accept the query-string shape; this way the same code is correct in
// both environments.
export function extractParams(event: HandlerEvent, fnName: string): { id?: string; role?: string } {
  const qs = event.queryStringParameters || {};
  if (qs.id) {
    return { id: qs.id, role: qs.role ?? undefined };
  }

  const segments = event.path.split('/').filter(Boolean);
  const fnIndex = segments.indexOf(fnName);
  const rest = fnIndex >= 0 ? segments.slice(fnIndex + 1) : [];

  return { id: rest[0], role: rest[1] };
}
