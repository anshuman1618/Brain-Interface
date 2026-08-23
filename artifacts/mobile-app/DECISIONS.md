# Android — decisions

Why the Android side is built the way it is. Repo-wide decisions (Capacitor over
React Native, bundled assets, the identity model) are in the root
`DECISIONS.md`; this file is what is specific to Android, and to the things a
reader would otherwise assume were arbitrary.

---

## `allowNavigation: []` is what makes Google sign-in work

**Decided:** `server.allowNavigation` in `capacitor.config.ts` is empty, and the
OAuth round trip returns through the `in.lexpractice.app://` intent-filter.

**Why:** Google refuses OAuth inside an embedded WebView outright —
`disallowed_useragent` — so the flow has to leave the app. Because no provider
host is listed, Capacitor hands any non-local navigation to a **Custom Tab**
automatically. That is documented Capacitor behaviour doing real work here, not
incidental configuration.

**The trap, stated because it looks like a fix:** adding `accounts.google.com`
or a Clerk domain to that list pulls the flow back inside the WebView and breaks
sign-in. Anybody debugging "OAuth doesn't work" will be tempted to do exactly
that.

Email and SMS one-time codes never leave the WebView and are unaffected.

---

## `launchMode="singleTask"` is load-bearing, not a default

**Decided:** `MainActivity` keeps the `singleTask` launch mode Capacitor
generates.

**Why:** it is what makes the OAuth return land in the **running** activity.
Without it, `in.lexpractice.app://portal/callback` starts a second copy of the
app — one with no half-finished Clerk sign-in in memory to complete — and the
user is bounced back to the sign-in screen having done everything right.

The `appUrlOpen` listener in `lib/native.ts` is the other half; neither works
alone.

---

## `androidScheme: "https"`, not Capacitor's older default

**Decided:** the WebView is served from `https://localhost`.

**Why:** it puts the page in a **secure context**. Without it `crypto.subtle`
and every other API gated on secure origins is simply missing, and the failure
presents as a broken app rather than as a scheme setting — which is a long way
to travel to find a one-line config change.

It is also why `https://localhost` (not `http://`) is the origin that has to
appear in the API's `CORS_ALLOWED_ORIGINS`.

---

## `allowMixedContent: false`

**Decided:** left off.

**Why:** the bundle is served over `https` and the API is `https` in every
deployment, so nothing legitimate needs it. Leaving it on would let a plaintext
request succeed silently — which is precisely the failure you want to be loud.

---

## The Google Services plugin is conditional, and that is what lets CI compile

**Decided:** `google-services.json` is not committed, and the plugin is applied
only if the file exists — Capacitor's own template, kept rather than replaced.

**Why it matters here:** the file is per-Firebase-project and belongs to the
account that owns it, so it cannot live in the repository. If the plugin were
applied unconditionally, every build without it would fail — including the CI
job whose entire purpose is to answer "does this compile".

**The consequence, stated plainly:** an APK built without that file has no push
notifications. It is a valid app, not a broken one, and CI's artifact is exactly
that.

---

## `POST_NOTIFICATIONS` is requested late, never at launch

**Decided:** the runtime prompt fires only when somebody switches notifications
on in Settings.

**Why:** Android 13 made this a runtime permission, and a permission dialog
shown before the user knows what the app does is the one most often refused —
often permanently, which on Android means going into system settings to undo.
Asking at the moment of "turn on hearing reminders" makes the request legible.

---

## Camera and fingerprint are declared optional

**Decided:** `<uses-feature android:required="false">` for both.

**Why:** `<uses-permission android:name="CAMERA">` implies
`<uses-feature android:name="android.hardware.camera">` as **required** unless
you say otherwise, which silently removes the Play listing from every device
without a camera. Both features degrade to "unavailable" in the UI rather than
crashing, so there is no reason to narrow the audience.

---

## CI builds Android and not iOS

**Decided:** an `android` job on `ubuntu-latest`; no macOS runner.

**Why:** `ubuntu-latest` ships the Android SDK, so the job costs nothing beyond
the minutes. A macOS runner costs roughly ten times a Linux one to tell us
essentially what this job already does. The iOS archive is a documented step on
a Mac — see `DEPLOYMENT.md` §11f.

**Known limit:** this could not be verified in the environment the app was built
in. `dl.google.com` is blocked there by network policy, so Gradle cannot resolve
the Android Gradle Plugin at all. The job is written and correct in shape; its
first real run is its first proof.

---

## The debug build ships a preview bundle

**Decided:** CI builds the web bundle with no `VITE_CLERK_PUBLISHABLE_KEY` and no
`VITE_API_BASE_URL`.

**Why:** the job answers "does the native project compile", not "is the release
build correct". Building with real values would need production secrets in a job
that only runs a compiler. The APK it produces is therefore a preview-mode app —
useful for checking the shell launches, not for testing against real data.
