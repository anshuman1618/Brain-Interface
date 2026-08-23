# LEX Practice — iOS

The chamber portal as an iOS app. It is not a second product: it bundles the
**same** built SPA the web deployment serves and points it at the same API, so
every page, every capability guard and every route comes across by construction
rather than being re-implemented and left to drift.

- Bundle id: `in.lexpractice.app`
- Web assets: `artifacts/practice-portal/dist/public`, copied in by `cap sync`
- Xcode workspace: `ios/App/App.xcworkspace` — the **workspace**, not the project

**Companion documents:** `DECISIONS.md` (why the iOS side is built this way),
`FLOW.md` (how a launch, a sign-in and a notification actually travel). Repo-wide
context is in the root `README.md`, `DECISIONS.md`, `FLOW.md` and `DEPLOYMENT.md`
§11.

---

## Where the code lives

| Branch                          | Contents                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------- |
| `claude/android-ios-app-lmx9g4` | Everything shared, plus both native projects so `cap sync` works while developing |
| `claude/ios-app-lmx9g4`         | **This branch.** The iOS project alone                                            |
| `claude/android-app-lmx9g4`     | The Android project alone, plus its CI job                                        |

Splitting them keeps each platform's delta reviewable on its own. The cost is
that `pnpm run sync` here syncs iOS only.

---

## Building — a Mac is required

There is no way around this. `pod install` and `xcodebuild` need macOS and
Xcode; nothing on a Linux CI runner substitutes for them, which is why this
branch has no build job. See `DECISIONS.md`.

```bash
# 1. Build the web bundle the app will ship.
#
# VITE_API_BASE_URL is not optional. Without it the bundle uses relative paths,
# which inside the webview resolve to capacitor://localhost and reach nothing —
# and setting it is also what switches the client to bearer tokens, because a
# cross-origin cookie would never be sent.
VITE_CLERK_PUBLISHABLE_KEY=pk_live_... \
VITE_API_BASE_URL=https://lex-practice.onrender.com \
  pnpm --filter @workspace/practice-portal run build

# 2. Copy it into ios/ and reconcile the plugin list.
pnpm --filter @workspace/mobile-app run sync

# 3. Pods, then open the WORKSPACE.
cd artifacts/mobile-app/ios/App && pod install
cd .. && open App.xcworkspace
```

Or `pnpm --filter @workspace/mobile-app run open:ios`, which opens the right
one for you.

### In Xcode, before it will run on a device

Under **Signing & Capabilities**:

1. Set your team; Xcode will provision `in.lexpractice.app`.
2. Add **Push Notifications**.
3. Add **Background Modes** → tick **Remote notifications**.

None of the three is in the committed project — all are tied to a provisioning
profile, which is per-account.

---

## What the API needs

Set on the **API**, not here:

```
CORS_ALLOWED_ORIGINS=https://chambers.example.com,https://localhost,capacitor://localhost
```

`capacitor://localhost` is this app's webview origin. It is shared with any other
Capacitor app on the device, which is only acceptable because auth rides on a
bearer token another app cannot read — see `DECISIONS.md`.

In **Clerk**, add `in.lexpractice.app://portal/callback` to the allowed redirect
URLs, or the OAuth round trip is refused before Google is ever reached.

---

## Not in this repository

All of these are per-account and none can be committed.

**`GoogleService-Info.plist`** → `ios/App/App/`. Downloaded from your Firebase
project after adding an iOS app with the bundle id `in.lexpractice.app`.

**Signing certificates and provisioning profiles.** Xcode manages these once a
team is set.

**The APNs auth key (`.p8`).** Note where it goes: **uploaded to Firebase**
(Project settings → Cloud Messaging), not used directly by this app. That upload
is what lets a single FCM integration deliver to both platforms — the server
speaks only FCM and never APNs. See `DEPLOYMENT.md` §11d.

---

## Permissions, and when they are asked for

Each string below is shown **verbatim** in the system prompt, so they are shipped
copy rather than configuration. `Info.plist` holds them.

| Key                                 | Shown when                        |
| ----------------------------------- | --------------------------------- |
| `NSCameraUsageDescription`          | First tap on **Photograph**       |
| `NSPhotoLibraryUsageDescription`    | First tap on **From photos**      |
| `NSPhotoLibraryAddUsageDescription` | Saving a document out of a matter |
| `NSFaceIDUsageDescription`          | Switching the app lock on         |

Notification permission is requested only when somebody switches notifications
on — never at launch. On iOS the system prompt appears **once**; a refusal sends
the user to Settings to undo, so asking before they know what the app does is a
one-way mistake.

---

## Store submission

- **Confirm the bundle id first.** `in.lexpractice.app` is permanent once
  published.
- **Replace the icons.** Generated from `logo.svg` and serviceable, not designed.
- **App Privacy questionnaire.** The app handles client-confidential legal files,
  uses the camera for document capture, and registers a device token.
  `docs/legal/privacy.md` has the substance.
- **A review account.** This platform is invite-only, so App Review needs
  credentials that reach a populated chamber — and will reject the build without
  them.
- **Expect the "is this just a website?" question.** The answer is the native
  features: camera capture into case files, Face ID lock, push notifications.
  Bundled assets rather than a remote URL is the choice that makes that
  defensible.
