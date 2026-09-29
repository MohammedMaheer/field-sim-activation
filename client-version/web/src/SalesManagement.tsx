import { useContext, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileDown, Plus, RefreshCw, Upload, PhoneCall } from "lucide-react";
import { Context } from "./App";
import { api, download, post, Row } from "./api";
import { ErrorState, Loading } from "./components";
import "./sales-management.css";

type Tab = "sales" | "feedback" | "targets" | "calls" | "import";
const orderTypes = ["NEW", "MNP", "P2P", "HW", "ELIFE", "WASEL", "VISITOR"];
const labels: Record<string, string> = { NEW: "New", MNP: "Number transfer", P2P: "Prepaid to postpaid", HW: "Home wireless", ELIFE: "eLife", WASEL: "Wasel", VISITOR: "Visitor" };
const month = new Date().toISOString().slice(0, 7);

export default function SalesManagement() {
  const { user, notify } = useContext(Context);
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("sales");
  const [period, setPeriod] = useState(month);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [importData, setImportData] = useState<{filename: string; content_base64: string} | null>(null);
  const [preview, setPreview] = useState<Row | null>(null);
  const [newSale, setNewSale] = useState(false);
  const [newFeedback, setNewFeedback] = useState(false);
  const [correctingSale, setCorrectingSale] = useState<Row | null>(null);
  const [selectedCall, setSelectedCall] = useState<Row | null>(null);
  const agents = useQuery<Row[]>({ queryKey: ["agents"], queryFn: () => api("/resources/agents") });
  const sales = useQuery<Row[]>({ queryKey: ["sales-management", "sales"], queryFn: () => api("/sales-management/sales") });
  const feedback = useQuery<Row[]>({ queryKey: ["sales-management", "feedback"], queryFn: () => api("/sales-management/feedback"), enabled: tab === "feedback" });
  const targets = useQuery<Row[]>({ queryKey: ["sales-management", "targets", period], queryFn: () => api(`/sales-management/targets?period=${period}`), enabled: tab === "targets" });
  const calls = useQuery<Row[]>({ queryKey: ["sales-management", "calls"], queryFn: () => api("/sales-management/calls"), enabled: tab === "calls" });
  const performance = useQuery<Row>({ queryKey: ["sales-management", "performance", period], queryFn: () => api(`/sales-management/performance?period=${period}`) });
  const canManage = ["Administrator", "Operations Manager"].includes(user.role);
  const canSetTargets = canManage || user.role === "Team Leader";
  const canCall = user.permissions?.includes("compliance.write");
  const agentOptions = agents.data || [];

  async function refresh() { await queryClient.invalidateQueries({ queryKey: ["sales-management"] }); }
  async function submitForm(event: React.FormEvent<HTMLFormElement>, endpoint: string, done: () => void, method: "POST" | "PUT" = "POST") {
    event.preventDefault(); setError(""); setBusy(true);
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());
    try { if (method === "PUT") await api(endpoint, {method,body:JSON.stringify(body)}); else await post(endpoint, body); await refresh(); done(); notify("Saved successfully"); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function pickFile(file?: File) {
    if (!file) return;
    if (file.size > 2_000_000) { setError("Choose a CSV or Excel file under 2 MB"); return; }
    setError(""); setPreview(null);
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    setImportData({ filename: file.name, content_base64: btoa(binary) });
  }
  async function processFile(apply: boolean) {
    if (!importData) return;
    setBusy(true); setError("");
    try {
      const result = await post("/sales-management/status-file", { ...importData, apply });
      setPreview(result);
      if (apply) { await refresh(); notify("Sales statuses updated"); }
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function correctSale(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!correctingSale) return;
    setBusy(true); setError("");
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      await api(`/sales-management/sales/${correctingSale.id}`, { method: "PATCH", body: JSON.stringify(body) });
      setCorrectingSale(null);
      await refresh();
      notify("Sale corrected");
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <div className="sales-page">
    <header className="page-header"><div><span className="eyebrow">FIELD PERFORMANCE</span><h1>Sales management</h1><p>Sales, follow-ups and targets in one place</p></div><button onClick={refresh}><RefreshCw size={16}/> Refresh</button></header>
    <div className="sales-toolbar"><label>Period <input type="month" value={period} onChange={e => setPeriod(e.target.value)} /></label><button onClick={() => download("/sales-management/export", "sales-records.csv")}><FileDown size={16}/> Export sales</button></div>
    {performance.data && <section className="sales-metrics" aria-label="Sales summary">
      <article><span>Recorded</span><strong>{performance.data.recorded}</strong></article><article><span>Closed</span><strong>{performance.data.closed}</strong></article><article><span>In progress</span><strong>{performance.data.in_progress}</strong></article><article><span>Monthly target</span><strong>{performance.data.monthly_target}</strong></article><article><span>Remaining</span><strong>{performance.data.remaining}</strong></article>
    </section>}
    {performance.data && Object.keys(performance.data.by_product || {}).length > 0 && <section className="panel sales-product-chart" aria-label="Closed sales by product"><h2>Closed sales by product</h2><div>{Object.entries(performance.data.by_product as Record<string,number>).map(([name,count]) => <div className="sales-product-row" key={name}><span>{labels[name] || name}</span><div className="sales-product-track"><i style={{width:`${Math.max(5, count / performance.data.closed * 100)}%`}}/></div><b>{count}</b></div>)}</div></section>}
    <nav className="sales-tabs" aria-label="Sales sections">{(["sales", "feedback", "targets", "calls", ...(canManage ? ["import"] : [])] as Tab[]).map(item => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{({sales:"Sales",feedback:"No-sale feedback",targets:"Targets",calls:"Call follow-ups",import:"Status import"} as Record<Tab,string>)[item]}</button>)}</nav>
    {error && <div className="sales-error" role="alert">{error}</div>}
    {tab === "sales" && <section className="panel sales-section"><div className="sales-section-head"><h2>Sales register</h2><button className="primary" onClick={() => setNewSale(!newSale)}><Plus size={16}/> Record sale</button></div>
      {newSale && <form className="sales-form" onSubmit={e => submitForm(e,"/sales-management/sales",() => setNewSale(false))}>
        <label>Agent<select name="agent_id" required defaultValue={user.agent_id || ""}>{!user.agent_id && <option value="">Select agent</option>}{agentOptions.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label>Order type<select name="order_type" required>{orderTypes.map(t => <option key={t} value={t}>{labels[t]}</option>)}</select></label>
        <label>Customer name<input name="customer_name" required /></label><label>Document number<input name="document_number" /></label><label>Nationality<input name="nationality" /></label><label>Plan or product<input name="plan_name" required /></label>
        <label>Request ID<input name="request_id" /></label><label>Account number<input name="account_number" /></label><label>SIM serial<input name="sim_serial" /></label><label>Router serial<input name="router_serial" /></label><label>SR number<input name="sr_number" /></label><label>Alternate number<input name="alternate_number" /></label><label>MSISDN<input name="msisdn" /></label><label>Advance transaction number<input name="advance_transaction_number" /></label><label className="wide">Note<input name="note" /></label><button className="primary" disabled={busy}>Save sale</button>
      </form>}
      {correctingSale && canManage && <form className="sales-form compact" onSubmit={correctSale} aria-label="Correct sale"><h3 className="wide">Correct {correctingSale.customer_name}</h3><label>Order type<select name="order_type" defaultValue={correctingSale.order_type}>{orderTypes.map(t => <option key={t} value={t}>{labels[t]}</option>)}</select></label><label>Router serial<input name="router_serial" defaultValue={correctingSale.router_serial || ""} /></label><label className="wide">Reason for correction<input name="reason" minLength={5} maxLength={300} required /></label><button className="primary" disabled={busy}>Save correction</button><button type="button" onClick={() => setCorrectingSale(null)}>Cancel</button></form>}
      {sales.isPending ? <Loading/> : sales.error ? <ErrorState error={sales.error} retry={sales.refetch}/> : !sales.data?.length ? <p className="sales-empty">No sales recorded yet</p> : <div className="sales-table-wrap"><table className="sales-table"><thead><tr><th>Customer</th><th>Product</th><th>Agent / branch</th><th>Request ID</th><th>Status</th><th>Recorded</th>{canManage && <th>Action</th>}</tr></thead><tbody>{sales.data.map(row => <tr key={row.id}><td><b>{row.customer_name}</b><small>{row.document}</small></td><td>{labels[row.order_type] || row.order_type}<small>{row.plan_name}</small></td><td>{row.agent}<small>{row.branch}</small></td><td>{row.request_id}</td><td><span className={`sales-status ${row.status.toLowerCase()}`}>{row.status.replace("_"," ")}</span></td><td>{new Date(row.created_at).toLocaleDateString()}</td>{canManage && <td><button onClick={() => { setCorrectingSale(row); setError(""); }}>Correct</button></td>}</tr>)}</tbody></table></div>}
    </section>}
    {tab === "feedback" && <section className="panel sales-section"><div className="sales-section-head"><h2>No-sale feedback</h2><button className="primary" onClick={() => setNewFeedback(!newFeedback)}><Plus size={16}/> Add feedback</button></div>
      {newFeedback && <form className="sales-form" onSubmit={e => submitForm(e,"/sales-management/feedback",() => setNewFeedback(false))}><label>Agent<select name="agent_id" required defaultValue={user.agent_id || ""}>{!user.agent_id && <option value="">Select agent</option>}{agentOptions.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label>Customer<input name="customer_name" /></label><label>Contact<input name="contact_number" /></label><label>Product suggested<input name="product_suggested" required /></label><label>Rejection reason<input name="rejection_reason" required /></label><label className="wide">Customer feedback<textarea name="feedback" required /></label><button className="primary" disabled={busy}>Save feedback</button></form>}
      {feedback.isPending ? <Loading/> : feedback.error ? <ErrorState error={feedback.error} retry={feedback.refetch}/> : !feedback.data?.length ? <p className="sales-empty">No feedback recorded yet</p> : <div className="sales-table-wrap"><table className="sales-table"><thead><tr><th>Customer</th><th>Product</th><th>Reason</th><th>Feedback</th><th>Agent</th></tr></thead><tbody>{feedback.data.map(row => <tr key={row.id}><td>{row.customer_name || "Not recorded"}<small>{row.contact}</small></td><td>{row.product_suggested}</td><td>{row.rejection_reason}</td><td>{row.feedback}</td><td>{row.agent}</td></tr>)}</tbody></table></div>}
    </section>}
    {tab === "targets" && <section className="panel sales-section"><div className="sales-section-head"><h2>Targets · {period}</h2></div>
      {canSetTargets && <form className="sales-form compact" onSubmit={e => submitForm(e,"/sales-management/targets",()=>{},"PUT")}><label>Agent<select name="agent_id" required defaultValue=""><option value="">Select agent</option>{agentOptions.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><input type="hidden" name="period" value={period}/><label>Product<select name="order_type"><option value="ALL">All products</option>{orderTypes.map(t => <option key={t} value={t}>{labels[t]}</option>)}</select></label><label>Daily target<input type="number" name="daily_target" min="0" defaultValue="0" required /></label><label>Monthly target<input type="number" name="monthly_target" min="0" defaultValue="0" required /></label><button className="primary" disabled={busy}>Set target</button></form>}
      {targets.isPending ? <Loading/> : targets.error ? <ErrorState error={targets.error} retry={targets.refetch}/> : !targets.data?.length ? <p className="sales-empty">No targets for this period</p> : <div className="sales-table-wrap"><table className="sales-table"><thead><tr><th>Agent</th><th>Product</th><th>Daily</th><th>Monthly</th></tr></thead><tbody>{targets.data.map(row => <tr key={row.id}><td>{row.agent}</td><td>{labels[row.order_type] || row.order_type}</td><td>{row.daily_target}</td><td>{row.monthly_target}</td></tr>)}</tbody></table></div>}
    </section>}
    {tab === "calls" && <section className="panel sales-section"><div className="sales-section-head"><h2>Tele-verification & welcome calls</h2></div>
      {selectedCall && <form className="sales-form compact" onSubmit={e => submitForm(e,`/sales-management/sales/${selectedCall.id}/calls`,() => setSelectedCall(null))}><h3 className="wide">{selectedCall.customer_name}</h3><label>Call stage<select name="stage"><option value="TELE_VERIFICATION">Tele-verification</option><option value="WELCOME_CALL">Welcome call</option></select></label><label>Outcome<select name="outcome">{["REACHED","NO_ANSWER","RETRY","PASSED","FAILED"].map(v => <option key={v}>{v}</option>)}</select></label><label className="wide">Remark<textarea name="remark" required minLength={3}/></label><button className="primary" disabled={busy}>Save attempt</button><button type="button" onClick={() => setSelectedCall(null)}>Cancel</button></form>}
      {calls.isPending ? <Loading/> : calls.error ? <ErrorState error={calls.error} retry={calls.refetch}/> : !calls.data?.length ? <p className="sales-empty">No sales awaiting follow-up</p> : <div className="sales-table-wrap"><table className="sales-table"><thead><tr><th>Customer</th><th>Product</th><th>Tele-verification</th><th>Welcome call</th><th></th></tr></thead><tbody>{calls.data.map(row => <tr key={row.id}><td>{row.customer_name}<small>{row.request_id}</small></td><td>{row.plan_name}</td><td>{row.tele_verification?.at(-1)?.outcome || "Not started"}</td><td>{row.welcome_call?.at(-1)?.outcome || "Not started"}</td><td>{canCall && <button onClick={() => setSelectedCall(row)}><PhoneCall size={15}/> Record call</button>}</td></tr>)}</tbody></table></div>}
    </section>}
    {tab === "import" && canManage && <section className="panel sales-section sales-import"><h2>Update sale statuses</h2><p>Export the sales file, edit the <b>new_status</b> column, then upload it for review. Accepted values: IN_PROGRESS, CLOSED, CANCELLED.</p><label className="file-input">CSV or Excel file<input type="file" accept=".csv,.xlsx" onChange={e => pickFile(e.target.files?.[0])}/></label>{importData && <div className="sales-import-actions"><span>{importData.filename}</span><button onClick={() => processFile(false)} disabled={busy}><Upload size={15}/> Preview changes</button>{preview && !preview.errors.length && <button className="primary" onClick={() => processFile(true)} disabled={busy}>Apply {preview.changes.length} changes</button>}</div>}{preview && <div className="sales-preview"><b>{preview.changes.length} changes · {preview.errors.length} errors</b>{preview.errors.map((item: string, i: number) => <p key={i} role="alert">{item}</p>)}{preview.changes.slice(0, 25).map((item: Row) => <p key={item.sale_id}>{item.sale_id.slice(0,8)} · {item.from} → {item.to}</p>)}</div>}</section>}
  </div>;
}
