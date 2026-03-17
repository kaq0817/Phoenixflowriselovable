
CREATE TABLE public.store_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('shopify', 'etsy')),
  shop_domain TEXT,
  shop_name TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  scopes TEXT,
  token_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, shop_domain)
);

ALTER TABLE public.store_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own connections"
  ON public.store_connections FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own connections"
  ON public.store_connections FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own connections"
  ON public.store_connections FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own connections"
  ON public.store_connections FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
