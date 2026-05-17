-- =============================================================
-- Payroll System — Initial Schema (Block 01)
-- Date: 2026-05-17
-- Branch: feature/payroll-system
--
-- Strategy: matches project convention.
--   - Server uses SUPABASE_SERVICE_ROLE_KEY (bypasses RLS).
--   - RLS enabled with permissive anon SELECT only where realtime is
--     needed; all real authorization happens in API routes via NextAuth.
--   - The deeper role-based policies described in the master plan
--     (override-privacy, manager-scoped reads, etc.) are enforced
--     server-side, not in RLS — see src/lib/payroll/permissions.ts.
--
-- Reversal: drop in reverse order of creation. No DOWN script per
-- project convention; rollback documented at the bottom of this file.
-- =============================================================

-- =========================================================================
-- ENUM TYPES
-- =========================================================================

CREATE TYPE public.payroll_plan_type AS ENUM (
  'COMMISSION',
  'RCE_ADDER_D2D',
  'RCE_ADDER_RETAIL',
  'RESIDUAL_D2D',
  'GREEN_BONUS',
  'MANUAL_BONUS'
);

CREATE TYPE public.payroll_campaign AS ENUM ('D2D', 'RETAIL', 'BOTH');

CREATE TYPE public.payroll_sale_status AS ENUM (
  'PAYABLE',
  'PAYABLE_NEXT_WEEK',
  'CHARGEBACK',
  'CANCELLED',
  'VERIFY',
  'WINBACK'
);

CREATE TYPE public.payroll_roster_position AS ENUM (
  'agent', 'jr_manager', 'sr_manager'
);

CREATE TYPE public.payroll_roster_status AS ENUM ('active', 'inactive');

CREATE TYPE public.payroll_roster_campaign AS ENUM ('D2D', 'RETAIL');

CREATE TYPE public.payfile_state AS ENUM (
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'PUBLISHED',
  'REJECTED'
);

CREATE TYPE public.payfile_line_type AS ENUM (
  'COMMISSION',
  'OVERRIDE',
  'COMPANY_BONUS',
  'NEGATIVE_BALANCE_COLLECTION',
  'COLLECTION',
  'MANUAL_ADJUSTMENT'
);

CREATE TYPE public.payfile_manager_level AS ENUM (
  'MANAGER_1', 'MANAGER_2', 'MANAGER_3'
);

CREATE TYPE public.negative_balance_origin AS ENUM ('COMMISSION', 'OVERRIDE');

CREATE TYPE public.negative_balance_status AS ENUM (
  'PENDING',
  'PARTIALLY_COLLECTED',
  'FULLY_COLLECTED',
  'MANUALLY_DELETED'
);

CREATE TYPE public.negative_balance_user_status AS ENUM ('active', 'inactive');

CREATE TYPE public.collection_status AS ENUM (
  'ACTIVE', 'COMPLETED', 'CANCELLED'
);

CREATE TYPE public.collection_installment_status AS ENUM (
  'PENDING', 'PARTIALLY_COLLECTED', 'FULLY_COLLECTED'
);

CREATE TYPE public.company_bonus_type AS ENUM (
  'MANUAL_BONUS', 'RCE_ADDER_D2D', 'RCE_ADDER_RETAIL'
);

CREATE TYPE public.residual_type AS ENUM ('RESIDUAL_D2D', 'GREEN_BONUS');

CREATE TYPE public.payroll_audit_action AS ENUM (
  'CREATE', 'UPDATE', 'DELETE', 'STATE_CHANGE', 'EDIT_AMOUNT'
);

-- =========================================================================
-- SHARED: updated_at trigger function (one for all payroll tables)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.tg_payroll_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =========================================================================
-- TABLE: payroll_uploads
-- =========================================================================
CREATE TABLE public.payroll_uploads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name     text NOT NULL UNIQUE,
  file_path     text NOT NULL,
  cutoff_date   date NOT NULL,
  uploaded_by   uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  processed     boolean NOT NULL DEFAULT false,
  row_count     integer NOT NULL DEFAULT 0,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER payroll_uploads_updated_at
  BEFORE UPDATE ON public.payroll_uploads
  FOR EACH ROW EXECUTE FUNCTION public.tg_payroll_set_updated_at();

-- =========================================================================
-- TABLE: plan_mappings
-- =========================================================================
CREATE TABLE public.plan_mappings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_name     text NOT NULL UNIQUE,
  plan_type     public.payroll_plan_type NOT NULL,
  tier          integer,
  term_months   integer,
  campaign      public.payroll_campaign,
  extra_amount  numeric(12, 2),
  notes         text,
  created_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_mappings_tier_valid CHECK (tier IS NULL OR tier BETWEEN 0 AND 4),
  CONSTRAINT plan_mappings_term_valid CHECK (term_months IS NULL OR term_months IN (36, 60))
);
CREATE TRIGGER plan_mappings_updated_at
  BEFORE UPDATE ON public.plan_mappings
  FOR EACH ROW EXECUTE FUNCTION public.tg_payroll_set_updated_at();

-- =========================================================================
-- TABLE: payroll_sales
-- =========================================================================
CREATE TABLE public.payroll_sales (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id              uuid NOT NULL REFERENCES public.payroll_uploads(id) ON DELETE RESTRICT,
  source_file_name       text NOT NULL,
  contract_id            text NOT NULL,
  customer_name          text,
  plan_name              text NOT NULL,
  plan_mapping_id        uuid REFERENCES public.plan_mappings(id) ON DELETE SET NULL,
  je_badge               text NOT NULL,
  marketing_channel      text,
  je_disposition         text,
  contract_signed_date   date,
  kwh_or_rce             numeric(14, 4),
  commission_type        text,
  je_paid_amount         numeric(12, 2) NOT NULL DEFAULT 0,
  status                 public.payroll_sale_status NOT NULL DEFAULT 'VERIFY',
  internal_agent_id      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  pay_week               date,
  assigned_tier          integer,
  raw_term_months        integer,
  assigned_term_months   integer,
  is_winback             boolean NOT NULL DEFAULT false,
  notes                  text,
  -- raw archival columns from JE file (block 04 will refine):
  raw_row                jsonb,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_sales_tier_valid
    CHECK (assigned_tier IS NULL OR assigned_tier BETWEEN 0 AND 4),
  CONSTRAINT payroll_sales_assigned_term_valid
    CHECK (assigned_term_months IS NULL OR assigned_term_months IN (36, 60)),
  CONSTRAINT payroll_sales_raw_term_valid
    CHECK (raw_term_months IS NULL OR raw_term_months IN (36, 60))
);
CREATE TRIGGER payroll_sales_updated_at
  BEFORE UPDATE ON public.payroll_sales
  FOR EACH ROW EXECUTE FUNCTION public.tg_payroll_set_updated_at();

-- =========================================================================
-- TABLE: payroll_roster
-- =========================================================================
CREATE TABLE public.payroll_roster (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  je_badge            text NOT NULL,
  je_badge_status     public.payroll_roster_status NOT NULL DEFAULT 'active',
  valid_from          date NOT NULL,
  valid_until         date,
  campaign            public.payroll_roster_campaign NOT NULL,
  position            public.payroll_roster_position NOT NULL,
  direct_manager_id   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
-- Partial unique: only ONE active row per je_badge at a time
CREATE UNIQUE INDEX payroll_roster_badge_active_unique
  ON public.payroll_roster (je_badge)
  WHERE je_badge_status = 'active';
CREATE TRIGGER payroll_roster_updated_at
  BEFORE UPDATE ON public.payroll_roster
  FOR EACH ROW EXECUTE FUNCTION public.tg_payroll_set_updated_at();

-- =========================================================================
-- TABLE: roster_custom_rates
-- =========================================================================
CREATE TABLE public.roster_custom_rates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  campaign            public.payroll_roster_campaign NOT NULL,
  tier                integer,
  term_months         integer,
  commission_amount   numeric(12, 2) NOT NULL,
  override_amount     numeric(12, 2),
  valid_from          date NOT NULL,
  valid_until         date,
  created_by          uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roster_custom_rates_tier_valid
    CHECK (tier IS NULL OR tier BETWEEN 0 AND 4),
  CONSTRAINT roster_custom_rates_term_valid
    CHECK (term_months IS NULL OR term_months IN (36, 60))
);

-- =========================================================================
-- TABLE: payfiles
-- =========================================================================
CREATE TABLE public.payfiles (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  pay_week               date NOT NULL,
  state                  public.payfile_state NOT NULL DEFAULT 'DRAFT',
  total_amount           numeric(14, 2) NOT NULL DEFAULT 0,
  submitted_to_ceo_at    timestamptz,
  approved_by_ceo_at     timestamptz,
  approved_by            uuid REFERENCES public.users(id) ON DELETE SET NULL,
  published_at           timestamptz,
  last_version_number    integer NOT NULL DEFAULT 1,
  rejection_notes        text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payfiles_unique_user_week UNIQUE (user_id, pay_week)
);
CREATE TRIGGER payfiles_updated_at
  BEFORE UPDATE ON public.payfiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_payroll_set_updated_at();

-- =========================================================================
-- TABLE: payfile_versions
-- =========================================================================
CREATE TABLE public.payfile_versions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payfile_id     uuid NOT NULL REFERENCES public.payfiles(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  snapshot_json  jsonb NOT NULL,
  pdf_path       text,
  published_at   timestamptz NOT NULL DEFAULT now(),
  published_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT payfile_versions_unique UNIQUE (payfile_id, version_number)
);

-- =========================================================================
-- TABLE: collections   (declared before payfile_line_items because FK)
-- =========================================================================
CREATE TABLE public.collections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  description     text NOT NULL,
  debtor_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  beneficiary_id  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  total_amount    numeric(12, 2) NOT NULL,
  installments    integer NOT NULL DEFAULT 1,
  start_week      date NOT NULL,
  created_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  status          public.collection_status NOT NULL DEFAULT 'ACTIVE',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collections_installments_positive CHECK (installments > 0)
);
CREATE TRIGGER collections_updated_at
  BEFORE UPDATE ON public.collections
  FOR EACH ROW EXECUTE FUNCTION public.tg_payroll_set_updated_at();

-- =========================================================================
-- TABLE: negative_balances   (FK target for payfile_line_items)
-- =========================================================================
CREATE TABLE public.negative_balances (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  origin                      public.negative_balance_origin NOT NULL,
  source_sale_id              uuid REFERENCES public.payroll_sales(id) ON DELETE SET NULL,
  original_amount             numeric(12, 2) NOT NULL,
  collected_amount            numeric(12, 2) NOT NULL DEFAULT 0,
  -- remaining_amount is a stored, server-maintained column. Triggers in
  -- block 08 will update it as collections post; for now we keep it stored
  -- and let the app code maintain it explicitly.
  remaining_amount            numeric(12, 2) NOT NULL,
  origin_week                 date NOT NULL,
  description                 text NOT NULL,
  campaign                    public.payroll_roster_campaign,
  manager_at_time             uuid REFERENCES public.users(id) ON DELETE SET NULL,
  user_status_when_created    public.negative_balance_user_status NOT NULL,
  status                      public.negative_balance_status NOT NULL DEFAULT 'PENDING',
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER negative_balances_updated_at
  BEFORE UPDATE ON public.negative_balances
  FOR EACH ROW EXECUTE FUNCTION public.tg_payroll_set_updated_at();

-- =========================================================================
-- TABLE: payfile_line_items
-- =========================================================================
CREATE TABLE public.payfile_line_items (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payfile_id                  uuid NOT NULL REFERENCES public.payfiles(id) ON DELETE CASCADE,
  line_type                   public.payfile_line_type NOT NULL,
  description                 text NOT NULL,
  source_sale_id              uuid REFERENCES public.payroll_sales(id) ON DELETE SET NULL,
  source_collection_id        uuid REFERENCES public.collections(id) ON DELETE SET NULL,
  source_negative_balance_id  uuid REFERENCES public.negative_balances(id) ON DELETE SET NULL,
  amount                      numeric(12, 2) NOT NULL,
  original_amount             numeric(12, 2) NOT NULL,
  is_manually_edited          boolean NOT NULL DEFAULT false,
  is_over_received_amount     boolean NOT NULL DEFAULT false,
  is_over_3x_received         boolean NOT NULL DEFAULT false,
  edit_note                   text,
  edited_by                   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  edited_at                   timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER payfile_line_items_updated_at
  BEFORE UPDATE ON public.payfile_line_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_payroll_set_updated_at();

-- =========================================================================
-- TABLE: payfile_overrides
-- =========================================================================
CREATE TABLE public.payfile_overrides (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id              uuid NOT NULL REFERENCES public.payroll_sales(id) ON DELETE CASCADE,
  manager_id           uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  manager_level        public.payfile_manager_level NOT NULL,
  amount               numeric(12, 2) NOT NULL,
  original_amount      numeric(12, 2) NOT NULL,
  is_manually_edited   boolean NOT NULL DEFAULT false,
  payfile_line_item_id uuid REFERENCES public.payfile_line_items(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  -- One row per (sale, manager_level): a single sale can't pay two managers
  -- at the same level.
  CONSTRAINT payfile_overrides_unique_per_sale_level
    UNIQUE (sale_id, manager_level)
);

-- =========================================================================
-- TABLE: collection_installments
-- =========================================================================
CREATE TABLE public.collection_installments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id       uuid NOT NULL REFERENCES public.collections(id) ON DELETE CASCADE,
  installment_number  integer NOT NULL,
  scheduled_week      date NOT NULL,
  amount              numeric(12, 2) NOT NULL,
  collected_amount    numeric(12, 2) NOT NULL DEFAULT 0,
  status              public.collection_installment_status NOT NULL DEFAULT 'PENDING',
  applied_payfile_id  uuid REFERENCES public.payfiles(id) ON DELETE SET NULL,
  CONSTRAINT collection_installments_unique
    UNIQUE (collection_id, installment_number)
);

-- =========================================================================
-- TABLE: company_bonuses
-- =========================================================================
CREATE TABLE public.company_bonuses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_sale_id   uuid REFERENCES public.payroll_sales(id) ON DELETE SET NULL,
  bonus_type       public.company_bonus_type NOT NULL,
  original_je_data jsonb,
  total_amount     numeric(12, 2) NOT NULL,
  description      text NOT NULL,
  pay_week         date NOT NULL,
  paid_to_agents   boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- =========================================================================
-- TABLE: bonus_distributions
-- =========================================================================
CREATE TABLE public.bonus_distributions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_bonus_id  uuid NOT NULL REFERENCES public.company_bonuses(id) ON DELETE CASCADE,
  recipient_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  amount            numeric(12, 2) NOT NULL,
  pay_week          date NOT NULL,
  notes             text,
  created_by        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- =========================================================================
-- TABLE: residuals
-- =========================================================================
CREATE TABLE public.residuals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_sale_id   uuid NOT NULL REFERENCES public.payroll_sales(id) ON DELETE RESTRICT,
  residual_type    public.residual_type NOT NULL,
  amount           numeric(12, 2) NOT NULL,
  pay_week         date NOT NULL,
  original_je_data jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- =========================================================================
-- TABLE: payroll_audit_log
-- =========================================================================
CREATE TABLE public.payroll_audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type   text NOT NULL,
  entity_id     uuid NOT NULL,
  action        public.payroll_audit_action NOT NULL,
  actor_id      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  old_value     jsonb,
  new_value     jsonb,
  change_notes  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- =========================================================================
-- TABLE: je_badge_alerts
-- =========================================================================
CREATE TABLE public.je_badge_alerts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  je_badge      text NOT NULL UNIQUE,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  sale_count    integer NOT NULL DEFAULT 1,
  resolved_at   timestamptz,
  resolved_by   uuid REFERENCES public.users(id) ON DELETE SET NULL
);

-- =========================================================================
-- TABLE: payfile_change_notifications
-- =========================================================================
CREATE TABLE public.payfile_change_notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payfile_id  uuid NOT NULL REFERENCES public.payfiles(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  sent_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- =========================================================================
-- INDEXES
-- =========================================================================

CREATE INDEX payroll_sales_contract_status_idx
  ON public.payroll_sales (contract_id, status);
CREATE INDEX payroll_sales_internal_agent_idx
  ON public.payroll_sales (internal_agent_id);
CREATE INDEX payroll_sales_pay_week_idx
  ON public.payroll_sales (pay_week);
CREATE INDEX payroll_sales_upload_idx
  ON public.payroll_sales (upload_id);
CREATE INDEX payroll_sales_je_badge_idx
  ON public.payroll_sales (je_badge);

CREATE INDEX payfiles_user_week_idx
  ON public.payfiles (user_id, pay_week);
CREATE INDEX payfiles_state_idx
  ON public.payfiles (state);

CREATE INDEX payfile_line_items_payfile_idx
  ON public.payfile_line_items (payfile_id);
CREATE INDEX payfile_line_items_source_sale_idx
  ON public.payfile_line_items (source_sale_id);

CREATE INDEX payfile_versions_payfile_idx
  ON public.payfile_versions (payfile_id, version_number DESC);

CREATE INDEX negative_balances_user_idx
  ON public.negative_balances (user_id);
CREATE INDEX negative_balances_status_idx
  ON public.negative_balances (status);

CREATE INDEX payfile_overrides_manager_idx
  ON public.payfile_overrides (manager_id);
CREATE INDEX payfile_overrides_sale_idx
  ON public.payfile_overrides (sale_id);

CREATE INDEX payroll_audit_entity_idx
  ON public.payroll_audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX payroll_audit_actor_idx
  ON public.payroll_audit_log (actor_id, created_at DESC);

CREATE INDEX payroll_roster_user_idx
  ON public.payroll_roster (user_id);
CREATE INDEX payroll_roster_manager_idx
  ON public.payroll_roster (direct_manager_id);

CREATE INDEX collections_debtor_idx ON public.collections (debtor_id);
CREATE INDEX collection_installments_collection_idx
  ON public.collection_installments (collection_id);
CREATE INDEX collection_installments_week_idx
  ON public.collection_installments (scheduled_week);

CREATE INDEX bonus_distributions_recipient_week_idx
  ON public.bonus_distributions (recipient_id, pay_week);

CREATE INDEX residuals_sale_idx ON public.residuals (source_sale_id);
CREATE INDEX residuals_week_idx ON public.residuals (pay_week);

-- =========================================================================
-- ROW LEVEL SECURITY
-- Project convention: server uses service-role (bypasses RLS); browser uses
-- anon for limited SELECTs needed by realtime / public reads. All
-- per-role authorization happens in API routes (see src/lib/payroll/
-- permissions.ts). We enable RLS + permissive SELECT for anon on tables
-- the browser may subscribe to, and grant nothing to anon on the rest.
-- =========================================================================

ALTER TABLE public.payroll_uploads               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_mappings                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_sales                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_roster                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roster_custom_rates           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payfiles                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payfile_versions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payfile_line_items            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payfile_overrides             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.negative_balances             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collections                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_installments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_bonuses               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bonus_distributions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.residuals                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_audit_log             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.je_badge_alerts               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payfile_change_notifications  ENABLE ROW LEVEL SECURITY;

-- Browser realtime SELECT — only on tables the agent/manager UI will
-- subscribe to. Server-side authorization further filters what the API
-- returns to the user; the anon policy just doesn't block realtime.
CREATE POLICY anon_select_payfiles ON public.payfiles
  FOR SELECT TO anon USING (true);
CREATE POLICY anon_select_payfile_line_items ON public.payfile_line_items
  FOR SELECT TO anon USING (true);
CREATE POLICY anon_select_payfile_versions ON public.payfile_versions
  FOR SELECT TO anon USING (true);
CREATE POLICY anon_select_payfile_overrides ON public.payfile_overrides
  FOR SELECT TO anon USING (true);
CREATE POLICY anon_select_plan_mappings ON public.plan_mappings
  FOR SELECT TO anon USING (true);
CREATE POLICY anon_select_payroll_roster ON public.payroll_roster
  FOR SELECT TO anon USING (true);
CREATE POLICY anon_select_negative_balances ON public.negative_balances
  FOR SELECT TO anon USING (true);
CREATE POLICY anon_select_collections ON public.collections
  FOR SELECT TO anon USING (true);
CREATE POLICY anon_select_collection_installments ON public.collection_installments
  FOR SELECT TO anon USING (true);

-- All other tables (uploads, sales, audit log, bonuses, residuals,
-- je_badge_alerts, change notifications, custom rates) are intentionally
-- left without an anon policy — only the service-role client can touch
-- them, and that's enforced in API routes.

-- =========================================================================
-- REALTIME
-- Add the tables the UI needs to react to in real-time. Skip large
-- archival tables (audit log, sales) and admin-only collections to keep
-- the realtime fan-out small.
-- =========================================================================
ALTER TABLE public.payfiles                     REPLICA IDENTITY FULL;
ALTER TABLE public.payfile_line_items           REPLICA IDENTITY FULL;
ALTER TABLE public.payfile_versions             REPLICA IDENTITY FULL;
ALTER TABLE public.payfile_change_notifications REPLICA IDENTITY FULL;
ALTER TABLE public.je_badge_alerts              REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.payfiles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.payfile_line_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.payfile_versions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.payfile_change_notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.je_badge_alerts;

-- =========================================================================
-- ROLLBACK (manual)
-- =========================================================================
-- To roll back this migration, run (in reverse FK order):
--
--   DROP TABLE IF EXISTS public.payfile_change_notifications CASCADE;
--   DROP TABLE IF EXISTS public.je_badge_alerts CASCADE;
--   DROP TABLE IF EXISTS public.payroll_audit_log CASCADE;
--   DROP TABLE IF EXISTS public.residuals CASCADE;
--   DROP TABLE IF EXISTS public.bonus_distributions CASCADE;
--   DROP TABLE IF EXISTS public.company_bonuses CASCADE;
--   DROP TABLE IF EXISTS public.collection_installments CASCADE;
--   DROP TABLE IF EXISTS public.collections CASCADE;
--   DROP TABLE IF EXISTS public.payfile_overrides CASCADE;
--   DROP TABLE IF EXISTS public.payfile_line_items CASCADE;
--   DROP TABLE IF EXISTS public.negative_balances CASCADE;
--   DROP TABLE IF EXISTS public.payfile_versions CASCADE;
--   DROP TABLE IF EXISTS public.payfiles CASCADE;
--   DROP TABLE IF EXISTS public.roster_custom_rates CASCADE;
--   DROP TABLE IF EXISTS public.payroll_roster CASCADE;
--   DROP TABLE IF EXISTS public.payroll_sales CASCADE;
--   DROP TABLE IF EXISTS public.plan_mappings CASCADE;
--   DROP TABLE IF EXISTS public.payroll_uploads CASCADE;
--   DROP FUNCTION IF EXISTS public.tg_payroll_set_updated_at();
--   DROP TYPE IF EXISTS public.payroll_audit_action;
--   DROP TYPE IF EXISTS public.residual_type;
--   DROP TYPE IF EXISTS public.company_bonus_type;
--   DROP TYPE IF EXISTS public.collection_installment_status;
--   DROP TYPE IF EXISTS public.collection_status;
--   DROP TYPE IF EXISTS public.negative_balance_user_status;
--   DROP TYPE IF EXISTS public.negative_balance_status;
--   DROP TYPE IF EXISTS public.negative_balance_origin;
--   DROP TYPE IF EXISTS public.payfile_manager_level;
--   DROP TYPE IF EXISTS public.payfile_line_type;
--   DROP TYPE IF EXISTS public.payfile_state;
--   DROP TYPE IF EXISTS public.payroll_roster_campaign;
--   DROP TYPE IF EXISTS public.payroll_roster_status;
--   DROP TYPE IF EXISTS public.payroll_roster_position;
--   DROP TYPE IF EXISTS public.payroll_sale_status;
--   DROP TYPE IF EXISTS public.payroll_campaign;
--   DROP TYPE IF EXISTS public.payroll_plan_type;
