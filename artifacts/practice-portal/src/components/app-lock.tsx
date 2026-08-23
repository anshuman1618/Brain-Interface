import { useCallback, useEffect, useRef, useState } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { Lock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/session";
import { isNative } from "@/lib/platform";
import {
  checkBiometry,
  getGraceSeconds,
  isLockEnabled,
  requestUnlock,
  type BiometryAvailability,
} from "@/lib/app-lock";

/**
 * Covers the application while the app is locked.
 *
 * Rendered ABOVE the router rather than inside a route, so no page mounts,
 * fetches, or paints behind it. That is the whole mechanism — see lib/app-lock.ts
 * on what this does and does not protect.
 *
 * Inert on the web: `isNative()` is false, no listener is registered, and the
 * children render exactly as they did before.
 */
export function AppLockGate({ children }: { children: React.ReactNode }) {
  const { isSignedIn, signOut } = useSession();

  const [enabled, setEnabled] = useState(false);
  const [locked, setLocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [biometry, setBiometry] = useState<BiometryAvailability | null>(null);

  /** When the app went to the background. Null while it is in front. */
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!isNative()) return;
    let cancelled = false;
    void (async () => {
      const [on, info] = await Promise.all([isLockEnabled(), checkBiometry()]);
      if (cancelled) return;
      // A lock that was switched on and then had its biometrics removed from
      // the device would otherwise be unopenable. `requestUnlock` falls back to
      // the device passcode, so it stays usable — but if the platform reports
      // nothing at all, do not lock.
      setEnabled(on && info.available);
      setBiometry(info);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const unlock = useCallback(async () => {
    setUnlocking(true);
    const ok = await requestUnlock(biometry?.label ?? "");
    setUnlocking(false);
    if (ok) setLocked(false);
  }, [biometry]);

  useEffect(() => {
    if (!isNative() || !enabled || !isSignedIn) return;

    let listener: { remove: () => void } | null = null;
    void CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) {
        backgroundedAt.current = Date.now();
        return;
      }
      const since = backgroundedAt.current;
      backgroundedAt.current = null;
      if (since === null) return;
      void (async () => {
        const grace = await getGraceSeconds();
        // Grace exists so that switching out to read a code and coming straight
        // back does not demand a fingerprint. See DEFAULT_GRACE_SECONDS.
        if (Date.now() - since >= grace * 1000) setLocked(true);
      })();
    }).then((l) => {
      listener = l;
    });

    return () => listener?.remove();
  }, [enabled, isSignedIn]);

  // Locking a signed-out app would trap somebody on a screen whose only escape
  // is the sign-out they have already done.
  if (!locked || !isSignedIn) return <>{children}</>;

  return (
    <>
      {/* Kept mounted, and inert: unmounting the tree would throw away every
          cached query and in-progress form, so unlocking would land the user
          on a blank dashboard instead of where they left off. */}
      <div aria-hidden="true" className="pointer-events-none select-none blur-sm">
        {children}
      </div>

      <div
        role="dialog"
        aria-modal="true"
        aria-label="LEX Practice is locked"
        className="fixed inset-0 z-[100] bg-background flex flex-col items-center justify-center gap-6 px-6 pt-safe pb-safe"
      >
        <div className="h-14 w-14 rounded-lg bg-muted flex items-center justify-center">
          <Lock className="h-6 w-6 text-muted-foreground" />
        </div>

        <div className="text-center space-y-2 max-w-xs">
          <h1 className="text-lg font-bold tracking-tight">LEX Practice is locked</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {biometry?.label
              ? `Unlock with ${biometry.label} to return to your chamber.`
              : "Unlock to return to your chamber."}
          </p>
        </div>

        <div className="flex flex-col gap-2 w-full max-w-xs">
          <Button className="rounded-lg w-full" onClick={() => void unlock()} disabled={unlocking}>
            {unlocking ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {unlocking ? "Waiting..." : "Unlock"}
          </Button>
          <Button
            variant="ghost"
            className="rounded-lg w-full text-destructive"
            onClick={() => {
              setLocked(false);
              signOut();
            }}
          >
            Sign out instead
          </Button>
        </div>
      </div>
    </>
  );
}
