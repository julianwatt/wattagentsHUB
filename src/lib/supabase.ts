import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Lazy singleton so build-time static generation doesn't require env vars
let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!_client) {
    const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
    if (!url || !key) throw new Error('Supabase env vars not set');
    _client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return _client;
}

// Convenience proxy — use like `supabase.from(...)` in server code
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (getSupabase() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

// Service-role client (server-only) — required for `auth.admin.*` operations.
let _admin: SupabaseClient | null = null;
export function getSupabaseAdmin(): SupabaseClient | null {
  if (_admin) return _admin;
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  console.log('[supabaseAdmin] init', {
    hasUrl: !!url,
    hasServiceKey: !!serviceKey,
    urlHost: url ? new URL(url).host : null,
  });
  if (!url || !serviceKey) return null;
  _admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return _admin;
}

export type UserRole = 'agent' | 'jr_manager' | 'sr_manager' | 'admin' | 'ceo';
export type CampaignType = 'D2D' | 'Retail';

export interface DbUser {
  id: string;
  name: string;
  username: string;
  email: string | null;
  password_hash: string;
  role: UserRole;
  manager_id: string | null;
  must_change_password: boolean;
  is_active: boolean;
  hire_date: string;
  created_at: string;
}

export interface ActivityEntry {
  id: string;
  agent_id: string;
  date: string;
  campaign_type: CampaignType;
  zip_code: string | null;
  store_chain: string | null;
  store_address: string | null;
  // D2D
  knocks: number;
  contacts: number;
  bills: number;
  // Retail
  stops: number;
  zipcodes: number;
  credit_checks: number;
  // Shared
  sales: number;
  first_activity_at: string | null;
  last_activity_at: string | null;
  updated_at: string;
}

export interface ActivityLog {
  id: string;
  entry_id: string;
  agent_id: string;
  campaign_type: CampaignType;
  activity_type: string;
  delta: number;
  logged_at: string;
}
