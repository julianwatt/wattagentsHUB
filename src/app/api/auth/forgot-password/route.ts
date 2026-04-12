import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { generateTempPassword, updateUser } from '@/lib/users';
import { sendPasswordResetEmail } from '@/lib/email';

export async function POST(req: NextRequest) {
  const { username } = await req.json();
  if (!username) {
    return NextResponse.json({ error: 'username required' }, { status: 400 });
  }

  // Look up user
  const { data: user } = await supabase
    .from('users')
    .select('id, name, username, email')
    .ilike('username', username)
    .eq('is_active', true)
    .single();

  if (!user || !user.email) {
    // Don't reveal whether user exists — always return success
    return NextResponse.json({ ok: true });
  }

  // Generate temp password
  const tempPassword = generateTempPassword();

  // Update user: set new password + force change on next login
  await updateUser(user.id, { password: tempPassword, must_change_password: true });

  // Send email directly to the user
  const emailSent = await sendPasswordResetEmail(
    user.email,
    user.name,
    user.username,
    tempPassword,
  );

  if (!emailSent) {
    console.error('[forgot-password] Failed to send reset email to', user.email);
  }

  return NextResponse.json({ ok: true });
}
