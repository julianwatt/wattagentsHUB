import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { supabase } from '@/lib/supabase';

// POST — save or replace the user's push subscription
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { subscription } = await req.json();
  if (!subscription) return NextResponse.json({ error: 'subscription required' }, { status: 400 });

  // Upsert: replace existing subscription for this user (unique constraint on user_id)
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      { user_id: session.user.id, subscription },
      { onConflict: 'user_id' },
    );

  if (error) {
    console.error('[push/subscribe] upsert error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
