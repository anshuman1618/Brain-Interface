import { Router, type IRouter } from "express";
import { eq, ne, lte, and, sql } from "drizzle-orm";
import { db, casesTable, tasksTable, consultationsTable, timelineEventsTable } from "@workspace/db";
import {
  GetKpiDashboardResponse,
  GetSlaReportQueryParams,
  GetSlaReportResponse,
  GetDashboardSummaryResponse,
} from "@workspace/api-zod";
import { requireRole } from "../middlewares/requireAuth";
import { ADMIN_ROLE, STAFF_ROLES } from "../lib/roles";

const router: IRouter = Router();

// KPI engine is Admin-only per the RBAC matrix — Advocate is explicitly blocked from it,
// and Clerk/Intern and Client are never granted it.
router.get("/kpi/dashboard", requireRole(ADMIN_ROLE), async (_req, res): Promise<void> => {
  const allCases = await db.select().from(casesTable);
  const allTasks = await db.select().from(tasksTable);

  const today = new Date().toISOString().split("T")[0];
  const totalCases = allCases.length;
  const openCases = allCases.filter(c => c.status !== "closed").length;
  const closedCases = allCases.filter(c => c.status === "closed").length;
  const totalTasks = allTasks.length;
  const overdueTasks = allTasks.filter(t => t.status !== "completed" && t.deadline < today).length;
  const completedTasks = allTasks.filter(t => t.status === "completed");
  const completedOnTime = completedTasks.filter(t => {
    if (!t.completedAt) return false;
    const compDate = t.completedAt.toISOString().split("T")[0];
    return compDate <= t.deadline;
  }).length;
  const slaAdherencePercent = completedTasks.length > 0
    ? Math.round((completedOnTime / completedTasks.length) * 100 * 10) / 10
    : 100;

  const avgTurnaroundDays = completedTasks.length > 0
    ? completedTasks.reduce((sum, t) => {
        const created = new Date(t.createdAt).getTime();
        const completed = t.completedAt ? new Date(t.completedAt).getTime() : created;
        return sum + (completed - created) / (1000 * 60 * 60 * 24);
      }, 0) / completedTasks.length
    : 0;

  const tasksByStatus = [
    { status: "pending", count: allTasks.filter(t => t.status === "pending").length },
    { status: "in_progress", count: allTasks.filter(t => t.status === "in_progress").length },
    { status: "completed", count: allTasks.filter(t => t.status === "completed").length },
    { status: "overdue", count: overdueTasks },
  ];

  const casesByPriority = ["low", "medium", "high", "urgent"].map(p => ({
    priority: p,
    count: allCases.filter(c => c.priority === p).length,
  }));

  res.json(GetKpiDashboardResponse.parse({
    totalCases, openCases, closedCases, totalTasks, overdueTasks, completedOnTime,
    slaAdherencePercent, avgTurnaroundDays: Math.round(avgTurnaroundDays * 10) / 10,
    tasksByStatus, casesByPriority,
  }));
});

router.get("/kpi/sla-report", requireRole(ADMIN_ROLE), async (req, res): Promise<void> => {
  const params = GetSlaReportQueryParams.safeParse(req.query);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const allTasks = await db.select().from(tasksTable).where(ne(tasksTable.status, "pending"));
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

  const report = periods.map(p => {
    const inPeriod = allTasks.filter(t => {
      const created = new Date(t.createdAt);
      return created >= p.start && created < p.end;
    });
    const completed = inPeriod.filter(t => t.status === "completed");
    const onTime = completed.filter(t => {
      if (!t.completedAt) return false;
      return t.completedAt.toISOString().split("T")[0] <= t.deadline;
    });
    const late = completed.length - onTime.length;
    const slaPercent = completed.length > 0
      ? Math.round((onTime.length / completed.length) * 100 * 10) / 10
      : 100;
    return { period: p.label, totalTasks: inPeriod.length, onTime: onTime.length, late, slaPercent };
  });

  res.json(GetSlaReportResponse.parse(report));
});

// General ops dashboard (not the KPI engine) — staff-only; clients get their own
// client-portal view instead of firm-wide case/task counts.
router.get("/dashboard/summary", requireRole(...STAFF_ROLES), async (_req, res): Promise<void> => {
  const today = new Date().toISOString().split("T")[0];
  const allCases = await db.select().from(casesTable);
  const allTasks = await db.select().from(tasksTable);
  const allConsultations = await db.select().from(consultationsTable);
  const recentEvents = await db.select().from(timelineEventsTable)
    .orderBy(sql`${timelineEventsTable.createdAt} DESC`)
    .limit(10);

  const activeCases = allCases.filter(c => c.status !== "closed").length;
  const pendingTasks = allTasks.filter(t => t.status === "pending" || t.status === "in_progress").length;
  const upcomingConsultations = allConsultations.filter(c => {
    if (c.status !== "scheduled") return false;
    if (!c.scheduledAt) return false;
    return c.scheduledAt.toISOString().split("T")[0] >= today;
  }).length;

  res.json(GetDashboardSummaryResponse.parse({
    activeCases,
    pendingTasks,
    upcomingConsultations,
    recentActivity: recentEvents,
  }));
});

export default router;
