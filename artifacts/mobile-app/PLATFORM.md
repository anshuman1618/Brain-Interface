# iOS

This branch carries the iOS project. `artifacts/mobile-app/android/` is on
`claude/android-app-lmx9g4`; everything the two share — the Capacitor config,
the portal's native code, the push server, the responsive work — is on
`claude/android-ios-app-lmx9g4`, which both branch from.

Splitting them keeps each platform's delta small enough to review on its own.
The cost is that `cap sync` on this branch syncs iOS only, which is what
`pnpm run sync` here does.

## Building — a Mac is required

There is no way around this. `pod install` and `xcodebuild` need macOS and
Xcode; nothing on a Linux CI runner can stand in for them, which is why this
branch has no build job.

```bash
# From the repo root. The absolute API URL is what switches the client to
# bearer tokens — see DEPLOYMENT.md §11a.
VITE_CLERK_PUBLISHABLE_KEY=pk_live_... \
VITE_API_BASE_URL=https://lex-practice.onrender.com \
  pnpm --filter @workspace/practice-portal run build

pnpm --filter @workspace/mobile-app run sync
cd artifacts/mobile-app/ios/App && pod install
cd .. && open App.xcworkspace     # the workspace, not the project
```

In Xcode, under **Signing & Capabilities**: set the team, then add **Push
Notifications** and **Background Modes → Remote notifications**. Neither is in
the committed project — both are tied to a provisioning profile.

## What is not in the repository

- **`GoogleService-Info.plist`.** Per-Firebase-project and tied to your account.
- **Signing certificates and provisioning profiles.**
- **The APNs auth key (`.p8`).** It is uploaded to Firebase rather than used
  here directly — that is what lets one FCM integration deliver to both
  platforms. See DEPLOYMENT.md §11d.

## iOS-specific notes

- **The OAuth return** is `CFBundleURLTypes` in `Info.plist`. Google refuses its
  consent screen inside an embedded webview, so the flow leaves for
  `SFSafariViewController` and comes back through the scheme.
- **The usage strings are shipped copy.** `NSCameraUsageDescription`,
  `NSFaceIDUsageDescription` and the two photo-library strings appear verbatim
  in the system prompt, and Apple rejects a build that omits one it can reach.
  Each names what the chamber gets, not the capability.
- **`backgroundColor: "#e6ded2"`** in `capacitor.config.ts` is not decoration.
  The neumorphic relief in `index.css` assumes an opaque ground; a transparent
  webview background lets the native window colour through the shadows and they
  read as dirt.
- **`contentInset: "always"`** plus the `*-safe` utilities is what keeps the
  sticky header out from under the notch.
