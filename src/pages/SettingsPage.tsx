import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Settings as SettingsIcon, Store, Loader2, Unlink, LogOut, Key, HelpCircle, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

interface StoreConnection {
  id: string;
  platform: string;
  shop_domain: string | null;
  shop_name: string | null;
  scopes: string | null;
  created_at: string;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export default function SettingsPage() {
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const [connections, setConnections] = useState<StoreConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  // Shopify form
  const [showShopifyForm, setShowShopifyForm] = useState(false);
  const [shopifyDomain, setShopifyDomain] = useState("");
  const [shopifyAdminToken, setShopifyAdminToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [showTokenHelp, setShowTokenHelp] = useState(false);

  // Etsy form
  const [showEtsyForm, setShowEtsyForm] = useState(false);
  const [etsyConnecting, setEtsyConnecting] = useState(false);

  const fetchConnections = async () => {
    const { data, error } = await supabase
      .from("store_connections")
      .select("id, platform, shop_domain, shop_name, scopes, created_at");
    if (!error && data) setConnections(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchConnections();
  }, []);

  const shopifyConnections = connections.filter((c) => c.platform === "shopify");
  const etsyConnections = connections.filter((c) => c.platform === "etsy");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const etsyStatus = params.get("etsy");
    const etsyMessage = params.get("etsy_message");
    if (!etsyStatus) return;

    if (etsyStatus === "connected") {
      toast({ title: "Etsy connected", description: etsyMessage || "Your Etsy OAuth connection is active." });
      void fetchConnections();
    } else {
      toast({
        title: etsyStatus === "denied" ? "Etsy authorization denied" : "Etsy connection failed",
        description: etsyMessage || "The Etsy OAuth flow did not complete.",
        variant: "destructive",
      });
    }

    params.delete("etsy");
    params.delete("etsy_message");
    const nextQuery = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`);
  }, [toast]);

  const handleShopifyConnect = async () => {
    const domain = shopifyDomain.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (!domain.includes(".myshopify.com")) {
      toast({ title: "Invalid domain", description: "Enter your myshopify.com domain (e.g. mystore.myshopify.com)", variant: "destructive" });
      return;
    }
    if (!shopifyAdminToken.trim()) {
      toast({ title: "Missing token", description: "Paste your Admin API access token", variant: "destructive" });
      return;
    }
    // Check if this domain is already connected
    if (shopifyConnections.some((c) => c.shop_domain === domain)) {
      toast({ title: "Already connected", description: "This Shopify store is already linked.", variant: "destructive" });
      return;
    }

    setConnecting(true);
    try {
      const { error } = await supabase.functions.invoke("shopify-manual-connect", {
        body: { shop: domain, accessToken: shopifyAdminToken.trim() },
      });
      if (error) throw error;
      toast({ title: "Shopify Connected!", description: "Your store is linked and ready to optimize." });
      setShopifyAdminToken("");
      setShopifyDomain("");
      setShowShopifyForm(false);
      fetchConnections();
    } catch (error: unknown) {
      toast({ title: "Connection failed", description: getErrorMessage(error, "Could not connect Shopify store."), variant: "destructive" });
    } finally {
      setConnecting(false);
    }
  };

  const handleEtsyConnect = async () => {
    setEtsyConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke("etsy-auth");
      if (error) throw error;
      if (!data?.url) throw new Error("Etsy authorization URL was not returned");

      setShowEtsyForm(false);
      window.location.href = data.url;
    } catch (error: unknown) {
      toast({ title: "Connection failed", description: getErrorMessage(error, "Could not start Etsy authorization."), variant: "destructive" });
      setEtsyConnecting(false);
    }
  };

  const handleDisconnect = async (connectionId: string, platform: string) => {
    setDisconnecting(connectionId);
    try {
      // Delete the specific connection by id
      const { error } = await supabase
        .from("store_connections")
        .delete()
        .eq("id", connectionId);
      if (error) throw error;
      toast({ title: "Disconnected", description: `${platform} store has been disconnected.` });
      fetchConnections();
    } catch (error: unknown) {
      toast({ title: "Error", description: getErrorMessage(error, "Could not disconnect store."), variant: "destructive" });
    } finally {
      setDisconnecting(null);
    }
  };

  const renderConnectionCard = (conn: StoreConnection) => (
    <div key={conn.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
      <div>
        <p className="text-sm font-medium">{conn.shop_name || conn.shop_domain || "Store"}</p>
        <p className="text-xs text-muted-foreground">{conn.shop_domain}</p>
      </div>
      <Button
        variant="destructive"
        size="sm"
        disabled={disconnecting === conn.id}
        onClick={() => handleDisconnect(conn.id, conn.platform)}
      >
        {disconnecting === conn.id ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Unlink className="h-4 w-4 mr-1" />}
        Disconnect
      </Button>
    </div>
  );

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <SettingsIcon className="h-6 w-6 text-primary" /> Settings
        </h1>
        <p className="text-muted-foreground mt-1">Connect your stores so Phoenix Flow can optimize your listings.</p>
      </motion.div>

      {/* Shopify Connections */}
      <Card className="bg-card/50 border-border/30">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-lg flex items-center gap-2">
              <Store className="h-5 w-5 text-primary" /> Shopify Stores
            </h2>
            {shopifyConnections.length > 0 && (
              <Badge variant="outline" className="text-phoenix-success border-phoenix-success/50">
                {shopifyConnections.length} Connected
              </Badge>
            )}
          </div>

          {shopifyConnections.length > 0 && (
            <div className="space-y-2">
              {shopifyConnections.map(renderConnectionCard)}
            </div>
          )}

          {!showShopifyForm ? (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setShowShopifyForm(true)}
            >
              <Plus className="h-4 w-4 mr-2" /> Add Shopify Store
            </Button>
          ) : (
            <div className="space-y-4 border border-border/50 rounded-lg p-4">
              <p className="text-sm text-muted-foreground">
                Connect a Shopify store with domain + Admin API token (no app install required).
              </p>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Store Domain</label>
                  <Input
                    placeholder="mystore.myshopify.com"
                    className="bg-muted/50"
                    value={shopifyDomain}
                    onChange={(e) => setShopifyDomain(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">Admin API Access Token</label>
                    <button
                      onClick={() => setShowTokenHelp(!showTokenHelp)}
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      <HelpCircle className="h-3 w-3" /> How to get this
                    </button>
                  </div>
                  <Input
                    type="password"
                    placeholder="shpat_..."
                    className="bg-muted/50"
                    value={shopifyAdminToken}
                    onChange={(e) => setShopifyAdminToken(e.target.value)}
                  />
                </div>
                {showTokenHelp && (
                  <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 space-y-2 text-sm">
                    <p className="font-medium text-primary">Getting your Admin API token:</p>
                    <ol className="list-decimal list-inside space-y-1 text-muted-foreground text-xs">
                      <li>Open your Shopify admin → <strong>Settings</strong> → <strong>Apps and sales channels</strong></li>
                      <li>Click <strong>Develop apps</strong> (top-right) → <strong>Create an app</strong></li>
                      <li>Name it "Phoenix Flow" → click <strong>Configure Admin API scopes</strong></li>
                      <li>Enable: <code className="bg-muted px-1 rounded">read_products</code>, <code className="bg-muted px-1 rounded">write_products</code></li>
                      <li>Click <strong>Install app</strong> → copy the <strong>Admin API access token</strong></li>
                      <li>Paste it above — we'll handle the rest!</li>
                    </ol>
                  </div>
                )}
                <div className="flex gap-2">
                  <Button
                    className="gradient-phoenix text-primary-foreground flex-1"
                    disabled={connecting || !shopifyDomain.trim() || !shopifyAdminToken.trim()}
                    onClick={handleShopifyConnect}
                  >
                    {connecting ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Connecting...</>
                    ) : (
                      <><Key className="h-4 w-4 mr-2" /> Connect Store</>
                    )}
                  </Button>
                  <Button variant="ghost" onClick={() => setShowShopifyForm(false)}>Cancel</Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Etsy Connections */}
      <Card className="bg-card/50 border-border/30">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-lg flex items-center gap-2">
              <Store className="h-5 w-5 text-accent" /> Etsy Shops
            </h2>
            {etsyConnections.length > 0 && (
              <Badge variant="outline" className="text-phoenix-success border-phoenix-success/50">
                {etsyConnections.length} Connected
              </Badge>
            )}
          </div>

          {etsyConnections.length > 0 && (
            <div className="space-y-2">
              {etsyConnections.map(renderConnectionCard)}
            </div>
          )}

          {!showEtsyForm ? (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setShowEtsyForm(true)}
            >
              <Plus className="h-4 w-4 mr-2" /> Add Etsy Shop
            </Button>
          ) : (
            <div className="space-y-4 border border-border/50 rounded-lg p-4">
              <p className="text-sm text-muted-foreground">
                Connect your Etsy shop with Etsy OAuth so Phoenix Flow can read listings, write listing updates, and present a cleaner app-review story with minimal scopes.
              </p>
              <div className="flex gap-2">
                <Button
                  className="gradient-phoenix text-primary-foreground flex-1"
                  disabled={etsyConnecting}
                  onClick={handleEtsyConnect}
                >
                  {etsyConnecting ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Redirecting to Etsy...</>
                  ) : (
                    <><Store className="h-4 w-4 mr-2" /> Connect with Etsy</>
                  )}
                </Button>
                <Button variant="ghost" onClick={() => setShowEtsyForm(false)}>Cancel</Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Etsy will ask for `listings_r`, `listings_w`, and `shops_r`, then return here with a signed callback result.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Account */}
      <Card className="bg-card/50 border-border/30">
        <CardContent className="p-6 space-y-4">
          <h2 className="font-semibold text-lg">Account</h2>
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
            <div>
              <p className="font-medium text-sm">Email</p>
              <p className="text-xs text-muted-foreground">{user?.email || "—"}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={signOut}>
            <LogOut className="h-4 w-4 mr-2" /> Sign Out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}







