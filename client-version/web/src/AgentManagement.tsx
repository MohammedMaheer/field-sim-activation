import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, patch, Row } from "./api";
import { ErrorState, Loading } from "./components";

export default function AgentManagement({ agentId, onSaved }: { agentId: string; onSaved: () => void }) {
  const cache = useQueryClient();
  const query = useQuery<Row>({ queryKey: ["agent-management", agentId], queryFn: () => api(`/agents/${agentId}/management`) });
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} retry={query.refetch} />;
  return <ManagementForm key={`${query.data.agent.target}-${query.data.agent.outlet_id}-${query.data.agent.leader_id}`} data={query.data} onSave={async (body) => {
    await patch(`/agents/${agentId}/management`, body);
    await cache.invalidateQueries();
    onSaved();
  }} />;
}

function ManagementForm({ data, onSave }: { data: Row; onSave: (body: Row) => Promise<void> }) {
  const agent = data.agent;
  const originalBranch = data.outlets.find((outlet: Row) => outlet.id === agent.outlet_id)?.branch_id;
  const [branch, setBranch] = useState(originalBranch || "");
  const [target, setTarget] = useState(String(agent.target));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const branches: Row[] = data.outlets.filter((outlet: Row, index: number, all: Row[]) => all.findIndex((item: Row) => item.branch_id === outlet.branch_id) === index);
  const outlet = branch === originalBranch ? agent.outlet_id : data.outlets.find((item: Row) => item.branch_id === branch)?.id;
  return <form className="proposal-form agent-management-form" onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await onSave({ target: Number(target), outlet_id: outlet, leader_id: null,
        expected_target: agent.target, expected_outlet_id: agent.outlet_id,
        expected_leader_id: agent.leader_id || null, reason });
    } catch (failure: any) { setError(failure.message); }
    finally { setBusy(false); }
  }}>
    <label>Daily target<input type="number" min={1} max={1000} required value={target} onChange={(event) => setTarget(event.target.value)} /></label>
    <label>Assigned branch<select required value={branch} onChange={(event) => setBranch(event.target.value)}>{branches.map((item) => <option key={item.branch_id} value={item.branch_id}>{item.branch}</option>)}</select></label>
    <label className="wide">Reason for change<input minLength={5} maxLength={300} required value={reason} onChange={(event) => setReason(event.target.value)} /></label>
    {error && <p className="wide" role="alert">{error}</p>}
    <button className="primary" disabled={busy || !outlet}>{busy ? "Saving…" : "Save agent changes"}</button>
  </form>;
}
