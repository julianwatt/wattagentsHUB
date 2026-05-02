import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { supabase } from '@/lib/supabase';

// GET — list all stores
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Only active stores are exposed to the assignment selector. Inactive
  // stores stay in the table so historical assignments keep their
  // store_id reference, but they don't appear as new options.
  const { data, error } = await supabase
    .from('stores')
    .select('id, name, address, latitude, longitude, geofence_radius_meters')
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('name', { ascending: true });

  if (error) {
    console.error('[shift/stores] error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
