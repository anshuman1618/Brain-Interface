# LEX Practice — Android

The chamber portal as an Android app. It is not a second product: it bundles the
**same** built SPA the web deployment serves and points it at the same API, so
every page, every capability guard and every route comes across by construction
rather than being re-implemented and left to drift.

- Package: `in.lexpractice.app`
- Web assets: `artifacts/practice-portal/dist/public`, copied in by `cap sync`
- Minimum SDK / target: whatever Capacitor 8 sets — see `android/variables.gradle`

**Companion documents:** `DECISIONS.md` (why the Android side is built this way),
`FLOW.md` (how a launch, a sign-in and a notification actually travel). Repo-wide
context is in the root `README.md`, `DECISIONS.md`, `FLOW.md` and `DEPLOYMENT.md`
§11.

---

## Where the code lives

| Branch                          | Contents                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------- |
| `claude/android-ios-app-lmx9g4` | Everything shared, plus both native projects so `cap sync` works while developing |
| `claude/android-app-lmx9g4`     | **This branch.** The Android project alone, plus its CI job                       |
| `claude/ios-app-lmx9g4`         | The iOS project alone                                                             |

Splitting them keeps each platform's delta reviewable on its own. The cost is
that `pnpm run sync` here syncs Android only.

---

## Building

```bash
# 1. Build the web bundle the app will ship.
#
# VITE_API_BASE_URL is not optional. Without it the bundle uses relative paths,
# which inside the webview resolve to https://localhost and reach nothing — and
# setting it is also what switches the client to bearer tokens, because a
# cross-origin cookie would never be sent.
VITE_CLERK_PUBLISHABLE_KEY=pk_live_... \
VITE_API_BASE_URL=https://lex-practice.onrender.com \
  pnpm --filter @workspace/practice-portal run build

# 2. Copy it into android/ and reconcile the plugin list.
pnpm --filter @workspace/mobile-app run sync

# 3. Build.
cd artifacts/mobile-app/android && ./gradlew assembleDebug
```

The APK lands in `android/app/build/outputs/apk/debug/`.

Open it in Android Studio instead with `pnpm --filter @workspace/mobile-app run open:android`.

### CI

`.github/workflows/ci.yml` has an `android` job that runs exactly the above on
`ubuntu-latest` (which ships the SDK) and uploads the APK as a build artifact.
That is where "does the Android project compile" gets answered.

---

## What the API needs

Set on the **API**, not here:

```
CORS_ALLOWED_ORIGINS=https://chambers.example.com,https://localhost,capacitor://localhost
```

`https://localhost` is this app's webview origin. It is shared with any other
Capacitor app on the device, which is only acceptable because auth rides on a
bearer token another app cannot read — see `DECISIONS.md`.

In **Clerk**, add `in.lexpractice.app://portal/callback` to the allowed redirect
URLs, or the OAuth round trip is refused before Google is ever reached.

---

## Not in this repository

Both are per-account and neither can be committed.

**`google-services.json`** → `android/app/`. Downloaded from your Firebase
project after adding an Android app with the id `in.lexpractice.app`.

Capacitor's `app/build.gradle` applies the Google Services plugin **only when
the file is present**:

```gradle
def servicesJSON = file('google-services.json')
if (servicesJSON.text) {
    apply plugin: 'com.google.gms.google-services'
}
```

So a build without it succeeds — push notifications simply do not work in that
APK. That is what makes the CI compile job possible at all.

**An upload keystore and `android/keystore.properties`.** Needed for a release
build, not a debug one. Losing the keystore means you cannot update the listing.

---

## Permissions, and when they are asked for

| Permission           | Why                               | When it is requested                    |
| -------------------- | --------------------------------- | --------------------------------------- |
| `INTERNET`           | The API                           | Install time                            |
| `CAMERA`             | Photograph a document into a case | First tap on **Photograph**             |
| `POST_NOTIFICATIONS` | Hearing and deadline reminders    | Only when notifications are switched on |
| `USE_BIOMETRIC`      | The app lock                      | Only when the lock is switched on       |

Camera and fingerprint are declared `<uses-feature … required="false">` so the
Play listing is not restricted to handsets that have them; both features report
themselves unavailable rather than crashing.

---

## Store submission

- **Confirm the package name first.** `in.lexpractice.app` is permanent once
  published.
- **Replace the icons.** Generated from `logo.svg` and serviceable, not designed.
- **Data safety form.** The app handles client-confidential legal files, uses the
  camera for document capture, and registers a device token. `docs/legal/privacy.md`
  has the substance.
- **A review account.** This platform is invite-only, so review needs credentials
  that reach a populated chamber.
