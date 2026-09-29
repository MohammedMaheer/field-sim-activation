import { useContext, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, Plus, RefreshCw } from "lucide-react";
import { Context } from "./App";
import { api, post, Row } from "./api";
import { ErrorState, Loading } from "./components";
import "./sales-management.css";

const categories: Record<string,string> = {GRABBA_DEVICE:"Grabba device",ROUTER:"Router",STAMP:"Stamp",ID_CARD:"Staff ID card",UNIFORM:"Uniform",OTHER:"Other"};
export default function FieldAssets() {
  const {user,notify} = useContext(Context);
  const client = useQueryClient();
  const [tab,setTab] = useState<"stock"|"requests">("stock");
  const [add,setAdd] = useState(false);
  const [move,setMove] = useState<Row|null>(null);
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);
  const stock = useQuery<Row[]>({queryKey:["field-assets"],queryFn:()=>api("/field-assets")});
  const requests = useQuery<Row[]>({queryKey:["field-assets","requests"],queryFn:()=>api("/field-assets/requests/list"),enabled:tab==="requests"});
  const branches = useQuery<Row[]>({queryKey:["branches"],queryFn:()=>api("/resources/branches")});
  const agents = useQuery<Row[]>({queryKey:["agents"],queryFn:()=>api("/resources/agents")});
  const canManage = ["Administrator","Operations Manager","Inventory Manager"].includes(user.role);
  const agentId = user.agent_id as string|undefined;
  async function refresh(){await client.invalidateQueries({queryKey:["field-assets"]});}
  async function save(event:React.FormEvent<HTMLFormElement>, path:string, method:"POST"|"PATCH", done:()=>void){
    event.preventDefault();setError("");setBusy(true);
    const body=Object.fromEntries(new FormData(event.currentTarget));
    if ("quantity" in body) body.quantity=Number(body.quantity) as any;
    try{ if(method==="POST")await post(path,body);else await api(path,{method,body:JSON.stringify(body)});await refresh();done();notify("Stock record updated"); }
    catch(e:any){setError(e.message)}finally{setBusy(false)}
  }
  return <div className="sales-page"><header className="page-header"><div><span className="eyebrow">FIELD EQUIPMENT</span><h1>Assets & supplies</h1><p>Devices, routers and branch supplies</p></div><button onClick={refresh}><RefreshCw size={16}/> Refresh</button></header>
    <nav className="sales-tabs" aria-label="Asset sections"><button className={tab==="stock"?"active":""} onClick={()=>setTab("stock")}>Stock register</button><button className={tab==="requests"?"active":""} onClick={()=>setTab("requests")}>Requests</button></nav>
    {error&&<div className="sales-error" role="alert">{error}</div>}
    {tab==="stock"&&<section className="panel sales-section"><div className="sales-section-head"><h2>Asset register</h2>{canManage&&<button className="primary" onClick={()=>setAdd(!add)}><Plus size={15}/> Add asset</button>}</div>
      {add&&<form className="sales-form compact" onSubmit={e=>save(e,"/field-assets","POST",()=>setAdd(false))}><label>Category<select name="category">{Object.entries(categories).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select></label><label>Name<input name="label" required minLength={2}/></label><label>Serial (if applicable)<input name="serial"/></label><label>Quantity<input name="quantity" type="number" min="1" defaultValue="1" required/></label><label>Branch<select name="branch_id" required><option value="">Select branch</option>{branches.data?.map(b=><option value={b.id} key={b.id}>{b.name}</option>)}</select></label><label className="wide">Note<input name="note"/></label><button className="primary" disabled={busy}>Save asset</button></form>}
      {move&&<form className="sales-form compact" onSubmit={e=>save(e,`/field-assets/${move.id}`,"PATCH",()=>setMove(null))}><h3 className="wide">Move {move.label}</h3><label>Branch<select name="branch_id" required defaultValue={move.branch_id}>{branches.data?.map(b=><option value={b.id} key={b.id}>{b.name}</option>)}</select></label><label>Assigned agent<select name="agent_id" defaultValue={move.agent_id||""}><option value="">Unassigned</option>{agents.data?.map(a=><option value={a.id} key={a.id}>{a.name}</option>)}</select></label><label>Status<select name="status" defaultValue={move.status}>{["AVAILABLE","ASSIGNED","RETURNED","DAMAGED","RETIRED"].map(s=><option key={s}>{s}</option>)}</select></label><label className="wide">Reason<input name="reason" minLength={5} required/></label><button className="primary" disabled={busy}>Save movement</button><button type="button" onClick={()=>setMove(null)}>Cancel</button></form>}
      {stock.isPending?<Loading/>:stock.error?<ErrorState error={stock.error} retry={stock.refetch}/>:!stock.data?.length?<p className="sales-empty">No field assets recorded yet. SIM stock is managed separately in SIM inventory.</p>:<div className="sales-table-wrap"><table className="sales-table"><thead><tr><th>Asset</th><th>Serial</th><th>Branch</th><th>Assigned to</th><th>Qty</th><th>Status</th><th></th></tr></thead><tbody>{stock.data.map(a=><tr key={a.id}><td><b>{a.label}</b><small>{categories[a.category]}</small></td><td>{a.serial}</td><td>{a.branch}</td><td>{a.agent}</td><td>{a.quantity}</td><td>{a.status}</td><td>{canManage&&<button onClick={()=>setMove(a)}>Move / update</button>}</td></tr>)}</tbody></table></div>}
    </section>}
    {tab==="requests"&&<section className="panel sales-section"><div className="sales-section-head"><h2>Asset requests</h2></div>{agentId&&<form className="sales-form compact" onSubmit={e=>save(e,"/field-assets/requests","POST",()=>{})}><input name="agent_id" type="hidden" value={agentId}/><label>Category<select name="category">{Object.entries(categories).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select></label><label>Quantity<input name="quantity" type="number" min="1" defaultValue="1" required/></label><label className="wide">Reason<input name="reason" required minLength={5}/></label><button className="primary" disabled={busy}>Request stock</button></form>}
      {requests.isPending?<Loading/>:requests.error?<ErrorState error={requests.error} retry={requests.refetch}/>:!requests.data?.length?<p className="sales-empty">No asset requests yet</p>:<div className="sales-table-wrap"><table className="sales-table"><thead><tr><th>Agent</th><th>Asset</th><th>Qty</th><th>Reason</th><th>Status</th><th></th></tr></thead><tbody>{requests.data.map(r=><tr key={r.id}><td>{r.agent}</td><td>{categories[r.category]}</td><td>{r.quantity}</td><td>{r.reason}</td><td>{r.status}</td><td>{canManage&&r.status!=="FULFILLED"&&r.status!=="REJECTED"&&<span className="asset-actions">{(r.status==="REQUESTED"?["APPROVED","REJECTED"]:["FULFILLED"]).map(s=>{const assigned=(stock.data||[]).find(a=>a.category===r.category&&a.agent_id===r.agent_id&&a.branch_id===r.branch_id&&a.status==="ASSIGNED"&&a.quantity>=r.quantity);return <button key={s} disabled={s==="FULFILLED"&&!assigned} title={s==="FULFILLED"&&!assigned?"Assign matching stock to the agent first":""} onClick={async()=>{const reason=window.prompt(`${s} reason`);if(!reason||reason.trim().length<5)return;try{await api(`/field-assets/requests/${r.id}`,{method:"PATCH",body:JSON.stringify({status:s,reason,asset_id:assigned?.id||""})});await refresh()}catch(e:any){setError(e.message)}}}>{s}</button>})}</span>}</td></tr>)}</tbody></table></div>}
    </section>}
  </div>
}
