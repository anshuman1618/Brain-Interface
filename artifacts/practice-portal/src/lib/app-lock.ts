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
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
 *
 * **It is not a security boundary, and no user-facing copy may imply it is.**
 * The session token still lives in the webview exactly as it did before. The
 * API cannot tell a locked app from an unlocked one. Anybody who can read the
 * device's storage can read that token whether this is switched on or off.
 * Nothing here is encryption.
 *
 * ── WHAT IT IS ──────────────────────────────────────────────────────────────
 *
 * The answer to a phone left face-up on a table between hearings. Client files
 * are exactly the kind of thing you do not want a passer-by scrolling through,
 * and signing out and back in a dozen times a day is not a real option. That is
 * a genuine problem and it is worth solving honestly rather than describing it
 * as protection it does not provide.
 *
 * Off by default: a lock nobody asked for reads as the app being broken.
 */

const ENABLED_KEY = "lex.applock.enabled";
const GRACE_KEY = "lex.applock.graceSeconds";

/**
 * How long the app may sit in the background before it re-locks.
 *
 * Not zero. Switching to the mail app to copy a hearing date and coming back
 * must not demand a fingerprint every time, or the feature is switched off
 * within a day. Ninety seconds covers an app switch and does not cover a pocket.
 */
export const DEFAULT_GRACE_SECONDS = 90;

export type BiometryAvailability = {
  /** The device can do this at all. */
  available: boolean;
  /** "Face ID" / "fingerprint" / … — so the UI can name it accurately. */
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
    const result: CheckBiometryResult = await BiometricAuth.checkBiometry();
    return {
      available: result.isAvailable,
      label: labelFor(result.biometryType),
      reason: result.reason || "",
    };
  } catch {
    return { available: false, label: "", reason: "This device cannot check for biometry." };
  }
}

export async function isLockEnabled(): Promise<boolean> {
  if (!isNative()) return false;
  const { value } = await Preferences.get({ key: ENABLED_KEY });
  return value === "1";
}

export async function setLockEnabled(on: boolean): Promise<void> {
  await Preferences.set({ key: ENABLED_KEY, value: on ? "1" : "0" });
}

export async function graceSeconds(): Promise<number> {
  const { value } = await Preferences.get({ key: GRACE_KEY });
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_GRACE_SECONDS;
}

export async function setGraceSeconds(seconds: number): Promise<void> {
  await Preferences.set({ key: GRACE_KEY, value: String(seconds) });
}

/**
 * Ask for the fingerprint. Resolves true only on a real success.
 *
 * `allowDeviceCredential` lets the passcode stand in, which matters more than
 * it looks: a wet thumb, a mask, or three failed reads all end in a lockout
 * that would otherwise leave the only way back in being a full sign-out.
 *
 * Every failure — cancelled, locked out, unavailable — resolves false rather
 * than throwing. The caller's only sensible response to any of them is the same
 * (stay locked), and a rejected promise here would surface as an unhandled
 * error in a webview with no console anybody can read.
 */
export async function requestUnlock(label: string): Promise<boolean> {
  if (!isNative()) return true;
  try {
    await BiometricAuth.authenticate({
      reason: "Unlock LEX Practice",
      cancelTitle: "Cancel",
      allowDeviceCredential: true,
      iosFallbackTitle: "Use passcode",
      androidTitle: "Unlock LEX Practice",
      androidSubtitle: `Confirm with ${label || "biometrics"}`,
      androidConfirmationRequired: false,
    });
    return true;
  } catch {
    return false;
  }
}
