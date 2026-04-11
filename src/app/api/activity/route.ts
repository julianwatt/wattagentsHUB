import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { upsertActivity, getEntry, getAgentEntries, getEntriesForUsers, deleteEntry, CampaignType } from '@/lib/activity';
import { getVisibleUserIds } from '@/lib/users';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const agentId = searchParams.get('agentId');
  const date = searchParams.get('date');

  // Single entry lookup
  if (agentId && date) {
    const isPrivileged = session.user.role === 'admin' || session.user.role === 'ceo';
    const targetId = isPrivileged ? agentId : session.user.id;
    const entry = await getEntry(targetId, date);
    return NextResponse.json(entry);
  }

  // List by visibility role
  const visibleIds = await getVisibleUserIds(session.user.id, session.user.role);
  const targetId = agentId && visibleIds.includes(agentId) ? agentId : null;

  const entries = targetId
    ? await getAgentEntries(targetId)
    : await getEntriesForUsers(visibleIds);

  return NextResponse.json(entries);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { date, campaignType, zip_code, store_chain, store_address, ...metrics } = body;
  if (!date) return NextResponse.json({ error: 'date is required' }, { status: 400 });

  try {
    const entry = await upsertActivity(
      session.user.id,
      date,
      (campaignType as CampaignType) ?? 'D2D',
      metrics,
      { zip_code, store_chain, store_address },
    );
    return NextResponse.json(entry, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error';
    if (message === 'CAMPAIGN_LOCKED') {
      return NextResponse.json({ error: 'CAMPAIGN_LOCKED' }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { date, agentId } = await req.json();
  const isPrivileged = session.user.role === 'admin' || session.user.role === 'ceo';
  const targetAgent = isPrivileged && agentId ? agentId : session.user.id;
  await deleteEntry(targetAgent, date);
  return NextResponse.json({ success: true });
}
