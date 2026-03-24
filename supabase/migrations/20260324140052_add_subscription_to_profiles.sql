ALTER TABLE public.profiles
ADD COLUMN stripe_customer_id TEXT,
ADD COLUMN subscription_status TEXT,
ADD COLUMN subscription_id TEXT,
ADD COLUMN current_period_end TIMESTAMPTZ,
ADD COLUMN product_id TEXT;
