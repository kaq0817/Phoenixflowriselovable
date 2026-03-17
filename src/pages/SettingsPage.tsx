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
  const [etsyShopUrl, setEtsyShopUrl] = useState("");
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
    } catch (err: any) {
      toast({ title: "Connection failed", description: err.message, variant: "destructive" });
    } finally {
      setConnecting(false);
    }
  };

  const handleEtsyConnect = async () => {
    const name = etsyShopUrl.trim();
    if (!name) {
      toast({ title: "Missing shop name", description: "Enter your Etsy shop name or URL", variant: "destructive" });
      return;
    }
    setEtsyConnecting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fetch-etsy-public-listings`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ shopName: name, limit: 1 }),
        }
      );
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Shop not found");

      const shopId = String(result.shop_id);

      // Check if already connected
      if (etsyConnections.some((c) => c.shop_domain === shopId)) {
        toast({ title: "Already connected", description: `Shop "${result.shop_name}" is already linked.`, variant: "destructive" });
        setEtsyConnecting(false);
        return;
      }

      // Insert new connection (not upsert — allow multiple)
      const { error } = await supabase.from("store_connections").insert({
        user_id: session.user.id,
        platform: "etsy",
        shop_name: result.shop_name,
        shop_domain: shopId,
        access_token: "public_only",
        scopes: "public_read",
      });
      if (error) throw error;

      toast({ title: "Etsy Connected!", description: `Shop "${result.shop_name}" linked successfully.` });
      setEtsyShopUrl("");
      setShowEtsyForm(false);
      fetchConnections();
    } catch (err: any) {
      toast({ title: "Connection failed", description: err.message || "Could not find that shop.", variant: "destructive" });
    } finally {
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
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
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
                Enter your Etsy shop name or URL to scan and optimize your listings with AI.
              </p>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Shop Name or URL</label>
                  <Input
                    placeholder="MyShopName or etsy.com/shop/MyShopName"
                    className="bg-muted/50"
                    value={etsyShopUrl}
                    onChange={(e) => setEtsyShopUrl(e.target.value)}
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    className="gradient-phoenix text-primary-foreground flex-1"
                    disabled={etsyConnecting || !etsyShopUrl.trim()}
                    onClick={handleEtsyConnect}
                  >
                    {etsyConnecting ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Connecting...</>
                    ) : (
                      <><Store className="h-4 w-4 mr-2" /> Connect Shop</>
                    )}
                  </Button>
                  <Button variant="ghost" onClick={() => setShowEtsyForm(false)}>Cancel</Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                We'll read your public listing data — no Etsy app install or OAuth needed.
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
