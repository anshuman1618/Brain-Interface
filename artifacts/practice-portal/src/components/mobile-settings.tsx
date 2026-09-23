import { useEffect, useState } from "react";
import { BellRing, Lock, Smartphone } from "lucide-react";
import { useRegisterDevice, useRevokeDevice } from "@workspace/api-client-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { userMessage } from "@/lib/errors";
import { isAndroid, isNative } from "@/lib/platform";
import { registerForPush, unregisterFromPush } from "@/lib/native-push";
import {
  checkBiometry,
  isLockEnabled,
  setLockEnabled,
  DEFAULT_GRACE_SECONDS,
} from "@/lib/app-lock";

/**
 * The two switches that only exist on a handset.
 *
 * Renders **nothing** on the web rather than showing controls that cannot work
 * — offering somebody a Face ID toggle in a desktop browser is worse than not
 * mentioning it, because the only way to discover it does nothing is to try.
 *
 * Both are off by default and both are the reader's choice. Notifications need
 * an OS permission prompt, and the app lock is a convenience somebody has to
 * want; turning either on unasked reads as the app misbehaving.
 */
export function MobileSettings() {
  const { toast } = useToast();
  const register = useRegisterDevice();
  const revoke = useRevokeDevice();

  const [pushOn, setPushOn] = useState(false);
  const [deviceId, setDeviceId] = useState<number | null>(null);
  const [pushBusy, setPushBusy] = useState(false);

  const [lockOn, setLockOn] = useState(false);
  const [biometryLabel, setBiometryLabel] = useState("");
  const [biometryReason, setBiometryReason] = useState("");

  useEffect(() => {
    if (!isNative()) return;
    void isLockEnabled().then(setLockOn);
    void checkBiometry().then((b) => {
      setBiometryLabel(b.label);
      setBiometryReason(b.available ? "" : b.reason);
    });
  }, []);

  if (!isNative()) return null;

  const togglePush = async (on: boolean) => {
    setPushBusy(true);
    try {
      if (!on) {
        // Revoke server-side FIRST. Unregistering locally without telling the
        // server leaves a live row that keeps being selected for every
        // reminder, and the handset silently stops receiving what the chamber
        // believes it is still being sent.
        if (deviceId !== null) await revoke.mutateAsync({ id: deviceId });
        await unregisterFromPush();
        setDeviceId(null);
        setPushOn(false);
        return;
      }

      const token = await registerForPush();
      if (!token) {
        /*
         * One message for every refusal — permission denied, no Play Services,
         * a simulator with no entitlement. The reader's next step is the same
         * in all of them, and naming an OS error code helps nobody holding a
         * phone.
         */
        toast({
          title: "Notifications are switched off",
          description:
            "The device did not allow it. Turn notifications on for LEX Practice in your phone's settings, then try again.",
          variant: "destructive",
        });
        setPushOn(false);
        return;
      }

      const result = await register.mutateAsync({
        data: { token, platform: isAndroid() ? "android" : "ios" },
      });
      setDeviceId(result.id);
      setPushOn(true);
      toast({
        title: "Notifications on",
        description: "Hearings and deadlines will reach this handset.",
      });
    } catch (err) {
      toast({
        title: "Could not change that",
        description: userMessage(err as Error),
        variant: "destructive",
      });
      setPushOn(!on);
    } finally {
      setPushBusy(false);
    }
  };

  const toggleLock = async (on: boolean) => {
    await setLockEnabled(on);
    setLockOn(on);
  };

  return (
    <section className="rounded-lg bg-card p-4 shadow-sm">
      <p className="flex items-center gap-2 font-mono text-2xs uppercase tracking-wider text-muted-foreground">
        <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />
        On this handset
      </p>

      <div className="mt-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Label htmlFor="push-switch" className="flex items-center gap-2 text-sm font-medium">
            <BellRing className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            Hearing and deadline alerts
          </Label>
          <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">
            Sent for this chamber only. A notification names the event and links into the app — it
            does not put the matter on your lock screen.
          </p>
        </div>
        <Switch
          id="push-switch"
          checked={pushOn}
          disabled={pushBusy}
          onCheckedChange={(v) => void togglePush(v)}
        />
      </div>

      <div className="mt-4 flex items-start justify-between gap-4 border-t border-border pt-4">
        <div className="min-w-0">
          <Label htmlFor="lock-switch" className="flex items-center gap-2 text-sm font-medium">
            <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            Lock after {DEFAULT_GRACE_SECONDS} seconds away
          </Label>
          {/*
            Said plainly, because the honest description is also the useful one.
            Anything stronger here — "encrypted", "protected" — would be false:
            the session token lives in the webview whether this is on or off.
            See lib/app-lock.ts.
          */}
          <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">
            {biometryReason
              ? biometryReason
              : `Asks for ${biometryLabel || "your passcode"} when you come back. It keeps a passer-by out of your files; it is not encryption, and it does not change what this app can reach.`}
          </p>
        </div>
        <Switch
          id="lock-switch"
          checked={lockOn}
          disabled={Boolean(biometryReason)}
          onCheckedChange={(v) => void toggleLock(v)}
        />
      </div>
    </section>
  );
}
