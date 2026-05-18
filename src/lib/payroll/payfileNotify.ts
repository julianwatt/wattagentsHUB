/**
 * Block 11 — payfile publish-time notification helper.
 * Block 15 — refactored to route through the central dispatcher
 * (src/lib/payroll/notifications.ts). The in-app inbox row lands in
 * user_notifications; the push side is enqueued in
 * payroll_notification_queue.
 *
 * Skip rules (unchanged):
 *   - Same-total republish (|diff| = 0) → no notification.
 *
 * Server-side only.
 */

import { supabase } from '@/lib/supabase';
import { dispatchPayrollNotification, PAYROLL_NOTIFICATION_TYPES } from '@/lib/payroll/notifications';

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

export async function notifyPayfilePublished(args: NotifyPublishArgs): Promise<NotifyPublishResult> {
  // Zero-delta republish never bothers the recipient.
  if (args.prior_total !== null && args.prior_total === args.current_total) {
    return { enqueued: false, push_sent: false, skipped_reason: 'zero_delta_republish' };
  }

  const { data: payfile } = await supabase
    .from('payfiles')
    .select('id, user_id, pay_week, total_amount')
    .eq('id', args.payfile_id)
    .maybeSingle();
  if (!payfile) return { enqueued: false, push_sent: false, skipped_reason: 'payfile_not_found' };

  const userId = (payfile as { user_id: string }).user_id;
  const payWeek = (payfile as { pay_week: string }).pay_week;

  const type = args.prior_total === null
    ? PAYROLL_NOTIFICATION_TYPES.PAYFILE_FIRST_PUBLISHED
    : PAYROLL_NOTIFICATION_TYPES.PAYFILE_UPDATED;

  const result = await dispatchPayrollNotification({
    type,
    recipient_user_id: userId,
    payload: {
      payfile_id: args.payfile_id,
      pay_week: payWeek,
      current_total: args.current_total,
      prior_total: args.prior_total,
    },
    // push goes through the async queue; the worker route drains it.
    channels: ['inapp', 'push'],
  });

  return {
    enqueued: !!result.inbox_id,
    push_sent: result.queued_for_push, // queued; the worker actually sends
    skipped_reason: result.skipped_reason,
  };
}
