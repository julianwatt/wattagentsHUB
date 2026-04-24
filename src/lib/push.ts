import webpush from 'web-push';
import { supabase } from '@/lib/supabase';

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.replace(/=+$/, '');
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY?.replace(/=+$/, '');
const VAPID_EMAIL = process.env.VAPID_CONTACT_EMAIL || 'mailto:admin@wattdistributors.com';

let configured = false;
function ensureVapid() {
  if (configured) return true;
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return false;
  try {
    webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
    configured = true;
    return true;
  } catch (err) {
    console.error('[push] VAPID configuration error:', err);
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
