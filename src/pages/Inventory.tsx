import { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Package, RefreshCw } from "lucide-react";

const mockInventory = [
  { title: "Vintage Jacket", vendor: "Printify", qty: 45, status: "synced", action: "POD — auto-managed" },
  { title: "Custom Mug", vendor: "Printful", qty: 120, status: "synced", action: "POD — auto-managed" },
  { title: "Leather Wallet", vendor: "CJ Dropshipping", qty: 0, status: "archived", action: "Auto-archived (OOS)" },
  { title: "Phoenix Necklace", vendor: "Manual", qty: 3, status: "low", action: "Low stock alert sent" },
  { title: "Sneaker Design", vendor: "Manual", qty: 89, status: "synced", action: "Inventory stable" },
];

export default function InventoryPage() {
  const [synced, setSynced] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSync = () => {
    setLoading(true);
    setTimeout(() => { setLoading(false); setSynced(true); }, 1500);
  };

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Package className="h-6 w-6 text-primary" /> Inventory Sync
        </h1>
        <p className="text-muted-foreground mt-1">Floor enforcement and vendor-based automation.</p>
      </motion.div>

      <Card className="bg-card/50 border-border/30">
        <CardContent className="p-6 flex items-center justify-between">
          <div>
            <p className="font-medium text-sm">Sync up to 50 products per burst</p>
            <p className="text-xs text-muted-foreground">Auto-archives OOS dropship items, enforces POD floors.</p>
          </div>
          <Button onClick={handleSync} disabled={loading} className="gradient-phoenix text-primary-foreground">
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> {loading ? "Syncing..." : "Run Sync"}
          </Button>
        </CardContent>
      </Card>

      {synced && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="bg-card/50 border-border/30">
            <CardHeader><CardTitle className="text-lg">Sync Report</CardTitle></CardHeader>
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
