ALTER TABLE public.scan_jobs
ADD COLUMN store_connection_id uuid REFERENCES public.store_connections(id) ON DELETE SET NULL;
