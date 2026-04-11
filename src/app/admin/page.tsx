import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { redirect } from 'next/navigation';
import AdminClient from '@/components/AdminClient';

export default async function AdminPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  if (session.user.role !== 'admin' && session.user.role !== 'ceo') redirect('/simulator');
  return <AdminClient session={session} />;
}
