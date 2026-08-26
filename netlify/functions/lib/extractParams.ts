import type { HandlerEvent } from '@netlify/functions';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// :id/:role reach the function as extra path segments (see netlify.toml —
// the deployed redirect engine does not reliably rewrite named placeholders
// into a target's query string, only into the target path). The query
// string is checked first regardless, since local dev's redirect simulator
// does accept the query-string shape; this way the same code is correct in
// both environments.
//
// For the path fallback, id is located by UUID shape rather than by
// position: production's redirect engine does not rewrite event.path to the
// target function's path, so it arrives as the original request path (e.g.
// /api/trials/:id/representatives/:role), which has a literal path segment
// ("representatives") sitting between id and role - unlike the direct
// function path (/.netlify/functions/representative/:id/:role), where they
// are adjacent. Trial ids are always UUIDs, so searching for that shape
// finds id correctly under either layout. role, when expected, is always
// the final segment in both layouts.
export function extractParams(event: HandlerEvent, paramCount: 1 | 2): { id?: string; role?: string } {
  const qs = event.queryStringParameters || {};
  if (qs.id) {
    return { id: qs.id, role: qs.role ?? undefined };
  }

  const segments = event.path.split('/').filter(Boolean);
  const id = [...segments].reverse().find((s) => UUID_RE.test(s));

  if (paramCount === 1) {
    return { id };
  }
  return { id, role: segments[segments.length - 1] };
}
