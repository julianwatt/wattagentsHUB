import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { supabase } from '@/lib/supabase';
import webpush from 'web-push';

// Configure web-push with VAPID keys
const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_EMAIL = process.env.VAPID_CONTACT_EMAIL || 'mailto:admin@wattdistributors.com';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
}

// POST — send a push notification to a specific user (server-only, admin/ceo)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user.role !== 'admin' && session.user.role !== 'ceo')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return NextResponse.json({ error: 'VAPID keys not configured' }, { status: 500 });
  }

  const { userId, title, body, url } = await req.json();
  if (!userId || !title) {
    return NextResponse.json({ error: 'userId and title required' }, { status: 400 });
  }

  // Fetch the user's push subscription
  const { data: sub } = await supabase
    .from('push_subscriptions')
    .select('subscription')
    .eq('user_id', userId)
    .single();

  if (!sub) {
    return NextResponse.json({ error: 'No push subscription for this user', sent: false }, { status: 404 });
  }

  try {
    await webpush.sendNotification(
      sub.subscription,
      JSON.stringify({ title, body: body || '', url: url || '/' }),
    );
    return NextResponse.json({ ok: true, sent: true });
  } catch (err: unknown) {
    const pushErr = err as { statusCode?: number; message?: string };
    console.error('[push/send] error:', pushErr);

    // 410 Gone or 404 = subscription expired, clean up
    if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
      await supabase.from('push_subscriptions').delete().eq('user_id', userId);
      return NextResponse.json({ error: 'Subscription expired, removed', sent: false }, { status: 410 });
    }

    return NextResponse.json({ error: pushErr.message || 'Push failed', sent: false }, { status: 500 });
  }
}
