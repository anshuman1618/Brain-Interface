import { useCallback, useEffect, useRef, useState } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/session";
import { isNative } from "@/lib/platform";
import { checkBiometry, graceSeconds, isLockEnabled, requestUnlock } from "@/lib/app-lock";

/**
 * The lock screen, and the resume handling that raises it.
 *
 * Mounted ABOVE the router in App.tsx rather than as a route, for two reasons
 * that both matter: a route can be navigated away from by a deep link, and a
 * route renders inside the shell, so the chamber name and the nav would still
 * be readable behind it. This covers everything.
 *
 * Read `lib/app-lock.ts` before changing anything here — particularly the part
 * about this being a UX control and not a security boundary.
 */
export function AppLockGate({ children }: { children: React.ReactNode }) {
  const { signOut } = useSession();
  const [locked, setLocked] = useState(false);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!isNative()) return;
    void checkBiometry().then((b) => setLabel(b.label));
  }, []);

  const attemptUnlock = useCallback(async () => {
    setBusy(true);
    const ok = await requestUnlock(label);
    setBusy(false);
    if (ok) setLocked(false);
  }, [label]);

  useEffect(() => {
    if (!isNative()) return;

    let handle: { remove: () => void } | undefined;

    /*
     * `appStateChange` rather than the browser's visibilitychange.
     *
     * In a webview, visibilitychange does not fire reliably when the app is
     * backgrounded by the OS — which is the one case this whole feature is
     * about. Capacitor's event is the native lifecycle callback and does.
     */
    void CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) {
        backgroundedAt.current = Date.now();
        return;
      }

      const wentAway = backgroundedAt.current;
      backgroundedAt.current = null;
      if (wentAway === null) return;

      void (async () => {
        if (!(await isLockEnabled())) return;
        const grace = await graceSeconds();
        if (Date.now() - wentAway >= grace * 1000) setLocked(true);
      })();
    }).then((l) => {
      handle = l;
    });

    return () => handle?.remove();
  }, []);

  /*
   * Prompt as soon as the lock goes up, without waiting for a tap.
   *
   * Returning to a locked app and having to press a button before the
   * fingerprint reader will even listen is a wasted step. The button below is
   * the fallback for a prompt that was dismissed, not the primary path.
   */
  useEffect(() => {
    if (locked) void attemptUnlock();
  }, [locked, attemptUnlock]);

  if (!locked) return <>{children}</>;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-[var(--radius)] bg-card shadow-[var(--raise)]">
        <Lock className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
      </div>
      <div>
        <h1 className="font-mono text-sm uppercase tracking-widest">Locked</h1>
        <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
          {label
            ? `Confirm with ${label} to get back to your chamber.`
            : "Confirm your device passcode to get back to your chamber."}
        </p>
      </div>
      <div className="flex flex-col items-center gap-3">
        <Button className="min-h-11 rounded-lg px-8" disabled={busy} onClick={attemptUnlock}>
          {busy ? "Waiting…" : "Unlock"}
        </Button>
        {/* The way out when the reader will not cooperate at all — a cut
            finger, a cracked sensor. Without it the app is a brick. */}
        <button
          type="button"
          onClick={() => signOut()}
          className="min-h-9 font-mono text-2xs uppercase tracking-wider text-muted-foreground underline underline-offset-2"
        >
          Sign out instead
        </button>
      </div>
    </div>
  );
}
