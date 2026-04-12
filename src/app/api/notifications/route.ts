import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { supabase } from '@/lib/supabase';

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'admin') return null;
  return session;
}

// GET — fetch pending notifications + yesterday's summary
export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Password reset requests (pending + done for history)
  const { data: resetRequests } = await supabase
    .from('admin_notifications')
    .select('*')
    .eq('type', 'password_reset')
    .order('created_at', { ascending: false })
    .limit(20);

  // Yesterday's activity summary by campaign
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  const { data: yesterdayEntries } = await supabase
    .from('activity_entries')
    .select('campaign_type, sales, knocks, contacts, stops, zipcodes')
    .eq('date', yesterdayStr);

  const summary = { date: yesterdayStr, d2d: { sales: 0, interactions: 0, contacts: 0, count: 0 }, rtl: { sales: 0, interactions: 0, contacts: 0, count: 0 } };
  (yesterdayEntries ?? []).forEach((e: Record<string, unknown>) => {
    if (e.campaign_type === 'D2D') {
      summary.d2d.sales += (e.sales as number) || 0;
      summary.d2d.interactions += (e.knocks as number) || 0;
      summary.d2d.contacts += (e.contacts as number) || 0;
      summary.d2d.count++;
    } else {
      summary.rtl.sales += (e.sales as number) || 0;
      summary.rtl.interactions += (e.stops as number) || 0;
      summary.rtl.contacts += (e.zipcodes as number) || 0;
      summary.rtl.count++;
    }
  });

  return NextResponse.json({ resetRequests: resetRequests ?? [], summary });
}

// PATCH — mark notification as done
export async function PATCH(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  await supabase.from('admin_notifications').update({ status: 'done' }).eq('id', id);
  return NextResponse.json({ ok: true });
}
