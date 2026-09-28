import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Check, CircleDollarSign, Layers3, Plus, RotateCcw, Tag, X } from "lucide-react";
import { api, patch, post, Row } from "./api";
import { Badge, Drawer, ErrorState, Loading } from "./components";
import { useContext } from "react";
import { Context } from "./App";

const blank = {
  name: "",
  monthly_cost: 0,
  data_gb: 0,
  active: true,
  speed: "5G",
  roaming: "Included",
  contract: "As selected in Etisalat",
  promotion: "",
  advance: 0,
  vat: 5,
};

export default function PlanManagement() {
  const { user, notify } = useContext(Context);
  const cache = useQueryClient();
  const [editing, setEditing] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const plans = useQuery({
    queryKey: ["admin-plans"],
    queryFn: () => api("/admin/plans"),
    enabled: user.permissions?.includes("settings.write") === true,
  });

  if (!user.permissions?.includes("settings.write")) {
    return <section className="panel plans-no-access">Plan management is available to administrators.</section>;
  }

  async function refresh() {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["admin-plans"] }),
      cache.invalidateQueries({ queryKey: ["plans"] }),
    ]);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const data = new FormData(event.currentTarget);
    const body = {
      name: String(data.get("name") || "").trim(),
      monthly_cost: Number(data.get("monthly_cost")),
      data_gb: Number(data.get("data_gb")),
      active: data.get("active") === "on",
      speed: String(data.get("speed") || ""),
      roaming: String(data.get("roaming") || ""),
      contract: String(data.get("contract") || ""),
      promotion: String(data.get("promotion") || ""),
      advance: Number(data.get("advance") || 0),
      vat: Number(data.get("vat") || 0),
    };
    setBusy(true);
    setError("");
    try {
      if (editing.id) await patch(`/plans/${editing.id}`, body);
      else await post("/plans", body);
      await refresh();
      setEditing(null);
      notify(editing.id ? "Plan updated. It is available in the field app." : "Plan added to the field app.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function changeAvailability(plan: Row, active: boolean) {
    if (!active && !window.confirm(`Remove ${plan.name} from new transactions? Existing transaction history will be kept.`)) return;
    setBusy(true);
    try {
      await patch(`/plans/${plan.id}`, { ...plan, active });
      await refresh();
      notify(active ? "Plan restored to the field app." : "Plan removed from new transactions.");
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-header plan-page-header">
        <div>
          <div className="eyebrow">CATALOG</div>
          <h1>Subscriber plans</h1>
          <p>Manage the plans available in the field app.</p>
        </div>
        <button className="primary" onClick={() => { setError(""); setEditing({ ...blank }); }}>
          <Plus size={17} /> Add plan
        </button>
      </div>
      {plans.isPending ? <Loading /> : plans.error ? <ErrorState error={plans.error} retry={plans.refetch} /> : (
        <>
          <div className="plan-summary-row">
            <span><Layers3 size={18} /> {plans.data.filter((p: Row) => p.active).length} available</span>
            <span><Archive size={18} /> {plans.data.filter((p: Row) => !p.active).length} removed</span>
          </div>
          <section className="plan-management-grid" aria-label="Subscriber plans">
            {plans.data.map((plan: Row) => (
              <article className={`panel managed-plan ${plan.active ? "" : "inactive"}`} key={plan.id}>
                <div className="managed-plan-top">
                  <span className="managed-plan-icon"><Tag size={19} /></span>
                  <Badge value={plan.active ? "AVAILABLE" : "REMOVED"} />
                </div>
                <h2>{plan.name}</h2>
                <strong className="managed-plan-price"><CircleDollarSign size={19} /> AED {Number(plan.monthly_cost).toLocaleString()}<small>{plan.name === "Tourist Prepaid" ? "" : "/ month"}</small></strong>
                {plan.promotion && <p>{plan.promotion}</p>}
                <div className="managed-plan-meta">
                  <span>{plan.data_gb ? `${plan.data_gb} GB` : plan.name.includes("Unlimited") ? "Unlimited data" : "Configured data"}</span>
                  <span>{plan.speed}</span>
                  <span>VAT {plan.vat}%</span>
                </div>
                <div className="managed-plan-actions">
                  <button onClick={() => { setError(""); setEditing({ ...plan }); }} disabled={busy}>Edit plan</button>
                  {plan.active ? (
                    <button className="plan-remove" onClick={() => changeAvailability(plan, false)} disabled={busy}><Archive size={15} /> Remove</button>
                  ) : (
                    <button className="plan-restore" onClick={() => changeAvailability(plan, true)} disabled={busy}><RotateCcw size={15} /> Restore</button>
                  )}
                </div>
              </article>
            ))}
          </section>
          {plans.data.length === 0 && <p className="plans-empty">No plans yet. Add the first plan to make it available in the field app.</p>}
        </>
      )}
      {editing && (
        <Drawer title={editing.id ? "Edit subscriber plan" : "Add subscriber plan"} onClose={() => !busy && setEditing(null)}>
          <form className="plan-editor" onSubmit={save}>
            <label className="plan-editor-wide">Plan name<input name="name" required minLength={3} maxLength={120} defaultValue={editing.name} /></label>
            <label>Price (AED)<input name="monthly_cost" type="number" min="0" max="100000" step="0.01" required defaultValue={editing.monthly_cost} /></label>
            <label>Data allowance (GB)<input name="data_gb" type="number" min="0" max="100000" step="1" required defaultValue={editing.data_gb} /></label>
            <label>Speed<input name="speed" maxLength={50} defaultValue={editing.speed} /></label>
            <label>Roaming<input name="roaming" maxLength={60} defaultValue={editing.roaming} /></label>
            <label>Contract<input name="contract" maxLength={60} defaultValue={editing.contract} /></label>
            <label>Advance payment (AED)<input name="advance" type="number" min="0" max="100000" step="0.01" defaultValue={editing.advance} /></label>
            <label>VAT (%)<input name="vat" type="number" min="0" max="100" step="0.01" defaultValue={editing.vat} /></label>
            <label className="plan-editor-wide">Plan details<input name="promotion" maxLength={120} defaultValue={editing.promotion} /></label>
            <label className="plan-active-toggle plan-editor-wide"><input name="active" type="checkbox" defaultChecked={editing.active} /> Available for new transactions</label>
            {error && <p role="alert" className="plan-editor-wide">{error}</p>}
            <div className="plan-editor-actions plan-editor-wide">
              <button type="button" onClick={() => setEditing(null)} disabled={busy}><X size={16} /> Cancel</button>
              <button className="primary" disabled={busy}><Check size={16} /> {busy ? "Saving…" : "Save plan"}</button>
            </div>
          </form>
        </Drawer>
      )}
    </>
  );
}
