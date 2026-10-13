import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post, Row } from "./api";
import { Drawer, ErrorState, Loading } from "./components";
import { useBranchScope } from "./BranchScope";
import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import { useContext } from "react";
import { Context } from "./App";
import {
  BranchLocationFields,
  BranchLocationValue,
  branchLocationPayload,
} from "./BranchLocation";

type Kind = "branches" | "agents" | "teams";

export function BranchLeaderEditor({ branchId }: { branchId: string }) {
  const cache = useQueryClient();
  const [saved, setSaved] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);
  const query = useQuery<Row>({
    queryKey: ["branch-leaders", branchId],
    queryFn: () => api(`/organization/branches/${branchId}/leaders`),
  });
  if (query.isPending) return <Loading />;
  if (query.error)
    return <ErrorState error={query.error} retry={query.refetch} />;
  return (
    <>
      <BranchLeaderForm
        key={`${branchId}-${reloadVersion}`}
        data={query.data}
        onSaved={async () => {
          await cache.invalidateQueries();
          setReloadVersion((version) => version + 1);
          setSaved("Branch team leaders saved");
        }}
        onEditing={() => setSaved("")}
        onReload={async () => {
          await query.refetch();
          setReloadVersion((version) => version + 1);
          setSaved("");
        }}
      />
      {saved && (
        <p className="setup-success" role="status">
          {saved}
        </p>
      )}
    </>
  );
}
function BranchLeaderForm({
  data,
  onSaved,
  onEditing,
  onReload,
}: {
  data: Row;
  onSaved: () => Promise<unknown>;
  onEditing: () => void;
  onReload: () => Promise<void>;
}) {
  const [current] = useState<Row[]>(() => data.leaders || []);
  const [ids, setIds] = useState<string[]>(current.map((row) => row.id));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const candidates: Row[] = [
    ...current,
    ...(data.available_leaders || []).filter(
      (person: Row) => !current.some((row) => row.id === person.id),
    ),
  ];
  const added = candidates.filter(
    (person) =>
      ids.includes(person.id) && !current.some((row) => row.id === person.id),
  );
  const removed = current.filter((person) => !ids.includes(person.id));
  const changed = added.length > 0 || removed.length > 0;
  return (
    <form
      className="branch-leader-editor"
      aria-label={`Team leaders for ${data.branch.name}`}
      onSubmit={async (event) => {
        event.preventDefault();
        if (!reviewing) {
          setReviewing(true);
          return;
        }
        setBusy(true);
        setError("");
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
          setReason("");
        } catch (failure: any) {
          setError(failure.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Team leaders · {data.branch.name}</h3>
      <p className="assignment-help">
        Assign leaders to this branch here. Change a sales agent’s reporting
        leader from their sales agent record.
      </p>
      <fieldset className="leader-choice-list">
        <legend>Branch team leaders</legend>
        {!candidates.length && (
          <p>
            No team leaders available. Create a team leader for this branch.
          </p>
        )}
        {candidates.map((person) => (
          <label key={person.id} className="leader-choice">
            <input
              type="checkbox"
              disabled={
                busy ||
                reviewing ||
                (current.some((row) => row.id === person.id) &&
                  person.agents > 0)
              }
              checked={ids.includes(person.id)}
              onChange={(event) => {
                onEditing();
                setIds(
                  event.target.checked
                    ? [...ids, person.id]
                    : ids.filter((id) => id !== person.id),
                );
              }}
            />
            <span>
              <b>{person.name}</b>
              <small>
                {person.email} · {person.agents || 0} sales agents
                {current.some((row) => row.id === person.id)
                  ? person.agents > 0
                    ? " · Reassign sales agents before removing"
                    : " · Assigned"
                  : " · Available to assign"}
              </small>
            </span>
          </label>
        ))}
      </fieldset>
      {current.some((person) => person.agents > 0) && (
        <div className="assignment-links">
          {current
            .filter((person) => person.agents > 0)
            .map((person) => (
              <Link
                className="button"
                key={person.id}
                to={`/agents?leader=${encodeURIComponent(person.id)}`}
              >
                View {person.name}’s sales agents
              </Link>
            ))}
        </div>
      )}
      {changed && (
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
      )}
      {reviewing && (
        <section
          className="assignment-review"
          aria-label="Review branch leader changes"
        >
          <h4>Review changes</h4>
          {added.length > 0 && (
            <p>
              <b>Assign:</b> {added.map((person) => person.name).join(", ")}
            </p>
          )}
          {removed.length > 0 && (
            <p>
              <b>Remove:</b> {removed.map((person) => person.name).join(", ")}
            </p>
          )}
          <p>Sales agent assignments and saved sales stay unchanged.</p>
        </section>
      )}
      {error && (
        <div className="form-error" role="alert">
          <p>{error}</p>
          <button type="button" disabled={busy} onClick={onReload}>
            Reload branch team leaders
          </button>
        </div>
      )}
      <div className="assignment-actions">
        {reviewing && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setReviewing(false)}
          >
            Back to choices
          </button>
        )}
        <button className="primary" disabled={busy || !changed}>
          {busy
            ? "Saving…"
            : reviewing
              ? "Confirm team leader changes"
              : "Review team leader changes"}
        </button>
      </div>
    </form>
  );
}

export function TeamLeaderEditor({
  leaderId,
  onClose,
  mode = "details",
}: {
  leaderId: string;
  onClose: () => void;
  mode?: "details" | "branch";
}) {
  const directory = useQuery<Row>({
    queryKey: ["organization"],
    queryFn: () => api("/organization"),
  });
  const cache = useQueryClient();
  const scope = useBranchScope();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [review, setReview] = useState<Row | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const latestPerson: Row | undefined = directory.data?.leaders?.find(
    (row: Row) => row.id === leaderId,
  );
  const originalPerson = useRef<Row | undefined>(undefined);
  if (!originalPerson.current && latestPerson)
    originalPerson.current = latestPerson;
  const person = originalPerson.current;
  return (
    <Drawer
      title={
        mode === "branch"
          ? "Change team leader branch"
          : "Edit team leader details"
      }
      onClose={() => !busy && onClose()}
    >
      {directory.isPending ? (
        <Loading />
      ) : directory.error ? (
        <ErrorState error={directory.error} retry={directory.refetch} />
      ) : !person ? (
        <p>Team leader unavailable. Refresh and try again.</p>
      ) : (
        <form
          key={`${person.id}-${reloadVersion}`}
          className="proposal-form agent-management-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setError("");
            const values = Object.fromEntries(
              new FormData(event.currentTarget),
            );
            const reason = values.reason;
            delete values.reason;
            if (mode === "branch" && !review) {
              if (values.branch_id === (person.branch_id || "")) {
                setError(
                  "Choose a different branch before reviewing the change.",
                );
                return;
              }
              setReview({ values, reason });
              return;
            }
            setBusy(true);
            try {
              await api(`/administration/teams/${person.id}`, {
                method: "PATCH",
                body: JSON.stringify({
                  values: mode === "branch" ? review?.values : values,
                  expected: {
                    name: person.name,
                    email: person.email,
                    branch_id: person.branch_id ?? null,
                  },
                  reason: mode === "branch" ? review?.reason : reason,
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
          <section
            className="assignment-current wide"
            aria-label="Current team leader assignment"
          >
            <h3>{person.name}</h3>
            <dl>
              <div>
                <dt>Current branch</dt>
                <dd>
                  {directory.data?.branches.find(
                    (branch: Row) => branch.id === person.branch_id,
                  )?.name || "Not assigned"}
                </dd>
              </div>
              <div>
                <dt>Sales agents</dt>
                <dd>{person.agents || 0}</dd>
              </div>
            </dl>
          </section>
          {mode === "details" && (
            <>
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
              <label className="wide">
                Sign-in email
                <input
                  name="email"
                  type="email"
                  required
                  maxLength={180}
                  defaultValue={person.email}
                />
              </label>
              <p className="assignment-help wide">
                Use Change branch to move this team leader. Editing their
                details keeps every sales agent assignment.
              </p>
            </>
          )}
          {mode === "branch" && (
            <>
              {!(person.agents > 0) && (
                <>
                  <input type="hidden" name="name" value={person.name} />
                  <input type="hidden" name="email" value={person.email} />
                  <label className="wide">
                    Branch
                    <select
                      name="branch_id"
                      required
                      defaultValue={person.branch_id || ""}
                      disabled={busy || !!review}
                    >
                      <option value="">Select branch</option>
                      {directory.data?.branches.map((branch: Row) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {person.agents > 0 ? (
                <div className="assignment-notice wide" role="status">
                  Reassign this team leader’s {person.agents} sales agent
                  {person.agents === 1 ? "" : "s"} first, then change their
                  branch. Saved sales and notifications remain with their
                  original assignment.
                  <Link
                    className="button"
                    to={`/agents?leader=${encodeURIComponent(person.id)}`}
                    onClick={() => {
                      scope.setBranch(person.branch_id || "");
                      onClose();
                    }}
                  >
                    View sales agents to reassign
                  </Link>
                </div>
              ) : (
                <p className="assignment-help wide">
                  Moves only this team leader. Sales agents and historical
                  records are not moved.
                </p>
              )}
            </>
          )}
          {!(mode === "branch" && person.agents > 0) && (
            <label className="wide">
              Reason for change
              <input
                name="reason"
                required
                minLength={5}
                maxLength={300}
                disabled={
                  busy || !!review || (mode === "branch" && person.agents > 0)
                }
              />
            </label>
          )}
          {review && (
            <section
              className="assignment-review wide"
              aria-label="Review team leader branch change"
            >
              <h3>Review branch change</h3>
              <p>
                <b>{person.name}</b> →{" "}
                {
                  directory.data?.branches.find(
                    (branch: Row) => branch.id === review.values.branch_id,
                  )?.name
                }
              </p>
              <p>{review.reason}</p>
            </section>
          )}
          {error && (
            <div role="alert" className="form-error wide">
              <p>{error}</p>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const result = await directory.refetch();
                  originalPerson.current = result.data?.leaders?.find(
                    (row: Row) => row.id === leaderId,
                  );
                  setReview(null);
                  setReloadVersion((version) => version + 1);
                  setError("");
                  setBusy(false);
                }}
              >
                Reload team leader
              </button>
            </div>
          )}
          {!(mode === "branch" && person.agents > 0) && (
            <div className="assignment-actions wide">
              {review && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setReview(null)}
                >
                  Back to edit
                </button>
              )}
              <button
                className="primary"
                disabled={busy || (mode === "branch" && person.agents > 0)}
              >
                {busy
                  ? "Saving…"
                  : mode === "branch"
                    ? review
                      ? "Confirm branch change"
                      : "Review branch change"
                    : "Save team leader details"}
              </button>
            </div>
          )}
        </form>
      )}
    </Drawer>
  );
}

export default function OrganizationSetup({
  initial,
  initialBranchId,
  onClose,
  assignExisting = false,
}: {
  initial: Kind;
  initialBranchId?: string;
  onClose: () => void;
  assignExisting?: boolean;
}) {
  const cache = useQueryClient();
  const navigate = useNavigate();
  const scope = useBranchScope();
  const directory = useQuery<Row>({
    queryKey: ["organization"],
    queryFn: () => api("/organization"),
  });
  const kind = initial;
  const { user } = useContext(Context);
  const [branchLocation, setBranchLocation] =
    useState<BranchLocationValue | null>(null);
  const [branch, setBranch] = useState(initialBranchId || scope.branch);
  const [leader, setLeader] = useState("");
  const [existingLeader, setExistingLeader] = useState(assignExisting);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const branchLeaders: Row[] = (directory.data?.leaders || []).filter(
    (person: Row) => person.branch_id === branch,
  );
  const selectedLeader = branchLeaders.some((person) => person.id === leader)
    ? leader
    : branchLeaders.length === 1
      ? branchLeaders[0].id
      : "";
  return (
    <Drawer
      title={
        kind === "branches"
          ? "Add branch"
          : kind === "teams"
            ? "Add team leader"
            : "Add sales agent"
      }
      onClose={() => !busy && onClose()}
    >
      {directory.isPending ? (
        <Loading />
      ) : directory.error ? (
        <ErrorState error={directory.error} retry={directory.refetch} />
      ) : (
        <>
          <p className="setup-sequence">
            1. Create branch <span>→</span> 2. Add or assign team leader{" "}
            <span>→</span> 3. Add sales agent
          </p>
          {kind === "teams" && (
            <div
              className="assignment-actions setup-leader-mode"
              role="group"
              aria-label="Team leader account type"
            >
              <button
                type="button"
                aria-pressed={!existingLeader}
                hidden={user.role !== "Administrator"}
                disabled={busy}
                onClick={() => {
                  setExistingLeader(false);
                  setError("");
                }}
              >
                Create new team leader
              </button>
              <button
                type="button"
                aria-pressed={existingLeader}
                disabled={busy}
                onClick={() => {
                  setExistingLeader(true);
                  setError("");
                }}
              >
                Assign existing team leader
              </button>
            </div>
          )}
          {success && (
            <p className="setup-success" role="status">
              {success}
            </p>
          )}
          {kind === "teams" && existingLeader ? (
            <section className="branch-leader-management">
              <label>
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
              {branch ? (
                <BranchLeaderEditor branchId={branch} />
              ) : (
                <p className="assignment-help">
                  Choose the branch that will receive this team leader.
                </p>
              )}
            </section>
          ) : (
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
                      ? {
                          name: values.name,
                          ...(branchLocation
                            ? {
                                location: branchLocationPayload(branchLocation),
                              }
                            : {}),
                        }
                      : {
                          ...values,
                          branch_id: branch,
                          ...(kind === "agents"
                            ? { target: Number(values.target) }
                            : {}),
                        },
                  );
                  if (kind === "branches") {
                    setBranchLocation(null);
                    setBranch(created.id);
                    setLeader("");
                    setExistingLeader(false);
                  } else if (kind === "teams") {
                    setLeader(created.id);
                  }
                  form.reset();
                  await cache.invalidateQueries();
                  setSuccess(
                    kind === "branches"
                      ? user.role === "Administrator"
                        ? "Branch created. Add or assign leaders from Team leaders."
                        : "Branch created. Ask the Super admin to create staff accounts."
                      : kind === "teams"
                        ? "Team leader assigned. Add sales agents from Sales agents."
                        : "Sales agent created and assigned to the branch.",
                  );
                } catch (failure: any) {
                  setError(failure.message);
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
                    onChange={(event) => {
                      setBranch(event.target.value);
                      setLeader("");
                      setSuccess("");
                    }}
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
                user.permissions.includes("location.manage") && (
                  <BranchLocationFields
                    value={branchLocation}
                    onChange={setBranchLocation}
                    optional
                    busy={busy}
                  />
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
                      name="leader_id"
                      required
                      disabled={!branchLeaders.length}
                      value={selectedLeader}
                      onChange={(event) => setLeader(event.target.value)}
                    >
                      <option value="">
                        {branchLeaders.length
                          ? "Select team leader"
                          : branch
                            ? "Add a team leader first"
                            : "Select a branch first"}
                      </option>
                      {branchLeaders.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {branch && !branchLeaders.length && (
                    <button
                      className="wide"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        onClose();
                        navigate("/team-leaders");
                        setError("");
                        setSuccess("");
                      }}
                    >
                      Add team leader to this branch
                    </button>
                  )}
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
              <button
                className="primary"
                disabled={busy || (kind === "agents" && !selectedLeader)}
              >
                {busy
                  ? "Saving…"
                  : `Create ${kind === "branches" ? "branch" : kind === "teams" ? "team leader" : "sales agent"}`}
              </button>
            </form>
          )}
        </>
      )}
    </Drawer>
  );
}
