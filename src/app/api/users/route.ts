import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getUsers, getUserById, createUser, updateUser, deleteUser, generateTempPassword } from '@/lib/users';
import { UserRole } from '@/lib/supabase';
import { sendTempPasswordEmail, sendTempPasswordEmailDetailed, sendPasswordResetEmail } from '@/lib/email';

async function requireAdminOrCeo() {
  const session = await getServerSession(authOptions);
  if (!session || (session.user.role !== 'admin' && session.user.role !== 'ceo')) return null;
  return session;
}

export async function GET() {
  const session = await requireAdminOrCeo();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const users = await getUsers();
  return NextResponse.json(users);
}

export async function POST(req: NextRequest) {
  const session = await requireAdminOrCeo();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { username, name, role, manager_id, email, hire_date } = await req.json();
  if (!username || !name) {
    return NextResponse.json({ error: 'username and name are required' }, { status: 400 });
  }

  // No one can create new admin users via this endpoint — only one admin
  // is allowed in the system, and the partial unique index would refuse it
  // anyway. Surface a clear error before hitting the DB.
  if (role === 'admin') {
    return NextResponse.json({ error: 'No se permite crear nuevos usuarios con rol Admin' }, { status: 403 });
  }

  // Auto-generate temp password — admin doesn't set passwords manually anymore
  const tempPassword = generateTempPassword();

  try {
    const user = await createUser(
      username,
      tempPassword,
      name,
      role as UserRole,
      manager_id,
      email || null,
      true, // must_change_password
      hire_date || null,
    );

    // Try to email the temp password if email was provided
    let emailSent = false;
    let emailDebug: { stage: string; path: string; detail?: string } | null = null;
    if (email) {
      console.log('[users POST] about to sendTempPasswordEmail', { to: email, username });
      try {
        const result = await sendTempPasswordEmailDetailed(email, name, username, tempPassword);
        emailSent = result.ok;
        emailDebug = { stage: result.stage, path: result.path, detail: result.detail };
        console.log('[users POST] sendTempPasswordEmail returned', { to: email, emailSent, emailDebug });
      } catch (err) {
        console.error('[users POST] sendTempPasswordEmail threw:', err);
        emailDebug = { stage: 'route_threw', path: 'none', detail: err instanceof Error ? err.message : String(err) };
      }
    } else {
      console.log('[users POST] no email provided, skipping send');
    }

    return NextResponse.json({ ...user, tempPassword, emailSent, emailDebug }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error creating user';
    return NextResponse.json({ error: message }, { status: 409 });
  }
}

export async function PATCH(req: NextRequest) {
  const session = await requireAdminOrCeo();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, resetPassword, ...updates } = await req.json();
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  // CEO can't touch admin users
  if (session.user.role === 'ceo') {
    const target = await getUserById(id);
    if (!target) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
    if (target.role === 'admin') {
      return NextResponse.json({ error: 'CEO no puede modificar usuarios admin' }, { status: 403 });
    }
  }

  // Nobody (admin or CEO) can promote a non-admin user TO admin via this endpoint.
  if (updates.role === 'admin') {
    const target = await getUserById(id);
    if (target?.role !== 'admin') {
      return NextResponse.json({ error: 'No se permite promover usuarios al rol Admin' }, { status: 403 });
    }
  }

  try {
    // If admin requests a password reset, generate a new temp password and force change on next login
    if (resetPassword) {
      const tempPassword = generateTempPassword();
      const target = await getUserById(id);
      await updateUser(id, { ...updates, password: tempPassword, must_change_password: true });
      // Send branded reset email with temp password and login link
      let emailSent = false;
      const emailAddr = updates.email || target?.email;
      const userName = updates.name || target?.name || '';
      const userUsername = target?.username || '';
      if (emailAddr) {
        emailSent = await sendPasswordResetEmail(emailAddr, userName, userUsername, tempPassword);
      }
      return NextResponse.json({ success: true, tempPassword, emailSent });
    }

    console.log('[PATCH /api/users] updateUser', { id, manager_id: updates.manager_id, updates });
    await updateUser(id, updates);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error updating user';
    return NextResponse.json({ error: message }, { status: 409 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await requireAdminOrCeo();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  if (id === session.user.id) return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 });

  // CEO can't delete admin users
  if (session.user.role === 'ceo') {
    const target = await getUserById(id);
    if (target?.role === 'admin') {
      return NextResponse.json({ error: 'CEO no puede eliminar usuarios admin' }, { status: 403 });
    }
  }

  await deleteUser(id);
  return NextResponse.json({ success: true });
}
