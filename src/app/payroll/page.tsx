import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { redirect } from 'next/navigation';
import { canAccessPayrollAdmin } from '@/lib/payroll/permissions';
import PayrollClient from '@/components/payroll/PayrollClient';

export default async function PayrollPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  if (!canAccessPayrollAdmin(session.user.role)) redirect('/home');
  return <PayrollClient session={session} />;
}
