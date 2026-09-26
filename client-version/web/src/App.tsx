import OrganizationSetup from "./OrganizationSetup";
import AgentManagement from "./AgentManagement";
import KycCapture from "./KycCapture";
import TransactionJourney from "./TransactionJourney";
import { FieldTasks, Incentives, Support } from "./ProposalOperations";

import Dashboard, { BranchFilter } from "./Dashboard";
import {
  useState,
  useEffect,
  useCallback,
  createContext,
  useContext,
} from "react";
import {
  NavLink,
  Routes,
  Route,
  useNavigate,
  useLocation,
  Link,
} from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  LayoutDashboard,
  Radio,
  Users,
  UserRoundCheck,
  Store,
  MapPinned,
  Zap,
  ContactRound,
  ScanFace,
  ShoppingBag,
  Layers3,
  ChartNoAxesCombined,
  ShieldCheck,
  History,
  Settings,
  Search,
  Bell,
  ChevronDown,
  Plus,
  ArrowUpRight,
  ArrowRight,
  Download,
  CalendarDays,
  Check,
  Signal,
  PanelLeftClose,
  LogOut,
  Target,
  Clock,
  CheckCheck,
  Package,
  MapPin,
  Wifi,
  RefreshCw,
  ShieldAlert,
  MoreHorizontal,
  Menu,
  Activity,
  ClipboardCheck,
  Coins,
  LifeBuoy,
  ExternalLink,
} from "lucide-react";
import {
  api,
  post,
  patch,
  download,
  refreshSession,
  setAccess,
  stream,
  Row,
} from "./api";
import {
  Badge,
  Avatar,
  Progress,
  Panel,
  Metric,
  DataTable,
  Drawer,
  Loading,
  ErrorState,
  DetailList,
  Empty,
  Column,
} from "./components";

export const Context = createContext<{
  user: Row;
  notify: (s: string) => void;
}>({ user: {}, notify: () => {} });
export function useResource(name: string, branch = "") {
  return useQuery<Row[]>({
    queryKey: [name, branch],
    queryFn: () =>
      api("/resources/" + name + "?branch_id=" + encodeURIComponent(branch)),
  });
}
const navigation = [
  {
    label: "WORKSPACE",
    items: [
      ["", "Overview", LayoutDashboard],
      ["live", "Live operations", Radio],
      ["field-tasks", "Field tasks", ClipboardCheck],
    ],
  },
  {
    label: "FIELD NETWORK",
    items: [
      ["agents", "Agents", Users],
      ["team-leaders", "Branch teams", UserRoundCheck],
      ["customers", "Customers", ContactRound],
    ],
  },
  {
    label: "FIELD ACTIVITY",
    items: [
      ["activations", "Activations", Zap],

      ["kyc-capture", "KYC transactions", ScanFace],

      ["inventory", "SIM inventory", Layers3],
      ["incentives", "Incentives", Coins],
      ["support", "Support", LifeBuoy],
    ],
  },
  {
    label: "GOVERNANCE",
    items: [
      ["reports", "Reports", ChartNoAxesCombined],
      ["compliance", "Compliance", ShieldCheck],
      ["audit", "Audit log", History],
    ],
  },
];

function Login({ onLogin }: { onLogin: (u: Row) => void }) {
  const [email, setEmail] = useState("admin@relay.demo");
  const [password, setPassword] = useState(
    import.meta.env.DEV ? "RelayDemo!2026" : "",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="login-page">
      <section className="login-brand">
        <div className="logo light">
          <span className="logo-mark">
            <Radio />
          </span>
          relay<span className="logo-dot">.</span>
        </div>
        <div>
          <span className="eyebrow">
            CONNECTED TEAMS. CONFIDENT OPERATIONS.
          </span>
          <h1>
            Every connection
            <br />
            starts in the field.
          </h1>
          <p>
            One workspace for your people, activations,
            <br />
            and everything in between.
          </p>
          <div className="login-line" />
          <span className="login-caption">FIELD OPERATIONS PLATFORM</span>
        </div>
        <small>Designed for the teams that keep the world connected.</small>
      </section>
      <section className="login-form">
        <div className="login-form-inner">
          <span className="badge neutral">DEMONSTRATION WORKSPACE</span>
          <h2>Welcome to Relay</h2>
          <p className="muted">Sign in to your operations workspace.</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const d = await post("/auth/login", {
                  email,
                  password,
                  device: "Web portal",
                });
                setAccess(d.access_token);
                onLogin(d.user);
              } catch (err: any) {
                setError(err.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Work email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="primary full" disabled={busy}>
              {busy ? "Signing in…" : "Sign in to workspace"}
              <ArrowRight size={17} />
            </button>
          </form>
          <div className="demo-note">
            <ShieldCheck size={20} />
            <div>
              <b>A safe space to explore</b>
              <p>
                Synthetic UAE field data. Transaction screenshots are processed
                securely on the server.
              </p>
            </div>
          </div>
          <p className="tiny muted">
            Other roles: ops, leader, compliance, inventory or agent1
            @relay.demo. Same demo password.
          </p>
        </div>
      </section>
    </main>
  );
}

export default function App() {
  const [user, setUser] = useState<Row | null>(null);
  const [ready, setReady] = useState(false);
  const [live, setLive] = useState(false);
  const [toast, setToast] = useState("");
  const [mobileMenu, setMobileMenu] = useState(false);
  const client = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    refreshSession()
      .then((d) => setUser(d.user))
      .catch(() => {})
      .finally(() => setReady(true));
    const expire = () => {
      setUser(null);
      client.clear();
    };
    window.addEventListener("session-expired", expire);
    return () => window.removeEventListener("session-expired", expire);
  }, [client]);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    let update: ReturnType<typeof setTimeout>;
    stream(
      controller.signal,
      (kind) => {
        if (
          kind &&
          [
            "Signed In",
            "Signed Out",
            "Report Exported",
            "Session Revoked",
          ].includes(kind)
        ) {
          client.invalidateQueries({ queryKey: ["audit"] });
          client.invalidateQueries({ queryKey: ["sessions"] });
          return;
        }
        clearTimeout(update);
        update = setTimeout(async () => {
          // An event can arrive during a first fetch whose snapshot predates the change.
          // Cancel that snapshot before refetching, including queries with no cached data.
          await client.cancelQueries();
          if (!controller.signal.aborted) await client.invalidateQueries();
        }, 100);
      },
      setLive,
    );
    return () => {
      clearTimeout(update);
      controller.abort();
    };
  }, [user, client]);
  useEffect(() => {
    if (toast) {
      const id = setTimeout(() => setToast(""), 5500);
      return () => clearTimeout(id);
    }
  }, [toast]);
  useEffect(() => {
    setMobileMenu(false);
  }, [location.pathname]);
  if (!ready) return <Loading />;
  if (!user)
    return (
      <Login
        onLogin={(u) => {
          client.clear();
          setUser(u);
        }}
      />
    );
  const current =
    navigation
      .flatMap((g) => g.items)
      .find((i) => "/" + i[0] === location.pathname)?.[1] || "eKYC concept";
  return (
    <Context.Provider value={{ user, notify: setToast }}>
      <div className="app-shell">
        <aside className={"sidebar " + (mobileMenu ? "open" : "")}>
          <Link className="logo" to="/">
            <span className="logo-mark">
              <Radio />
            </span>
            relay<span className="logo-dot">.</span>
            <span className="logo-edition">CLIENT EDITION</span>
          </Link>
          <button className="workspace-switch" onClick={() => navigate("/")}>
            <span className="workspace-icon">R</span>
            <span>
              <b>Relay Client</b>
              <small>UAE field operations</small>
            </span>
            <ChevronDown size={14} />
          </button>
          <nav aria-label="Main navigation">
            {navigation.map((g) => (
              <div className="nav-group" key={g.label}>
                <div className="nav-label">{g.label}</div>
                {g.items
                  .filter(
                    ([path]) =>
                      path !== "audit" ||
                      user.permissions.includes("audit.read"),
                  )
                  .map(([path, label, Icon]: any) => (
                    <NavLink key={path} end to={"/" + path}>
                      <Icon size={17} />
                      <span>{label}</span>
                      {path === "live" && <i className="live-dot" />}
                      {path === "compliance" && (
                        <span className="nav-tag">!</span>
                      )}
                    </NavLink>
                  ))}
              </div>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <span className="secure-icon">
              <ShieldCheck size={16} />
            </span>
            <div>
              <b>Secure workspace</b>
              <small>Demo environment · v1.0</small>
            </div>
          </div>
          <button
            className="profile-button"
            title="Sign out"
            onClick={async () => {
              await post("/auth/logout");
              setAccess("");
              setUser(null);
              client.clear();
            }}
          >
            <Avatar name={user.name} />
            <span>
              <b>{user.name}</b>
              <small>{user.role}</small>
            </span>
            <LogOut size={17} />
          </button>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <div className="breadcrumb">
              <button
                className="icon-btn menu-btn"
                aria-label="Toggle navigation"
                onClick={() => setMobileMenu(!mobileMenu)}
              >
                <Menu size={20} />
              </button>
              <span>Workspace</span>
              <span>/</span>
              <b>{String(current)}</b>
            </div>
            <div className="top-actions">
              <span
                className={"live-indicator " + (!live ? "disconnected" : "")}
              >
                <i />
                {live ? "Live updates" : "Reconnecting"}
              </span>
              <span className="top-divider" />
              <button
                className="icon-btn"
                title="Search activation records"
                aria-label="Search activation records"
                onClick={() => navigate("/activations")}
              >
                <Search size={18} />
              </button>
              <button
                className="icon-btn notification-btn"
                title="Compliance alerts"
                aria-label="Compliance alerts"
                onClick={() => navigate("/compliance")}
              >
                <Bell size={18} />
                <i />
              </button>
              <Avatar name={user.name} size="small" />
            </div>
          </header>
          <main className="content">
            <Routes>
              <Route path="/kyc-capture" element={<TransactionJourney />} />
              <Route path="/screenshot-capture" element={<KycCapture />} />
              <Route
                path="/field-tasks"
                element={<FieldTasks user={user} notify={setToast} />}
              />
              <Route
                path="/incentives"
                element={<Incentives user={user} notify={setToast} />}
              />
              <Route
                path="/support"
                element={<Support user={user} notify={setToast} />}
              />
              <Route path="/" element={<Dashboard />} />
              <Route path="/live" element={<LiveOperations />} />
              <Route path="/reports" element={<Reports />} />
              {[
                "agents",
                "customers",
                "team-leaders",

                "activations",

                "inventory",
                "compliance",
                "audit",
              ].map((resource) => (
                <Route
                  key={resource}
                  path={"/" + resource}
                  element={<ResourcePage key={resource} resource={resource} />}
                />
              ))}
              <Route
                path="*"
                element={
                  <PageHeader
                    title="Page not included"
                    description="This client edition contains the agreed field-operations capabilities. Use the navigation to continue."
                  />
                }
              />
            </Routes>
            <footer className="page-footer">
              <span>
                Relay Operations <span>·</span>{" "}
                {live ? "Live updates connected" : "Reconnecting to updates"}
              </span>
              <span>Demo providers · Synthetic data</span>
            </footer>
          </main>
        </div>
      </div>
      {toast && (
        <div role="status" className="toast">
          <CheckCheck size={18} />
          {toast}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            ×
          </button>
        </div>
      )}
    </Context.Provider>
  );
}

function PageHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="page-actions">{children}</div>
    </div>
  );
}
function DateChip() {
  return (
    <span className="date-chip">
      <CalendarDays size={15} />
      {new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Dubai",
      }).format(new Date())}
      <span className="chip-divider" />
      Today
    </span>
  );
}

function LiveOperations() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState("");
  const [branch, setBranch] = useState("");
  const {
    data: agents = [],
    isPending,
    error,
    refetch,
  } = useResource("agents", branch);
  const [selected, setSelected] = useState<Row | null>(null);
  if (isPending) return <Loading />;
  if (error) return <ErrorState error={error} retry={refetch} />;
  return (
    <>
      <PageHeader
        eyebrow="CONNECTED WORKSPACE"
        title="Live operations"
        description="Agent shifts, branch teams and current sales activity."
      >
        <BranchFilter value={branch} onChange={setBranch} />
        <button onClick={() => refetch()}>
          <RefreshCw size={16} />
          Refresh
        </button>
      </PageHeader>
      <div className="premium-kpis">
        {[
          ["Active shifts", agents.filter((a) => a.on_shift).length],
          ["Active agents", agents.filter((a) => a.status === "ACTIVE").length],
          ["Today's sales", agents.reduce((n, a) => n + a.activations, 0)],
          ["Available stock", agents.reduce((n, a) => n + a.stock, 0)],
        ].map(([label, value], i) => (
          <button
            onClick={() =>
              i < 2
                ? setFilter(filter === String(i) ? "" : String(i))
                : navigate(i === 2 ? "/activations" : "/inventory")
            }
            aria-pressed={i < 2 ? filter === String(i) : undefined}
            className={
              "premium-kpi tone-" + ["teal", "blue", "violet", "amber"][i]
            }
            key={label}
          >
            <div>{label}</div>
            <strong>{value}</strong>
            <small>{i < 2 ? "Filter field activity" : "Open records"}</small>
          </button>
        ))}
      </div>
      <Panel
        title="Field activity"
        subtitle="Latest synchronized status from your assigned teams"
      >
        <DataTable
          rows={agents.filter((a) =>
            filter === "0"
              ? a.on_shift
              : filter === "1"
                ? a.status === "ACTIVE"
                : true,
          )}
          columns={[
            {
              key: "status",
              label: "Status",
              render: (r) => <Badge value={r.status} />,
            },
            agentColumns[0],
            {
              key: "outlet",
              label: "Outlet / branch",
              render: (r) => (
                <>
                  {r.outlet}
                  <small className="cell-sub">{r.branch}</small>
                </>
              ),
            },
            agentColumns[3],
            agentColumns[4],
            agentColumns[7],
            {
              key: "last_sync",
              label: "Last sync",
              render: (r) =>
                new Date(r.last_sync).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
            },
          ]}
          onRow={setSelected}
        />
      </Panel>
      {selected && (
        <AgentDrawer agent={selected} onClose={() => setSelected(null)} />
      )}
    </>
  );
}

function AgentDrawer({
  agent: a,
  onClose,
}: {
  agent: Row;
  onClose: () => void;
}) {
  const [tab, setTab] = useState("Overview");
  const { user, notify } = useContext(Context);
  const resource =
    tab === "Activations"
      ? "activations"
      : tab === "Inventory"
        ? "inventory"
        : tab === "Compliance"
          ? "compliance"
          : tab === "Audit history"
            ? "audit"
            : "activations";
  const { data = [] } = useResource(resource);
  return (
    <Drawer title="Agent workspace" onClose={onClose}>
      <div className="agent-profile">
        <Avatar name={a.name} size="large" />
        <div>
          <h2>{a.name}</h2>
          <p>
            {a.employee_id} · {a.outlet}
          </p>
          <Badge value={a.status} />
        </div>
      </div>
      <div className="mini-metrics">
        <div>
          <b>{a.activations}</b>
          <span>Activations</span>
        </div>
        <div>
          <b>{a.achievement}%</b>
          <span>Achievement</span>
        </div>
        <div>
          <b>{a.aht}m</b>
          <span>Avg. handling</span>
        </div>
        <div>
          <b>{a.stock}</b>
          <span>SIM stock</span>
        </div>
      </div>
      <div className="tabs">
        {[
          "Overview",
          "Activations",

          "Inventory",
          "Compliance",
          ...(user.permissions.includes("audit.read") ? ["Audit history"] : []),
          ...(user.role === "Administrator" ? ["Manage"] : []),
        ].map((t) => (
          <button
            className={tab === t ? "active" : ""}
            key={t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Manage" ? (
        <AgentManagement
          agentId={a.id}
          onSaved={() => {
            notify("Agent updated and audited");
            onClose();
          }}
        />
      ) : tab === "Overview" ? (
        <>
          <DetailList
            data={{
              team_leader: a.leader,
              assigned_outlet: a.outlet,
              shift: a.on_shift ? "Active shift" : "Off shift",
              ekyc_pass_rate: a.ekyc_rate + "%",
              ocr_accuracy: a.ocr + "%",
              branch: a.branch,
              last_sync: new Date(a.last_sync).toLocaleString(),
            }}
          />
          {user.permissions.includes("device.ping") && (
            <button
              className="secondary full"
              onClick={async () => {
                try {
                  const d = await post(`/agents/${a.id}/ping`);
                  notify(d.message);
                } catch (e: any) {
                  notify(e.message);
                }
              }}
            >
              <Signal size={16} />
              Ping device
            </button>
          )}
        </>
      ) : (
        <DataTable
          rows={data.filter((r) => r.agent_id === a.id)}
          columns={
            tab === "Activations"
              ? orderColumns
              : tab === "Inventory"
                ? inventoryColumns
                : [
                    { key: "created_at", label: "Time" },
                    {
                      key: tab === "Compliance" ? "title" : "action",
                      label: "Event",
                    },
                    { key: "status", label: "Status" },
                  ]
          }
        />
      )}
    </Drawer>
  );
}

const orderColumns: Column[] = [
  {
    key: "reference",
    label: "Order / request",
    render: (r) => (
      <>
        <b className="reference">{r.reference}</b>
        <small className="cell-sub">{r.request_id}</small>
      </>
    ),
  },
  {
    key: "customer",
    label: "Customer",
    render: (r) => (
      <>
        {r.customer}
        <small className="cell-sub">{r.msisdn}</small>
      </>
    ),
  },
  {
    key: "agent",
    label: "Agent",
    render: (r) => (
      <>
        {r.agent}
        <small className="cell-sub">{r.outlet}</small>
      </>
    ),
  },
  { key: "plan", label: "Plan" },
  {
    key: "created_at",
    label: "Created",
    render: (r) =>
      new Date(r.created_at).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
      }),
  },
  { key: "status", label: "Status", render: (r) => <Badge value={r.status} /> },
];
const inventoryColumns: Column[] = [
  {
    key: "iccid",
    label: "ICCID / serial",
    render: (r) => (
      <>
        <b className="reference">{r.iccid}</b>
        <small className="cell-sub">{r.serial}</small>
      </>
    ),
  },
  { key: "sim_type", label: "Type" },
  { key: "agent", label: "Assigned agent" },
  { key: "outlet", label: "Outlet" },
  { key: "status", label: "Status", render: (r) => <Badge value={r.status} /> },
];
const agentColumns: Column[] = [
  {
    key: "name",
    label: "Agent",
    render: (r) => (
      <div className="person-cell">
        <Avatar name={r.name} />
        <span>
          <b>{r.name}</b>
          <small>{r.employee_id}</small>
        </span>
      </div>
    ),
  },
  { key: "outlet", label: "Outlet" },
  {
    key: "branch",
    label: "Branch",
  },
  { key: "activations", label: "Activations" },
  {
    key: "achievement",
    label: "Daily target",
    render: (r) => <Progress value={r.achievement} />,
  },
  { key: "aht", label: "AHT", render: (r) => r.aht + " min" },
  { key: "ekyc_rate", label: "eKYC pass", render: (r) => r.ekyc_rate + "%" },
  {
    key: "stock",
    label: "Stock",
    render: (r) => (
      <span className={r.stock < 5 ? "low-stock" : ""}>{r.stock}</span>
    ),
  },
];
const configs: Record<
  string,
  { title: string; description: string; columns: Column[] }
> = {
  agents: {
    title: "Agent management",
    description: "Your people, their performance, and the support they need.",
    columns: agentColumns,
  },
  "team-leaders": {
    title: "Team performance",
    description: "Branch-led teams, clear ownership and shared targets.",
    columns: [
      { key: "name", label: "Team leader" },
      { key: "branch", label: "Branch" },
      { key: "agents", label: "Team size" },
      { key: "activations", label: "Activations" },
      { key: "target", label: "Target" },
      { key: "active", label: "Active agents" },
      { key: "stock", label: "SIM stock" },
    ],
  },
  orders: {
    title: "Order management",
    description: "Trace every connection from first draft to activation.",
    columns: orderColumns,
  },
  activations: {
    title: "Activations",
    description: "A connected workflow. From identity to a new connection.",
    columns: orderColumns,
  },
  inventory: {
    title: "SIM inventory",
    description: "Every SIM accounted for. Every movement traceable.",
    columns: inventoryColumns,
  },
  outlets: {
    title: "Outlet network",
    description: "A connected view of your retail and field network.",
    columns: [
      { key: "name", label: "Outlet" },
      { key: "area", label: "Area" },
      { key: "branch", label: "Branch" },
      { key: "agents", label: "Assigned agents" },
    ],
  },
  customers: {
    title: "Customer directory",
    description: "Customer relationships, protected by design.",
    columns: [
      { key: "name", label: "Customer" },
      { key: "mobile", label: "Mobile (masked)" },
      { key: "document", label: "Document (masked)" },
      { key: "nationality", label: "Nationality" },
      { key: "agent", label: "Agent" },
    ],
  },
  ekyc: {
    title: "Identity verification",
    description:
      "Make every connection with confidence. Demo verification results.",
    columns: [
      { key: "customer", label: "Customer" },
      { key: "agent", label: "Agent" },
      {
        key: "confidence",
        label: "OCR confidence",
        render: (r) => r.confidence.toFixed(1) + "%",
      },
      {
        key: "status",
        label: "Verification",
        render: (r) => <Badge value={r.status} />,
      },
    ],
  },
  compliance: {
    title: "Compliance centre",
    description: "Signals for investigation. Evidence before conclusions.",
    columns: [
      { key: "title", label: "Observation" },
      { key: "agent", label: "Agent" },
      {
        key: "severity",
        label: "Severity",
        render: (r) => <Badge value={r.severity} />,
      },
      {
        key: "status",
        label: "Review status",
        render: (r) => <Badge value={r.status} />,
      },
    ],
  },
  audit: {
    title: "Audit history",
    description:
      "An append-only record of critical actions across your workspace.",
    columns: [
      {
        key: "created_at",
        label: "Timestamp",
        render: (r) => new Date(r.created_at).toLocaleString(),
      },
      { key: "actor", label: "Responsible user" },
      { key: "role", label: "Role" },
      { key: "action", label: "Action" },
      { key: "source", label: "Source" },
    ],
  },
};

function ResourcePage({ resource }: { resource: string }) {
  const [setup, setSetup] = useState<"branches" | "agents" | null>(null);
  const [branch, setBranch] = useState("");
  const {
    data = [],
    isPending,
    error,
    refetch,
  } = useResource(resource, branch);
  const [selected, setSelected] = useState<Row | null>(null);
  const { user, notify } = useContext(Context);
  const navigate = useNavigate();
  const location = useLocation();
  const config = configs[resource];
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("selected");
    setSelected(id ? data.find((r) => r.id === id) || null : null);
  }, [data, location.search]);
  const closeDetails = () => {
    setSelected(null);
    navigate(location.pathname, { replace: true });
  };
  if (isPending) return <Loading />;
  if (error) return <ErrorState error={error} retry={refetch} />;
  return (
    <>
      {setup && (
        <OrganizationSetup initial={setup} onClose={() => setSetup(null)} />
      )}
      <PageHeader
        eyebrow={
          resource === "compliance"
            ? "TRUST & ASSURANCE"
            : "CONNECTED OPERATIONS"
        }
        title={config.title}
        description={config.description}
      >
        {["agents", "team-leaders", "inventory", "activations"].includes(
          resource,
        ) && (
          <BranchFilter
            value={branch}
            onChange={(v) => {
              setSelected(null);
              setBranch(v);
            }}
          />
        )}
        {user.role === "Administrator" &&
          ["agents", "team-leaders"].includes(resource) && (
            <button
              className="primary"
              onClick={() =>
                setSetup(resource === "agents" ? "agents" : "branches")
              }
            >
              {resource === "agents" ? "Add agent" : "Set up branches & teams"}
            </button>
          )}
        <button onClick={() => refetch()}>
          <RefreshCw size={15} />
          Refresh
        </button>
        {user.permissions.includes("report.read") && (
          <button onClick={() => navigate("/reports")}>
            <Download size={15} />
            Export report
          </button>
        )}
      </PageHeader>
      {resource === "inventory" && (
        <div className="metrics-grid">
          {["AVAILABLE", "RESERVED", "ACTIVATED", "DAMAGED"].map((s) => (
            <Metric
              key={s}
              label={s.charAt(0) + s.slice(1).toLowerCase()}
              value={data.filter((r) => r.status === s).length}
              sub="Tracked inventory"
              icon={<Layers3 size={17} />}
            />
          ))}
        </div>
      )}
      {resource === "compliance" && (
        <div className="compliance-banner">
          <ShieldCheck size={24} />
          <div>
            <b>A fair and traceable review process</b>
            <p>
              Alerts indicate activity to investigate. They are not findings of
              misconduct.
            </p>
          </div>
        </div>
      )}
      <Panel
        title="Records"
        subtitle={`${data.length} records in your authorized scope`}
      >
        <DataTable
          rows={data}
          columns={config.columns}
          onRow={(row) =>
            navigate(
              `${location.pathname}?selected=${encodeURIComponent(row.id)}`,
            )
          }
        />
      </Panel>
      {selected &&
        (resource === "agents" ? (
          <AgentDrawer agent={selected} onClose={closeDetails} />
        ) : ["orders", "activations"].includes(resource) ? (
          <OrderDrawer id={selected.id} onClose={closeDetails} />
        ) : resource === "inventory" ? (
          <InventoryDrawer sim={selected} onClose={closeDetails} />
        ) : resource === "compliance" ? (
          <ComplianceDrawer alert={selected} onClose={closeDetails} />
        ) : resource === "team-leaders" ? (
          <TeamDrawer team={selected} onClose={closeDetails} />
        ) : (
          <Drawer title={config.title + " details"} onClose={closeDetails}>
            <DetailList
              data={
                resource === "customers"
                  ? {
                      customer: selected.name,
                      mobile: selected.mobile,
                      document: selected.document,
                      nationality: selected.nationality,
                      agent: selected.agent,
                    }
                  : selected
              }
            />
            {resource === "audit" && (
              <>
                <h3>Previous value</h3>
                <pre>{JSON.stringify(selected.old_value, null, 2)}</pre>
                <h3>New value</h3>
                <pre>{JSON.stringify(selected.new_value, null, 2)}</pre>
              </>
            )}
            {resource === "ekyc" && (
              <div className="demo-note">
                <ScanFace size={20} />
                <span>
                  Mock verification provider. No biometric verification has been
                  performed.
                </span>
              </div>
            )}
          </Drawer>
        ))}
    </>
  );
}

function TeamDrawer({ team, onClose }: { team: Row; onClose: () => void }) {
  const navigate = useNavigate();
  const { data = [], isPending, error, refetch } = useResource("agents");
  return (
    <Drawer title={team.name + " · Team performance"} onClose={onClose}>
      <DetailList
        data={{
          branch: team.branch,
          agents: team.agents,
          active_agents: team.active,
          daily_target: team.target,
          activations_today: team.activations,
          sim_stock: team.stock,
          average_handling_minutes: team.aht,
          verification_pass_rate: team.ekyc_rate + "%",
        }}
      />
      {isPending ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} retry={refetch} />
      ) : (
        <DataTable
          rows={data.filter(
            (a) =>
              a.leader_id === team.leader_id && a.branch_id === team.branch_id,
          )}
          columns={agentColumns}
          onRow={(a) =>
            navigate("/agents?selected=" + encodeURIComponent(a.id))
          }
        />
      )}
    </Drawer>
  );
}

export function OrderDrawer({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const {
    data: o,
    isPending,
    error,
    refetch,
  } = useQuery<Row>({
    queryKey: ["order", id],
    queryFn: () => api("/activations/" + id),
  });
  const { user, notify } = useContext(Context);
  const client = useQueryClient();
  return (
    <Drawer title="Activation history" onClose={onClose}>
      {isPending ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} retry={refetch} />
      ) : (
        o && (
          <>
            <div className="order-title">
              <ShoppingBag size={28} />
              <div>
                <h2>{o.reference}</h2>
                <Badge value={o.status} />
              </div>
            </div>
            <DetailList
              data={{
                request_id: o.request_id,
                service_request_id: o.sr_id,
                msisdn: o.msisdn,
                customer: o.customer,
                plan: o.plan,
                agent: o.agent,
                outlet: o.outlet,
                created: new Date(o.created_at).toLocaleString(),
              }}
            />
            <h3>Lifecycle timeline</h3>
            <div className="timeline">
              {o.events.map((e: Row) => (
                <div key={e.id}>
                  <span>
                    <Check size={12} />
                  </span>
                  <b>{e.action}</b>
                  <p>
                    {e.actor} · {new Date(e.created_at).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          </>
        )
      )}
    </Drawer>
  );
}

function InventoryDrawer({ sim, onClose }: { sim: Row; onClose: () => void }) {
  const { data: agents = [] } = useResource("agents");
  const { data: movements = [] } = useResource("movements");
  const [status, setStatus] = useState("RETURNED");
  const [agent, setAgent] = useState(sim.agent_id);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const { user, notify } = useContext(Context);
  const client = useQueryClient();
  return (
    <Drawer title="SIM balance & history" onClose={onClose}>
      <DetailList
        data={{
          iccid: sim.iccid,
          serial: sim.serial,
          type: sim.sim_type,
          status: sim.status,
          agent: sim.agent,
          outlet: sim.outlet,
        }}
      />
      {user.permissions.includes("inventory.write") &&
        !["ACTIVATED", "RESERVED", "BLOCKED", "DAMAGED"].includes(
          sim.status,
        ) && (
          <form
            className="proposal-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await post(`/inventory/${sim.id}/move`, {
                  status,
                  agent_id: agent || null,
                  reason,
                });
                await Promise.all([
                  client.invalidateQueries({ queryKey: ["inventory"] }),
                  client.invalidateQueries({ queryKey: ["movements"] }),
                ]);
                notify("SIM movement recorded");
                onClose();
              } catch (e: any) {
                notify(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              New status
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {[
                  "AVAILABLE",
                  "ASSIGNED TO AGENT",
                  "RETURNED",
                  "DAMAGED",
                  "BLOCKED",
                ].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Assign to agent
              <select
                value={agent || ""}
                onChange={(e) => setAgent(e.target.value)}
              >
                <option value="">No change</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.employee_id}
                  </option>
                ))}
              </select>
            </label>
            <label className="wide">
              Reason
              <input
                required
                minLength={5}
                maxLength={300}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this SIM moving?"
              />
            </label>
            <button className="primary" disabled={busy}>
              Record stock movement
            </button>
          </form>
        )}
      <h3>Movement history</h3>
      <div className="timeline">
        {movements
          .filter((m) => m.sim_id === sim.id)
          .map((m) => (
            <div key={m.id}>
              <span>
                <Package size={12} />
              </span>
              <b>
                {m.old_status} → {m.new_status}
              </b>
              <p>
                {m.reason}
                <br />
                {new Date(m.created_at).toLocaleString()}
              </p>
            </div>
          ))}
      </div>
    </Drawer>
  );
}

function ComplianceDrawer({
  alert,
  onClose,
}: {
  alert: Row;
  onClose: () => void;
}) {
  const [status, setStatus] = useState("INVESTIGATING");
  const [note, setNote] = useState("");
  const { user, notify } = useContext(Context);
  const client = useQueryClient();
  return (
    <Drawer title="Compliance investigation" onClose={onClose}>
      <h2>{alert.title}</h2>
      <Badge value={alert.severity} />
      <DetailList
        data={{
          agent: alert.agent,
          status: alert.status,
          previous_note: alert.note,
          created: alert.created_at,
        }}
      />
      {user.permissions.includes("compliance.write") && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await patch("/compliance/" + alert.id, { status, note });
              client.invalidateQueries();
              notify("Review saved to audit history");
              onClose();
            } catch (e: any) {
              notify(e.message);
            }
          }}
        >
          <label>
            Investigation status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option>INVESTIGATING</option>
              <option>RESOLVED</option>
            </select>
          </label>
          <label>
            Investigation note
            <textarea
              required
              minLength={5}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button className="primary full">Save investigation</button>
        </form>
      )}
    </Drawer>
  );
}

function Reports() {
  const [branch, setBranch] = useState("");
  const { notify, user } = useContext(Context);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");
  const reports = [
    ["daily", "Daily activation", "A complete snapshot of daily connections."],
    ["monthly", "Monthly activation", "Activation performance over the month."],
    ["agent", "Agent performance", "Productivity and quality by field agent."],
    ["team", "Team performance", "Performance by leader and team."],

    [
      "ekyc",
      "KYC compliance",
      "Captured transactions and backend verification outcomes.",
    ],
    [
      "branch",
      "Branch performance",
      "Sales and productivity across your branch network.",
    ],
    ["inventory", "SIM inventory", "Available, reserved and activated stock."],

    [
      "failed",
      "Failed activations",
      "Investigate connections that need attention.",
    ],
    ["audit", "Audit report", "Critical actions and responsible users."],
  ];
  return (
    <>
      <PageHeader
        eyebrow="INSIGHTS THAT TRAVEL"
        title="Reports & exports"
        description="Structured data. Clear reporting. Ready for your next decision."
      />
      <div className="report-filters">
        <BranchFilter value={branch} onChange={setBranch} />
        <label>
          From date
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          To date
          <input
            type="date"
            value={end}
            min={start}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <label>
          Search / filter
          <input
            placeholder="Agent, outlet, reference…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      </div>
      <div className="report-grid">
        {reports
          .filter(
            ([id]) => id !== "audit" || user.permissions.includes("audit.read"),
          )
          .map(([id, title, description]) => (
            <section className="panel report-card" key={id}>
              <span className="report-icon">
                <ChartNoAxesCombined size={22} />
              </span>
              <h2>{title}</h2>
              <p>{description}</p>
              <div>
                {(["csv", "pdf"] as const).map((format) => (
                  <button
                    key={format}
                    disabled={
                      !!busy || !user.permissions.includes("report.read")
                    }
                    onClick={async () => {
                      setBusy(id + format);
                      try {
                        await download(
                          `/reports/${id}?${new URLSearchParams({ format, start, end, q, branch_id: branch })}`,
                          `relay-${id}.${format}`,
                        );
                        notify(`${title} report downloaded`);
                      } catch (e: any) {
                        notify(e.message);
                      } finally {
                        setBusy("");
                      }
                    }}
                  >
                    <Download size={14} />
                    {busy === id + format
                      ? "Generating…"
                      : format.toUpperCase()}
                  </button>
                ))}
              </div>
            </section>
          ))}
      </div>
    </>
  );
}
