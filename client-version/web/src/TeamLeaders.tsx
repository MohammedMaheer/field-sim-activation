import { useContext, useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CheckCheck, Plus, RefreshCw, Users, Store } from "lucide-react";
import { Context, useResource } from "./App";
import { api, Row, canManageOrganization } from "./api";
import { Loading, ErrorState, Badge } from "./components";
import OrganizationSetup, { TeamLeaderEditor } from "./OrganizationSetup";
import { useBranchScope } from "./BranchScope";
import RecordOverview from "./RecordOverview";
import ReceiptReview from "./ReceiptReview";

export default function TeamLeaders() {
  const { user } = useContext(Context);
  const leaders = useResource("team-leaders");
  const agents = useResource("agents");
  const [setup, setSetup] = useState<"new" | "existing" | null>(null);
  const [editing, setEditing] = useState<{
    id: string;
    mode: "details" | "branch";
  } | null>(null);
  const { branch, setBranch } = useBranchScope();
  const canManage = canManageOrganization(user);
  const [selected, setSelected] = useState<Row | null>(null);
  const queue = useQuery<Row[]>({
    queryKey: ["leader-confirmations", branch],
    queryFn: () =>
      api(
        `/kyc-captures/leader-confirmations?branch_id=${encodeURIComponent(branch)}`,
      ),
    enabled: user.role === "Team Leader",
    refetchInterval: 8000,
  });
  const previousBranch = useRef(branch);
  useEffect(() => {
    if (previousBranch.current !== branch) {
      previousBranch.current = branch;
      setSelected(null);
    }
  }, [branch]);
  if (selected)
    return (
      <ReceiptReview
        capture={selected}
        agent={agents.data?.find((agent) => agent.id === selected.agent_id)}
        user={user}
        onBack={() => setSelected(null)}
        onSaved={async () => {
          await queue.refetch();
        }}
      />
    );
  return (
    <>
      <header className="page-header">
        <div>
          <span className="eyebrow">BRANCH LEADERSHIP</span>
          <h1>Team leaders</h1>
        </div>
        <div className="leader-header-actions">
          <button
            onClick={() => {
              leaders.refetch();
              if (user.role === "Team Leader") queue.refetch();
            }}
          >
            <RefreshCw size={16} /> Refresh
          </button>
          {canManage && (
            <>
              <button onClick={() => setSetup("existing")}>
                Assign existing team leader
              </button>
              <button className="primary" onClick={() => setSetup("new")}>
                <Plus size={16} /> Add team leader
              </button>
            </>
          )}
        </div>
      </header>
      {editing && canManage && (
        <TeamLeaderEditor
          leaderId={editing.id}
          mode={editing.mode}
          onClose={() => setEditing(null)}
        />
      )}
      {setup && canManage && (
        <OrganizationSetup
          initial="teams"
          assignExisting={setup === "existing"}
          onClose={() => setSetup(null)}
        />
      )}
      {leaders.isPending ? (
        <Loading />
      ) : leaders.error ? (
        <ErrorState error={leaders.error} retry={leaders.refetch} />
      ) : (
        <>
          <RecordOverview
            rows={leaders.data || []}
            field="agents"
            numeric
            title="Sales agents by team leader"
          />
          <section
            className="leader-card-grid"
            aria-label="Branch team leaders"
          >
            {(leaders.data || []).map((leader: Row) => (
              <article className="panel leader-card" key={leader.id}>
                <div className="leader-card-heading">
                  <span className="leader-avatar">
                    <Users size={22} />
                  </span>
                  <div>
                    <h2>{leader.name}</h2>
                    {leader.branch_id ? (
                      <Link
                        onClick={() => setBranch(leader.branch_id)}
                        to={`/branches?selected=${encodeURIComponent(leader.branch_id)}`}
                      >
                        <Store size={14} />
                        {leader.branch}
                      </Link>
                    ) : (
                      <span className="assignment-help">
                        Branch not assigned
                      </span>
                    )}
                  </div>
                </div>
                {leader.historical_assignment && <p className="cell-sub">Historical sales · Current branch: {leader.current_branch || "Not assigned"}</p>}
                <div className="leader-card-metrics">
                  <Link
                    onClick={() =>
                      leader.branch_id && setBranch(leader.branch_id)
                    }
                    to={`/agents?leader=${encodeURIComponent(leader.leader_id)}`}
                  >
                    <b>{leader.agents}</b>
                    <span>Sales agents</span>
                  </Link>
                  <div>
                    <b>{leader.active}</b>
                    <span>Active sales agents</span>
                  </div>
                  <div>
                    <b>{leader.stock}</b>
                    <span>SIM stock</span>
                  </div>
                </div>
                {canManage && !leader.historical_assignment && (
                  <div className="leader-management-actions">
                    <button
                      onClick={() =>
                        setEditing({ id: leader.leader_id, mode: "details" })
                      }
                    >
                      Edit details
                    </button>
                    <button
                      onClick={() =>
                        setEditing({ id: leader.leader_id, mode: "branch" })
                      }
                    >
                      {leader.branch_id ? "Change branch" : "Assign branch"}
                    </button>
                  </div>
                )}
                <Link className="button" to="/kyc-capture">
                  <CheckCheck size={16} /> Backend verification
                </Link>
              </article>
            ))}
          </section>
          {!leaders.data?.length && (
            <div className="panel">No team leaders assigned</div>
          )}
        </>
      )}
      {user.role === "Team Leader" && (
        <section className="panel leader-confirmation-list">
          <h2>Backend confirmations</h2>
          {queue.isPending ? (
            <Loading />
          ) : queue.error ? (
            <ErrorState error={queue.error} retry={queue.refetch} />
          ) : !queue.data?.length ? (
            <p>No backend confirmations yet</p>
          ) : (
            queue.data.map((row) => (
              <article key={row.id}>
                <div>
                  <Badge value="VERIFIED" />
                  <h3>{row.intake?.name || "Not recorded"}</h3>
                  <span>{row.source_reference || "Not recorded"}</span>
                </div>
                <div>
                  <span>
                    {row.intake?.plan_name ||
                      row.intake?.package_name ||
                      "Not recorded"}
                  </span>
                </div>
                <button className="primary" onClick={() => setSelected(row)}>
                  View details
                </button>
              </article>
            ))
          )}
        </section>
      )}
    </>
  );
}
