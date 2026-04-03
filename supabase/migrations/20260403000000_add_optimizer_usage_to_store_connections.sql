ALTER TABLE public.store_connections
ADD COLUMN optimizer_runs INTEGER NOT NULL DEFAULT 0,
ADD COLUMN optimizer_period_start TIMESTAMPTZ NOT NULL DEFAULT now();
