import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { redirect } from 'next/navigation';
import AssignmentsShell from '@/components/AssignmentsShell';
import { canManageAssignments } from '@/lib/permissions';

/**
 * Server-level guard for the entire /assignments tree.
 *
 * Every page under /assignments/* renders inside this layout, so the role
 * check happens once for the whole section. URL access is blocked at the
 * server: agents that type /assignments/anything are redirected to /home.
 *
 * The role-allowed list lives in `canManageAssignments()` (lib/permissions).
 * Add new roles there, NOT here.
 */
export default async function AssignmentsLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  if (!canManageAssignments(session.user.role)) redirect('/home');

  return <AssignmentsShell session={session}>{children}</AssignmentsShell>;
}
