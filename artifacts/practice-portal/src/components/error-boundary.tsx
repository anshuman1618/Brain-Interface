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
        <Button variant="outline" className="rounded-none" onClick={() => this.setState({ error: null })}>
          <RotateCcw className="h-4 w-4 mr-2" /> Try again
        </Button>
      </div>
    );
  }
}
