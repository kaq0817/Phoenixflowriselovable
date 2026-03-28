import {
  Flame, BarChart3, Shield, Layers, FileText, Bot, History, CreditCard,
  Settings, Zap, Image, Flower2, Palette, Scan, Radio, Users, Cpu,
  type LucideIcon,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Fragment, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

type SidebarItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  comingSoon?: boolean;
};

const workstationItems: SidebarItem[] = [
  { title: "Workstation", url: "/", icon: Flame },
];

const shopifyItems: SidebarItem[] = [
  { title: "SEO Scanner", url: "/phoenix", icon: Zap },
  { title: "Optimizer", url: "/optimizer", icon: BarChart3 },
  { title: "Bulk Analyzer", url: "/bulk-analyzer", icon: Layers },
  { title: "Descriptions", url: "/descriptions", icon: FileText },
  { title: "Media Tools", url: "/media", icon: Image },
  { title: "Templanator", url: "/templanator", icon: Cpu },
  { title: "Theme Compliance", url: "/theme-audit", icon: Palette },
];

const etsyItems: SidebarItem[] = [
  { title: "Listing Optimizer", url: "/etsy-optimizer", icon: Flower2 },
  { title: "Product Scanner", url: "/listing-scan", icon: Scan },
];

const generalItems: SidebarItem[] = [
  { title: "Compliance Audit", url: "/audit", icon: Shield },
  { title: "Ad Generator", url: "/ads", icon: Bot },
  { title: "History", url: "/history", icon: History },
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
  const [toolsFilter, setToolsFilter] = useState<"all" | "shopify" | "etsy" | "general">("shopify");
  const isActive = (path: string) => location.pathname === path;
  const filteredToolGroups = useMemo(() => {
    if (toolsFilter === "shopify") return [{ label: "Shopify", items: shopifyItems }];
    if (toolsFilter === "etsy") return [{ label: "Etsy", items: etsyItems }];
    if (toolsFilter === "general") return [{ label: "General", items: generalItems }];
    return [
      { label: "Shopify", items: shopifyItems },
      { label: "Etsy", items: etsyItems },
      { label: "General", items: generalItems },
    ];
  }, [toolsFilter]);

  const renderGroup = (label: string, items: SidebarItem[]) => (
    <SidebarGroup>
      <SidebarGroupLabel className="text-muted-foreground/60 text-xs uppercase tracking-wider">
        {!collapsed && label}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton asChild disabled={item.comingSoon}>
                <NavLink
                  to={item.url}
                  end={item.url === "/"}
                  className={`hover:bg-sidebar-accent/50 transition-colors ${item.comingSoon ? "opacity-50 pointer-events-none" : ""}`}
                  activeClassName="bg-primary/10 text-primary font-semibold border-l-2 border-primary"
                >
                  <item.icon className={`mr-2 h-4 w-4 ${isActive(item.url) ? "text-primary" : ""}`} />
                  {!collapsed && <span>{item.title}</span>}
                  {item.comingSoon && !collapsed && (
                    <span className="ml-2 text-xs text-muted-foreground">(Coming Soon)</span>
                  )}
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );

  const renderPlatformGroup = () => (
    <SidebarGroup>
      <SidebarGroupLabel className="text-muted-foreground/60 text-xs uppercase tracking-wider">
        {!collapsed && "Platform"}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        {!collapsed && (
          <div className="px-2 pb-2 grid grid-cols-2 gap-1">
            <Button size="sm" variant={toolsFilter === "shopify" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setToolsFilter("shopify")}>
              Shopify
            </Button>
            <Button size="sm" variant={toolsFilter === "etsy" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setToolsFilter("etsy")}>
              Etsy
            </Button>
            <Button size="sm" variant={toolsFilter === "general" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setToolsFilter("general")}>
              General
            </Button>
            <Button size="sm" variant={toolsFilter === "all" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setToolsFilter("all")}>
              All
            </Button>
          </div>
        )}
        <SidebarMenu>
          {filteredToolGroups.map((group) => (
            <Fragment key={group.label}>
              {!collapsed && (
                <li className="px-2 pt-2 text-[11px] font-semibold tracking-wide text-primary/80">
                  {group.label}
                </li>
              )}
              {group.items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      className="hover:bg-sidebar-accent/50 transition-colors"
                      activeClassName="bg-primary/10 text-primary font-semibold border-l-2 border-primary"
                    >
                      <item.icon className={`mr-2 h-4 w-4 ${isActive(item.url) ? "text-primary" : ""}`} />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </Fragment>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );

  return (
    <Sidebar collapsible="icon" className="border-r border-border/30">
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
        {renderGroup("Command Center", workstationItems)}
        {renderPlatformGroup()}
        {renderGroup("Account", settingsItems)}
        {isAdmin && renderGroup("Admin", [
          { title: "Users", url: "/admin/users", icon: Users },
        ])}
      </SidebarContent>
    </Sidebar>
  );
}
