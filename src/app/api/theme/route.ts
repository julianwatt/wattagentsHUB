import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getThemeById, DEFAULT_THEME_ID } from '@/lib/themes';
import { supabase } from '@/lib/supabase';

const THEME_KEY = 'theme';

async function readTheme(): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('app_config')
      .select('value')
      .eq('key', THEME_KEY)
      .single();
    return data?.value ?? null;
  } catch {
    return null;
  }
}

async function writeTheme(themeId: string): Promise<void> {
  await supabase
    .from('app_config')
    .upsert({ key: THEME_KEY, value: themeId, updated_at: new Date().toISOString() }, { onConflict: 'key' });
}

export async function GET() {
  const themeId = (await readTheme()) ?? DEFAULT_THEME_ID;
  const theme = getThemeById(themeId);
  return NextResponse.json({ themeId, theme });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  // CEO is read-only on configuration; only admin may change the platform theme
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { themeId } = await req.json();
  const theme = getThemeById(themeId);
  await writeTheme(themeId);

  const res = NextResponse.json({ themeId, theme });
  res.cookies.set('app-theme', themeId, {
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
    httpOnly: false,
    sameSite: 'lax',
  });
  return res;
}
