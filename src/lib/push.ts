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

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

function isTransientError(err: unknown): boolean {
  const e = err as { statusCode?: number; code?: string };
  if (e.code === 'ETIMEDOUT' || e.code === 'ECONNRESET' || e.code === 'ENOTFOUND') return true;
  if (e.statusCode && e.statusCode >= 500) return true;
  return false;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function sendPushToUser(
  userId: string,
  payload: { title: string; body?: string; url?: string },
  notifType?: string,
): Promise<{ sent: boolean; error?: string }> {
  const tag = `[push] user=${userId} type=${notifType ?? 'unknown'}`;
  const wp = await getWebPush();
  if (!wp) {
    console.warn(`${tag} VAPID not configured — skipped`);
    return { sent: false, error: 'VAPID not configured' };
  }

  const { data: sub } = await supabase
    .from('push_subscriptions')
    .select('subscription')
    .eq('user_id', userId)
    .single();

  if (!sub) {
    console.info(`${tag} no subscription found`);
    return { sent: false, error: 'No subscription' };
  }

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      await wp.sendNotification(sub.subscription, JSON.stringify(payload));
      console.info(`${tag} sent OK (attempt ${attempt})`);
      return { sent: true };
    } catch (err: unknown) {
      const pushErr = err as { statusCode?: number; message?: string; code?: string };

      if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
        await supabase.from('push_subscriptions').delete().eq('user_id', userId);
        console.warn(`${tag} subscription expired (${pushErr.statusCode}) — deleted from DB`);
        return { sent: false, error: 'Subscription expired' };
      }

      if (pushErr.statusCode === 403 || pushErr.statusCode === 401) {
        console.error(`${tag} auth error (${pushErr.statusCode}): ${pushErr.message} — check VAPID keys`);
        return { sent: false, error: pushErr.message || 'Auth error' };
      }

      if (isTransientError(err) && attempt <= MAX_RETRIES) {
        console.warn(`${tag} transient error (attempt ${attempt}/${MAX_RETRIES + 1}): ${pushErr.code ?? pushErr.statusCode} — retrying`);
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }

      console.error(`${tag} FAILED after ${attempt} attempt(s): ${pushErr.message ?? pushErr.code}`);
      return { sent: false, error: pushErr.message || 'Push failed' };
    }
  }

  return { sent: false, error: 'Max retries exceeded' };
}
