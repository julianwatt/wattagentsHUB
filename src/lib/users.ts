import bcrypt from 'bcryptjs';
import { supabase, DbUser, UserRole } from './supabase';

export type { UserRole };

export interface PublicUser {
  id: string;
  username: string;
  name: string;
  email: string | null;
  role: UserRole;
  manager_id: string | null;
  must_change_password: boolean;
  is_active: boolean;
  hire_date: string;
  created_at: string;
}

const PUBLIC_FIELDS = 'id, username, name, email, role, manager_id, must_change_password, is_active, hire_date, created_at';

export async function getUsers(): Promise<PublicUser[]> {
  const { data, error } = await supabase
    .from('users')
    .select(PUBLIC_FIELDS)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as PublicUser[];
}

export async function getUserById(id: string): Promise<PublicUser | null> {
  const { data } = await supabase.from('users').select(PUBLIC_FIELDS).eq('id', id).single();
  return (data as PublicUser) ?? null;
}

export async function findByUsername(username: string): Promise<DbUser | null> {
  const { data } = await supabase
    .from('users')
    .select('*')
    .ilike('username', username)
    .eq('is_active', true)
    .single();
  return data ?? null;
}

export async function verifyPassword(user: DbUser, password: string): Promise<boolean> {
  return bcrypt.compare(password, user.password_hash);
}

/** Generates a memorable temp password like "Watt-A8K2" */
export function generateTempPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 4; i++) suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `Watt-${suffix}`;
}

export async function createUser(
  username: string,
  password: string,
  name: string,
  role: UserRole = 'agent',
  manager_id?: string | null,
  email?: string | null,
  must_change_password = false,
  hire_date?: string | null,
): Promise<PublicUser> {
  const password_hash = await bcrypt.hash(password, 10);
  const { data, error } = await supabase
    .from('users')
    .insert({
      username,
      password_hash,
      name,
      role,
      manager_id: manager_id ?? null,
      email: email ?? null,
      must_change_password,
      hire_date: hire_date ?? new Date().toISOString().slice(0, 10),
    })
    .select(PUBLIC_FIELDS)
    .single();
  if (error) {
    if (error.code === '23505') {
      // Single-CEO / single-admin partial unique indexes also produce 23505
      if (role === 'ceo' && error.message.includes('users_single_ceo_idx')) {
        throw new Error('Ya existe un usuario con rol CEO');
      }
      if (role === 'admin' && error.message.includes('users_single_admin_idx')) {
        throw new Error('Ya existe un usuario con rol Admin');
      }
      throw new Error('Username or email already exists');
    }
    throw new Error(error.message);
  }
  return data as PublicUser;
}

export async function updateUser(
  id: string,
  updates: {
    name?: string;
    email?: string | null;
    role?: UserRole;
    manager_id?: string | null;
    password?: string;
    must_change_password?: boolean;
    hire_date?: string;
    is_active?: boolean;
  },
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (updates.name !== undefined) patch.name = updates.name;
  if ('email' in updates) patch.email = updates.email;
  if (updates.role) patch.role = updates.role;
  if ('manager_id' in updates) patch.manager_id = updates.manager_id;
  if (updates.password) patch.password_hash = await bcrypt.hash(updates.password, 10);
  if (updates.must_change_password !== undefined) patch.must_change_password = updates.must_change_password;
  if (updates.hire_date !== undefined) patch.hire_date = updates.hire_date;
  if (updates.is_active !== undefined) patch.is_active = updates.is_active;
  console.log('[updateUser] id:', id, 'manager_id value:', patch.manager_id, 'type:', typeof patch.manager_id, 'full patch:', JSON.stringify(patch, null, 2));
  const { data, error } = await supabase.from('users').update(patch).eq('id', id).select('id, name, manager_id, role').single();
  console.log('[updateUser] Supabase response — data:', JSON.stringify(data), 'error:', JSON.stringify(error));
  if (error) {
    if (error.code === '23505') {
      if (updates.role === 'ceo') throw new Error('Ya existe un usuario con rol CEO');
      if (updates.role === 'admin') throw new Error('Ya existe un usuario con rol Admin');
    }
    throw new Error(error.message);
  }
  console.log('[updateUser] VERIFIED — manager_id in DB after save:', data?.manager_id);
}

export async function deleteUser(id: string): Promise<void> {
  const { error } = await supabase.from('users').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** Returns all user IDs visible to the given user based on their role hierarchy */
export async function getVisibleUserIds(userId: string, role: UserRole): Promise<string[]> {
  if (role === 'admin' || role === 'ceo') {
    const { data } = await supabase.from('users').select('id');
    return (data ?? []).map((u) => u.id);
  }
  if (role === 'sr_manager') {
    const { data: jrs } = await supabase
      .from('users')
      .select('id')
      .eq('manager_id', userId);
    const jrIds = (jrs ?? []).map((u) => u.id);
    if (jrIds.length === 0) return [userId];
    const { data: agents } = await supabase
      .from('users')
      .select('id')
      .in('manager_id', jrIds);
    return [userId, ...jrIds, ...(agents ?? []).map((u) => u.id)];
  }
  if (role === 'jr_manager') {
    const { data: agents } = await supabase
      .from('users')
      .select('id')
      .eq('manager_id', userId);
    return [userId, ...(agents ?? []).map((u) => u.id)];
  }
  return [userId];
}
