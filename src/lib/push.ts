import webpush from 'web-push';
import { supabase } from '@/lib/supabase';

/** Normalize a Base64 key to URL-safe, no-padding format */
function normalizeKey(raw: string | undefined): string {
  if (!raw) return '';
  return raw.trim().replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const VAPID_PUBLIC = normalizeKey(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
const VAPID_PRIVATE = normalizeKey(process.env.VAPID_PRIVATE_KEY);
const VAPID_EMAIL = (() => {
  const e = (process.env.VAPID_CONTACT_EMAIL || 'mailto:admin@wattdistributors.com').trim();
  return e.startsWith('mailto:') || e.startsWith('https:') ? e : `mailto:${e}`;
})();

let configured = false;
function ensureVapid() {
  if (configured) return true;
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    console.warn('[push] VAPID keys missing — push disabled');
    return false;
  }
  try {
    webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
    configured = true;
    return true;
  } catch (err) {
    console.error('[push] VAPID config error:', err, `| pubLen=${VAPID_PUBLIC.length} privLen=${VAPID_PRIVATE.length} email=${VAPID_EMAIL}`);
    return false;
  }
}

/**
 * Send a push notification to a user. Safe to call even if the user
 * has no subscription — it just returns { sent: false }.
 */
export async function sendPushToUser(
  userId: string,
  payload: { title: string; body?: string; url?: string },
): Promise<{ sent: boolean; error?: string }> {
  if (!ensureVapid()) return { sent: false, error: 'VAPID not configured' };

  const { data: sub } = await supabase
    .from('push_subscriptions')
    .select('subscription')
    .eq('user_id', userId)
    .single();

  if (!sub) return { sent: false, error: 'No subscription' };

  try {
    await webpush.sendNotification(sub.subscription, JSON.stringify(payload));
    return { sent: true };
  } catch (err: unknown) {
    const pushErr = err as { statusCode?: number; message?: string };
    // Subscription expired — clean up silently
    if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
      await supabase.from('push_subscriptions').delete().eq('user_id', userId);
      return { sent: false, error: 'Subscription expired' };
    }
    console.error('[push] sendPushToUser error:', pushErr);
    return { sent: false, error: pushErr.message || 'Push failed' };
  }
}
