-- Soft-delete column for stores. When the CEO "deletes" a store that has
-- historical assignments, we set deleted_at instead of removing the row,
-- so /assignments/history can still resolve the store reference.
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_stores_deleted_at ON public.stores (deleted_at);
