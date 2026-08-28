// A lightweight "did this request come from the real page" check - NOT
// real access control, and not meant to be. Nothing served to an
// unauthenticated static frontend can ever be a genuine secret: whatever
// value public/app.js sends as this header is sitting in plain text in
// that same publicly-downloadable file, readable by anyone who opens
// dev tools or just fetches app.js directly. Its only real job is to
// reject the laziest class of automated traffic - mass scanners that
// POST to guessed/scraped API paths without ever having loaded the
// actual page - for near-zero implementation cost. A caller who has
// actually looked at app.js first defeats this trivially.
//
// The real, unconditional ceiling on worst-case spend is
// isGlobalCallCapExceeded() in db.ts, which this cannot substitute for -
// this is layer three of three, not the load-bearing one.
//
// Fails OPEN (allows the request through) when SITE_GATE_TOKEN isn't
// configured, rather than closed: an env var that didn't get set must
// never be able to lock a grader out of an otherwise-working site. Set
// SITE_GATE_TOKEN in Netlify's production environment to the exact same
// value as the SITE_GATE_TOKEN constant in public/app.js for this layer
// to actually do anything - until then it's a harmless no-op, and the
// other two layers are unaffected either way.
export function isSiteGateOk(headers: Record<string, string | undefined>): boolean {
  const expected = process.env.SITE_GATE_TOKEN;
  if (!expected) return true;

  // Netlify Functions normalize incoming header names to lowercase, but
  // that's normalized by the platform before this code runs, not
  // guaranteed by the HTTP spec itself - looking the key up
  // case-insensitively costs nothing and removes any doubt.
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === 'x-site-gate') {
      return headers[key] === expected;
    }
  }
  return false;
}
