-- =============================================================
-- Payroll System — Standard rates table (Block 05)
-- Date: 2026-05-21
-- Branch: feature/payroll-system
--
-- Single source of truth for "what pays what" before block 06 runs the
-- commission calculation. Lives alongside roster_custom_rates (block 01)
-- — custom rates take precedence; this table is the fallback every sale
-- falls back to.
--
-- Pre-populated with 20 D2D rows (5 tiers × 2 terms × 2 rate types) plus
-- 4 Retail rows. Numbers come directly from the master plan §Tarifas.
-- "Manager 1 personal pay" is intentionally not seeded — block 06 computes
-- it on the fly as COMMISSION + OVERRIDE_DIRECT for the same combination.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.payroll_standard_rates CASCADE;
--   DROP TYPE  IF EXISTS public.payroll_rate_type;
-- =============================================================

-- 1. ENUM
CREATE TYPE public.payroll_rate_type AS ENUM (
  'COMMISSION',
  'OVERRIDE_DIRECT',
  'OVERRIDE_INDIRECT'
);

-- 2. TABLE
CREATE TABLE public.payroll_standard_rates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign       public.payroll_roster_campaign NOT NULL,
  tier           integer,
  term_months    integer,
  position       public.payroll_roster_position NOT NULL,
  manager_level  public.payfile_manager_level,
  rate_type      public.payroll_rate_type NOT NULL,
  amount         numeric(12, 2) NOT NULL,
  valid_from     date NOT NULL,
  valid_until    date,
  notes          text,
  created_by     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT psr_tier_valid
    CHECK (tier IS NULL OR tier BETWEEN 0 AND 4),
  CONSTRAINT psr_term_valid
    CHECK (term_months IS NULL OR term_months BETWEEN 1 AND 120),
  -- COMMISSION rows have no manager_level; OVERRIDE rows must have one.
  CONSTRAINT psr_manager_level_matches_rate_type
    CHECK (
      (rate_type = 'COMMISSION' AND manager_level IS NULL)
      OR (rate_type IN ('OVERRIDE_DIRECT', 'OVERRIDE_INDIRECT') AND manager_level IS NOT NULL)
    ),
  -- Validity window must be coherent.
  CONSTRAINT psr_valid_window
    CHECK (valid_until IS NULL OR valid_until > valid_from),
  -- Amount is signed in principle (future rebates), but for now must be ≥ 0.
  CONSTRAINT psr_amount_nonneg
    CHECK (amount >= 0)
);

-- Unique combo. NULLS NOT DISTINCT (PG 15+) makes Postgres treat two NULLs
-- as equal for the purpose of this index, so a Retail row (tier/term/
-- manager_level all NULL) still collides with another identical Retail
-- row — without the unstable COALESCE-on-cast expression that PG 17 refuses
-- to mark IMMUTABLE.
CREATE UNIQUE INDEX payroll_standard_rates_unique_combo
  ON public.payroll_standard_rates
     (campaign, tier, term_months, position, manager_level, rate_type, valid_from)
  NULLS NOT DISTINCT;

CREATE INDEX payroll_standard_rates_lookup_idx
  ON public.payroll_standard_rates (campaign, position, rate_type, valid_from DESC);

CREATE TRIGGER payroll_standard_rates_updated_at
  BEFORE UPDATE ON public.payroll_standard_rates
  FOR EACH ROW EXECUTE FUNCTION public.tg_payroll_set_updated_at();

ALTER TABLE public.payroll_standard_rates ENABLE ROW LEVEL SECURITY;
-- Admin-only via server. No anon/authenticated policies.

-- 3. SEED — D2D agent COMMISSIONS (10 rows)
INSERT INTO public.payroll_standard_rates
  (campaign, tier, term_months, position, manager_level, rate_type, amount, valid_from, notes)
VALUES
  ('D2D', 0, 60, 'agent', NULL, 'COMMISSION',  50, '2026-01-01', 'D2D 60M T0 agent base'),
  ('D2D', 1, 60, 'agent', NULL, 'COMMISSION',  50, '2026-01-01', 'D2D 60M T1 agent base'),
  ('D2D', 2, 60, 'agent', NULL, 'COMMISSION', 100, '2026-01-01', 'D2D 60M T2 agent base'),
  ('D2D', 3, 60, 'agent', NULL, 'COMMISSION', 170, '2026-01-01', 'D2D 60M T3 agent base'),
  ('D2D', 4, 60, 'agent', NULL, 'COMMISSION', 170, '2026-01-01', 'D2D 60M T4 agent base'),
  ('D2D', 0, 36, 'agent', NULL, 'COMMISSION',  40, '2026-01-01', 'D2D 36M T0 agent base'),
  ('D2D', 1, 36, 'agent', NULL, 'COMMISSION',  40, '2026-01-01', 'D2D 36M T1 agent base'),
  ('D2D', 2, 36, 'agent', NULL, 'COMMISSION',  90, '2026-01-01', 'D2D 36M T2 agent base'),
  ('D2D', 3, 36, 'agent', NULL, 'COMMISSION', 160, '2026-01-01', 'D2D 36M T3 agent base'),
  ('D2D', 4, 36, 'agent', NULL, 'COMMISSION', 160, '2026-01-01', 'D2D 36M T4 agent base');

-- 4. SEED — D2D Manager 1 OVERRIDE_DIRECT (10 rows)
INSERT INTO public.payroll_standard_rates
  (campaign, tier, term_months, position, manager_level, rate_type, amount, valid_from, notes)
VALUES
  ('D2D', 0, 60, 'sr_manager', 'MANAGER_1', 'OVERRIDE_DIRECT',  5, '2026-01-01', NULL),
  ('D2D', 1, 60, 'sr_manager', 'MANAGER_1', 'OVERRIDE_DIRECT', 20, '2026-01-01', NULL),
  ('D2D', 2, 60, 'sr_manager', 'MANAGER_1', 'OVERRIDE_DIRECT', 30, '2026-01-01', NULL),
  ('D2D', 3, 60, 'sr_manager', 'MANAGER_1', 'OVERRIDE_DIRECT', 55, '2026-01-01', NULL),
  ('D2D', 4, 60, 'sr_manager', 'MANAGER_1', 'OVERRIDE_DIRECT', 80, '2026-01-01', NULL),
  ('D2D', 0, 36, 'sr_manager', 'MANAGER_1', 'OVERRIDE_DIRECT',  5, '2026-01-01', NULL),
  ('D2D', 1, 36, 'sr_manager', 'MANAGER_1', 'OVERRIDE_DIRECT', 20, '2026-01-01', NULL),
  ('D2D', 2, 36, 'sr_manager', 'MANAGER_1', 'OVERRIDE_DIRECT', 30, '2026-01-01', NULL),
  ('D2D', 3, 36, 'sr_manager', 'MANAGER_1', 'OVERRIDE_DIRECT', 55, '2026-01-01', NULL),
  ('D2D', 4, 36, 'sr_manager', 'MANAGER_1', 'OVERRIDE_DIRECT', 80, '2026-01-01', NULL);

-- 5. SEED — Retail (4 rows). Tier/term NULL because they don't apply.
--    MANAGER_3 (Jr-Jr Manager) is intentionally not pre-seeded — no
--    jr_jr_manager position exists in users.role today. Admin adds it
--    via UI / migration when the role is created.
INSERT INTO public.payroll_standard_rates
  (campaign, tier, term_months, position, manager_level, rate_type, amount, valid_from, notes)
VALUES
  ('RETAIL', NULL, NULL, 'agent',      NULL,        'COMMISSION',        100, '2026-01-01', 'Retail base agent commission'),
  ('RETAIL', NULL, NULL, 'jr_manager', 'MANAGER_2', 'OVERRIDE_DIRECT',    20, '2026-01-01', 'Retail Jr Manager direct override'),
  ('RETAIL', NULL, NULL, 'sr_manager', 'MANAGER_1', 'OVERRIDE_DIRECT',    40, '2026-01-01', 'Retail Sr Manager direct override'),
  ('RETAIL', NULL, NULL, 'sr_manager', 'MANAGER_1', 'OVERRIDE_INDIRECT',  20, '2026-01-01', 'Retail Sr Manager indirect override');

COMMENT ON TABLE public.payroll_standard_rates IS
  'Single source of truth for per-tier/term/position pay rates. roster_custom_rates overrides this on a per-user basis. Never hardcode these numbers anywhere else.';
