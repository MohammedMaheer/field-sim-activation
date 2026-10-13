import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, patch, Row } from "./api";
import { ErrorState, Loading } from "./components";
import { Link } from "react-router-dom";

export default function AgentManagement({
  agentId,
  onSaved,
}: {
  agentId: string;
  onSaved: () => void;
}) {
  const cache = useQueryClient();
  const [reloadVersion, setReloadVersion] = useState(0);
  const query = useQuery<Row>({
    queryKey: ["agent-management", agentId],
    queryFn: () => api(`/agents/${agentId}/management`),
  });
  if (query.isPending) return <Loading />;
  if (query.error)
    return <ErrorState error={query.error} retry={query.refetch} />;
  return (
    <ManagementForm
      key={`${agentId}-${reloadVersion}`}
      data={query.data}
      onReload={async () => {
        await query.refetch();
        setReloadVersion((version) => version + 1);
      }}
      onSave={async (body) => {
        await patch(`/agents/${agentId}/management`, body);
        await cache.invalidateQueries();
        onSaved();
      }}
    />
  );
}

function ManagementForm({
  data,
  onSave,
  onReload,
}: {
  data: Row;
  onSave: (body: Row) => Promise<void>;
  onReload: () => Promise<void>;
}) {
  // Keep the original concurrency check while the user is editing.
  const [agent] = useState<Row>(() => data.agent);
  const originalBranch = data.outlets.find(
    (outlet: Row) => outlet.id === agent.outlet_id,
  )?.branch_id;
  const [branch, setBranch] = useState(originalBranch || "");
  const [leader, setLeader] = useState(agent.leader_id || "");
  const [target, setTarget] = useState(String(agent.target));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const branches: Row[] = data.outlets.filter(
    (outlet: Row, index: number, all: Row[]) =>
      all.findIndex((item: Row) => item.branch_id === outlet.branch_id) ===
      index,
  );
  const outlet =
    branch === originalBranch
      ? agent.outlet_id
      : data.outlets.find((item: Row) => item.branch_id === branch)?.id;
  const eligibleLeaders: Row[] = (data.leaders || []).filter(
    (person: Row) => person.branch_id === branch,
  );
  const currentLeader = (data.leaders || []).find(
    (person: Row) => person.id === agent.leader_id,
  );
  const nextLeader = eligibleLeaders.find((person) => person.id === leader);
  const currentBranch =
    branches.find((item) => item.branch_id === originalBranch)?.branch ||
    "Not assigned";
  const nextBranch =
    branches.find((item) => item.branch_id === branch)?.branch ||
    "Not assigned";
  const changed =
    outlet !== agent.outlet_id ||
    leader !== (agent.leader_id || "") ||
    Number(target) !== agent.target;
  return (
    <form
      className="proposal-form agent-management-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!reviewing) {
          setReviewing(true);
          setError("");
          return;
        }
        setBusy(true);
        setError("");
        try {
          await onSave({
            target: Number(target),
            outlet_id: outlet,
            leader_id: leader || null,
            expected_target: agent.target,
            expected_outlet_id: agent.outlet_id,
            expected_leader_id: agent.leader_id || null,
            reason,
          });
        } catch (failure: any) {
          setError(failure.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {!reviewing && (
        <>
          <section
            className="assignment-current wide"
            aria-label="Current sales agent assignment"
          >
            <h3>Current assignment</h3>
            <dl>
              <div>
                <dt>Branch</dt>
                <dd>{currentBranch}</dd>
              </div>
              <div>
                <dt>Team leader</dt>
                <dd>{currentLeader?.name || "Not assigned"}</dd>
              </div>
              <div>
                <dt>Total daily target</dt>
                <dd>{agent.target}</dd>
              </div>
            </dl>
          </section>
          <p className="assignment-help wide">
            Choose the branch first, then its reporting team leader. Previous
            sales and notifications keep their original branch and leader.
          </p>
          <label>
            Assigned branch
            <select
              required
              disabled={busy || reviewing}
              value={branch}
              onChange={(event) => {
                setBranch(event.target.value);
                setLeader("");
                setError("");
              }}
            >
              <option value="">Select branch</option>
              {branches.map((item) => (
                <option key={item.branch_id} value={item.branch_id}>
                  {item.branch}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reporting team leader
            <select
              required
              disabled={busy || reviewing || !eligibleLeaders.length}
              value={nextLeader ? leader : ""}
              onChange={(event) => setLeader(event.target.value)}
            >
              <option value="">
                {branch
                  ? eligibleLeaders.length
                    ? "Select team leader"
                    : "Assign a team leader to this branch first"
                  : "Select a branch first"}
              </option>
              {eligibleLeaders.map((person: Row) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
          {branch && !eligibleLeaders.length && (
            <p className="assignment-notice wide" role="status">
              No team leader is assigned to {nextBranch}. Add or assign one from
              Team leaders, then return to this sales agent.
            </p>
          )}
          <label>
            Total daily target
            <input
              type="number"
              min={1}
              max={1000}
              required
              disabled={busy || reviewing}
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            />
          </label>
          <label>
            Reason for change
            <input
              minLength={5}
              maxLength={300}
              required
              disabled={busy || reviewing}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        </>
      )}
      {reviewing && (
        <section
          className="assignment-review wide"
          aria-label="Review sales agent assignment"
        >
          <h3>Review changes</h3>
          <dl>
            <div>
              <dt>Branch</dt>
              <dd>
                {currentBranch} → {nextBranch}
              </dd>
            </div>
            <div>
              <dt>Team leader</dt>
              <dd>
                {currentLeader?.name || "Not assigned"} → {nextLeader?.name}
              </dd>
            </div>
            <div>
              <dt>Total daily target</dt>
              <dd>
                {agent.target} → {target}
              </dd>
            </div>
          </dl>
          <p>
            <b>Reason:</b> {reason}
          </p>
          <p>
            Applies to new sales. Saved sales and notifications remain
            unchanged.
          </p>
        </section>
      )}
      {error && (
        <div className="assignment-notice wide" role="alert">
          <p>
            {error.replace("before changing outlet", "before changing branch")}
          </p>
          <div className="assignment-actions">
            {error.includes("SIM stock") && (
              <Link className="button" to="/inventory">
                Open SIM inventory
              </Link>
            )}
            {error.includes("equipment") && (
              <Link className="button" to="/equipment">
                Open Assets & supplies
              </Link>
            )}
            <button type="button" disabled={busy} onClick={onReload}>
              Reload current assignment
            </button>
          </div>
        </div>
      )}
      <div className="assignment-actions wide">
        {reviewing && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setReviewing(false)}
          >
            Back to edit
          </button>
        )}
        <button
          className="primary"
          disabled={busy || !outlet || !nextLeader || !changed}
        >
          {busy
            ? "Saving…"
            : reviewing
              ? "Confirm assignment changes"
              : "Review assignment changes"}
        </button>
      </div>
    </form>
  );
}
