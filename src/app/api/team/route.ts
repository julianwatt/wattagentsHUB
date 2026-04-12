import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getVisibleUserIds, getUserById, type UserRole } from '@/lib/users';
import { getEntriesForUsers } from '@/lib/activity';
import { supabase } from '@/lib/supabase';

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role === 'agent') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Support "Ver como" individual user preview for admin
  const { searchParams } = new URL(req.url);
  const asUser = searchParams.get('asUser');
  let viewerId = session.user.id;
  let viewerRole: UserRole = session.user.role as UserRole;
  if (asUser && session.user.role === 'admin') {
    const targetUser = await getUserById(asUser);
    if (targetUser) {
      viewerId = targetUser.id;
      viewerRole = targetUser.role;
    }
  }

  const visibleIds = await getVisibleUserIds(viewerId, viewerRole);
  // Exclude the viewer themselves from the team roster
  const memberIds = visibleIds.filter((id) => id !== viewerId);

  let members: Array<{
    id: string;
    name: string;
    username: string;
    role: string;
    manager_id: string | null;
    hire_date: string;
  }> = [];

  if (memberIds.length > 0) {
    const { data } = await supabase
      .from('users')
      .select('id, name, username, role, manager_id, hire_date')
      .in('id', memberIds)
      .eq('is_active', true)
      .order('hire_date', { ascending: true });
    members = (data ?? []) as typeof members;
  }

  // Pull a generous slice of entries for everyone visible (used for rankings + mini charts)
  const entries = visibleIds.length > 0 ? await getEntriesForUsers(visibleIds, 1000) : [];

  // Include the viewer's own info too so the client can frame the page
  const viewer = await getUserById(viewerId);

  return NextResponse.json({ viewer, members, entries });
}
