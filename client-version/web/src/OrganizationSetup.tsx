import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post, Row } from "./api";
import { Drawer, Loading, ErrorState } from "./components";

type Kind = "branches" | "teams" | "outlets" | "agents";
const labels: Record<Kind, string> = {
  branches: "Branch",
  teams: "Team",
  outlets: "Outlet",
  agents: "Agent",
};
export default function OrganizationSetup({
  initial,
  onClose,
}: {
  initial: Kind;
  onClose: () => void;
}) {
  const cache = useQueryClient();
  const q = useQuery<Row>({
    queryKey: ["organization"],
    queryFn: () => api("/organization"),
  });
  const [kind, setKind] = useState<Kind>(initial),
    [branch, setBranch] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  return (
    <Drawer
      title="Set up your field network"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="setup-intro">
        Create a branch, add its team and outlet, then invite agents. Each team
        is led by one team leader.
      </p>
      <div className="setup-tabs" role="group" aria-label="Setup type">
        {(Object.keys(labels) as Kind[]).map((k) => (
          <button
            key={k}
            aria-pressed={kind === k}
            disabled={busy}
            onClick={() => {
              setKind(k);
              setError("");
              setSuccess("");
            }}
          >
            {labels[k]}
          </button>
        ))}
      </div>
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} retry={q.refetch} />
      ) : (
        <>
          <div className="setup-summary">
            {q.data.branches.length} branches · {q.data.teams.length} teams ·{" "}
            {q.data.outlets.length} outlets
          </div>
          {success && (
            <p className="setup-success" role="status">
              {success}
            </p>
          )}
          <form
            key={kind}
            className="proposal-form agent-management-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const values = Object.fromEntries(new FormData(form));
              setError("");
              setSuccess("");
              setBusy(true);
              try {
                const created = await post(`/organization/${kind}`, {
                  ...values,
                  ...(kind !== "branches" ? { branch_id: branch } : {}),
                  ...(kind === "agents"
                    ? { target: Number(values.target) }
                    : {}),
                });
                if (kind === "branches") setBranch(created.id);
                form.reset();
                await cache.invalidateQueries();
                setSuccess(
                  `${labels[kind]} created. ${kind === "branches" ? "Choose Team or Outlet to continue setting up the branch." : kind === "teams" ? "The team leader can now sign in. Add an outlet and agents next." : kind === "outlets" ? "You can now assign agents to this outlet." : "The agent can now sign in to the mobile app."}`,
                );
              } catch (err: any) {
                setError(err.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {kind !== "branches" && (
              <label className="wide">
                Branch
                <select
                  required
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                >
                  <option value="">Select branch</option>
                  {q.data.branches.map((b: Row) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="wide">
              {kind === "teams" ? "Team leader name" : `${labels[kind]} name`}
              <input
                name="name"
                required
                minLength={2}
                maxLength={120}
                autoComplete="off"
              />
            </label>
            {kind === "outlets" && (
              <label className="wide">
                Area
                <input name="area" maxLength={120} />
              </label>
            )}
            {kind === "agents" && (
              <>
                <label>
                  Team
                  <select name="leader_id" required key={`team-${branch}`}>
                    <option value="">Select team</option>
                    {q.data.teams
                      .filter((t: Row) => t.branch_id === branch)
                      .map((t: Row) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Outlet
                  <select name="outlet_id" required key={`outlet-${branch}`}>
                    <option value="">Select outlet</option>
                    {q.data.outlets
                      .filter((o: Row) => o.branch_id === branch)
                      .map((o: Row) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Employee ID
                  <input
                    name="employee_id"
                    required
                    pattern="[A-Za-z0-9_-]{2,40}"
                    maxLength={40}
                  />
                </label>
                <label>
                  Daily target
                  <input
                    name="target"
                    type="number"
                    min={1}
                    max={1000}
                    defaultValue={20}
                    required
                  />
                </label>
              </>
            )}
            {["agents", "teams"].includes(kind) && (
              <>
                <label>
                  Sign-in email
                  <input
                    name="email"
                    type="email"
                    autoComplete="off"
                    maxLength={180}
                    required
                  />
                </label>
                <label>
                  Password
                  <input
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    minLength={10}
                    maxLength={72}
                    required
                  />
                  <small>
                    At least 10 characters. Share securely with the employee.
                  </small>
                </label>
              </>
            )}
            {error && (
              <p role="alert" className="wide">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy ? "Creating…" : `Create ${labels[kind].toLowerCase()}`}
            </button>
          </form>
        </>
      )}
    </Drawer>
  );
}
