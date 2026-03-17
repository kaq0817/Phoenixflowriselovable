import {
  Flame, BarChart3, Shield, Layers, FileText, Bot, History, CreditCard,
  Settings, Zap, Image, Package, Flower2, Palette, Scan, Radio, Users, Cpu
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

const mainItems = [
  { title: "Workstation", url: "/", icon: Flame },
  { title: "SEO Scanner", url: "/phoenix", icon: Zap },
  { title: "Optimizer", url: "/optimizer", icon: BarChart3 },
  { title: "Bulk Analyzer", url: "/bulk-analyzer", icon: Layers },
  { title: "Descriptions", url: "/descriptions", icon: FileText },
  { title: "Media Tools", url: "/media", icon: Image },
  { title: "Inventory", url: "/inventory", icon: Package },
];

const toolsItems = [
  { title: "Templanator", url: "/templanator", icon: Cpu },
  { title: "Listing Optimizer", url: "/etsy-optimizer", icon: Flower2 },
  { title: "Listing Scanner", url: "/listing-scan", icon: Scan },
  { title: "Compliance Audit", url: "/audit", icon: Shield },
  { title: "Theme Compliance", url: "/theme-audit", icon: Palette },
  { title: "AI Bot", url: "/bot", icon: Bot },
  { title: "History", url: "/history", icon: History },
  { title: "Free Radio", url: "/radio", icon: Radio },
];

const settingsItems = [
  { title: "Pricing", url: "/pricing", icon: CreditCard },
  { title: "Settings", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { user } = useAuth();
  const isAdmin = useIsAdmin(user?.id);
  const isActive = (path: string) => location.pathname === path;

  const renderGroup = (label: string, items: typeof mainItems) => (
    <SidebarGroup>
      <SidebarGroupLabel className="text-muted-foreground/60 text-xs uppercase tracking-wider">
        {!collapsed && label}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton asChild>
                <NavLink
                  to={item.url}
                  end={item.url === "/"}
                  className="hover:bg-sidebar-accent/50 transition-colors"
                  activeClassName="bg-primary/10 text-primary font-semibold border-l-2 border-primary"
                >
                  <item.icon className={`mr-2 h-4 w-4 ${isActive(item.url) ? "text-primary" : ""}`} />
                  {!collapsed && <span>{item.title}</span>}
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
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
        {renderGroup("Command Center", mainItems)}
        {renderGroup("Tools", toolsItems)}
        {renderGroup("Account", settingsItems)}
        {isAdmin && renderGroup("Admin", [
          { title: "Users", url: "/admin/users", icon: Users },
        ])}
      </SidebarContent>
    </Sidebar>
  );
}
