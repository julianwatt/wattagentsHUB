import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

/**
 * Browser-only Supabase client (singleton).
 * Uses NEXT_PUBLIC env vars that are embedded at build time.
 */
export function getSupabaseBrowser(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  _client = createClient(url, key, {
    auth: { persistSession: false },
    realtime: { params: { eventsPerSecond: 2 } },
  });
  return _client;
}
