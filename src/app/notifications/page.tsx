import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { redirect } from 'next/navigation';
import NotificationsClient from '@/components/NotificationsClient';

export default async function NotificationsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  if (session.user.role !== 'admin' && session.user.role !== 'ceo') redirect('/simulator');
  return <NotificationsClient session={session} />;
}
