import { Component, type ErrorInfo, type ReactNode } from "react";
import { CORRUPT_BACKUP_KEY, STORAGE_KEY } from "../data/localRepository";
import { downloadText } from "../features/settings/SettingsPage";

interface Props {
  children: ReactNode;
  /** Test seams; defaults operate on localStorage / the browser location. */
  reload?: () => void;
}

interface BoundaryState {
  error: Error | null;
  notice: string | null;
}

function readRaw(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Top-level safety net: an uncaught render error shows a recovery screen instead of a blank page.
 * "Export raw data" saves the stored workspace JSON untouched (works even when it is what
 * crashes the app); "Reset local data" removes the stored workspace (and its corrupt backup)
 * and reloads. The local profile is kept.
 */
export class ErrorBoundary extends Component<Props, BoundaryState> {
  state: BoundaryState = { error: null, notice: null };

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled UI error", error, info.componentStack);
  }

  private exportRaw = () => {
    const raw = readRaw();
    if (raw === null) {
      this.setState({ notice: "There is no stored workspace data to export." });
      return;
    }
    downloadText(`mnemonis-raw-${new Date().toISOString().slice(0, 10)}.json`, raw);
    this.setState({ notice: "Raw data exported." });
  };

  private resetData = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(CORRUPT_BACKUP_KEY);
    } catch {
      /* storage unavailable: nothing to remove */
    }
    (this.props.reload ?? (() => window.location.reload()))();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="mx-auto max-w-lg space-y-3 p-6 text-fg">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="text-sm text-fg-muted">
          Mnemonis hit an unexpected error. Your data is still stored in this browser. You can export it before resetting.
        </p>
        <pre className="overflow-auto rounded border border-border p-2 text-xs">{this.state.error.message}</pre>
        {this.state.notice && <p className="text-xs text-fg-muted">{this.state.notice}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="rounded border border-border px-3 py-1 text-sm" onClick={this.exportRaw}>
            Export raw data
          </button>
          <button type="button" className="rounded border border-border px-3 py-1 text-sm" onClick={this.resetData}>
            Reset local data
          </button>
          <button type="button" className="rounded border border-border px-3 py-1 text-sm" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
