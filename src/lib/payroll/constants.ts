/**
 * Payroll system — enum constants (single source of truth).
 * ============================================================================
 *
 * Mirrors the Postgres enums declared in
 * supabase/migrations/20260517_payroll_initial_schema.sql.
 *
 * Every literal string comparison against one of these enums anywhere in
 * the codebase MUST import from here. If a value here drifts from the
 * DB enum, the migration is the truth — update this file to match.
 */

// ── Plan types ───────────────────────────────────────────────────────────────
export const PLAN_TYPES = [
  'COMMISSION',
  'RCE_ADDER_D2D',
  'RCE_ADDER_RETAIL',
  'RESIDUAL_D2D',
  'GREEN_BONUS',
  'MANUAL_BONUS',
] as const;
export type PlanType = (typeof PLAN_TYPES)[number];

// ── Campaign (catalog) ───────────────────────────────────────────────────────
export const PLAN_CAMPAIGNS = ['D2D', 'RETAIL', 'BOTH'] as const;
export type PlanCampaign = (typeof PLAN_CAMPAIGNS)[number];

// ── Roster campaign (no BOTH — a badge belongs to exactly one campaign) ─────
export const ROSTER_CAMPAIGNS = ['D2D', 'RETAIL'] as const;
export type RosterCampaign = (typeof ROSTER_CAMPAIGNS)[number];

// ── Sale status ──────────────────────────────────────────────────────────────
export const SALE_STATUSES = [
  'PAYABLE',
  'PAYABLE_NEXT_WEEK',
  'CHARGEBACK',
  'CANCELLED',
  'VERIFY',
  'WINBACK',
] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

// Sale statuses that actually pay (or get charged) in the current pay week.
// Used when totaling a payfile and when deciding what shows up as line items.
export const PAYING_SALE_STATUSES: readonly SaleStatus[] = [
  'PAYABLE', 'CHARGEBACK', 'WINBACK',
];

// Sale statuses that block publishing a payfile until resolved.
export const BLOCKING_SALE_STATUSES: readonly SaleStatus[] = ['VERIFY'];

// ── Roster position ─────────────────────────────────────────────────────────
export const ROSTER_POSITIONS = ['agent', 'jr_manager', 'sr_manager'] as const;
export type RosterPosition = (typeof ROSTER_POSITIONS)[number];

export const ROSTER_STATUSES = ['active', 'inactive'] as const;
export type RosterStatus = (typeof ROSTER_STATUSES)[number];

// ── Payfile state machine ───────────────────────────────────────────────────
export const PAYFILE_STATES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'PUBLISHED',
  'REJECTED',
] as const;
export type PayfileState = (typeof PAYFILE_STATES)[number];

// States where Admin may freely edit line items.
export const EDITABLE_PAYFILE_STATES: readonly PayfileState[] = ['DRAFT', 'REJECTED'];

// States where the CEO sees the file in the approval queue.
export const APPROVAL_PAYFILE_STATES: readonly PayfileState[] = ['PENDING_APPROVAL'];

// State where the agent sees the payfile (after first publish).
export const VISIBLE_PAYFILE_STATES: readonly PayfileState[] = ['PUBLISHED'];

// ── Line item types ─────────────────────────────────────────────────────────
export const PAYFILE_LINE_TYPES = [
  'COMMISSION',
  'OVERRIDE',
  'COMPANY_BONUS',
  'NEGATIVE_BALANCE_COLLECTION',
  'COLLECTION',
  'MANUAL_ADJUSTMENT',
] as const;
export type PayfileLineType = (typeof PAYFILE_LINE_TYPES)[number];

// ── Manager level (override hierarchy) ───────────────────────────────────────
// MANAGER_1 = Sr Manager  (highest, sole D2D level today)
// MANAGER_2 = Jr Manager  (middle, Retail / future D2D)
// MANAGER_3 = Jr-Jr Manager (Retail only when present)
export const MANAGER_LEVELS = ['MANAGER_1', 'MANAGER_2', 'MANAGER_3'] as const;
export type ManagerLevel = (typeof MANAGER_LEVELS)[number];

// ── Negative balance ────────────────────────────────────────────────────────
export const NEGATIVE_BALANCE_ORIGINS = ['COMMISSION', 'OVERRIDE'] as const;
export type NegativeBalanceOrigin = (typeof NEGATIVE_BALANCE_ORIGINS)[number];

export const NEGATIVE_BALANCE_STATUSES = [
  'PENDING',
  'PARTIALLY_COLLECTED',
  'FULLY_COLLECTED',
  'MANUALLY_DELETED',
] as const;
export type NegativeBalanceStatus = (typeof NEGATIVE_BALANCE_STATUSES)[number];

// Statuses where the balance still has uncollected amount left.
export const OPEN_NEGATIVE_BALANCE_STATUSES: readonly NegativeBalanceStatus[] = [
  'PENDING', 'PARTIALLY_COLLECTED',
];

// ── Collections ──────────────────────────────────────────────────────────────
export const COLLECTION_STATUSES = ['ACTIVE', 'COMPLETED', 'CANCELLED'] as const;
export type CollectionStatus = (typeof COLLECTION_STATUSES)[number];

export const COLLECTION_INSTALLMENT_STATUSES = [
  'PENDING', 'PARTIALLY_COLLECTED', 'FULLY_COLLECTED',
] as const;
export type CollectionInstallmentStatus =
  (typeof COLLECTION_INSTALLMENT_STATUSES)[number];

// ── Bonuses ──────────────────────────────────────────────────────────────────
export const COMPANY_BONUS_TYPES = [
  'MANUAL_BONUS', 'RCE_ADDER_D2D', 'RCE_ADDER_RETAIL',
] as const;
export type CompanyBonusType = (typeof COMPANY_BONUS_TYPES)[number];

// ── Residuals ────────────────────────────────────────────────────────────────
export const RESIDUAL_TYPES = ['RESIDUAL_D2D', 'GREEN_BONUS'] as const;
export type ResidualType = (typeof RESIDUAL_TYPES)[number];

// ── Audit log ────────────────────────────────────────────────────────────────
export const AUDIT_ACTIONS = [
  'CREATE', 'UPDATE', 'DELETE', 'STATE_CHANGE', 'EDIT_AMOUNT',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

// ── D2D contract terms (months) ──────────────────────────────────────────────
// Currently 36 and 60 are the only legal values. The DB CHECK constraint
// enforces this at write time; this constant is the client-side mirror.
export const D2D_TERM_MONTHS = [36, 60] as const;
export type D2DTermMonths = (typeof D2D_TERM_MONTHS)[number];

// ── D2D tier range ───────────────────────────────────────────────────────────
export const D2D_TIERS = [0, 1, 2, 3, 4] as const;
export type D2DTier = (typeof D2D_TIERS)[number];

// ── Retail default overrides (configurable, but seeded with these) ───────────
// Per master plan §Retail.
export const RETAIL_DEFAULT_OVERRIDES = {
  MANAGER_3: 15, // Jr-Jr Manager (configurable, when present)
  MANAGER_2: 20, // Jr Manager
  MANAGER_1_DIRECT: 40, // Sr Manager over their direct reports
  MANAGER_1_INDIRECT: 20, // Sr Manager over indirect reports
} as const;

// ── 3x edit guard threshold ──────────────────────────────────────────────────
// Manual edits that push a line item above this multiple of the JE-paid
// amount require explicit CEO confirmation. Below the multiple but above
// the JE-paid amount, the row still gets the `is_over_received_amount` flag.
export const OVER_RECEIVED_MULTIPLE = 3;

// ── Republish CEO re-approval threshold ──────────────────────────────────────
// When a published payfile is edited after the fact, changes whose absolute
// delta exceeds this dollar amount require a new CEO approval round.
export const REPUBLISH_REAPPROVAL_THRESHOLD_USD = 500;
