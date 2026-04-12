import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { supabase } from '@/lib/supabase';

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

// PATCH — toggle active/inactive
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user.role !== 'admin')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id, is_active } = await req.json();
  if (!id || typeof is_active !== 'boolean') {
    return NextResponse.json({ error: 'id and is_active required' }, { status: 400 });
  }

  const { error } = await supabase.from('users').update({ is_active }).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
