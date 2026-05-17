/**
 * Payroll system — DB row types.
 * ============================================================================
 *
 * One interface per table created in
 * supabase/migrations/20260517_payroll_initial_schema.sql.
 *
 * Enum-typed columns reuse the constants in src/lib/payroll/constants.ts —
 * those are the single source of truth.
 *
 * All timestamps come back from Supabase as ISO strings; dates come back as
 * 'YYYY-MM-DD' strings. We type them as `string` (not `Date`) to match what
 * the supabase-js client actually returns.
 */

import type {
  PlanType,
  PlanCampaign,
  RosterCampaign,
  RosterPosition,
  RosterStatus,
  SaleStatus,
  PayfileState,
  PayfileLineType,
  ManagerLevel,
  NegativeBalanceOrigin,
  NegativeBalanceStatus,
  CollectionStatus,
  CollectionInstallmentStatus,
  CompanyBonusType,
  ResidualType,
  AuditAction,
} from '@/lib/payroll/constants';

// ── payroll_uploads ──────────────────────────────────────────────────────────
export interface PayrollUpload {
  id: string;
  file_name: string;
  file_path: string;
  cutoff_date: string;
  uploaded_by: string;
  uploaded_at: string;
  processed: boolean;
  row_count: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ── plan_mappings ────────────────────────────────────────────────────────────
export interface PlanMapping {
  id: string;
  plan_name: string;
  plan_type: PlanType;
  tier: number | null;
  term_months: number | null;
  campaign: PlanCampaign | null;
  extra_amount: number | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ── payroll_sales ────────────────────────────────────────────────────────────
export interface PayrollSale {
  id: string;
  upload_id: string;
  source_file_name: string;
  contract_id: string;
  customer_name: string | null;
  plan_name: string;
  plan_mapping_id: string | null;
  je_badge: string;
  marketing_channel: string | null;
  je_disposition: string | null;
  contract_signed_date: string | null;
  kwh_or_rce: number | null;
  commission_type: string | null;
  je_paid_amount: number;
  status: SaleStatus;
  internal_agent_id: string | null;
  pay_week: string | null;
  assigned_tier: number | null;
  raw_term_months: number | null;
  assigned_term_months: number | null;
  is_winback: boolean;
  notes: string | null;
  raw_row: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

// ── payroll_roster ───────────────────────────────────────────────────────────
export interface PayrollRosterEntry {
  id: string;
  user_id: string;
  je_badge: string;
  je_badge_status: RosterStatus;
  valid_from: string;
  valid_until: string | null;
  campaign: RosterCampaign;
  position: RosterPosition;
  direct_manager_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ── roster_custom_rates ──────────────────────────────────────────────────────
export interface RosterCustomRate {
  id: string;
  user_id: string;
  campaign: RosterCampaign;
  tier: number | null;
  term_months: number | null;
  commission_amount: number;
  override_amount: number | null;
  valid_from: string;
  valid_until: string | null;
  created_by: string | null;
  created_at: string;
}

// ── payfiles ─────────────────────────────────────────────────────────────────
export interface Payfile {
  id: string;
  user_id: string;
  pay_week: string;
  state: PayfileState;
  total_amount: number;
  submitted_to_ceo_at: string | null;
  approved_by_ceo_at: string | null;
  approved_by: string | null;
  published_at: string | null;
  last_version_number: number;
  rejection_notes: string | null;
  created_at: string;
  updated_at: string;
}

// ── payfile_versions ─────────────────────────────────────────────────────────
export interface PayfileVersion {
  id: string;
  payfile_id: string;
  version_number: number;
  snapshot_json: Record<string, unknown>;
  pdf_path: string | null;
  published_at: string;
  published_by: string | null;
}

// ── payfile_line_items ───────────────────────────────────────────────────────
export interface PayfileLineItem {
  id: string;
  payfile_id: string;
  line_type: PayfileLineType;
  description: string;
  source_sale_id: string | null;
  source_collection_id: string | null;
  source_negative_balance_id: string | null;
  amount: number;
  original_amount: number;
  is_manually_edited: boolean;
  is_over_received_amount: boolean;
  is_over_3x_received: boolean;
  edit_note: string | null;
  edited_by: string | null;
  edited_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── payfile_overrides ────────────────────────────────────────────────────────
export interface PayfileOverride {
  id: string;
  sale_id: string;
  manager_id: string;
  manager_level: ManagerLevel;
  amount: number;
  original_amount: number;
  is_manually_edited: boolean;
  payfile_line_item_id: string | null;
  created_at: string;
}

// ── negative_balances ────────────────────────────────────────────────────────
export interface NegativeBalance {
  id: string;
  user_id: string;
  origin: NegativeBalanceOrigin;
  source_sale_id: string | null;
  original_amount: number;
  collected_amount: number;
  remaining_amount: number;
  origin_week: string;
  description: string;
  campaign: RosterCampaign | null;
  manager_at_time: string | null;
  user_status_when_created: 'active' | 'inactive';
  status: NegativeBalanceStatus;
  created_at: string;
  updated_at: string;
}

// ── collections ──────────────────────────────────────────────────────────────
export interface Collection {
  id: string;
  description: string;
  debtor_id: string;
  beneficiary_id: string | null;
  total_amount: number;
  installments: number;
  start_week: string;
  created_by: string | null;
  status: CollectionStatus;
  created_at: string;
  updated_at: string;
}

// ── collection_installments ──────────────────────────────────────────────────
export interface CollectionInstallment {
  id: string;
  collection_id: string;
  installment_number: number;
  scheduled_week: string;
  amount: number;
  collected_amount: number;
  status: CollectionInstallmentStatus;
  applied_payfile_id: string | null;
}

// ── company_bonuses ──────────────────────────────────────────────────────────
export interface CompanyBonus {
  id: string;
  source_sale_id: string | null;
  bonus_type: CompanyBonusType;
  original_je_data: Record<string, unknown> | null;
  total_amount: number;
  description: string;
  pay_week: string;
  paid_to_agents: boolean;
  created_at: string;
}

// ── bonus_distributions ──────────────────────────────────────────────────────
export interface BonusDistribution {
  id: string;
  company_bonus_id: string;
  recipient_id: string;
  amount: number;
  pay_week: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

// ── residuals ────────────────────────────────────────────────────────────────
export interface Residual {
  id: string;
  source_sale_id: string;
  residual_type: ResidualType;
  amount: number;
  pay_week: string;
  original_je_data: Record<string, unknown> | null;
  created_at: string;
}

// ── payroll_audit_log ────────────────────────────────────────────────────────
export interface PayrollAuditLog {
  id: string;
  entity_type: string;
  entity_id: string;
  action: AuditAction;
  actor_id: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  change_notes: string | null;
  created_at: string;
}

// ── je_badge_alerts ──────────────────────────────────────────────────────────
export interface JeBadgeAlert {
  id: string;
  je_badge: string;
  first_seen_at: string;
  last_seen_at: string;
  sale_count: number;
  resolved_at: string | null;
  resolved_by: string | null;
}

// ── payfile_change_notifications ─────────────────────────────────────────────
export interface PayfileChangeNotification {
  id: string;
  payfile_id: string;
  user_id: string;
  sent_at: string | null;
  created_at: string;
}
