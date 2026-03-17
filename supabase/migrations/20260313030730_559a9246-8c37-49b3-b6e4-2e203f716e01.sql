
CREATE TABLE public.compliance_scans (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  store_url text NOT NULL,
  scan_type text NOT NULL DEFAULT 'full',
  status text NOT NULL DEFAULT 'pending',
  results jsonb,
  score integer,
  critical_count integer DEFAULT 0,
  warning_count integer DEFAULT 0,
  passed_count integer DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone
);

ALTER TABLE public.compliance_scans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own scans" ON public.compliance_scans
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own scans" ON public.compliance_scans
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own scans" ON public.compliance_scans
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
