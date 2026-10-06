import type { HandlerEvent } from '@netlify/functions';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The trial id, and the role when paramCount is 2, from a request to one of
 * the routed functions; either is undefined if it cannot be found.
 *
 * :id/:role reach the function as extra path segments (see netlify.toml —
 * the deployed redirect engine does not reliably rewrite named placeholders
 * into a target's query string, only into the target path). The query
 * string is still checked first: the redirects once forwarded the
 * placeholders that way, and local dev's redirect simulator accepts that
 * shape. Nothing in netlify.toml sends it today, so it is a harmless
 * fallback rather than a path either environment takes.
 *
 * For the path fallback, id is located by UUID shape rather than by
 * position: production's redirect engine does not rewrite event.path to the
 * target function's path, so it arrives as the original request path (e.g.
 * /api/trials/:id/representatives/:role), which has a literal path segment
 * ("representatives") sitting between id and role - unlike the direct
 * function path (/.netlify/functions/representative-background/:id/:role),
 * where they are adjacent. Trial ids are always UUIDs, so searching for that shape
 * finds id correctly under either layout. role, when expected, is always
 * the final segment in both layouts.
 */
/**
 * Whether a request reached its function through one of the /api routes in
 * netlify.toml, rather than at the function's own address,
 * /.netlify/functions/<name>, which Netlify serves as well. event.path is
 * the address the request was sent to (see extractParams below), so a caller
 * cannot make it start with /api/ without going through a route - and the
 * routes are where netlify.toml sets the per-IP rate limit.
 */
export function cameThroughApiRoute(event: HandlerEvent): boolean {
  return event.path.startsWith('/api/');
}

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
