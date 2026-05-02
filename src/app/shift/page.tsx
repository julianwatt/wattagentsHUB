import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { redirect, notFound } from 'next/navigation';
import ShiftClient from '@/components/ShiftClient';
import { isLegacyShiftPanelEnabled } from '@/lib/flags';

export default async function ShiftPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  // Legacy panel is hidden behind a feature flag. Behave as if the route
  // didn't exist when the flag is off.
  if (!isLegacyShiftPanelEnabled()) notFound();
  return <ShiftClient session={session} />;
}
