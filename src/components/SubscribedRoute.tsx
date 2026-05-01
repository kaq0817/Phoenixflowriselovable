import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

export default function SubscribedRoute({ children }: { children: React.ReactNode }) {
  const { profileLoading, subscriptionStatus, isAdmin } = useAuth();

  if (profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isAdmin) return <>{children}</>;

  const isActive = subscriptionStatus === "active" || subscriptionStatus === "trialing";
  if (!isActive) return <Navigate to="/pricing" replace />;

  return <>{children}</>;
}
