import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { redirect } from 'next/navigation';
import ActivityClient from '@/components/ActivityClient';

export default async function ActivityPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  // Admin can access activity when using "Ver como" (preview role stored client-side)
  // So we allow access — the client will handle showing the right content
  return <ActivityClient session={session} />;
}
