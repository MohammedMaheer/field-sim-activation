import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post, Row } from "./api";
import { Drawer, ErrorState, Loading } from "./components";
import { useBranchScope } from "./BranchScope";

type Kind = "branches" | "agents" | "teams";

export function BranchLeaderEditor({ branchId }: { branchId: string }) {
  const cache = useQueryClient();
  const query = useQuery<Row>({
    queryKey: ["branch-leaders", branchId],
    queryFn: () => api(`/organization/branches/${branchId}/leaders`),
  });
  if (query.isPending) return <Loading />;
  if (query.error)
    return <ErrorState error={query.error} retry={query.refetch} />;
  return (
    <BranchLeaderForm
      key={(query.data.leaders || [])
        .map((row: Row) => row.id)
        .sort()
        .join(",")}
      data={query.data}
      onSaved={() => cache.invalidateQueries()}
    />
  );
}
function BranchLeaderForm({
  data,
  onSaved,
}: {
  data: Row;
  onSaved: () => Promise<unknown>;
}) {
  const current: Row[] = data.leaders || [];
  const [ids, setIds] = useState<string[]>(current.map((row) => row.id));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const candidates: Row[] = [...current, ...(data.available_leaders || [])];
  return (
    <form
      className="branch-leader-editor"
      aria-label={`Team leaders for ${data.branch.name}`}
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        setSuccess("");
        try {
          await api(`/organization/branches/${data.branch.id}/leaders`, {
            method: "PUT",
            body: JSON.stringify({
              leader_ids: ids,
              expected_leader_ids: current.map((row) => row.id),
              reason,
            }),
          });
          await onSaved();
          setSuccess("Branch team leaders updated");
          setReason("");
        } catch (failure: any) {
          setError(failure.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Team leaders · {data.branch.name}</h3>
      <fieldset className="leader-choice-list">
        <legend>Assigned team leaders</legend>
        {!candidates.length && (
          <p>
            No team leaders available. Create a team leader for this branch.
          </p>
        )}
        {candidates.map((person) => (
          <label key={person.id} className="leader-choice">
            <input
              type="checkbox"
              disabled={busy}
              checked={ids.includes(person.id)}
              onChange={(event) =>
                setIds(
                  event.target.checked
                    ? [...ids, person.id]
                    : ids.filter((id) => id !== person.id),
                )
              }
            />
            <span>
              <b>{person.name}</b>
              <small>
                {person.email} · {person.agents || 0} sales agents
                {current.some((row) => row.id === person.id)
                  ? " · Assigned"
                  : " · Available"}
              </small>
            </span>
          </label>
        ))}
      </fieldset>
      <label>
        Reason for change
        <input
          minLength={5}
          maxLength={300}
          required
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="setup-success" role="status">
          {success}
        </p>
      )}
      <button className="primary" disabled={busy}>
        {busy ? "Saving…" : "Save team leaders"}
      </button>
    </form>
  );
}

export function TeamLeaderEditor({
  leaderId,
  onClose,
}: {
  leaderId: string;
  onClose: () => void;
}) {
  const directory = useQuery<Row>({
    queryKey: ["organization"],
    queryFn: () => api("/organization"),
  });
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const person: Row | undefined = directory.data?.leaders?.find(
    (row: Row) => row.id === leaderId,
  );
  return (
    <Drawer title="Edit team leader" onClose={() => !busy && onClose()}>
      {directory.isPending ? (
        <Loading />
      ) : directory.error ? (
        <ErrorState error={directory.error} retry={directory.refetch} />
      ) : !person ? (
        <p>Team leader unavailable. Refresh and try again.</p>
      ) : (
        <form
          key={`${person.id}-${person.email}-${person.branch_id}`}
          className="proposal-form agent-management-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            const values = Object.fromEntries(
              new FormData(event.currentTarget),
            );
            const reason = values.reason;
            delete values.reason;
            try {
              await api(`/administration/teams/${person.id}`, {
                method: "PATCH",
                body: JSON.stringify({
                  values,
                  expected: {
                    name: person.name,
                    email: person.email,
                    branch_id: person.branch_id ?? null,
                  },
                  reason,
                }),
              });
              await cache.invalidateQueries();
              onClose();
            } catch (failure: any) {
              setError(failure.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="wide">
            Team leader name
            <input
              name="name"
              required
              minLength={2}
              maxLength={120}
              defaultValue={person.name}
            />
          </label>
          <label>
            Sign-in email
            <input
              name="email"
              type="email"
              required
              maxLength={180}
              defaultValue={person.email}
            />
          </label>
          <label>
            Branch
            <select
              name="branch_id"
              required
              defaultValue={person.branch_id || ""}
            >
              <option value="">Select branch</option>
              {directory.data?.branches.map((branch: Row) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
          <label className="wide">
            Reason for change
            <input name="reason" required minLength={5} maxLength={300} />
          </label>
          {error && (
            <p role="alert" className="form-error wide">
              {error}
            </p>
          )}
          <button className="primary wide" disabled={busy}>
            {busy ? "Saving…" : "Save team leader"}
          </button>
        </form>
      )}
    </Drawer>
  );
}

export default function OrganizationSetup({
  initial,
  initialBranchId,
  onClose,
}: {
  initial: Kind;
  initialBranchId?: string;
  onClose: () => void;
}) {
  const cache = useQueryClient();
  const scope = useBranchScope();
  const directory = useQuery<Row>({
    queryKey: ["organization"],
    queryFn: () => api("/organization"),
  });
  const [kind, setKind] = useState<Kind>(initial);
  const [branch, setBranch] = useState(initialBranchId || scope.branch);
  const [editBranch, setEditBranch] = useState(initialBranchId || "");
  const [newLeaders, setNewLeaders] = useState<string[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const branchLeaders: Row[] = (directory.data?.leaders || []).filter(
    (person: Row) => person.branch_id === branch,
  );
  return (
    <Drawer
      title="Manage branches and sales agents"
      onClose={() => !busy && onClose()}
    >
      <div className="setup-tabs" role="group" aria-label="Setup type">
        {(["branches", "agents", "teams"] as Kind[]).map((item) => (
          <button
            key={item}
            aria-pressed={kind === item}
            disabled={busy}
            onClick={() => {
              setKind(item);
              setError("");
              setSuccess("");
            }}
          >
            {item === "branches"
              ? "Branch"
              : item === "teams"
                ? "Team leader"
                : "Sales agent"}
          </button>
        ))}
      </div>
      {directory.isPending ? (
        <Loading />
      ) : directory.error ? (
        <ErrorState error={directory.error} retry={directory.refetch} />
      ) : (
        <>
          {kind === "branches" && (
            <section className="branch-leader-management">
              <label>
                Edit branch team leaders
                <select
                  value={editBranch}
                  onChange={(event) => setEditBranch(event.target.value)}
                >
                  <option value="">Choose a branch</option>
                  {directory.data.branches.map((item: Row) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              {editBranch && <BranchLeaderEditor branchId={editBranch} />}
            </section>
          )}
          {success && (
            <p className="setup-success" role="status">
              {success}
            </p>
          )}
          <form
            key={kind}
            className="proposal-form agent-management-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const values = Object.fromEntries(new FormData(form));
              setBusy(true);
              setError("");
              setSuccess("");
              try {
                const created = await post(
                  `/organization/${kind}`,
                  kind === "branches"
                    ? { name: values.name, leader_ids: newLeaders }
                    : {
                        ...values,
                        branch_id: branch,
                        ...(kind === "agents"
                          ? { target: Number(values.target) }
                          : {}),
                      },
                );
                if (kind === "branches") {
                  setBranch(created.id);
                  setEditBranch(created.id);
                  setNewLeaders([]);
                }
                form.reset();
                await cache.invalidateQueries();
                setSuccess(
                  kind === "branches"
                    ? "Branch created. Add its sales agents or team leaders."
                    : kind === "teams"
                      ? "Team leader assigned to the branch."
                      : "Sales agent created and assigned to the branch.",
                );
              } catch (failure: any) {
                setError(failure.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <h3 className="wide">
              {kind === "branches"
                ? "Add branch"
                : kind === "teams"
                  ? "Add team leader"
                  : "Add sales agent"}
            </h3>
            {kind !== "branches" && (
              <label className="wide">
                Branch
                <select
                  required
                  value={branch}
                  onChange={(event) => setBranch(event.target.value)}
                >
                  <option value="">Select branch</option>
                  {directory.data.branches.map((item: Row) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="wide">
              {kind === "branches"
                ? "Branch name"
                : kind === "teams"
                  ? "Team leader name"
                  : "Sales agent name"}
              <input
                name="name"
                required
                minLength={2}
                maxLength={120}
                autoComplete="off"
              />
            </label>
            {kind === "branches" &&
              !!directory.data.leaders?.some(
                (person: Row) => !person.branch_id,
              ) && (
                <fieldset className="leader-choice-list wide">
                  <legend>Assign available team leaders · optional</legend>
                  {directory.data.leaders
                    .filter((person: Row) => !person.branch_id)
                    .map((person: Row) => (
                      <label key={person.id} className="leader-choice">
                        <input
                          type="checkbox"
                          checked={newLeaders.includes(person.id)}
                          onChange={(event) =>
                            setNewLeaders(
                              event.target.checked
                                ? [...newLeaders, person.id]
                                : newLeaders.filter((id) => id !== person.id),
                            )
                          }
                        />
                        <span>{person.name}</span>
                      </label>
                    ))}
                </fieldset>
              )}
            {kind === "agents" && (
              <>
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
                  Total daily target
                  <input
                    name="target"
                    type="number"
                    min={1}
                    max={1000}
                    defaultValue={20}
                    required
                  />
                </label>
                <label className="wide">
                  Reporting team leader
                  <select
                    key={branch}
                    name="leader_id"
                    required={branchLeaders.length > 0}
                    defaultValue={
                      branchLeaders.length === 1 ? branchLeaders[0].id : ""
                    }
                  >
                    <option value="">
                      {branchLeaders.length
                        ? "Select team leader"
                        : "No team leader assigned"}
                    </option>
                    {branchLeaders.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {kind !== "branches" && (
              <div className="credential-fields wide">
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
                </label>
              </div>
            )}
            {error && (
              <p role="alert" className="form-error wide">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy
                ? "Saving…"
                : `Create ${kind === "branches" ? "branch" : kind === "teams" ? "team leader" : "sales agent"}`}
            </button>
          </form>
        </>
      )}
    </Drawer>
  );
}
