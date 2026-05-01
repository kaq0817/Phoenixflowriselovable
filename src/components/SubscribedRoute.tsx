import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";

export default function SubscribedRoute({ children }: { children: React.ReactNode }) {
  const { subscriptionStatus } = useAuth();
  const isActive = subscriptionStatus === "active" || subscriptionStatus === "trialing";
  if (!isActive) return <Navigate to="/pricing" replace />;
  return <>{children}</>;
}
