---
name: Role storage — DB vs Clerk metadata
description: Decision to treat the app DB as the canonical source for user role/authorization, not Clerk publicMetadata or session claims.
---

For apps using Clerk auth with app-specific roles (e.g. admin/staff/client
tiers), store the canonical role in the app's own `users` table, not solely
in Clerk `publicMetadata`.

**Why:** Clerk session claims (JWT) only refresh on token rotation/expiry, so
authorization middleware that reads `getAuth(req).sessionClaims.publicMetadata`
can serve a stale role for a while after an admin changes it — a demoted user
keeps elevated access, or a promoted user is denied, until their session
token happens to refresh. Backend authorization checks and the frontend's
role-driven UI should read the DB-backed profile instead, which updates
immediately.

**How to apply:** Keep Clerk `publicMetadata.role` in sync on writes for
convenience/analytics, but never gate access on it. Any `requireRole`-style
middleware should look up the user's row in the DB (JIT-provisioning it if
new) and check `user.role` there. Frontend role hooks should read from a
DB-backed `/users/me`-style endpoint rather than `useUser().publicMetadata`.
