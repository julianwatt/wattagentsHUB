import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { supabase } from '@/lib/supabase';
import { getVisibleUserIds, type UserRole } from '@/lib/users';

// GET — all users for roster (admin/ceo only)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || (session.user.role !== 'admin')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: users, error } = await supabase
    .from('users')
    .select('id, name, username, role, manager_id, is_active, hire_date')
    .order('name');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(users ?? []);
}

const TOGGLE_ROLES = new Set(['admin', 'ceo', 'jr_manager', 'sr_manager']);

// PATCH — toggle active/inactive
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !TOGGLE_ROLES.has(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id, is_active } = await req.json();
  if (!id || typeof is_active !== 'boolean') {
    return NextResponse.json({ error: 'id and is_active required' }, { status: 400 });
  }

  // Managers can only toggle users in their hierarchy
  if (session.user.role !== 'admin' && session.user.role !== 'ceo') {
    const visibleIds = await getVisibleUserIds(session.user.id, session.user.role as UserRole);
    if (!visibleIds.includes(id) || id === session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const { error } = await supabase.from('users').update({ is_active }).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Notify admin when a user is deactivated or reactivated
  const notifType = is_active ? 'user_activated' : 'user_deactivated';
  const { data: user } = await supabase.from('users').select('name, username').eq('id', id).single();
  if (user) {
    await supabase.from('admin_notifications').insert({
      type: notifType,
      user_id: id,
      user_name: user.name,
      user_username: user.username,
      data: { actor_name: session.user.name },
      status: 'pending',
    });
  }

  return NextResponse.json({ ok: true });
}
