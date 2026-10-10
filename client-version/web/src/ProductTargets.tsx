import { useState } from "react";
import { api, Row } from "./api";

export const productNames: Record<string, string> = {
  NEW: "New postpaid",
  MNP: "MNP",
  P2P: "Prepaid to postpaid",
  HW: "Home Wireless",
  ELIFE: "eLife",
  WASEL: "Wasel / Prepaid",
  VISITOR: "Visitor",
};

export function DailyProductTargets({ rows = [] }: { rows?: Row[] }) {
  return (
    <section
      className="product-target-summary panel"
      aria-label="Daily targets by product"
    >
      <h2>Daily targets by product</h2>
      <div className="product-target-grid">
        {Object.entries(productNames).map(([type, name]) => {
          const row = rows.find((item) => item.order_type === type);
          return (
            <div key={type}>
              <span>{name}</span>
              <b>{row?.target ?? "Not configured"}</b>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function ProductTargetManagement({
  agents,
  rows,
  period,
  canEdit,
  initialAgent = "",
  onSaved,
}: {
  agents: Row[];
  rows: Row[];
  period: string;
  canEdit: boolean;
  initialAgent?: string;
  onSaved: () => Promise<unknown>;
}) {
  const [selected, setSelected] = useState(initialAgent || agents[0]?.id || "");
  const active = agents.find((person) => person.id === selected) || agents[0];
  const agentId = active?.id || "";
  return (
    <section
      className="product-target-management"
      aria-label="Product target management"
    >
      <label>
        Sales agent
        <select
          value={agentId}
          onChange={(event) => setSelected(event.target.value)}
        >
          {agents.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      </label>
      {!active ? (
        <p>No sales agents in this branch.</p>
      ) : (
        <div className="sales-table-wrap">
          <table className="sales-table target-editor-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Daily target</th>
                <th>Monthly target</th>
                {canEdit && active.employment_status !== "EXITED" && (
                  <th>Action</th>
                )}
              </tr>
            </thead>
            <tbody>
              {Object.entries({
                ALL: "Total · all products",
                ...productNames,
              }).map(([type, name]) => {
                const row = rows.find(
                  (item) =>
                    item.agent_id === agentId && item.order_type === type,
                );
                return (
                  <TargetRow
                    key={`${agentId}-${type}-${period}-${row?.daily_target}-${row?.monthly_target}`}
                    name={name}
                    type={type}
                    agentId={agentId}
                    period={period}
                    row={row}
                    canEdit={canEdit && active.employment_status !== "EXITED"}
                    onSaved={onSaved}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function TargetRow({
  name,
  type,
  agentId,
  period,
  row,
  canEdit,
  onSaved,
}: {
  name: string;
  type: string;
  agentId: string;
  period: string;
  row?: Row;
  canEdit: boolean;
  onSaved: () => Promise<unknown>;
}) {
  const id = `target-${agentId}-${type}`;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <tr>
      <td>
        <b>{name}</b>
        {!row && <small>Not configured</small>}
        {error && (
          <small className="form-error" role="alert">
            {error}
          </small>
        )}
        {canEdit && (
          <form
            id={id}
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError("");
              const values = Object.fromEntries(
                new FormData(event.currentTarget),
              );
              try {
                await api("/sales-management/targets", {
                  method: "PUT",
                  body: JSON.stringify({
                    agent_id: agentId,
                    order_type: type,
                    period,
                    daily_target: Number(values.daily_target),
                    monthly_target: Number(values.monthly_target),
                  }),
                });
                await onSaved();
              } catch (failure: any) {
                setError(failure.message);
              } finally {
                setBusy(false);
              }
            }}
          />
        )}
      </td>
      <td>
        {canEdit ? (
          <input
            form={id}
            name="daily_target"
            aria-label={`${name} daily target`}
            type="number"
            min={0}
            max={1000}
            required
            defaultValue={row?.daily_target ?? ""}
            placeholder="Not set"
          />
        ) : (
          (row?.daily_target ?? "Not configured")
        )}
      </td>
      <td>
        {canEdit ? (
          <input
            form={id}
            name="monthly_target"
            aria-label={`${name} monthly target`}
            type="number"
            min={0}
            max={10000}
            required
            defaultValue={row?.monthly_target ?? ""}
            placeholder="Not set"
          />
        ) : (
          (row?.monthly_target ?? "Not configured")
        )}
      </td>
      {canEdit && (
        <td>
          <button form={id} className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </td>
      )}
    </tr>
  );
}
