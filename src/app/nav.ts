export interface NavItem {
  label: string;
  path: string;
  /** lojee-ui icon name (see ICON_NAMES). */
  icon: string;
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Overview", path: "/", icon: "layout-dashboard" },
  { label: "Memories", path: "/memories", icon: "book-open" },
  { label: "Knowledge Graph", path: "/graph", icon: "share-2" },
  { label: "Collections", path: "/collections", icon: "folder" },
  { label: "Inbox", path: "/inbox", icon: "inbox" },
  { label: "Memory Health", path: "/health", icon: "activity" },
  { label: "MCP Connections", path: "/mcp", icon: "link" },
  { label: "Settings", path: "/settings", icon: "settings" },
];
