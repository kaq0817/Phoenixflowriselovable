import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Flame, Zap, Shield, BarChart3, Layers, FileText, Image, Package,
  Flower2, Palette, Scan, Bot, History, Radio, Settings, Cpu
} from "lucide-react";
import { Link } from "react-router-dom";

const commandCenterItems = [
  { title: "SEO Scanner", description: "Scan products, find issues, and generate fixes.", url: "/phoenix", icon: Zap },
  { title: "Optimizer", description: "Open one product and optimize it step by step.", url: "/optimizer", icon: BarChart3 },
  { title: "Bulk Analyzer", description: "Run larger listing workflows in one place.", url: "/bulk-analyzer", icon: Layers },
  { title: "Descriptions", description: "Generate product copy and admin content.", url: "/descriptions", icon: FileText },
  { title: "Media Tools", description: "Image and media utilities.", url: "/media", icon: Image },
  { title: "Inventory", description: "Review inventory and related store data.", url: "/inventory", icon: Package },
];

const toolsItems = [
  { title: "Listing Optimizer", description: "Optimize Etsy listings.", url: "/etsy-optimizer", icon: Flower2 },
  { title: "Listing Scanner", description: "Scan listing issues in bulk.", url: "/listing-scan", icon: Scan },
  { title: "Templanator", description: "Private Shopify repair workflow.", url: "/templanator", icon: Cpu },
  { title: "Theme Compliance", description: "Theme audit and compliance checks.", url: "/theme-audit", icon: Palette },
  { title: "Compliance Audit", description: "Misrepresentation risk scan for admin review.", url: "/audit", icon: Shield },
  { title: "AI Bot", description: "Assistant tools and guided workflows.", url: "/bot", icon: Bot },
  { title: "History", description: "Review prior actions and results.", url: "/history", icon: History },
  { title: "Free Radio", description: "Music library and playback.", url: "/radio", icon: Radio },
  { title: "Settings", description: "Connect stores and manage account setup.", url: "/settings", icon: Settings },
];

const Index = () => {
  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-xl gradient-phoenix p-8"
      >
        <div className="relative z-10 max-w-2xl">
          <div className="flex items-center gap-3 mb-2">
            <Flame className="h-8 w-8 text-primary-foreground" />
            <h1 className="text-3xl font-bold text-primary-foreground">Mission Control</h1>
          </div>
          <p className="text-primary-foreground/85">
            Real launchpad only. Open the actual admin tools from here without fake stats or placeholder activity.
          </p>
          <div className="flex flex-wrap gap-3 mt-4">
            <Button asChild variant="secondary" className="bg-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/30 border-0">
              <Link to="/phoenix"><Zap className="mr-2 h-4 w-4" /> SEO Scanner</Link>
            </Button>
            <Button asChild variant="secondary" className="bg-primary-foreground/10 text-primary-foreground hover:bg-primary-foreground/20 border-0">
              <Link to="/settings"><Settings className="mr-2 h-4 w-4" /> Settings</Link>
            </Button>
          </div>
        </div>
        <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-accent/20 blur-3xl" />
        <div className="absolute -left-10 -bottom-10 w-32 h-32 rounded-full bg-primary/20 blur-3xl" />
      </motion.div>

      <Card className="bg-card/50 border-border/30">
        <CardHeader>
          <CardTitle className="text-lg">Command Center</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {commandCenterItems.map((item, i) => (
              <motion.div key={item.title} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <Card className="h-full bg-background/40 border-border/30 hover:border-primary/40 transition-colors">
                  <CardContent className="p-4 space-y-4">
                    <div className="flex items-center gap-2">
                      <item.icon className="h-5 w-5 text-primary" />
                      <h2 className="font-semibold">{item.title}</h2>
                    </div>
                    <p className="text-sm text-muted-foreground">{item.description}</p>
                    <Button asChild className="w-full gradient-phoenix text-primary-foreground">
                      <Link to={item.url}>Open {item.title}</Link>
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/50 border-border/30">
        <CardHeader>
          <CardTitle className="text-lg">Tools</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {toolsItems.map((item, i) => (
              <motion.div key={item.title} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.05 }}>
                <Card className="h-full bg-background/40 border-border/30 hover:border-primary/40 transition-colors">
                  <CardContent className="p-4 space-y-4">
                    <div className="flex items-center gap-2">
                      <item.icon className="h-5 w-5 text-primary" />
                      <h2 className="font-semibold">{item.title}</h2>
                    </div>
                    <p className="text-sm text-muted-foreground">{item.description}</p>
                    <Button asChild variant="outline" className="w-full">
                      <Link to={item.url}>Open {item.title}</Link>
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Index;
