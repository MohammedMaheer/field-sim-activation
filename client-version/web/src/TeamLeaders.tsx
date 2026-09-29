import { useContext, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CheckCheck, Plus, RefreshCw, Users, Store } from "lucide-react";
import { Context, useResource } from "./App";
import { api, Row } from "./api";
import { Loading, ErrorState, Badge } from "./components";
import OrganizationSetup from "./OrganizationSetup";
import RecordOverview from "./RecordOverview";
import ReceiptReview from "./ReceiptReview";

export default function TeamLeaders() {
  const {user} = useContext(Context);
  const leaders = useResource("team-leaders");
  const agents = useResource("agents");
  const [setup,setSetup] = useState(false);
  const [selected,setSelected] = useState<Row | null>(null);
  const queue = useQuery<Row[]>({queryKey:["leader-confirmations"],queryFn:() => api("/kyc-captures/leader-confirmations"),enabled:user.role === "Team Leader",refetchInterval:8000});
  if(selected) return <ReceiptReview capture={selected} agent={agents.data?.find(agent => agent.id === selected.agent_id)} user={user} onBack={() => setSelected(null)} onSaved={async () => {await queue.refetch();}}/>;
  return <>
    <header className="page-header"><div><span className="eyebrow">BRANCH LEADERSHIP</span><h1>Team leaders</h1></div><div className="leader-header-actions">
      <button onClick={() => {leaders.refetch();if(user.role === "Team Leader")queue.refetch();}}><RefreshCw size={16}/> Refresh</button>
      {user.role === "Administrator" && <button className="primary" onClick={() => setSetup(true)}><Plus size={16}/> Manage team leaders</button>}
    </div></header>
    {setup && <OrganizationSetup initial="teams" onClose={() => setSetup(false)}/>}
    {leaders.isPending ? <Loading/> : leaders.error ? <ErrorState error={leaders.error} retry={leaders.refetch}/> : <>
      <RecordOverview rows={leaders.data || []} field="agents" numeric title="Agents by team leader"/>
      <section className="leader-card-grid" aria-label="Branch team leaders">{(leaders.data || []).map((leader:Row) => <article className="panel leader-card" key={leader.id}>
        <div className="leader-card-heading"><span className="leader-avatar"><Users size={22}/></span><div><h2>{leader.name}</h2><Link to={`/branches?selected=${encodeURIComponent(leader.branch_id)}`}><Store size={14}/>{leader.branch}</Link></div></div>
        <div className="leader-card-metrics"><Link to={`/branches?selected=${encodeURIComponent(leader.branch_id)}`}><b>{leader.agents}</b><span>Agents</span></Link><div><b>{leader.active}</b><span>Active agents</span></div><div><b>{leader.stock}</b><span>SIM stock</span></div></div>
        <Link className="button" to="/kyc-capture"><CheckCheck size={16}/> Backend verification</Link>
      </article>)}</section>
      {!leaders.data?.length && <div className="panel">No team leaders assigned</div>}
    </>}
    {user.role === "Team Leader" && <section className="panel leader-confirmation-list"><h2>Backend confirmations</h2>
      {queue.isPending ? <Loading/> : queue.error ? <ErrorState error={queue.error} retry={queue.refetch}/> : !queue.data?.length ? <p>No backend confirmations yet</p> : queue.data.map(row => <article key={row.id}>
        <div><Badge value="VERIFIED"/><h3>{row.intake?.name || "Not recorded"}</h3><span>{row.source_reference || "Not recorded"}</span></div>
        <div><span>{row.intake?.plan_name || row.intake?.package_name || "Not recorded"}</span></div>
        <button className="primary" onClick={() => setSelected(row)}>View details</button>
      </article>)}
    </section>}
  </>;
}
