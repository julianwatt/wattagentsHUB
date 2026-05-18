import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/user-notifications
 *
 * Returns the caller's own inbox (latest 50). Used by the per-user bell
 * in AppLayout — visible to every role (agent / jr_manager / sr_manager /
 * admin / ceo).
 *
 * PATCH /api/user-notifications  { id?, markAll?: boolean }
 *
 * Marks a single row or all pending rows as read. Always scoped to the
 * caller — no one else's notifications are reachable from this endpoint.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('user_notifications')
    .select('id, type, title, body, data, status, created_at, read_at')
    .eq('recipient_user_id', session.user.id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ notifications: data ?? [] });
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, markAll } = await req.json();
  if (markAll) {
    await supabase
      .from('user_notifications')
      .update({ status: 'read', read_at: new Date().toISOString() })
      .eq('recipient_user_id', session.user.id)
      .eq('status', 'pending');
    return NextResponse.json({ ok: true });
  }

  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  await supabase
    .from('user_notifications')
    .update({ status: 'read', read_at: new Date().toISOString() })
    .eq('id', id)
    .eq('recipient_user_id', session.user.id);
  return NextResponse.json({ ok: true });
}
