import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";

/** Redirects to /sign-in unless a local profile is signed in. */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/sign-in" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}
