import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";

const STRIPE_API_VERSION: Stripe.LatestApiVersion = "2026-02-25.clover";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  apiVersion: STRIPE_API_VERSION,
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-stripe-signature-v1",
};

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

type ProfileUpdate = {
  stripe_customer_id?: string;
  subscription_id?: string | null;
  subscription_status?: string | null;
  product_id?: string | null;
  current_period_end?: string | null;
};

type ProfileMatcher = {
  userId?: string | null;
  stripeCustomerId?: string | null;
  email?: string | null;
};

const updateProfile = async (match: ProfileMatcher, updates: ProfileUpdate) => {
  if (match.userId) {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .update(updates)
      .eq("id", match.userId)
      .select("id");

    if (error) throw new Error(`Failed to update profile ${match.userId}: ${error.message}`);
    if ((data?.length ?? 0) > 0) return;
  }

  if (match.stripeCustomerId) {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .update(updates)
      .eq("stripe_customer_id", match.stripeCustomerId)
      .select("id");

    if (error) throw new Error(`Failed to update profile for customer ${match.stripeCustomerId}: ${error.message}`);
    if ((data?.length ?? 0) > 0) return;
  }

  if (match.email) {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .update(updates)
      .eq("email", match.email)
      .select("id");

    if (error) throw new Error(`Failed to update profile for email ${match.email}: ${error.message}`);
    if ((data?.length ?? 0) > 0) return;
  }

  throw new Error("No matching profile found for Stripe event");
};

const extractSessionUserId = (session: Stripe.Checkout.Session) =>
  session.metadata?.supabase_user_id ?? session.client_reference_id ?? null;

const getSubscriptionProductId = (subscription: Stripe.Subscription) =>
  subscription.items.data[0]?.price.product
    ? String(subscription.items.data[0].price.product)
    : null;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const signature = req.headers.get("Stripe-Signature");
  if (!signature) {
    return new Response("Missing Stripe signature", { status: 400 });
  }

  const body = await req.text();
  let event: Stripe.Event;

  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      Deno.env.get("STRIPE_WEBHOOK_SECRET")!,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(`Webhook Error: ${message}`, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = extractSessionUserId(session);
        const customerId = typeof session.customer === "string" ? session.customer : null;
        const email = session.customer_details?.email ?? session.metadata?.user_email ?? null;

        if (session.mode === "subscription") {
          const subscriptionId = typeof session.subscription === "string" ? session.subscription : null;
          if (!subscriptionId) throw new Error("Subscription checkout completed without a subscription ID");

          const subscription = await stripe.subscriptions.retrieve(subscriptionId);

          await updateProfile(
            { userId, stripeCustomerId: customerId, email },
            {
              subscription_id: subscription.id,
              stripe_customer_id: customerId ?? undefined,
              subscription_status: subscription.status,
              product_id: getSubscriptionProductId(subscription),
              current_period_end: subscription.current_period_end
                ? new Date(subscription.current_period_end * 1000).toISOString()
                : null,
            },
          );
        } else if (customerId) {
          await updateProfile(
            { userId, stripeCustomerId: customerId, email },
            { stripe_customer_id: customerId },
          );
        }

        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = typeof subscription.customer === "string" ? subscription.customer : null;
        const metadataUserId = subscription.metadata?.supabase_user_id ?? null;
        const customer = customerId
          ? await stripe.customers.retrieve(customerId)
          : null;
        const email =
          customer && !("deleted" in customer) && customer.email
            ? customer.email
            : null;

        await updateProfile(
          { userId: metadataUserId, stripeCustomerId: customerId, email },
          {
            stripe_customer_id: customerId ?? undefined,
            subscription_id: subscription.id,
            subscription_status: event.type === "customer.subscription.deleted" ? "canceled" : subscription.status,
            product_id: event.type === "customer.subscription.deleted" ? null : getSubscriptionProductId(subscription),
            current_period_end:
              event.type === "customer.subscription.deleted"
                ? null
                : subscription.current_period_end
                  ? new Date(subscription.current_period_end * 1000).toISOString()
                  : null,
          },
        );

        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(`Webhook handler error: ${message}`, { status: 500 });
  }
});
