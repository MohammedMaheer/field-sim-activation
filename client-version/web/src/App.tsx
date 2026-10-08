import Notifications from "./Notifications";
import OrganizationSetup from "./OrganizationSetup";
import TeamLeaders from "./TeamLeaders";
import RecordOverview from "./RecordOverview";
import AgentManagement from "./AgentManagement";
import Administration from "./Administration";
import PlanManagement from "./PlanManagement";
import InventoryImport from "./InventoryImport";
import KycCapture from "./KycCapture";
import SalesManagement from "./SalesManagement";
import CallWorkspace from "./CallWorkspace";
import FieldAssets from "./FieldAssets";
import { Incentives, Support } from "./ProposalOperations";

import Dashboard, { BranchFilter } from "./Dashboard";
import {
  useState,
  useEffect,
  useCallback,
  useRef,
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
  ArrowLeft,
  Home,
  X,
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
      ["notifications", "Notifications", Bell],
      ["live", "Live operations", Radio],
    ],
  },
  {
    label: "FIELD NETWORK",
    items: [
      ["agents", "Agents", Users],
      ["branches", "Branches", UserRoundCheck],
      ["team-leaders", "Team leaders", Users],
      ["customers", "Customers", ContactRound],
    ],
  },
  {
    label: "FIELD ACTIVITY",
    items: [
      ["activations", "Activations", Zap],
      ["sales", "Sales management", ShoppingBag],
      ["call-work", "Call work queue", Bell],

      ["kyc-capture", "Backend verification", ScanFace],

      ["inventory", "SIM inventory", Layers3],
      ["equipment", "Assets & supplies", Package],
      ["incentives", "Incentives", Coins],
      ["support", "Support", LifeBuoy],
    ],
  },
  {
    label: "GOVERNANCE",
    items: [
      ["reports", "Reports", ChartNoAxesCombined],
      ["audit", "Audit log", History],
    ],
  },
  {
    label: "ADMINISTRATION",
    items: [["plans", "Subscriber plans", Settings], ["administration", "Manage workspace", Settings]],
  },
];

export function canVisitPage(path: string, user: Row) {
  path = path.replace(/^\//, "");
  if (path === "screenshot-capture") path = "kyc-capture";
  if (!["Administrator", "Operations Manager", "Compliance Officer", "Inventory Manager", "Field Agent", "Team Leader", "Branch Manager", "Sales Manager", "Tele Verification Officer", "Welcome Call Officer"].includes(user.role)) return false;
  if (path === "notifications") return true;
  const permissions = user.permissions || [];
  if (["Tele Verification Officer", "Welcome Call Officer"].includes(user.role)) return path === "call-work";
  if (user.role === "Sales Manager") return ["", "sales", "equipment", "reports"].includes(path);
  if (path === "call-work") return permissions.includes("compliance.write") || permissions.includes("call.tele.read") || permissions.includes("call.welcome.read");
  if (path === "team-leaders") return ["Administrator", "Team Leader"].includes(user.role);
  if (path === "administration") return ["Administrator", "Operations Manager"].includes(user.role);
  if (path === "plans") return permissions.includes("settings.write");
  if (path === "audit") return permissions.includes("audit.read");
  if (path === "reports") return permissions.includes("report.read");
  if (user.role === "Field Agent") return ["", "customers", "activations", "sales", "equipment", "kyc-capture", "inventory", "incentives", "support"].includes(path);
  if (user.role === "Compliance Officer") return ["", "agents", "branches", "customers", "activations", "sales", "kyc-capture", "audit", "reports"].includes(path);
  if (path === "kyc-capture") return ["Administrator", "Operations Manager", "Team Leader", "Branch Manager"].includes(user.role);
  return ["", "live", "agents", "branches", "customers", "activations", "sales", "equipment", "inventory", "incentives", "support"].includes(path);
}

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
            CONNECTED BRANCHES. CONFIDENT OPERATIONS.
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
          <span className="badge neutral">FIELD OPERATIONS</span>
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
  const inbox = useQuery({queryKey:['notifications',user?.id],queryFn:() => api('/notifications'),enabled:!!user,refetchInterval:20000});
  const callAlerts = useQuery({queryKey:['sales-management','call-summary'],queryFn:() => api('/sales-management/call-tasks/summary'),enabled:!!user && (user.permissions?.includes('compliance.write') || user.permissions?.includes('call.tele.read') || user.permissions?.includes('call.welcome.read')),refetchInterval:15000});
  const stockAlerts = useQuery({queryKey:['field-assets','alerts'],queryFn:async()=>{const [requests,levels]=await Promise.all([api('/field-assets/requests/list'),api('/field-assets/report/summary')]);return requests.filter((r:Row)=>['REQUESTED','APPROVED'].includes(r.status)).length+levels.filter((r:Row)=>r.low_stock).length},enabled:!!user && !!user.permissions?.includes('read') && canVisitPage('equipment',user),refetchInterval:20000});
  const [mobileMenu, setMobileMenu] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
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
    if (["Tele Verification Officer", "Welcome Call Officer"].includes(user.role) && !["/call-work", "/notifications"].includes(location.pathname)) navigate("/call-work", {replace:true});
  }, [user, location.pathname, navigate]);
  useEffect(() => {
    if (!user) return;
    if (["Tele Verification Officer", "Welcome Call Officer"].includes(user.role)) {
      setLive(true); // Their dedicated queries refresh every 15 seconds.
      return;
    }
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
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [location.pathname]);
  useEffect(() => {
    if (!mobileMenu) return;
    const previous = document.activeElement as HTMLElement;
    const nodes = () =>
      Array.from(
        sidebarRef.current?.querySelectorAll<HTMLElement>(
          "a[href],button:not(:disabled)",
        ) || [],
      ).filter((n) => n.getClientRects().length > 0);
    nodes()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileMenu(false);
      if (e.key === "Tab") {
        const items = nodes(),
          first = items[0],
          last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    const resize = () => {
      if (innerWidth > 720) setMobileMenu(false);
    };
    document.addEventListener("keydown", key);
    window.addEventListener("resize", resize);
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", resize);
      document.body.style.overflow = oldOverflow;
      previous?.focus();
    };
  }, [mobileMenu]);
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
    (["/kyc-capture", "/screenshot-capture"].includes(location.pathname) && !user.permissions.includes("compliance.write") ? (user.role === "Field Agent" ? "New transaction" : "Transaction history") : "") ||
    navigation
      .flatMap((g) => g.items)
      .find((i) => "/" + i[0] === location.pathname)?.[1] ||
    (location.pathname === "/screenshot-capture"
      ? "Backend verification"
      : "Workspace");
  return (
    <Context.Provider value={{ user, notify: setToast }}>
      <div className="app-shell">
        <a className="skip-link" href="#workspace-content">
          Skip to content
        </a>
        {mobileMenu && (
          <button
            className="navigation-scrim"
            aria-label="Close navigation"
            onClick={() => setMobileMenu(false)}
            tabIndex={-1}
          />
        )}
        <aside
          ref={sidebarRef}
          id="workspace-navigation"
          className={"sidebar " + (mobileMenu ? "open" : "")}
        >
          <button
            className="mobile-nav-close icon-btn"
            aria-label="Close menu"
            onClick={() => setMobileMenu(false)}
          >
            <X size={20} />
          </button>
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
            {navigation.filter(g => g.items.some(([path]) => canVisitPage(String(path), user))).map((g) => (
              <div className="nav-group" key={g.label}>
                <div className="nav-label">{g.label}</div>
                {g.items
                  .filter(([path]) => canVisitPage(String(path), user))
                  .filter(
                    ([path]) =>
                      path !== "audit" ||
                      user.permissions.includes("audit.read"),
                  )
                  .filter(
                    ([path]) =>
                      (path === "administration" ? ["Administrator", "Operations Manager"].includes(user.role) : path !== "plans" || user.permissions.includes("settings.write")),
                  )
                  .map(([path, label, Icon]: any) => (
                    <NavLink key={path} end to={"/" + path} data-section={path || "overview"}>
                      <span className="nav-icon" aria-hidden="true"><Icon size={17} /></span>
                      <span>{path === "kyc-capture" ? user.role === "Field Agent" ? "New transaction" : user.permissions.includes("compliance.write") ? label : "Transaction history" : label}</span>
                      {path === "equipment" && !!stockAlerts.data && <span className="nav-tag" title="Stock requests and shortage alerts">{stockAlerts.data}</span>}
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
              <small>Field operations</small>
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
        <div className="main-shell" inert={mobileMenu || undefined}>
          <header className="topbar">
            <div className="breadcrumb">
              <button
                className="icon-btn menu-btn"
                aria-label="Toggle navigation"
                aria-controls="workspace-navigation"
                aria-expanded={mobileMenu}
                onClick={() => setMobileMenu(!mobileMenu)}
              >
                <Menu size={20} />
              </button>
              {location.pathname !== "/" && (
                <button
                  className="icon-btn workspace-back"
                  aria-label="Back to previous page"
                  title="Back"
                  onClick={() => {
                    if ((window.history.state?.idx || 0) > 0) navigate(-1);
                    else navigate("/");
                  }}
                >
                  <ArrowLeft size={19} />
                </button>
              )}
              <Link
                className="workspace-home"
                to="/"
                aria-label="Workspace overview"
              >
                <Home size={16} />
                <span>Workspace</span>
              </Link>
              <span aria-hidden="true">/</span>
              <b aria-current="page">{String(current)}</b>
            </div>
            <div className="top-actions">
              <span
                className={"live-indicator " + (!live ? "disconnected" : "")}
                role="status"
                aria-label={
                  live
                    ? "Live updates connected"
                    : "Reconnecting to live updates"
                }
                title={
                  live
                    ? "Live updates connected"
                    : "Reconnecting to live updates"
                }
              >
                <i />
                {live ? "Live updates" : "Reconnecting"}
              </span>
              <span className="top-divider" />
              {canVisitPage('activations',user) && <button
                className="icon-btn"
                title="Search activation records"
                aria-label="Search activation records"
                onClick={() => navigate("/activations")}
              >
                <Search size={18} />
              </button>}
              <button
                className="icon-btn notification-btn"
                title="Notifications"
                aria-label="Notifications"
                onClick={() => navigate('/notifications')}
              >
                <Bell size={18} />
                {!!inbox.data?.unread && <b className="call-alert-count">{inbox.data.unread > 99 ? '99+' : inbox.data.unread}</b>}
              </button>
              <Avatar name={user.name} size="small" />
            </div>
          </header>
          <main className="content" id="workspace-content" tabIndex={-1}>
            <div className="route-stage" key={location.pathname}>
              {canVisitPage(location.pathname, user) ? <Routes>
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/kyc-capture" element={<KycCapture />} />
                <Route path="/sales" element={<SalesManagement />} />
                <Route path="/call-work" element={<CallWorkspace />} />
                <Route path="/equipment" element={<FieldAssets />} />
                <Route path="/screenshot-capture" element={<KycCapture />} />
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
                <Route path="/plans" element={<PlanManagement />} />
                <Route path="/team-leaders" element={<TeamLeaders />} />
                <Route path="/administration" element={<Administration />} />
                {[
                  "agents",
                  "customers",
                  "branches",

                  "activations",

                  "inventory",
                  "audit",
                ].map((resource) => (
                  <Route
                    key={resource}
                    path={"/" + resource}
                    element={
                      <ResourcePage key={resource} resource={resource} />
                    }
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
              </Routes> : <div className="panel access-denied"><h2>This page is not available for your role</h2><Link className="button primary" to="/">Return to overview</Link></div>}
            </div>
            <footer className="page-footer">
              <span>
                Relay Operations <span>·</span>{" "}
                {live ? "Live updates connected" : "Reconnecting to updates"}
              </span>
              <span>Relay · Field operations</span>
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
        description="Agent shifts, branches and current sales activity."
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
            {a.employee_id} · {a.branch}
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
          ...(user.permissions.includes("audit.read") ? ["Audit history"] : []),
          ...(["Administrator", "Operations Manager"].includes(user.role) ? ["Manage"] : []),
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
              branch: a.branch,
              shift: a.on_shift ? "Active shift" : "Off shift",
              ekyc_pass_rate: a.ekyc_rate + "%",
              ocr_accuracy: a.ocr + "%",
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
                      key: "action",
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
  { key: "business_category", label: "Business category" },
  { key: "agent", label: "Assigned agent" },
  { key: "outlet", label: "Outlet" },
  { key: "status", label: "Stock", render: (r) => <Badge value={r.status} /> },
  { key: "activation_stage", label: "Progress", render: r => <Badge value={(r.activation_stage || "NOT_STARTED").replaceAll('_',' ')} /> },
  { key: "payment_status", label: "Payment", render: r => <Badge value={(r.payment_status || "NOT_UPLOADED").replaceAll('_',' ')} /> },
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
  branches: {
    title: "Branches",
    description: "Agents, targets and sales by branch.",
    columns: [
      { key: "name", label: "Branch" },
      { key: "agents", label: "Agents" },
      { key: "closed_today", label: "Sales today" },
      { key: "target", label: "Target" },
      { key: "closed_sales", label: "Completed sales" },
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
      "Customer verification records.",
    columns: [
      { key: "customer", label: "Customer" },
      { key: "agent", label: "Agent" },

      {
        key: "status",
        label: "Verification",
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
  const [importStock, setImportStock] = useState(false);
  const cache = useQueryClient();
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
      {importStock && <InventoryImport onClose={() => setImportStock(false)} onImported={() => cache.invalidateQueries({ queryKey: ["inventory"] })} />}
      <PageHeader
        eyebrow="CONNECTED OPERATIONS"
        title={config.title}
        description={config.description}
      >
        {["agents", "inventory", "activations"].includes(
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
        {["Administrator", "Operations Manager"].includes(user.role) &&
          ["agents", "branches"].includes(resource) && (
            <button
              className="primary"
              onClick={() =>
                setSetup(resource === "agents" ? "agents" : "branches")
              }
            >
              {resource === "agents" ? "Add agent" : "Add branch"}
            </button>
          )}
        {resource === "inventory" && user.role === "Administrator" && <>
          <button onClick={() => navigate("/administration?section=inventory")}><Plus size={16} /> Add SIM</button>
          <button className="primary" onClick={() => setImportStock(true)}><Download size={16} /> Import Excel</button>
        </>}
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
      <RecordOverview rows={data} categories={resource === "inventory" ? ["AVAILABLE","RESERVED","ACTIVATED","DAMAGED"] : []} field={resource === "branches" ? "agents" : resource === "customers" ? "nationality" : resource === "audit" ? "action" : "status"} numeric={resource === "branches"} title={resource === "branches" ? "Agents by branch" : resource === "customers" ? "Customer nationalities" : resource === "audit" ? "Activity breakdown" : "Status breakdown"} />
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
        ) : resource === "branches" ? (
          <BranchDrawer branch={selected} onClose={closeDetails} />
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

          </Drawer>
        ))}
    </>
  );
}

function BranchDrawer({ branch, onClose }: { branch: Row; onClose: () => void }) {
  const navigate = useNavigate();
  const { data = [], isPending, error, refetch } = useResource("agents");
  return (
    <Drawer title={branch.name + " · Branch performance"} onClose={onClose}>
      <DetailList
        data={{
          branch: branch.name,
          agents: branch.agents,
          daily_target: branch.target,
          sales_today: branch.closed_today,
          completed_sales: branch.closed_sales,
        }}
      />
      {isPending ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} retry={refetch} />
      ) : (
        <DataTable
          rows={data.filter((a) => a.branch_id === branch.id)}
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
  const [status, setStatus] = useState(["BLOCKED","DAMAGED"].includes(sim.status)?"RETIRED":"RETURNED");
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
          category: sim.business_category || "Not recorded",
          status: sim.status,
          agent: sim.agent,
          outlet: sim.outlet,
          progress: (sim.activation_stage || "NOT_STARTED").replaceAll("_"," "),
          payment: (sim.payment_status || "NOT_UPLOADED").replaceAll("_"," "),
        }}
      />
      {user.permissions.includes("inventory.write") && sim.scan_transaction_id && !sim.capture_id && <button disabled={busy} onClick={async () => {if(!window.confirm('Discard the unfinished SIM transaction and free this stock?')) return;setBusy(true);try{await api(`/inventory/scan/${sim.scan_transaction_id}`,{method:'DELETE'});await client.invalidateQueries({queryKey:['inventory']});notify('Unfinished SIM scan cleared');onClose();}catch(e:any){notify(e.message);}finally{setBusy(false);}}}>Clear unfinished scan</button>}
      {user.permissions.includes("inventory.write") && !["ACTIVATED", "RESERVED"].includes(sim.status) && (!sim.scan_transaction_id || sim.activation_stage === "ACTIVATED") && (
        <form className="proposal-form sim-stock-edit" onSubmit={async e => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          setBusy(true);
          try {
            await patch(`/inventory/${sim.id}`, {
              iccid: form.get("iccid"), serial: form.get("serial"), sim_type: form.get("sim_type"), business_category: form.get("business_category"), expected_category: sim.business_category,
              expected_iccid: sim.iccid, expected_serial: sim.serial, expected_type: sim.sim_type,
              reason: form.get("edit_reason"),
            });
            await client.invalidateQueries({ queryKey: ["inventory"] });
            await client.invalidateQueries({ queryKey: ["audit"] });
            notify("SIM details updated"); onClose();
          } catch (error: any) { notify(error.message); }
          finally { setBusy(false); }
        }}>
          <h3 className="wide">Edit SIM details</h3>
          <label>ICCID<input name="iccid" defaultValue={sim.iccid} required minLength={3} maxLength={60} /></label>
          <label>SIM serial<input name="serial" defaultValue={sim.serial} required minLength={3} maxLength={60} /></label>
          <label>Business category<select name="business_category" defaultValue={sim.business_category || "Not recorded"}>{["Not recorded","Wasel / Prepaid","Postpaid","Home Wireless","Visitor"].map(value=><option key={value}>{value}</option>)}</select></label>
          <label>SIM type<select name="sim_type" defaultValue={sim.sim_type}><option>Physical</option><option>eSIM</option></select></label>
          <label>Reason for edit<input name="edit_reason" required minLength={5} maxLength={300} /></label>
          <button className="primary wide" disabled={busy}>{busy ? "Saving…" : "Save SIM details"}</button>
        </form>
      )}
      {user.permissions.includes("inventory.write") &&
        !["ACTIVATED", "RESERVED", "RETIRED"].includes(
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
                  agent_id: ["RETURNED","WAREHOUSE","RETIRED"].includes(status) ? null : agent || null,
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
                {( ["BLOCKED","DAMAGED"].includes(sim.status) ? ["RETIRED"] : ["AVAILABLE","ASSIGNED TO AGENT","RETURNED","DAMAGED","BLOCKED","RETIRED"] ).map((s) => (
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
                {agents.filter(a => a.employment_status !== "EXITED").map((a) => (
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
    ["daily", "Historical daily activation", "A complete snapshot of daily connections."],
    ["monthly", "Historical monthly activation", "Activation performance over the month."],
    ["agent", "Agent performance", "Productivity and quality by field agent."],

    [
      "ekyc",
      "Verification outcomes",
      "Captured transactions and backend decisions.",
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
      <section className="panel report-card" style={{marginBottom:16}}><h2>Sales, targets &amp; follow-ups</h2><p>Current sales with product, agent, branch and call outcomes</p><Link className="primary button-link" to="/sales">Open sales reports &amp; Excel export</Link></section>
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
