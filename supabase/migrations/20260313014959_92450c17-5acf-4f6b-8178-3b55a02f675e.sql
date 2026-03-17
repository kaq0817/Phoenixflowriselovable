
CREATE TABLE public.listing_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  store_connection_id uuid REFERENCES public.store_connections(id) ON DELETE CASCADE NOT NULL,
  etsy_listing_id bigint NOT NULL,
  snapshot_data jsonb NOT NULL,
  action_type text NOT NULL DEFAULT 'optimization',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.listing_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own snapshots"
  ON public.listing_snapshots FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own snapshots"
  ON public.listing_snapshots FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own snapshots"
  ON public.listing_snapshots FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX idx_listing_snapshots_user ON public.listing_snapshots(user_id);
CREATE INDEX idx_listing_snapshots_listing ON public.listing_snapshots(etsy_listing_id);
