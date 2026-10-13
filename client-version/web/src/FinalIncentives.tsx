import { useContext, useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Context } from "./App";
import { useBranchScope, salesAgentRole } from "./BranchScope";
import { api, post, download, Row } from "./api";
import { businessDate } from "./businessTime";
import ExportActions from "./ExportActions";
import { ErrorState, Loading } from "./components";

export default function FinalIncentives() {
  const { user, notify } = useContext(Context),
    { branch } = useBranchScope(),
    cache = useQueryClient();
  const [from, setFrom] = useState(() => businessDate().slice(0, 7) + "-01"),
    [to, setTo] = useState(businessDate),
    [subject, setSubject] = useState(""),
    [leader, setLeader] = useState("");
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const canWrite =
    ["Administrator", "Operations Manager"].includes(user.role) &&
    user.permissions.includes("incentive.write");
  const fileInput = useRef<HTMLInputElement>(null);
  const processing = useRef(false);
  useEffect(() => {
    setSubject("");
    setLeader("");
  }, [branch, user.id]);
  const query = new URLSearchParams({
    from_date: from,
    to_date: to,
    branch_id: branch,
    user_id: subject,
    leader_id: leader,
  }).toString();
  const data = useQuery<Row[]>({
    queryKey: ["incentives", "final", user.id, query],
    queryFn: () => api("/incentives/final?" + query),
    enabled: !!from && !!to && from <= to,
  });
  const people = useQuery<Row[]>({
    queryKey: ["commissions", "subjects", user.id, branch],
    queryFn: () =>
      api("/commissions/subjects?branch_id=" + encodeURIComponent(branch)),
  });
  const process = async (apply: boolean) => {
    if (!file || processing.current) return;
    processing.current = true;
    setBusy(true);
    setError("");
    try {
      if (file.size > 2_000_000)
        throw new Error("Choose an Excel or CSV file under 2 MB.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const response = await post("/incentives/final/import", {
        filename: file.name,
        content_base64: btoa(binary),
        apply,
      });
      if (apply) {
        setPreview(null);
        setFile(null);
        if (fileInput.current) fileInput.current.value = "";
        await cache.invalidateQueries({ queryKey: ["incentives"] });
        notify(
          `${response.count} final amounts imported · ${response.already_recorded} already recorded`,
        );
      } else setPreview(response);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Import failed.");
    } finally {
      processing.current = false;
      setBusy(false);
    }
  };
  const rows = data.data || [];
  return (
    <section
      className="panel sales-section"
      aria-label="Final incentive tracking"
    >
      <div className="sales-section-head">
        <div>
          <h2>Final commission amounts</h2>
          <p>
            Import approved final amounts for sales agents and team leaders.
            These totals exclude calculated estimates.
          </p>
        </div>
        <ExportActions
          path={"/incentives/final/export?" + query}
          name="qanawat-final-incentives"
          label="Export final amounts"
        />
      </div>
      <div className="sales-form compact">
        <label>
          From date
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          To date
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label>
          Sales agent / team leader
          <select value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="">All authorized accounts</option>
            {people.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {salesAgentRole(p.role)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Assigned team leader
          <select value={leader} onChange={(e) => setLeader(e.target.value)}>
            <option value="">All authorized team leaders</option>
            {people.data
              ?.filter((p) => p.role === "Team Leader")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      {from > to && (
        <p role="alert">From date must be before or equal to To date.</p>
      )}
      {canWrite && (
        <div className="sales-form compact">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              download(
                "/incentives/final/template",
                "qanawat-final-commissions-template.xlsx",
              ).catch((e) => setError(e.message))
            }
          >
            Excel template
          </button>
          <label>
            Final amounts Excel / CSV
            <input
              aria-label="Final commission file"
              type="file"
              ref={fileInput}
              accept=".xlsx,.csv"
              disabled={busy}
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setPreview(null);
                setError("");
              }}
            />
          </label>
          <button
            className="primary"
            disabled={busy || !file}
            onClick={() => process(false)}
          >
            {busy ? "Checking…" : "Preview import"}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="sales-error">
          {error}
        </p>
      )}
      {preview && (
        <div className="sales-preview">
          <h3>Review final amounts</h3>
          <p>
            {preview.new_rows} new entries · AED{" "}
            {Number(preview.total_amount).toFixed(2)} ·{" "}
            {preview.already_recorded} already recorded
          </p>
          <ul>
            {preview.rows?.map((r: Row, i: number) => (
              <li key={i}>
                {r.name} · {r.earned_on} · AED {r.amount} · {r.reference}
              </li>
            ))}
          </ul>
          <button
            className="primary"
            disabled={busy}
            onClick={() => process(true)}
          >
            Import approved final amounts
          </button>
        </div>
      )}
      <p>
        <b>
          Recorded total: AED{" "}
          {rows.reduce((sum, row) => sum + Number(row.amount), 0).toFixed(2)}
        </b>{" "}
        · {rows.length} entries
      </p>
      {data.error ? (
        <ErrorState error={data.error} retry={data.refetch} />
      ) : data.isPending && data.fetchStatus === "fetching" ? (
        <Loading />
      ) : !rows.length ? (
        <p>No final amounts recorded for these filters.</p>
      ) : (
        <div className="sales-table-wrap">
          <table className="sales-table">
            <thead>
              <tr>
                {[
                  "Earned date",
                  "Name / role",
                  "Branch / leader",
                  "Final amount",
                  "Reference / note",
                ].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.earned_on}</td>
                  <td>
                    {row.name}
                    <small>{salesAgentRole(row.role)}</small>
                  </td>
                  <td>
                    {row.branch}
                    <small>{row.team_leader}</small>
                  </td>
                  <td>AED {Number(row.amount).toFixed(2)}</td>
                  <td>
                    {row.reference}
                    <small>{row.note}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
