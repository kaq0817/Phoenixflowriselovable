import { useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Zap, Rocket, Crown, Gem, Building2, Shield, CreditCard, Package, ShoppingBag, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  SUBSCRIPTION_TIERS,
  COMPLIANCE_PRODUCTS,
  BUNDLE_PRODUCTS,
  TOTAL_STRIPE_PRODUCTS,
  STRIPE_PRICES,
} from "@/lib/tiers";

const tierIcons: Record<string, React.ElementType> = {
  "Free Trial": Zap,
  "Phoenix Spark - Etsy": Rocket,
  "Phoenix Rise - Etsy": Crown,
  "Phoenix Spark - Shopify 1 Store": Rocket,
  "Phoenix Rise - Shopify 3 stores": Crown,
  "Phoenix Ascend 5 stores": Gem,
  "Phoenix Reign 10 store mix": Gem,
  "Phoenix Transcend(40 Stores)": Building2,
  "Phoenix Spark - Etsy (Annual)": Rocket,
  "Phoenix Rise - Etsy (Annual)": Crown,
  "Phoenix Spark - Shopify (Annual) 1 store": Rocket,
  "Phoenix Rise - Shopify (Annual)": Crown,
  "Phoenix Ascend (Annual)": Gem,
  "Phoenix Reign Annual": Gem,
  "Phoenix Transcend - Agency Elite (Annual)": Building2,
};

type Tab = "subscriptions" | "compliance" | "bundles";

export default function PricingPage() {
  const [tab, setTab] = useState<Tab>("subscriptions");
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly");
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const { toast } = useToast();
  const navigate = useNavigate();

  const handleCheckout = async (priceId: string, mode: "subscription" | "payment", loadingKey: string) => {
    if (!priceId) {
      toast({ title: "Not available", description: "This product isn't set up for checkout yet.", variant: "destructive" });
      return;
    }

    setLoadingId(loadingKey);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({ title: "Sign in required", description: "Please sign in to purchase.", variant: "destructive" });
        return;
      }

      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: { priceId, mode },
      });

      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      toast({ title: "Checkout error", description: message, variant: "destructive" });
    } finally {
      setLoadingId(null);
    }
  };

  const handleFreeTrial = () => {
    toast({
      title: "Free trial ready",
      description: "Connect and verify your store in Settings to start using the free trial.",
    });
    navigate("/settings");
  };

  const filteredSubs = SUBSCRIPTION_TIERS.filter((tier) => {
    if (tier.price === 0) return billing === "monthly";
    return tier.billing === billing || tier.billing === "6-months";
  });

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CreditCard className="h-6 w-6 text-primary" /> Pricing
        </h1>
        <p className="text-muted-foreground mt-1">
          {TOTAL_STRIPE_PRODUCTS} live packages across subscriptions, compliance, and bundles.
        </p>
      </motion.div>

      <div className="flex gap-2 flex-wrap">
        <Button variant={tab === "subscriptions" ? "default" : "secondary"} onClick={() => setTab("subscriptions")}>
          Subscriptions ({SUBSCRIPTION_TIERS.length})
        </Button>
        <Button variant={tab === "compliance" ? "default" : "secondary"} onClick={() => setTab("compliance")}>
          <Shield className="h-4 w-4 mr-1" /> Compliance ({COMPLIANCE_PRODUCTS.length})
        </Button>
        <Button variant={tab === "bundles" ? "default" : "secondary"} onClick={() => setTab("bundles")}>
          <Package className="h-4 w-4 mr-1" /> Bundles ({BUNDLE_PRODUCTS.length})
        </Button>
      </div>

      {tab === "subscriptions" && (
        <>
          <div className="flex items-center gap-2">
            <Button size="sm" variant={billing === "monthly" ? "default" : "outline"} onClick={() => setBilling("monthly")}>
              Monthly
            </Button>
            <Button size="sm" variant={billing === "yearly" ? "default" : "outline"} onClick={() => setBilling("yearly")}>
              Yearly
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredSubs.map((tier, index) => {
              const Icon = tierIcons[tier.name] || ShoppingBag;
              const isPopular = tier.name === "Phoenix Rise - Shopify 3 stores";
              const isLoading = loadingId === tier.stripeId;
              const hasPriceId = tier.price === 0 || !!STRIPE_PRICES[tier.stripeId];
              const priceId = STRIPE_PRICES[tier.stripeId];
              const perStoreCost = tier.stores > 1 && tier.price > 0 ? tier.price / tier.stores : null;

              return (
                <motion.div
                  key={tier.stripeId || "free"}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.08 }}
                >
                  <Card className={`bg-card/50 border-border/30 h-full relative ${isPopular ? "border-primary/50 glow-primary" : ""}`}>
                    {isPopular && (
                      <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2 gradient-phoenix text-primary-foreground">
                        Most Popular
                      </Badge>
                    )}
                    <CardHeader className="text-center pb-2">
                      <Icon className="h-8 w-8 text-primary mx-auto mb-2" />
                      <CardTitle className="text-base leading-tight">{tier.name}</CardTitle>
                      <div className="mt-1">
                        <span className="text-3xl font-bold">${tier.price}</span>
                        <span className="text-muted-foreground text-sm">
                          /{tier.billing === "yearly" ? "year" : tier.billing === "6-months" ? "6 mo" : "mo"}
                        </span>
                      </div>
                      {tier.stores > 0 && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {`${tier.stores} store${tier.stores > 1 ? "s" : ""}`}
                        </p>
                      )}
                      {perStoreCost !== null && (
                        <p className="text-xs text-muted-foreground">
                          ~= ${perStoreCost.toFixed(2)} per store/{tier.billing === "yearly" ? "yr" : "mo"}
                        </p>
                      )}
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-6">
                        {tier.description}
                      </p>
                      <Button
                        className={`w-full ${isPopular ? "gradient-phoenix text-primary-foreground" : ""}`}
                        variant={isPopular ? "default" : "secondary"}
                        disabled={isLoading || !hasPriceId}
                        onClick={() => {
                          if (tier.price === 0) {
                            handleFreeTrial();
                            return;
                          }

                          if (priceId) {
                            handleCheckout(priceId, tier.checkoutMode, tier.stripeId);
                          }
                        }}
                      >
                        {isLoading ? (
                          <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Processing...</>
                        ) : tier.price === 0 ? "Get Started" : tier.checkoutMode === "payment" ? "Buy" : "Subscribe"}
                      </Button>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </>
      )}

      {tab === "compliance" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {COMPLIANCE_PRODUCTS.map((product, index) => {
            const isLoading = loadingId === product.stripeId;
            const priceId = STRIPE_PRICES[product.stripeId];
            const hasPriceId = !!priceId;
            return (
              <motion.div
                key={product.stripeId}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.08 }}
              >
                <Card className={`bg-card/50 border-border/30 h-full relative ${product.name.includes("25") ? "border-primary/50 glow-primary" : ""}`}>
                  {product.name.includes("25") && (
                    <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2 gradient-phoenix text-primary-foreground text-xs">
                      Best Value
                    </Badge>
                  )}
                  <CardHeader className="text-center pb-2">
                    <Shield className="h-8 w-8 text-primary mx-auto mb-2" />
                    <CardTitle className="text-base">{product.name}</CardTitle>
                    <div className="mt-1">
                      <span className="text-3xl font-bold">${product.price}</span>
                      <span className="text-muted-foreground text-sm">/one-time</span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-xs text-muted-foreground leading-relaxed">{product.description}</p>
                    <div className="space-y-1 text-xs">
                      <div className="flex items-center gap-2">
                        <Check className="h-3 w-3 text-phoenix-success shrink-0" />
                        <span>{product.scans} scan{product.scans > 1 ? "s" : ""}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Check className="h-3 w-3 text-phoenix-success shrink-0" />
                        <span>Up to {product.maxProducts.toLocaleString()} products</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Check className="h-3 w-3 text-phoenix-success shrink-0" />
                        <span>Expiry: {product.expiry}</span>
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      className="w-full"
                      disabled={isLoading || !hasPriceId}
                      onClick={() => {
                        if (priceId) handleCheckout(priceId, "payment", product.stripeId);
                      }}
                    >
                      {isLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Processing...</> : "Buy"}
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      {tab === "bundles" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {BUNDLE_PRODUCTS.map((product, index) => {
            const isLoading = loadingId === product.stripeId;
            const priceId = STRIPE_PRICES[product.stripeId];
            const hasPriceId = !!priceId;
            return (
              <motion.div
                key={product.stripeId}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.08 }}
              >
                <Card className="bg-card/50 border-border/30 h-full">
                  <CardHeader className="text-center pb-2">
                    <Package className="h-8 w-8 text-primary mx-auto mb-2" />
                    <CardTitle className="text-base">{product.name}</CardTitle>
                    <div className="mt-1">
                      <span className="text-3xl font-bold">${product.price}</span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-xs text-muted-foreground leading-relaxed">{product.description}</p>
                    <Button
                      variant="secondary"
                      className="w-full"
                      disabled={isLoading || !hasPriceId}
                      onClick={() => {
                        if (priceId) handleCheckout(priceId, "payment", product.stripeId);
                      }}
                    >
                      {isLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Processing...</> : "Buy"}
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
