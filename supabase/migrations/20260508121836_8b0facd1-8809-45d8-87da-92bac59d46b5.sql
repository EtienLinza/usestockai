ALTER TABLE public.virtual_positions
  ADD COLUMN IF NOT EXISTS partial_exits_taken integer NOT NULL DEFAULT 0;