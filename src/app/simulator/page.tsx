import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { redirect } from 'next/navigation';
import SimulatorClient from '@/components/SimulatorClient';

export default async function SimulatorPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  return <SimulatorClient session={session} />;
}
