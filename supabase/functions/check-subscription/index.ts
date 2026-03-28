import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  const d = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[CHECK-SUBSCRIPTION] ${step}${d}`);
};

const STRIPE_API_VERSION: Stripe.LatestApiVersion = "2026-02-25.clover";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header provided");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError) throw new Error(`Authentication error: ${userError.message}`);
    const user = userData.user;
    if (!user?.email) throw new Error("User not authenticated or email not available");
    logStep("User authenticated", { email: user.email });

    const stripe = new Stripe(stripeKey, { apiVersion: STRIPE_API_VERSION });
    const { data: profile } = await supabaseClient
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .maybeSingle();

    let customerId = profile?.stripe_customer_id ?? null;

    if (!customerId) {
      const customers = await stripe.customers.list({ email: user.email, limit: 1 });
      customerId = customers.data[0]?.id ?? null;
    }

    if (!customerId) {
      logStep("No customer found");
      return new Response(JSON.stringify({ subscribed: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    logStep("Found customer", { customerId });

    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 10,
    });

    const activeStatuses = new Set(["active", "trialing", "past_due"]);
    const activeSubscription = subscriptions.data.find((sub: Stripe.Subscription) => activeStatuses.has(sub.status));
    const hasActiveSub = !!activeSubscription;
    let productId = null;
    let subscriptionEnd = null;

    if (hasActiveSub) {
      const sub = activeSubscription as Stripe.Subscription;
      subscriptionEnd = new Date(sub.current_period_end * 1000).toISOString();
      productId = sub.items.data[0].price.product;
      logStep("Active subscription", { productId, subscriptionEnd });
    } else {
      logStep("No active subscription");
    }

    return new Response(
      JSON.stringify({ subscribed: hasActiveSub, product_id: productId, subscription_end: subscriptionEnd }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: msg });
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
