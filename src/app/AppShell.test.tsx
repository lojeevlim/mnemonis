import { render, screen } from "@testing-library/react";
import { App } from "./App";
import { seedLocalProfile } from "../test/helpers";
import { NAV_ITEMS } from "./nav";

beforeEach(() => {
  localStorage.clear();
  seedLocalProfile();
});

describe("AppShell", () => {
  it("renders the shell with all nav items and the demo banner", async () => {
    render(<App />);
    expect(screen.getAllByText("Mnemonis").length).toBeGreaterThan(0);
    expect(screen.getByText("Your mind, independent of the model.")).toBeInTheDocument();
    expect(screen.getAllByText(/Local demo/).length).toBeGreaterThan(0);
    for (const item of NAV_ITEMS) {
      expect((await screen.findAllByText(item.label)).length).toBeGreaterThan(0);
    }
  });
});
