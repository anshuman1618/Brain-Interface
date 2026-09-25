/**
 * Stands in for `firebase/messaging` at build time. Nothing here ever runs.
 *
 * `@capacitor-firebase/messaging` ships three implementations — Android, iOS
 * and web — and the web one imports the Firebase JavaScript SDK directly. That
 * SDK is an optional peer dependency (`firebase: ^12.6.0`), and the workspace
 * sets `autoInstallPeers: false`, so it is not installed. Rollup then fails the
 * production build on `"isSupported" is not exported by …` — a hard error, from
 * a code path this app cannot reach.
 *
 * It cannot reach it because **every** call into the plugin is behind
 * `isNative()` (see `native-push.ts`). On the web there is no registration, no
 * token and no listener; push is a handset feature and the browser build shows
 * no switch for it at all.
 *
 * So the alternatives were: install the whole Firebase web SDK to satisfy an
 * import that is dead here, or substitute it. This is the substitution, aliased
 * in `vite.config.ts`. Each export throws rather than returning a plausible
 * value, because a silent no-op would turn "somebody removed an `isNative()`
 * guard" into a notification that never arrives and nothing in the log — while
 * this turns it into a stack trace naming the file you are reading.
 */

const unreachable = (name: string) => (): never => {
  throw new Error(
    `firebase/messaging.${name}() was called in the browser build. Push is ` +
      `native-only and every call must sit behind isNative() — see ` +
      `src/lib/native-push.ts. This module is a build-time stub; the Firebase ` +
      `web SDK is deliberately not installed.`,
  );
};

export const getMessaging = unreachable("getMessaging");
export const getToken = unreachable("getToken");
export const deleteToken = unreachable("deleteToken");
export const onMessage = unreachable("onMessage");

/**
 * The one exception. `isSupported()` is a capability probe, and the honest
 * answer in a build with no Firebase SDK is "no" — so it answers rather than
 * throwing, and any caller that asks first behaves correctly instead of
 * crashing.
 */
export const isSupported = (): Promise<boolean> => Promise.resolve(false);
