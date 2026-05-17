-- =============================================================
-- Payroll System — Plan mapping seed + term constraint widening (Block 03)
-- Date: 2026-05-19
-- Branch: feature/payroll-system
--
-- Two things in one migration:
--   1. Widen the term_months CHECK constraints to BETWEEN 1 AND 120 so
--      legacy 12-month plans (and any future term we haven't anticipated)
--      can be ingested. The TypeScript constants still treat 36/60 as the
--      supported set for UI defaults — this just stops the DB rejecting
--      one-off values.
--   2. Seed plan_mappings with every Plan Name observed in the sample JE
--      Commission files Julian shared
--      (27155_Watts Distributors LLC_US_Weekly_*.xlsx).
--
-- Tier is intentionally left NULL on D2D COMMISSION rows: tier→$
-- assignment is business knowledge only Julian has. Admin fills them in
-- via the Plan Mapping UI. canPublishWeek() (lib/payroll/canPublishWeek.ts)
-- blocks publishing any payfile whose ventas have a COMMISSION D2D plan
-- without an assigned_tier yet.
--
-- Rollback:
--   DELETE FROM public.plan_mappings WHERE plan_name LIKE 'Watts -%';
--   (restore the original CHECKs if you want to revert that too)
-- =============================================================

ALTER TABLE public.plan_mappings DROP CONSTRAINT plan_mappings_term_valid;
ALTER TABLE public.plan_mappings ADD CONSTRAINT plan_mappings_term_valid
  CHECK (term_months IS NULL OR term_months BETWEEN 1 AND 120);

ALTER TABLE public.payroll_sales DROP CONSTRAINT payroll_sales_assigned_term_valid;
ALTER TABLE public.payroll_sales ADD CONSTRAINT payroll_sales_assigned_term_valid
  CHECK (assigned_term_months IS NULL OR assigned_term_months BETWEEN 1 AND 120);
ALTER TABLE public.payroll_sales DROP CONSTRAINT payroll_sales_raw_term_valid;
ALTER TABLE public.payroll_sales ADD CONSTRAINT payroll_sales_raw_term_valid
  CHECK (raw_term_months IS NULL OR raw_term_months BETWEEN 1 AND 120);

ALTER TABLE public.roster_custom_rates DROP CONSTRAINT roster_custom_rates_term_valid;
ALTER TABLE public.roster_custom_rates ADD CONSTRAINT roster_custom_rates_term_valid
  CHECK (term_months IS NULL OR term_months BETWEEN 1 AND 120);

INSERT INTO public.plan_mappings (plan_name, plan_type, campaign, tier, term_months, extra_amount, notes) VALUES
  ('Watts - Texas - ELE - D2D - 60 - 0.40-0.59 RCE - $95',  'COMMISSION', 'D2D', NULL, 60, NULL, 'Verificar tier asignado. Pago JE: $95.'),
  ('Watts - Texas - ELE - D2D - 60 - 0.60-0.69 RCE - $170', 'COMMISSION', 'D2D', NULL, 60, NULL, 'Verificar tier asignado. Pago JE: $170.'),
  ('Watts - Texas - ELE - D2D - 60 - 0.7 - 1.19 RCE - $305','COMMISSION', 'D2D', NULL, 60, NULL, 'Verificar tier asignado. Pago JE: $305.'),
  ('Watts - Texas - ELE - D2D - 60 - 1.2+ RCE - $330',       'COMMISSION', 'D2D', NULL, 60, NULL, 'Verificar tier asignado. Pago JE: $330.'),
  ('Watts - Texas - ELE - D2D - 12 - $80',                   'COMMISSION', 'D2D', NULL, 12, NULL, 'Plan legacy de 12 meses. Verificar tier.'),
  ('Watts - Texas - ELE - National Retail LMMM/El Ahorro/Sellers Bros/El Rancho - 36/60- $210', 'COMMISSION', 'RETAIL', NULL, NULL, NULL, 'Retail comisión por cadena LMMM/El Ahorro/Sellers Bros/El Rancho. Term se lee del archivo.'),
  ('Watts - Texas - ELE - National Retail HEB/ Joe V/Mi Tienda/Kroger/Walmart - 36/60- $230',   'COMMISSION', 'RETAIL', NULL, NULL, NULL, 'Retail comisión por cadena HEB/Joe V/Mi Tienda/Kroger/Walmart. Term se lee del archivo.'),
  ('Watts - RCE Adder - Texas - ELE - D2D - 36 - 1.60-2.49 RCE - $100', 'RCE_ADDER_D2D',    'D2D',    NULL, NULL, 100,  'RCE adder por venta D2D con RCE 1.60-2.49.'),
  ('Watts - RCE Adder - Texas - ELE - D2D - 36 - 2.50-3.49 RCE - $200', 'RCE_ADDER_D2D',    'D2D',    NULL, NULL, 200,  'RCE adder por venta D2D con RCE 2.50-3.49.'),
  ('Watts - Texas - ELE - National Retail - 1.4 - 1.9 RCE - $10',       'RCE_ADDER_RETAIL', 'RETAIL', NULL, NULL, 10,   'RCE adder retail RCE 1.4-1.9.'),
  ('Watts - Texas - ELE - National Retail - 2.0+ RCE - $20',            'RCE_ADDER_RETAIL', 'RETAIL', NULL, NULL, 20,   'RCE adder retail RCE 2.0+.'),
  ('Watts - TX - ELE - D2D - 60 - 0.6+ RCE - Residual - $50',           'RESIDUAL_D2D',    'D2D',    NULL, 60,   NULL,  'Residual D2D 60M.'),
  ('Watts - Texas - National Retail - Green - $20',                     'GREEN_BONUS',     'RETAIL', NULL, NULL, NULL,  'Bono verde por venta Retail.');
