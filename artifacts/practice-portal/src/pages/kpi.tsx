import { useGetKpiDashboard } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { AlertTriangle, TrendingUp, CheckCircle, Clock } from "lucide-react";

export default function KpiPage() {
  const { data: kpi, isLoading } = useGetKpiDashboard();

  if (isLoading) {
    return (
      <div className="space-y-4 p-8">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  if (!kpi) return null;

  const COLORS = ["hsl(220 10% 30%)", "hsl(220 10% 50%)", "hsl(220 10% 70%)", "hsl(220 10% 85%)"];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h2 className="text-3xl font-bold tracking-tight mb-1">KPI Engine</h2>
        <p className="text-muted-foreground">
          Firm performance, SLA adherence, and pipeline metrics.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="rounded-none shadow-none border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider font-mono flex items-center gap-2">
              <CheckCircle className="h-4 w-4" /> SLA Adherence
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold tracking-tighter">{kpi.slaAdherencePercent}%</div>
            <p className="text-xs text-muted-foreground mt-1">Target: {">"}95%</p>
          </CardContent>
        </Card>

        <Card className="rounded-none shadow-none border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider font-mono flex items-center gap-2">
              <Clock className="h-4 w-4" /> Avg Turnaround
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold tracking-tighter">
              {kpi.avgTurnaroundDays}{" "}
              <span className="text-lg text-muted-foreground font-normal">days</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">From open to closed</p>
          </CardContent>
        </Card>

        <Card className="rounded-none shadow-none border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider font-mono flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> Total Cases
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold tracking-tighter">{kpi.totalCases}</div>
            <p className="text-xs text-muted-foreground mt-1">{kpi.openCases} currently open</p>
          </CardContent>
        </Card>

        <Card className="rounded-none shadow-none border-destructive/30 bg-destructive/5 text-destructive">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium uppercase tracking-wider font-mono flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> Overdue Tasks
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold tracking-tighter">{kpi.overdueTasks}</div>
            <p className="text-xs opacity-80 mt-1">Action required immediately</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card className="rounded-none shadow-none border-border">
          <CardHeader>
            <CardTitle>Tasks by Status</CardTitle>
            <CardDescription>Distribution of workload across the pipeline</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={kpi.tasksByStatus || []}
                margin={{ top: 20, right: 30, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="var(--border)"
                  opacity={0.5}
                />
                <XAxis
                  dataKey="status"
                  tick={{ fontSize: 12, fontFamily: "monospace" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => v.toUpperCase().replace("_", " ")}
                />
                <YAxis
                  tick={{ fontSize: 12, fontFamily: "monospace" }}
                  axisLine={false}
                  tickLine={false}
                />
                <RechartsTooltip
                  cursor={{ fill: "var(--muted)" }}
                  contentStyle={{
                    borderRadius: 0,
                    border: "1px solid var(--border)",
                    backgroundColor: "var(--background)",
                  }}
                />
                <Bar dataKey="count" fill="hsl(220 10% 30%)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="rounded-none shadow-none border-border">
          <CardHeader>
            <CardTitle>Case Priority Distribution</CardTitle>
            <CardDescription>Current open cases segregated by assigned priority</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px] flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={kpi.casesByPriority || []}
                  cx="50%"
                  cy="50%"
                  innerRadius={80}
                  outerRadius={110}
                  paddingAngle={2}
                  dataKey="count"
                  nameKey="priority"
                  stroke="none"
                >
                  {(kpi.casesByPriority || []).map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <RechartsTooltip
                  contentStyle={{
                    borderRadius: 0,
                    border: "1px solid var(--border)",
                    backgroundColor: "var(--background)",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
