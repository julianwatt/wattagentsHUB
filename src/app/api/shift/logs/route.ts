import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { supabase } from '@/lib/supabase';

// GET — list all shift logs for admin/ceo dashboard
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user.role !== 'admin' && session.user.role !== 'ceo')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const agentId = searchParams.get('agentId');
  const eventType = searchParams.get('eventType');
  const dateFrom = searchParams.get('dateFrom');
  const dateTo = searchParams.get('dateTo');
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const pageSize = Math.min(500, Math.max(1, parseInt(searchParams.get('pageSize') || '50')));

  let query = supabase
    .from('shift_logs')
    .select(`
      id, user_id, store_id, event_type, event_time,
      latitude, longitude, is_at_location, distance_meters,
      users!inner(id, name, username),
      stores(id, name)
    `, { count: 'exact' })
    .order('event_time', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (agentId) query = query.eq('user_id', agentId);
  if (eventType) query = query.eq('event_type', eventType);
  if (dateFrom) query = query.gte('event_time', `${dateFrom}T00:00:00`);
  if (dateTo) query = query.lte('event_time', `${dateTo}T23:59:59.999`);

  const { data, error, count } = await query;

  if (error) {
    console.error('[shift/logs] error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    logs: data ?? [],
    total: count ?? 0,
    page,
    pageSize,
  }, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  });
}
