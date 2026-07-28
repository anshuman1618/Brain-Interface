---
name: Orval schema/operation naming collision
description: Why a components.schemas name can collide with orval's generated zod const for a request body, breaking codegen with TS2308.
---

When an OpenAPI path's `requestBody` references (or inlines) a schema for an
operation, orval's zod-client generator names the runtime zod const
`<OperationIdPascalCase>Body` (e.g. operationId `selectRole` -> `SelectRoleBody`)
in `generated/api.ts`, regardless of whether the body schema is inline or a
`$ref`. Orval also generates a standalone TS interface file under
`generated/types/` for any schema referenced by name in `components.schemas`.

If you name a reusable `components.schemas` entry exactly `SelectRoleBody`
(matching what orval would auto-derive from the operationId), both the zod
const and the TS interface end up exported under the same identifier, and the
barrel `index.ts` that re-exports both `generated/api` and `generated/types`
fails to build with `TS2308: Module has already exported a member named 'X'`.

**Why:** Existing schemas in this codebase (e.g. `TaskUpdate` used for
`updateTask`, `InviteInput` used for `createInvite`) never hit this because
their schema name differs from the operationId-derived `Body` name orval
generates internally — there's no collision when the two names differ.

**How to apply:** When adding a new named request-body schema, don't name it
`<OperationId>Body`. Pick a name that reads well on its own and differs from
the auto-derived name, e.g. `RoleSelectionInput` / `UserRoleUpdateInput`
instead of `SelectRoleBody` / `UpdateUserRoleBody`. Inlining the schema
anonymously does NOT avoid the collision — orval still auto-names the type
file after the operationId in that case.
