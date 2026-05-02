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

  // For Retail, override store fields from the active assignment.
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
