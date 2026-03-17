import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { History, CheckCircle, AlertTriangle } from "lucide-react";

const mockHistory = [
  { product: "Phoenix Ring", type: "description", status: "success", date: "Mar 12, 2026", platform: "shopify" },
  { product: "Iron Bracelet", type: "bulk_analysis", status: "success", date: "Mar 12, 2026", platform: "shopify" },
  { product: "Gold Chain", type: "alt_text", status: "success", date: "Mar 11, 2026", platform: "etsy" },
  { product: "Vintage Jacket", type: "compliance", status: "warning", date: "Mar 11, 2026", platform: "shopify" },
  { product: "Leather Wallet", type: "description", status: "success", date: "Mar 10, 2026", platform: "shopify" },
  { product: "Custom Mug", type: "inventory_sync", status: "success", date: "Mar 10, 2026", platform: "etsy" },
  { product: "Silver Necklace", type: "product_ad", status: "success", date: "Mar 9, 2026", platform: "shopify" },
  { product: "Cotton Tee", type: "description", status: "warning", date: "Mar 8, 2026", platform: "shopify" },
];

export default function HistoryPage() {
  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <History className="h-6 w-6 text-primary" /> History Ledger
        </h1>
        <p className="text-muted-foreground mt-1">All verified optimizations tracked in the truth table.</p>
      </motion.div>

      <Card className="bg-card/50 border-border/30">
        <CardContent className="p-0">
          {mockHistory.map((item, i) => (
            <div key={i} className="flex items-center justify-between p-4 border-b border-border/20 last:border-0 hover:bg-muted/20 transition-colors">
              <div className="flex items-center gap-3">
                {item.status === "success" ? <CheckCircle className="h-4 w-4 text-phoenix-success" /> : <AlertTriangle className="h-4 w-4 text-phoenix-warning" />}
                <div>
                  <p className="font-medium text-sm">{item.product}</p>
                  <p className="text-xs text-muted-foreground">{item.date}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">{item.platform}</Badge>
                <Badge variant="secondary" className="text-xs">{item.type.replace("_", " ")}</Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
