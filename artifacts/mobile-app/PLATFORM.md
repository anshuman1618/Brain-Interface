# Android

This branch carries the Android project. `artifacts/mobile-app/ios/` is on
`claude/ios-app-lmx9g4`; everything the two share — the Capacitor config, the
portal's native code, the push server, the responsive work — is on
`claude/android-ios-app-lmx9g4`, which both branch from.

Splitting them keeps each platform's delta small enough to review on its own.
The cost is that `cap sync` on this branch syncs Android only, which is what
`pnpm run sync` here does.

## Building

```bash
# From the repo root. The absolute API URL is what switches the client to
# bearer tokens — see DEPLOYMENT.md §11a.
VITE_CLERK_PUBLISHABLE_KEY=pk_live_... \
VITE_API_BASE_URL=https://lex-practice.onrender.com \
  pnpm --filter @workspace/practice-portal run build

pnpm --filter @workspace/mobile-app run sync
cd artifacts/mobile-app/android && ./gradlew assembleDebug
```

CI runs exactly that on every push (`.github/workflows/ci.yml`, `android` job)
and uploads the APK.

## What is not in the repository

- **`google-services.json`.** Per-Firebase-project, and it belongs to your
  account. Capacitor's `app/build.gradle` applies the Google Services plugin
  only when the file is present, so a build without it succeeds — push
  notifications simply do not work in that APK.
- **An upload keystore and `keystore.properties`.** Needed for a release build,
  not a debug one.

## Android-specific notes

- **The OAuth return** is the `in.lexpractice.app` intent-filter in
  `AndroidManifest.xml`, and it only lands in the running app because the
  activity is `launchMode="singleTask"`. Without that the user comes back to a
  second copy with no half-finished sign-in to complete.
- **`POST_NOTIFICATIONS`** is a runtime permission from Android 13. The app asks
  only when somebody switches notifications on, never at launch.
- **`androidScheme: "https"`** in `capacitor.config.ts` puts the webview in a
  secure context. Without it `crypto.subtle` is missing and the failure looks
  like a broken app rather than a scheme setting.
