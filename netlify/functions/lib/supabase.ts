import { createClient, SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

// Uses the service role key, which bypasses Row Level Security — this is
// safe only because it is used exclusively on the backend and never sent
// to the browser. The browser talks only to the Netlify function endpoints.
export function getSupabaseClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured on the server.');
  }

  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}
