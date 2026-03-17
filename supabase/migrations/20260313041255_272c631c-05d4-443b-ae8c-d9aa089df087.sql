
-- Scan jobs table for autonomous background scanning
CREATE TABLE public.scan_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  platform text NOT NULL DEFAULT 'etsy',
  status text NOT NULL DEFAULT 'pending',
  scan_type text NOT NULL DEFAULT 'listing_audit',
  total_items integer NOT NULL DEFAULT 0,
  processed_items integer NOT NULL DEFAULT 0,
  findings jsonb DEFAULT '[]'::jsonb,
  summary jsonb DEFAULT '{}'::jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

-- Enable RLS
ALTER TABLE public.scan_jobs ENABLE ROW LEVEL SECURITY;

-- Users can read their own scan jobs
CREATE POLICY "Users can read own scan jobs" ON public.scan_jobs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Users can insert own scan jobs
CREATE POLICY "Users can insert own scan jobs" ON public.scan_jobs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Users can update own scan jobs  
CREATE POLICY "Users can update own scan jobs" ON public.scan_jobs
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- Enable realtime for progress tracking
ALTER PUBLICATION supabase_realtime ADD TABLE public.scan_jobs;
