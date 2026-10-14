import { useContext, useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Context } from "./App";
import { useBranchScope, salesAgentRole } from "./BranchScope";
import { api, post, download, Row } from "./api";
import { businessDate } from "./businessTime";
import ExportActions from "./ExportActions";
import { Drawer, ErrorState, Loading } from "./components";

const money = (amount: unknown) => "AED " + Number(amount).toFixed(2);
const monthStart = () => businessDate().slice(0, 7) + "-01";
export default function FinalIncentives() {
  const { user, notify } = useContext(Context),
    { branch } = useBranchScope(),
    cache = useQueryClient();
  const [from, setFrom] = useState(monthStart),
    [to, setTo] = useState(businessDate);
  const [subject, setSubject] = useState(""),
    [leader, setLeader] = useState("");
  const [importing, setImporting] = useState(false),
    [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Row | null>(null),
    [result, setResult] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [page, setPage] = useState(0),
    [previewPage, setPreviewPage] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null),
    processing = useRef(false),
    alive = useRef(true);
  const canWrite =
    ["Administrator", "Operations Manager"].includes(user.role) &&
    user.permissions.includes("incentive.write");
  const canExport = user.permissions.includes(
    user.role === "Field Agent" ? "read" : "report.read",
  );
  const ownOnly = ["Field Agent", "Team Leader"].includes(user.role);
  const validDates =
    /^\d{4}-\d{2}-\d{2}$/.test(from) &&
    /^\d{4}-\d{2}-\d{2}$/.test(to) &&
    from <= to;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    setSubject("");
    setLeader("");
  }, [branch, user.id]);
  useEffect(() => {
    setPage(0);
  }, [from, to, subject, leader, branch]);
  const base = new URLSearchParams({
    from_date: from,
    to_date: to,
    branch_id: branch,
  }).toString();
  const query =
    ownOnly || (!subject && !leader)
      ? base
      : base +
        "&" +
        new URLSearchParams({ user_id: subject, leader_id: leader }).toString();
  const data = useQuery<Row[]>({
    queryKey: ["incentives", "final", user.id, query],
    queryFn: () => api("/incentives/final?" + query),
    enabled: validDates,
  });
  const historical = useQuery<Row[]>({
    queryKey: ["incentives", "final", user.id, base],
    queryFn: () => api("/incentives/final?" + base),
    enabled: !ownOnly && validDates,
  });
  const people = useQuery<Row[]>({
    queryKey: ["commissions", "subjects", user.id, branch],
    queryFn: () =>
      api("/commissions/subjects?branch_id=" + encodeURIComponent(branch)),
    enabled: !ownOnly,
  });
  const choices = new Map<string, Row>(
    (people.data || []).map((p) => [p.id, p]),
  );
  const leaders = new Map<string, string>();
  for (const person of people.data || [])
    if (person.role === "Team Leader") leaders.set(person.id, person.name);
  for (const row of historical.data || []) {
    choices.set(row.user_id, {
      id: row.user_id,
      name: row.name,
      role: row.role,
    });
    if (row.leader_id && row.team_leader)
      leaders.set(row.leader_id, row.team_leader);
  }
  const rows = data.data || [],
    total = rows.reduce((sum, row) => sum + Number(row.amount), 0);
  const pages = Math.max(1, Math.ceil(rows.length / 15)),
    safePage = Math.min(page, pages - 1);
  const previewRows: Row[] = preview?.file_rows || preview?.rows || [];
  const previewPages = Math.max(1, Math.ceil(previewRows.length / 8));
  function resetFile() {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError("");
    setPreviewPage(0);
    if (fileInput.current) fileInput.current.value = "";
  }
  function resetFilters() {
    setFrom(monthStart());
    setTo(businessDate());
    setSubject("");
    setLeader("");
  }
  async function process(apply: boolean) {
    if (!file || processing.current || (apply && !preview?.new_rows)) return;
    processing.current = true;
    setBusy(true);
    setError("");
    try {
      if (
        !/\.(xlsx|csv)$/i.test(file.name) ||
        file.size > 2_000_000 ||
        file.size === 0
      )
        throw new Error("Choose an Excel (.xlsx) or CSV file under 2 MB.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const response = await post("/incentives/final/import", {
        filename: file.name,
        content_base64: btoa(binary),
        apply,
      });
      if (!alive.current) return;
      if (apply) {
        setResult(response);
        setPreview(null);
        setFile(null);
        if (fileInput.current) fileInput.current.value = "";
        await cache.invalidateQueries({ queryKey: ["incentives"] });
        if (alive.current)
          notify(
            response.count +
              " commission entries imported · " +
              response.already_recorded +
              " already recorded",
          );
      } else {
        setPreview(response);
        setPreviewPage(0);
      }
    } catch (failure) {
      if (alive.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not import this file.",
        );
    } finally {
      processing.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section
      className="panel sales-section commission-final"
      aria-label="Final incentive tracking"
    >
      <div className="sales-section-head">
        <div>
          <h2>Final commission amounts</h2>
          <p>
            {ownOnly
              ? "Your approved commission entries for the selected dates."
              : "Approved amounts recorded from Excel. No calculation setup is needed."}
          </p>
        </div>
        <div className="commission-actions">
          {canExport && (
            <ExportActions
              disabled={!validDates}
              path={"/incentives/final/export?" + query}
              name="qanawat-final-incentives"
              label="Export final amounts"
            />
          )}
          {canWrite && (
            <button
              className="primary"
              onClick={() => {
                resetFile();
                setImporting(true);
              }}
            >
              Import approved amounts
            </button>
          )}
        </div>
      </div>
      <div className="commission-range" aria-label="Date shortcuts">
        <button
          type="button"
          aria-pressed={from === businessDate() && to === businessDate()}
          onClick={() => {
            setFrom(businessDate());
            setTo(businessDate());
          }}
        >
          Today
        </button>
        <button
          type="button"
          aria-pressed={from === monthStart() && to === businessDate()}
          onClick={() => {
            setFrom(monthStart());
            setTo(businessDate());
          }}
        >
          This month
        </button>
        {(subject || leader) && (
          <button
            onClick={() => {
              setSubject("");
              setLeader("");
            }}
          >
            Clear people filters
          </button>
        )}
      </div>
      <div className="sales-form compact commission-filters">
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
        {!ownOnly && (
          <>
            <label>
              Person
              <select
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              >
                <option value="">All authorized people</option>
                {[...choices.values()]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {salesAgentRole(p.role)}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Reporting team leader
              <select
                value={leader}
                onChange={(e) => setLeader(e.target.value)}
              >
                <option value="">All authorized team leaders</option>
                {[...leaders.entries()]
                  .sort((a, b) => a[1].localeCompare(b[1]))
                  .map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
              </select>
            </label>
          </>
        )}
      </div>
      {!validDates ? (
        <p role="alert" className="sales-error">
          Choose both dates. From date must be before or equal to To date.
        </p>
      ) : data.error ? (
        <ErrorState error={data.error} retry={data.refetch} />
      ) : data.isPending ? (
        <Loading />
      ) : (
        <>
          <div
            className="commission-totals"
            aria-label="Recorded commission summary"
          >
            <div>
              <span>Recorded total</span>
              <strong>{money(total)}</strong>
            </div>
            <div>
              <span>Entries</span>
              <strong>{rows.length}</strong>
            </div>
            {!ownOnly && (
              <div>
                <span>People</span>
                <strong>{new Set(rows.map((r) => r.user_id)).size}</strong>
              </div>
            )}
          </div>
          <p className="commission-help">
            Recorded commissions are separate from estimates and earlier
            records. This is not a payment status.
          </p>
          {!rows.length ? (
            <div className="commission-empty">
              <h3>No commissions recorded for these dates</h3>
              <p>
                {canWrite
                  ? "Import approved amounts or choose another date range."
                  : "Try another date range. Your admin can confirm when approved amounts will be recorded."}
              </p>
            </div>
          ) : (
            <>
              <div className="sales-table-wrap">
                <table className="sales-table">
                  <thead>
                    <tr>
                      {[
                        "Earned date",
                        "Person",
                        "Branch / leader",
                        "Final amount",
                        "Reference / note",
                      ].map((label) => (
                        <th key={label}>{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows
                      .slice(safePage * 15, (safePage + 1) * 15)
                      .map((row) => (
                        <tr key={row.id}>
                          <td>{row.earned_on}</td>
                          <td>
                            {row.name}
                            <small>{salesAgentRole(row.role)}</small>
                          </td>
                          <td>
                            {row.branch || "Not recorded"}
                            <small>
                              {row.team_leader || "No reporting leader"}
                            </small>
                          </td>
                          <td className="commission-amount">
                            {money(row.amount)}
                          </td>
                          <td>
                            {row.reference}
                            <small>{row.note}</small>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {pages > 1 && (
                <div className="commission-pagination">
                  <button
                    disabled={safePage === 0}
                    onClick={() => setPage(safePage - 1)}
                  >
                    Previous
                  </button>
                  <span>
                    Page {safePage + 1} of {pages} · {rows.length} entries
                  </span>
                  <button
                    disabled={safePage + 1 === pages}
                    onClick={() => setPage(safePage + 1)}
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
      {importing && (
        <Drawer
          title="Import approved commission amounts"
          onClose={() => {
            if (!busy) {
              setImporting(false);
              resetFile();
            }
          }}
        >
          <div className="commission-import">
            {result ? (
              <div className="commission-import-result" role="status">
                <h3>Import complete</h3>
                <p>
                  <strong>{result.count} entries added</strong> ·{" "}
                  {result.already_recorded} already recorded and skipped.
                </p>
                <p>
                  Your current date, person and branch filters may hide newly
                  imported entries.
                </p>
                <div className="commission-actions">
                  <button
                    className="primary"
                    onClick={() => {
                      resetFilters();
                      setImporting(false);
                      resetFile();
                    }}
                  >
                    View this month
                  </button>
                  <button onClick={resetFile}>Import another file</button>
                </div>
              </div>
            ) : (
              <>
                <p>
                  Import final amounts approved by your organization. Each row
                  identifies a person, date, amount and reference.
                </p>
                <section>
                  <h3>1. Prepare the file</h3>
                  <button
                    disabled={busy}
                    onClick={() =>
                      download(
                        "/incentives/final/template",
                        "qanawat-final-commissions-template.xlsx",
                      ).catch((e) => setError(e.message))
                    }
                  >
                    Download Excel template
                  </button>
                  <p>
                    Required: user_email, earned_on, amount, reference. Note is
                    optional. Use the person’s sign-in email and a unique
                    reference.
                  </p>
                </section>
                <section>
                  <h3>2. Choose and check</h3>
                  <label className="commission-file">
                    Excel or CSV · up to 2 MB
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
                        setPreviewPage(0);
                      }}
                    />
                  </label>
                  <p>
                    Filters change the list you see. The file imports every
                    valid row within your authorized scope.
                  </p>
                  <button
                    className="primary"
                    disabled={busy || !file}
                    onClick={() => process(false)}
                  >
                    {busy ? "Checking…" : "Preview import"}
                  </button>
                </section>
                {preview && (
                  <section>
                    <h3>3. Review before importing</h3>
                    <div className="commission-totals">
                      <div>
                        <span>New entries</span>
                        <strong>{preview.new_rows}</strong>
                      </div>
                      <div>
                        <span>New amount</span>
                        <strong>{money(preview.total_amount)}</strong>
                      </div>
                      <div>
                        <span>Already recorded</span>
                        <strong>{preview.already_recorded}</strong>
                      </div>
                    </div>
                    <p>
                      {preview.new_rows
                        ? "Only new entries will be added. Existing matching entries are skipped."
                        : "This file is already recorded. There is nothing new to add."}
                    </p>
                    <ul className="commission-preview-list">
                      {previewRows
                        .slice(previewPage * 8, (previewPage + 1) * 8)
                        .map((row, index) => (
                          <li
                            key={
                              String(row.row_number || index) + row.reference
                            }
                          >
                            <div>
                              <strong>{row.name}</strong>
                              <span>
                                {row.status === "ALREADY_RECORDED"
                                  ? "Already recorded"
                                  : "New entry"}{" "}
                                · Row {row.row_number || index + 2}
                              </span>
                            </div>
                            <p>
                              {row.user_email}
                              {row.role ? " · " + salesAgentRole(row.role) : ""}
                            </p>
                            <p>
                              {row.earned_on} ·{" "}
                              <strong>{money(row.amount)}</strong> ·{" "}
                              {row.reference}
                            </p>
                            <p>
                              {row.branch || "Branch not recorded"}
                              {row.team_leader ? " · " + row.team_leader : ""}
                            </p>
                            {row.note && <p>{row.note}</p>}
                          </li>
                        ))}
                    </ul>
                    {previewPages > 1 && (
                      <div className="commission-pagination">
                        <button
                          disabled={busy || previewPage === 0}
                          onClick={() => setPreviewPage(previewPage - 1)}
                        >
                          Previous rows
                        </button>
                        <span>
                          {previewPage + 1} / {previewPages}
                        </span>
                        <button
                          disabled={busy || previewPage + 1 === previewPages}
                          onClick={() => setPreviewPage(previewPage + 1)}
                        >
                          Next rows
                        </button>
                      </div>
                    )}
                    <button
                      className="primary"
                      disabled={busy || !preview.new_rows}
                      onClick={() => process(true)}
                    >
                      {busy
                        ? "Importing…"
                        : "Import " +
                          preview.new_rows +
                          " new " +
                          (preview.new_rows === 1 ? "entry" : "entries")}
                    </button>
                  </section>
                )}
              </>
            )}
            {error && (
              <p role="alert" className="sales-error">
                {error}
              </p>
            )}
          </div>
        </Drawer>
      )}
    </section>
  );
}
