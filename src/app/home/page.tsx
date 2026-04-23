import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { redirect } from 'next/navigation';
import HomeClient from '@/components/HomeClient';

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  return <HomeClient session={session} />;
}
