import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { supabase } from '@/lib/supabase';
import { canManageAssignments } from '@/lib/permissions';

const noCache = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
};

/**
 * GET /api/assignments/[id]/events
 *
 * Returns the full timeline of geofence events for an assignment, used by
 * the "Ver detalle" modal in the Hoy panel. CEO/Admin can read any
 * assignment's events; agents may also read their own (useful for future
 * agent-side detail views).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;

  // Authz: managers can see any; agents can only see their own assignment's events.
  if (!canManageAssignments(session.user.role)) {
    const { data: own } = await supabase
      .from('assignments')
      .select('agent_id')
      .eq('id', id)
      .single();
    if (!own || own.agent_id !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const { data, error } = await supabase
    .from('assignment_geofence_events')
    .select('id, event_type, occurred_at, latitude, longitude, distance_meters, geo_method')
    .eq('assignment_id', id)
    .order('occurred_at', { ascending: true });

  if (error) {
    console.error('[assignments/events] error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ events: data ?? [] }, { headers: noCache });
}
