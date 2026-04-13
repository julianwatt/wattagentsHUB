const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://wattagenthub.vercel.app';

export interface EmailSendResult {
  ok: boolean;
  path: 'resend' | 'none';
  stage: string;
  detail?: string;
}

// ── Public API ──

export async function sendTempPasswordEmail(
  to: string, name: string, username: string, tempPassword: string,
): Promise<boolean> {
  const r = await sendTempPasswordEmailDetailed(to, name, username, tempPassword);
  return r.ok;
}

export async function sendTempPasswordEmailDetailed(
  to: string, name: string, username: string, tempPassword: string,
): Promise<EmailSendResult> {
  const html = buildWelcomeEmailHtml(name, username, tempPassword);
  return sendViaResend(to, 'Tu cuenta en Watt Distributors · Your Watt Distributors Account', html);
}

export async function sendPasswordResetEmail(
  to: string, name: string, username: string, tempPassword: string,
): Promise<boolean> {
  const html = buildResetEmailHtml(name, username, tempPassword);
  const r = await sendViaResend(to, 'Contraseña restablecida · Password Reset — Watt Distributors', html);
  return r.ok;
}

// ── Resend sender (single path, branded HTML always) ──

async function sendViaResend(to: string, subject: string, html: string): Promise<EmailSendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('[email] RESEND_API_KEY not set');
    return { ok: false, path: 'none', stage: 'resend_no_key' };
  }

  const from = process.env.RESEND_FROM || 'Watt Distributors <onboarding@resend.dev>';

  try {
    console.log('[email] Sending via Resend to', to);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html }),
    });
    const body = await res.text();
    if (!res.ok) {
      console.error('[email] Resend error:', res.status, body);
      return { ok: false, path: 'resend', stage: 'resend_http_error', detail: `${res.status}: ${body}` };
    }
    console.log('[email] Resend sent:', res.status, body);
    return { ok: true, path: 'resend', stage: 'resend_sent' };
  } catch (err) {
    console.error('[email] Resend threw:', err);
    return { ok: false, path: 'resend', stage: 'resend_threw', detail: err instanceof Error ? err.message : String(err) };
  }
}

// ── HTML Templates ──

function buildWelcomeEmailHtml(name: string, username: string, tempPassword: string): string {
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
    <h1 style="margin:0;font-size:24px;font-weight:800;color:#1a1a1a;line-height:1.3;">¡Bienvenido al equipo!</h1>
    <p style="margin:8px 0 0;font-size:15px;color:#6b7280;font-weight:500;">Welcome to the team!</p>
  </td></tr>
  <tr><td style="padding:28px 44px 0;">
    <div style="height:1px;background:#e5e1d6;"></div>
  </td></tr>
  <tr><td style="padding:28px 44px 0;">
    <p style="margin:0;font-size:16px;color:#1f2937;line-height:1.6;">Hola <strong>${escapeHtml(name)}</strong>,</p>
    <p style="margin:12px 0 0;font-size:15px;color:#4b5563;line-height:1.6;">Se ha creado tu cuenta en Watt Distributors. Usa las siguientes credenciales para iniciar sesión:</p>
    <p style="margin:4px 0 0;font-size:14px;color:#6b7280;">Your Watt Distributors account has been created. Use the following credentials to log in:</p>
  </td></tr>
  ${credentialsBlock(username, tempPassword)}
  <tr><td align="center" style="padding:24px 44px 8px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center" style="background:#c2994b;border-radius:12px;box-shadow:0 4px 12px rgba(194,153,75,0.3);">
      <a href="${APP_URL}/login" target="_blank" style="display:inline-block;padding:16px 44px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;">Activar mi cuenta · Activate Account</a>
    </td></tr>
    </table>
  </td></tr>
  ${footerBlock('Si no esperabas este correo, contacta al administrador.', "If you didn't expect this email, contact your administrator.")}
</table>
</td></tr></table>
</body></html>`;
}

function buildResetEmailHtml(name: string, username: string, tempPassword: string): string {
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
  ${credentialsBlock(username, tempPassword)}
  <tr><td align="center" style="padding:24px 44px 8px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center" style="background:#c2994b;border-radius:12px;box-shadow:0 4px 12px rgba(194,153,75,0.3);">
      <a href="${APP_URL}/login" target="_blank" style="display:inline-block;padding:16px 44px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;">Iniciar sesión · Sign In</a>
    </td></tr>
    </table>
  </td></tr>
  ${footerBlock('Si no solicitaste este cambio, contacta al administrador.', "If you didn't request this change, contact your administrator.")}
</table>
</td></tr></table>
</body></html>`;
}

// ── Shared HTML fragments ──

function credentialsBlock(username: string, tempPassword: string): string {
  return `<tr><td style="padding:24px 44px 8px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fbf8f1;border:1px solid #ead9b5;border-left:5px solid #c2994b;border-radius:12px;">
    <tr><td style="padding:24px 28px;">
      <div style="font-size:11px;color:#9a7a3a;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;margin-bottom:8px;">Usuario · Username</div>
      <div style="font-size:17px;color:#1a1a1a;font-family:monospace;margin-bottom:22px;font-weight:600;">${escapeHtml(username)}</div>
      <div style="font-size:11px;color:#9a7a3a;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;margin-bottom:8px;">Contraseña temporal · Temporary password</div>
      <div style="font-size:24px;color:#1a1a1a;font-family:monospace;font-weight:800;letter-spacing:2px;background:#ffffff;border:1px dashed #c2994b;border-radius:8px;padding:12px 16px;display:inline-block;">${escapeHtml(tempPassword)}</div>
    </td></tr>
    </table>
  </td></tr>`;
}

function footerBlock(esNote: string, enNote: string): string {
  return `<tr><td style="padding:32px 44px 0;">
    <div style="border-top:1px solid #e5e1d6;padding-top:24px;">
      <p style="margin:0;font-size:14px;color:#4b5563;line-height:1.6;"><strong>Importante:</strong> deberás cambiar tu contraseña al iniciar sesión.</p>
      <p style="margin:6px 0 0;font-size:13px;color:#6b7280;"><strong>Important:</strong> you must change your password on your first login.</p>
    </div>
  </td></tr>
  <tr><td style="padding:0;line-height:32px;font-size:0;">&nbsp;</td></tr>
  <tr><td style="padding:36px 44px 40px;background:#fbf8f1;" align="center">
    <div style="font-family:Georgia,serif;font-size:15px;color:#c2994b;font-weight:800;letter-spacing:3px;">WATT DISTRIBUTORS</div>
    <p style="margin:12px 0 0;font-size:11px;color:#9ca3af;">${esNote}<br/>${enNote}</p>
  </td></tr>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
