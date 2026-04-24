import { supabase } from '@/lib/supabase';

function normalizeKey(raw: string | undefined): string {
  if (!raw) return '';
  return raw.trim().replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let _webpush: typeof import('web-push') | null = null;

async function getWebPush() {
  if (_webpush) return _webpush;
  const mod = await import('web-push');
  _webpush = mod.default ?? mod;

  const pub = normalizeKey(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
  const priv = normalizeKey(process.env.VAPID_PRIVATE_KEY);
  const email = (() => {
    const e = (process.env.VAPID_CONTACT_EMAIL || 'mailto:admin@wattdistributors.com').trim();
    return e.startsWith('mailto:') || e.startsWith('https:') ? e : `mailto:${e}`;
  })();

  if (!pub || !priv) {
    console.warn('[push] VAPID keys missing — push disabled');
    _webpush = null;
    return null;
  }

  try {
    _webpush.setVapidDetails(email, pub, priv);
  } catch (err) {
    console.error('[push] VAPID config error:', err, `| pubLen=${pub.length} privLen=${priv.length} email=${email}`);
    _webpush = null;
    return null;
  }

  return _webpush;
}

export async function sendPushToUser(
  userId: string,
  payload: { title: string; body?: string; url?: string },
): Promise<{ sent: boolean; error?: string }> {
  const wp = await getWebPush();
  if (!wp) return { sent: false, error: 'VAPID not configured' };

  const { data: sub } = await supabase
    .from('push_subscriptions')
    .select('subscription')
    .eq('user_id', userId)
    .single();

  if (!sub) return { sent: false, error: 'No subscription' };

  try {
    await wp.sendNotification(sub.subscription, JSON.stringify(payload));
    return { sent: true };
  } catch (err: unknown) {
    const pushErr = err as { statusCode?: number; message?: string };
    if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
      await supabase.from('push_subscriptions').delete().eq('user_id', userId);
      return { sent: false, error: 'Subscription expired' };
    }
    console.error('[push] sendPushToUser error:', pushErr);
    return { sent: false, error: pushErr.message || 'Push failed' };
  }
}
