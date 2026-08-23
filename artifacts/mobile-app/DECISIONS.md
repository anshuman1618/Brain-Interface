# iOS — decisions

Why the iOS side is built the way it is. Repo-wide decisions (Capacitor over
React Native, bundled assets, the identity model) are in the root
`DECISIONS.md`; this file is what is specific to iOS, and to the things a reader
would otherwise assume were arbitrary.

---

## `backgroundColor: "#e6ded2"` is not decoration

**Decided:** the iOS webview gets an explicit opaque background matching the
light theme's `--background`.

**Why:** the design system is neumorphic. Every surface is extruded by a pair of
shadows — `--lift` above, `--sink` below — and both are drawn **on the ground
colour**. A transparent webview background lets the native window colour show
through those shadows, and the relief stops reading as extruded material and
starts reading as dirt on the screen.

It is the kind of setting that looks like a default worth cleaning up, and is
not. If the theme's light `--background` in `index.css` ever changes, this and
the `theme-color` metas in `index.html` change with it.

---

## `contentInset: "always"`, plus the safe-area utilities

**Decided:** `contentInset: "always"` in `capacitor.config.ts`, and the shell
applies `env(safe-area-inset-*)` through the `*-safe` utilities in `index.css`.

**Why both:** `viewport-fit=cover` lets the page paint edge to edge, which is
what makes the app look like an app rather than a boxed webpage — but it also
puts the sticky header under the clock and the footer under the home indicator.
The insets add exactly the notch back and nothing else; on a device without
cutouts every `env()` resolves to `0px` and the same class is inert.

Removing either one alone produces a subtly broken layout on notched hardware
only, which is the hardest kind to catch.

---

## The usage strings are shipped copy, not configuration

**Decided:** `NSCameraUsageDescription`, `NSFaceIDUsageDescription` and the two
photo-library strings each name what the chamber gets, not the capability.

**Why:** Apple shows the string **verbatim** in the permission prompt, and
rejects a build that can reach one of those APIs without supplying it. So they
are user-facing product copy that happens to live in a plist — "Photograph a
document straight into a case file", not "This app requires camera access".

They should be reviewed by whoever reviews the rest of the product's wording.

---

## `NSAllowsArbitraryLoads: false`, recorded rather than omitted

**Decided:** App Transport Security is left at its strict default, and the key is
written out explicitly with `false`.

**Why write it at all:** the API is `https` in every deployment, so no exception
was ever needed. Stating it stops a future reader who hits a networking problem
from reaching for `NSAllowsArbitraryLoads: true` as a first guess — the entry is
there to say the question was asked and the answer was no.

---

## The keyboard accessory bar is hidden

**Decided:** `Keyboard.setAccessoryBarVisible({ isVisible: false })` on iOS in
`lib/native.ts`.

**Why:** the grey Previous/Next/Done strip sits above the keyboard and covers the
field it is nominally helping with on a short form — which is most forms here.
Capacitor's `resize: "native"` handles the actual viewport shrink; the bar adds
nothing but occlusion.

---

## OAuth leaves for `SFSafariViewController`

**Decided:** `allowNavigation: []` in `capacitor.config.ts`, and the return path
is the `CFBundleURLTypes` scheme in `Info.plist`.

**Why:** Google refuses OAuth inside an embedded webview outright
(`disallowed_useragent`), so the flow has to leave. With no provider host listed,
Capacitor hands any non-local navigation to `SFSafariViewController`
automatically — documented behaviour doing real work here, not incidental config.

**The trap, stated because it looks like a fix:** adding `accounts.google.com` or
a Clerk domain to that list pulls the flow back inside the webview and breaks
sign-in.

Email and SMS one-time codes never leave the webview and are unaffected.

---

## One FCM integration, with the APNs key uploaded to Firebase

**Decided:** the server speaks **only** FCM HTTP v1. The `.p8` APNs auth key is
uploaded to the Firebase project rather than used by the API directly.

**Why:** it makes iOS delivery a configuration step instead of a second
integration. The alternative — the server speaking APNs directly, with its own
ES256 JWT signer and its own outbox semantics — is a whole parallel transport to
build, test and keep working, for the same outcome.

**The consequence:** iOS push depends on somebody having uploaded that key. If
Android notifications arrive and iOS ones do not, that upload is the first thing
to check, not the app.

---

## No CI job, and that is a cost not an oversight

**Decided:** the workflow builds Android and says inline why it does not build
iOS.

**Why:** `pod install` and `xcodebuild` require macOS. A macOS runner costs
roughly ten times a Linux one, to tell us essentially what the Android job
already does — that the shared Capacitor config and plugin list are coherent.

**What it means in practice:** the iOS project's _first compile_ happens on
somebody's Mac. `cap sync` succeeding is not the same as building; it only proves
the assets copied and the plugin list reconciled.

**Revisit when:** iOS is on a release cadence where "it compiles" needs to be
known before somebody opens Xcode.
