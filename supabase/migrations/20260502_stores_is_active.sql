-- Sesión 11 / Prompt B: per-store activation toggle. Inactive stores stay
-- in the table for historical reference (existing assignments retain their
-- store_id) but are filtered out of the assignment-form selector.
ALTER TABLE public.stores
  ADD COLUMN is_active boolean NOT NULL DEFAULT true;
