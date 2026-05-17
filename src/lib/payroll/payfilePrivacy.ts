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
 *   - Admin / CEO  → full visibility.
 *   - Dueño del payfile (any other role) → own line items + own override
 *     rows only. Other managers' overrides on the same sale are stripped.
 *   - Anyone else (not the owner, not admin/CEO) → null. Manager scoping
 *     for "I manage this person, can I see their payfile?" is a block 13
 *     concern — out of scope here.
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

  const isPrivileged = viewer.role === 'admin' || viewer.role === 'ceo';
  const isOwner = (payfile as Payfile).user_id === viewer.user_id;

  if (!isPrivileged && !isOwner) return null;

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

  // Owner who isn't admin/CEO only sees their own override rows.
  if (!isPrivileged) {
    overrides = overrides.filter((o) => o.manager_id === viewer.user_id);
  }

  return {
    payfile: payfile as Payfile,
    line_items: (lineItems ?? []) as PayfileLineItem[],
    overrides,
  };
}
