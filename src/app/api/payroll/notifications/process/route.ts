import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { processPendingNotifications } from '@/lib/payroll/notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/payroll/notifications/process
 *
 * Drains up to `limit` pending rows from payroll_notification_queue and
 * dispatches them through the web-push helper. Hand-driven for now —
 * either invoked by an admin on demand or wired to a Vercel cron later
 * (the spec leaves that to a follow-up).
 *
 * Auth:
 *   - Either a valid admin/CEO session, OR
 *   - The PAYROLL_QUEUE_WORKER_TOKEN env (so a cron job can call this
 *     without an interactive session).
 *
 * Query: ?limit=N (default 25, max 200).
 */
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? '25')));

  const token = req.headers.get('x-worker-token');
  const expected = process.env.PAYROLL_QUEUE_WORKER_TOKEN;
  let authorized = !!(token && expected && token === expected);

  if (!authorized) {
    const session = await getServerSession(authOptions);
    if (session && (session.user.role === 'admin' || session.user.role === 'ceo')) {
      authorized = true;
    }
  }

  if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const stats = await processPendingNotifications(limit);
  return NextResponse.json(stats);
}
