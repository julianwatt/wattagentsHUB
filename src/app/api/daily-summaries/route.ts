import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { supabase } from '@/lib/supabase';

// GET — fetch daily summaries for last N days
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user.role !== 'admin' && session.user.role !== 'ceo')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const days = Math.min(Number(searchParams.get('days') || '30'), 90);
  const specificDate = searchParams.get('date'); // optional: filter by specific date

  if (specificDate) {
    const { data } = await supabase
      .from('daily_summaries')
      .select('*')
      .eq('date', specificDate)
      .single();
    return NextResponse.json(data ? [data] : []);
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('daily_summaries')
    .select('*')
    .gte('date', cutoffStr)
    .order('date', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
