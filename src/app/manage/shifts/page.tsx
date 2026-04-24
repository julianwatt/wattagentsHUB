import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { redirect } from 'next/navigation';
import ShiftLogsClient from '@/components/ShiftLogsClient';

export default async function ManageShiftsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  if (session.user.role !== 'admin' && session.user.role !== 'ceo') redirect('/activity');
  return <ShiftLogsClient session={session} />;
}
