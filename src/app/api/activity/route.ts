import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import {
  upsertActivity,
  getEntry,
  getAgentEntries,
  getEntriesForUsers,
  deleteEntry,
  isCampaignAllowed,
  resolveActiveAssignment,
  getUserModality,
  CampaignType,
} from '@/lib/activity';
import { getVisibleUserIds, getUserById, type UserRole } from '@/lib/users';

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

  // Support "Ver como" individual user preview for admin
  const asUser = searchParams.get('asUser');
  let viewerId = session.user.id;
  let viewerRole: UserRole = session.user.role as UserRole;
  if (asUser && session.user.role === 'admin') {
    const targetUser = await getUserById(asUser);
    if (targetUser) {
      viewerId = targetUser.id;
      viewerRole = targetUser.role;
    }
  }

  // List by visibility role
  const visibleIds = await getVisibleUserIds(viewerId, viewerRole);
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

  const ct = (campaignType as CampaignType) ?? 'D2D';

  // ── Modality enforcement ─────────────────────────────────────────────────
  // Reject the submission if the agent's modality doesn't allow this campaign.
  // Defense in depth: even if the UI hides the toggle, an attacker can still
  // POST with a forged campaignType.
  const modality = await getUserModality(session.user.id);
  if (!isCampaignAllowed(modality, ct)) {
    return NextResponse.json(
      { error: 'CAMPAIGN_NOT_ALLOWED', message: `Tu modalidad no permite registrar ${ct}` },
      { status: 403 },
    );
  }

  // ── Retail: store comes from the active assignment, NOT from the client ──
  let resolvedStoreChain = store_chain;
  let resolvedStoreAddress = store_address;
  let resolvedAssignmentId: string | null = null;

  if (ct === 'Retail') {
    const assignment = await resolveActiveAssignment(session.user.id, date);
    if (!assignment) {
      return NextResponse.json(
        { error: 'NO_ASSIGNMENT', message: 'No tienes una asignación activa para esta fecha' },
        { status: 409 },
      );
    }
    resolvedStoreChain = assignment.store_name;
    resolvedStoreAddress = assignment.store_address ?? null;
    resolvedAssignmentId = assignment.assignment_id;
  }

  try {
    const entry = await upsertActivity(
      session.user.id,
      date,
      ct,
      metrics,
      {
        zip_code: ct === 'D2D' ? zip_code : undefined,
        store_chain: resolvedStoreChain,
        store_address: resolvedStoreAddress,
      },
      resolvedAssignmentId,
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
