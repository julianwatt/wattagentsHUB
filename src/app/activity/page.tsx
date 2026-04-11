import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { redirect } from 'next/navigation';
import ActivityClient from '@/components/ActivityClient';

export default async function ActivityPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  return <ActivityClient session={session} />;
}
