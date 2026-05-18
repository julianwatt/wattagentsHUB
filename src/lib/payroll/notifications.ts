/**
 * Block 15 — centralized payroll notification dispatcher.
 * ============================================================================
 *
 * Single entry point for every payroll-side notification. Resolves the
 * subject line + body in the recipient's language, writes the in-app row
 * synchronously (so the UI / bell updates immediately), and enqueues the
 * push side for async processing via /api/payroll/notifications/process.
 *
 * Inbox routing:
 *   - admin/CEO inbox alerts  → public.admin_notifications
 *   - per-user notifications  → public.user_notifications
 *
 * Push queue (block 15 migration):
 *   - public.payroll_notification_queue with bounded retries.
 *
 * Server-side only. Errors are swallowed where reasonable — payroll
 * flows must NEVER fail because a notification couldn't dispatch.
 */

import { supabase } from '@/lib/supabase';
import type { UserRole } from '@/lib/supabase';

// ── Type catalog ─────────────────────────────────────────────────────────────

export const PAYROLL_NOTIFICATION_TYPES = {
  // Per-recipient (user_notifications)
  PAYFILE_FIRST_PUBLISHED: 'payfile_first_published',
  PAYFILE_UPDATED: 'payfile_updated',
  WEEK_READY_FOR_APPROVAL: 'payroll_week_ready_for_approval',
  ITEMS_OVER_3X_PENDING: 'payroll_items_over_3x_pending',
  LARGE_CHANGE_REPUBLISH_PENDING: 'payroll_large_change_republish',
  // Admin/CEO inbox (admin_notifications)
  ORPHAN_BADGE_DETECTED: 'payroll_orphan_badges_detected',
  UNMAPPED_PLAN_DETECTED: 'payroll_unmapped_plans_detected',
  FILE_PROCESSED_WITH_ERRORS: 'payroll_file_processed_with_errors',
  WEEK_REJECTED_BY_CEO: 'payroll_week_rejected_by_ceo',
  USER_REACTIVATED_WITH_DEBT: 'payroll_balance_reactivated',
} as const;

export type PayrollNotificationType =
  (typeof PAYROLL_NOTIFICATION_TYPES)[keyof typeof PAYROLL_NOTIFICATION_TYPES];

/** Which inbox table a given type lives in. */
const ADMIN_INBOX_TYPES = new Set<PayrollNotificationType>([
  PAYROLL_NOTIFICATION_TYPES.ORPHAN_BADGE_DETECTED,
  PAYROLL_NOTIFICATION_TYPES.UNMAPPED_PLAN_DETECTED,
  PAYROLL_NOTIFICATION_TYPES.FILE_PROCESSED_WITH_ERRORS,
  PAYROLL_NOTIFICATION_TYPES.WEEK_REJECTED_BY_CEO,
  PAYROLL_NOTIFICATION_TYPES.USER_REACTIVATED_WITH_DEBT,
]);

export type Lang = 'es' | 'en';

// ── Message catalog (resolved at dispatch time, recipient's lang) ─────────────

interface MessageContent { title: string; body: string; url?: string }

type PayloadByType = Record<string, unknown>;

function fmtMoney(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '$0.00';
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const COPY: Record<PayrollNotificationType, (p: PayloadByType, lang: Lang) => MessageContent> = {
  [PAYROLL_NOTIFICATION_TYPES.PAYFILE_FIRST_PUBLISHED]: (p, lang) => ({
    title: lang === 'es' ? 'Tu primer payfile fue publicado' : 'Your first payfile is published',
    body: lang === 'es'
      ? `Tu payfile de la semana ${p.pay_week} está listo. Revísalo en Mis Pagos.`
      : `Your payfile for week ${p.pay_week} is ready. Open My Pay to review it.`,
    url: `/my-pay?week=${p.pay_week ?? ''}`,
  }),

  [PAYROLL_NOTIFICATION_TYPES.PAYFILE_UPDATED]: (p, lang) => ({
    title: lang === 'es' ? 'Tu payfile fue actualizado' : 'Your payfile was updated',
    body: lang === 'es'
      ? `Tu payfile de la semana ${p.pay_week} cambió. Revisa Mis Pagos.`
      : `Your payfile for week ${p.pay_week} was updated. Check My Pay.`,
    url: `/my-pay?week=${p.pay_week ?? ''}`,
  }),

  [PAYROLL_NOTIFICATION_TYPES.WEEK_READY_FOR_APPROVAL]: (p, lang) => ({
    title: lang === 'es' ? 'Semana lista para tu aprobación' : 'Week ready for your approval',
    body: lang === 'es'
      ? `La semana ${p.pay_week} está lista para tu aprobación.`
      : `Week ${p.pay_week} is ready for your approval.`,
    url: `/payroll/approval?week=${p.pay_week ?? ''}`,
  }),

  [PAYROLL_NOTIFICATION_TYPES.ITEMS_OVER_3X_PENDING]: (p, lang) => ({
    title: lang === 'es' ? 'Ajustes >3× pendientes' : 'Items over 3× pending',
    body: lang === 'es'
      ? `Hay ${p.count} ajuste(s) que superan 3× pendientes de tu aprobación.`
      : `There are ${p.count} item(s) over 3× pending your approval.`,
    url: `/payroll/approval?week=${p.pay_week ?? ''}&filter=over-3x`,
  }),

  [PAYROLL_NOTIFICATION_TYPES.LARGE_CHANGE_REPUBLISH_PENDING]: (p, lang) => ({
    title: lang === 'es' ? 'Republicación grande requiere aprobación' : 'Large republish needs approval',
    body: lang === 'es'
      ? `La semana ${p.pay_week} cambió ${fmtMoney(p.abs_diff)} (>${fmtMoney(p.threshold)}). Requiere tu aprobación.`
      : `Week ${p.pay_week} changed by ${fmtMoney(p.abs_diff)} (>${fmtMoney(p.threshold)}). Needs your approval.`,
    url: `/payroll/approval?week=${p.pay_week ?? ''}`,
  }),

  [PAYROLL_NOTIFICATION_TYPES.ORPHAN_BADGE_DETECTED]: (p, lang) => ({
    title: lang === 'es' ? 'Badge(s) JE huérfano(s)' : 'Orphan JE badge(s)',
    body: lang === 'es'
      ? `Se detectaron ${p.count} badge(s) JE no registrados en ${p.file_name ?? 'el archivo'}.`
      : `${p.count} unregistered JE badge(s) found in ${p.file_name ?? 'the file'}.`,
    url: '/payroll?tab=roster',
  }),

  [PAYROLL_NOTIFICATION_TYPES.UNMAPPED_PLAN_DETECTED]: (p, lang) => ({
    title: lang === 'es' ? 'Planes pendientes de mapeo' : 'Plans pending mapping',
    body: lang === 'es'
      ? `${p.count} fila(s) pendiente(s) de mapeo de plan.`
      : `${p.count} row(s) pending plan mapping.`,
    url: '/payroll?tab=plan_mapping',
  }),

  [PAYROLL_NOTIFICATION_TYPES.FILE_PROCESSED_WITH_ERRORS]: (p, lang) => ({
    title: lang === 'es' ? 'Archivo procesado con errores' : 'File processed with errors',
    body: lang === 'es'
      ? `El archivo ${p.file_name ?? '(sin nombre)'} se procesó con ${p.error_count} error(es).`
      : `File ${p.file_name ?? '(unnamed)'} processed with ${p.error_count} error(s).`,
    url: '/payroll?tab=pendientes',
  }),

  [PAYROLL_NOTIFICATION_TYPES.WEEK_REJECTED_BY_CEO]: (p, lang) => ({
    title: lang === 'es' ? 'Semana rechazada por CEO' : 'Week rejected by CEO',
    body: lang === 'es'
      ? `La semana ${p.pay_week} fue rechazada por el CEO. Notas: "${p.notes ?? ''}".`
      : `Week ${p.pay_week} was rejected by the CEO. Notes: "${p.notes ?? ''}".`,
    url: `/payroll?tab=aprobacion&week=${p.pay_week ?? ''}`,
  }),

  [PAYROLL_NOTIFICATION_TYPES.USER_REACTIVATED_WITH_DEBT]: (p, lang) => ({
    title: lang === 'es' ? 'Usuario reactivado con saldo' : 'User reactivated with debt',
    body: lang === 'es'
      ? `${p.user_name ?? 'Un usuario'} fue reactivado y tiene saldo pendiente de ${fmtMoney(p.remaining)}.`
      : `${p.user_name ?? 'A user'} was reactivated and has a pending balance of ${fmtMoney(p.remaining)}.`,
    url: `/payroll?tab=saldos_negativos&user=${p.user_id ?? ''}`,
  }),
};

// ── Public API ───────────────────────────────────────────────────────────────

export interface DispatchArgs {
  type: PayrollNotificationType;
  /** Required for per-user types (PAYFILE_*, WEEK_READY_FOR_APPROVAL, etc).
   *  Omitted/null means "admin/CEO inbox" — admin_notifications row only,
   *  no push enqueued. */
  recipient_user_id?: string | null;
  payload: PayloadByType;
  /** Default ['inapp','push']. Pass ['inapp'] to skip push. */
  channels?: Array<'inapp' | 'push'>;
}

export interface DispatchResult {
  inbox_id?: string;
  queued_for_push: boolean;
  skipped_reason?: string;
}

/**
 * Dispatch a payroll notification.
 *
 * Never throws — payroll mutations must not be blocked by notification
 * failures. Errors are logged and surfaced in the returned `skipped_reason`.
 */
export async function dispatchPayrollNotification(args: DispatchArgs): Promise<DispatchResult> {
  const channels = args.channels ?? ['inapp', 'push'];
  const wantInapp = channels.includes('inapp');
  const wantPush = channels.includes('push');

  // 1. Resolve recipient language. For admin-inbox types we don't have a
  //    single recipient; default to Spanish for the stored message. The
  //    UI can re-render with the actor's lang via the type/payload at
  //    render time if we ever need that.
  let lang: Lang = 'es';
  let recipientRole: UserRole | null = null;
  if (args.recipient_user_id) {
    const { data: user } = await supabase
      .from('users')
      .select('language, role')
      .eq('id', args.recipient_user_id)
      .maybeSingle();
    const u = user as { language?: string; role?: UserRole } | null;
    if (u?.language === 'en') lang = 'en';
    recipientRole = u?.role ?? null;
  }

  const resolver = COPY[args.type];
  if (!resolver) {
    console.warn(`[dispatchPayrollNotification] unknown type: ${args.type}`);
    return { queued_for_push: false, skipped_reason: 'unknown_type' };
  }
  const msg = resolver(args.payload, lang);

  // 2. Write inbox row.
  let inboxId: string | undefined;
  if (wantInapp) {
    try {
      if (ADMIN_INBOX_TYPES.has(args.type)) {
        const { data } = await supabase.from('admin_notifications').insert({
          type: args.type,
          user_id: args.payload.user_id ?? null,
          user_name: args.payload.user_name ?? null,
          user_username: args.payload.user_username ?? null,
          data: { ...args.payload, title: msg.title, body: msg.body, url: msg.url },
          status: 'pending',
        }).select('id').maybeSingle();
        inboxId = (data as { id?: string } | null)?.id;
      } else if (args.recipient_user_id) {
        const { data } = await supabase.from('user_notifications').insert({
          recipient_user_id: args.recipient_user_id,
          type: args.type,
          title: msg.title,
          body: msg.body,
          data: { ...args.payload, url: msg.url, recipient_role: recipientRole },
          status: 'pending',
        }).select('id').maybeSingle();
        inboxId = (data as { id?: string } | null)?.id;
      }
    } catch (err) {
      console.error('[dispatchPayrollNotification] inbox insert failed:', err);
    }
  }

  // 3. Enqueue push (only for per-user types — we don't push admin alerts).
  let queuedForPush = false;
  if (wantPush && args.recipient_user_id) {
    try {
      await supabase.from('payroll_notification_queue').insert({
        notification_type: args.type,
        recipient_user_id: args.recipient_user_id,
        payload: { title: msg.title, body: msg.body, url: msg.url, ...args.payload },
        status: 'pending',
      });
      queuedForPush = true;
    } catch (err) {
      console.error('[dispatchPayrollNotification] queue insert failed:', err);
    }
  }

  return { inbox_id: inboxId, queued_for_push: queuedForPush };
}

/**
 * Process up to `limit` pending push rows. Called by
 * /api/payroll/notifications/process (manual trigger or cron). Returns a
 * summary so the caller can decide whether to loop.
 *
 * Retry policy:
 *   - Transient push errors (5xx, ETIMEDOUT, ECONNRESET) → bump attempts,
 *     re-schedule with exponential backoff, stay 'pending' if attempts <
 *     max_attempts; flip to 'failed' otherwise.
 *   - Hard errors (410/404 sub expired, 401/403 auth) → flip to 'failed'
 *     immediately. The push helper already cleans up expired subs.
 *   - Success → 'sent' + processed_at.
 */
export async function processPendingNotifications(limit = 25): Promise<{
  processed: number; sent: number; retried: number; failed: number;
}> {
  const { sendPushToUser } = await import('@/lib/push');

  const { data: pending } = await supabase
    .from('payroll_notification_queue')
    .select('id, notification_type, recipient_user_id, payload, attempts, max_attempts')
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(limit);

  if (!pending || pending.length === 0) {
    return { processed: 0, sent: 0, retried: 0, failed: 0 };
  }

  let sent = 0;
  let retried = 0;
  let failed = 0;

  for (const row of pending as Array<{
    id: string;
    notification_type: string;
    recipient_user_id: string;
    payload: { title?: string; body?: string; url?: string };
    attempts: number;
    max_attempts: number;
  }>) {
    const result = await sendPushToUser(
      row.recipient_user_id,
      {
        title: row.payload.title ?? 'Watt Distributors',
        body: row.payload.body ?? '',
        url: row.payload.url,
      },
      row.notification_type,
    );

    if (result.sent) {
      await supabase
        .from('payroll_notification_queue')
        .update({ status: 'sent', processed_at: new Date().toISOString() })
        .eq('id', row.id);
      sent += 1;
      continue;
    }

    // Decide retry vs hard fail. The push helper's error string is our
    // only signal — match on the known sentinels.
    const err = result.error ?? 'unknown';
    const isHardFail =
      err === 'No subscription' ||
      err === 'Subscription expired' ||
      err === 'VAPID not configured' ||
      err.toLowerCase().includes('auth');

    const nextAttempt = row.attempts + 1;
    if (!isHardFail && nextAttempt < row.max_attempts) {
      // Exponential backoff: 1m → 5m → 25m
      const backoffMs = Math.pow(5, nextAttempt) * 60 * 1000;
      const nextRun = new Date(Date.now() + backoffMs).toISOString();
      await supabase
        .from('payroll_notification_queue')
        .update({
          attempts: nextAttempt,
          scheduled_for: nextRun,
          last_error: err.slice(0, 500),
        })
        .eq('id', row.id);
      retried += 1;
    } else {
      await supabase
        .from('payroll_notification_queue')
        .update({
          status: 'failed',
          attempts: nextAttempt,
          processed_at: new Date().toISOString(),
          last_error: err.slice(0, 500),
        })
        .eq('id', row.id);
      failed += 1;
    }
  }

  return { processed: pending.length, sent, retried, failed };
}
