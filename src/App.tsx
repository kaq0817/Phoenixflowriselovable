import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import DashboardLayout from "@/components/DashboardLayout";
import Index from "./pages/Index";
import Phoenix from "./pages/Phoenix";
import Optimizer from "./pages/Optimizer";
import BulkAnalyzer from "./pages/BulkAnalyzer";
import Descriptions from "./pages/Descriptions";
import Media from "./pages/Media";
import Inventory from "./pages/Inventory";
import Audit from "./pages/Audit";
import BotBuilder from "./pages/BotBuilder";
import EtsyOptimizer from "./pages/EtsyOptimizer";
import HistoryLedger from "./pages/HistoryLedger";
import Pricing from "./pages/Pricing";
import SettingsPage from "./pages/SettingsPage";
import Auth from "./pages/Auth";
import ResetPassword from "./pages/ResetPassword";
import ThemeAudit from "./pages/ThemeAudit";
import ListingScan from "./pages/ListingScan";
import Radio from "./pages/Radio";
import AdminUsers from "./pages/AdminUsers";
import Templanator from "./pages/Templanator";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
              <Route path="/" element={<Index />} />
              <Route path="/phoenix" element={<Phoenix />} />
              <Route path="/optimizer" element={<Optimizer />} />
              <Route path="/bulk-analyzer" element={<BulkAnalyzer />} />
              <Route path="/descriptions" element={<Descriptions />} />
              <Route path="/media" element={<Media />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/audit" element={<Audit />} />
              <Route path="/etsy-optimizer" element={<EtsyOptimizer />} />
              <Route path="/theme-audit" element={<ThemeAudit />} />
              <Route path="/listing-scan" element={<ListingScan />} />
              <Route path="/bot" element={<BotBuilder />} />              <Route path="/ads" element={<BotBuilder />} />
              <Route path="/history" element={<HistoryLedger />} />
              <Route path="/radio" element={<Radio />} />
              <Route path="/pricing" element={<Pricing />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/templanator" element={<Templanator />} />
              <Route path="/admin/users" element={<AdminUsers />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
