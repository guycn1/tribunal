import type { HandlerEvent } from '@netlify/functions';

// :id/:role reach the function as extra path segments (see netlify.toml —
// the deployed redirect engine does not reliably rewrite named placeholders
// into a target's query string, only into the target path). The query
// string is checked first regardless, since local dev's redirect simulator
// does accept the query-string shape; this way the same code is correct in
// both environments.
//
// For the path fallback, params are read from the END of the path rather
// than located by function name: production's redirect engine does not
// consistently rewrite event.path to the target function's path, so it can
// arrive as either the original /api/trials/:id/representatives/:role
// (plural) or the rewritten /.netlify/functions/representative/:id/:role
// (singular) - matching on the function name breaks on that mismatch. The
// trailing segments are the same shape either way.
export function extractParams(event: HandlerEvent, paramCount: 1 | 2): { id?: string; role?: string } {
  const qs = event.queryStringParameters || {};
  if (qs.id) {
    return { id: qs.id, role: qs.role ?? undefined };
  }

  const segments = event.path.split('/').filter(Boolean);
  if (paramCount === 1) {
    return { id: segments[segments.length - 1] };
  }
  return { id: segments[segments.length - 2], role: segments[segments.length - 1] };
}
