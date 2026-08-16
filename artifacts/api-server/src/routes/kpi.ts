import { Router, type IRouter } from "express";
import { inArray, sql } from "drizzle-orm";
import { db, casesTable, tasksTable, consultationsTable, timelineEventsTable } from "@workspace/db";
import {
  GetKpiDashboardResponse,
  GetSlaReportQueryParams,
  GetSlaReportResponse,
  GetDashboardSummaryResponse,
  GetChamberPerformanceQueryParams,
} from "@workspace/api-zod";
import { chamberPerformance } from "../lib/performance";
import { zodMessage } from "../lib/validation";
import {
  requireWorkspace,
  requireCapability,
  ctx,
  type AuthRequest,
} from "../middlewares/requireAuth";
import { visibleCaseIds, visibleTasks, workspaceCaseIds } from "../lib/scope";

const router: IRouter = Router();

// KPI engine is Admin-only per the RBAC matrix — Advocate is explicitly blocked from it,
// and Clerk/Intern and Client are never granted it. The figures cover this workspace
// only; an admin of one chamber never sees another chamber's throughput.
router.get(
  "/kpi/dashboard",
  requireWorkspace,
  requireCapability("kpi.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    const caseIds = await workspaceCaseIds(c);
    const allCases = caseIds.length
      ? await db.select().from(casesTable).where(inArray(casesTable.id, caseIds))
      : [];
    const allTasks = caseIds.length
      ? await db.select().from(tasksTable).where(inArray(tasksTable.caseId, caseIds))
      : [];

    const today = new Date().toISOString().split("T")[0];
    const totalCases = allCases.length;
    const openCases = allCases.filter((c) => c.status !== "closed").length;
    const closedCases = allCases.filter((c) => c.status === "closed").length;
    const totalTasks = allTasks.length;
    const overdueTasks = allTasks.filter(
      (t) => t.status !== "completed" && t.deadline < today,
    ).length;
    const completedTasks = allTasks.filter((t) => t.status === "completed");
    const completedOnTime = completedTasks.filter((t) => {
      if (!t.completedAt) return false;
      const compDate = t.completedAt.toISOString().split("T")[0];
      return compDate <= t.deadline;
    }).length;
    const slaAdherencePercent =
      completedTasks.length > 0
        ? Math.round((completedOnTime / completedTasks.length) * 100 * 10) / 10
        : 100;

    const avgTurnaroundDays =
      completedTasks.length > 0
        ? completedTasks.reduce((sum, t) => {
            const created = new Date(t.createdAt).getTime();
            const completed = t.completedAt ? new Date(t.completedAt).getTime() : created;
            return sum + (completed - created) / (1000 * 60 * 60 * 24);
          }, 0) / completedTasks.length
        : 0;

    const tasksByStatus = [
      { status: "pending", count: allTasks.filter((t) => t.status === "pending").length },
      { status: "in_progress", count: allTasks.filter((t) => t.status === "in_progress").length },
      { status: "completed", count: allTasks.filter((t) => t.status === "completed").length },
      { status: "overdue", count: overdueTasks },
    ];

    const casesByPriority = ["low", "medium", "high", "urgent"].map((p) => ({
      priority: p,
      count: allCases.filter((c) => c.priority === p).length,
    }));

    res.json(
      GetKpiDashboardResponse.parse({
        totalCases,
        openCases,
        closedCases,
        totalTasks,
        overdueTasks,
        completedOnTime,
        slaAdherencePercent,
        avgTurnaroundDays: Math.round(avgTurnaroundDays * 10) / 10,
        tasksByStatus,
        casesByPriority,
      }),
    );
  },
);

router.get(
  "/kpi/sla-report",
  requireWorkspace,
  requireCapability("kpi.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const params = GetSlaReportQueryParams.safeParse(req.query);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const caseIds = await workspaceCaseIds(c);
    const allTasks = caseIds.length
      ? (await db.select().from(tasksTable).where(inArray(tasksTable.caseId, caseIds))).filter(
          (t) => t.status !== "pending",
        )
      : [];
    const today = new Date();

    // Build last 4 periods
    const periods: { label: string; start: Date; end: Date }[] = [];
    for (let i = 3; i >= 0; i--) {
      const end = new Date(today);
      const start = new Date(today);
      if (params.data.period === "week") {
        start.setDate(today.getDate() - (i + 1) * 7);
        end.setDate(today.getDate() - i * 7);
        periods.push({ label: `W-${i}`, start, end });
      } else if (params.data.period === "quarter") {
        start.setMonth(today.getMonth() - (i + 1) * 3);
        end.setMonth(today.getMonth() - i * 3);
        periods.push({ label: `Q-${i}`, start, end });
      } else {
        start.setMonth(today.getMonth() - (i + 1));
        end.setMonth(today.getMonth() - i);
        const label = start.toLocaleString("default", { month: "short", year: "2-digit" });
        periods.push({ label, start, end });
      }
    }

    const report = periods.map((p) => {
      const inPeriod = allTasks.filter((t) => {
        const created = new Date(t.createdAt);
        return created >= p.start && created < p.end;
      });
      const completed = inPeriod.filter((t) => t.status === "completed");
      const onTime = completed.filter((t) => {
        if (!t.completedAt) return false;
        return t.completedAt.toISOString().split("T")[0] <= t.deadline;
      });
      const late = completed.length - onTime.length;
      const slaPercent =
        completed.length > 0 ? Math.round((onTime.length / completed.length) * 100 * 10) / 10 : 100;
      return {
        period: p.label,
        totalTasks: inPeriod.length,
        onTime: onTime.length,
        late,
        slaPercent,
      };
    });

    res.json(GetSlaReportResponse.parse(report));
  },
);

// General ops dashboard (not the KPI engine). Scoped to what the caller can
// actually see: a clerk's counters cover their assigned matters, not the firm's.
router.get(
  "/dashboard/summary",
  requireWorkspace,
  requireCapability("cases.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    const today = new Date().toISOString().split("T")[0];

    const caseIds = await visibleCaseIds(c);
    const allCases = caseIds.length
      ? await db.select().from(casesTable).where(inArray(casesTable.id, caseIds))
      : [];
    const allTasks = await visibleTasks(c);
    const allConsultations = caseIds.length
      ? await db
          .select()
          .from(consultationsTable)
          .where(inArray(consultationsTable.caseId, caseIds))
      : [];
    const recentEvents = caseIds.length
      ? await db
          .select()
          .from(timelineEventsTable)
          .where(inArray(timelineEventsTable.caseId, caseIds))
          .orderBy(sql`${timelineEventsTable.createdAt} DESC`)
          .limit(10)
      : [];

    const activeCases = allCases.filter((c) => c.status !== "closed").length;
    const pendingTasks = allTasks.filter(
      (t) => t.status === "pending" || t.status === "in_progress",
    ).length;
    const upcomingConsultations = allConsultations.filter((c) => {
      if (c.status !== "scheduled") return false;
      if (!c.scheduledAt) return false;
      return c.scheduledAt.toISOString().split("T")[0] >= today;
    }).length;

    res.json(
      GetDashboardSummaryResponse.parse({
        activeCases,
        pendingTasks,
        upcomingConsultations,
        recentActivity: recentEvents,
      }),
    );
  },
);

/**
 * Chamber performance on time and effort. Admin only.
 *
 * `kpi.read` is held by admin alone — senior_advocate is explicitly excluded by
 * the capability matrix — so this endpoint carries per-individual effort in its
 * payload without a second gate. That was a deliberate decision: chamber-wide
 * aggregates and one member's hours are different things, and the product owner
 * chose to keep BOTH behind admin rather than expose either to the wider firm.
 * If `kpi.read` is ever widened, `byMember` must be split out before it is.
 */
router.get(
  "/kpi/performance",
  requireWorkspace,
  requireCapability("kpi.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const params = GetChamberPerformanceQueryParams.safeParse(req.query);
    if (!params.success) {
      res.status(400).json({ error: "invalid_request", message: zodMessage(params.error) });
      return;
    }
    if (params.data.from > params.data.to) {
      res.status(400).json({
        error: "invalid_request",
        message: "The start of the range must not be after its end.",
      });
      return;
    }

    res.json(await chamberPerformance(c.workspaceId, params.data.from, params.data.to));
  },
);

export default router;
