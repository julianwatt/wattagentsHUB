import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import {
  incrementField,
  isCampaignAllowed,
  resolveActiveAssignment,
  getUserModality,
  CampaignType,
  ActivityField,
} from '@/lib/activity';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { date, campaignType, field, delta, zip_code, store_chain, store_address } = await req.json();
  if (!date || !field) return NextResponse.json({ error: 'date and field required' }, { status: 400 });

  const ct = (campaignType as CampaignType) ?? 'D2D';

  // Modality enforcement (defense in depth — same as /api/activity POST)
  const modality = await getUserModality(session.user.id);
  if (!isCampaignAllowed(modality, ct)) {
    return NextResponse.json(
      { error: 'CAMPAIGN_NOT_ALLOWED', message: `Tu modalidad no permite registrar ${ct}` },
      { status: 403 },
    );
  }

  // Look up active assignment once for both branches.
  const activeAssignment = await resolveActiveAssignment(session.user.id, date);

  // D2D blocked when there's an accepted/in_progress assignment for the date.
  if (ct === 'D2D' && activeAssignment && (activeAssignment.status === 'accepted' || activeAssignment.status === 'in_progress')) {
    return NextResponse.json(
      { error: 'D2D_BLOCKED_BY_ASSIGNMENT', message: 'Tienes una asignación de tienda activa — no puedes registrar D2D hoy' },
      { status: 403 },
    );
  }

  // For Retail, override store fields from the active assignment.
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
    const entry = await incrementField(
      session.user.id,
      session.user.name,
      session.user.username,
      date,
      ct,
      field as ActivityField,
      delta === -1 ? -1 : 1,
      {
        zip_code: ct === 'D2D' ? zip_code : undefined,
        store_chain: resolvedStoreChain,
        store_address: resolvedStoreAddress,
      },
      resolvedAssignmentId,
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
