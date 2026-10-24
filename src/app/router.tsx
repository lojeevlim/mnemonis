import type { ComponentType } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./AppShell";
import { NAV_ITEMS } from "./nav";
import { SignInPage, SignUpPage } from "../features/auth/AuthPages";
import { ProtectedRoute } from "../features/auth/ProtectedRoute";
import { CollectionsPage } from "../features/collections/CollectionsPage";
import { GraphPage } from "../features/graph/GraphPage";
import { HealthPage } from "../features/health/HealthPage";
import { InboxPage } from "../features/inbox/InboxPage";
import { McpPage } from "../features/mcp/McpPage";
import { MemoriesPage } from "../features/memories/MemoriesPage";
import { OverviewPage } from "../features/overview/OverviewPage";
import { SettingsPage } from "../features/settings/SettingsPage";

const PAGES: Record<string, ComponentType> = {
  "/": OverviewPage,
  "/memories": MemoriesPage,
  "/graph": GraphPage,
  "/collections": CollectionsPage,
  "/inbox": InboxPage,
  "/health": HealthPage,
  "/mcp": McpPage,
  "/settings": SettingsPage,
};

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignInPage />} />
      <Route path="/sign-up" element={<SignUpPage />} />
      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        {NAV_ITEMS.map((item) => {
          const Page = PAGES[item.path];
          return <Route key={item.path} path={item.path} element={<Page />} />;
        })}
        {/* Old URLs (memory lines, Agents) keep working. */}
        <Route path="/branches" element={<Navigate to="/inbox" replace />} />
        <Route path="/agents" element={<Navigate to="/health" replace />} />
      </Route>
    </Routes>
  );
}
