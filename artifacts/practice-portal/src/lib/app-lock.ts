import {
  BiometricAuth,
  BiometryType,
  type CheckBiometryResult,
} from "@aparajita/capacitor-biometric-auth";
import { Preferences } from "@capacitor/preferences";
import { isNative } from "@/lib/platform";

/**
 * Face ID / fingerprint on returning to the app.
 *
 * WHAT THIS IS NOT: a security boundary. The session token still lives in the
 * webview exactly as it did before, the API cannot tell a locked app from an
 * unlocked one, and anybody who can read the device's storage can read it
 * whether this is on or off. Nothing here is encryption, and no user-facing
 * copy should imply it is.
 *
 * What it IS: the answer to a phone left face-up on a table between hearings.
 * Client files are the kind of thing you do not want a passer-by scrolling
 * through, and signing out and back in a dozen times a day is not a real
 * option. That is a genuine problem worth solving, and it is worth solving
 * honestly rather than describing it as protection it does not provide.
 *
 * Off by default: turning it on is a deliberate choice in Settings, because a
 * lock somebody did not ask for reads as the app being broken.
 */

const ENABLED_KEY = "lex.applock.enabled";
const GRACE_KEY = "lex.applock.graceSeconds";

/**
 * How long the app may sit in the background before it re-locks.
 *
 * Not zero: switching to the mail app to copy a hearing date and coming back
 * must not demand a fingerprint every time, or the feature gets turned off
 * within a day. Ninety seconds covers an app switch and not a pocket.
 */
export const DEFAULT_GRACE_SECONDS = 90;

export type BiometryAvailability = {
  /** The device can do this at all. */
  available: boolean;
  /** Face ID / Touch ID / fingerprint — for naming it accurately in the UI. */
  label: string;
  /** Why it is unavailable, when it is. */
  reason: string;
};

function labelFor(type: BiometryType): string {
  switch (type) {
    case BiometryType.faceId:
      return "Face ID";
    case BiometryType.touchId:
      return "Touch ID";
    case BiometryType.fingerprintAuthentication:
      return "fingerprint";
    case BiometryType.faceAuthentication:
      return "face unlock";
    case BiometryType.irisAuthentication:
      return "iris unlock";
    default:
      return "biometric unlock";
  }
}

/** What this handset can actually do. Never throws. */
export async function checkBiometry(): Promise<BiometryAvailability> {
  if (!isNative()) {
    return { available: false, label: "", reason: "Only available in the mobile app." };
  }
  try {
    const info: CheckBiometryResult = await BiometricAuth.checkBiometry();
    return {
      available: info.isAvailable,
      label: labelFor(info.biometryType),
      // `reason` is Capacitor's own explanation — "no enrolled biometrics",
      // "hardware unavailable". Passing it through beats inventing wording
      // for a state we cannot reproduce.
      reason: info.isAvailable ? "" : (info.reason ?? "Not set up on this device."),
    };
  } catch {
    return { available: false, label: "", reason: "Not available on this device." };
  }
}

export async function isLockEnabled(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const { value } = await Preferences.get({ key: ENABLED_KEY });
    return value === "1";
  } catch {
    return false;
  }
}

export async function setLockEnabled(enabled: boolean): Promise<void> {
  try {
    await Preferences.set({ key: ENABLED_KEY, value: enabled ? "1" : "0" });
  } catch {
    /* Storage unavailable; the setting just will not persist. */
  }
}

export async function getGraceSeconds(): Promise<number> {
  try {
    const { value } = await Preferences.get({ key: GRACE_KEY });
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_GRACE_SECONDS;
  } catch {
    return DEFAULT_GRACE_SECONDS;
  }
}

export async function setGraceSeconds(seconds: number): Promise<void> {
  try {
    await Preferences.set({ key: GRACE_KEY, value: String(Math.max(0, Math.floor(seconds))) });
  } catch {
    /* see setLockEnabled */
  }
}

/**
 * Prompt to unlock. Resolves true only on a real success.
 *
 * `allowDeviceCredential` lets the device PIN stand in, which matters more than
 * it looks: a wet or cold finger fails biometrics repeatedly, and without a
 * fallback the only way back into the app is to reinstall it.
 */
export async function requestUnlock(label: string): Promise<boolean> {
  if (!isNative()) return true;
  try {
    await BiometricAuth.authenticate({
      reason: "Unlock LEX Practice",
      cancelTitle: "Sign out instead",
      allowDeviceCredential: true,
      iosFallbackTitle: "Use passcode",
      androidTitle: "Unlock LEX Practice",
      androidSubtitle: label ? `Confirm with ${label}` : undefined,
      androidConfirmationRequired: false,
    });
    return true;
  } catch {
    // Every failure is the same outcome here — cancelled, too many attempts,
    // no longer enrolled. The lock screen stays up and offers sign-out.
    return false;
  }
}
