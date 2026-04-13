import { getSupabaseAdmin } from './supabase';
import nodemailer from 'nodemailer';

/**
 * Sends a welcome / temporary-password email to a newly created user.
 *
 * Primary path: `supabase.auth.admin.inviteUserByEmail()` — uses the SMTP
 * configured in the Supabase dashboard. The temp_password / username are
 * passed via the invite `data` field so the Supabase email template can
 * render them with `{{ .Data.temp_password }}` and `{{ .Data.username }}`.
 *
 * Fallback path: Resend, if `RESEND_API_KEY` is set and the Supabase invite
 * fails or no service-role key is configured.
 *
 * Returns true if any path successfully sent the email.
 * All Supabase errors are logged to console.error so they can be diagnosed.
 */
export interface EmailSendResult {
  ok: boolean;
  path: 'supabase' | 'resend' | 'none';
  stage: string;
  detail?: string;
}

export async function sendTempPasswordEmail(
  to: string,
  name: string,
  username: string,
  tempPassword: string,
): Promise<boolean> {
  const r = await sendTempPasswordEmailDetailed(to, name, username, tempPassword);
  return r.ok;
}

export async function sendTempPasswordEmailDetailed(
  to: string,
  name: string,
  username: string,
  tempPassword: string,
): Promise<EmailSendResult> {
  // ── 1. Primary: Supabase Auth invite ──────────────────────────────
  const admin = getSupabaseAdmin();
  if (admin) {
    const inviteData = { name, username, temp_password: tempPassword, app: 'Watt Distributors' };
    const sent = await supabaseInviteWithRetry(admin, to, inviteData);
    if (sent) {
      return { ok: true, path: 'supabase', stage: 'supabase_invite_sent' };
    }
    console.warn('[email] Supabase invite path failed for new user, trying Resend');
    const fallback = await sendViaResendDetailed(to, name, username, tempPassword);
    return { ...fallback, stage: `supabase_invite_failed -> ${fallback.stage}` };
  }
  console.warn('[email] SUPABASE_SERVICE_ROLE_KEY not set — skipping Supabase invite path');

  // ── 2. Fallback: Resend HTTP API ─────────────────────────────────
  const fallback = await sendViaResendDetailed(to, name, username, tempPassword);
  return {
    ...fallback,
    stage: `no_supabase_admin -> ${fallback.stage}`,
  };
}

async function sendViaResend(
  to: string,
  name: string,
  username: string,
  tempPassword: string,
): Promise<boolean> {
  const r = await sendViaResendDetailed(to, name, username, tempPassword);
  return r.ok;
}

async function sendViaResendDetailed(
  to: string,
  name: string,
  username: string,
  tempPassword: string,
): Promise<EmailSendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY not set — no fallback email path available');
    return { ok: false, path: 'none', stage: 'resend_no_key' };
  }

  const from = process.env.RESEND_FROM || 'Watt Distributors <onboarding@resend.dev>';
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://watt.local';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; padding: 24px;">
      <div style="text-align: center; padding: 24px 0;">
        <span style="font-family: Georgia, serif; font-size: 48px; font-weight: 800; color: #c2994b;">W</span>
        <span style="font-family: Georgia, serif; font-size: 28px; font-weight: 700; color: #c2994b; margin-left: 8px;">WATT</span>
      </div>
      <h2 style="color: #1a1a1a;">Bienvenido, ${escapeHtml(name)}</h2>
      <p style="color: #555; line-height: 1.6;">Se ha creado tu cuenta en la plataforma de Watt Distributors. Estos son tus datos de acceso:</p>
      <div style="background: #f5f5f5; border-radius: 12px; padding: 16px 20px; margin: 16px 0;">
        ${username ? `<p style="margin: 4px 0;"><strong>Usuario:</strong> ${escapeHtml(username)}</p>` : ''}
        <p style="margin: 4px 0;"><strong>Contraseña temporal:</strong> <code style="background: #fff; padding: 2px 8px; border-radius: 4px; font-size: 16px;">${escapeHtml(tempPassword)}</code></p>
      </div>
      <p style="color: #555; line-height: 1.6;">Por seguridad, deberás cambiar esta contraseña la primera vez que inicies sesión.</p>
      <a href="${appUrl}/login" style="display: inline-block; background: #c2994b; color: #fff; padding: 12px 24px; border-radius: 12px; text-decoration: none; font-weight: bold; margin-top: 12px;">Iniciar sesión</a>
      <p style="color: #999; font-size: 12px; margin-top: 32px;">Si no esperabas este correo, puedes ignorarlo.</p>
    </div>
  `;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to,
        subject: 'Tu cuenta en Watt Distributors',
        html,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error('[email] Resend HTTP error:', res.status, body);
      return { ok: false, path: 'resend', stage: 'resend_http_error', detail: `${res.status}: ${body}` };
    }
    return { ok: true, path: 'resend', stage: 'resend_sent' };
  } catch (err) {
    console.error('[email] Resend threw:', err);
    return { ok: false, path: 'resend', stage: 'resend_threw', detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Sends a branded password-reset email with the new temp password.
 * Uses Resend directly (not Supabase invite) since this is a reset, not a new account.
 */
export async function sendPasswordResetEmail(
  to: string,
  name: string,
  username: string,
  tempPassword: string,
): Promise<boolean> {
  console.log('[email] sendPasswordResetEmail called', { to, name, username });

  // ── 1. Primary: Supabase Auth invite (uses Supabase's built-in SMTP) ──
  // The invite template must be customized in Supabase Dashboard > Auth > Email Templates
  // to render {{ .Data.temp_password }}, {{ .Data.username }}, etc.
  const admin = getSupabaseAdmin();
  if (admin) {
    const inviteData = { name, username, temp_password: tempPassword, app: 'Watt Distributors' };
    const sent = await supabaseInviteWithRetry(admin, to, inviteData);
    if (sent) return true;
    console.warn('[email] Supabase invite path failed, trying fallbacks');
  } else {
    console.warn('[email] No SUPABASE_SERVICE_ROLE_KEY — skipping Supabase path for reset');
  }

  // ── 2. Fallback: Nodemailer SMTP (Gmail / custom SMTP) ──
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASSWORD;
  if (smtpHost && smtpUser && smtpPass) {
    console.log('[email] SMTP credentials found, attempting SMTP send via', smtpHost);
    const sent = await sendResetViaSMTP(to, name, username, tempPassword);
    if (sent) return true;
    console.warn('[email] SMTP send failed, falling through to Resend');
  }

  // ── 3. Fallback: Resend HTTP API ──
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY not set — no more email paths available');
    console.warn('[email] Available email env keys:', Object.keys(process.env).filter(k => k.includes('SMTP') || k.includes('RESEND') || k.includes('EMAIL') || k.includes('MAIL')).join(', ') || '(none)');
    return false;
  }

  const from = process.env.RESEND_FROM || 'Watt Distributors <onboarding@resend.dev>';
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://watt.local';
  const html = buildResetEmailHtml(name, username, tempPassword, appUrl);

  try {
    console.log('[email] Sending reset email via Resend to', to, 'from', from);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject: 'Contraseña restablecida · Password Reset — Watt Distributors', html }),
    });
    const body = await res.text();
    if (!res.ok) {
      console.error('[email] Resend reset email error:', res.status, body);
      return false;
    }
    console.log('[email] Resend reset email sent successfully:', res.status, body);
    return true;
  } catch (err) {
    console.error('[email] Resend reset email threw:', err);
    return false;
  }
}

/**
 * Tries inviteUserByEmail. If the user already exists in auth.users,
 * deletes them first and re-invites so the email is always sent.
 */
async function supabaseInviteWithRetry(
  admin: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  email: string,
  data: Record<string, string>,
): Promise<boolean> {
  try {
    console.log('[email] Attempting Supabase invite to', email);
    const { data: inviteResult, error } = await admin.auth.admin.inviteUserByEmail(email, { data });
    if (!error) {
      console.log('[email] Supabase invite sent to', email, 'user id:', inviteResult?.user?.id);
      return true;
    }

    console.warn('[email] Supabase invite error:', error.message);

    // User already exists in auth.users — delete and re-invite
    if (error.message?.includes('already') || error.status === 422) {
      console.log('[email] User exists in auth.users, deleting to re-invite');
      const { data: { users } } = await admin.auth.admin.listUsers();
      const existing = users.find((u) => u.email === email);
      if (existing) {
        await admin.auth.admin.deleteUser(existing.id);
        console.log('[email] Deleted auth.users entry', existing.id, 'for', email);
      }
      // Re-invite
      const { data: retryResult, error: retryError } = await admin.auth.admin.inviteUserByEmail(email, { data });
      if (retryError) {
        console.error('[email] Re-invite failed:', retryError.message);
        return false;
      }
      console.log('[email] Re-invite sent to', email, 'user id:', retryResult?.user?.id);
      return true;
    }

    return false;
  } catch (err) {
    console.error('[email] supabaseInviteWithRetry threw:', err);
    return false;
  }
}

async function sendResetViaSMTP(
  to: string,
  name: string,
  username: string,
  tempPassword: string,
): Promise<boolean> {
  const host = process.env.SMTP_HOST!;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER!;
  const pass = process.env.SMTP_PASSWORD!;
  const from = process.env.SMTP_FROM || `Watt Distributors <${user}>`;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://watt.local';

  const html = buildResetEmailHtml(name, username, tempPassword, appUrl);

  try {
    const transport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
    const info = await transport.sendMail({
      from,
      to,
      subject: 'Contraseña restablecida · Password Reset — Watt Distributors',
      html,
    });
    console.log('[email] SMTP send success:', info.messageId, info.response);
    return true;
  } catch (err) {
    console.error('[email] SMTP send failed:', err);
    return false;
  }
}

function buildResetEmailHtml(name: string, username: string, tempPassword: string, appUrl: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f4f1ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f4f1ea;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.06);overflow:hidden;">
  <tr><td style="background:#c2994b;height:6px;line-height:6px;font-size:0;">&nbsp;</td></tr>
  <tr><td align="center" style="padding:48px 24px 12px;background:#ffffff;">
    <span style="font-family:Georgia,serif;font-size:42px;font-weight:800;color:#c2994b;letter-spacing:14px;">WATT</span>
  </td></tr>
  <tr><td align="center" style="padding:0 24px 32px;">
    <div style="font-size:11px;color:#9a7a3a;letter-spacing:5px;text-transform:uppercase;font-weight:600;">Distributors</div>
  </td></tr>
  <tr><td style="padding:0 44px 4px;" align="center">
    <h1 style="margin:0;font-size:24px;font-weight:800;color:#1a1a1a;line-height:1.3;">Contraseña restablecida</h1>
    <p style="margin:8px 0 0;font-size:15px;color:#6b7280;font-weight:500;">Password Reset</p>
  </td></tr>
  <tr><td style="padding:28px 44px 0;">
    <div style="height:1px;background:#e5e1d6;"></div>
  </td></tr>
  <tr><td style="padding:28px 44px 0;">
    <p style="margin:0;font-size:16px;color:#1f2937;line-height:1.6;">Hola <strong>${escapeHtml(name)}</strong>,</p>
    <p style="margin:12px 0 0;font-size:15px;color:#4b5563;line-height:1.6;">Tu contraseña ha sido restablecida por el administrador. Usa las siguientes credenciales para iniciar sesión:</p>
    <p style="margin:4px 0 0;font-size:14px;color:#6b7280;">Your password has been reset by the administrator. Use the following credentials to log in:</p>
  </td></tr>
  <tr><td style="padding:24px 44px 8px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fbf8f1;border:1px solid #ead9b5;border-left:5px solid #c2994b;border-radius:12px;">
    <tr><td style="padding:24px 28px;">
      <div style="font-size:11px;color:#9a7a3a;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;margin-bottom:8px;">Usuario · Username</div>
      <div style="font-size:17px;color:#1a1a1a;font-family:monospace;margin-bottom:22px;font-weight:600;">${escapeHtml(username)}</div>
      <div style="font-size:11px;color:#9a7a3a;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;margin-bottom:8px;">Contraseña temporal · Temporary password</div>
      <div style="font-size:24px;color:#1a1a1a;font-family:monospace;font-weight:800;letter-spacing:2px;background:#ffffff;border:1px dashed #c2994b;border-radius:8px;padding:12px 16px;display:inline-block;">${escapeHtml(tempPassword)}</div>
    </td></tr>
    </table>
  </td></tr>
  <tr><td align="center" style="padding:24px 44px 8px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center" style="background:#c2994b;border-radius:12px;box-shadow:0 4px 12px rgba(194,153,75,0.3);">
      <a href="${appUrl}/login" target="_blank" style="display:inline-block;padding:16px 44px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;">Iniciar sesión · Sign In</a>
    </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:32px 44px 0;">
    <div style="border-top:1px solid #e5e1d6;padding-top:24px;">
      <p style="margin:0;font-size:14px;color:#4b5563;line-height:1.6;"><strong>Importante:</strong> deberás cambiar tu contraseña al iniciar sesión.</p>
      <p style="margin:6px 0 0;font-size:13px;color:#6b7280;"><strong>Important:</strong> you must change your password on your first login.</p>
    </div>
  </td></tr>
  <tr><td style="padding:0;line-height:32px;font-size:0;">&nbsp;</td></tr>
  <tr><td style="padding:36px 44px 40px;background:#fbf8f1;" align="center">
    <div style="font-family:Georgia,serif;font-size:15px;color:#c2994b;font-weight:800;letter-spacing:3px;">WATT DISTRIBUTORS</div>
    <p style="margin:12px 0 0;font-size:11px;color:#9ca3af;">Si no solicitaste este cambio, contacta al administrador.<br/>If you didn't request this change, contact your administrator.</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
