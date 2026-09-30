import IntakeCamera from "./IntakeCamera";
import { useContext, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, Pencil, Trash2, Settings2 } from "lucide-react";
import { api, Row } from "./api";
import { Context } from "./App";
import { DataTable, Drawer, ErrorState, Loading } from "./components";
import RecordOverview from "./RecordOverview";

const sections: Record<string, string> = {
  branches: "Branches",
  agents: "Agents",
  customers: "Customers",
  inventory: "SIM stock",
  incentives: "Incentives",
};
const fields: Record<string, string[]> = {
  agents: ["name", "email", "employee_id", "target"],
  branches: ["name"],
  customers: ["name", "arabic_name", "mobile", "nationality", "agent_id"],
  inventory: ["iccid", "serial", "sim_type", "outlet_id", "agent_id"],
  incentives: ["period", "amount", "note", "agent_id"],
};
const labels: Record<string, string> = {
  name: "Name",
  title: "Title",
  note: "Note",
  area: "Area",
  nationality: "Nationality",
  target: "Daily target",
  employee_id: "Employee ID",
  branch_id: "Branch",
  outlet_id: "Branch",
  agent_id: "Agent",
  sim_type: "SIM type",
  iccid: "ICCID",
  serial: "SIM serial",
  arabic_name: "Arabic name",
  mobile: "Phone number",
  due_date: "Due date",
  email: "Sign-in email",
  amount: "Amount (AED)",
  period: "Month",
};
export default function Administration() {
  const { user, notify } = useContext(Context),
    cache = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = searchParams.get("section") || "branches";
  const kind = Object.hasOwn(sections, requestedSection) ? requestedSection : "branches";
  const setKind = (section: string) => setSearchParams({ section });
  const [editing, setEditing] = useState<Row | null>(null),
    [removing, setRemoving] = useState<Row | null>(null),
    [packScanner, setPackScanner] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const allowed = user.role === "Administrator";
  const q = useQuery<Row[]>({
    queryKey: ["administration", kind],
    queryFn: () => api(`/administration/${kind}`),
    enabled: allowed,
  });
  const dir = useQuery<Row>({
    queryKey: ["organization"],
    queryFn: () => api("/organization"),
    enabled: allowed,
  });
  const agents = useQuery<Row[]>({
    queryKey: ["agents"],
    queryFn: () => api("/resources/agents"),
    enabled: allowed,
  });
  const label = (row: Row) =>
    row.name || row.title || row.iccid || `${row.period} · AED ${row.amount}`;
  const start = (row: Row) => {
    setError("");
    setEditing(row);
  };
  const options = (key: string) =>
    key === "branch_id"
      ? dir.data?.branches
      : key === "outlet_id"
        ? dir.data?.branches?.map((branch: Row) => ({
            id: dir.data?.outlets?.find((outlet: Row) => outlet.branch_id === branch.id)?.id,
            name: branch.name,
          })).filter((branch: Row) => branch.id)
        : key === "agent_id"
          ? agents.data
          : null;
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(e.currentTarget));
    const reason = values.reason;
    delete values.reason;
    const expected = Object.fromEntries(
      Object.keys(values).map((k) => [k, editing?.[k] ?? ""]),
    );
    try {
      await api(
        `/administration/${kind}${editing?.id ? `/${editing.id}` : ""}`,
        {
          method: editing?.id ? "PATCH" : "POST",
          body: JSON.stringify({ values, expected, reason }),
        },
      );
      await cache.invalidateQueries();
      notify("Changes saved");
      setEditing(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!allowed)
    return <section className="panel">Administrator access required.</section>;
  return (
    <>
      <header className="page-header">
        <div>
          <span className="eyebrow">ADMINISTRATION</span>
          <h1>Manage workspace</h1>
        </div>
        <Link className="button" to="/kyc-capture">
          Backend verification
        </Link>
      </header>
      <div className="admin-groups">
        {[
          {
            title: "Field network",
            items: ["branches", "agents"],
          },
          { title: "Customer & stock", items: ["customers", "inventory"] },
          { title: "Sales", items: ["incentives"] },
        ].map((group) => (
          <section key={group.title}>
            <h2>{group.title}</h2>
            <div
              className="admin-sections"
              role="group"
              aria-label={group.title}
            >
              {group.items.map((id) => (
                <button
                  key={id}
                  aria-pressed={id === kind}
                  onClick={() => setKind(id)}
                >
                  {sections[id]}
                </button>
              ))}
            </div>
          </section>
        ))}
        <Link className="button" to="/plans">
          Subscriber plans →
        </Link>
      </div>
      {!q.isPending && !q.error && !(["branches","incentives"].includes(kind) && (agents.isPending || agents.error)) && <RecordOverview rows={(q.data || []).map((row:Row) => kind === "branches" ? {...row,agents:(agents.data || []).filter(agent => agent.branch_id === row.id).length} : kind === "incentives" ? {...row,name:(agents.data || []).find(agent => agent.id === row.agent_id)?.name || "Not recorded"} : row)} field={kind === "branches" ? "agents" : kind === "agents" ? "target" : kind === "customers" ? "nationality" : kind === "incentives" ? "amount" : "status"} numeric={["branches","agents","incentives"].includes(kind)} title={kind === "branches" ? "Agents by branch" : kind === "agents" ? "Daily targets" : kind === "incentives" ? "Recorded incentives (AED)" : "Record breakdown"} />}
      <section className="panel">
        <div className="admin-toolbar">
          <h2>{sections[kind]}</h2>
          {["branches", "agents"].includes(kind) ? (
            <Link className="button primary" to={"/" + kind}>Manage {sections[kind].toLowerCase()}</Link>
          ) : (
            <button className="primary" onClick={() => start({})}>
              <Plus size={17} /> Add {kind === "inventory" ? "SIM" : sections[kind].replace(/s$/, "").toLowerCase()}
            </button>
          )}
        </div>
        {q.isPending ? (
          <Loading />
        ) : q.error ? (
          <ErrorState error={q.error} retry={q.refetch} />
        ) : (
          <DataTable
            rows={q.data}
            columns={[
              {
                key: "name",
                label: "Record",
                render: (r) => <strong>{label(r)}</strong>,
              },
              {
                key: "context",
                label:
                  kind === "agents"
                    ? "Employee / daily target"
                    : kind === "branches"
                      ? "Created"
                      : kind === "inventory"
                        ? "SIM type / status"
                        : kind === "customers"
                          ? "Phone number"
                          : "Assignment",
                render: (r) =>
                  kind === "agents"
                    ? `${r.employee_id} · ${r.target} / day`
                    : kind === "inventory"
                      ? `${r.sim_type} · ${r.status}`
                      : kind === "customers"
                        ? r.mobile
                        : kind === "branches"
                          ? r.created_at
                            ? new Date(r.created_at).toLocaleDateString()
                            : "Not recorded"
                          : dir.data?.branches?.find(
                              (b: Row) => b.id === r.branch_id,
                            )?.name ||
                            agents.data?.find((a: Row) => a.id === r.agent_id)
                              ?.name ||
                            "Not recorded",
              },
              {
                key: "action",
                label: "Actions",
                render: (r) => (
                  <div className="admin-row-actions">
                    {kind === "agents" && (
                      <button onClick={() => start(r)}>
                        <Pencil size={16} /> Edit profile
                      </button>
                    )}
                    {["agents", "inventory"].includes(kind) ? (
                      <Link to={`/${kind}?selected=${r.id}`}>
                        <Settings2 size={16} /> Manage
                      </Link>
                    ) : (
                      <button onClick={() => start(r)}>
                        <Pencil size={16} /> Edit
                      </button>
                    )}
                    {!["tasks", "incentives", "inventory"].includes(kind) && (
                      <button
                        aria-label={`Delete ${label(r)}`}
                        onClick={() => {
                          setRemoving(r);
                          setError("");
                        }}
                      >
                        <Trash2 size={16} /> Delete
                      </button>
                    )}
                  </div>
                ),
              },
            ]}
          />
        )}
      </section>
      {editing && (
        <Drawer
          title={`${editing.id ? "Edit" : "Add"} ${kind === "inventory" ? "SIM" : kind === "branches" ? "branch" : sections[kind].replace(/s$/, "").toLowerCase()}`}
          onClose={() => !busy && setEditing(null)}
        >
          {kind === "inventory" && <div className="intake-choice"><button onClick={() => setPackScanner(true)}><Plus size={18}/> Scan SIM pack</button></div>}
          {packScanner && <IntakeCamera barcode onPhoto={() => {}} onClose={() => setPackScanner(false)} onCode={async code => {
            try { const values = await api('/inventory/parse-pack', {method:'POST',body:JSON.stringify({code})}); setEditing({...editing,...values}); setError(''); } catch(e:any) { setError(e.message); }
          }}/ >}
          <form key={editing.iccid || "new-sim"} className="plan-editor" onSubmit={save}>
            {(fields[kind] || []).map((key) => (
              <label
                key={key}
                className={
                  key === "note" || fields[kind]?.length === 1
                    ? "plan-editor-wide"
                    : ""
                }
              >
                {labels[key] || key.replaceAll("_", " ")}
                {options(key) ? (
                  <select
                    name={key}
                    required={key !== "agent_id" || kind !== "inventory"}
                    defaultValue={editing[key] || ""}
                  >
                    <option value="">Select {labels[key]}</option>
                    {options(key)?.map((r: Row) => (
                      <option key={r.id} value={r.id}>
                        {r.name || r.agent}
                      </option>
                    ))}
                  </select>
                ) : key === "sim_type" ? (
                  <select name={key} defaultValue={editing[key] || "Physical"}>
                    <option>Physical</option>
                    <option>eSIM</option>
                  </select>
                ) : (
                  <input
                    name={key}
                    type={
                      key === "due_date"
                        ? "date"
                        : key === "period"
                          ? "month"
                          : ["amount", "target"].includes(key)
                            ? "number"
                            : key === "email"
                              ? "email"
                              : "text"
                    }
                    step={key === "amount" ? "0.01" : undefined}
                    min={key === "amount" ? "0.01" : undefined}
                    maxLength={key === "note" ? 500 : 180}
                    required={
                      !["note", "area", "arabic_name", "nationality"].includes(
                        key,
                      )
                    }
                    defaultValue={editing[key] ?? ""}
                  />
                )}
              </label>
            ))}
            <label className="plan-editor-wide">
              Reason for change
              <input name="reason" required minLength={5} maxLength={300} />
            </label>
            {error && (
              <p className="plan-editor-wide" role="alert">
                {error}
              </p>
            )}
            <button className="primary plan-editor-wide" disabled={busy}>
              {busy ? "Saving…" : "Save changes"}
            </button>
          </form>
        </Drawer>
      )}
      {removing && (
        <Drawer
          title="Delete record"
          onClose={() => !busy && setRemoving(null)}
        >
          <h2>{label(removing)}</h2>
          <p>Linked records and history are protected.</p>
          <form
            className="plan-editor"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const reason = new FormData(e.currentTarget).get("reason");
              try {
                await api(`/administration/${kind}/${removing.id}`, {
                  method: "DELETE",
                  body: JSON.stringify({
                    values: {},
                    expected: removing,
                    reason,
                  }),
                });
                await cache.invalidateQueries();
                setRemoving(null);
                notify("Record deleted");
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="plan-editor-wide">
              Reason for deletion
              <input name="reason" required minLength={5} maxLength={300} />
            </label>
            {error && (
              <p className="plan-editor-wide" role="alert">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy ? "Deleting…" : "Delete record"}
            </button>
          </form>
        </Drawer>
      )}
    </>
  );
}
