import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Error boundary for a single module.
 *
 * Scoped deliberately: a crash inside the calendar or the document vault takes
 * out that panel and leaves the rest of the portal — nav, workspace switcher,
 * sign-out — usable. A single boundary at the root would blank the whole app and
 * strand the user with no way back.
 *
 * Only render errors are caught. Data-fetch failures surface through the query
 * layer's own error state, which says what actually went wrong.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; label: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Left in place on purpose: without it a boundary swallows the stack and
    // the failure becomes invisible in production.
    console.error(`[${this.props.label}] render failed`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="border border-destructive/40 bg-destructive/5 p-8 text-center">
        <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-4" />
        <p className="font-mono text-xs uppercase tracking-widest text-destructive mb-2">
          {this.props.label} failed to render
        </p>
        <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">
          Something went wrong displaying this section. The rest of the portal is unaffected — you
          can retry, or move on and come back.
        </p>
        <p className="text-xs font-mono text-muted-foreground/70 mb-6 break-all max-w-lg mx-auto">
          {this.state.error.message}
        </p>
        <Button
          variant="outline"
          className="rounded-lg"
          onClick={() => this.setState({ error: null })}
        >
          <RotateCcw className="h-4 w-4 mr-2" /> Try again
        </Button>
      </div>
    );
  }
}

/**
 * The last line of defence, wrapped around the entire app.
 *
 * The module boundary above only covers the four routes that opt into it; a
 * render error anywhere else — the dashboard, a modal, the router itself, a
 * provider — unmounts React and leaves a white page with no explanation and no
 * way out. This catches those.
 *
 * It deliberately shows the user nothing about the error. The module boundary
 * can afford to print `error.message` because it is scoped to a panel a
 * developer is probably looking at; this one fires on the paths nobody
 * anticipated, in front of an external beta user, and "Cannot read properties of
 * undefined (reading 'map')" tells them nothing they can act on while telling a
 * stranger something about our internals. The detail goes to the console and the
 * user gets a way forward.
 *
 * Written with inline styles and `window.location` on purpose: it sits outside
 * the theme provider, the router and the query client, so it cannot assume any
 * of them mounted successfully.
 */
export class RootErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[app] unrecoverable render error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    const base = import.meta.env.BASE_URL.replace(/\/$/, "");

    return (
      <div
        role="alert"
        style={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem 1rem",
          background: "hsl(36 29% 86%)",
          color: "hsl(32 64% 9%)",
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        }}
      >
        <div style={{ maxWidth: "32rem", textAlign: "center" }}>
          <div
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
              fontSize: "0.6875rem",
              textTransform: "uppercase",
              letterSpacing: "0.15em",
              color: "hsl(34 24% 34%)",
              marginBottom: "0.75rem",
            }}
          >
            Something went wrong
          </div>
          <h1
            style={{
              fontSize: "1.5rem",
              fontWeight: 700,
              letterSpacing: "-0.02em",
              marginBottom: "0.75rem",
            }}
          >
            This page stopped working
          </h1>
          <p style={{ lineHeight: 1.6, color: "hsl(34 24% 34%)", marginBottom: "1.75rem" }}>
            The fault is ours, not yours, and nothing you had open has been lost. Reloading usually
            clears it. If it keeps happening, tell us what you were doing and we will fix it.
          </p>
          <div
            style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}
          >
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                background: "hsl(29 53% 23%)",
                color: "#fff",
                border: 0,
                borderRadius: "0.875rem",
                padding: "0.625rem 1.25rem",
                fontSize: "0.875rem",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Reload the page
            </button>
            <button
              type="button"
              onClick={() => {
                window.location.href = `${base}/dashboard`;
              }}
              style={{
                background: "transparent",
                color: "hsl(32 64% 9%)",
                border: "1px solid hsl(35 25% 77%)",
                borderRadius: "0.875rem",
                padding: "0.625rem 1.25rem",
                fontSize: "0.875rem",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Back to the dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }
}
