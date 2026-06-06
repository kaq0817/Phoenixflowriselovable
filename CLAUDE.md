# Phoenix Flow — AI Assistant Rules

## CRITICAL: This is a PAID CUSTOMER-FACING SaaS Product

**DO NOT remove, bypass, loosen, or comment out any paywall, subscription check, or auth gate.**

This app is a live commercial product with paying customers. Users pay $12–$1,999/month.
Removing subscription checks causes direct revenue loss.

### Paywall enforcement locations — NEVER touch these:
- `src/components/SubscribedRoute.tsx` — subscription gate for all premium routes
- `src/components/ProtectedRoute.tsx` — login gate for all authenticated routes  
- `src/contexts/AuthContext.tsx` — subscription status fetching (must check Supabase + Stripe)
- `supabase/functions/optimize-shopify-listing/index.ts` — server-side subscription check
- `supabase/functions/optimize-etsy-listing/index.ts` — server-side subscription check
- `supabase/functions/run-listing-scan/index.ts` — server-side subscription check
- Any other `supabase/functions/*/index.ts` that calls `has_role` or checks `subscription_status`

### This app is NOT:
- A private admin tool
- An internal dashboard  
- A personal utility

### This app IS:
- A public SaaS sold to Shopify and Etsy merchants
- A product with a pricing page at /pricing
- A product with Stripe billing and Supabase Auth

## Architecture
- Frontend: Vite + React + Tailwind + shadcn/ui, deployed on Vercel
- Auth + DB: Supabase (project: nkabxuelejvvdwyvtwmz)
- Payments: Stripe (webhook → Supabase profiles.subscription_status)
- AI: Gemini API via Supabase Edge Functions
- Platform integrations: Shopify Admin API, Etsy API

## When asked to fix the paywall being open:
Check `profiles.subscription_status` in Supabase dashboard first.
The field must be `"active"` or `"trialing"` for access. 
Check that the Stripe webhook is firing correctly to `supabase/functions/stripe-webhook`.

## Keyword/SEO quality:
The AI prompts live in `supabase/functions/optimize-shopify-listing/` and `optimize-etsy-listing/`.
When improving keyword quality, update the system prompts in those files.
Pull real search data from TikTok Trends API (`supabase/functions/_shared/tiktokTrends.ts`)
and SerpAPI when improving keyword relevance.
