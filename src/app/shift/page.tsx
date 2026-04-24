import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { redirect } from 'next/navigation';
import ShiftClient from '@/components/ShiftClient';

export default async function ShiftPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  return <ShiftClient session={session} />;
}
