import { useBranchScope } from "./BranchScope";
import ExportActions from "./ExportActions";
import { useContext, useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Plus, RefreshCw } from "lucide-react";
import { Context } from "./App";
import { api, post, download, Row, canManageOrganization } from "./api";
import { Drawer, ErrorState, Loading } from "./components";
import "./sales-management.css";

const categories: Record<string, string> = {
  GRABBA_DEVICE: "Grabba device",
  ROUTER: "Router",
  STAMP: "Stamp",
  ID_CARD: "Staff ID card",
  UNIFORM: "Uniform",
  OTHER: "Other",
};

function StockAdjustment({
  asset,
  onClose,
  onSave,
}: {
  asset: Row;
  onClose: () => void;
  onSave: (delta: number, reason: string) => Promise<void>;
}) {
  const [direction, setDirection] = useState("add");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const processing = useRef(false);
  const count = Number(quantity);
  const delta = direction === "remove" ? -count : count;
  const result = Number(asset.quantity) + delta;
  const valid =
    Number.isInteger(count) &&
    count > 0 &&
    result >= 0 &&
    reason.trim().length >= 5;
  return (
    <Drawer
      title="Adjust stock quantity"
      onClose={() => !processing.current && onClose()}
    >
      <form
        className="sales-form stock-adjustment-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!valid || processing.current) return;
          if (!reviewing) {
            setReviewing(true);
            setError("");
            return;
          }
          processing.current = true;
          setBusy(true);
          setError("");
          try {
            await onSave(delta, reason.trim());
          } catch (failure) {
            setError(
              failure instanceof Error
                ? failure.message
                : "Could not save the adjustment. Try again.",
            );
          } finally {
            processing.current = false;
            setBusy(false);
          }
        }}
      >
        <section
          className="assignment-current wide"
          aria-label="Stock adjustment summary"
        >
          <h3>{asset.label}</h3>
          <dl>
            <div>
              <dt>Branch</dt>
              <dd>{asset.branch || "Not recorded"}</dd>
            </div>
            <div>
              <dt>Current quantity</dt>
              <dd>{asset.quantity}</dd>
            </div>
            {quantity && Number.isInteger(count) && count > 0 && (
              <div>
                <dt>Quantity after adjustment</dt>
                <dd>{result}</dd>
              </div>
            )}
          </dl>
        </section>
        {!reviewing ? (
          <>
            <label>
              Adjustment type
              <select
                aria-label="Adjustment type"
                value={direction}
                onChange={(event) => setDirection(event.target.value)}
              >
                <option value="add">Add stock</option>
                <option value="remove">Remove stock</option>
              </select>
            </label>
            <label>
              Adjustment quantity
              <input
                type="number"
                min={1}
                step={1}
                required
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </label>
            <label className="wide">
              Reason for adjustment
              <textarea
                aria-label="Reason for adjustment"
                required
                minLength={5}
                maxLength={300}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="For example, received extra uniforms or corrected a stock count"
              />
            </label>
            {result < 0 && (
              <p className="form-error wide" role="alert">
                You can remove up to {asset.quantity} items. The quantity cannot
                go below zero.
              </p>
            )}
          </>
        ) : (
          <section
            className="assignment-review wide"
            aria-label="Review stock adjustment"
          >
            <h3>Review adjustment</h3>
            <p>
              <b>
                {direction === "remove" ? "Remove" : "Add"} {count}{" "}
                {count === 1 ? "item" : "items"}
              </b>{" "}
              · {asset.quantity} → {result}
            </p>
            <p>
              <b>Reason:</b> {reason}
            </p>
            <p>This change is saved in stock movement history.</p>
          </section>
        )}
        {error && (
          <p className="form-error wide" role="alert">
            {error}
          </p>
        )}
        <div className="assignment-actions wide">
          <button
            type="button"
            disabled={busy}
            onClick={() => (reviewing ? setReviewing(false) : onClose())}
          >
            {reviewing ? "Back to edit" : "Cancel"}
          </button>
          <button className="primary" disabled={busy || !valid}>
            {busy
              ? "Saving…"
              : reviewing
                ? "Save stock adjustment"
                : "Review adjustment"}
          </button>
        </div>
      </form>
    </Drawer>
  );
}

export default function FieldAssets() {
  const { user, notify } = useContext(Context);
  const client = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  type AssetTab = "stock" | "requests" | "report" | "movements" | "checklist";
  const requestedTab = searchParams.get("tab");
  const tab: AssetTab = [
    "stock",
    "requests",
    "report",
    "movements",
    "checklist",
  ].includes(requestedTab || "")
    ? (requestedTab as AssetTab)
    : "stock";
  const setTab = (value: AssetTab) => setSearchParams({ tab: value });
  const [add, setAdd] = useState(false);
  const [move, setMove] = useState<Row | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<Row | null>(null);
  const [adjustment, setAdjustment] = useState<Row | null>(null);
  const { branch, setBranch } = useBranchScope();
  const [localFilter, setLocalFilter] = useState({
    category: "",
    agent_id: "",
    status: "",
    start: "",
    end: "",
  });
  const filter = { ...localFilter, branch_id: branch };
  const setFilter = (next: typeof filter) => {
    setLocalFilter({
      category: next.category,
      agent_id: next.agent_id,
      status: next.status,
      start: next.start,
      end: next.end,
    });
    if (next.branch_id !== branch) setBranch(next.branch_id);
  };
  const [advanced, setAdvanced] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null),
    [importPreview, setImportPreview] = useState<Row | null>(null);
  const importRevision = useRef(0),
    importing = useRef(false);
  const importStock = async (apply: boolean) => {
    if (!importFile || !branch || importing.current) return;
    importing.current = true;
    const revision = importRevision.current;
    setBusy(true);
    setError("");
    try {
      if (importFile.size > 2_000_000)
        throw new Error("Choose an Excel or CSV file under 2 MB.");
      const bytes = new Uint8Array(await importFile.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const result = await post("/field-assets/import", {
        branch_id: branch,
        filename: importFile.name,
        content_base64: btoa(binary),
        apply,
      });
      if (revision !== importRevision.current) {
        if (result.applied)
          await client.invalidateQueries({ queryKey: ["field-assets"] });
        return;
      }
      if (result.applied) {
        setImportPreview(null);
        setImportFile(null);
        await client.invalidateQueries({ queryKey: ["field-assets"] });
        notify(
          result.already_imported
            ? "This branch stock file is already recorded"
            : `${result.count} stock rows received by branch`,
        );
      } else setImportPreview(result);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Import failed");
    } finally {
      importing.current = false;
      setBusy(false);
    }
  };
  const [transferBranch, setTransferBranch] = useState("");
  const organization = useQuery<Row>({
    queryKey: ["organization"],
    queryFn: () => api("/organization"),
    enabled: ["Administrator", "Operations Manager"].includes(user.role),
  });
  const transferLeaders: Row[] = (organization.data?.leaders || []).filter(
    (person: Row) => person.branch_id === transferBranch,
  );
  const checkAgent =
    searchParams.get("agent") ||
    (searchParams.get("branch") ? "" : user.agent_id || "");
  const checkBranch = searchParams.get("branch") || branch;
  const branchQuery = `branch_id=${encodeURIComponent(branch)}`;
  const previousBranch = useRef(branch);
  useEffect(() => {
    if (previousBranch.current !== branch) {
      previousBranch.current = branch;
      setLocalFilter((current) => ({ ...current, agent_id: "" }));
      setMove(null);
      setIssue(null);
      setAdjustment(null);
      setImportPreview(null);
      setImportFile(null);
      importRevision.current++;
      const next = new URLSearchParams(searchParams);
      next.delete("agent");
      next.delete("branch");
      setSearchParams(next, { replace: true });
    }
  }, [branch, searchParams, setSearchParams]);
  const params = new URLSearchParams(
    Object.entries(filter)
      .filter(([, v]) => !!v)
      .map(([k, v]) => [k, k === "end" ? `${v}T23:59:59` : v]),
  ).toString();
  const stock = useQuery<Row[]>({
    queryKey: ["field-assets", "stock", branch],
    queryFn: () => api(`/field-assets?${branchQuery}`),
  });
  const requests = useQuery<Row[]>({
    queryKey: ["field-assets", "requests", branch],
    queryFn: () => api(`/field-assets/requests/list?${branchQuery}`),
    refetchInterval: 15000,
  });
  const summary = useQuery<Row[]>({
    queryKey: ["field-assets", "summary", branch],
    queryFn: () => api(`/field-assets/report/summary?${branchQuery}`),
    refetchInterval: 30000,
  });
  const movements = useQuery<Row[]>({
    queryKey: ["field-assets", "movements", params],
    queryFn: () => api(`/field-assets/report/movements?${params}`),
    enabled: tab === "movements",
  });
  const checklist = useQuery<Row>({
    queryKey: ["field-assets", "checklist", checkAgent, checkBranch],
    queryFn: () =>
      api(
        `/field-assets/report/checklist?agent_id=${checkAgent}&branch_id=${checkBranch}`,
      ),
    enabled: tab === "checklist" && !!(checkAgent || checkBranch),
  });
  const branches = useQuery<Row[]>({
    queryKey: ["branches"],
    queryFn: () => api("/resources/branches"),
  });
  const agents = useQuery<Row[]>({
    queryKey: ["agents"],
    queryFn: () => api("/resources/agents"),
  });
  const lifecycle = useQuery<Row>({
    queryKey: ["field-assets", "branch-lifecycle", checkBranch],
    queryFn: () => api(`/branch-lifecycle/${checkBranch}`),
    enabled: tab === "checklist" && !!checkBranch,
    refetchInterval: 15000,
  });
  const canManage =
    ["Administrator", "Operations Manager", "Inventory Manager"].includes(
      user.role,
    ) &&
    user.permissions?.includes("read") &&
    user.permissions?.includes("inventory.write");
  const canManageStaff = canManageOrganization(user);
  const canRequest =
    [
      "Field Agent",
      "Team Leader",
      "Administrator",
      "Operations Manager",
    ].includes(user.role) &&
    user.permissions?.includes("read") &&
    user.permissions?.includes(
      user.role === "Field Agent"
        ? "inventory.self"
        : user.role === "Team Leader"
          ? "task.write"
          : "inventory.write",
    );
  const agentId = user.agent_id as string | undefined;
  const categoryOptions: Record<string, string> = {
    ...categories,
    ...Object.fromEntries(
      [...(stock.data || []), ...(summary.data || [])].map((row) => [
        row.category,
        categories[row.category] ||
          row.category.replaceAll("_", " ").replaceAll(":", " · "),
      ]),
    ),
  };
  const filteredStock = (stock.data || []).filter(
    (row) =>
      (!filter.branch_id || row.branch_id === filter.branch_id) &&
      (!filter.category || row.category === filter.category) &&
      (!filter.agent_id || row.agent_id === filter.agent_id) &&
      (!filter.status || row.status === filter.status) &&
      (!filter.start || row.created_at >= filter.start) &&
      (!filter.end || row.created_at <= `${filter.end}T23:59:59`),
  );
  const exportReport = (kind: string) =>
    user.permissions.includes("report.read") && (
      <ExportActions
        path={`/field-assets/report/export?kind=${kind}&${params}`}
        name={`qanawat-stock-${kind}`}
        label="Export"
      />
    );
  async function refresh() {
    await client.invalidateQueries({ queryKey: ["field-assets"] });
    await client.invalidateQueries({ queryKey: ["branches"] });
  }
  async function save(
    event: React.FormEvent<HTMLFormElement>,
    path: string,
    method: "POST" | "PATCH" | "PUT",
    done: () => void,
  ) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const body = Object.fromEntries(new FormData(event.currentTarget));
    if ("quantity" in body) body.quantity = Number(body.quantity) as any;
    try {
      if (method === "POST") await post(path, body);
      else await api(path, { method, body: JSON.stringify(body) });
      await refresh();
      done();
      notify("Stock record updated");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="sales-page">
      {adjustment && canManage && (
        <StockAdjustment
          asset={adjustment}
          onClose={() => setAdjustment(null)}
          onSave={async (delta, reason) => {
            await post(`/field-assets/${adjustment.id}/adjust`, {
              delta,
              reason,
            });
            await refresh();
            notify("Stock adjustment saved");
            setAdjustment(null);
          }}
        />
      )}
      <header className="page-header">
        <div>
          <span className="eyebrow">FIELD EQUIPMENT</span>
          <h1>Assets & supplies</h1>
          <p>Devices, routers and branch supplies</p>
        </div>
        <button onClick={refresh}>
          <RefreshCw size={16} /> Refresh
        </button>
      </header>
      <nav className="sales-tabs" aria-label="Asset sections">
        <button
          className={tab === "stock" ? "active" : ""}
          onClick={() => setTab("stock")}
        >
          Stock register
        </button>
        <button
          className={tab === "requests" ? "active" : ""}
          onClick={() => setTab("requests")}
        >
          Requests{" "}
          {requests.data?.filter((row) =>
            ["REQUESTED", "APPROVED"].includes(row.status),
          ).length
            ? `(${requests.data.filter((row) => ["REQUESTED", "APPROVED"].includes(row.status)).length})`
            : ""}
        </button>
        <button
          className={tab === "report" ? "active" : ""}
          onClick={() => setTab("report")}
        >
          Balances & alerts
        </button>
        <button
          className={tab === "movements" ? "active" : ""}
          onClick={() => setTab("movements")}
        >
          Movements
        </button>
        <button
          className={tab === "checklist" ? "active" : ""}
          onClick={() => setTab("checklist")}
        >
          Returns & transfers
        </button>
      </nav>
      {!!summary.data?.filter((row) => row.low_stock).length && (
        <div className="sales-error" role="status">
          {summary.data.filter((row) => row.low_stock).length} stock level
          {summary.data.filter((row) => row.low_stock).length === 1
            ? " is"
            : "s are"}{" "}
          below minimum
        </div>
      )}
      {tab !== "checklist" && (
        <div
          className="sales-form compact stock-filters"
          aria-label="Stock filters"
        >
          <label>
            Branch
            <select
              value={filter.branch_id}
              onChange={(e) =>
                setFilter({ ...filter, branch_id: e.target.value })
              }
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
            Category
            <select
              value={filter.category}
              onChange={(e) =>
                setFilter({ ...filter, category: e.target.value })
              }
            >
              <option value="">All categories</option>
              {Object.entries(categoryOptions).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {tab !== "report" && (
            <label>
              Sales agent
              <select
                value={filter.agent_id}
                onChange={(e) =>
                  setFilter({ ...filter, agent_id: e.target.value })
                }
              >
                <option value="">All permitted sales agents</option>
                {agents.data
                  ?.filter((a) => !branch || a.branch_id === branch)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </label>
          )}{" "}
          {tab === "stock" && (
            <label>
              Status
              <select
                value={filter.status}
                onChange={(e) =>
                  setFilter({ ...filter, status: e.target.value })
                }
              >
                <option value="">All statuses</option>
                {[
                  "AVAILABLE",
                  "ASSIGNED",
                  "RETURNED",
                  "DAMAGED",
                  "LOST",
                  "CONSUMED",
                  "RETIRED",
                ].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          )}
          {tab !== "report" && (
            <button type="button" onClick={() => setAdvanced(!advanced)}>
              {advanced ? "Fewer filters" : "Date filters"}
            </button>
          )}
          {advanced && tab !== "report" && (
            <>
              <label>
                From
                <input
                  type="date"
                  value={filter.start}
                  onChange={(e) =>
                    setFilter({ ...filter, start: e.target.value })
                  }
                />
              </label>
              <label>
                To
                <input
                  type="date"
                  value={filter.end}
                  onChange={(e) =>
                    setFilter({ ...filter, end: e.target.value })
                  }
                />
              </label>
            </>
          )}
        </div>
      )}
      {tab === "stock" && (
        <section
          className="panel sales-section"
          aria-label="Receive branch stock"
        >
          <h2>Branch stock · receive, assign, return</h2>
          <p>
            Choose a branch, receive its stock, then assign items to its sales
            agents. Return or transfer items from the item actions; movement
            history stays recorded.
          </p>
          {canManage && (
            <div className="sales-form compact">
              <button
                disabled={busy}
                onClick={() =>
                  download(
                    "/field-assets/import-template",
                    "qanawat-branch-stock-template.xlsx",
                  ).catch((e) => setError(e.message))
                }
              >
                Excel stock template
              </button>
              <label>
                Branch stock Excel / CSV
                <input
                  aria-label="Branch stock file"
                  type="file"
                  accept=".csv,.xlsx"
                  disabled={busy || !branch}
                  onChange={(event) => {
                    setImportFile(event.target.files?.[0] || null);
                    importRevision.current++;
                    setImportPreview(null);
                  }}
                />
              </label>
              <button
                className="primary"
                disabled={busy || !branch || !importFile}
                onClick={() => importStock(false)}
              >
                Preview branch stock import
              </button>
              {!branch && <small>Select a receiving branch first.</small>}
            </div>
          )}
          {importPreview && (
            <div className="sales-preview">
              <p>
                {importPreview.branch} · {importPreview.count} rows ·{" "}
                {importPreview.quantity} items
              </p>
              <ul>
                {importPreview.rows.map((row: Row, i: number) => (
                  <li key={i}>
                    {row.label} · {row.serial || "No serial"} · quantity{" "}
                    {row.quantity}
                  </li>
                ))}
              </ul>
              <button
                className="primary"
                disabled={busy}
                onClick={() => importStock(true)}
              >
                Receive stock in this branch
              </button>
            </div>
          )}
        </section>
      )}
      {error && (
        <div className="sales-error" role="alert">
          {error}
        </div>
      )}
      {tab === "stock" && (
        <section className="panel sales-section">
          <div className="sales-section-head">
            <h2>Asset register</h2>
            {exportReport("stock")}
            {canManage && (
              <button className="primary" onClick={() => setAdd(!add)}>
                <Plus size={15} /> Add asset
              </button>
            )}
          </div>
          {add && canManage && (
            <form
              className="sales-form compact"
              onSubmit={(e) =>
                save(e, "/field-assets", "POST", () => setAdd(false))
              }
            >
              <label>
                Category
                <input
                  name="category"
                  list="asset-categories"
                  defaultValue="GRABBA_DEVICE"
                  pattern="[A-Z][A-Z0-9_]*"
                  required
                  maxLength={40}
                />
                <datalist id="asset-categories">
                  {Object.entries(categoryOptions).map(([k, v]) => (
                    <option value={k} key={k}>
                      {v}
                    </option>
                  ))}
                </datalist>
              </label>
              <label>
                Name
                <input name="label" required minLength={2} />
              </label>
              <label>
                Serial (if applicable)
                <input name="serial" />
              </label>
              <label>
                Quantity
                <input
                  name="quantity"
                  type="number"
                  min="1"
                  defaultValue="1"
                  required
                />
              </label>
              <label>
                Branch
                <select name="branch_id" required>
                  <option value="">Select branch</option>
                  {branches.data?.map((b) => (
                    <option value={b.id} key={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              {["warehouse", "batch", "size", "condition"].map((name) => (
                <label key={name}>
                  {name.charAt(0).toUpperCase() + name.slice(1)}
                  <input name={name} maxLength={name === "size" ? 40 : 100} />
                </label>
              ))}
              <label className="wide">
                Note
                <input name="note" />
              </label>
              <button className="primary" disabled={busy}>
                Save asset
              </button>
            </form>
          )}
          {move && (
            <form
              className="sales-form compact"
              onSubmit={(e) =>
                save(e, `/field-assets/${move.id}`, "PATCH", () =>
                  setMove(null),
                )
              }
            >
              <h3 className="wide">Move {move.label}</h3>
              <label>
                Branch
                <select name="branch_id" required defaultValue={move.branch_id}>
                  {branches.data?.map((b) => (
                    <option value={b.id} key={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Assigned sales agent
                <select name="agent_id" defaultValue={move.agent_id || ""}>
                  <option value="">Unassigned</option>
                  {agents.data
                    ?.filter((a) => a.employment_status !== "EXITED")
                    .map((a) => (
                      <option value={a.id} key={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Status
                <select name="status" defaultValue={move.status}>
                  {[
                    "AVAILABLE",
                    "ASSIGNED",
                    "RETURNED",
                    "DAMAGED",
                    "LOST",
                    "CONSUMED",
                    "RETIRED",
                  ].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              {["warehouse", "batch", "size", "condition"].map((name) => (
                <label key={name}>
                  {name.charAt(0).toUpperCase() + name.slice(1)}
                  <input
                    name={name}
                    defaultValue={move[name] || ""}
                    maxLength={name === "size" ? 40 : 100}
                  />
                </label>
              ))}
              <label className="wide">
                Reason
                <input name="reason" minLength={5} required />
              </label>
              <button className="primary" disabled={busy}>
                Save movement
              </button>
              <button type="button" onClick={() => setMove(null)}>
                Cancel
              </button>
            </form>
          )}
          {issue && canManage && (
            <form
              className="sales-form compact"
              onSubmit={(e) =>
                save(e, `/field-assets/${issue.id}/issue`, "POST", () =>
                  setIssue(null),
                )
              }
            >
              <h3 className="wide">
                Issue {issue.label} · {issue.quantity} available
              </h3>
              <label>
                Sales agent
                <select name="agent_id" required>
                  <option value="">Choose sales agent</option>
                  {agents.data
                    ?.filter(
                      (a) =>
                        a.employment_status !== "EXITED" &&
                        (a.branch_id === issue.branch_id ||
                          a.branch === issue.branch),
                    )
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Quantity
                <input
                  name="quantity"
                  type="number"
                  min="1"
                  max={issue.quantity}
                  defaultValue="1"
                  required
                />
              </label>
              <label>
                Reason
                <input name="reason" minLength={5} required />
              </label>
              <button className="primary" disabled={busy}>
                Issue stock
              </button>
              <button type="button" onClick={() => setIssue(null)}>
                Cancel
              </button>
            </form>
          )}
          {stock.isPending ? (
            <Loading />
          ) : stock.error ? (
            <ErrorState error={stock.error} retry={stock.refetch} />
          ) : !stock.data?.length ? (
            <p className="sales-empty">
              No field assets recorded yet. SIM stock is managed separately in
              SIM inventory.
            </p>
          ) : (
            <div className="sales-table-wrap">
              <table className="sales-table">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Serial</th>
                    <th>Branch</th>
                    <th>Assigned to</th>
                    <th>Qty</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStock.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <b>{a.label}</b>
                        <small>
                          {categoryOptions[a.category]}
                          {a.size ? ` · ${a.size}` : ""}
                        </small>
                        <small>
                          {[a.warehouse, a.batch, a.condition]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                      </td>
                      <td>{a.serial}</td>
                      <td>{a.branch}</td>
                      <td>{a.agent}</td>
                      <td>{a.quantity}</td>
                      <td>{a.status}</td>
                      <td>
                        {canManage && (
                          <span className="asset-actions">
                            <button onClick={() => setMove(a)}>
                              Move / update
                            </button>
                            {!a.agent_id &&
                              a.status === "AVAILABLE" &&
                              a.serial === "Not recorded" && (
                                <>
                                  <button
                                    onClick={() => setAdjustment(a)}
                                    disabled={busy}
                                  >
                                    Adjust qty
                                  </button>
                                  {a.quantity > 0 && (
                                    <button onClick={() => setIssue(a)}>
                                      Issue stock
                                    </button>
                                  )}
                                </>
                              )}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {tab === "requests" && (
        <section className="panel sales-section">
          <div className="sales-section-head">
            <h2>Asset requests</h2>
            {exportReport("requests")}
          </div>
          {agentId && canRequest && (
            <form
              className="sales-form compact"
              onSubmit={(e) =>
                save(e, "/field-assets/requests", "POST", () => {})
              }
            >
              <input name="agent_id" type="hidden" value={agentId} />
              <label>
                Category
                <select name="category">
                  {Object.entries(categories).map(([k, v]) => (
                    <option value={k} key={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Quantity
                <input
                  name="quantity"
                  type="number"
                  min="1"
                  defaultValue="1"
                  required
                />
              </label>
              <label>
                Urgency
                <select name="urgency">
                  <option value="NORMAL">Normal</option>
                  <option value="URGENT">Urgent</option>
                </select>
              </label>
              <label className="wide">
                Reason
                <input name="reason" required minLength={5} />
              </label>
              <button className="primary" disabled={busy}>
                Request stock
              </button>
            </form>
          )}
          {requests.isPending ? (
            <Loading />
          ) : requests.error ? (
            <ErrorState error={requests.error} retry={requests.refetch} />
          ) : !requests.data?.length ? (
            <p className="sales-empty">No asset requests yet</p>
          ) : (
            <div className="sales-table-wrap">
              <table className="sales-table">
                <thead>
                  <tr>
                    <th>Sales agent</th>
                    <th>Asset</th>
                    <th>Qty</th>
                    <th>Urgency</th>
                    <th>Reason</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {requests.data
                    .filter(
                      (r) =>
                        (!filter.branch_id ||
                          r.branch_id === filter.branch_id) &&
                        (!filter.category || r.category === filter.category) &&
                        (!filter.agent_id || r.agent_id === filter.agent_id),
                    )
                    .map((r) => (
                      <tr key={r.id}>
                        <td>{r.agent}</td>
                        <td>{categories[r.category]}</td>
                        <td>{r.quantity}</td>
                        <td>{r.urgency}</td>
                        <td>
                          {r.reason}
                          {r.response && (
                            <small>
                              {r.responded_by}: {r.response}
                            </small>
                          )}
                        </td>
                        <td>{r.status}</td>
                        <td>
                          {canManage &&
                            r.status !== "FULFILLED" &&
                            r.status !== "REJECTED" && (
                              <span className="asset-actions">
                                {(r.status === "REQUESTED"
                                  ? ["APPROVED", "REJECTED"]
                                  : ["FULFILLED"]
                                ).map((s) => {
                                  const assigned = (stock.data || []).find(
                                    (a) =>
                                      a.category === r.category &&
                                      a.agent_id === r.agent_id &&
                                      a.branch_id === r.branch_id &&
                                      a.status === "ASSIGNED" &&
                                      a.quantity === r.quantity,
                                  );
                                  return (
                                    <button
                                      key={s}
                                      disabled={s === "FULFILLED" && !assigned}
                                      title={
                                        s === "FULFILLED" && !assigned
                                          ? "Assign matching stock to the sales agent first"
                                          : ""
                                      }
                                      onClick={async () => {
                                        const reason = window.prompt(
                                          `${s} reason`,
                                        );
                                        if (!reason || reason.trim().length < 5)
                                          return;
                                        try {
                                          await api(
                                            `/field-assets/requests/${r.id}`,
                                            {
                                              method: "PATCH",
                                              body: JSON.stringify({
                                                status: s,
                                                reason,
                                                asset_id: assigned?.id || "",
                                              }),
                                            },
                                          );
                                          await refresh();
                                        } catch (e: any) {
                                          setError(e.message);
                                        }
                                      }}
                                    >
                                      {s}
                                    </button>
                                  );
                                })}
                              </span>
                            )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {tab === "report" && (
        <section className="panel sales-section">
          <div className="sales-section-head">
            <h2>Balances & shortage alerts</h2>
            {exportReport("summary")}
          </div>
          {canManage && (
            <form
              className="sales-form compact"
              onSubmit={(e) =>
                save(e, "/field-assets/report/threshold", "PUT", () => {})
              }
            >
              <label>
                Branch
                <select name="branch_id" required>
                  <option value="">Select branch</option>
                  {branches.data?.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Category
                <select name="category" required>
                  {Object.entries(categories).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                  {[
                    ...new Set(
                      (summary.data || [])
                        .filter((row) => row.category.startsWith("SIM:"))
                        .map((row) => row.category),
                    ),
                  ].map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Minimum available
                <input
                  name="minimum"
                  type="number"
                  min="0"
                  defaultValue="2"
                  required
                />
              </label>
              <button className="primary" disabled={busy}>
                Set alert level
              </button>
            </form>
          )}
          {summary.isPending ? (
            <Loading />
          ) : summary.error ? (
            <ErrorState error={summary.error} retry={summary.refetch} />
          ) : (
            <div className="sales-table-wrap">
              <table className="sales-table">
                <thead>
                  <tr>
                    <th>Branch</th>
                    <th>Category</th>
                    <th>Available</th>
                    <th>Assigned</th>
                    <th>Reserved</th>
                    <th>Consumed</th>
                    <th>Damaged / lost</th>
                    <th>Returned</th>
                    <th>Minimum</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.data
                    ?.filter(
                      (row) =>
                        (!filter.branch_id ||
                          row.branch_id === filter.branch_id) &&
                        (!filter.category || row.category === filter.category),
                    )
                    .map((row) => (
                      <tr key={`${row.branch_id}-${row.category}`}>
                        <td>{row.branch}</td>
                        <td>
                          {categories[row.category] || row.category}
                          {row.low_stock && (
                            <small className="stock-alert">Low stock</small>
                          )}
                        </td>
                        <td>{row.available}</td>
                        <td>{row.assigned}</td>
                        <td>{row.reserved}</td>
                        <td>{row.consumed}</td>
                        <td>
                          {row.damaged} / {row.lost}
                        </td>
                        <td>{row.returned}</td>
                        <td>{row.minimum || "—"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {tab === "movements" && (
        <section className="panel sales-section">
          <div className="sales-section-head">
            <h2>Stock movements</h2>
            {exportReport("movements")}
          </div>
          {movements.isPending ? (
            <Loading />
          ) : movements.error ? (
            <ErrorState error={movements.error} retry={movements.refetch} />
          ) : !movements.data?.length ? (
            <p className="sales-empty">No movements recorded yet</p>
          ) : (
            <div className="sales-table-wrap">
              <table className="sales-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Branch</th>
                    <th>Item</th>
                    <th>Sales agent</th>
                    <th>Qty change</th>
                    <th>Reason</th>
                    <th>By</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.data.map((row, i) => (
                    <tr key={`${row.at}-${i}`}>
                      <td>{new Date(row.at).toLocaleString()}</td>
                      <td>
                        {row.branch}
                        <small>
                          {row.from_branch !== row.branch
                            ? `From ${row.from_branch}`
                            : ""}
                        </small>
                      </td>
                      <td>
                        {row.item}
                        <small>{row.serial || row.category}</small>
                      </td>
                      <td>{row.agent}</td>
                      <td>{row.quantity_delta}</td>
                      <td>{row.reason}</td>
                      <td>{row.actor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {tab === "checklist" && (
        <section className="panel sales-section">
          <h2>Stock return checklist</h2>
          <div className="sales-form compact">
            <label>
              Sales agent
              <select
                value={checkAgent}
                onChange={(e) =>
                  setSearchParams({ tab: "checklist", agent: e.target.value })
                }
              >
                <option value="">Select sales agent</option>
                {agents.data
                  ?.filter((a) => !branch || a.branch_id === branch)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </label>
            {user.role !== "Field Agent" && (
              <label>
                Or branch
                <select
                  value={checkBranch}
                  onChange={(e) =>
                    setSearchParams({
                      tab: "checklist",
                      branch: e.target.value,
                    })
                  }
                >
                  <option value="">Select branch</option>
                  {branches.data?.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {checkBranch && lifecycle.data && (
            <section className="branch-lifecycle">
              <div className="sales-section-head">
                <h3>Branch departure</h3>
                <span className="status">
                  {lifecycle.data.status.replaceAll("_", " ")}
                </span>
              </div>
              <div className="lifecycle-counts">
                <span>
                  <b>{lifecycle.data.active_agents.length}</b> Active sales
                  agents
                </span>
                <span>
                  <b>{lifecycle.data.stock.length}</b> Stock items
                </span>
                <span>
                  <b>
                    {lifecycle.data.pending_sales +
                      lifecycle.data.pending_evidence}
                  </b>{" "}
                  Pending records
                </span>
                <span>
                  <b>{lifecycle.data.open_requests}</b> Open requests
                </span>
              </div>
              {lifecycle.data.active_agents.length > 0 && (
                <div className="asset-actions">
                  {lifecycle.data.active_agents.map((a: Row) => (
                    <button
                      key={a.id}
                      onClick={() =>
                        setSearchParams({ tab: "checklist", agent: a.id })
                      }
                    >
                      {agents.data?.find((agent) => agent.id === a.id)?.name ||
                        a.name}{" "}
                      · Transfer / exit
                    </button>
                  ))}
                </div>
              )}
              {canManageStaff &&
                !["CLOSED", "RELOCATED"].includes(lifecycle.data.status) && (
                  <form
                    className="sales-form compact"
                    onSubmit={(e) =>
                      save(e, `/branch-lifecycle/${checkBranch}`, "POST", () =>
                        notify("Branch operation updated"),
                      )
                    }
                  >
                    <label>
                      Operation
                      <select name="action">
                        {lifecycle.data.status === "ACTIVE" ? (
                          <>
                            <option value="START_CLOSURE">Start closure</option>
                            <option value="START_RELOCATION">
                              Start relocation
                            </option>
                          </>
                        ) : (
                          <>
                            {lifecycle.data.ready && (
                              <option value="COMPLETE">
                                Complete operation
                              </option>
                            )}
                            <option value="CANCEL">Cancel operation</option>
                          </>
                        )}
                      </select>
                    </label>
                    {lifecycle.data.status === "ACTIVE" && (
                      <label>
                        Relocation destination
                        <select name="destination_branch_id">
                          <option value="">For relocation only</option>
                          {branches.data
                            ?.filter(
                              (b) =>
                                b.id !== checkBranch &&
                                b.lifecycle_status === "ACTIVE",
                            )
                            .map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.name}
                              </option>
                            ))}
                        </select>
                      </label>
                    )}
                    <label>
                      Reason
                      <input
                        name="reason"
                        minLength={5}
                        maxLength={300}
                        required
                      />
                    </label>
                    <button className="primary" disabled={busy}>
                      Update branch
                    </button>
                  </form>
                )}
              {lifecycle.data.status !== "ACTIVE" && !lifecycle.data.ready && (
                <p className="stock-alert">
                  Transfer or exit sales agents, account for stock, and resolve
                  pending records before completion.
                </p>
              )}
            </section>
          )}
          {checklist.isFetching ? (
            <Loading />
          ) : checklist.error ? (
            <ErrorState error={checklist.error} retry={checklist.refetch} />
          ) : (
            checklist.data && (
              <>
                <p
                  className={
                    checklist.data.clear ? "stock-clear" : "stock-alert"
                  }
                >
                  {checklist.data.next_action} ·{" "}
                  {checklist.data.outstanding.length} items
                </p>
                {canManageStaff && checkAgent && (
                  <form
                    className="sales-form compact"
                    onSubmit={(e) =>
                      save(
                        e,
                        `/field-assets/agents/${checkAgent}/transfer`,
                        "POST",
                        () => {
                          client.invalidateQueries({ queryKey: ["agents"] });
                          notify(
                            "Sales agent transferred. Sign in again to load the new branch.",
                          );
                        },
                      )
                    }
                  >
                    <label>
                      Destination branch
                      <select
                        name="branch_id"
                        required
                        value={transferBranch}
                        onChange={(event) =>
                          setTransferBranch(event.target.value)
                        }
                      >
                        <option value="">Select destination</option>
                        {branches.data?.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Reporting team leader
                      <select
                        key={transferBranch}
                        name="leader_id"
                        required={transferLeaders.length > 1}
                        defaultValue={
                          transferLeaders.length === 1
                            ? transferLeaders[0].id
                            : ""
                        }
                      >
                        <option value="">Select team leader</option>
                        {transferLeaders.map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Assigned stock
                      <select name="stock_action">
                        <option value="RETURN">
                          Return to original branch
                        </option>
                        <option value="TRANSFER">
                          Transfer with sales agent
                        </option>
                      </select>
                    </label>
                    <label>
                      Reason
                      <input name="reason" minLength={5} required />
                    </label>
                    <button className="primary" disabled={busy}>
                      Transfer sales agent
                    </button>
                    {user.role === "Administrator" && (
                      <button
                        type="button"
                        disabled={busy || !checklist.data.clear}
                        onClick={async () => {
                          const reason = window.prompt(
                            "Reason for closing sales agent access",
                          );
                          if (!reason || reason.trim().length < 5) return;
                          setBusy(true);
                          try {
                            await post(
                              `/field-assets/agents/${checkAgent}/exit`,
                              { reason },
                            );
                            await refresh();
                            notify(
                              "Sales agent access closed; history retained",
                            );
                          } catch (e: any) {
                            setError(e.message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Close sales agent access
                      </button>
                    )}
                  </form>
                )}
                <div className="sales-table-wrap stock-checklist-table">
                  <table className="sales-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Serial</th>
                        <th>Qty</th>
                        <th>Branch</th>
                        <th>Sales agent</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {checklist.data.outstanding.map((row: Row) => (
                        <tr key={row.id}>
                          <td>{row.label}</td>
                          <td>{row.serial || "Not recorded"}</td>
                          <td>{row.quantity}</td>
                          <td>{row.branch}</td>
                          <td>{row.agent}</td>
                          <td>{row.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )
          )}
        </section>
      )}
    </div>
  );
}
