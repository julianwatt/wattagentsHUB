/**
 * Payroll system — human-readable labels for the enum values declared in
 * ./constants.ts. One lookup per enum, both languages live side by side
 * so a missing translation is a TypeScript error, not a runtime gap.
 *
 * Use these for every user-facing rendering of an enum (table cells,
 * filter chips, badges, dropdowns, audit log entries). NEVER hand-write
 * "Borrador" / "Draft" in a component — go through the helper.
 *
 * Pairs with src/lib/i18n.ts (the existing project translations are
 * keyed nested per section; payroll enums are their own namespace because
 * the strings are short, repeated everywhere, and shared between admin
 * and agent views).
 */

import type { Lang } from '@/lib/i18n';
import {
  type PlanType,
  type PlanCampaign,
  type SaleStatus,
  type RosterPosition,
  type RosterStatus,
  type RosterCampaign,
  type PayfileState,
  type PayfileLineType,
  type ManagerLevel,
  type NegativeBalanceOrigin,
  type NegativeBalanceStatus,
  type CollectionStatus,
  type CollectionInstallmentStatus,
  type CompanyBonusType,
  type ResidualType,
  type AuditAction,
} from './constants';

type Bilingual<T extends string> = Record<T, Record<Lang, string>>;

// ── Plan type ────────────────────────────────────────────────────────────────
const PLAN_TYPE_LABELS: Bilingual<PlanType> = {
  COMMISSION:       { es: 'Comisión',         en: 'Commission' },
  RCE_ADDER_D2D:    { es: 'RCE Adder D2D',    en: 'RCE Adder D2D' },
  RCE_ADDER_RETAIL: { es: 'RCE Adder Retail', en: 'RCE Adder Retail' },
  RESIDUAL_D2D:     { es: 'Residual D2D',     en: 'Residual D2D' },
  GREEN_BONUS:      { es: 'Bono Verde',       en: 'Green Bonus' },
  MANUAL_BONUS:     { es: 'Bono Manual',      en: 'Manual Bonus' },
};
export const planTypeLabel = (t: PlanType, lang: Lang) => PLAN_TYPE_LABELS[t][lang];

// ── Plan campaign (D2D / RETAIL / BOTH) ─────────────────────────────────────
const PLAN_CAMPAIGN_LABELS: Bilingual<PlanCampaign> = {
  D2D:    { es: 'D2D',    en: 'D2D' },
  RETAIL: { es: 'Retail', en: 'Retail' },
  BOTH:   { es: 'Ambas',  en: 'Both' },
};
export const planCampaignLabel = (c: PlanCampaign, lang: Lang) => PLAN_CAMPAIGN_LABELS[c][lang];

// ── Roster campaign (D2D / RETAIL) ──────────────────────────────────────────
const ROSTER_CAMPAIGN_LABELS: Bilingual<RosterCampaign> = {
  D2D:    { es: 'D2D',    en: 'D2D' },
  RETAIL: { es: 'Retail', en: 'Retail' },
};
export const rosterCampaignLabel = (c: RosterCampaign, lang: Lang) =>
  ROSTER_CAMPAIGN_LABELS[c][lang];

// ── Sale status ──────────────────────────────────────────────────────────────
const SALE_STATUS_LABELS: Bilingual<SaleStatus> = {
  PAYABLE:           { es: 'Pagable',            en: 'Payable' },
  PAYABLE_NEXT_WEEK: { es: 'Pagable próx. sem.', en: 'Payable next week' },
  CHARGEBACK:        { es: 'Chargeback',         en: 'Chargeback' },
  CANCELLED:         { es: 'Cancelada',          en: 'Cancelled' },
  VERIFY:            { es: 'Verificar',          en: 'Verify' },
  WINBACK:           { es: 'Winback',            en: 'Winback' },
};
export const saleStatusLabel = (s: SaleStatus, lang: Lang) => SALE_STATUS_LABELS[s][lang];

// ── Roster position ─────────────────────────────────────────────────────────
// Internal taxonomy uses Jr/Sr internally, but the user-facing labels for
// managers should not reveal "Jr" to peers — per master plan §Estructura
// jerárquica. The labels here keep Jr/Sr explicit because they're shown
// to Admin/CEO; per-manager surfaces should use managerLevelLabel below.
const ROSTER_POSITION_LABELS: Bilingual<RosterPosition> = {
  agent:      { es: 'Agente',     en: 'Agent' },
  jr_manager: { es: 'Jr Manager', en: 'Jr Manager' },
  sr_manager: { es: 'Sr Manager', en: 'Sr Manager' },
};
export const rosterPositionLabel = (p: RosterPosition, lang: Lang) =>
  ROSTER_POSITION_LABELS[p][lang];

// ── Roster status ───────────────────────────────────────────────────────────
const ROSTER_STATUS_LABELS: Bilingual<RosterStatus> = {
  active:   { es: 'Activo',   en: 'Active' },
  inactive: { es: 'Inactivo', en: 'Inactive' },
};
export const rosterStatusLabel = (s: RosterStatus, lang: Lang) =>
  ROSTER_STATUS_LABELS[s][lang];

// ── Payfile state ───────────────────────────────────────────────────────────
const PAYFILE_STATE_LABELS: Bilingual<PayfileState> = {
  DRAFT:            { es: 'Borrador',     en: 'Draft' },
  PENDING_APPROVAL: { es: 'En aprobación', en: 'Pending approval' },
  APPROVED:         { es: 'Aprobado',     en: 'Approved' },
  PUBLISHED:        { es: 'Publicado',    en: 'Published' },
  REJECTED:         { es: 'Rechazado',    en: 'Rejected' },
};
export const payfileStateLabel = (s: PayfileState, lang: Lang) =>
  PAYFILE_STATE_LABELS[s][lang];

// ── Line item type ──────────────────────────────────────────────────────────
const PAYFILE_LINE_TYPE_LABELS: Bilingual<PayfileLineType> = {
  COMMISSION:                  { es: 'Comisión',                  en: 'Commission' },
  OVERRIDE:                    { es: 'Override',                  en: 'Override' },
  COMPANY_BONUS:               { es: 'Bono',                      en: 'Bonus' },
  NEGATIVE_BALANCE_COLLECTION: { es: 'Cobro saldo negativo',      en: 'Negative balance collection' },
  COLLECTION:                  { es: 'Cobro adicional',           en: 'Collection' },
  COLLECTION_INCOME:           { es: 'Abono de cobro',            en: 'Collection credit' },
  MANUAL_ADJUSTMENT:           { es: 'Ajuste manual',             en: 'Manual adjustment' },
};
export const payfileLineTypeLabel = (t: PayfileLineType, lang: Lang) =>
  PAYFILE_LINE_TYPE_LABELS[t][lang];

// ── Manager level ───────────────────────────────────────────────────────────
// Public labels: hide the Sr/Jr internal naming. Managers see "Manager X".
// Admin/CEO surfaces that need the explicit role should use rosterPositionLabel
// instead.
const MANAGER_LEVEL_LABELS: Bilingual<ManagerLevel> = {
  MANAGER_1: { es: 'Manager 1', en: 'Manager 1' },
  MANAGER_2: { es: 'Manager 2', en: 'Manager 2' },
  MANAGER_3: { es: 'Manager 3', en: 'Manager 3' },
};
export const managerLevelLabel = (l: ManagerLevel, lang: Lang) =>
  MANAGER_LEVEL_LABELS[l][lang];

// ── Negative balance ────────────────────────────────────────────────────────
const NEGATIVE_BALANCE_ORIGIN_LABELS: Bilingual<NegativeBalanceOrigin> = {
  COMMISSION: { es: 'Comisión', en: 'Commission' },
  OVERRIDE:   { es: 'Override', en: 'Override' },
};
export const negativeBalanceOriginLabel = (o: NegativeBalanceOrigin, lang: Lang) =>
  NEGATIVE_BALANCE_ORIGIN_LABELS[o][lang];

const NEGATIVE_BALANCE_STATUS_LABELS: Bilingual<NegativeBalanceStatus> = {
  PENDING:             { es: 'Pendiente',           en: 'Pending' },
  PARTIALLY_COLLECTED: { es: 'Cobrado parcialmente', en: 'Partially collected' },
  FULLY_COLLECTED:     { es: 'Cobrado',             en: 'Fully collected' },
  MANUALLY_DELETED:    { es: 'Eliminado manualmente', en: 'Manually deleted' },
};
export const negativeBalanceStatusLabel = (s: NegativeBalanceStatus, lang: Lang) =>
  NEGATIVE_BALANCE_STATUS_LABELS[s][lang];

// ── Collections ──────────────────────────────────────────────────────────────
const COLLECTION_STATUS_LABELS: Bilingual<CollectionStatus> = {
  ACTIVE:    { es: 'Activo',    en: 'Active' },
  COMPLETED: { es: 'Completado', en: 'Completed' },
  CANCELLED: { es: 'Cancelado', en: 'Cancelled' },
};
export const collectionStatusLabel = (s: CollectionStatus, lang: Lang) =>
  COLLECTION_STATUS_LABELS[s][lang];

const COLLECTION_INSTALLMENT_STATUS_LABELS: Bilingual<CollectionInstallmentStatus> = {
  PENDING:             { es: 'Pendiente',            en: 'Pending' },
  PARTIALLY_COLLECTED: { es: 'Cobrado parcialmente', en: 'Partially collected' },
  FULLY_COLLECTED:     { es: 'Cobrado',              en: 'Fully collected' },
  CANCELLED:           { es: 'Cancelado',            en: 'Cancelled' },
};
export const collectionInstallmentStatusLabel = (
  s: CollectionInstallmentStatus,
  lang: Lang,
) => COLLECTION_INSTALLMENT_STATUS_LABELS[s][lang];

// ── Bonuses ──────────────────────────────────────────────────────────────────
const COMPANY_BONUS_TYPE_LABELS: Bilingual<CompanyBonusType> = {
  MANUAL_BONUS:     { es: 'Bono manual',      en: 'Manual bonus' },
  RCE_ADDER_D2D:    { es: 'RCE Adder D2D',    en: 'RCE Adder D2D' },
  RCE_ADDER_RETAIL: { es: 'RCE Adder Retail', en: 'RCE Adder Retail' },
};
export const companyBonusTypeLabel = (t: CompanyBonusType, lang: Lang) =>
  COMPANY_BONUS_TYPE_LABELS[t][lang];

// ── Residuals ────────────────────────────────────────────────────────────────
const RESIDUAL_TYPE_LABELS: Bilingual<ResidualType> = {
  RESIDUAL_D2D: { es: 'Residual D2D', en: 'Residual D2D' },
  GREEN_BONUS:  { es: 'Bono Verde',   en: 'Green Bonus' },
};
export const residualTypeLabel = (t: ResidualType, lang: Lang) =>
  RESIDUAL_TYPE_LABELS[t][lang];

// ── Audit log ────────────────────────────────────────────────────────────────
const AUDIT_ACTION_LABELS: Bilingual<AuditAction> = {
  CREATE:       { es: 'Crear',          en: 'Create' },
  UPDATE:       { es: 'Actualizar',     en: 'Update' },
  DELETE:       { es: 'Eliminar',       en: 'Delete' },
  STATE_CHANGE: { es: 'Cambio de estado', en: 'State change' },
  EDIT_AMOUNT:  { es: 'Editar monto',   en: 'Edit amount' },
};
export const auditActionLabel = (a: AuditAction, lang: Lang) => AUDIT_ACTION_LABELS[a][lang];
