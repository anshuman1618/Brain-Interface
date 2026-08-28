import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  usersTable,
  workspacesTable,
  workspaceMembershipsTable,
  workspaceAccessListTable,
  normaliseDomain,
  normaliseEmail,
  normalisePhone,
  type Workspace,
  casesTable,
  caseAccessGrantsTable,
} from "@workspace/db";
import {
  GetSessionResponse,
  SwitchWorkspaceBody,
  SwitchWorkspaceResponse,
  ListWorkspacesResponse,
  CreateAccessRequestBody,
  CreateAccessRequestResponse,
  ListAccessRequestsResponse,
  DecideAccessRequestBody,
  DecideAccessRequestResponse,
  ListWorkspaceMembersResponse,
  UpdateWorkspaceMemberBody,
  UpdateWorkspaceMemberResponse,
  ListAccessListResponse,
  CreateAccessListEntryBody,
  CreateAccessListEntryResponse,
  CreateWorkspaceBody,
  CreateWorkspaceResponse,
  GetCaseAccessResponse,
  SetCaseAccessBody,
} from "@workspace/api-zod";
import {
  requireAuth,
  requireWorkspace,
  requireCapability,
  capabilitiesFor,
  ctx,
  listActiveMemberships,
  type AuthRequest,
} from "../middlewares/requireAuth";
import { getOrCreateUser, type AppUser } from "../lib/jit";
import { guardIdParams, parseId, zodMessage } from "../lib/validation";
import { displayRole, isWorkspaceRole, needsBarRegistration } from "../lib/permissions";
import { mintWorkspaceToken, verifyWorkspaceToken } from "../lib/workspace-token";
import { reconcileAccessList } from "../lib/access-list";
import { recordAudit } from "../lib/audit";
import { assertSeatAvailable, checkQuota, quotaMessage, usageFor } from "../lib/quota";
import { caseInWorkspace } from "../lib/scope";

const router: IRouter = Router();

// Every :id on this router must be a real int4 before it reaches a query.
guardIdParams(router, "id");

function workspaceView(w: Workspace) {
  return { id: w.id, slug: w.slug, name: w.name, kind: w.kind };
}

/**
 * Builds the session payload the frontend renders from.
 *
 * Everything here is derived server-side from membership rows. Nothing in it is
 * echoed back from the request. `capabilities` in particular is computed from
 * the role on the ACTIVE membership — the client receives the result of the
 * check, never the inputs to make its own.
 */
async function buildSessionClaims(userId: number, activeWorkspaceId: number | null) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));

  // Turn any standing access-list grant into a real membership. Idempotent, and
  // it never revives a membership that already exists in another state — so a
  // revoked user is not silently readmitted by their address still being listed.
  await reconcileAccessList(user);

  const membershipRows = await db
    .select({ membership: workspaceMembershipsTable, workspace: workspacesTable })
    .from(workspaceMembershipsTable)
    .innerJoin(workspacesTable, eq(workspacesTable.id, workspaceMembershipsTable.workspaceId))
    .where(eq(workspaceMembershipsTable.userId, userId));

  const memberships = membershipRows
    .filter((r) => r.membership.status !== "revoked")
    .map((r) => ({
      workspace: workspaceView(r.workspace),
      role: r.membership.role,
      status: r.membership.status,
      isOwner: r.membership.isOwner,
      requestedRole: r.membership.requestedRole ?? null,
    }));

  const active = memberships.filter((m) => m.status === "active");
  const pending = memberships.filter((m) => m.status === "pending");

  // Three distinct states, because they need three different screens. An address
  // that matched nothing is not "pending" — nobody is going to review it unless
  // the person asks — and telling them so is the error the sign-in layer shows.
  const accessStatus =
    active.length > 0
      ? ("active" as const)
      : pending.length > 0
        ? ("pending_approval" as const)
        : ("not_recognised" as const);

  // Fall back to the caller's only active membership so a fresh session works
  // before any explicit switch. With several, nothing is active until they choose.
  const selected =
    active.find((m) => m.workspace.id === activeWorkspaceId) ??
    (active.length === 1 ? active[0] : undefined);

  // Computed from the role on the ACTIVE membership, not stored — a person
  // who is an advocate in one chamber and a client in another must not be
  // blocked in the second by a role that does not apply there. True when no
  // role is selected yet: the pending-approval / access-denied screens take
  // over before this could ever gate anything.
  const profileComplete =
    !selected || !needsBarRegistration(selected.role)
      ? true
      : Boolean(user.barCouncilState?.trim() && user.barEnrolmentNo?.trim());

  return {
    userId: user.id,
    clerkId: user.clerkId,
    displayName: user.displayName,
    email: user.email,
    phone: user.phone ?? null,
    accessStatus,
    authProvider: user.authProvider || null,
    memberships,
    activeWorkspace: selected ? selected.workspace : null,
    role: selected ? selected.role : null,
    displayRole: selected ? displayRole(selected.role) : null,
    isOwner: selected ? selected.isOwner : false,
    capabilities: selected ? capabilitiesFor(selected.role, selected.isOwner) : [],
    profileComplete,
    workspaceToken: selected
      ? mintWorkspaceToken({ sub: user.clerkId, wsId: selected.workspace.id, role: selected.role })
      : null,
  };
}

// Deliberately behind requireAuth, not requireWorkspace: a user with no
// membership still needs to learn that they are pending approval.
router.get("/session", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const claims = verifyWorkspaceToken(req.header("x-workspace-token") ?? undefined);
  // `Number(undefined)` is NaN, and `NaN !== null`, so the old ternary here was
  // always true and passed NaN down as the requested workspace. It happened to
  // behave, because nothing equals NaN and the lookup fell through to the
  // single-membership default — but only by accident.
  const requested = claims?.wsId ?? parseId(req.header("x-workspace-id"));

  res.json(GetSessionResponse.parse(await buildSessionClaims(user.id, requested)));
});

/**
 * Workspace switch. The membership check is the whole point: the client asks,
 * the database decides, and a scoped token is only minted once it has said yes.
 */
router.post("/session/workspace", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = SwitchWorkspaceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", message: zodMessage(parsed.error) });
    return;
  }

  const memberships = await listActiveMemberships(user.id);
  const target = memberships.find((m) => m.workspace.id === parsed.data.workspaceId);
  if (!target) {
    res.status(403).json({
      error: "Forbidden",
      reason: "not_a_member",
      message: "You are not an active member of that workspace.",
    });
    return;
  }

  res.json(SwitchWorkspaceResponse.parse(await buildSessionClaims(user.id, target.workspace.id)));
});

/** Postgres unique violation, however deeply the driver error is wrapped. */
function isUniqueViolation(err: unknown, depth = 0): boolean {
  if (!err || typeof err !== "object" || depth > 4) return false;
  if ((err as { code?: unknown }).code === "23505") return true;
  return isUniqueViolation((err as { cause?: unknown }).cause, depth + 1);
}

/**
 * Creates the workspace, the founder's membership, their access-list entry and
 * their directory role as one atomic unit, on the first slug that is free.
 *
 * This used to be a select-then-insert loop outside any transaction. Two people
 * founding "Delhi Chambers" at the same moment both saw the slug as free, both
 * inserted, and the loser got a unique violation surfaced as a bare 500 — after
 * the workspace row had already been written, leaving a chamber with no member.
 * The conflict is now an expected outcome that retries on the next suffix, and
 * a failure anywhere in the sequence rolls the whole thing back.
 *
 * Returns null when every candidate slug is taken.
 */
async function foundChamber(
  baseSlug: string,
  name: string,
  role: "admin" | "senior_advocate",
  user: AppUser,
): Promise<Workspace | null> {
  for (let attempt = 0; attempt <= 50; attempt += 1) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;

    try {
      return await db.transaction(async (tx) => {
        const [workspace] = await tx
          .insert(workspacesTable)
          .values({ slug, name, kind: "chamber" })
          .returning();

        await tx.insert(workspaceMembershipsTable).values({
          workspaceId: workspace.id,
          userId: user.id,
          clerkId: user.clerkId,
          role,
          isOwner: true,
          status: "active",
          decidedBy: "founder",
          decidedAt: new Date(),
        });

        // Admit the founder's own identifiers so they can sign back in without
        // needing somebody else to let them in.
        //
        // Both when they have both, deliberately: a founder who signed up by
        // mobile and later verifies an address must not lose their own chamber
        // because the row was keyed on the one identifier they stopped using.
        // Founding by phone alone is the whole point of the feature — before
        // this took the phone into account, such a founder created a chamber
        // and was locked out of it on their next sign-in.
        const founderIdentifiers: { kind: "email" | "phone"; value: string }[] = [];
        if (user.email)
          founderIdentifiers.push({ kind: "email", value: normaliseEmail(user.email) });
        if (user.phone)
          founderIdentifiers.push({ kind: "phone", value: normalisePhone(user.phone) });

        for (const identifier of founderIdentifiers) {
          if (!identifier.value) continue;
          await tx.insert(workspaceAccessListTable).values({
            workspaceId: workspace.id,
            kind: identifier.kind,
            value: identifier.value,
            role,
            note: "Chamber founder",
            addedBy: user.displayName,
            lastUsedAt: new Date(),
          });
        }

        await tx
          .update(usersTable)
          .set({ role, roleSelected: true })
          .where(eq(usersTable.id, user.id));

        return workspace;
      });
    } catch (err) {
      // Only a slug clash is retryable. Anything else is a real failure and
      // must not be retried fifty times.
      if (!isUniqueViolation(err)) throw err;
    }
  }

  return null;
}

/**
 * Create a chamber. This is the self-serve sign-up path.
 *
 * It is the one place a user picks their own role, and it is safe precisely
 * because the workspace did not exist a moment ago: becoming Admin of a chamber
 * you just created grants nothing over anybody else's. Choosing a role for an
 * *existing* workspace remains impossible — that is still an admin's decision.
 *
 * The founder is marked `isOwner`, which adds the management capabilities on top
 * of their practice role so a Senior Advocate who set up their own chamber can
 * still invite their clerk.
 */
router.post("/workspaces", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = CreateWorkspaceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", message: zodMessage(parsed.error) });
    return;
  }

  const name = parsed.data.name.trim();
  if (name.length < 2) {
    res.status(400).json({ error: "Give the chamber a name." });
    return;
  }

  // The spec restricts this to admin | senior_advocate; re-check rather than
  // trusting the generated validator alone, since this is the one role input a
  // user supplies for themselves.
  if (parsed.data.role !== "admin" && parsed.data.role !== "senior_advocate") {
    res
      .status(400)
      .json({ error: "A chamber must be created by its Firm Admin or a Senior Advocate." });
    return;
  }

  const baseSlug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "chamber";

  const workspace = await foundChamber(baseSlug, name, parsed.data.role, user);
  if (!workspace) {
    res.status(409).json({ error: "That chamber name is already taken." });
    return;
  }

  await recordAudit(
    req,
    { workspaceId: workspace.id, role: parsed.data.role, user },
    {
      action: "workspace.created",
      entityType: "workspace",
      entityId: workspace.id,
      summary: `Founded "${workspace.name}" as ${displayRole(parsed.data.role)}`,
    },
  );

  res
    .status(201)
    .json(CreateWorkspaceResponse.parse(await buildSessionClaims(user.id, workspace.id)));
});

// Only workspaces backed by a membership row for this user. There is no
// "list all workspaces" endpoint anywhere in the API, by design.
router.get("/workspaces", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const rows = await db
    .select({ membership: workspaceMembershipsTable, workspace: workspacesTable })
    .from(workspaceMembershipsTable)
    .innerJoin(workspacesTable, eq(workspacesTable.id, workspaceMembershipsTable.workspaceId))
    .where(eq(workspaceMembershipsTable.userId, user.id));

  res.json(
    ListWorkspacesResponse.parse(
      rows
        .filter((r) => r.membership.status !== "revoked")
        .map((r) => ({
          workspace: workspaceView(r.workspace),
          role: r.membership.role,
          status: r.membership.status,
          requestedRole: r.membership.requestedRole ?? null,
        })),
    ),
  );
});

/**
 * Access request. This is what the pre-auth "Viewing as" choice turns into.
 *
 * It writes a `pending` row and nothing else. The requested role is stored in
 * `requestedRole`, where no authorization path reads it; `role` is seeded to the
 * least-privileged value so that even a bug that flipped status to active could
 * not hand out admin.
 */
router.post("/access-requests", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = CreateAccessRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", message: zodMessage(parsed.error) });
    return;
  }

  const [workspace] = await db
    .select()
    .from(workspacesTable)
    .where(eq(workspacesTable.slug, parsed.data.workspaceSlug));
  if (!workspace) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }

  const [existing] = await db
    .select()
    .from(workspaceMembershipsTable)
    .where(
      and(
        eq(workspaceMembershipsTable.userId, user.id),
        eq(workspaceMembershipsTable.workspaceId, workspace.id),
      ),
    );
  if (existing) {
    res.status(409).json({
      error: "Conflict",
      message:
        existing.status === "active"
          ? "You are already a member of this workspace."
          : "You already have a request pending for this workspace.",
    });
    return;
  }

  const [created] = await db
    .insert(workspaceMembershipsTable)
    .values({
      workspaceId: workspace.id,
      userId: user.id,
      clerkId: user.clerkId,
      role: "client",
      requestedRole: parsed.data.requestedRole ?? null,
      requestNote: parsed.data.note ?? null,
      status: "pending",
    })
    .returning();

  // Record the intent on the user row too, purely for the admin's benefit when
  // reviewing. Nothing reads users.role for authorization any more.
  await db.update(usersTable).set({ roleSelected: true }).where(eq(usersTable.id, user.id));

  await recordAudit(
    req,
    { workspaceId: workspace.id, role: "client", user },
    {
      action: "access.requested",
      entityType: "membership",
      entityId: created.id,
      summary: `${user.displayName || user.email} requested access to "${workspace.name}"`,
    },
  );

  res.status(201).json(
    CreateAccessRequestResponse.parse({
      ...created,
      workspaceName: workspace.name,
      displayName: user.displayName,
      email: user.email,
      decidedAt: created.decidedAt?.toISOString() ?? null,
    }),
  );
});

async function membershipView(
  row: typeof workspaceMembershipsTable.$inferSelect,
  workspaceName: string,
) {
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, row.userId));
  return {
    ...row,
    workspaceName,
    displayName: u?.displayName ?? null,
    email: u?.email ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
  };
}

router.get(
  "/access-requests",
  requireWorkspace,
  requireCapability("access_control.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    const rows = await db
      .select()
      .from(workspaceMembershipsTable)
      .where(
        and(
          eq(workspaceMembershipsTable.workspaceId, c.workspaceId),
          eq(workspaceMembershipsTable.status, "pending"),
        ),
      );

    res.json(
      ListAccessRequestsResponse.parse(
        await Promise.all(rows.map((r) => membershipView(r, c.workspace.name))),
      ),
    );
  },
);

/**
 * Approve or deny. The granted role comes from the admin's decision body, not
 * from `requestedRole` — that separation is what stops "I asked for admin" from
 * ever becoming "I am admin".
 */
router.post(
  "/access-requests/:id/decision",
  requireWorkspace,
  requireCapability("access_control.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    const id = parseId(req.params["id"]);
    if (id === null) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const parsed = DecideAccessRequestBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", message: zodMessage(parsed.error) });
      return;
    }

    // Scoped to the admin's own workspace: an admin of one tenant cannot decide
    // requests in another, even holding a valid request id.
    const [existing] = await db
      .select()
      .from(workspaceMembershipsTable)
      .where(
        and(
          eq(workspaceMembershipsTable.id, id),
          eq(workspaceMembershipsTable.workspaceId, c.workspaceId),
        ),
      );
    if (!existing) {
      res.status(404).json({ error: "Access request not found" });
      return;
    }

    if (parsed.data.decision === "approve") {
      const grantedRole = parsed.data.role;
      if (!grantedRole || !isWorkspaceRole(grantedRole)) {
        res.status(400).json({ error: "A role must be chosen when approving a request" });
        return;
      }

      // Admitting somebody takes a seat, and seats are what the plan sells.
      const seatBreach = await checkQuota(c.workspaceId, "seats");
      if (seatBreach) {
        const usage = await usageFor(c.workspaceId);
        res.status(402).json({
          error: "plan_limit",
          reason: "seats",
          message: quotaMessage(seatBreach, usage.plan),
          usage,
        });
        return;
      }

      const [updated] = await db
        .update(workspaceMembershipsTable)
        .set({
          role: grantedRole,
          status: "active",
          decidedBy: c.user.displayName,
          decidedAt: new Date(),
        })
        .where(eq(workspaceMembershipsTable.id, id))
        .returning();

      // Keep the directory row in step for display/listing purposes only.
      await db
        .update(usersTable)
        .set({ role: grantedRole, roleSelected: true })
        .where(eq(usersTable.id, existing.userId));

      await recordAudit(req, c, {
        action: "access.granted",
        entityType: "membership",
        entityId: updated.id,
        summary: `Granted ${displayRole(grantedRole)} to ${existing.clerkId}`,
      });

      res.json(DecideAccessRequestResponse.parse(await membershipView(updated, c.workspace.name)));
      return;
    }

    const [updated] = await db
      .update(workspaceMembershipsTable)
      .set({ status: "revoked", decidedBy: c.user.displayName, decidedAt: new Date() })
      .where(eq(workspaceMembershipsTable.id, id))
      .returning();

    res.json(DecideAccessRequestResponse.parse(await membershipView(updated, c.workspace.name)));
  },
);

/**
 * The access list — who may enter this workspace at all.
 *
 * Admin-only, and scoped to the admin's own workspace: an admin of one chamber
 * cannot admit anyone to another. This is the control that keeps "only an admin
 * grants access" true once Google and Zoho sign-in exist, since those providers
 * will authenticate any address in the world.
 */
router.get(
  "/workspace/access-list",
  requireWorkspace,
  requireCapability("access_control.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    const rows = await db
      .select()
      .from(workspaceAccessListTable)
      .where(eq(workspaceAccessListTable.workspaceId, c.workspaceId));

    res.json(
      ListAccessListResponse.parse(
        rows.map((r) => ({
          ...r,
          lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
          revokedAt: r.revokedAt?.toISOString() ?? null,
        })),
      ),
    );
  },
);

router.post(
  "/workspace/access-list",
  requireWorkspace,
  requireCapability("access_control.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const parsed = CreateAccessListEntryBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", message: zodMessage(parsed.error) });
      return;
    }

    // Normalise before storing so matching at sign-in is a plain equality check
    // and "Krishnan@Chambers.IN " cannot slip past an entry for the same address.
    const value =
      parsed.data.kind === "domain"
        ? normaliseDomain(parsed.data.value)
        : parsed.data.kind === "phone"
          ? normalisePhone(parsed.data.value)
          : normaliseEmail(parsed.data.value);

    if (parsed.data.kind === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      res.status(400).json({ error: "That does not look like an email address." });
      return;
    }
    if (parsed.data.kind === "domain" && !/^[^\s@]+\.[^\s@]+$/.test(value)) {
      res.status(400).json({ error: "That does not look like a domain, e.g. chambers.in" });
      return;
    }
    // normalisePhone returns "" for anything it cannot put in E.164, so the
    // empty check is the whole validation — there is no second-guessing a
    // number it accepted.
    if (parsed.data.kind === "phone" && !value) {
      res.status(400).json({
        error: "That does not look like a mobile number, e.g. +91 98765 43210",
      });
      return;
    }

    // The same rule as invites.ts, because this is the other of the two paths
    // that can create a client membership — closing it on only one would
    // leave "mandatory" false for whichever door was left open.
    if (parsed.data.role !== "client") {
      if (parsed.data.caseId != null) {
        res.status(400).json({
          error: "invalid_request",
          message: "Restrict to Case ID only applies to the Client role.",
        });
        return;
      }
    } else if (parsed.data.caseId == null) {
      res.status(400).json({
        error: "invalid_request",
        message: "A client entry must be restricted to a matter.",
      });
      return;
    } else if (!(await caseInWorkspace(c, parsed.data.caseId))) {
      res.status(404).json({ error: "That matter was not found in this chamber." });
      return;
    }
    const caseId = parsed.data.caseId ?? null;

    const [existing] = await db
      .select()
      .from(workspaceAccessListTable)
      .where(
        and(
          eq(workspaceAccessListTable.workspaceId, c.workspaceId),
          eq(workspaceAccessListTable.kind, parsed.data.kind),
          eq(workspaceAccessListTable.value, value),
        ),
      );

    // A previously revoked entry is reinstated rather than duplicated, so the
    // unique constraint holds and the original creation date survives.
    if (existing) {
      if (!existing.revokedAt) {
        res.status(409).json({ error: `${value} is already on the access list.` });
        return;
      }
      const [reinstated] = await db
        .update(workspaceAccessListTable)
        .set({
          revokedAt: null,
          role: parsed.data.role,
          caseId,
          note: parsed.data.note ?? null,
          addedBy: c.user.displayName,
        })
        .where(eq(workspaceAccessListTable.id, existing.id))
        .returning();
      res.status(201).json(
        CreateAccessListEntryResponse.parse({
          ...reinstated,
          lastUsedAt: reinstated.lastUsedAt?.toISOString() ?? null,
          revokedAt: null,
        }),
      );
      return;
    }

    const [created] = await db
      .insert(workspaceAccessListTable)
      .values({
        workspaceId: c.workspaceId,
        kind: parsed.data.kind,
        value,
        role: parsed.data.role,
        caseId,
        note: parsed.data.note ?? null,
        addedBy: c.user.displayName,
      })
      .returning();

    res.status(201).json(
      CreateAccessListEntryResponse.parse({
        ...created,
        lastUsedAt: null,
        revokedAt: null,
      }),
    );
  },
);

router.delete(
  "/workspace/access-list/:id",
  requireWorkspace,
  requireCapability("access_control.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    const id = parseId(req.params["id"]);
    if (id === null) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const [entry] = await db
      .select()
      .from(workspaceAccessListTable)
      .where(
        and(
          eq(workspaceAccessListTable.id, id),
          eq(workspaceAccessListTable.workspaceId, c.workspaceId),
        ),
      );
    if (!entry) {
      res.status(404).json({ error: "Access list entry not found" });
      return;
    }

    // Revoked, not deleted — the entry stays auditable. Note this stops *future*
    // sign-ins from being admitted; anyone already admitted keeps their
    // membership until it is revoked from Team Roles, which is the honest
    // behaviour and is said as much in the UI.
    await db
      .update(workspaceAccessListTable)
      .set({ revokedAt: new Date() })
      .where(eq(workspaceAccessListTable.id, id));

    res.sendStatus(204);
  },
);

router.get(
  "/workspace/members",
  requireWorkspace,
  requireCapability("team.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    const rows = await db
      .select()
      .from(workspaceMembershipsTable)
      .where(
        and(
          eq(workspaceMembershipsTable.workspaceId, c.workspaceId),
          eq(workspaceMembershipsTable.status, "active"),
        ),
      );

    res.json(
      ListWorkspaceMembersResponse.parse(
        await Promise.all(rows.map((r) => membershipView(r, c.workspace.name))),
      ),
    );
  },
);

router.patch(
  "/workspace/members/:id",
  requireWorkspace,
  requireCapability("team.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    const id = parseId(req.params["id"]);
    if (id === null) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const parsed = UpdateWorkspaceMemberBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", message: zodMessage(parsed.error) });
      return;
    }

    const [existing] = await db
      .select()
      .from(workspaceMembershipsTable)
      .where(
        and(
          eq(workspaceMembershipsTable.id, id),
          eq(workspaceMembershipsTable.workspaceId, c.workspaceId),
        ),
      );
    if (!existing) {
      res.status(404).json({ error: "Member not found" });
      return;
    }

    // An admin demoting or revoking themselves could leave the workspace with no
    // administrator and no way back in.
    if (existing.userId === c.user.id) {
      res.status(409).json({ error: "You cannot change your own membership." });
      return;
    }

    // If reactivating a revoked member, check the seat quota. Only check on
    // transition to active; editing an already-active member does not consume another seat.
    if (
      parsed.data.status === "active" &&
      existing.status !== "active" &&
      existing.status !== "pending"
    ) {
      const seatBreach = await assertSeatAvailable(c.workspaceId);
      if (seatBreach) {
        const usage = await usageFor(c.workspaceId);
        res.status(402).json({
          error: "plan_limit",
          reason: "seats",
          message: quotaMessage(seatBreach, usage.plan),
          usage,
        });
        return;
      }
    }

    const update: Partial<typeof workspaceMembershipsTable.$inferSelect> = {
      decidedBy: c.user.displayName,
      decidedAt: new Date(),
    };
    if (parsed.data.role) update.role = parsed.data.role;
    if (parsed.data.status) update.status = parsed.data.status;

    const [updated] = await db
      .update(workspaceMembershipsTable)
      .set(update)
      .where(eq(workspaceMembershipsTable.id, id))
      .returning();

    if (parsed.data.role) {
      await db
        .update(usersTable)
        .set({ role: parsed.data.role })
        .where(eq(usersTable.id, existing.userId));
    }

    res.json(UpdateWorkspaceMemberResponse.parse(await membershipView(updated, c.workspace.name)));
  },
);

/* ── Case access for a junior or a clerk ─────────────────────────────────── */

/**
 * Which matters one member may see.
 *
 * `access_control.manage` — admin, and the founder of the chamber. The same
 * boundary as the access list, because this is the same kind of decision:
 * who inside this chamber may see which of its files.
 *
 * Applies to `junior_advocate` and `clerk_intern` only. A senior advocate
 * directs the chamber's work and cannot be narrowed out of it; a client is
 * already confined to their own matter by row scope, and a second mechanism on
 * top would give two places to look when somebody cannot see something.
 */
const RESTRICTABLE_ROLES = ["junior_advocate", "clerk_intern"];

async function caseAccessFor(workspaceId: number, membershipId: number) {
  const [membership] = await db
    .select()
    .from(workspaceMembershipsTable)
    .where(
      and(
        eq(workspaceMembershipsTable.id, membershipId),
        eq(workspaceMembershipsTable.workspaceId, workspaceId),
      ),
    );
  if (!membership) return null;

  const grants = await db
    .select({ grant: caseAccessGrantsTable, matter: casesTable })
    .from(caseAccessGrantsTable)
    .innerJoin(casesTable, eq(casesTable.id, caseAccessGrantsTable.caseId))
    .where(
      and(
        eq(caseAccessGrantsTable.membershipId, membershipId),
        eq(caseAccessGrantsTable.workspaceId, workspaceId),
      ),
    );

  return {
    membershipId: membership.id,
    role: membership.role,
    restricted: membership.caseAccessRestricted,
    grantedCaseIds: grants.map((g) => g.grant.caseId),
    grants: grants.map(({ grant, matter }) => ({
      caseId: grant.caseId,
      caseTitle: matter.title,
      grantedBy: grant.grantedBy,
      createdAt: grant.createdAt.toISOString(),
    })),
  };
}

router.get(
  "/memberships/:id/case-access",
  requireWorkspace,
  requireCapability("access_control.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    const membershipId = parseId(req.params["id"]);
    const access = membershipId === null ? null : await caseAccessFor(c.workspaceId, membershipId);
    if (!access) {
      res.status(404).json({ error: "No such member in this chamber." });
      return;
    }
    res.json(GetCaseAccessResponse.parse(access));
  },
);

router.put(
  "/memberships/:id/case-access",
  requireWorkspace,
  requireCapability("access_control.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    const body = SetCaseAccessBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "invalid_request", message: zodMessage(body.error) });
      return;
    }
    const c = ctx(req);
    const membershipId = parseId(req.params["id"]);
    if (membershipId === null) {
      res.status(404).json({ error: "No such member in this chamber." });
      return;
    }

    const [membership] = await db
      .select()
      .from(workspaceMembershipsTable)
      .where(
        and(
          eq(workspaceMembershipsTable.id, membershipId),
          eq(workspaceMembershipsTable.workspaceId, c.workspaceId),
        ),
      );
    if (!membership) {
      res.status(404).json({ error: "No such member in this chamber." });
      return;
    }

    if (!RESTRICTABLE_ROLES.includes(membership.role)) {
      res.status(400).json({
        error: "invalid_request",
        message:
          "Case access can only be narrowed for a junior advocate or a clerk. A senior " +
          "advocate directs the chamber's work, and a client already sees only their own matter.",
      });
      return;
    }

    // Every id is checked to be a matter of THIS chamber before it is written.
    // An id from another chamber would otherwise sit in the table looking like
    // a grant — it would resolve to nothing at read time, but a row that means
    // nothing is worse than no row, because somebody will read it as access.
    const requested = [...new Set(body.data.caseIds ?? [])];
    const valid = requested.length
      ? await db
          .select({ id: casesTable.id })
          .from(casesTable)
          .where(and(inArray(casesTable.id, requested), eq(casesTable.workspaceId, c.workspaceId)))
      : [];
    const validIds = valid.map((r) => r.id);

    await db
      .update(workspaceMembershipsTable)
      .set({ caseAccessRestricted: body.data.restricted, updatedAt: new Date() })
      .where(eq(workspaceMembershipsTable.id, membershipId));

    // Sent as a complete set, not as add/remove: a stale client cannot silently
    // re-grant a matter an admin has just taken away. So the write is a replace.
    await db
      .delete(caseAccessGrantsTable)
      .where(eq(caseAccessGrantsTable.membershipId, membershipId));

    if (validIds.length > 0) {
      await db.insert(caseAccessGrantsTable).values(
        validIds.map((caseId) => ({
          workspaceId: c.workspaceId,
          membershipId,
          caseId,
          grantedBy: c.user.displayName,
          grantedByClerkId: c.user.clerkId,
          note: body.data.note ?? null,
        })),
      );
    }

    await recordAudit(req, c, {
      action: "member.case_access_changed",
      entityType: "workspace_membership",
      entityId: String(membershipId),
      summary: body.data.restricted
        ? `Restricted ${membership.role} to ${validIds.length} matter(s) plus their assigned work`
        : `Removed the case-access restriction on a ${membership.role}`,
    });

    const access = await caseAccessFor(c.workspaceId, membershipId);
    res.json(GetCaseAccessResponse.parse(access));
  },
);

export default router;
