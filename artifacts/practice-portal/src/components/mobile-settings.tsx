import { useEffect, useState } from "react";
import { BellRing, Fingerprint, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { isNative } from "@/lib/platform";
import { enablePush, pushPermissionState, type PushPermission } from "@/lib/native-push";
import {
  checkBiometry,
  isLockEnabled,
  setLockEnabled,
  type BiometryAvailability,
} from "@/lib/app-lock";

/**
 * The two settings that only exist in the app.
 *
 * Renders nothing on the web — there is no honest thing to show there. A
 * greyed-out "install the app to use this" row is an advert, not a setting.
 */
export function MobileSettings() {
  const { toast } = useToast();
  const [permission, setPermission] = useState<PushPermission>("unsupported");
  const [enabling, setEnabling] = useState(false);
  const [biometry, setBiometry] = useState<BiometryAvailability | null>(null);
  const [lockOn, setLockOn] = useState(false);

  useEffect(() => {
    if (!isNative()) return;
    let cancelled = false;
    void (async () => {
      const [perm, bio, lock] = await Promise.all([
        pushPermissionState(),
        checkBiometry(),
        isLockEnabled(),
      ]);
      if (cancelled) return;
      setPermission(perm);
      setBiometry(bio);
      setLockOn(lock);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isNative()) return null;

  const turnOnPush = async () => {
    setEnabling(true);
    const result = await enablePush();
    setEnabling(false);
    if (result.ok) {
      setPermission("granted");
      toast({
        title: "Notifications on",
        description: "Hearings and deadlines will reach this device.",
      });
    } else {
      toast({ title: "Not enabled", description: result.reason, variant: "destructive" });
    }
  };

  const toggleLock = async (next: boolean) => {
    setLockOn(next);
    await setLockEnabled(next);
    toast({
      title: next ? "App lock on" : "App lock off",
      description: next
        ? "LEX Practice will ask to unlock after it has been in the background."
        : undefined,
    });
  };

  return (
    <section className="space-y-3">
      <h3 className="font-mono text-2xs uppercase tracking-widest text-muted-foreground">
        On this device
      </h3>

      <div className="rounded-lg bg-card shadow-sm divide-y divide-border">
        <div className="p-4 flex items-start gap-3">
          <BellRing className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Notifications</p>
            <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
              Hearings and filings from the chamber calendar, task deadlines, and document requests
              — a day ahead and again two hours before.
            </p>
            {permission === "denied" && (
              <p className="text-xs text-destructive mt-2">
                Switched off for LEX Practice in your device settings. It has to be turned back on
                there.
              </p>
            )}
          </div>
          {permission === "granted" ? (
            <span className="font-mono text-3xs uppercase tracking-wider text-muted-foreground shrink-0 pt-1">
              On
            </span>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="rounded-lg shrink-0"
              disabled={enabling || permission === "denied"}
              onClick={() => void turnOnPush()}
            >
              {enabling && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Turn on
            </Button>
          )}
        </div>

        <div className="p-4 flex items-start gap-3">
          <Fingerprint className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Lock with {biometry?.label || "biometrics"}</p>
            {/* Said plainly, because it would be easy — and wrong — to read this
                as encryption. See lib/app-lock.ts. */}
            <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
              Asks to unlock when you come back to the app. It keeps a passer-by out of an unlocked
              phone; it does not encrypt anything on this device.
            </p>
            {biometry && !biometry.available && (
              <p className="text-xs text-muted-foreground mt-2">{biometry.reason}</p>
            )}
          </div>
          <Switch
            checked={lockOn}
            disabled={!biometry?.available}
            onCheckedChange={(v) => void toggleLock(v)}
            aria-label="Lock the app with biometrics"
            className="shrink-0 mt-0.5"
          />
        </div>
      </div>
    </section>
  );
}
