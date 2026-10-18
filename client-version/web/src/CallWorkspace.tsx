import { useBranchScope } from "./BranchScope";
import { useSearchParams } from "react-router-dom";
import { useContext, useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BellRing,
  CheckCircle2,
  Clock3,
  PhoneCall,
  RefreshCw,
} from "lucide-react";
import { Context } from "./App";
import { api, post, Row } from "./api";
import { Drawer, ErrorState, Loading } from "./components";
import "./sales-management.css";

type Filter = "ready" | "blocked" | "done" | "all";

export default function CallWorkspace({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const { user, notify } = useContext(Context);
  const client = useQueryClient();
  const { branch } = useBranchScope();
  const branchQuery = `branch_id=${encodeURIComponent(branch)}`;
  const [filter, setFilter] = useState<Filter>("ready");
  const [selected, setSelected] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [historySale, setHistorySale] = useState<Row | null>(null);
  const [postponing, setPostponing] = useState<Row | null>(null);
  const [reason, setReason] = useState("");
  const [search, setSearch] = useState("");
  const saving = useRef(false);
  const tasks = useQuery<Row[]>({
    queryKey: ["sales-management", "call-tasks", branch],
    queryFn: () => api(`/sales-management/call-tasks?${branchQuery}`),
    refetchInterval: 15000,
  });
  const [params, setParams] = useSearchParams();
  const summary = useQuery<Row>({
    queryKey: ["sales-management", "call-summary", branch],
    queryFn: () => api(`/sales-management/call-tasks/summary?${branchQuery}`),
    refetchInterval: 15000,
  });
  const history = useQuery<Row[]>({
    queryKey: ["sales-management", "calls", branch, historySale?.sale_id],
    queryFn: () =>
      api(
        `/sales-management/calls?${branchQuery}&sale_id=${encodeURIComponent(historySale!.sale_id)}`,
      ),
    enabled: !!historySale,
  });
  const previousBranch = useRef(branch);
  useEffect(() => {
    if (previousBranch.current !== branch) {
      previousBranch.current = branch;
      setSelected(null);
      setHistorySale(null);
      setPostponing(null);
      setReason("");
      setError("");
      if (params.has("selected")) {
        const next = new URLSearchParams(params);
        next.delete("selected");
        setParams(next, { replace: true });
      }
    }
  }, [branch, params, setParams]);
  const canTele =
    user.permissions?.includes("call.tele.write") ||
    user.permissions?.includes("compliance.write");
  const canWelcome =
    user.permissions?.includes("call.welcome.write") ||
    user.permissions?.includes("compliance.write");
  const canRecord = (task: Row) =>
    (task.stage === "TELE_VERIFICATION" ? canTele : canWelcome) &&
    ["PENDING", "FAILED"].includes(task.status);
  useEffect(() => {
    const id = params.get("selected");
    const requested = id && tasks.data?.find((row) => row.id === id);
    if (
      requested &&
      (!(requested.stage === "TELE_VERIFICATION" ? canTele : canWelcome) ||
        !["PENDING", "FAILED"].includes(requested.status))
    )
      setFilter("all");
    if (tasks.data)
      setSelected((current) => {
        const task = tasks.data.find((row) => row.id === (id || current?.id));
        return task &&
          (task.stage === "TELE_VERIFICATION" ? canTele : canWelcome) &&
          ["PENDING", "FAILED"].includes(task.status)
          ? task
          : null;
      });
  }, [params, tasks.data, canTele, canWelcome]);
  function closeSelection() {
    setSelected(null);
    if (params.has("selected")) {
      const next = new URLSearchParams(params);
      next.delete("selected");
      setParams(next, { replace: true });
    }
  }
  const visible = (tasks.data || []).filter(
    (task) =>
      (!search.trim() ||
        [
          task.customer_name,
          task.request_id,
          task.msisdn,
          task.alternate_number,
          task.agent,
          task.branch,
          task.plan_name,
        ].some((value) =>
          String(value || "")
            .toLowerCase()
            .includes(search.trim().toLowerCase()),
        )) &&
      (filter === "all" ||
        (filter === "ready"
          ? ["PENDING", "FAILED"].includes(task.status)
          : filter === "blocked"
            ? task.status === "BLOCKED"
            : ["COMPLETED", "SKIPPED", "CANCELLED"].includes(task.status))),
  );
  const requestedId = params.get("selected");
  const orderedTasks = requestedId
    ? [
        ...visible.filter((task) => task.id === requestedId),
        ...visible.filter((task) => task.id !== requestedId),
      ]
    : visible;
  async function refresh() {
    await client.invalidateQueries({ queryKey: ["sales-management"] });
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !canRecord(selected) || saving.current) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await post(`/sales-management/sales/${selected.sale_id}/calls`, {
        stage: selected.stage,
        ...values,
      });
      closeSelection();
      await refresh();
      notify("Call outcome recorded");
    } catch (e: any) {
      setError(e.message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  async function defer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !postponing ||
      !canRecord(postponing) ||
      saving.current ||
      reason.trim().length < 5
    )
      return;
    const task = postponing;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await post(`/sales-management/sales/${task.sale_id}/calls/defer-tele`, {
        reason: reason.trim(),
      });
      setPostponing(null);
      setReason("");
      await refresh();
      notify("Tele-verification postponed until the next day");
    } catch (e: any) {
      setError(e.message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="sales-page call-workspace">
      {!embedded && (
        <header className="page-header">
          <div>
            <span className="eyebrow">CUSTOMER FOLLOW-UP</span>
            <h1>Call work queue</h1>
            <p>Tele-verification and welcome calls</p>
          </div>
          <button onClick={refresh}>
            <RefreshCw size={16} /> Refresh
          </button>
        </header>
      )}
      <section className="call-queue-metrics" aria-label="Call queue summary">
        <div>
          <BellRing size={18} />
          <span>Needs a call</span>
          <b>{summary.data?.actionable ?? "—"}</b>
        </div>
        <div>
          <PhoneCall size={18} />
          <span>Tele-verification</span>
          <b>{summary.data?.pending_tele ?? "—"}</b>
        </div>
        <div>
          <Clock3 size={18} />
          <span>Welcome calls</span>
          <b>{summary.data?.pending_welcome ?? "—"}</b>
        </div>
        <div>
          <CheckCircle2 size={18} />
          <span>Waiting for first call</span>
          <b>{summary.data?.blocked_welcome ?? "—"}</b>
        </div>
      </section>
      <nav className="sales-tabs" aria-label="Call queue filters">
        {(["ready", "blocked", "done", "all"] as Filter[]).map((value) => (
          <button
            key={value}
            className={filter === value ? "active" : ""}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {
              (
                {
                  ready: "Ready",
                  blocked: "Waiting",
                  done: "Completed",
                  all: "All",
                } as Record<Filter, string>
              )[value]
            }
          </button>
        ))}
      </nav>
      <div className="call-queue-search">
        <label>
          Find a call
          <input
            type="search"
            placeholder="Customer, SR / request ID or phone"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        {search && <button onClick={() => setSearch("")}>Clear search</button>}
        <span className="muted" role="status">
          {visible.length} calls in this view
        </span>
      </div>
      {error && !selected && !postponing && (
        <div className="sales-error" role="alert">
          {error}
        </div>
      )}
      {historySale && (
        <Drawer
          title={`Call history · ${historySale.customer_name}`}
          onClose={() => setHistorySale(null)}
        >
          <p>
            {historySale.request_id} ·{" "}
            {historySale.stage === "TELE_VERIFICATION"
              ? "Tele-verification"
              : "Welcome call"}
          </p>
          {history.isPending ? (
            <Loading />
          ) : history.error ? (
            <ErrorState error={history.error} retry={history.refetch} />
          ) : (
            <div className="call-history">
              {(
                history.data?.find((row) => row.id === historySale.sale_id)?.[
                  historySale.stage === "TELE_VERIFICATION"
                    ? "tele_verification"
                    : "welcome_call"
                ] || []
              ).map((attempt: Row) => (
                <article key={attempt.id}>
                  <b>{callOutcomeLabel(attempt.outcome)}</b>
                  <p>{attempt.remark}</p>
                  <small>
                    {attempt.actor} · {new Date(attempt.at).toLocaleString()}
                  </small>
                </article>
              ))}
              {!(
                history.data?.find((row) => row.id === historySale.sale_id)?.[
                  historySale.stage === "TELE_VERIFICATION"
                    ? "tele_verification"
                    : "welcome_call"
                ] || []
              ).length && (
                <p className="sales-empty">
                  No calls recorded for this stage yet.
                </p>
              )}
            </div>
          )}
        </Drawer>
      )}
      {selected && canRecord(selected) && (
        <Drawer
          title="Record call outcome"
          onClose={() => !saving.current && closeSelection()}
        >
          <CallContext task={selected} />
          <form
            key={selected.id}
            className="call-action-form"
            onSubmit={save}
            aria-label="Record call outcome"
          >
            {error && (
              <p className="sales-error" role="alert">
                {error}
              </p>
            )}
            <label>
              Outcome
              <select
                name="outcome"
                aria-label="Outcome"
                required
                disabled={busy}
              >
                <option value="">Select outcome</option>
                {(selected.stage === "TELE_VERIFICATION"
                  ? ["PASSED", "NO_ANSWER", "RETRY", "REACHED", "FAILED"]
                  : ["REACHED", "PASSED", "NO_ANSWER", "RETRY", "FAILED"]
                ).map((value) => (
                  <option key={value} value={value}>
                    {callOutcomeLabel(value)}
                  </option>
                ))}
              </select>
            </label>
            <label className="wide">
              Call remark
              <textarea
                name="remark"
                aria-label="Call remark"
                required
                minLength={3}
                maxLength={1000}
                rows={4}
                disabled={busy}
              />
            </label>
            <div className="call-form-actions">
              <button type="button" disabled={busy} onClick={closeSelection}>
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                {busy ? "Saving…" : "Save outcome"}
              </button>
            </div>
          </form>
        </Drawer>
      )}
      {postponing && (
        <Drawer
          title="Postpone tele-verification"
          onClose={() => !saving.current && setPostponing(null)}
        >
          <CallContext task={postponing} />
          <p>Technical issues only. The call will be due on the next day.</p>
          <form className="call-action-form" onSubmit={defer}>
            {error && (
              <p className="sales-error" role="alert">
                {error}
              </p>
            )}
            <label>
              Technical reason
              <textarea
                value={reason}
                aria-label="Technical reason"
                onChange={(event) => setReason(event.target.value)}
                required
                minLength={5}
                maxLength={300}
                rows={4}
                disabled={busy}
              />
            </label>
            <div className="call-form-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => setPostponing(null)}
              >
                Cancel
              </button>
              <button
                className="primary"
                disabled={busy || reason.trim().length < 5}
              >
                {busy ? "Saving…" : "Postpone to next day"}
              </button>
            </div>
          </form>
        </Drawer>
      )}
      <section className="panel sales-section">
        <h2>
          {filter === "ready"
            ? "Ready to contact"
            : filter === "blocked"
              ? "Waiting for tele-verification"
              : filter === "done"
                ? "Completed calls"
                : "All call work"}
        </h2>
        {tasks.isPending ? (
          <Loading />
        ) : tasks.error ? (
          <ErrorState error={tasks.error} retry={tasks.refetch} />
        ) : !visible.length ? (
          <p className="sales-empty">No calls in this view</p>
        ) : (
          <div className="call-task-list">
            {orderedTasks.map((task) => (
              <article key={task.id} className="call-task">
                <div>
                  <span className={`sales-status ${task.status.toLowerCase()}`}>
                    {task.status.toLowerCase().replaceAll("_", " ")}
                  </span>
                  <h3>{task.customer_name}</h3>
                  <p>
                    {task.stage === "TELE_VERIFICATION"
                      ? "Tele-verification"
                      : "Welcome call"}{" "}
                    · {task.plan_name}
                  </p>
                  <small>
                    {task.request_id} · {task.branch} · {task.agent}
                  </small>
                  <small>
                    Phone:{" "}
                    {task.msisdn || task.alternate_number || "Not recorded"}
                  </small>
                  <small>
                    Last outcome: {callOutcomeLabel(task.last_outcome)}
                  </small>
                  <small className={task.overdue ? "stock-alert" : ""}>
                    Due {task.due_date || "Not recorded"}
                    {task.overdue ? " · Overdue" : ""}
                    {task.deferred ? " · Postponed" : ""}
                  </small>
                  {task.sequence_warning && (
                    <small className="stock-alert">
                      {task.sequence_warning}
                    </small>
                  )}
                </div>
                <div className="call-task-actions">
                  <button disabled={busy} onClick={() => setHistorySale(task)}>
                    History
                  </button>
                  {canRecord(task) && (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => {
                        setError("");
                        setSelected(task);
                      }}
                    >
                      <PhoneCall size={15} /> Record call
                    </button>
                  )}
                  {task.stage === "TELE_VERIFICATION" &&
                    ["PENDING", "FAILED"].includes(task.status) &&
                    canTele &&
                    !task.deferred && (
                      <button
                        disabled={busy}
                        onClick={() => {
                          closeSelection();
                          setError("");
                          setReason("");
                          setPostponing(task);
                        }}
                      >
                        Postpone to next day
                      </button>
                    )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function callOutcomeLabel(value: string | undefined) {
  return (
    (
      {
        PASSED: "Passed",
        REACHED: "Reached",
        NO_ANSWER: "No answer",
        RETRY: "Retry needed",
        FAILED: "Failed",
      } as Record<string, string>
    )[value || ""] ||
    value?.replaceAll("_", " ") ||
    "Not started"
  );
}

function CallContext({ task }: { task: Row }) {
  return (
    <div className="call-action-context">
      <h3>{task.customer_name}</h3>
      <p>
        {task.stage === "TELE_VERIFICATION"
          ? "Tele-verification"
          : "Welcome call"}{" "}
        · {task.plan_name}
      </p>
      <dl>
        <div>
          <dt>SR / request ID</dt>
          <dd>{task.request_id || "Not recorded"}</dd>
        </div>
        <div>
          <dt>Phone</dt>
          <dd>{task.msisdn || task.alternate_number || "Not recorded"}</dd>
        </div>
      </dl>
    </div>
  );
}
