import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  apiVersion: "2024-06-20",
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-stripe-signature-v1",
};

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
      Deno.env.get("STRIPE_WEBHOOK_SECRET")!
    );
  } catch (err) {
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "subscription") {
          const subscriptionId = session.subscription as string;
          const customerId = session.customer as string;

          const subscription = await stripe.subscriptions.retrieve(subscriptionId);

          const { error } = await supabaseAdmin
            .from("profiles")
            .update({
              subscription_id: subscription.id,
              stripe_customer_id: customerId,
              subscription_status: subscription.status,
              product_id: subscription.items.data[0].price.product as string,
              current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            })
            .eq("stripe_customer_id", customerId);

          if (error) throw new Error(`Failed to update profile for customer ${customerId}: ${error.message}`);
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const { error } = await supabaseAdmin
          .from("profiles")
          .update({
            subscription_status: subscription.status,
            product_id: subscription.items.data[0].price.product as string,
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          })
          .eq("subscription_id", subscription.id);
        
        if (error) throw new Error(`Failed to update subscription ${subscription.id}: ${error.message}`);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const { error } = await supabaseAdmin
          .from("profiles")
          .update({
            subscription_status: "canceled",
            current_period_end: null,
          })
          .eq("subscription_id", subscription.id);

        if (error) throw new Error(`Failed to cancel subscription ${subscription.id}: ${error.message}`);
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
    return new Response(`Webhook handler error: ${error.message}`, { status: 500 });
  }
});
