import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { generateTempPassword, updateUser } from '@/lib/users';
import { sendPasswordResetEmail } from '@/lib/email';

export async function POST(req: NextRequest) {
  const { email } = await req.json();
  if (!email) {
    return NextResponse.json({ error: 'email required' }, { status: 400 });
  }

  // Look up user by email
  const { data: user } = await supabase
    .from('users')
    .select('id, name, username, email')
    .ilike('email', email)
    .eq('is_active', true)
    .single();

  if (!user || !user.email) {
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

  // Create admin notification
  await supabase.from('admin_notifications').insert({
    type: 'password_reset',
    user_id: user.id,
    user_name: user.name,
    user_username: user.username,
    status: 'pending',
  });

  return NextResponse.json({ ok: true });
}
