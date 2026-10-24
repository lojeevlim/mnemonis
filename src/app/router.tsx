import type { ComponentType } from "react";
import { Route, Routes } from "react-router-dom";
import { AppShell } from "./AppShell";
import { NAV_ITEMS } from "./nav";
import { AgentsPage } from "../features/agents/AgentsPage";
import { SignInPage, SignUpPage } from "../features/auth/AuthPages";
import { ProtectedRoute } from "../features/auth/ProtectedRoute";
import { BranchesPage } from "../features/branches/BranchesPage";
import { CollectionsPage } from "../features/collections/CollectionsPage";
import { GraphPage } from "../features/graph/GraphPage";
import { McpPage } from "../features/mcp/McpPage";
import { MemoriesPage } from "../features/memories/MemoriesPage";
import { OverviewPage } from "../features/overview/OverviewPage";
import { SettingsPage } from "../features/settings/SettingsPage";

const PAGES: Record<string, ComponentType> = {
  "/": OverviewPage,
  "/memories": MemoriesPage,
  "/graph": GraphPage,
  "/collections": CollectionsPage,
  "/branches": BranchesPage,
  "/agents": AgentsPage,
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
      </Route>
    </Routes>
  );
}
