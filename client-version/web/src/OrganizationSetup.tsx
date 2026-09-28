import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post, Row } from "./api";
import { Drawer, ErrorState, Loading } from "./components";

type Kind = "branches" | "agents";

export default function OrganizationSetup({ initial, onClose }: { initial: Kind; onClose: () => void }) {
  const cache = useQueryClient();
  const directory = useQuery<Row>({ queryKey: ["organization"], queryFn: () => api("/organization") });
  const [kind, setKind] = useState<Kind>(initial);
  const [branch, setBranch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  return <Drawer title="Manage branches and agents" onClose={() => !busy && onClose()}>
    <div className="setup-tabs" role="group" aria-label="Setup type">
      {(["branches", "agents"] as Kind[]).map((item) => <button key={item} aria-pressed={kind === item} disabled={busy} onClick={() => { setKind(item); setError(""); setSuccess(""); }}>{item === "branches" ? "Branch" : "Agent"}</button>)}
    </div>
    {directory.isPending ? <Loading /> : directory.error ? <ErrorState error={directory.error} retry={directory.refetch} /> : <>
      <div className="setup-summary">{directory.data.branches.length} branches</div>
      {success && <p className="setup-success" role="status">{success}</p>}
      <form key={kind} className="proposal-form agent-management-form" onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = Object.fromEntries(new FormData(form));
        setBusy(true); setError(""); setSuccess("");
        try {
          const created = await post(`/organization/${kind}`, kind === "branches" ? { name: values.name } : { ...values, branch_id: branch, target: Number(values.target) });
          if (kind === "branches") setBranch(created.id);
          form.reset();
          await cache.invalidateQueries();
          setSuccess(kind === "branches" ? "Branch created. Add its agents next." : "Agent created and assigned to the branch.");
        } catch (failure: any) { setError(failure.message); }
        finally { setBusy(false); }
      }}>
        {kind === "agents" && <label className="wide">Branch<select required value={branch} onChange={(event) => setBranch(event.target.value)}><option value="">Select branch</option>{directory.data.branches.map((item: Row) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        <label className="wide">{kind === "branches" ? "Branch name" : "Agent name"}<input name="name" required minLength={2} maxLength={120} autoComplete="off" /></label>
        {kind === "agents" && <>
          <label>Employee ID<input name="employee_id" required pattern="[A-Za-z0-9_-]{2,40}" maxLength={40} /></label>
          <label>Daily target<input name="target" type="number" min={1} max={1000} defaultValue={20} required /></label>
          <div className="credential-fields wide">
            <label>Sign-in email<input name="email" type="email" autoComplete="off" maxLength={180} required /></label>
            <label>Password<input name="password" type="password" autoComplete="new-password" minLength={10} maxLength={72} required /></label>
          </div>
        </>}
        {error && <p role="alert" className="wide">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? "Saving…" : `Create ${kind === "branches" ? "branch" : "agent"}`}</button>
      </form>
    </>}
  </Drawer>;
}
