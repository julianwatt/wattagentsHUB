import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import {
  incrementField,
  getAllowedActivityModalities,
  resolveActiveAssignment,
  getUserModality,
  CampaignType,
  ActivityField,
} from '@/lib/activity';
import { ACTIVE_STATUSES } from '@/lib/assignmentGeofence';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { date, campaignType, field, delta, zip_code, store_chain, store_address } = await req.json();
  if (!date || !field) return NextResponse.json({ error: 'date and field required' }, { status: 400 });

  const ct = (campaignType as CampaignType) ?? 'D2D';

  // Modality enforcement via the single source of truth.
  // Same logic as POST /api/activity — see lib/activity.ts.
  const modality = await getUserModality(session.user.id);
  const activeAssignment = await resolveActiveAssignment(session.user.id, date);
  const hasActiveAssignment =
    !!activeAssignment
    && (ACTIVE_STATUSES as readonly string[]).includes(activeAssignment.status);
  const allowed = getAllowedActivityModalities(modality, hasActiveAssignment);

  if (!allowed.includes(ct)) {
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
