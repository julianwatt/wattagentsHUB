import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import {
  upsertActivity,
  getEntry,
  getAgentEntries,
  getEntriesForUsers,
  deleteEntry,
  getAllowedActivityModalities,
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

  // ── Modality enforcement (single source of truth) ────────────────────────
  // Look up modality + active assignment, then ask the centralized function
  // which campaigns are allowed today. Reject anything outside that set.
  // Defense in depth: even if the UI hides D2D, an attacker can still POST
  // with a forged campaignType, so this server-side gate stops them.
  const modality = await getUserModality(session.user.id);
  const activeAssignment = await resolveActiveAssignment(session.user.id, date);
  const hasActiveAssignment =
    !!activeAssignment
    && (activeAssignment.status === 'accepted' || activeAssignment.status === 'in_progress');
  const allowed = getAllowedActivityModalities(modality, hasActiveAssignment);

  if (!allowed.includes(ct)) {
    // Use a more specific error code when the rejection is caused by an
    // active Retail assignment overriding the agent's profile modality —
    // the UI shows a clearer message in that case.
    if (ct === 'D2D' && hasActiveAssignment) {
      return NextResponse.json(
        { error: 'D2D_BLOCKED_BY_ASSIGNMENT', message: 'Tienes una asignación de tienda activa — solo puedes registrar Retail hoy' },
        { status: 403 },
      );
    }
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
    if (!activeAssignment) {
      return NextResponse.json(
        { error: 'NO_ASSIGNMENT', message: 'No tienes una asignación activa para esta fecha' },
        { status: 409 },
      );
    }
    resolvedStoreChain = activeAssignment.store_name;
    resolvedStoreAddress = activeAssignment.store_address ?? null;
    resolvedAssignmentId = activeAssignment.assignment_id;
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
