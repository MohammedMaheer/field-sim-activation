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
import { ErrorState, Loading } from "./components";
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
    queryKey: ["sales-management", "calls", branch],
    queryFn: () => api(`/sales-management/calls?${branchQuery}`),
    enabled: !!historySale,
  });
  const previousBranch = useRef(branch);
  useEffect(() => {
    if (previousBranch.current !== branch) {
      previousBranch.current = branch;
      setSelected(null);
      setHistorySale(null);
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
      filter === "all" ||
      (filter === "ready"
        ? ["PENDING", "FAILED"].includes(task.status)
        : filter === "blocked"
          ? task.status === "BLOCKED"
          : ["COMPLETED", "SKIPPED", "CANCELLED"].includes(task.status)),
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
    if (!selected || !canRecord(selected)) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
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
      setBusy(false);
    }
  }
  async function defer(task: Row) {
    const reason = window.prompt(
      "Technical reason for postponing tele-verification until the next day",
    );
    if (!reason || reason.trim().length < 5) return;
    setBusy(true);
    setError("");
    try {
      await post(`/sales-management/sales/${task.sale_id}/calls/defer-tele`, {
        reason,
      });
      await refresh();
      notify("Tele-verification postponed until the next day");
    } catch (e: any) {
      setError(e.message);
    } finally {
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
      {error && (
        <div className="sales-error" role="alert">
          {error}
        </div>
      )}
      {historySale && (
        <section className="panel sales-section">
          <div className="sales-section-head">
            <h2>Call history · {historySale.customer_name}</h2>
            <button onClick={() => setHistorySale(null)}>Close history</button>
          </div>
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
                  <b>{attempt.outcome.replaceAll("_", " ")}</b>
                  <p>{attempt.remark}</p>
                  <small>
                    {attempt.actor} · {new Date(attempt.at).toLocaleString()}
                  </small>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
      {selected && canRecord(selected) && (
        <form
          className="sales-form compact"
          onSubmit={save}
          aria-label="Record call outcome"
        >
          <h2 className="wide">
            {selected.customer_name} ·{" "}
            {selected.stage === "TELE_VERIFICATION"
              ? "Tele-verification"
              : "Welcome call"}
          </h2>
          <label>
            Outcome
            <select name="outcome" required>
              <option value="">Select outcome</option>
              {(selected.stage === "TELE_VERIFICATION"
                ? ["PASSED", "NO_ANSWER", "RETRY", "REACHED", "FAILED"]
                : ["REACHED", "PASSED", "NO_ANSWER", "RETRY", "FAILED"]
              ).map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="wide">
            Call remark
            <textarea name="remark" required minLength={3} maxLength={1000} />
          </label>
          <button className="primary" disabled={busy}>
            Save outcome
          </button>
          <button type="button" onClick={closeSelection}>
            Cancel
          </button>
        </form>
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
                    Last outcome: {task.last_outcome.replaceAll("_", " ")}
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
                  <button onClick={() => setHistorySale(task)}>History</button>
                  {canRecord(task) && (
                    <button
                      className="primary"
                      onClick={() => setSelected(task)}
                    >
                      <PhoneCall size={15} /> Record call
                    </button>
                  )}
                  {task.stage === "TELE_VERIFICATION" &&
                    ["PENDING", "FAILED"].includes(task.status) &&
                    canTele &&
                    !task.deferred && (
                      <button disabled={busy} onClick={() => defer(task)}>
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
