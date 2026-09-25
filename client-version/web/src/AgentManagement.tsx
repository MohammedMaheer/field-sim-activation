import {useState} from "react";
import {useQuery, useQueryClient} from "@tanstack/react-query";
import {api, patch, Row} from "./api";
import {Loading, ErrorState} from "./components";
export default function AgentManagement({agentId,onSaved}:{agentId:string;onSaved:()=>void}) {
 const cache=useQueryClient();
 const q=useQuery<Row>({queryKey:["agent-management",agentId],queryFn:()=>api(`/agents/${agentId}/management`)});
 if(q.isPending)return <Loading/>;
 if(q.error)return <ErrorState error={q.error} retry={q.refetch}/>;
 return <ManagementForm key={`${q.data.agent.target}-${q.data.agent.outlet_id}-${q.data.agent.leader_id}`} data={q.data} save={async body=>{await patch(`/agents/${agentId}/management`,body);await cache.invalidateQueries();onSaved();}}/>;
}
function ManagementForm({data,save}:{data:Row;save:(body:Row)=>Promise<void>}) {
 const a=data.agent;
 const [target,setTarget]=useState(String(a.target)),[outlet,setOutlet]=useState(a.outlet_id),[leader,setLeader]=useState(a.leader_id),[reason,setReason]=useState("");
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 const branch=data.outlets.find((o:Row)=>o.id===outlet)?.branch_id;
 return <form className="proposal-form agent-management-form" onSubmit={async e=>{e.preventDefault();setBusy(true);setError("");try{await save({target:Number(target),outlet_id:outlet,leader_id:leader,expected_target:a.target,expected_outlet_id:a.outlet_id,expected_leader_id:a.leader_id,reason});}catch(err:any){setError(err.message);}finally{setBusy(false);}}}>
 <p className="wide">Manage this agent’s daily target and branch team. Changes are recorded in the audit history.</p>
 <label>Daily target<input type="number" min={1} max={1000} required value={target} onChange={e=>setTarget(e.target.value)}/></label>
 <label>Assigned outlet<select value={outlet} onChange={e=>{setOutlet(e.target.value);setLeader("");}}>{data.outlets.map((o:Row)=><option key={o.id} value={o.id}>{o.name} · {o.branch}</option>)}</select></label>
 <label>Team leader<select required value={leader} onChange={e=>setLeader(e.target.value)}><option value="">Select a team leader</option>{data.leaders.filter((l:Row)=>l.branch_id===branch).map((l:Row)=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
 <label className="wide">Reason for change<input minLength={5} maxLength={300} required value={reason} onChange={e=>setReason(e.target.value)}/></label>
 {error&&<p className="wide" role="alert">{error}</p>}
 <button className="primary" disabled={busy}>{busy?"Saving…":"Save agent changes"}</button>
 </form>;
}
