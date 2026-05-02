import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { supabase } from '@/lib/supabase';

const noCache = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
};

/**
 * GET /api/assignments/my
 *
 * Returns the current user's relevant assignments to drive the agent UI:
 *   - `live`     : pending / accepted / in_progress, for today onwards
 *   - `recentRejected` : rejected within the last 24h with no live replacement
 *
 * Used by AssignmentCards.tsx to decide which card to render.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = session.user.id;
  const todayStr = new Date().toISOString().slice(0, 10);
  const yesterdayIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const baseSelect = `
    id, agent_id, assigned_by, store_id, shift_date,
    scheduled_start_time, expected_duration_min, status,
    actual_entry_at, actual_exit_at, agent_response_at,
    rejection_reason, created_at, updated_at,
    assigner:users!assignments_assigned_by_fkey ( id, name ),
    store:stores ( id, name, address, latitude, longitude, geofence_radius_meters )
  `;

  // Live = pending / accepted / in_progress, for today or future
  const liveQ = supabase
    .from('assignments')
    .select(baseSelect)
    .eq('agent_id', userId)
    .gte('shift_date', todayStr)
    .in('status', ['pending', 'accepted', 'in_progress'])
    .order('shift_date', { ascending: true })
    .order('scheduled_start_time', { ascending: true });

  // Recent rejected — last 24h
  const rejectedQ = supabase
    .from('assignments')
    .select(baseSelect)
    .eq('agent_id', userId)
    .eq('status', 'rejected')
    .gte('agent_response_at', yesterdayIso)
    .order('agent_response_at', { ascending: false })
    .limit(1);

  const [liveRes, rejectedRes] = await Promise.all([liveQ, rejectedQ]);

  if (liveRes.error) {
    console.error('[assignments/my] live error:', liveRes.error);
    return NextResponse.json({ error: liveRes.error.message }, { status: 500 });
  }
  if (rejectedRes.error) {
    console.error('[assignments/my] rejected error:', rejectedRes.error);
    return NextResponse.json({ error: rejectedRes.error.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      live: liveRes.data ?? [],
      recentRejected: rejectedRes.data ?? [],
    },
    { headers: noCache },
  );
}
