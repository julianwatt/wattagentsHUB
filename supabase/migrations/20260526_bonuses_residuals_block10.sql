-- =============================================================
-- Payroll System — Company bonuses + residuals UI support (Block 10)
-- Date: 2026-05-26
-- Branch: feature/payroll-system
--
-- The data tables themselves (company_bonuses, bonus_distributions,
-- residuals) were declared by block 01 and have been populated by the
-- block-04 parser. Block 10 adds three small touches:
--
--   1. payfile_line_items.source_bonus_distribution_id
--      Links a COMPANY_BONUS line back to the bonus_distributions row
--      that produced it. Lets us edit / delete a distribution and
--      keep the recipient's payfile in sync, and lets the calc
--      orchestrator distinguish "auto-via-distribution" lines from
--      ad-hoc manual COMPANY_BONUS adds.
--
--   2. company_bonuses.notes
--      Free-text admin commentary on top of `description`. Spec asks
--      for admin/CEO-editable notes that don't overwrite the
--      JE-derived description.
--
--   3. residuals.notes
--      Same idea for the Residuales tab.
--
-- Rollback:
--   ALTER TABLE public.payfile_line_items DROP COLUMN IF EXISTS source_bonus_distribution_id;
--   ALTER TABLE public.company_bonuses    DROP COLUMN IF EXISTS notes;
--   ALTER TABLE public.residuals          DROP COLUMN IF EXISTS notes;
-- =============================================================

-- 1. payfile_line_items.source_bonus_distribution_id
ALTER TABLE public.payfile_line_items
  ADD COLUMN IF NOT EXISTS source_bonus_distribution_id uuid
    REFERENCES public.bonus_distributions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS payfile_line_items_source_bonus_dist_idx
  ON public.payfile_line_items (source_bonus_distribution_id)
  WHERE source_bonus_distribution_id IS NOT NULL;

-- 2. company_bonuses.notes
ALTER TABLE public.company_bonuses
  ADD COLUMN IF NOT EXISTS notes text;

-- 3. residuals.notes
ALTER TABLE public.residuals
  ADD COLUMN IF NOT EXISTS notes text;

COMMENT ON COLUMN public.payfile_line_items.source_bonus_distribution_id IS
  'When set, this COMPANY_BONUS line was generated automatically from a bonus_distributions row. Edit/delete in the Bonos tab updates both sides in sync.';
COMMENT ON COLUMN public.company_bonuses.notes IS
  'Admin/CEO commentary. Independent from JE-derived description.';
COMMENT ON COLUMN public.residuals.notes IS
  'Admin/CEO commentary on this residual entry.';
