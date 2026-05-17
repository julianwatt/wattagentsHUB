/**
 * Payroll-side auth helper used by every /api/payroll/* route. Centralizes
 * the same "must be admin or ceo" check so individual route files don't
 * each reinvent the session check.
 */

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { canAccessPayrollAdmin } from '@/lib/payroll/permissions';
import type { Session } from 'next-auth';

export async function requirePayrollAdmin(): Promise<Session | null> {
  const session = await getServerSession(authOptions);
  if (!session) return null;
  if (!canAccessPayrollAdmin(session.user.role)) return null;
  return session;
}
