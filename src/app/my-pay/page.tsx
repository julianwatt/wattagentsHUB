import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { redirect } from 'next/navigation';
import MyPayClient from '@/components/payroll/MyPayClient';

/**
 * Block 12 — /my-pay
 *
 * Top-level page for agent / jr_manager / sr_manager. Shows the user's
 * current published payfile, history, and a performance summary. Admin
 * and CEO get bounced to /payroll (they have the full admin UI).
 */
export default async function MyPayPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const role = session.user.role ?? '';
  if (role === 'admin' || role === 'ceo') {
    redirect('/payroll');
  }
  // Agents / managers proceed.
  return <MyPayClient session={session} />;
}
