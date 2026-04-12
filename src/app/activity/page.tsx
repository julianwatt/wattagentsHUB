import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { redirect } from 'next/navigation';
import ActivityClient from '@/components/ActivityClient';

export default async function ActivityPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  // Admin is not a sales agent — redirect to admin panel
  if (session.user.role === 'admin') redirect('/admin');
  return <ActivityClient session={session} />;
}
