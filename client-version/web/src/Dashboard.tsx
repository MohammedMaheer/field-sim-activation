import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from "recharts";
import {
  ArrowUpRight,
  ScanLine,
  Users,
  Package,
  ClipboardCheck,
  Coins,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { api, Row } from "./api";
import {
  Badge,
  Panel,
  Loading,
  ErrorState,
  Avatar,
  Progress,
  Empty,
} from "./components";

export const palette = [
  "#7c3aed",
  "#0c9a8a",
  "#3785e6",
  "#e69a22",
  "#d44e7c",
  "#69758e",
  "#e25959",
];
const label = (s: string) =>
  ({
    SUBMITTED: "Awaiting review",
    EXTRACTED: "Ready to review",
    VALIDATED: "Ready to submit",
    OCR_FAILED: "Extraction failed",
    QUEUED: "Extracting",
    VERIFIED: "Verified",
    REJECTED: "Needs correction",
    OPEN: "Open",
    IN_PROGRESS: "In progress",
    DONE: "Completed",
  })[s] || s;
export function BranchFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (s: string) => void;
}) {
  const { data = [], error } = useQuery<Row[]>({
    queryKey: ["branches"],
    queryFn: () => api("/resources/branches"),
  });
  return (
    <label className="branch-filter">
      <Users size={17} />
      <span className="sr-only">Branch</span>
      <select
        aria-label="Branch"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">All authorized branches</option>
        {data.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      {error && <span role="alert">Branches unavailable</span>}
    </label>
  );
}

function Donut({
  rows,
  total,
  caption,
}: {
  rows: Row[];
  total?: number;
  caption: string;
}) {
  const stateColors: Record<string, string> = {
    VERIFIED: "#0c9a8a",
    SUBMITTED: "#e69a22",
    REJECTED: "#d95064",
    OCR_FAILED: "#d95064",
    QUEUED: "#3785e6",
    EXTRACTED: "#8550d5",
    VALIDATED: "#5179bb",
  };
  const data: Row[] = rows
    .filter((r) => r.value > 0)
    .map((r) => ({
      ...r,
      color: stateColors[r.name] || palette[rows.indexOf(r) % palette.length],
      name: label(r.name),
    }));
  return !data.length ? (
    <Empty
      text="No records yet"
      detail="This chart fills as activity is recorded."
    />
  ) : (
    <div className="donut-block">
      <div
        className="donut-visual"
        role="img"
        aria-label={`${caption}: ${data.map((r) => `${r.name} ${r.value}`).join(", ")}`}
      >
        <ResponsiveContainer width="100%" height={205}>
          <PieChart>
            <Pie
              isAnimationActive={false}
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={64}
              outerRadius={86}
              paddingAngle={4}
              stroke="none"
            >
              {data.map((r, i) => (
                <Cell key={r.name} fill={r.color} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-center">
          <b>{total ?? data.reduce((a, r) => a + r.value, 0)}</b>
          <span>{caption}</span>
        </div>
      </div>
      <div className="chart-legend">
        {data.map((r, i) => (
          <div key={r.name}>
            <i style={{ background: r.color }} />
            <span>{r.name}</span>
            <b>{r.value}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [branch, setBranch] = useState("");
  const navigate = useNavigate();
  const {
    data: d,
    isPending,
    error,
    refetch,
  } = useQuery<Row>({
    queryKey: ["dashboard", branch],
    queryFn: () => api("/dashboard?branch_id=" + encodeURIComponent(branch)),
    refetchInterval: 15000,
  });
  if (isPending) return <Loading />;
  if (error || !d) return <ErrorState error={error} retry={refetch} />;
  const metrics = [
    {
      label: "KYC captured today",
      value: d.kyc_today,
      sub: `${d.kyc_verified} verified records`,
      icon: ScanLine,
      tone: "violet",
      path: "kyc-capture",
    },
    {
      label: "Pending backend review",
      value: d.kyc_pending_review,
      sub: "Captures awaiting a decision",
      icon: ClipboardCheck,
      tone: "amber",
      path: "kyc-capture",
    },
    {
      label: "Active field agents",
      value: d.active,
      sub: `Across ${d.branches.length} branches`,
      icon: Users,
      tone: "blue",
      path: "agents",
    },
    {
      label: "Available SIM stock",
      value: d.stock,
      sub: `${d.physical} physical · ${d.esim} eSIM`,
      icon: Package,
      tone: "teal",
      path: "inventory",
    },
  ];
  return (
    <div className="premium-dashboard">
      <div className="page-header">
        <div>
          <div className="eyebrow">YOUR BUSINESS, CONNECTED</div>
          <h1>
            Operations overview<span className="heading-dot">.</span>
          </h1>
          <p>A clear view of your people, progress and next priorities.</p>
        </div>
        <BranchFilter value={branch} onChange={setBranch} />
      </div>
      <section className="pulse-banner" aria-label="Live field summary">
        <div>
          <div className="pulse-label">
            <i />
            LIVE WORKSPACE
          </div>
          <h2>Today’s field performance</h2>
          <p>
            {d.agents.length} agents · {d.teams.length} branch teams · one
            connected workflow.
          </p>
          <button className="primary" onClick={() => navigate("/kyc-capture")}>
            <ScanLine size={17} />
            Capture transaction
            <ArrowUpRight size={16} />
          </button>
        </div>
        <div className="pulse-progress">
          <div
            className="progress-ring"
            style={
              {
                "--progress": `${Math.min(d.achievement, 100)}%`,
              } as React.CSSProperties
            }
          >
            <b>{d.achievement}%</b>
            <span>of daily target</span>
          </div>
          <div>
            <b>
              {d.today} / {d.target}
            </b>
            <span>sales recorded today</span>
            <small>
              Updated{" "}
              {new Date(d.last_sync).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </small>
          </div>
        </div>
      </section>
      <div className="premium-kpis">
        {metrics.map((m) => (
          <button
            key={m.label}
            className={`premium-kpi tone-${m.tone}`}
            onClick={() => navigate("/" + m.path)}
            aria-label={"View " + m.label.toLowerCase()}
          >
            <div>
              <span>{m.label}</span>
              <m.icon size={21} />
            </div>
            <strong>{m.value}</strong>
            <p>
              {m.sub}
              <ArrowUpRight size={16} />
            </p>
          </button>
        ))}
      </div>
      <div className="analytics-main">
        <Panel
          title="Capture & sales activity"
          subtitle="Last 7 days · recorded activity, by UAE business date"
          className="chart-panel"
        >
          <div className="inline-legend">
            <span>
              <i style={{ background: palette[0] }} />
              KYC captures
            </span>
            <span>
              <i style={{ background: palette[1] }} />
              Completed sales
            </span>
            <b>{d.week} sales this week</b>
          </div>
          <div
            role="img"
            aria-label={`Seven-day activity: ${d.trend.map((r: Row) => `${r.date}: ${r.captures} captures, ${r.activations} sales`).join("; ")}`}
          >
            <ResponsiveContainer width="100%" height={275}>
              <AreaChart
                data={d.trend}
                margin={{ top: 15, right: 20, left: -18, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="captureFill" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor={palette[0]}
                      stopOpacity={0.2}
                    />
                    <stop
                      offset="100%"
                      stopColor={palette[0]}
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="4 5"
                  vertical={false}
                  stroke="#e7eaf3"
                />
                <XAxis
                  dataKey="day"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#69758e", fontSize: 12 }}
                />
                <YAxis
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#69758e", fontSize: 12 }}
                />
                <Tooltip />
                <Area
                  isAnimationActive={false}
                  type="monotone"
                  name="KYC captures"
                  dataKey="captures"
                  stroke={palette[0]}
                  strokeWidth={3}
                  fill="url(#captureFill)"
                />
                <Area
                  isAnimationActive={false}
                  type="monotone"
                  name="Completed sales"
                  dataKey="activations"
                  stroke={palette[1]}
                  strokeWidth={3}
                  fill="transparent"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel
          title="Verification pipeline"
          subtitle="All captured transactions in this scope"
          className="chart-panel"
        >
          <Donut
            rows={d.capture_statuses}
            caption="captures"
            total={d.capture_total}
          />
        </Panel>
      </div>
      <div className="analytics-three">
        <Panel
          title="Branch performance"
          subtitle="Completed sales · all recorded history"
          className="chart-panel"
        >
          <div
            role="img"
            aria-label={d.branches
              .map((b: Row) => `${b.name}: ${b.activations} sales`)
              .join("; ")}
          >
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={[...d.branches]
                  .sort((a: Row, b: Row) => b.activations - a.activations)
                  .slice(0, 5)}
                layout="vertical"
                margin={{ top: 12, right: 20, bottom: 12, left: 5 }}
              >
                <CartesianGrid strokeDasharray="4 5" vertical={false} />
                <XAxis
                  type="number"
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={105}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12 }}
                  tickFormatter={(name: string) =>
                    name.length > 15 ? name.slice(0, 14) + "…" : name
                  }
                />

                <Tooltip />
                <Bar
                  isAnimationActive={false}
                  dataKey="activations"
                  name="Completed sales"
                  radius={[0, 7, 7, 0]}
                  maxBarSize={52}
                >
                  {d.branches.map((b: Row, i: number) => (
                    <Cell key={b.id} fill={palette[i % palette.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <button
            className="chart-link"
            onClick={() => navigate("/team-leaders")}
          >
            Explore branch teams
            <ArrowRight size={15} />
          </button>
        </Panel>
        <Panel
          title="Sales by plan"
          subtitle="Completed sales · all recorded history"
          className="chart-panel"
        >
          <Donut rows={d.plan_mix} caption="sales" />
        </Panel>
        <Panel
          title="Today's priorities"
          subtitle="Keep the work moving"
          className="priority-panel"
        >
          <button
            onClick={() => navigate("/field-tasks")}
            aria-label="View open field tasks"
          >
            <span className="priority-icon blue">
              <ClipboardCheck />
            </span>
            <span>
              <b>{d.tasks_open} open field tasks</b>
              <small>Assigned work across your team</small>
            </span>
            <ArrowUpRight size={17} />
          </button>
          <button
            onClick={() => navigate("/incentives")}
            aria-label="View recorded incentives"
          >
            <span className="priority-icon violet">
              <Coins />
            </span>
            <span>
              <b>
                AED{" "}
                {Number(d.incentive_total).toLocaleString("en-AE", {
                  minimumFractionDigits: 2,
                })}
              </b>
              <small>Recorded incentives · this month</small>
            </span>
            <ArrowUpRight size={17} />
          </button>
          <button onClick={() => navigate("/compliance")}>
            <span className="priority-icon amber">
              <Sparkles />
            </span>
            <span>
              <b>
                {d.alerts.filter((a: Row) => a.status !== "RESOLVED").length}{" "}
                reviews to investigate
              </b>
              <small>Compliance and data quality</small>
            </span>
            <ArrowUpRight size={17} />
          </button>
          <div className="stock-strip">
            <span>
              Physical SIM<b>{d.physical}</b>
            </span>
            <span>
              eSIM<b>{d.esim}</b>
            </span>
            <button
              aria-label="Open inventory"
              onClick={() => navigate("/inventory")}
            >
              <ArrowRight size={18} />
            </button>
          </div>
        </Panel>
      </div>
      <div className="dashboard-bottom-grid">
        <Panel
          title="Team snapshot"
          subtitle="Leading teams by today’s sales"
          action={
            <button
              className="text-button"
              onClick={() => navigate("/team-leaders")}
            >
              View all teams
              <ArrowUpRight size={16} />
            </button>
          }
        >
          <div className="branch-team-grid">
            {[...d.teams]
              .sort((a: Row, b: Row) => b.activations - a.activations)
              .slice(0, 2)
              .map((t: Row, i: number) => (
                <button
                  className="branch-team-card"
                  key={t.id}
                  onClick={() =>
                    navigate(
                      "/team-leaders?selected=" + encodeURIComponent(t.id),
                    )
                  }
                >
                  <span
                    className="branch-label"
                    style={{ color: palette[i % palette.length] }}
                  >
                    {t.branch}
                  </span>
                  <div>
                    <Avatar name={t.name} />
                    <span>
                      <b>{t.name}</b>
                      <small>
                        {t.agents} agents · {t.active} active
                      </small>
                    </span>
                    <ArrowUpRight size={17} />
                  </div>
                  <Progress
                    value={Math.round(
                      (t.activations / Math.max(1, t.target)) * 100,
                    )}
                  />
                  <p>
                    {t.activations} of {t.target} daily sales target
                    <span>{t.stock} SIMs</span>
                  </p>
                </button>
              ))}
          </div>
        </Panel>
        <Panel
          title="Recent sales records"
          subtitle="A traceable history of completed and pending connections"
          action={
            <button
              className="text-button"
              onClick={() => navigate("/activations")}
            >
              All records
              <ArrowUpRight size={16} />
            </button>
          }
        >
          <div className="dashboard-records">
            {d.recent.slice(0, 3).map((r: Row) => (
              <button
                key={r.id}
                onClick={() => navigate("/activations?selected=" + r.id)}
              >
                <span className="record-symbol">
                  <ScanLine size={19} />
                </span>
                <span>
                  <b>{r.customer}</b>
                  <small>{r.reference}</small>
                </span>
                <span className="record-plan">
                  {r.plan}
                  <small>{r.agent}</small>
                </span>
                <Badge value={r.status} />
                <ArrowUpRight size={16} />
              </button>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
