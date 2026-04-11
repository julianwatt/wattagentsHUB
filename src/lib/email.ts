import { getSupabaseAdmin } from './supabase';

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
export async function sendTempPasswordEmail(
  to: string,
  name: string,
  username: string,
  tempPassword: string,
): Promise<boolean> {
  // ── 1. Primary: Supabase Auth invite ──────────────────────────────
  const admin = getSupabaseAdmin();
  if (admin) {
    try {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(to, {
        data: {
          name,
          username,
          temp_password: tempPassword,
          app: 'Watt Distributors',
        },
      });
      if (error) {
        console.error('[email] Supabase inviteUserByEmail error:', error.message, error);
        // If the user already exists in auth.users, fall back to createUser flow
        // (which will at least create / overwrite metadata) — but more importantly,
        // try Resend as the secondary path below.
      } else {
        console.log('[email] Supabase invite sent to', to, 'user id:', data?.user?.id);
        return true;
      }
    } catch (err) {
      console.error('[email] Supabase invite threw:', err);
    }
  } else {
    console.warn('[email] SUPABASE_SERVICE_ROLE_KEY not set — skipping Supabase invite path');
  }

  // ── 2. Fallback: Resend HTTP API ─────────────────────────────────
  return sendViaResend(to, name, username, tempPassword);
}

async function sendViaResend(
  to: string,
  name: string,
  username: string,
  tempPassword: string,
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY not set — no fallback email path available');
    return false;
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
      console.error('[email] Resend HTTP error:', res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('[email] Resend threw:', err);
    return false;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
