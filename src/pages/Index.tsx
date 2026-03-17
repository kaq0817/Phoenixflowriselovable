import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Flame, Zap, Shield, BarChart3, TrendingUp, Package, AlertTriangle, CheckCircle } from "lucide-react";

const stats = [
  { label: "Products Optimized", value: "2,847", change: "+12%", icon: Zap, trend: "up" },
  { label: "SEO Score Avg", value: "87/100", change: "+5pts", icon: TrendingUp, trend: "up" },
  { label: "Compliance Status", value: "Passed", change: "All clear", icon: Shield, trend: "up" },
  { label: "Inventory Synced", value: "1,204", change: "Live", icon: Package, trend: "up" },
];

const recentActions = [
  { action: "Bulk SEO optimization", products: 50, status: "success", time: "2 min ago" },
  { action: "Compliance audit scan", products: 1204, status: "success", time: "15 min ago" },
  { action: "Alt text generation", products: 25, status: "success", time: "1 hr ago" },
  { action: "Inventory sync", products: 300, status: "warning", time: "3 hrs ago" },
  { action: "Description burst", products: 5, status: "success", time: "5 hrs ago" },
];

const Index = () => {
  return (
    <div className="space-y-6">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-xl gradient-phoenix p-8"
      >
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <Flame className="h-8 w-8 text-primary-foreground" />
            <h1 className="text-3xl font-bold text-primary-foreground">Mission Control</h1>
          </div>
          <p className="text-primary-foreground/80 max-w-lg">
            Phoenix Flow Workstation — AI-powered SEO, compliance, and multi-platform optimization engine.
          </p>
          <div className="flex gap-3 mt-4">
            <Button variant="secondary" className="bg-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/30 border-0">
              <Zap className="mr-2 h-4 w-4" /> Quick Scan
            </Button>
            <Button variant="secondary" className="bg-primary-foreground/10 text-primary-foreground hover:bg-primary-foreground/20 border-0">
              <Shield className="mr-2 h-4 w-4" /> Run Audit
            </Button>
          </div>
        </div>
        <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-accent/20 blur-3xl" />
        <div className="absolute -left-10 -bottom-10 w-32 h-32 rounded-full bg-primary/20 blur-3xl" />
      </motion.div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
          >
            <Card className="bg-card/50 border-border/30 hover:border-primary/30 transition-colors">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <stat.icon className="h-5 w-5 text-primary" />
                  <Badge variant="secondary" className="text-xs bg-phoenix-success/10 text-phoenix-success">
                    {stat.change}
                  </Badge>
                </div>
                <p className="text-2xl font-bold">{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Recent Actions */}
      <Card className="bg-card/50 border-border/30">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            Recent Actions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {recentActions.map((action, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-3">
                  {action.status === "success" ? (
                    <CheckCircle className="h-4 w-4 text-phoenix-success" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-phoenix-warning" />
                  )}
                  <div>
                    <p className="text-sm font-medium">{action.action}</p>
                    <p className="text-xs text-muted-foreground">{action.products} products · {action.time}</p>
                  </div>
                </div>
                <Badge variant={action.status === "success" ? "secondary" : "outline"} className={action.status === "success" ? "bg-phoenix-success/10 text-phoenix-success" : "border-phoenix-warning text-phoenix-warning"}>
                  {action.status}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Index;
