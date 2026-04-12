import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const { username } = await req.json();
  if (!username) {
    return NextResponse.json({ error: 'username required' }, { status: 400 });
  }

  // Look up user
  const { data: user } = await supabase
    .from('users')
    .select('id, name, username')
    .ilike('username', username)
    .eq('is_active', true)
    .single();

  if (!user) {
    // Don't reveal whether user exists — always return success
    return NextResponse.json({ ok: true });
  }

  // Insert notification for admin
  await supabase.from('admin_notifications').insert({
    type: 'password_reset',
    user_id: user.id,
    user_name: user.name,
    user_username: user.username,
    status: 'pending',
  });

  return NextResponse.json({ ok: true });
}
