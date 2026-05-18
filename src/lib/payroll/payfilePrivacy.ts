/**
 * Block 06 §Privacy — getPayfileForUser with override-privacy filtering.
 * ============================================================================
 *
 * The block-13 master plan rule: a manager viewing THEIR OWN payfile must
 * not see what other managers earned on the same underlying sales. Admin
 * and CEO always see everything (preview, audit).
 *
 * Block 06 ships the function so block-13 can plug into it without
 * refactoring the data fetch. The filter logic is centralized here so
 * the rule never gets re-implemented in some API route.
 */

import { supabase } from '@/lib/supabase';
import type { Payfile, PayfileLineItem, PayfileOverride } from '@/types/payroll';
import {
  getDownlineUserIds,
  filterOverridesForViewer,
} from '@/lib/payroll/hierarchyAccess';

export interface PayfileBundle {
  payfile: Payfile;
  line_items: PayfileLineItem[];
  /** Override rows for every sale that touches this payfile, scoped to
   *  what the viewer is allowed to see. Admin/CEO get all; the dueño
   *  of the payfile (if a manager) gets only their own overrides. */
  overrides: PayfileOverride[];
}

export interface ViewerCtx {
  user_id: string;
  role: 'agent' | 'jr_manager' | 'sr_manager' | 'admin' | 'ceo' | string;
}

/**
 * Returns the payfile + line items + overrides the viewer is allowed to see.
 *   - Admin / CEO         → full visibility.
 *   - Owner of the payfile → own line items + own override rows only.
 *   - Sr / Jr manager whose downline contains the payfile owner →
 *     line items + overrides filtered to viewer + viewer's downline
 *     (block 13 horizontal-privacy rule).
 *   - Anyone else → null.
 *
 * Block 13: downline is computed once here (BFS through payroll_roster).
 * For team-view APIs that already build the downline, callers may want
 * to skip via an in-memory cache; for now the function eats the extra
 * query — payfiles are read one at a time from the UI.
 */
export async function getPayfileForUser(
  payfileId: string,
  viewer: ViewerCtx,
): Promise<PayfileBundle | null> {
  const { data: payfile } = await supabase
    .from('payfiles')
    .select('*')
    .eq('id', payfileId)
    .maybeSingle();
  if (!payfile) return null;

  const ownerId = (payfile as Payfile).user_id;
  const isPrivileged = viewer.role === 'admin' || viewer.role === 'ceo';
  const isOwner = ownerId === viewer.user_id;
  const isManager = viewer.role === 'jr_manager' || viewer.role === 'sr_manager';

  // Resolve access + downline.
  let downline = new Set<string>();
  if (!isPrivileged && !isOwner) {
    if (!isManager) return null;
    downline = await getDownlineUserIds(viewer.user_id);
    if (!downline.has(ownerId)) return null;
  }

  const { data: lineItems } = await supabase
    .from('payfile_line_items')
    .select('*')
    .eq('payfile_id', payfileId)
    .order('created_at', { ascending: true });

  // Overrides associated to any of the sales this payfile touches.
  const saleIds = Array.from(new Set(
    (lineItems ?? [])
      .map((li) => (li as PayfileLineItem).source_sale_id)
      .filter((id): id is string => !!id),
  ));
  let overrides: PayfileOverride[] = [];
  if (saleIds.length > 0) {
    const { data } = await supabase
      .from('payfile_overrides')
      .select('*')
      .in('sale_id', saleIds);
    overrides = (data ?? []) as PayfileOverride[];
  }

  overrides = filterOverridesForViewer(viewer, ownerId, overrides, downline);

  return {
    payfile: payfile as Payfile,
    line_items: (lineItems ?? []) as PayfileLineItem[],
    overrides,
  };
}
