import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { findByUsername, verifyPassword, updateUser } from '@/lib/users';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { currentPassword, newPassword } = await req.json();
  if (!newPassword) {
    return NextResponse.json({ error: 'newPassword is required' }, { status: 400 });
  }
  if (newPassword.length < 6) {
    return NextResponse.json({ error: 'La contraseña debe tener al menos 6 caracteres' }, { status: 400 });
  }

  const user = await findByUsername(session.user.username);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // If must_change_password is true, skip verifying the current (temp) password
  // since the user already authenticated with it to get here
  if (currentPassword && !session.user.must_change_password) {
    const valid = await verifyPassword(user, currentPassword);
    if (!valid) return NextResponse.json({ error: 'Contraseña actual incorrecta' }, { status: 401 });
  }

  await updateUser(user.id, { password: newPassword, must_change_password: false });
  return NextResponse.json({ success: true });
}
