import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Download, FileUp, Plus, RefreshCw } from "lucide-react";
import { api, post, patch, download, Row } from "./api";
import { Badge, DataTable, Empty, ErrorState, Loading, Panel } from "./components";

type Props = { user: Row; notify: (message: string) => void };
const today = () => new Date().toISOString().slice(0, 10);
const month = () => new Date().toISOString().slice(0, 7);

export function FieldTasks({ user, notify }: Props) {
  const cache = useQueryClient();
  const { data = [], isPending, error, refetch } = useQuery<Row[]>({ queryKey: ["field-tasks"], queryFn: () => api("/field-tasks") });
  const { data: agents = [] } = useQuery<Row[]>({ queryKey: ["agents"], queryFn: () => api("/resources/agents") });
  const [agentId, setAgentId] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [due, setDue] = useState(today());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ACTIVE");
  const [limit, setLimit] = useState(8);
  const canAssign = user.permissions.includes("task.write");
  const filtered = data.filter(t =>
    (statusFilter === "ALL" || (statusFilter === "ACTIVE" ? t.status !== "DONE" : t.status === statusFilter)) &&
    `${t.title} ${t.agent} ${t.employee_id} ${t.note}`.toLowerCase().includes(query.toLowerCase())
  );
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true); setMessage("");
    try { await action(); await cache.invalidateQueries({ queryKey: ["field-tasks"] }); notify(success); }
    catch (e: any) { setMessage(e.message || "Could not update the task."); }
    finally { setBusy(false); }
  }
  if (isPending) return <Loading />;
  if (error) return <ErrorState error={error} retry={refetch} />;
  return <div className="proposal-page">
    <div className="page-header"><div><div className="eyebrow">FIELD EXECUTION</div><h1>Tasks & review queue</h1><p>Assign daily field work and track completion for your team.</p></div><button onClick={() => refetch()}><RefreshCw size={16}/> Refresh</button></div>
    <div className="proposal-summary"><div><b>{data.filter(t => t.status !== "DONE").length}</b><span>Open tasks</span></div><div><b>{data.filter(t => t.status === "DONE").length}</b><span>Completed</span></div><div><b>{data.filter(t => t.status !== "DONE" && t.due_date < today()).length}</b><span>Overdue</span></div></div>
    {message && <p role="alert" className="ekyc-feedback">{message}</p>}
    {canAssign && <Panel title="Assign a task" subtitle="Choose an agent in your authorized team."><form className="proposal-form" onSubmit={e => { e.preventDefault(); run(async () => { await post("/field-tasks", { agent_id: agentId, title, note, due_date: due }); setTitle(""); setNote(""); }, "Task assigned"); }}>
      <label>Agent<select required value={agentId} onChange={e => setAgentId(e.target.value)}><option value="">Select an agent</option>{agents.map(a => <option key={a.id} value={a.id}>{a.name} · {a.employee_id}</option>)}</select></label>
      <label>Task title<input required minLength={3} maxLength={160} value={title} onChange={e => setTitle(e.target.value)} placeholder="Visit assigned outlet" /></label>
      <label>Due date<input type="date" required value={due} onChange={e => setDue(e.target.value)} /></label>
      <label className="wide">Instructions<input maxLength={500} value={note} onChange={e => setNote(e.target.value)} placeholder="What needs to be completed?" /></label>
      <button className="primary" disabled={busy}><Plus size={16}/> Assign task</button>
    </form></Panel>}
    <Panel title="Assigned tasks" subtitle={`${filtered.length} matching tasks in your scope`}>
      <div className="proposal-task-filters"><label>Search tasks<input value={query} onChange={e => {setQuery(e.target.value);setLimit(8);}} placeholder="Task, agent or employee ID" /></label><label>Task status<select value={statusFilter} onChange={e => {setStatusFilter(e.target.value);setLimit(8);}}><option value="ACTIVE">Active</option><option value="ALL">All</option><option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option><option value="DONE">Completed</option></select></label></div>
      {filtered.length ? <><div className="proposal-task-list">{filtered.slice(0,limit).map(t => <div className="proposal-task" key={t.id}><div className="proposal-task-icon"><ClipboardCheck size={20}/></div><div className="proposal-task-copy"><b>{t.title}</b><span>{t.agent} · {t.employee_id} · Due {t.due_date}</span>{t.note && <p>{t.note}</p>}</div><Badge value={t.status}/>{t.status !== "DONE" && <div className="proposal-task-actions">{t.status === "OPEN" && <button disabled={busy} onClick={() => run(() => patch(`/field-tasks/${t.id}`, {status:"IN_PROGRESS"}), "Task started")}>Start</button>}<button className="primary" disabled={busy} onClick={() => run(() => patch(`/field-tasks/${t.id}`, {status:"DONE"}), "Task completed")}>Complete</button></div>}</div>)}</div>{filtered.length > limit && <button className="proposal-more" onClick={() => setLimit(limit + 8)}>Show more tasks · {filtered.length - limit} remaining</button>}</> : <Empty text="No matching tasks" detail="Try another status or search term." />}
    </Panel>
  </div>;
}

export function Incentives({ user, notify }: Props) {
  const cache = useQueryClient();
  const [period, setPeriod] = useState(month());
  const [agentId, setAgentId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const canWrite = user.permissions.includes("incentive.write");
  const { data = [], isPending, error, refetch } = useQuery<Row[]>({ queryKey: ["incentives", period], queryFn: () => api(`/incentives?period=${encodeURIComponent(period)}`) });
  const { data: agents = [] } = useQuery<Row[]>({ queryKey: ["agents"], queryFn: () => api("/resources/agents") });
  const total = data.reduce((sum, row) => sum + Number(row.amount), 0);
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true); setMessage("");
    try { await action(); await cache.invalidateQueries({ queryKey: ["incentives"] }); notify(success); }
    catch (e: any) { setMessage(e.message || "Could not save incentives."); }
    finally { setBusy(false); }
  }
  async function importFile(file?: File) {
    if (!file) return;
    if (file.size > 2_000_000) { setMessage("File must be 2 MB or smaller."); return; }
    const content_base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = reject; reader.readAsDataURL(file); });
    await run(() => post("/incentives/import", { filename: file.name, content_base64 }), "Incentive file imported");
  }
  if (isPending) return <Loading />;
  if (error) return <ErrorState error={error} retry={refetch} />;
  return <div className="proposal-page">
    <div className="page-header"><div><div className="eyebrow">SALES PERFORMANCE</div><h1>Incentives</h1><p>Record incentives manually or import an Excel file. Every entry is traceable.</p></div>{user.permissions.includes("report.read") && <button onClick={() => download(`/incentives/export?period=${encodeURIComponent(period)}`, `incentives-${period}.csv`).catch(e => setMessage(e.message))}><Download size={16}/> Export CSV</button>}</div>
    <div className="proposal-summary"><div><b>AED {total.toFixed(2)}</b><span>Recorded in {period}</span></div><div><b>{data.length}</b><span>Entries</span></div><div><b>{new Set(data.map(x => x.agent_id)).size}</b><span>Agents</span></div></div>
    {message && <p role="alert" className="ekyc-feedback">{message}</p>}
    <div className="proposal-toolbar"><label>Month<input type="month" value={period} onChange={e => setPeriod(e.target.value)} /></label><button onClick={() => refetch()}><RefreshCw size={16}/> Refresh</button></div>
    {canWrite && <div className="proposal-columns"><Panel title="Manual entry" subtitle="Amounts are recorded in AED; payout happens outside this demo."><form className="proposal-form" onSubmit={e => {e.preventDefault();run(async () => {await post("/incentives",{agent_id:agentId,period,amount,note});setAmount("");setNote("");},"Incentive recorded");}}>
      <label>Agent<select required value={agentId} onChange={e => setAgentId(e.target.value)}><option value="">Select an agent</option>{agents.map(a => <option key={a.id} value={a.id}>{a.name} · {a.employee_id}</option>)}</select></label>
      <label>Amount (AED)<input type="number" min="0.01" max="100000" step="0.01" required value={amount} onChange={e => setAmount(e.target.value)}/></label>
      <label className="wide">Reason / note<input maxLength={300} value={note} onChange={e => setNote(e.target.value)}/></label>
      <button className="primary" disabled={busy}><Plus size={16}/> Save entry</button>
    </form></Panel><Panel title="Excel upload" subtitle="Upload a CSV or XLSX sheet with up to 500 rows."><div className="proposal-upload"><FileUp size={24}/><b>Import incentive records</b><span>Columns: employee_id, period, amount, note</span><input aria-label="Upload incentive CSV or Excel" type="file" accept=".csv,.xlsx" disabled={busy} onChange={e => {importFile(e.target.files?.[0]).catch(x => setMessage(x.message));e.target.value="";}}/></div></Panel></div>}
    <Panel title="Incentive history" subtitle={`${data.length} entries for ${period}`}><DataTable rows={data} columns={[{key:"employee_id",label:"Employee ID"},{key:"agent",label:"Agent"},{key:"period",label:"Period"},{key:"amount",label:"Amount (AED)"},{key:"source",label:"Source"},{key:"note",label:"Note"}]}/></Panel>
  </div>;
}

export function Support({ user, notify }: Props) {
  const cache = useQueryClient();
  const { data = [], isPending, error, refetch } = useQuery<Row[]>({queryKey:["support-tickets"],queryFn:()=>api('/support-tickets')});
  const { data: agents = [] } = useQuery<Row[]>({queryKey:["agents"],queryFn:()=>api('/resources/agents')});
  const [agentId,setAgentId]=useState(user.agent_id||'');
  const [subject,setSubject]=useState('');
  const [body,setBody]=useState('');
  const [response,setResponse]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState(false);
  const [errorText,setErrorText]=useState('');
  async function run(action:()=>Promise<unknown>,success:string){setBusy(true);setErrorText('');try{await action();await cache.invalidateQueries({queryKey:['support-tickets']});notify(success);}catch(e:any){setErrorText(e.message||'Could not update ticket.');}finally{setBusy(false);}}
  if(isPending)return <Loading/>;
  if(error)return <ErrorState error={error} retry={refetch}/>;
  return <div className="proposal-page"><div className="page-header"><div><div className="eyebrow">FIELD SUPPORT</div><h1>Support & help</h1><p>Raise operational issues and track the response.</p></div></div>
    {errorText&&<p role="alert" className="ekyc-feedback">{errorText}</p>}
    <Panel title="Open a support ticket" subtitle="Describe the issue without uploading customer identity data."><form className="proposal-form" onSubmit={e=>{e.preventDefault();run(async()=>{await post('/support-tickets',{agent_id:agentId,subject,message:body});setSubject('');setBody('');},'Support ticket created');}}>
      <label>Agent<select required value={agentId} onChange={e=>setAgentId(e.target.value)}><option value="">Select agent</option>{agents.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label>Subject<input required minLength={3} maxLength={160} value={subject} onChange={e=>setSubject(e.target.value)}/></label>
      <label className="wide">Details<input required minLength={10} maxLength={1000} value={body} onChange={e=>setBody(e.target.value)}/></label>
      <button className="primary" disabled={busy}>Send request</button>
    </form></Panel>
    <Panel title="Support history" subtitle={`${data.length} requests in your scope`}>{data.length?<div className="proposal-task-list">{data.map(t=><div key={t.id} className="proposal-task"><div className="proposal-task-copy"><b>{t.subject}</b><span>{t.agent} · {new Date(t.created_at).toLocaleString()}</span><p>{t.message}</p>{t.response&&<p><b>Response:</b> {t.response}</p>}</div><Badge value={t.status}/>{user.permissions.includes('support.write')&&t.status!=='RESOLVED'&&<div className="proposal-task-actions"><input aria-label={`Response for ${t.subject}`} minLength={5} maxLength={1000} placeholder="Response to agent" value={response[t.id]||''} onChange={e=>setResponse({...response,[t.id]:e.target.value})}/><button className="primary" disabled={busy||(response[t.id]||'').trim().length<5} onClick={()=>run(()=>patch(`/support-tickets/${t.id}`,{status:'RESOLVED',response:response[t.id]}),'Ticket resolved')}>Resolve</button></div>}</div>)}</div>:<Empty text="No support tickets" detail="Open a request when the field team needs assistance."/>}</Panel>
  </div>;
}
