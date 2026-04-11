#!/usr/bin/env node
/**
 * Emergency admin password reset.
 *
 * Usage:
 *   node --env-file=.env.local scripts/reset-admin-password.mjs '<new-password>'
 *
 * Requires `SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_SUPABASE_URL` in the
 * environment (loaded from .env.local via --env-file on Node 20+).
 *
 * The script looks up the single user with role = 'admin', replaces their
 * password_hash with a fresh bcrypt hash of the supplied password, and sets
 * must_change_password = true so the admin is forced to pick a new password
 * on the next login.
 *
 * This is an out-of-band recovery tool — it bypasses the normal auth flow and
 * should only be run by someone with legitimate service-role access.
 */

import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';

const MIN_LENGTH = 6;
const BCRYPT_COST = 10;

function die(msg, code = 1) {
  console.error(`error: ${msg}`);
  process.exit(code);
}

const newPassword = process.argv[2];
if (!newPassword) {
  die(
    "missing password argument\n" +
      "usage: node --env-file=.env.local scripts/reset-admin-password.mjs '<new-password>'",
  );
}
if (newPassword.length < MIN_LENGTH) {
  die(`password must be at least ${MIN_LENGTH} characters`);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url) die('NEXT_PUBLIC_SUPABASE_URL is not set');
if (!serviceKey) {
  die(
    'SUPABASE_SERVICE_ROLE_KEY is not set — this script requires the service role key ' +
      'to bypass RLS. Load it via --env-file=.env.local or export it in your shell.',
  );
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: admin, error: findErr } = await supabase
  .from('users')
  .select('id, username, name')
  .eq('role', 'admin')
  .single();

if (findErr || !admin) {
  die(`could not find admin user: ${findErr?.message ?? 'no row returned'}`);
}

const password_hash = await bcrypt.hash(newPassword, BCRYPT_COST);

const { error: updateErr } = await supabase
  .from('users')
  .update({ password_hash, must_change_password: true })
  .eq('id', admin.id);

if (updateErr) {
  die(`failed to update password: ${updateErr.message}`);
}

console.log(
  `ok: password reset for admin '${admin.username}' (${admin.name}). ` +
    `must_change_password is set — you will be prompted to pick a new one on first login.`,
);
