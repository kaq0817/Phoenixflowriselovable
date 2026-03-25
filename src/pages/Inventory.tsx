import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Package, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const mockInventory = [
  { title: "Vintage Jacket", vendor: "Printify", qty: 45, status: "synced", action: "POD — auto-managed" },
  { title: "Custom Mug", vendor: "Printful", qty: 120, status: "synced", action: "POD — auto-managed" },
  { title: "Leather Wallet", vendor: "CJ Dropshipping", qty: 0, status: "archived", action: "Auto-archived (OOS)" },
  { title: "Phoenix Necklace", vendor: "Manual", qty: 3, status: "low", action: "Low stock alert sent" },
  { title: "Sneaker Design", vendor: "Manual", qty: 89, status: "synced", action: "Inventory stable" },
];

export default function InventoryPage() {
  const { user } = useAuth();
  const [synced, setSynced] = useState(false);
  const [loading, setLoading] = useState(false);
  const [connections, setConnections] = useState<Array<{ id: string; platform: string; shop_name: string | null; shop_domain: string | null }>>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState("");

  useEffect(() => {
    if (!user) return;
    const fetchConnections = async () => {
      const { data } = await supabase
        .from("store_connections")
        .select("id, platform, shop_name, shop_domain")
        .order("created_at", { ascending: false });
      setConnections(data || []);
    };
    fetchConnections();
  }, [user]);

  const selectedStore = useMemo(
    () => connections.find((connection) => connection.id === selectedConnectionId),
    [connections, selectedConnectionId]
  );

  const handleSync = () => {
    if (!selectedConnectionId) return;
    setLoading(true);
    setTimeout(() => { setLoading(false); setSynced(true); }, 1500);
  };

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Package className="h-6 w-6 text-primary" /> Inventory Sync
        </h1>
        <p className="text-muted-foreground mt-1">Floor enforcement and vendor-based automation per selected store.</p>
      </motion.div>

      <Card className="bg-card/50 border-border/30">
        <CardContent className="p-6 flex flex-col md:flex-row md:items-center gap-4 md:justify-between">
          <div className="space-y-3 w-full md:max-w-md">
            <p className="font-medium text-sm">Sync up to 50 products per burst</p>
            <p className="text-xs text-muted-foreground">Auto-archives OOS dropship items, enforces POD floors.</p>
            <Select value={selectedConnectionId} onValueChange={(value) => { setSelectedConnectionId(value); setSynced(false); }}>
              <SelectTrigger className="bg-background/50">
                <SelectValue placeholder="Select store to sync" />
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
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> {loading ? "Syncing..." : "Run Sync"}
          </Button>
        </CardContent>
      </Card>

      {synced && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="bg-card/50 border-border/30">
            <CardHeader>
              <CardTitle className="text-lg">
                Sync Report {selectedStore ? `· ${selectedStore.platform.toUpperCase()} ${selectedStore.shop_name || selectedStore.shop_domain || "Store"}` : ""}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {mockInventory.map((item, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                  <div>
                    <p className="font-medium text-sm">{item.title}</p>
                    <p className="text-xs text-muted-foreground">{item.vendor} · Qty: {item.qty}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{item.action}</span>
                    <Badge className={
                      item.status === "synced" ? "bg-phoenix-success/10 text-phoenix-success" :
                      item.status === "low" ? "bg-phoenix-warning/10 text-phoenix-warning" :
                      "bg-muted text-muted-foreground"
                    }>{item.status}</Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
