import { useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Flame, Zap, BarChart3, Layers, FileText, Image, Boxes, Cpu, Palette, Shield, Bot, History, Radio, Settings, CreditCard, Flower2, Scan, type LucideIcon } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type NavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  requiresShopify?: boolean;
  requiresEtsy?: boolean;
  requiresAnyStore?: boolean;
};

export default function DashboardLayout() {
  const { user } = useAuth();
  const isAdmin = useIsAdmin(user?.id);
  const location = useLocation();
  const navigate = useNavigate();
  const [hasShopify, setHasShopify] = useState(false);
  const [hasEtsy, setHasEtsy] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    const loadConnections = async () => {
      const { data, error } = await supabase
        .from("store_connections")
        .select("platform, shop_domain, scopes")
        .eq("user_id", user.id);
      if (!active) return;
      if (error) {
        setConnectionStatus("error");
        return;
      }
      const rows = data || [];
      const hasShop = rows.some((row) => row.platform === "shopify");
      const hasEtsyConn = rows.some(
        (row) => row.platform === "etsy" && !!row.shop_domain && (row.scopes || "").includes("shops_r"),
      );
      setHasShopify(hasShop);
      setHasEtsy(hasEtsyConn);
      setConnectionStatus("ready");
    };
    void loadConnections();
    return () => {
      active = false;
    };
  }, [user?.id]);

  const canUseItem = (item: NavItem) => {
    if (connectionStatus !== "ready") return true;
    if (item.requiresShopify && !hasShopify) return false;
    if (item.requiresEtsy && !hasEtsy) return false;
    if (item.requiresAnyStore && !(hasShopify || hasEtsy)) return false;
    return true;
  };

  const dashboardItems: NavItem[] = [
    { title: "Workstation", url: "/", icon: Flame },
  ];

  const shopifyItems: NavItem[] = [
    { title: "SEO Scanner", url: "/phoenix", icon: Zap, requiresShopify: true },
    { title: "Optimizer", url: "/optimizer", icon: BarChart3, requiresShopify: true },
    { title: "Bulk Analyzer", url: "/bulk-analyzer", icon: Layers, requiresShopify: true },
    { title: "Descriptions", url: "/descriptions", icon: FileText, requiresShopify: true },
    { title: "Media Tools", url: "/media", icon: Image, requiresShopify: true },
    { title: "Inventory", url: "/inventory", icon: Boxes, requiresShopify: true },
    { title: "Templanator", url: "/templanator", icon: Cpu, requiresShopify: true },
    { title: "Theme Compliance", url: "/theme-audit", icon: Palette, requiresShopify: true },
    { title: "Ad Generator", url: "/ads", icon: Bot, requiresShopify: true },
    { title: "History", url: "/history", icon: History, requiresShopify: true },
  ];

  const etsyItems: NavItem[] = [
    { title: "Listing Optimizer", url: "/etsy-optimizer", icon: Flower2, requiresEtsy: true },
    { title: "Listing Scanner", url: "/listing-scan", icon: Scan, requiresEtsy: true },
    { title: "Ad Generator", url: "/ads", icon: Bot, requiresEtsy: true },
    { title: "History", url: "/history", icon: History, requiresEtsy: true },
  ];

  const complianceItems: NavItem[] = [
    { title: "Compliance Audit", url: "/pricing", icon: Shield },
  ];

  const generalItems: NavItem[] = [
    { title: "Free Radio", url: "/radio", icon: Radio },
  ];

  const accountItems: NavItem[] = [
    { title: "Pricing", url: "/pricing", icon: CreditCard },
    { title: "Settings", url: "/settings", icon: Settings },
  ];

  const adminItems: NavItem[] = [
    { title: "Users", url: "/admin/users", icon: Settings },
  ];

  const groups = useMemo(
    () => [
      { label: "Dashboard", items: dashboardItems },
      { label: "Shopify", items: shopifyItems },
      { label: "Etsy", items: etsyItems },
      { label: "Compliance", items: complianceItems },
      { label: "General", items: generalItems },
      { label: "Account", items: accountItems },
      ...(isAdmin ? [{ label: "Admin", items: adminItems }] : []),
    ],
    [isAdmin],
  );

  const renderNavItem = (item: NavItem) => {
    const enabled = canUseItem(item);
    const active = location.pathname === item.url;
    const lockedLabel = connectionStatus === "ready" && !enabled
      ? item.requiresEtsy
        ? "Connect Etsy"
        : item.requiresShopify
          ? "Connect Shopify"
          : "Connect Store"
      : "";
    const Icon = item.icon;

    return (
      <button
        key={item.title}
        type="button"
        onClick={() => (enabled ? navigate(item.url) : navigate("/settings"))}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
          active ? "bg-primary/10 text-primary font-semibold" : "hover:bg-muted/20",
          !enabled && "opacity-50",
        )}
      >
        <Icon className="h-4 w-4" />
        <span className="flex-1 text-left">{item.title}</span>
        {lockedLabel ? <span className="text-[10px] text-muted-foreground">{lockedLabel}</span> : null}
      </button>
    );
  };

  return (
    <div className="min-h-screen flex w-full">
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-12 flex items-center border-b border-border/30 px-4 glass-panel sticky top-0 z-20">
          <Sheet>
            <SheetTrigger asChild>
              <Button size="sm" variant="outline" className="mr-3">Menu</Button>
            </SheetTrigger>
            <SheetContent side="top" className="w-full max-h-[80vh] overflow-y-auto">
              <SheetHeader>
                <SheetTitle>Phoenix Flow</SheetTitle>
              </SheetHeader>
              <div className="mt-4 grid gap-6 md:grid-cols-3">
                {groups.map((group) => (
                  <div key={group.label} className="space-y-2">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">{group.label}</div>
                    <div className="space-y-1">
                      {group.items.map(renderNavItem)}
                    </div>
                  </div>
                ))}
              </div>
            </SheetContent>
          </Sheet>
          <span className="text-sm text-muted-foreground font-mono">PHOENIX FLOW v2.0</span>
        </header>
        <main className="flex-1 p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
