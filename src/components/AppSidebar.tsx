import {
  Flame, BarChart3, Shield, Layers, FileText, Bot, History, CreditCard,
  Settings, Zap, Image, Flower2, Palette, Scan, Radio, Users, Cpu, Boxes,
  type LucideIcon,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { supabase } from "@/integrations/supabase/client";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useEffect, useState } from "react";

type SidebarItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  comingSoon?: boolean;
  requiresShopify?: boolean;
  requiresEtsy?: boolean;
  requiresAnyStore?: boolean;
};

const dashboardItems: SidebarItem[] = [
  { title: "Workstation", url: "/", icon: Flame },
];

const shopifyItems: SidebarItem[] = [
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

const etsyItems: SidebarItem[] = [
  { title: "Listing Optimizer", url: "/etsy-optimizer", icon: Flower2, requiresEtsy: true },
  { title: "Listing Scanner", url: "/listing-scan", icon: Scan, requiresEtsy: true },
  { title: "Ad Generator", url: "/ads", icon: Bot, requiresEtsy: true },
  { title: "History", url: "/history", icon: History, requiresEtsy: true },
];

const complianceItems: SidebarItem[] = [
  { title: "Compliance Audit", url: "/audit", icon: Shield },
];

const generalItems: SidebarItem[] = [
  { title: "Free Radio", url: "/radio", icon: Radio },
];

const settingsItems: SidebarItem[] = [
  { title: "Pricing", url: "/pricing", icon: CreditCard },
  { title: "Settings", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { user } = useAuth();
  const isAdmin = useIsAdmin(user?.id);
  const [hasShopify, setHasShopify] = useState(false);
  const [hasEtsy, setHasEtsy] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"loading" | "ready" | "error">("loading");

  const isActive = (path: string) => location.pathname === path;

  const canUseItem = (item: SidebarItem) => {
    if (connectionStatus !== "ready") return true;
    if (item.requiresShopify && !hasShopify) return false;
    if (item.requiresEtsy && !hasEtsy) return false;
    if (item.requiresAnyStore && !(hasShopify || hasEtsy)) return false;
    return true;
  };

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

  const renderGroup = (label: string, items: SidebarItem[]) => {
    return (
      <SidebarGroup>
        <SidebarGroupLabel className="text-muted-foreground/60 text-xs uppercase tracking-wider">
          {!collapsed && label}
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {items.map((item) => {
              const enabled = canUseItem(item);
              const lockedLabel = connectionStatus === "ready" && !enabled
                ? item.requiresEtsy
                  ? "Connect Etsy"
                  : item.requiresShopify
                    ? "Connect Shopify"
                    : "Connect Store"
                : "";
              return (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild disabled={item.comingSoon || !enabled}>
                    <NavLink
                      to={item.url}
                      end={item.url === "/"}
                      className={`hover:bg-sidebar-accent/50 transition-colors ${item.comingSoon || !enabled ? "opacity-50 pointer-events-none" : ""}`}
                      activeClassName="bg-primary/10 text-primary font-semibold border-l-2 border-primary"
                    >
                      <item.icon className={`mr-2 h-4 w-4 ${isActive(item.url) ? "text-primary" : ""}`} />
                      {!collapsed && <span>{item.title}</span>}
                      {item.comingSoon && !collapsed && (
                        <span className="ml-2 text-xs text-muted-foreground">(Coming Soon)</span>
                      )}
                      {!item.comingSoon && lockedLabel && !collapsed && (
                        <span className="ml-auto text-[10px] text-muted-foreground">{lockedLabel}</span>
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  };

  return (
    <Sidebar collapsible="none" className="border-r border-border/30">
      <div className="p-4 flex items-center gap-2">
        <div className="h-8 w-8 rounded-lg gradient-phoenix flex items-center justify-center">
          <Flame className="h-4 w-4 text-primary-foreground" />
        </div>
        {!collapsed && (
          <span className="font-bold text-lg gradient-phoenix-text">
            Phoenix Flow
          </span>
        )}
      </div>
      <SidebarContent>
        {renderGroup("Dashboard", dashboardItems)}
        {renderGroup("Shopify", shopifyItems)}
        {renderGroup("Etsy", etsyItems)}
        {renderGroup("Compliance", complianceItems)}
        {renderGroup("General", generalItems)}
        {renderGroup("Account", settingsItems)}
        {isAdmin && renderGroup("Admin", [
          { title: "Users", url: "/admin/users", icon: Users },
        ])}
      </SidebarContent>
    </Sidebar>
  );
}
