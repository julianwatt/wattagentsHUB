import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { redirect } from 'next/navigation';
import RosterClient from '@/components/RosterClient';

export default async function RosterPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  if (session.user.role !== 'admin' && session.user.role !== 'ceo') redirect('/activity');
  return <RosterClient session={session} />;
}
