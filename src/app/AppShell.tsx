import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  App as Layout,
  AppMain,
  AppSide,
  AppTop,
  Badge,
  CommandMenu,
  Sidebar,
  SidebarMenuItem,
  UserMenu,
  useAppLayout,
  Navbar,
  type CommandMenuItem,
  UserMenuItem,
} from "lojee-ui";
import { NAV_ITEMS } from "./nav";
import { pendingCount } from "../domain";
import { useWorkspace } from "../stores/workspaceStore";
import { useAuth } from "../features/auth/AuthContext";
import { WorkspaceGate } from "./WorkspaceGate";


interface UserMenuItemExtend extends UserMenuItem {
  id?: string;
}

function SideNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { setSideOpen } = useAppLayout();
  const [collapsed, setCollapsed] = useState(false);
  // A number (not the derived array) so the selector result is stable between renders.
  const waiting = useWorkspace((s) => (s.state ? pendingCount(s.state) : 0));
  return (
    <Sidebar collapsible variant="light" collapsed={collapsed} onCollapsedChange={setCollapsed}>
      {NAV_ITEMS.map(({ label, icon, path }) => (
        <SidebarMenuItem
          key={path}
          icon={icon}
          collapsed={collapsed}
          active={path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(`${path}/`)}
          onClick={() => {
            navigate(path);
            setSideOpen(false);
          }}
        >
          {label}
          {path === "/inbox" && waiting > 0 && collapsed && (
            <>
              <span
                aria-hidden="true"
                data-testid="inbox-dot"
                className="absolute right-1 top-1 inline-flex h-2 w-2 rounded-full bg-amber-400"
              />
              {" "}
              <span className="sr-only">{waiting} waiting for review</span>
            </>
          )}
          {path === "/inbox" && waiting > 0 && !collapsed && (
            <span data-testid="inbox-badge" className="ml-2 inline-flex">
              <Badge variant="soft" color="amber" size="xs">
                {waiting}
              </Badge>
              <span className="sr-only"> waiting for review</span>
            </span>
          )}
        </SidebarMenuItem>
      ))}
    </Sidebar>
  );
}

export function AppShell() {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const { signOut } = useAuth();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setMenuOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const commands: CommandMenuItem[] = NAV_ITEMS.map((item) => ({
    id: item.path,
    label: item.label,
    icon: item.icon,
    description: "Go to page",
    onSelect: () => navigate(item.path),
  }));

  const userActions  = (id?: string) =>{
    switch(id){
      case 'profile':
        navigate('/profile');
        break;
      case 'settings':
        navigate('/settings');
        break;
      case 'billing':
        navigate('/billing');
        break;
      case 'logout':
        signOut();
        break;
      default:
        break;
    }
  }

  return (
    <>
      <Layout  
        layout={[
          ["side", "top"],
          ["side", "main"]
        ]} 
        collapseBelow="3xl" className="bg-surface text-fg"
    > 
      <AppTop>
        {/* <header className="flex items-center gap-3 border-b border-border px-4 py-2">
          <AppSideToggle />
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-tight">Mnemonis</div>
            <div className="hidden truncate text-xs text-fg-muted sm:block">
              Your mind, independent of the model.
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Badge variant="soft" color="amber" size="sm" icon="info">
              <span className="hidden md:inline">Local demo mode — data stays in this browser, not synced</span>
              <span className="md:hidden">Local demo</span>
            </Badge>
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="hidden items-center gap-2 rounded-md border border-border px-2 py-1 text-xs text-fg-muted transition-colors hover:bg-surface-muted sm:flex"
              aria-label="Open command menu"
            >
              Search <kbd className="rounded bg-surface-muted px-1">⌘K</kbd>
            </button>
            <ThemeSwitcher />
            {user && (
              <UserMenu
                name={user.displayName}
                email={user.email || "Local profile"}
                avatarInitials={user.displayName.slice(0, 2).toUpperCase()}
                items={[
                  { label: "Settings", icon: "settings" },
                  { label: "Sign out", icon: "log-out", danger: true },
                ]}
                onItemSelect={(item) => {
                  if (item.label === "Sign out") signOut();
                  else navigate("/settings");
                }}
              />
            )}
          </div>
        </header> */}

        <Navbar 
          brand="Mnemonis"
          collapsible
          className="w-fulll"
          actions={
            <UserMenu
              name="Jordan Diaz"
              email="jordan@lojee.io"
              avatarInitials="JD"
              transition="fade"
              onItemSelect={(item:UserMenuItemExtend) => { userActions(item.id) }}
              items={[
                { id:'profile', label: "Profile", icon: "user" },
                { id:'settings', label: "Settings", icon: "settings" },
                { id:'billing', label: "Billing", icon: "tag" },
                { id:'logout', label: "Log out", icon: "arrow-right", danger: true },
              ] as UserMenuItemExtend[]}
            />
          }
        >
        </Navbar>
      </AppTop>
      <AppSide>
        <SideNav />
      </AppSide>
      <AppMain>
        <WorkspaceGate>
          <Outlet />
        </WorkspaceGate>
      </AppMain>
      <CommandMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={commands}
        placeholder="Jump to a page..."
      />
    </Layout>
    </>
  );
}
