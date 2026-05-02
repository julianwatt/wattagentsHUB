import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { redirect } from 'next/navigation';
import AppLayout from '@/components/AppLayout';
import MyPerformanceClient from '@/components/MyPerformanceClient';
import { canSeeOwnPerformance } from '@/lib/permissions';

/**
 * Agent-facing "Mi desempeño" page.
 *
 * Server-protected: only roles in canSeeOwnPerformance() can access.
 * Anyone else (CEO/Admin/Managers) is redirected to /home — they have
 * /assignments/history for management views.
 */
export default async function MyPerformancePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  if (!canSeeOwnPerformance(session.user.role)) redirect('/home');

  return (
    <AppLayout session={session}>
      <div className="max-w-5xl mx-auto px-3 sm:px-6 py-4 sm:py-8">
        <MyPerformanceClient />
      </div>
    </AppLayout>
  );
}
