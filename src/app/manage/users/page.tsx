import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { redirect } from 'next/navigation';
import UsersManagementClient from '@/components/UsersManagementClient';

export default async function ManageUsersPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  if (session.user.role !== 'admin' && session.user.role !== 'ceo') redirect('/activity');
  return <UsersManagementClient session={session} />;
}
