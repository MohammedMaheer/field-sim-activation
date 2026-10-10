import ActivationStatus from "./ActivationStatus";
import ProductTargetManagement from "./ProductTargets";
import { useBranchScope } from "./BranchScope";
import { businessPeriod } from "./businessTime";
import { useSearchParams } from "react-router-dom";
import { useContext, useState, useEffect, useRef } from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { FileDown, Plus, RefreshCw, Upload } from "lucide-react";

import { Context } from "./App";

import { api, download, post, Row } from "./api";

import { Drawer, ErrorState, Loading } from "./components";

import CallWorkspace from "./CallWorkspace";
import SRVerification, { srStatus } from "./SRVerification";

import "./sales-management.css";

type Tab =
  "sales" | "feedback" | "targets" | "calls" | "import" | "staff" | "sr";

const orderTypes = ["NEW", "MNP", "P2P", "HW", "ELIFE", "WASEL", "VISITOR"];

const labels: Record<string, string> = {
  NEW: "New",
  MNP: "Number transfer",
  P2P: "Prepaid to postpaid",
  HW: "Home wireless",
  ELIFE: "eLife",
  WASEL: "Wasel",
  VISITOR: "Visitor",
};

const month = businessPeriod();

export default function SalesManagement() {
  const { user, notify } = useContext(Context);

  const queryClient = useQueryClient();

  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() =>
    ["sales", "feedback", "targets", "calls", "import", "staff", "sr"].includes(
      params.get("tab") || "",
    )
      ? (params.get("tab") as Tab)
      : "sales",
  );

  const [period, setPeriod] = useState(month);

  const [busy, setBusy] = useState(false);

  const [error, setError] = useState("");

  const [importData, setImportData] = useState<{
    filename: string;
    content_base64: string;
  } | null>(null);

  const [preview, setPreview] = useState<Row | null>(null);

  const [selectedSale, setSelectedSale] = useState<Row | null>(() =>
    params.get("selected") ? { id: params.get("selected") } : null,
  );

  const [productFilter, setProductFilter] = useState("");

  const { branch: branchFilter, setBranch: setBranchFilter } = useBranchScope();

  const [agentFilter, setAgentFilter] = useState("");

  const [statusFilter, setStatusFilter] = useState("");
  const [extraFilters, setExtraFilters] = useState(false);
  const [leaderFilter, setLeaderFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const filters = new URLSearchParams({
    period,
    from_date: fromDate,
    to_date: toDate,
    leader_id: leaderFilter,
    order_type: productFilter,
    branch_id: branchFilter,
    agent_id: agentFilter,
    status: statusFilter,
  }).toString();

  const detail = useQuery<Row>({
    queryKey: ["sales-management", "detail", selectedSale?.id],
    queryFn: () => api(`/sales-management/sales/${selectedSale!.id}`),
    enabled: !!selectedSale,
  });

  const [newSale, setNewSale] = useState(false);

  const [newFeedback, setNewFeedback] = useState(false);

  const [editingStaff, setEditingStaff] = useState<Row | null>(null);

  const [correctingSale, setCorrectingSale] = useState<Row | null>(null);

  const agents = useQuery<Row[]>({
    queryKey: ["agents"],
    queryFn: () => api("/resources/agents"),
  });

  const sales = useQuery<Row[]>({
    queryKey: ["sales-management", "sales", filters],
    queryFn: () => api(`/sales-management/sales?${filters}`),
  });

  const feedback = useQuery<Row[]>({
    queryKey: ["sales-management", "feedback", branchFilter],
    queryFn: () =>
      api(
        `/sales-management/feedback?branch_id=${encodeURIComponent(branchFilter)}`,
      ),
    enabled: tab === "feedback",
  });

  const targets = useQuery<Row[]>({
    queryKey: ["sales-management", "targets", period, branchFilter],
    queryFn: () =>
      api(
        `/sales-management/targets?period=${period}&branch_id=${encodeURIComponent(branchFilter)}`,
      ),
    enabled: tab === "targets",
  });

  const staff = useQuery<Row[]>({
    queryKey: ["sales-management", "staff", branchFilter],
    queryFn: () =>
      api(
        `/sales-management/staff?branch_id=${encodeURIComponent(branchFilter)}`,
      ),
    enabled: tab === "staff",
  });

  const branches = useQuery<Row[]>({
    queryKey: ["branches"],
    queryFn: () => api("/resources/branches"),
  });

  const leaders = useQuery<Row[]>({
    queryKey: ["team-leaders"],
    queryFn: () => api("/resources/team-leaders"),
    enabled: extraFilters,
  });
  const performance = useQuery<Row>({
    queryKey: ["sales-management", "performance", filters],
    queryFn: () => api(`/sales-management/performance?${filters}`),
  });

  const canManage = ["Administrator", "Operations Manager"].includes(user.role);

  const canRecord = ["Field Agent", "Operations Manager"].includes(user.role);

  const canSetTargets = canManage || user.role === "Team Leader";
  const canVerifySR = user.permissions?.includes("compliance.write");

  const agentOptions = (agents.data || []).filter(
    (row) => !branchFilter || row.branch_id === branchFilter,
  );
  const lastBranch = useRef(branchFilter);
  useEffect(() => {
    if (lastBranch.current !== branchFilter) {
      setAgentFilter("");
      setLeaderFilter("");
      setSelectedSale(null);
      lastBranch.current = branchFilter;
    }
  }, [branchFilter]);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["sales-management"] });
  }

  async function submitForm(
    event: React.FormEvent<HTMLFormElement>,
    endpoint: string,
    done: () => void,
    method: "POST" | "PUT" | "PATCH" = "POST",
  ) {
    event.preventDefault();
    setError("");
    setBusy(true);

    const form = new FormData(event.currentTarget);

    const body = Object.fromEntries(form.entries());

    try {
      if (method !== "POST")
        await api(endpoint, { method, body: JSON.stringify(body) });
      else await post(endpoint, body);
      await refresh();
      done();
      notify("Saved successfully");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function pickFile(file?: File) {
    if (!file) return;

    if (file.size > 2_000_000) {
      setError("Choose a CSV or Excel file under 2 MB");
      return;
    }

    setError("");
    setPreview(null);

    const buffer = await file.arrayBuffer();

    const bytes = new Uint8Array(buffer);

    let binary = "";

    for (const byte of bytes) binary += String.fromCharCode(byte);

    setImportData({ filename: file.name, content_base64: btoa(binary) });
  }

  async function processFile(apply: boolean) {
    if (!importData) return;

    setBusy(true);
    setError("");

    try {
      const result = await post(
        tab === "targets"
          ? "/sales-management/targets/file"
          : "/sales-management/status-file",
        { ...importData, apply },
      );

      setPreview(result);

      if (apply) {
        await refresh();
        notify(
          tab === "targets" ? "Targets updated" : "Sales statuses updated",
        );
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function correctSale(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!correctingSale) return;

    setBusy(true);
    setError("");

    const body = Object.fromEntries(
      new FormData(event.currentTarget).entries(),
    );

    try {
      await api(`/sales-management/sales/${correctingSale.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });

      setCorrectingSale(null);

      await refresh();

      notify("Sale corrected");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sales-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">FIELD PERFORMANCE</span>
          <h1>Sales management</h1>
          <p>Sales, follow-ups and targets in one place</p>
        </div>
        <button onClick={refresh}>
          <RefreshCw size={16} /> Refresh
        </button>
      </header>

      <div className="sales-toolbar">
        <label>
          Period{" "}
          <input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
        </label>
        <button
          onClick={() =>
            download(
              `/sales-management/export?format=xlsx&${filters}`,
              "sales-records.xlsx",
            )
          }
        >
          <FileDown size={16} /> Export sales
        </button>
      </div>

      {performance.data && (
        <section className="sales-metrics" aria-label="Sales summary">
          <article>
            <span>Recorded</span>
            <strong>{performance.data.recorded}</strong>
          </article>
          <article>
            <span>Closed</span>
            <strong>{performance.data.closed}</strong>
          </article>
          <article>
            <span>In progress</span>
            <strong>{performance.data.in_progress}</strong>
          </article>
          <article>
            <span>Monthly target</span>
            <strong>{performance.data.monthly_target}</strong>
          </article>
          <article>
            <span>Remaining</span>
            <strong>{performance.data.remaining}</strong>
          </article>
          <article>
            <span>Current run rate</span>
            <strong>
              {performance.data.crr == null
                ? "—"
                : Number(performance.data.crr).toFixed(2)}
            </strong>
            <small>Sales / day</small>
          </article>
          <article>
            <span>Daily required rate</span>
            <strong>
              {performance.data.drr == null
                ? "—"
                : Number(performance.data.drr).toFixed(2)}
            </strong>
            <small>Sales / day</small>
          </article>
        </section>
      )}

      {performance.data &&
        Object.values(performance.data.by_product || {}).some(
          (value) => Number(value) > 0,
        ) && (
          <section
            className="panel sales-product-chart"
            aria-label="Closed sales by product"
          >
            <h2>Closed sales by product</h2>
            <div>
              {Object.entries(
                performance.data.by_product as Record<string, number>,
              ).map(([name, count]) => (
                <div className="sales-product-row" key={name}>
                  <span>{labels[name] || name}</span>
                  <div className="sales-product-track">
                    <i
                      style={{
                        width: `${count ? Math.max(5, (count / performance.data.closed) * 100) : 0}%`,
                      }}
                    />
                  </div>
                  <b>{count}</b>
                </div>
              ))}
            </div>
          </section>
        )}

      {performance.data && (
        <div className="daily-sales-summary" aria-label="Today by product">
          <b>Today · {performance.data.closed_today ?? 0} closed</b>
          {Object.entries(performance.data.daily_by_product || {}).map(
            ([name, count]) => (
              <span key={name}>
                {labels[name]} <strong>{String(count)}</strong>
              </span>
            ),
          )}
        </div>
      )}

      <nav className="sales-tabs" aria-label="Sales sections">
        {(
          [
            "sales",
            "feedback",
            "targets",
            "calls",
            ...(canVerifySR ? ["sr"] : []),
            ...(canManage ? ["import"] : []),
            ...(canManage ? ["staff"] : []),
          ] as Tab[]
        ).map((item) => (
          <button
            key={item}
            className={tab === item ? "active" : ""}
            onClick={() => {
              setTab(item);
              setPreview(null);
              setImportData(null);
              setError("");
            }}
          >
            {
              (
                {
                  sales: "Sales",
                  feedback: "No-sale feedback",
                  targets: "Targets",
                  calls: "Call work queue",
                  sr: "SR verification",
                  import: "Status import",
                  staff: "Sales staff",
                } as Record<Tab, string>
              )[item]
            }
          </button>
        ))}
      </nav>

      {error && (
        <div className="sales-error" role="alert">
          {error}
        </div>
      )}

      {tab === "sales" && (
        <section className="panel sales-section">
          <div className="sales-section-head">
            <h2>Sales register</h2>
            {canRecord && (
              <button className="primary" onClick={() => setNewSale(!newSale)}>
                <Plus size={16} /> Record sale
              </button>
            )}
          </div>

          {newSale && (
            <form
              className="sales-form"
              onSubmit={(e) =>
                submitForm(e, "/sales-management/sales", () =>
                  setNewSale(false),
                )
              }
            >
              <label>
                Sales agent
                <select
                  name="agent_id"
                  required
                  defaultValue={user.agent_id || ""}
                >
                  {!user.agent_id && <option value="">Select agent</option>}
                  {agentOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Order type
                <select name="order_type" required>
                  {orderTypes.map((t) => (
                    <option key={t} value={t}>
                      {labels[t]}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Customer name
                <input name="customer_name" required />
              </label>
              <label>
                Document number
                <input name="document_number" />
              </label>
              <label>
                Nationality
                <input name="nationality" />
              </label>
              <label>
                Plan or product
                <input name="plan_name" required />
              </label>

              <label>
                Request ID
                <input name="request_id" />
              </label>
              <label>
                Account number
                <input name="account_number" />
              </label>
              <label>
                SIM serial
                <input name="sim_serial" />
              </label>
              <label>
                Router fulfilment
                <select name="router_fulfilment">
                  <option value="">For Home wireless only</option>
                  <option value="DELIVERY">Delivery</option>
                  <option value="ON_SPOT">On spot</option>
                  <option value="WITHOUT_ROUTER">Without router</option>
                </select>
              </label>
              <label>
                Router serial
                <input name="router_serial" />
              </label>
              <label>
                SR number
                <input name="sr_number" />
              </label>
              <label>
                Alternate number
                <input name="alternate_number" />
              </label>
              <label>
                MSISDN
                <input name="msisdn" />
              </label>
              <label>
                Advance transaction number
                <input name="advance_transaction_number" />
              </label>
              <label className="wide">
                Note
                <input name="note" />
              </label>
              <button className="primary" disabled={busy}>
                Save sale
              </button>
            </form>
          )}

          {correctingSale && canManage && (
            <form
              className="sales-form compact"
              onSubmit={correctSale}
              aria-label="Correct sale"
            >
              <h3 className="wide">Correct {correctingSale.customer_name}</h3>
              <label>
                Order type
                <select
                  name="order_type"
                  defaultValue={correctingSale.order_type}
                >
                  {orderTypes.map((t) => (
                    <option key={t} value={t}>
                      {labels[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Router serial
                <input
                  name="router_serial"
                  defaultValue={correctingSale.router_serial || ""}
                />
              </label>
              <label className="wide">
                Reason for correction
                <input name="reason" minLength={5} maxLength={300} required />
              </label>
              <button className="primary" disabled={busy}>
                Save correction
              </button>
              <button type="button" onClick={() => setCorrectingSale(null)}>
                Cancel
              </button>
            </form>
          )}

          <div
            className="sales-form compact sales-filters"
            aria-label="Sales filters"
          >
            <label>
              Product
              <select
                value={productFilter}
                onChange={(e) => setProductFilter(e.target.value)}
              >
                <option value="">All products</option>
                {orderTypes.map((t) => (
                  <option key={t} value={t}>
                    {labels[t]}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Branch
              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
              >
                <option value="">All permitted branches</option>
                {branches.data?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Sales agent
              <select
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
              >
                <option value="">All permitted agents</option>
                {agentOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Status
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">All statuses</option>
                <option value="IN_PROGRESS">
                  Activated · pending backend review
                </option>
                <option value="CLOSED">Backend verified</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </label>
          </div>

          <button
            className="extra-filters-toggle"
            onClick={() => setExtraFilters(!extraFilters)}
          >
            {extraFilters ? "Fewer filters" : "Date & team leader filters"}
          </button>
          {extraFilters && (
            <div className="sales-form compact">
              <label>
                Team leader
                <select
                  value={leaderFilter}
                  onChange={(e) => setLeaderFilter(e.target.value)}
                >
                  <option value="">All permitted leaders</option>
                  {leaders.data
                    ?.filter(
                      (row) => !branchFilter || row.branch_id === branchFilter,
                    )
                    .map((row) => (
                      <option key={row.id} value={row.leader_id}>
                        {row.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                From date
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                />
              </label>
              <label>
                To date
                <input
                  type="date"
                  value={toDate}
                  min={fromDate}
                  onChange={(e) => setToDate(e.target.value)}
                />
              </label>
            </div>
          )}
          {sales.isPending ? (
            <Loading />
          ) : sales.error ? (
            <ErrorState error={sales.error} retry={sales.refetch} />
          ) : !sales.data?.length ? (
            <p className="sales-empty">No sales recorded yet</p>
          ) : (
            <div className="sales-table-wrap">
              <table className="sales-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Product</th>
                    <th>Agent / branch</th>
                    <th>Request ID</th>
                    <th>Status / SR verification</th>
                    <th>Recorded</th>
                    {canManage && <th>Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {sales.data.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <button
                          className="sale-detail-link"
                          onClick={() => setSelectedSale(row)}
                        >
                          {row.customer_name}
                        </button>
                        <small>{row.document}</small>
                        {row.assignment_warning && (
                          <small className="stock-alert">
                            {row.assignment_warning}
                          </small>
                        )}
                      </td>
                      <td>
                        {labels[row.order_type] || row.order_type}
                        <small>{row.plan_name}</small>
                      </td>
                      <td>
                        {row.agent}
                        <small>{row.branch}</small>
                      </td>
                      <td>{row.request_id}</td>
                      <td>
                        <ActivationStatus row={row} />
                      </td>
                      <td>{new Date(row.created_at).toLocaleDateString()}</td>
                      {canManage && (
                        <td>
                          <button
                            onClick={() => {
                              setCorrectingSale(row);
                              setError("");
                            }}
                          >
                            Correct
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === "sales" && performance.data?.daily_summary?.length > 0 && (
        <section className="panel sales-section">
          <h2>Daily sales summary</h2>
          <div className="sales-table-wrap">
            <table className="sales-table">
              <thead>
                <tr>
                  <th>Sales date</th>
                  <th>Net closed</th>
                  <th>In progress</th>
                  <th>Cancelled</th>
                </tr>
              </thead>
              <tbody>
                {performance.data!.daily_summary.map((day: Row) => (
                  <tr key={day.date}>
                    <td>{day.date}</td>
                    <td>{day.closed}</td>
                    <td>{day.in_progress}</td>
                    <td>{day.cancelled}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "feedback" && (
        <section className="panel sales-section">
          <div className="sales-section-head">
            <h2>No-sale feedback</h2>
            {canRecord && (
              <button
                className="primary"
                onClick={() => setNewFeedback(!newFeedback)}
              >
                <Plus size={16} /> Add feedback
              </button>
            )}
          </div>

          {newFeedback && (
            <form
              className="sales-form"
              onSubmit={(e) =>
                submitForm(e, "/sales-management/feedback", () =>
                  setNewFeedback(false),
                )
              }
            >
              <label>
                Sales agent
                <select
                  name="agent_id"
                  required
                  defaultValue={user.agent_id || ""}
                >
                  {!user.agent_id && <option value="">Select agent</option>}
                  {agentOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Customer
                <input name="customer_name" />
              </label>
              <label>
                Contact
                <input name="contact_number" />
              </label>
              <label>
                Product suggested
                <input name="product_suggested" required />
              </label>
              <label>
                Rejection reason
                <input name="rejection_reason" required />
              </label>
              <label className="wide">
                Customer feedback
                <textarea name="feedback" required />
              </label>
              <button className="primary" disabled={busy}>
                Save feedback
              </button>
            </form>
          )}

          {feedback.isPending ? (
            <Loading />
          ) : feedback.error ? (
            <ErrorState error={feedback.error} retry={feedback.refetch} />
          ) : !feedback.data?.length ? (
            <p className="sales-empty">No feedback recorded yet</p>
          ) : (
            <div className="sales-table-wrap">
              <table className="sales-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Product</th>
                    <th>Reason</th>
                    <th>Feedback</th>
                    <th>Sales agent</th>
                  </tr>
                </thead>
                <tbody>
                  {feedback.data.map((row) => (
                    <tr key={row.id}>
                      <td>
                        {row.customer_name || "Not recorded"}
                        <small>{row.contact}</small>
                      </td>
                      <td>{row.product_suggested}</td>
                      <td>{row.rejection_reason}</td>
                      <td>{row.feedback}</td>
                      <td>{row.agent}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === "targets" && (
        <section className="panel sales-section">
          <div className="sales-section-head">
            <h2>Targets · {period}</h2>
            {canSetTargets && (
              <button
                onClick={() =>
                  download(
                    `/sales-management/targets/template?period=${period}&format=xlsx&branch_id=${encodeURIComponent(branchFilter)}`,
                    "sales-targets.xlsx",
                  )
                }
              >
                <FileDown size={16} /> Download target file
              </button>
            )}
          </div>

          {canSetTargets && (
            <div className="sales-target-import">
              <label className="file-input">
                Upload targets
                <input
                  aria-label="Target file"
                  type="file"
                  accept=".csv,.xlsx"
                  onChange={(e) => pickFile(e.target.files?.[0])}
                />
              </label>
              {importData && (
                <div className="sales-import-actions">
                  <span>{importData.filename}</span>
                  <button disabled={busy} onClick={() => processFile(false)}>
                    Preview targets
                  </button>
                  {preview && !preview.errors.length && !preview.applied && (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => processFile(true)}
                    >
                      Apply {preview.changes.length} targets
                    </button>
                  )}
                </div>
              )}
              {preview && (
                <div className="sales-preview">
                  <b>
                    {preview.changes.length} targets · {preview.errors.length}{" "}
                    errors{preview.applied ? " · Applied" : ""}
                  </b>
                  {preview.errors.map((message: string, index: number) => (
                    <p role="alert" key={index}>
                      {message}
                    </p>
                  ))}
                  {preview.changes
                    .slice(0, 25)
                    .map((change: Row, index: number) => (
                      <p key={index}>
                        {change.employee_id} · {change.period} ·{" "}
                        {change.order_type} · Daily {change.daily_target} /
                        Monthly {change.monthly_target}
                      </p>
                    ))}
                </div>
              )}
            </div>
          )}

          {targets.isPending ? (
            <Loading />
          ) : targets.error ? (
            <ErrorState error={targets.error} retry={targets.refetch} />
          ) : (
            <ProductTargetManagement
              agents={agentOptions}
              rows={targets.data || []}
              period={period}
              canEdit={canSetTargets}
              initialAgent={params.get("agent") || ""}
              onSaved={async () => {
                await refresh();
                await queryClient.invalidateQueries({
                  queryKey: ["dashboard"],
                });
              }}
            />
          )}
        </section>
      )}

      {tab === "calls" && <CallWorkspace embedded />}
      {tab === "sr" && canVerifySR && <SRVerification />}

      {tab === "staff" && canManage && (
        <section className="panel sales-section">
          <h2>Sales and call staff</h2>
          <form
            className="sales-form compact"
            onSubmit={(e) => {
              const form = e.currentTarget;
              submitForm(e, "/sales-management/staff", () => form.reset());
            }}
          >
            <label>
              Name
              <input name="name" minLength={2} required />
            </label>
            <label>
              Sign-in email
              <input name="email" type="email" required />
            </label>
            <label>
              Role
              <select name="role" required>
                <option>Sales Manager</option>
                <option>Tele Verification Officer</option>
                <option>Welcome Call Officer</option>
              </select>
            </label>
            <label>
              Branch
              <select name="branch_id">
                <option value="">All branches</option>
                {branches.data?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Password
              <input name="password" type="password" minLength={10} required />
            </label>
            <button className="primary" disabled={busy}>
              Add staff
            </button>
          </form>
          {editingStaff && (
            <form
              className="sales-form compact"
              onSubmit={(e) =>
                submitForm(
                  e,
                  `/sales-management/staff/${editingStaff.id}`,
                  () => setEditingStaff(null),
                  "PATCH",
                )
              }
            >
              <h3 className="wide">Assign {editingStaff.name}</h3>
              <label>
                Role
                <select name="role" defaultValue={editingStaff.role}>
                  <option>Sales Manager</option>
                  <option>Tele Verification Officer</option>
                  <option>Welcome Call Officer</option>
                </select>
              </label>
              <label>
                Branch
                <select
                  name="branch_id"
                  defaultValue={editingStaff.branch_id || ""}
                >
                  <option value="">All branches</option>
                  {branches.data?.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Reason
                <input name="reason" minLength={5} required />
              </label>
              <button className="primary" disabled={busy}>
                Save assignment
              </button>
              <button type="button" onClick={() => setEditingStaff(null)}>
                Cancel
              </button>
            </form>
          )}
          {staff.isPending ? (
            <Loading />
          ) : staff.error ? (
            <ErrorState error={staff.error} retry={staff.refetch} />
          ) : (
            <div className="sales-table-wrap">
              <table className="sales-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Branch</th>
                    <th>Sign-in email</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {staff.data?.map((person) => (
                    <tr key={person.id}>
                      <td>{person.name}</td>
                      <td>{person.role}</td>
                      <td>{person.branch}</td>
                      <td>{person.email}</td>
                      <td>
                        <button onClick={() => setEditingStaff(person)}>
                          Edit assignment
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === "import" && canManage && (
        <section className="panel sales-section sales-import">
          <h2>Update sale statuses</h2>
          <p>
            Export the sales file, edit the <b>new_status</b> column, then
            upload it for review. Accepted values: IN_PROGRESS, CLOSED,
            CANCELLED.
          </p>
          <label className="file-input">
            CSV or Excel file
            <input
              type="file"
              accept=".csv,.xlsx"
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
          </label>
          {importData && (
            <div className="sales-import-actions">
              <span>{importData.filename}</span>
              <button onClick={() => processFile(false)} disabled={busy}>
                <Upload size={15} /> Preview changes
              </button>
              {preview && !preview.errors.length && !preview.applied && (
                <button
                  className="primary"
                  onClick={() => processFile(true)}
                  disabled={busy}
                >
                  Apply {preview.changes.length} changes
                </button>
              )}
            </div>
          )}
          {preview && (
            <div className="sales-preview">
              <b>
                {preview.changes.length} changes · {preview.errors.length}{" "}
                errors
              </b>
              {preview.errors.map((item: string, i: number) => (
                <p key={i} role="alert">
                  {item}
                </p>
              ))}
              {preview.changes.slice(0, 25).map((item: Row) => (
                <p key={item.sale_id}>
                  {item.sale_id.slice(0, 8)} · {item.from} → {item.to}
                </p>
              ))}
            </div>
          )}
        </section>
      )}

      {selectedSale && (
        <Drawer title="Sale details" onClose={() => setSelectedSale(null)}>
          {detail.isPending ? (
            <Loading />
          ) : detail.error ? (
            <ErrorState error={detail.error} retry={detail.refetch} />
          ) : (
            detail.data && (
              <>
                <h3>{detail.data.customer_name}</h3>
                <span
                  className={`sales-status ${detail.data.status.toLowerCase()}`}
                >
                  {detail.data.status.replace("_", " ")}
                </span>

                {detail.data.capture_id && (
                  <p>
                    <a href={`/kyc-capture?capture=${detail.data.capture_id}`}>
                      Open submitted evidence
                    </a>
                  </p>
                )}

                <dl className="sale-detail-grid">
                  {[
                    ["agent", "Sales agent"],
                    ["employee_id", "Employee ID"],
                    ["leader", "Team leader"],
                    ["sales_manager", "Sales Manager"],
                    ["branch", "Branch"],
                    ["outlet", "Outlet"],
                    ["assignment_effective_at", "Assignment effective"],
                    ["order_type", "Order type"],
                    ["document", "Document"],
                    ["nationality", "Nationality"],
                    ["plan_name", "Plan"],
                    ["request_id", "Request ID"],
                    ["account_number", "Account number"],
                    ["msisdn", "Phone number"],
                    ["sim_serial", "SIM serial"],
                    ["router_fulfilment", "Router fulfilment"],
                    ["router_serial", "Router serial"],
                    [
                      "advance_transaction_number",
                      "Advance transaction number",
                    ],
                    ["sr_number", "SR number"],
                    ["alternate_number", "Alternate number"],
                    ["monthly_cost", "Monthly charge"],
                    ["prepayment", "Order prepayment"],
                  ].map(([key, label]) => (
                    <div key={key}>
                      <dt>{label}</dt>
                      <dd>{detail.data![key] || "Not recorded"}</dd>
                    </div>
                  ))}
                </dl>

                <div className="sale-verification-summary">
                  <div>
                    <span>SR verification</span>
                    <strong>
                      {srStatus(detail.data.sr_verification?.status)}
                    </strong>
                    <small>{detail.data.sr_verification?.reason}</small>
                  </div>
                  <div>
                    <span>Payment receipt</span>
                    <strong>
                      {detail.data.payment_record_status === "RECORDED"
                        ? "Recorded"
                        : "Not recorded"}
                    </strong>
                  </div>
                </div>
                <h3>Call follow-up</h3>
                {detail.data.calls.map((call: Row) => (
                  <p key={call.stage}>
                    <b>
                      {call.stage === "TELE_VERIFICATION"
                        ? "Tele-verification"
                        : "Welcome call"}
                    </b>{" "}
                    · {call.status}
                  </p>
                ))}
                {detail.data.attempts.map((attempt: Row, index: number) => (
                  <article className="sale-call-attempt" key={index}>
                    <b>
                      {attempt.stage === "TELE_VERIFICATION"
                        ? "Tele-verification"
                        : "Welcome call"}{" "}
                      · {attempt.outcome}
                    </b>
                    <p>{attempt.remark}</p>
                    <small>
                      {attempt.actor} · {new Date(attempt.at).toLocaleString()}
                    </small>
                  </article>
                ))}
              </>
            )
          )}
        </Drawer>
      )}
    </div>
  );
}
