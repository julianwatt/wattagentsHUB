import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { redirect } from 'next/navigation';
import TeamClient from '@/components/TeamClient';

export default async function TeamPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  if (session.user.role === 'agent') redirect('/activity');
  return <TeamClient session={session} />;
}
