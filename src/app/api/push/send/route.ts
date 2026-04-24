import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { sendPushToUser } from '@/lib/push';

// POST — send a push notification to a specific user (server-only, admin/ceo)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user.role !== 'admin' && session.user.role !== 'ceo')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { userId, title, body, url } = await req.json();
  if (!userId || !title) {
    return NextResponse.json({ error: 'userId and title required' }, { status: 400 });
  }

  const result = await sendPushToUser(userId, { title, body: body || '', url: url || '/' });

  if (!result.sent) {
    const status = result.error === 'VAPID not configured' ? 500
      : result.error === 'No subscription' ? 404
      : result.error === 'Subscription expired' ? 410
      : 500;
    return NextResponse.json({ error: result.error, sent: false }, { status });
  }

  return NextResponse.json({ ok: true, sent: true });
}
