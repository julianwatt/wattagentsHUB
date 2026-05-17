/**
 * Block 11 — payfile publish-time notification helper.
 * ============================================================================
 *
 * Single entry point for the "your payfile is ready" push that fires when
 * a payfile transitions to PUBLISHED. Also enqueues a row in
 * payfile_change_notifications for the audit/inbox trail.
 *
 * Skip rules (per spec):
 *   - Same-total republish (|diff| = 0) → no push.
 *   - Owner has no language preference → fall back to 'es'.
 *
 * Server-side only.
 */

import { supabase } from '@/lib/supabase';
import { sendPushToUser } from '@/lib/push';

export interface NotifyPublishArgs {
  payfile_id: string;
  /** Total amount on the version we just published. */
  current_total: number;
  /** Total on the previous published version, NULL if this is v1. */
  prior_total: number | null;
}

export interface NotifyPublishResult {
  enqueued: boolean;
  push_sent: boolean;
  skipped_reason?: string;
}

const PUSH_STRINGS = {
  es: {
    titleFirst: 'Tu primer payfile fue publicado',
    titleUpdate: 'Tu payfile fue actualizado',
    body: (total: number) => `Total: $${total.toFixed(2)}. Revisa Mis Pagos.`,
  },
  en: {
    titleFirst: 'Your first payfile is ready',
    titleUpdate: 'Your payfile was updated',
    body: (total: number) => `Total: $${total.toFixed(2)}. Check My Payments.`,
  },
};

export async function notifyPayfilePublished(args: NotifyPublishArgs): Promise<NotifyPublishResult> {
  // Zero-delta republish never bothers the recipient.
  if (args.prior_total !== null && args.prior_total === args.current_total) {
    return { enqueued: false, push_sent: false, skipped_reason: 'zero_delta_republish' };
  }

  const { data: payfile } = await supabase
    .from('payfiles')
    .select('id, user_id, pay_week')
    .eq('id', args.payfile_id)
    .maybeSingle();
  if (!payfile) return { enqueued: false, push_sent: false, skipped_reason: 'payfile_not_found' };
  const userId = (payfile as { user_id: string }).user_id;

  const { data: user } = await supabase
    .from('users')
    .select('language')
    .eq('id', userId)
    .maybeSingle();
  const lang = ((user as { language?: string } | null)?.language === 'en' ? 'en' : 'es') as 'es' | 'en';
  const s = PUSH_STRINGS[lang];

  // 1. Enqueue notification row (the inbox audit trail).
  await supabase
    .from('payfile_change_notifications')
    .insert({
      payfile_id: args.payfile_id,
      user_id: userId,
      // sent_at stays NULL until the push call below succeeds.
    });

  // 2. Send push. The web-push helper handles missing-subscription /
  //    expired-subscription cases internally.
  const title = args.prior_total === null ? s.titleFirst : s.titleUpdate;
  const body = s.body(args.current_total);
  const url = '/payroll/me'; // block 12 will own this route; harmless 404 today.
  const sendResult = await sendPushToUser(userId, { title, body, url }, 'payfile_published');

  // 3. Mark the notification row sent (best effort).
  if (sendResult.sent) {
    await supabase
      .from('payfile_change_notifications')
      .update({ sent_at: new Date().toISOString() })
      .eq('payfile_id', args.payfile_id)
      .eq('user_id', userId)
      .is('sent_at', null);
  }

  return {
    enqueued: true,
    push_sent: sendResult.sent,
    skipped_reason: sendResult.sent ? undefined : sendResult.error,
  };
}
