import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import SubscribedRoute from "@/components/SubscribedRoute";
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
import Terms from "./pages/Terms";
import PrivacyPolicy from "./pages/privacy_policy";
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
            <Route path="/terms" element={<Terms />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
              {/* Free tier — optimizer only */}
              <Route path="/" element={<Index />} />
              <Route path="/optimizer" element={<Optimizer />} />
              <Route path="/bulk-analyzer" element={<BulkAnalyzer />} />
              <Route path="/settings" element={<SettingsPage />} />
              {/* Subscription required */}
              <Route path="/phoenix" element={<SubscribedRoute><Phoenix /></SubscribedRoute>} />
              <Route path="/descriptions" element={<SubscribedRoute><Descriptions /></SubscribedRoute>} />
              <Route path="/media" element={<SubscribedRoute><Media /></SubscribedRoute>} />
              <Route path="/inventory" element={<SubscribedRoute><Inventory /></SubscribedRoute>} />
              <Route path="/audit" element={<SubscribedRoute><Audit /></SubscribedRoute>} />
              <Route path="/etsy-optimizer" element={<SubscribedRoute><EtsyOptimizer /></SubscribedRoute>} />
              <Route path="/theme-audit" element={<SubscribedRoute><ThemeAudit /></SubscribedRoute>} />
              <Route path="/listing-scan" element={<SubscribedRoute><ListingScan /></SubscribedRoute>} />
              <Route path="/bot" element={<SubscribedRoute><BotBuilder /></SubscribedRoute>} />
              <Route path="/ads" element={<SubscribedRoute><BotBuilder /></SubscribedRoute>} />
              <Route path="/history" element={<SubscribedRoute><HistoryLedger /></SubscribedRoute>} />
              <Route path="/radio" element={<SubscribedRoute><Radio /></SubscribedRoute>} />
              <Route path="/templanator" element={<SubscribedRoute><Templanator /></SubscribedRoute>} />
              <Route path="/admin/users" element={<SubscribedRoute><AdminUsers /></SubscribedRoute>} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
