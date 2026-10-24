import { fireEvent, render, screen, within } from "@testing-library/react";
import { App } from "./App";
import { seedLocalProfile } from "../test/helpers";
import { NAV_ITEMS } from "./nav";

beforeEach(() => {
  localStorage.clear();
  seedLocalProfile();
});

describe("AppShell", () => {
  it("renders the shell (Navbar brand) with all nav items", async () => {
    render(<App />);
    expect(screen.getAllByText("Mnemonis").length).toBeGreaterThan(0);
    for (const item of NAV_ITEMS) {
      expect((await screen.findAllByText(item.label)).length).toBeGreaterThan(0);
    }
  });

  it("nav has Inbox and Memory Health instead of memory lines and agents", () => {
    const labels = NAV_ITEMS.map((i) => [i.label, i.path]);
    expect(labels).toContainEqual(["Inbox", "/inbox"]);
    expect(labels).toContainEqual(["Memory Health", "/health"]);
    expect(NAV_ITEMS.some((i) => /branch|memory lines|agents/i.test(i.label + i.path))).toBe(false);
  });

  it("shows the number of changes waiting for review as a badge on Inbox", async () => {
    render(<App />); // first load seeds the demo workspace, which carries 2 agent proposals plus 1 agent link
    const badge = await screen.findByTestId("inbox-badge");
    expect(badge).toHaveTextContent("3 waiting for review");
    expect(within(badge.parentElement as HTMLElement).getByText("Inbox")).toBeInTheDocument();
  });
});

describe("AppShell collapsed sidebar", () => {
  it("keeps a pending indicator with an accessible name when the nav is collapsed", async () => {
    render(<App />);
    await screen.findByTestId("inbox-badge");
    fireEvent.click(screen.getByRole("button", { name: /collapse/i }));
    expect(screen.queryByTestId("inbox-badge")).not.toBeInTheDocument();
    expect(await screen.findByText("3 waiting for review")).toBeInTheDocument();
    expect(screen.getByTestId("inbox-dot")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inbox 3 waiting for review" })).toBeInTheDocument();
  });
});
