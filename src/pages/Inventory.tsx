import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Package, RefreshCw, AlertTriangle, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const mockInventory = [
  { title: "Vintage Jacket", vendor: "Printify", qty: 45, status: "synced", action: "POD auto-managed" },
  { title: "Custom Mug", vendor: "Printful", qty: 120, status: "synced", action: "POD auto-managed" },
  { title: "Leather Wallet", vendor: "CJ Dropshipping", qty: 0, status: "archived", action: "Auto-archived (OOS)" },
  { title: "Phoenix Necklace", vendor: "Manual", qty: 3, status: "low", action: "Low stock alert sent" },
  { title: "Sneaker Design", vendor: "Manual", qty: 89, status: "synced", action: "Inventory stable" },
];

interface StoreConnection {
  id: string;
  platform: string;
  shop_name: string | null;
  shop_domain: string | null;
}

export default function InventoryPage() {
  const { user } = useAuth();
  const [revealed, setRevealed] = useState(false);
  const [synced, setSynced] = useState(false);
  const [loading, setLoading] = useState(false);
  const [connections, setConnections] = useState<StoreConnection[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState("");

  useEffect(() => {
    if (!user) return;
    const fetchConnections = async () => {
      const { data } = await supabase
        .from("store_connections")
        .select("id, platform, shop_name, shop_domain")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      setConnections((data || []) as StoreConnection[]);
    };
    fetchConnections();
  }, [user]);

  const selectedStore = useMemo(
    () => connections.find((connection) => connection.id === selectedConnectionId),
    [connections, selectedConnectionId],
  );

  const handleSync = () => {
    if (!selectedConnectionId) return;
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setSynced(true);
    }, 1500);
  };

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Package className="h-6 w-6 text-primary" /> Inventory
        </h1>
        <p className="text-muted-foreground mt-1">Manual workspace only. This stays out of the main flow until you explicitly call it up.</p>
      </motion.div>

      <Card className="bg-card/50 border-border/30">
        <CardContent className="p-6 space-y-4">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
            <AlertTriangle className="mr-2 inline h-4 w-4 text-amber-300" />
            Inventory is not auto-run here. Use it only when you intentionally want a store-level inventory review or sync pass.
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-sm">Call Up Inventory Workspace</p>
              <p className="text-xs text-muted-foreground">Open the controls only when you are ready to inspect a specific store.</p>
            </div>
            <Button onClick={() => setRevealed((current) => !current)} variant={revealed ? "outline" : "default"} className={revealed ? "" : "gradient-phoenix text-primary-foreground"}>
              <ChevronRight className={`mr-2 h-4 w-4 transition-transform ${revealed ? "rotate-90" : ""}`} />
              {revealed ? "Hide Inventory Workspace" : "Call Up Inventory"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {revealed && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          <Card className="bg-card/50 border-border/30">
            <CardContent className="p-6 flex flex-col md:flex-row md:items-center gap-4 md:justify-between">
              <div className="space-y-3 w-full md:max-w-md">
                <p className="font-medium text-sm">Manual sync review</p>
                <p className="text-xs text-muted-foreground">Choose a store first. Nothing runs until you trigger it.</p>
                <Select
                  value={selectedConnectionId}
                  onValueChange={(value) => {
                    setSelectedConnectionId(value);
                    setSynced(false);
                  }}
                >
                  <SelectTrigger className="bg-background/50">
                    <SelectValue placeholder="Select store to review" />
                  </SelectTrigger>
                  <SelectContent>
                    {connections.map((connection) => (
                      <SelectItem key={connection.id} value={connection.id}>
                        {connection.platform.toUpperCase()} · {connection.shop_name || connection.shop_domain || "Connected store"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleSync} disabled={loading || !selectedConnectionId} className="gradient-phoenix text-primary-foreground">
                <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                {loading ? "Running Review..." : "Run Inventory Review"}
              </Button>
            </CardContent>
          </Card>

          {synced && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
              <Card className="bg-card/50 border-border/30">
                <CardHeader>
                  <CardTitle className="text-lg">
                    Inventory Review {selectedStore ? `· ${selectedStore.platform.toUpperCase()} ${selectedStore.shop_name || selectedStore.shop_domain || "Store"}` : ""}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {mockInventory.map((item) => (
                    <div key={`${item.title}-${item.vendor}`} className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                      <div>
                        <p className="font-medium text-sm">{item.title}</p>
                        <p className="text-xs text-muted-foreground">{item.vendor} · Qty: {item.qty}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{item.action}</span>
                        <Badge
                          className={
                            item.status === "synced"
                              ? "bg-phoenix-success/10 text-phoenix-success"
                              : item.status === "low"
                                ? "bg-phoenix-warning/10 text-phoenix-warning"
                                : "bg-muted text-muted-foreground"
                          }
                        >
                          {item.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </motion.div>
          )}
        </motion.div>
      )}
    </div>
  );
}
