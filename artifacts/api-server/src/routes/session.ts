import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  usersTable,
  workspacesTable,
  workspaceMembershipsTable,
  type Workspace,
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
} from "@workspace/api-zod";
import {
  requireAuth,
  requireWorkspace,
  requireCapability,
  ctx,
  listActiveMemberships,
  type AuthRequest,
} from "../middlewares/requireAuth";
import { getOrCreateUser } from "../lib/jit";
import { capabilitiesForRole, displayRole, isWorkspaceRole } from "../lib/permissions";
import { mintWorkspaceToken, verifyWorkspaceToken } from "../lib/workspace-token";

const router: IRouter = Router();

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
      requestedRole: r.membership.requestedRole ?? null,
    }));

  const active = memberships.filter((m) => m.status === "active");

  // Fall back to the caller's only active membership so a fresh session works
  // before any explicit switch. With several, nothing is active until they choose.
  const selected =
    active.find((m) => m.workspace.id === activeWorkspaceId) ??
    (active.length === 1 ? active[0] : undefined);

  return {
    userId: user.id,
    clerkId: user.clerkId,
    displayName: user.displayName,
    email: user.email,
    accessStatus: active.length > 0 ? ("active" as const) : ("pending_approval" as const),
    memberships,
    activeWorkspace: selected ? selected.workspace : null,
    role: selected ? selected.role : null,
    displayRole: selected ? displayRole(selected.role) : null,
    capabilities: selected ? capabilitiesForRole(selected.role) : [],
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
  const headerId = Number(req.header("x-workspace-id"));
  const requested = claims?.wsId ?? (Number.isInteger(headerId) ? headerId : null);

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
    res.status(400).json({ error: parsed.error.message });
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
    res.status(400).json({ error: parsed.error.message });
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

async function membershipView(row: typeof workspaceMembershipsTable.$inferSelect, workspaceName: string) {
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
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const parsed = DecideAccessRequestBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
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
      await db.update(usersTable).set({ role: grantedRole, roleSelected: true }).where(eq(usersTable.id, existing.userId));

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
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const parsed = UpdateWorkspaceMemberBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
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
      await db.update(usersTable).set({ role: parsed.data.role }).where(eq(usersTable.id, existing.userId));
    }

    res.json(UpdateWorkspaceMemberResponse.parse(await membershipView(updated, c.workspace.name)));
  },
);

export default router;
