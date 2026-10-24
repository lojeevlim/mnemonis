import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { LoadingState } from "lojee-ui";
import { useAuth } from "./AuthContext";

/** Waits while the stored session is verified, then redirects to /sign-in unless someone is signed in. */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface p-6 text-fg" aria-busy="true">
        <LoadingState title="Signing you in" size="sm" />
      </div>
    );
  }
  if (status !== "signedIn") return <Navigate to="/sign-in" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}
