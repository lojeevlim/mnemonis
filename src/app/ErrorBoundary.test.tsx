import { fireEvent, render, screen } from "@testing-library/react";
import { CORRUPT_BACKUP_KEY, STORAGE_KEY } from "../data/localRepository";
import { AUTH_STORAGE_KEY } from "../features/auth/localAuthProvider";
import { ErrorBoundary } from "./ErrorBoundary";

function Boom(): never {
  throw new Error("kaboom");
}

let createObjectURL: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear();
  createObjectURL = vi.fn(() => "blob:mock");
  Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("ErrorBoundary", () => {
  it("renders children when nothing throws", () => {
    render(<ErrorBoundary>ok child</ErrorBoundary>);
    expect(screen.getByText("ok child")).toBeInTheDocument();
  });

  it("shows a recovery screen instead of a blank page", () => {
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.getByText("kaboom")).toBeInTheDocument();
  });

  it("exports the raw stored data untouched", async () => {
    localStorage.setItem(STORAGE_KEY, "{not even json");
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    fireEvent.click(screen.getByRole("button", { name: "Export raw data" }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(await (createObjectURL.mock.calls[0][0] as Blob).text()).toBe("{not even json");
  });

  it("tells the user when there is nothing to export", () => {
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    fireEvent.click(screen.getByRole("button", { name: "Export raw data" }));
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(screen.getByText(/no stored workspace data/i)).toBeInTheDocument();
  });

  it("resets local workspace data (and corrupt backup) then reloads, keeping the profile", () => {
    localStorage.setItem(STORAGE_KEY, "x");
    localStorage.setItem(CORRUPT_BACKUP_KEY, "y");
    localStorage.setItem(AUTH_STORAGE_KEY, "profile");
    const reload = vi.fn();
    render(<ErrorBoundary reload={reload}><Boom /></ErrorBoundary>);
    fireEvent.click(screen.getByRole("button", { name: "Reset local data" }));
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(CORRUPT_BACKUP_KEY)).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBe("profile");
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
