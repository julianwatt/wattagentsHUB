import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { supabase } from '@/lib/supabase';

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'admin') return null;
  return session;
}

// GET — fetch all notifications (all types)
export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // All notifications — password_reset, password_change, user_deactivated
  const { data: notifications } = await supabase
    .from('admin_notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  return NextResponse.json({ notifications: notifications ?? [] });
}

// PATCH — mark notification as done
export async function PATCH(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  await supabase.from('admin_notifications').update({ status: 'done' }).eq('id', id);
  return NextResponse.json({ ok: true });
}
