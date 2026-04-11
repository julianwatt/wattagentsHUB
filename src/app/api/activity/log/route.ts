import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { incrementField, CampaignType, ActivityField } from '@/lib/activity';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { date, campaignType, field, delta, zip_code, store_chain, store_address } = await req.json();
  if (!date || !field) return NextResponse.json({ error: 'date and field required' }, { status: 400 });

  try {
    const entry = await incrementField(
      session.user.id,
      session.user.name,
      session.user.username,
      date,
      (campaignType as CampaignType) ?? 'D2D',
      field as ActivityField,
      delta === -1 ? -1 : 1,
      { zip_code, store_chain, store_address },
    );
    return NextResponse.json(entry);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error';
    if (message === 'CAMPAIGN_LOCKED') {
      return NextResponse.json({ error: 'CAMPAIGN_LOCKED' }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
