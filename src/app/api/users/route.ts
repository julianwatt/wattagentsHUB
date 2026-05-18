import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getUsers, getUserById, createUser, updateUser, deleteUser, generateTempPassword } from '@/lib/users';
import { UserRole, supabase } from '@/lib/supabase';
import { sendTempPasswordEmail, sendTempPasswordEmailDetailed, sendPasswordResetEmail } from '@/lib/email';

async function requireAdminOrCeo() {
  const session = await getServerSession(authOptions);
  if (!session || (session.user.role !== 'admin' && session.user.role !== 'ceo')) return null;
  return session;
}

// Master plan §Roles y permisos:
//   - agent → direct manager required
//   - jr_manager → direct manager must be a sr_manager
//   - sr_manager → direct manager (if set) must be another sr_manager
//   - admin / ceo → no manager required
// Returns an error string when the combination is invalid, or null when it's
// fine. Only enforced when `manager_id` is explicitly provided in the request.
async function validateHierarchyForRole(
  role: UserRole | undefined,
  manager_id: string | null | undefined,
): Promise<string | null> {
  if (!role) return null;
  if (role === 'admin' || role === 'ceo') return null;

  if (role === 'agent') {
    if (!manager_id) return 'Un agente debe tener un manager directo.';
  }
  if ((role === 'jr_manager' || role === 'sr_manager') && manager_id === undefined) {
    return null; // field absent — caller didn't intend to change hierarchy
  }
  if (!manager_id) {
    return role === 'jr_manager'
      ? 'Un Jr Manager debe reportar a un Sr Manager.'
      : null;
  }
  const target = await getUserById(manager_id);
  if (!target) return 'Manager directo no encontrado.';
  if (role === 'jr_manager' && target.role !== 'sr_manager') {
    return 'El manager directo de un Jr Manager debe ser un Sr Manager.';
  }
  if (role === 'sr_manager' && target.role !== 'sr_manager') {
    return 'El manager directo de un Sr Manager debe ser otro Sr Manager.';
  }
  return null;
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

  const { username, name, role, manager_id, email, hire_date, modality, payroll_status } = await req.json();
  if (!username || !name) {
    return NextResponse.json({ error: 'username and name are required' }, { status: 400 });
  }

  // No one can create new admin users via this endpoint — only one admin
  // is allowed in the system, and the partial unique index would refuse it
  // anyway. Surface a clear error before hitting the DB.
  if (role === 'admin') {
    return NextResponse.json({ error: 'No se permite crear nuevos usuarios con rol Admin' }, { status: 403 });
  }

  const hierarchyError = await validateHierarchyForRole(role as UserRole, manager_id);
  if (hierarchyError) return NextResponse.json({ error: hierarchyError }, { status: 400 });

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
      // Only agents have a meaningful modality; non-agents default to 'd2d'
      role === 'agent' && (modality === 'retail' || modality === 'both') ? modality : 'd2d',
      payroll_status === 'inactive' ? 'inactive' : 'active',
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

    // Notify admin when a new user is created
    await supabase.from('admin_notifications').insert({
      type: 'user_activated',
      user_id: user.id,
      user_name: user.name,
      user_username: user.username,
      data: { actor_name: session.user.name },
      status: 'pending',
    });

    await supabase.from('payroll_audit_log').insert({
      entity_type: 'user',
      entity_id: user.id,
      action: 'CREATE',
      actor_id: session.user.id,
      new_value: {
        username: user.username, name: user.name, role: user.role,
        manager_id: user.manager_id, email: user.email,
        modality: user.modality, payroll_status: user.payroll_status,
        hire_date: user.hire_date,
      },
      change_notes: `Usuario creado por ${session.user.name}`,
    });

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

  // Hierarchy validation when the update touches role or manager_id.
  // Resolve the effective values: the patch's value if present, otherwise
  // the existing one. Skip the check entirely when neither field is in play
  // — we don't want to refetch + validate on every password / hire_date edit.
  if ('role' in updates || 'manager_id' in updates) {
    const target = await getUserById(id);
    if (!target) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
    const effectiveRole = (updates.role ?? target.role) as UserRole;
    const effectiveManagerId = 'manager_id' in updates ? updates.manager_id : target.manager_id;
    const hierarchyError = await validateHierarchyForRole(effectiveRole, effectiveManagerId);
    if (hierarchyError) return NextResponse.json({ error: hierarchyError }, { status: 400 });
  }

  // Snapshot the user before the update so we can write a meaningful
  // before/after pair to the audit log.
  const beforeUser = await getUserById(id);

  // Block 08 — detect inactive → active payroll_status transition BEFORE
  // the update, so we can check the previous state and fire the
  // "user reactivated with pending negative balance" notification after.
  let payrollReactivated = false;
  if ('payroll_status' in updates) {
    if (beforeUser?.payroll_status === 'inactive' && updates.payroll_status === 'active') {
      payrollReactivated = true;
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

    // Audit: pick the diff (the parts of `updates` that actually changed)
    // so the log doesn't grow noisy with no-op fields and never leaks
    // a raw password.
    const auditOld: Record<string, unknown> = {};
    const auditNew: Record<string, unknown> = {};
    const trackable = [
      'name', 'email', 'role', 'manager_id', 'must_change_password',
      'hire_date', 'is_active', 'modality', 'payroll_status',
    ] as const;
    const updatesAsRecord = updates as Record<string, unknown>;
    const beforeAsRecord = beforeUser as unknown as Record<string, unknown> | null;
    for (const k of trackable) {
      if (k in updatesAsRecord && beforeAsRecord && beforeAsRecord[k] !== updatesAsRecord[k]) {
        auditOld[k] = beforeAsRecord[k] ?? null;
        auditNew[k] = updatesAsRecord[k] ?? null;
      }
    }
    if ('password' in updatesAsRecord) {
      auditNew.password_changed = true;
    }
    if (Object.keys(auditNew).length > 0) {
      await supabase.from('payroll_audit_log').insert({
        entity_type: 'user',
        entity_id: id,
        action: 'UPDATE',
        actor_id: session.user.id,
        old_value: Object.keys(auditOld).length > 0 ? auditOld : null,
        new_value: auditNew,
        change_notes: 'password_changed' in auditNew
          ? 'Password modificada por admin/CEO'
          : null,
      });
    }

    // Block 08 — if just reactivated AND has open negative balances, alert admin.
    if (payrollReactivated) {
      const { data: openBalances } = await supabase
        .from('negative_balances')
        .select('id, original_amount, remaining_amount, origin, description')
        .eq('user_id', id)
        .in('status', ['PENDING', 'PARTIALLY_COLLECTED']);
      const remaining = (openBalances ?? []).reduce((acc, b) => acc + Number(b.remaining_amount), 0);
      if ((openBalances ?? []).length > 0 && remaining > 0) {
        const target = await getUserById(id);
        await supabase.from('admin_notifications').insert({
          type: 'payroll_balance_reactivated',
          user_id: id,
          user_name: target?.name,
          user_username: target?.username,
          data: {
            balance_count: (openBalances ?? []).length,
            remaining_total: remaining,
            balances: (openBalances ?? []).map((b) => ({
              id: b.id,
              origin: b.origin,
              remaining: Number(b.remaining_amount),
              description: b.description,
            })),
          },
          status: 'pending',
        });
      }
    }

    // If admin manually set a password, create a notification
    if (updates.password) {
      const target = await getUserById(id);
      console.log('[PATCH /api/users] password changed, inserting notification for:', target?.name);
      if (target) {
        const { error: notifErr } = await supabase.from('admin_notifications').insert({
          type: 'password_change',
          user_id: id,
          user_name: target.name,
          user_username: target.username,
          status: 'pending',
        });
        if (notifErr) console.error('[PATCH /api/users] notification insert error:', notifErr);
        else console.log('[PATCH /api/users] notification inserted OK');
      }
    }

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

  const beforeDelete = await getUserById(id);

  // CEO can't delete admin users
  if (session.user.role === 'ceo') {
    if (beforeDelete?.role === 'admin') {
      return NextResponse.json({ error: 'CEO no puede eliminar usuarios admin' }, { status: 403 });
    }
  }

  await deleteUser(id);

  if (beforeDelete) {
    await supabase.from('payroll_audit_log').insert({
      entity_type: 'user',
      entity_id: id,
      action: 'DELETE',
      actor_id: session.user.id,
      old_value: beforeDelete as unknown as Record<string, unknown>,
      change_notes: `Usuario ${beforeDelete.name} (${beforeDelete.username}) eliminado`,
    });
  }
  return NextResponse.json({ success: true });
}
