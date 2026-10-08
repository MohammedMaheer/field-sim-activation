import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, Row } from "./api";
import { Drawer, ErrorState, Loading } from "./components";

const names: Record<string, string> = {
  monthly_target: "Monthly target",
  mnp_target: "MNP target",
  elife_target: "eLife target",
  contract_share_percent: "Contract sales %",
  quality_percent: "Quality %",
  disconnection_percent: "Disconnections %",
  mrc_eligibility_floor: "MRC eligibility floor",
  mbo_below185_multiplier: "Below AED 185 multiplier",
  payout_share_percent: "Payout share %",
  metric_definition: "Eligibility metric definition",
  elife_attainment_basis: "eLife achievement basis",
  mbo_uplift_mode: "MBO uplift calculation",
  gate_mode: "Gate calculation",
  gate_allocation: "Gate allocation",
  gate_disconnection_mode: "Gate disconnections",
  gate_enabled: "Gate entitlement applies",
  gate_entitlement_confirmed: "Gate entitlement approved",
  disconnected_sales_confirmed: "Disconnection list approved",
  payout_share_confirmed: "Payout share approved",
  staff_bands_confirmed: "Staff bands approved",
  mrc_thresholds: "Six MRC thresholds",
  staff_gate_targets: "Two staff gate targets",
  disconnected_sale_ids: "Disconnected sale IDs",
  gate_disconnected_sale_ids: "Gate disconnected sale IDs",
  gate_scope_branch_ids: "Gate branch scope",
  plan_slabs: "Plan slab mappings",
  elife_plan_codes: "eLife package mappings",
};
const numeric = [
  "monthly_target",
  "mnp_target",
  "elife_target",
  "contract_share_percent",
  "quality_percent",
  "disconnection_percent",
  "mrc_eligibility_floor",
  "mbo_below185_multiplier",
  "payout_share_percent",
];
const enumerated: Record<string, string[]> = {
  elife_attainment_basis: ["POSTPAID", "ELIFE"],
  mbo_uplift_mode: ["HIGHER_ONLY", "CUMULATIVE"],
  gate_mode: ["HIGHEST_ONLY", "ADDITIVE"],
  gate_allocation: ["CONTRIBUTION", "OWN_SALES"],
  gate_disconnection_mode: ["INCLUDE", "EXCLUDE"],
};
const booleans = [
  "gate_enabled",
  "gate_entitlement_confirmed",
  "disconnected_sales_confirmed",
  "payout_share_confirmed",
  "staff_bands_confirmed",
];
const lists = [
  "mrc_thresholds",
  "staff_gate_targets",
  "disconnected_sale_ids",
  "gate_disconnected_sale_ids",
];
export function commissionAmount(row: Row) {
  return row.amount == null
    ? "Awaiting configuration"
    : `AED ${Number(row.amount).toFixed(2)}`;
}
function human(value: unknown) {
  return String(value ?? "")
    .split("_")
    .join(" ");
}

function rateLabel(value: string) {
  return (
    (
      {
        NEW: "New postpaid",
        MNP: "MNP",
        P2P: "P2P",
        HW: "Home Wireless",
        ELIFE: "eLife",
        SLAB_1: "Slab 1",
        SLAB_2: "Slab 2",
        SLAB_3: "Slab 3",
        GATE_1: "Gate 1",
        GATE_2: "Gate 2",
        "2P_299": "2P · AED 299",
        "3P_389": "3P · AED 389",
        "3P_NEO_399": "3P Neo · AED 399",
        "3P_429": "3P · AED 429",
        "3P_515": "3P · AED 515",
        "3P_639": "3P · AED 639",
      } as Record<string, string>
    )[value] || human(value)
  );
}

function RateTable({ policy }: { policy: Row }) {
  const bands = policy.rules?.bands || [];
  const rates: { label: string; values: unknown[] }[] = [];
  function visit(value: unknown, label: string) {
    if (Array.isArray(value))
      rates.push({ label: label || "Per sale", values: value });
    else if (value && typeof value === "object")
      for (const [key, item] of Object.entries(value))
        visit(item, [label, rateLabel(key)].filter(Boolean).join(" · "));
    else if (value != null) rates.push({ label, values: [value] });
  }
  visit(policy.rules?.monthly_rates, "");
  if (policy.rules?.elife_rates) visit(policy.rules.elife_rates, "eLife");
  const gates = Object.entries(
    (policy.rules?.gate_rates || {}) as Record<string, Row>,
  );
  const hasSlabBonus = gates.some(([, rate]) => rate.slab3_mrc_percent != null);
  return (
    <details className="commission-policy">
      <summary>
        {policy.name}
        <small>
          Effective {policy.valid_from}
          {policy.valid_until
            ? ` to ${policy.valid_until}`
            : " · Until further notice"}
        </small>
      </summary>
      {rates.length > 0 && (
        <>
          <h4>Monthly rates · AED per sale</h4>
          <div
            className="sales-table-wrap"
            style={{ border: "1px solid #e4dbee", borderRadius: 12 }}
          >
            <table className="sales-table">
              <thead>
                <tr>
                  <th>Product / slab</th>
                  {(bands.length ? bands : ["Rate"]).map(
                    (band: unknown, index: number) => (
                      <th key={index}>
                        {typeof band === "number"
                          ? `${band}% attainment`
                          : String(band)}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {rates.map((rate) => (
                  <tr key={rate.label}>
                    <td>{rate.label}</td>
                    {rate.values.map((value, index) => (
                      <td key={index}>AED {String(value)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {gates.length > 0 && (
        <>
          <h4>Gate rates · AED per sale</h4>
          <div
            className="sales-table-wrap"
            style={{ border: "1px solid #e4dbee", borderRadius: 12 }}
          >
            <table className="sales-table">
              <thead>
                <tr>
                  <th>Gate</th>
                  <th>Target</th>
                  <th>MNP</th>
                  <th>New</th>
                  <th>P2P</th>
                  {hasSlabBonus && <th>Slab 3 bonus</th>}
                </tr>
              </thead>
              <tbody>
                {gates.map(([gate, rate]) => (
                  <tr key={gate}>
                    <td>{rateLabel(gate)}</td>
                    <td>
                      {rate.target == null
                        ? "Configured per kiosk"
                        : `${rate.target} sales`}
                    </td>
                    <td>AED {rate.MNP}</td>
                    <td>AED {rate.NEW}</td>
                    <td>AED {rate.P2P}</td>
                    {hasSlabBonus && (
                      <td>
                        {rate.slab3_mrc_percent == null
                          ? "Not applicable"
                          : `${rate.slab3_mrc_percent}% of monthly charge`}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <ul>
        {(policy.rules?.notes || []).map((note: string) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </details>
  );
}

function Configuration({
  row,
  period,
  policies,
  onClose,
  onSaved,
}: {
  row: Row;
  period: string;
  policies: Row[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [policy, setPolicy] = useState(
    row.configuration?.policy_id || row.policy_id || "",
  );
  const [inputs, setInputs] = useState<Row>({ ...row.configuration?.inputs });
  const [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const plans = useQuery<Row[]>({
    queryKey: ["plans"],
    queryFn: () => api("/resources/plans"),
  });
  const branches = useQuery<Row[]>({
    queryKey: ["branches"],
    queryFn: () => api("/resources/branches"),
  });
  const change = (key: string, value: unknown) =>
    setInputs({ ...inputs, [key]: value });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/commissions/configurations/${row.user_id}/${period}`, {
        method: "PUT",
        body: JSON.stringify({
          policy_id: policy,
          version: row.configuration?.version || 0,
          inputs,
          reason,
        }),
      });
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save configuration");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Drawer
      title={`Commission setup · ${row.name}`}
      onClose={() => !busy && onClose()}
    >
      <form className="sales-form compact commission-config" onSubmit={save}>
        <label className="wide">
          Policy
          <select
            aria-label="Policy"
            required
            value={policy}
            onChange={(e) => setPolicy(e.target.value)}
          >
            <option value="">Choose approved policy</option>
            {policies
              .filter((p) =>
                row.role === "Field Agent"
                  ? p.family === "MBO_STAFF"
                  : row.role === "Sales Manager"
                    ? p.family === "SM_GATE"
                    : ["MBO_TL", "POSTPAID_TL"].includes(p.family),
              )
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        <div className="wide">
          {row.missing_inputs?.length > 0 && (
            <p className="stock-alert">
              {row.missing_inputs
                .map((key: string) => names[key] || human(key))
                .join(" · ")}
            </p>
          )}
        </div>
        <details className="wide" open>
          <summary>Targets and eligibility</summary>
          <div className="sales-form compact">
            {numeric.map((key) => (
              <label key={key}>
                {names[key]}
                <input
                  type="number"
                  step="any"
                  min={key.includes("target") ? "0.01" : "0"}
                  max={key.includes("percent") ? "100" : undefined}
                  value={inputs[key] ?? ""}
                  onChange={(e) =>
                    change(key, e.target.value === "" ? null : e.target.value)
                  }
                />
              </label>
            ))}
            <label className="wide">
              {names.metric_definition}
              <textarea
                value={inputs.metric_definition || ""}
                maxLength={1000}
                onChange={(e) => change("metric_definition", e.target.value)}
              />
            </label>
          </div>
        </details>
        <details className="wide">
          <summary>Approved payout and gate rules</summary>
          <div className="sales-form compact">
            {Object.entries(enumerated).map(([key, options]) => (
              <label key={key}>
                {names[key]}
                <select
                  value={inputs[key] ?? ""}
                  onChange={(e) => change(key, e.target.value || null)}
                >
                  <option value="">Not configured</option>
                  {options.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
            ))}
            {booleans.map((key) => (
              <label key={key}>
                {names[key]}
                <select
                  value={inputs[key] == null ? "" : String(inputs[key])}
                  onChange={(e) => {
                    if (e.target.value === "") {
                      const next = { ...inputs };
                      delete next[key];
                      setInputs(next);
                    } else change(key, e.target.value === "true");
                  }}
                >
                  <option value="">Not confirmed</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </label>
            ))}
            {lists.map((key) => (
              <label key={key}>
                {names[key]}
                <input
                  value={(inputs[key] || []).join(", ")}
                  onChange={(e) =>
                    change(
                      key,
                      e.target.value
                        .split(",")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    )
                  }
                />
              </label>
            ))}
            <label className="wide">
              {names.gate_scope_branch_ids}
              <select
                multiple
                value={inputs.gate_scope_branch_ids || []}
                onChange={(e) =>
                  change(
                    "gate_scope_branch_ids",
                    Array.from(
                      e.target.selectedOptions,
                      (option) => option.value,
                    ),
                  )
                }
              >
                {branches.data?.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </details>
        <details className="wide">
          <summary>Plan slab mappings</summary>
          <div className="sales-form compact">
            {plans.data?.map((plan) => (
              <label key={plan.id}>
                {plan.name}
                <select
                  value={inputs.plan_slabs?.[plan.name] || ""}
                  onChange={(e) => {
                    const mappings = { ...inputs.plan_slabs };
                    if (e.target.value) mappings[plan.name] = e.target.value;
                    else delete mappings[plan.name];
                    change("plan_slabs", mappings);
                  }}
                >
                  <option value="">Not mapped</option>
                  {["SLAB_1", "SLAB_2", "SLAB_3"].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </details>
        <details className="wide">
          <summary>eLife package mappings</summary>
          <div className="sales-form compact">
            {plans.data?.map((plan) => (
              <label key={plan.id}>
                {plan.name}
                <select
                  value={inputs.elife_plan_codes?.[plan.name] || ""}
                  onChange={(e) => {
                    const mappings = { ...inputs.elife_plan_codes };
                    if (e.target.value) mappings[plan.name] = e.target.value;
                    else delete mappings[plan.name];
                    change("elife_plan_codes", mappings);
                  }}
                >
                  <option value="">Not mapped</option>
                  {[
                    "2P_299",
                    "3P_389",
                    "3P_NEO_399",
                    "3P_429",
                    "3P_515",
                    "3P_639",
                  ].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </details>
        <label className="wide">
          Approval note
          <input
            required
            minLength={5}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="wide sales-error">
            {error}
          </p>
        )}
        <button className="primary wide" disabled={busy || !policy}>
          {busy ? "Saving…" : "Save approved configuration"}
        </button>
      </form>
    </Drawer>
  );
}

export default function CommissionCalculations({ period }: { period: string }) {
  const cache = useQueryClient(),
    [selected, setSelected] = useState<Row | null>(null),
    [editing, setEditing] = useState<Row | null>(null);
  const policies = useQuery<Row[]>({
    queryKey: ["commissions", "policies"],
    queryFn: () => api("/commissions/policies"),
  });
  const summary = useQuery<Row>({
    queryKey: ["commissions", "summary", period],
    queryFn: () =>
      api(`/commissions/summary?period=${encodeURIComponent(period)}`),
    refetchInterval: 20000,
  });
  async function refresh() {
    await cache.invalidateQueries({ queryKey: ["commissions"] });
  }
  return (
    <section className="commission-workspace">
      <h2>Commission calculations</h2>
      {summary.isPending ? (
        <Loading />
      ) : summary.error ? (
        <ErrorState error={summary.error} retry={summary.refetch} />
      ) : (
        <div className="sales-table-wrap">
          <table className="sales-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Policy</th>
                <th>Net sales</th>
                <th>Commission</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {(summary.data?.rows || []).map((row: Row) => (
                <tr key={row.user_id}>
                  <td>
                    {row.name}
                    <small>{row.role}</small>
                  </td>
                  <td>{row.policy_name || "Not configured"}</td>
                  <td>
                    {row.net_sales}
                    <small>{row.cancelled} cancelled</small>
                  </td>
                  <td>
                    {commissionAmount(row)}
                    <small>{human(row.status)}</small>
                  </td>
                  <td>
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                        alignItems: "center",
                      }}
                    >
                      <button onClick={() => setSelected(row)}>
                        Breakdown
                      </button>
                      {summary.data?.can_configure && (
                        <button onClick={() => setEditing(row)}>
                          Configure
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <details className="commission-policies">
        <summary>Approved incentive tables</summary>
        {policies.isPending ? (
          <Loading />
        ) : policies.error ? (
          <ErrorState error={policies.error} retry={policies.refetch} />
        ) : (
          policies.data?.map((policy) => (
            <RateTable key={policy.id} policy={policy} />
          ))
        )}
      </details>
      {selected && (
        <Drawer
          title={`Commission breakdown · ${selected.name}`}
          onClose={() => setSelected(null)}
        >
          <h3>{commissionAmount(selected)}</h3>
          {(selected.components || []).map((component: Row, index: number) => (
            <section className="panel sales-section" key={index}>
              <h4>{human(component.name)}</h4>
              <strong>
                {component.amount == null
                  ? "Awaiting configuration"
                  : `AED ${component.amount}`}
              </strong>
              <p>{component.reason || human(component.status)}</p>
              {component.missing_inputs?.length > 0 && (
                <ul>
                  {component.missing_inputs.map((input: string) => (
                    <li key={input}>{names[input] || human(input)}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </Drawer>
      )}
      {editing && (
        <Configuration
          key={`${editing.user_id}-${period}`}
          row={editing}
          period={period}
          policies={policies.data || []}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
    </section>
  );
}
