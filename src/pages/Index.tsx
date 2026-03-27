import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Flame, Zap, Shield, BarChart3, Layers, FileText, Image,
  Flower2, Palette, Scan, Bot, History, Radio, Settings, Cpu
} from "lucide-react";
import { Link } from "react-router-dom";

const commandCenterItems = [
  { title: "SEO Scanner", description: "Scan products, find issues, and generate fixes.", url: "/phoenix", icon: Zap, platform: "shopify" as const },
  { title: "Optimizer", description: "Open one product and optimize it step by step.", url: "/optimizer", icon: BarChart3, platform: "shopify" as const },
  { title: "Bulk Analyzer", description: "Run larger listing workflows in one place.", url: "/bulk-analyzer", icon: Layers, platform: "shopify" as const },
  { title: "Descriptions", description: "Generate product copy and admin content.", url: "/descriptions", icon: FileText, platform: "shopify" as const },
  { title: "Media Tools", description: "Image and media utilities.", url: "/media", icon: Image, platform: "shopify" as const },
];

const etsyToolsItems = [
  { title: "Listing Optimizer", description: "Optimize Etsy listings.", url: "/etsy-optimizer", icon: Flower2, platform: "etsy" as const },
  { title: "Listing Scanner", description: "Scan listing issues in bulk.", url: "/listing-scan", icon: Scan, platform: "etsy" as const },
];

const shopifyToolsItems = [
  { title: "Optimizer", description: "Open one Shopify product and optimize it step by step.", url: "/optimizer", icon: BarChart3, platform: "shopify" as const },
  { title: "Templanator", description: "Private Shopify repair workflow.", url: "/templanator", icon: Cpu, platform: "shopify" as const },
  { title: "Theme Compliance", description: "Theme audit and compliance checks.", url: "/theme-audit", icon: Palette, platform: "shopify" as const },
];

const generalToolsItems = [
  { title: "Compliance Audit", description: "Misrepresentation risk scan for admin review.", url: "/audit", icon: Shield, platform: "general" as const },
  { title: "Ad Generator", description: "Create truthful 8-second product ad concepts.", url: "/ads", icon: Bot, platform: "general" as const },
  { title: "History", description: "Review prior actions and results.", url: "/history", icon: History, platform: "general" as const },
  { title: "Free Radio", description: "Music library and playback.", url: "/radio", icon: Radio, platform: "general" as const },
  { title: "Settings", description: "Connect stores and manage account setup.", url: "/settings", icon: Settings, platform: "general" as const },
];

const Index = () => {
  const [toolsFilter, setToolsFilter] = useState<"all" | "shopify" | "etsy" | "general">("shopify");
  const filteredCommandCenter = useMemo(() => {
    if (toolsFilter === "all") return commandCenterItems;
    return commandCenterItems.filter((item) => item.platform === toolsFilter);
  }, [toolsFilter]);
  const toolsItems = useMemo(() => {
    if (toolsFilter === "shopify") return shopifyToolsItems;
    if (toolsFilter === "etsy") return etsyToolsItems;
    if (toolsFilter === "general") return generalToolsItems;
    return [...shopifyToolsItems, ...etsyToolsItems, ...generalToolsItems];
  }, [toolsFilter]);

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
          <CardTitle className="text-lg">Choose Platform First</CardTitle>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button size="sm" variant={toolsFilter === "shopify" ? "default" : "outline"} onClick={() => setToolsFilter("shopify")}>Shopify</Button>
            <Button size="sm" variant={toolsFilter === "etsy" ? "default" : "outline"} onClick={() => setToolsFilter("etsy")}>Etsy</Button>
            <Button size="sm" variant={toolsFilter === "general" ? "default" : "outline"} onClick={() => setToolsFilter("general")}>General</Button>
            <Button size="sm" variant={toolsFilter === "all" ? "default" : "outline"} onClick={() => setToolsFilter("all")}>All</Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Showing <span className="font-semibold text-foreground">{toolsFilter === "all" ? "all sections" : `${toolsFilter} section`}</span> so tools are not mixed.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredCommandCenter.map((item, i) => (
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
          {filteredCommandCenter.length === 0 && (
            <p className="text-center py-8 text-muted-foreground">No command center cards in this section. Use Tools below.</p>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card/50 border-border/30">
        <CardHeader>
          <CardTitle className="text-lg">{toolsFilter === "all" ? "All Tools" : `${toolsFilter[0].toUpperCase()}${toolsFilter.slice(1)} Tools`}</CardTitle>
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


