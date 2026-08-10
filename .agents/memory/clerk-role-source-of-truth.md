---
name: Role storage — DB memberships, never Clerk metadata
description: Authorization comes from workspace membership rows in the app DB. Clerk publicMetadata is not consulted at all, because anything that can write it can grant itself a role.
---

For apps using Clerk auth with app-specific roles, store the canonical
authorization fact in the app's own database, and treat Clerk as an identity
provider only.

**Two separate reasons, and the second is the important one:**

1. **Staleness.** Clerk session claims (JWT) only refresh on token rotation, so
   middleware reading `getAuth(req).sessionClaims.publicMetadata` serves a stale
   role after an admin changes it — a demoted user keeps elevated access until
   their token happens to refresh.

2. **Privilege escalation.** Reading a role out of `publicMetadata` means
   _anything that can write publicMetadata can grant itself that role_. In this
   codebase the sign-up flow wrote the visitor's own frontend selection there,
   so choosing "Firm Admin" on a pre-auth screen produced a real admin. Removing
   the metadata read is the fix; syncing metadata "for convenience" reintroduces
   the temptation to read it, so do not write it either.

**How this codebase applies it:** access is an `active` row in
`workspace_memberships (workspace_id, user_id, role, status)`. JIT provisioning
creates a user with no memberships, so a fresh account reaches nothing. A
pre-auth role choice is stored as `requested_role` on a `pending` row, which no
authorization path reads; an admin's explicit approval sets the granted role
from _their_ input. `requireWorkspace` re-reads the membership row on every
request, so revocation takes effect on the next call rather than at token expiry.

**Scoped tokens are a supplement, not a substitute.** A signed workspace token
proves the switch was authorized at mint time; it cannot express a revocation
that happened afterwards. Verify the token _and_ re-read the membership.
