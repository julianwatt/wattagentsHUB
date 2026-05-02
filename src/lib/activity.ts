import { supabase, ActivityEntry, CampaignType, Modality } from './supabase';

export type { ActivityEntry, CampaignType };

export type D2DField = 'knocks' | 'contacts' | 'bills' | 'sales';
export type RetailField = 'stops' | 'zipcodes' | 'credit_checks' | 'sales';
export type ActivityField = D2DField | RetailField;

// ─────────────────────────────────────────────────────────────────────────────
// Modality / assignment helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The agent's modality determines which campaign types they may register.
 * Used by the API to reject mismatched submissions even if the client UI
 * is bypassed.
 */
export function isCampaignAllowed(modality: Modality, campaign: CampaignType): boolean {
  if (modality === 'both') return true;
  if (modality === 'retail') return campaign === 'Retail';
  return campaign === 'D2D';
}

/** Active assignment for an agent on a given date (the one the activity
 *  should link to). Null if none exists or it's not in an active status. */
export interface ResolvedAssignment {
  assignment_id: string;
  store_id: string;
  store_name: string;
  store_address: string | null;
  status: string;
}

export async function resolveActiveAssignment(
  agentId: string,
  date: string,
): Promise<ResolvedAssignment | null> {
  const { data } = await supabase
    .from('assignments')
    .select(`
      id, store_id, status,
      store:stores ( id, name, address )
    `)
    .eq('agent_id', agentId)
    .eq('shift_date', date)
    .in('status', ['accepted', 'in_progress', 'completed', 'incomplete'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const store = data.store as unknown as { id: string; name: string; address: string | null } | null;
  if (!store) return null;
  return {
    assignment_id: data.id,
    store_id: store.id,
    store_name: store.name,
    store_address: store.address,
    status: data.status,
  };
}

/** Read the agent's modality. Returns 'd2d' when the user row is missing
 *  for any reason (defensive — matches the column default). */
export async function getUserModality(userId: string): Promise<Modality> {
  const { data } = await supabase
    .from('users')
    .select('modality')
    .eq('id', userId)
    .single();
  return (data?.modality as Modality | undefined) ?? 'd2d';
}

export interface D2DMetrics { knocks: number; contacts: number; bills: number; sales: number; }
export interface RetailMetrics { stops: number; zipcodes: number; credit_checks: number; sales: number; }

export function emptyD2D(): D2DMetrics { return { knocks: 0, contacts: 0, bills: 0, sales: 0 }; }
export function emptyRetail(): RetailMetrics { return { stops: 0, zipcodes: 0, credit_checks: 0, sales: 0 }; }

export function effectivenessRate(entry: ActivityEntry): number {
  if (entry.campaign_type === 'Retail') {
    return entry.zipcodes > 0 ? (entry.sales / entry.zipcodes) * 100 : 0;
  }
  return entry.contacts > 0 ? (entry.sales / entry.contacts) * 100 : 0;
}

// ── Upsert full entry ────────────────────────────────────────────────────────

export async function upsertActivity(
  agentId: string,
  date: string,
  campaignType: CampaignType,
  metrics: Partial<D2DMetrics & RetailMetrics>,
  location: { zip_code?: string; store_chain?: string; store_address?: string },
  assignmentId?: string | null,
): Promise<ActivityEntry> {
  const now = new Date().toISOString();
  const { data: existing } = await supabase
    .from('activity_entries')
    .select('id, first_activity_at, campaign_type')
    .eq('agent_id', agentId)
    .eq('date', date)
    .single();

  // One agent → one campaign per day. Block any attempt to switch campaign type
  // once the day already has an entry of the other kind.
  if (existing?.campaign_type && existing.campaign_type !== campaignType) {
    throw new Error('CAMPAIGN_LOCKED');
  }

  const payload = {
    agent_id: agentId,
    date,
    campaign_type: campaignType,
    zip_code: location.zip_code ?? null,
    store_chain: location.store_chain ?? null,
    store_address: location.store_address ?? null,
    assignment_id: assignmentId ?? null,
    knocks: metrics.knocks ?? 0,
    contacts: metrics.contacts ?? 0,
    bills: metrics.bills ?? 0,
    stops: metrics.stops ?? 0,
    zipcodes: metrics.zipcodes ?? 0,
    credit_checks: metrics.credit_checks ?? 0,
    sales: metrics.sales ?? 0,
    first_activity_at: existing?.first_activity_at ?? now,
    last_activity_at: now,
    updated_at: now,
  };

  const { data, error } = await supabase
    .from('activity_entries')
    .upsert(payload, { onConflict: 'agent_id,date' })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as ActivityEntry;
}

// ── Increment a single field (from +/- buttons) ──────────────────────────────

export async function incrementField(
  agentId: string,
  agentName: string,
  agentUsername: string,
  date: string,
  campaignType: CampaignType,
  field: ActivityField,
  delta: 1 | -1,
  location: { zip_code?: string; store_chain?: string; store_address?: string },
  assignmentId?: string | null,
): Promise<ActivityEntry> {
  const now = new Date().toISOString();

  // Upsert entry if it doesn't exist
  const { data: existing, error: fetchErr } = await supabase
    .from('activity_entries')
    .select('*')
    .eq('agent_id', agentId)
    .eq('date', date)
    .single();

  if (fetchErr && fetchErr.code !== 'PGRST116') throw new Error(fetchErr.message);

  // One agent → one campaign per day. Block switching campaign type mid-day.
  if (existing?.campaign_type && existing.campaign_type !== campaignType) {
    throw new Error('CAMPAIGN_LOCKED');
  }

  if (!existing) {
    // Create fresh entry
    const init = {
      agent_id: agentId,
      date,
      campaign_type: campaignType,
      zip_code: location.zip_code ?? null,
      store_chain: location.store_chain ?? null,
      store_address: location.store_address ?? null,
      assignment_id: assignmentId ?? null,
      knocks: 0, contacts: 0, bills: 0,
      stops: 0, zipcodes: 0, credit_checks: 0,
      sales: 0,
      first_activity_at: now,
      last_activity_at: now,
    } as Record<string, unknown>;
    init[field] = Math.max(0, delta);
    const { data: created, error: createErr } = await supabase
      .from('activity_entries')
      .insert(init)
      .select()
      .single();
    if (createErr) throw new Error(createErr.message);
    await logEvent(created.id, agentId, campaignType, field, delta);
    return created as ActivityEntry;
  }

  // Update existing
  const current = existing[field] as number ?? 0;
  const newVal = Math.max(0, current + delta);
  const { data: updated, error: updateErr } = await supabase
    .from('activity_entries')
    .update({
      [field]: newVal,
      last_activity_at: now,
      updated_at: now,
      zip_code: location.zip_code ?? existing.zip_code,
      store_chain: location.store_chain ?? existing.store_chain,
      store_address: location.store_address ?? existing.store_address,
      assignment_id: assignmentId ?? existing.assignment_id ?? null,
    })
    .eq('id', existing.id)
    .select()
    .single();

  if (updateErr) throw new Error(updateErr.message);
  await logEvent(existing.id, agentId, campaignType, field, delta);
  return updated as ActivityEntry;
}

async function logEvent(
  entryId: string,
  agentId: string,
  campaignType: CampaignType,
  activityType: string,
  delta: number,
) {
  await supabase.from('activity_logs').insert({
    entry_id: entryId,
    agent_id: agentId,
    campaign_type: campaignType,
    activity_type: activityType,
    delta,
  });
}

// ── Queries ──────────────────────────────────────────────────────────────────

export async function getEntry(agentId: string, date: string): Promise<ActivityEntry | null> {
  const { data } = await supabase
    .from('activity_entries')
    .select('*')
    .eq('agent_id', agentId)
    .eq('date', date)
    .single();
  return data ?? null;
}

export interface ActivityEntryWithAgent extends ActivityEntry {
  agent_name: string;
  agent_username: string;
}

export async function getAgentEntries(agentId: string, limit = 90): Promise<ActivityEntryWithAgent[]> {
  const { data } = await supabase
    .from('activity_entries')
    .select('*, users!agent_id(name, username)')
    .eq('agent_id', agentId)
    .order('date', { ascending: false })
    .limit(limit);
  return ((data ?? []) as unknown[]).map((row: unknown) => {
    const r = row as ActivityEntry & { users?: { name: string; username: string } };
    return { ...r, agent_name: r.users?.name ?? '', agent_username: r.users?.username ?? '' };
  });
}

export async function getEntriesForUsers(userIds: string[], limit = 200): Promise<ActivityEntryWithAgent[]> {
  const { data } = await supabase
    .from('activity_entries')
    .select('*, users!agent_id(name, username)')
    .in('agent_id', userIds)
    .order('date', { ascending: false })
    .limit(limit);
  return ((data ?? []) as unknown[]).map((row: unknown) => {
    const r = row as ActivityEntry & { users?: { name: string; username: string } };
    return { ...r, agent_name: r.users?.name ?? '', agent_username: r.users?.username ?? '' };
  });
}

export async function deleteEntry(agentId: string, date: string): Promise<void> {
  await supabase
    .from('activity_entries')
    .delete()
    .eq('agent_id', agentId)
    .eq('date', date);
}
