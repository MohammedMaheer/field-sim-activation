import { useBranchScope } from "./BranchScope";
import { useContext, useRef } from "react";
import { Link } from "react-router-dom";
import { Context } from "./App";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { api, download, post, Row } from "./api";
import { ErrorState, Loading } from "./components";
import "./sr-verification.css";

const shown = (value: unknown, empty = "Not recorded") =>
  value === undefined || value === null || value === "" ? empty : String(value);
function SRComparison({ data, branch }: { data: Row; branch: string }) {
  const [filter, setFilter] = useState("ALL"),
    [search, setSearch] = useState("");
  const source: Row[] = (data.changes || data.items || []).filter(
    (row: Row) => !branch || row.branch_id === branch,
  );
  const counts = {
    ALL: source.length,
    MATCHED: source.filter((row) => row.to === "MATCHED").length,
    MISMATCH: source.filter((row) => row.to === "MISMATCH").length,
    PENDING_SR_VERIFICATION: source.filter(
      (row) => row.to === "PENDING_SR_VERIFICATION",
    ).length,
  };
  const rows = source.filter(
    (row) =>
      (filter === "ALL" || row.to === filter) &&
      (!search ||
        `${row.customer_name} ${row.agent} ${row.branch} ${row.sr_number} ${row.comparison?.recorded_request_id}`
          .toLowerCase()
          .includes(search.toLowerCase())),
  );
  return (
    <div className="sr-comparison" aria-label="SR comparison results">
      <div
        className="sr-comparison-filters"
        role="group"
        aria-label="Verification result filters"
      >
        {(
          [
            ["ALL", "All sales"],
            ["MISMATCH", "Mismatches"],
            ["PENDING_SR_VERIFICATION", "Pending"],
            ["MATCHED", "Matched"],
          ] as const
        ).map(([key, label]) => (
          <button
            type="button"
            key={key}
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            {label} <b>{counts[key]}</b>
          </button>
        ))}
        <label>
          <span className="sr-only">Search verification results</span>
          <input
            value={search}
            placeholder="Customer, SR, request ID or sales agent"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>
      <p className="sr-comparison-help">
        Compare the recorded sale with its uploaded report row. A related row
        found by request ID is a hint, not an SR match. Blank report fields
        remain unverified.
      </p>
      {data.truncated && (
        <p role="status" className="sales-error">
          Showing the first 5,000 sales. Select a branch to narrow the results.
        </p>
      )}
      {!rows.length ? (
        <p className="sales-empty">No sales in this result filter.</p>
      ) : (
        <div className="sales-table-wrap">
          <table className="sales-table sr-comparison-table">
            <thead>
              <tr>
                <th>Sale / sales agent</th>
                <th>SR comparison</th>
                <th>Request ID comparison</th>
                <th>Report status / location</th>
                <th>Result and reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const comparison = row.comparison || {},
                  report = comparison.report_row;
                return (
                  <tr key={row.sale_id}>
                    <td data-label="Sale and sales agent">
                      <Link
                        to={`/sales?selected=${encodeURIComponent(row.sale_id)}`}
                      >
                        {row.customer_name || "Open sale"}
                      </Link>
                      <small>
                        {row.agent || "Not recorded"} ·{" "}
                        {row.branch || "Not recorded"}
                      </small>
                    </td>
                    <td data-label="SR comparison">
                      <span>
                        <b>Recorded</b>{" "}
                        {shown(comparison.recorded_sr ?? row.sr_number)}
                      </span>
                      <span>
                        <b>Report</b>{" "}
                        {shown(
                          report?.sr_number,
                          comparison.sr_result === "NOT_RECORDED"
                            ? "SR not recorded"
                            : comparison.report_available === false ||
                                row.to === "PENDING_SR_VERIFICATION"
                              ? "Not checked"
                              : "Not found",
                        )}
                      </span>
                    </td>
                    <td data-label="Request ID comparison">
                      <span>
                        <b>Recorded</b> {shown(comparison.recorded_request_id)}
                      </span>
                      <span>
                        <b>Report</b>{" "}
                        {shown(
                          report?.request_id,
                          report ? "Not provided in report" : "Not compared",
                        )}
                      </span>
                      <small
                        className={
                          comparison.request_id_result === "MISMATCH"
                            ? "sr-difference"
                            : ""
                        }
                      >
                        {comparison.request_id_result === "MISMATCH"
                          ? "Request IDs differ"
                          : comparison.request_id_result === "MATCHED"
                            ? "Request IDs match"
                            : comparison.request_id_result ===
                                "NOT_PROVIDED_IN_REPORT"
                              ? "Request ID was not supplied in the report"
                              : "Request ID not compared"}
                      </small>
                    </td>
                    <td data-label="Report status and row">
                      <span>
                        <b>Sale</b> {shown(comparison.recorded_status)}
                      </span>
                      <span>
                        <b>Report</b>{" "}
                        {shown(
                          report?.status,
                          report ? "Not provided in report" : "Not compared",
                        )}
                      </span>
                      <small>
                        {report?.row_number
                          ? `Report row ${report.row_number}`
                          : report
                            ? "Report row number not recorded"
                            : comparison.sr_result === "NOT_RECORDED"
                              ? "Record SR to compare"
                              : row.to === "PENDING_SR_VERIFICATION"
                                ? "Awaiting comparison"
                                : "No exact SR row"}
                      </small>
                      {row.filename && <small>{row.filename}</small>}
                    </td>
                    <td data-label="Verification result">
                      <span
                        className={`sales-status ${(row.to || "PENDING_SR_VERIFICATION").toLowerCase()}`}
                      >
                        {srStatus(row.to)}
                      </span>
                      <p className="sr-result-reason">
                        {row.reason || "Daily SR report not checked"}
                      </p>
                      {row.record_changed && (
                        <p className="sr-difference">
                          Sale SR or request ID changed after this verification.
                          Reconcile the report again.
                        </p>
                      )}
                      {(comparison.related_report_rows || []).map(
                        (hint: Row, index: number) => (
                          <div
                            className="sr-related-row"
                            key={`${hint.row_number || index}:${hint.sr_number}`}
                          >
                            <b>Related row by request ID</b>
                            <span>
                              SR {shown(hint.sr_number)} ·{" "}
                              {hint.row_number
                                ? `row ${hint.row_number}`
                                : "row number not recorded"}
                            </span>
                            <small>Recorded SR does not match this row.</small>
                          </div>
                        ),
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function srStatus(value: unknown): string {
  return (
    (
      {
        MATCHED: "Matched",
        MISMATCH: "Mismatch",
        PENDING_SR_VERIFICATION: "Pending SR verification",
      } as Record<string, string>
    )[String(value)] || "Pending SR verification"
  );
}

export default function SRVerification() {
  const cache = useQueryClient();
  const { branch } = useBranchScope();
  const { user } = useContext(Context);
  const canWrite =
    user.permissions?.includes("compliance.write") &&
    ["Administrator", "Operations Manager", "Compliance Officer"].includes(
      user.role,
    );
  const [date, setDate] = useState(() =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Dubai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
  );
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState<Row | null>(null);
  const [reportMode, setReportMode] = useState("daily"),
    [month, setMonth] = useState(() => date.slice(0, 7));
  const reportQuery =
    reportMode === "monthly"
      ? `period=${encodeURIComponent(month)}`
      : `business_date=${encodeURIComponent(date)}`;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const processing = useRef(false);
  const [selectedBatch, setSelectedBatch] = useState("");
  const current = useQuery<Row>({
    queryKey: ["sales-management", "sr-results", user.id, reportQuery, branch],
    queryFn: () =>
      api(
        `/sales-management/sr/results?${reportQuery}&branch_id=${encodeURIComponent(branch)}`,
      ),
    enabled: !!(reportMode === "monthly" ? month : date),
  });
  const batch = useQuery<Row>({
    queryKey: [
      "sales-management",
      "sr-batch-details",
      user.id,
      selectedBatch,
      branch,
    ],
    queryFn: () =>
      api(
        `/sales-management/sr/batches/${encodeURIComponent(selectedBatch)}?branch_id=${encodeURIComponent(branch)}`,
      ),
    enabled: !!selectedBatch,
  });
  const email = useQuery<Row>({
    queryKey: ["sales-management", "sr-email"],
    queryFn: () => api("/sales-management/sr/email-status"),
    refetchInterval: 20000,
  });
  const batches = useQuery<Row[]>({
    queryKey: ["sales-management", "sr-batches"],
    queryFn: () => api("/sales-management/sr/batches"),
  });
  async function process(apply: boolean) {
    if (
      !file ||
      processing.current ||
      !(reportMode === "monthly" ? month : date) ||
      (apply && !preview?.preview_token)
    )
      return;
    processing.current = true;
    setBusy(true);
    setError("");
    try {
      if (
        !/\.(xlsx|csv)$/i.test(file.name) ||
        file.size > 2_000_000 ||
        !file.size
      )
        throw Error("Choose an Excel or CSV file under 2 MB.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const result = await post("/sales-management/sr/file", {
        business_date: reportMode === "daily" ? date : "",
        period: reportMode === "monthly" ? month : "",
        filename: file.name,
        content_base64: btoa(binary),
        apply,
        preview_token: apply ? preview?.preview_token : undefined,
      });
      setPreview(result);
      if (apply) {
        await Promise.all([
          cache.invalidateQueries({ queryKey: ["sales-management"] }),
          cache.invalidateQueries({ queryKey: ["kyc-capture"] }),
          cache.invalidateQueries({ queryKey: ["kyc-captures"] }),
          cache.invalidateQueries({ queryKey: ["notifications"] }),
          cache.invalidateQueries({ queryKey: ["dashboard"] }),
        ]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not verify this file.");
    } finally {
      processing.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="panel sales-section sr-verification"
      aria-label="Daily SR verification"
    >
      <div className="sales-section-head">
        <div>
          <h2>
            {reportMode === "monthly"
              ? "Monthly SR verification"
              : "Daily SR verification"}
          </h2>
          <small>
            Find the exact SR or request ID difference for each sale.
          </small>
        </div>
        <button
          disabled={busy}
          onClick={() =>
            download(
              `/sales-management/sr/template?${reportQuery}`,
              "qanawat-sr-verification.xlsx",
            ).catch((e) => setError(e.message))
          }
        >
          <Download size={16} />
          Excel template
        </button>
      </div>
      <div className="sales-form compact">
        <label>
          Report period
          <select
            value={reportMode}
            disabled={busy}
            onChange={(event) => {
              setReportMode(event.target.value);
              setPreview(null);
              setSelectedBatch("");
            }}
          >
            <option value="daily">Daily report</option>
            <option value="monthly">Monthly report</option>
          </select>
        </label>
        <label>
          {reportMode === "monthly" ? "Sales month" : "Sales date"}
          <input
            type={reportMode === "monthly" ? "month" : "date"}
            required
            disabled={busy}
            value={reportMode === "monthly" ? month : date}
            onChange={(e) => {
              if (reportMode === "monthly") setMonth(e.target.value);
              else setDate(e.target.value);
              setPreview(null);
              setSelectedBatch("");
            }}
          />
        </label>
        {canWrite && (
          <>
            <label>
              Etisalat report
              <input
                aria-label="Daily SR report"
                type="file"
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
              disabled={
                busy || !file || !(reportMode === "monthly" ? month : date)
              }
              onClick={() => process(false)}
            >
              <FileSpreadsheet size={16} />
              {busy ? "Checking…" : "Preview matches"}
            </button>
          </>
        )}
      </div>
      {canWrite && (
        <p className="sr-comparison-help">
          Applying this file checks all branches for the selected day or month.
          The selected branch only filters the comparisons shown below.
        </p>
      )}
      {!canWrite && <p className="muted">Read-only verification history</p>}
      {error && (
        <p className="sales-error" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <div className="sales-preview">
          <h3>
            {preview.applied ? "Applied report comparison" : "Report preview"}
          </h3>
          {(preview.errors || []).map((message: string, index: number) => (
            <p role="alert" key={index}>
              {message}
            </p>
          ))}
          <SRComparison data={preview} branch={branch} />
          {preview.applied ? (
            <p className="stock-clear" role="status">
              SR verification saved
            </p>
          ) : (
            !(preview.errors || []).length && (
              <button
                className="primary"
                disabled={!canWrite || busy || !preview.preview_token}
                onClick={() => process(true)}
              >
                <Upload size={16} />
                Apply verification
              </button>
            )
          )}
        </div>
      )}
      {!preview && (
        <div className="sr-current-results">
          <h3>Sales for {reportMode === "monthly" ? month : date}</h3>
          {current.isPending ? (
            <Loading />
          ) : current.error ? (
            <ErrorState error={current.error} retry={current.refetch} />
          ) : (
            <SRComparison data={current.data || {}} branch={branch} />
          )}
        </div>
      )}
      <div className="sr-mail-status" aria-label="SR email alerts">
        <b>Email alerts</b>
        <span>
          {email.data?.configured
            ? `${email.data.queued || 0} queued · ${email.data.accepted || 0} accepted · ${email.data.failed || 0} failed`
            : "Email configuration required"}
        </span>
      </div>
      <h3>Verification history</h3>
      {batches.isPending ? (
        <Loading />
      ) : batches.error ? (
        <ErrorState error={batches.error} retry={batches.refetch} />
      ) : !batches.data?.length ? (
        <p className="sales-empty">No verification files uploaded</p>
      ) : (
        <div className="sales-table-wrap">
          <table className="sales-table">
            <thead>
              <tr>
                <th>Sales date</th>
                <th>File</th>
                <th>Matched</th>
                <th>Mismatch</th>
                <th>Pending</th>
                <th>Comparison</th>
              </tr>
            </thead>
            <tbody>
              {batches.data.map((row) => (
                <tr key={row.id}>
                  <td>{row.report_period || row.business_date}</td>
                  <td>{row.filename}</td>
                  <td>{row.matched ?? row.summary?.matched ?? 0}</td>
                  <td>{row.mismatch ?? row.summary?.mismatch ?? 0}</td>
                  <td>{row.pending ?? row.summary?.pending ?? 0}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() => setSelectedBatch(row.id)}
                    >
                      View comparisons
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selectedBatch && (
        <div className="sr-saved-comparison">
          <div className="sales-section-head">
            <h3>{batch.data?.filename || "Saved report comparison"}</h3>
            <button type="button" onClick={() => setSelectedBatch("")}>
              Close comparison
            </button>
          </div>
          {batch.isPending ? (
            <Loading />
          ) : batch.error ? (
            <ErrorState error={batch.error} retry={batch.refetch} />
          ) : (
            <>
              <p className="sr-comparison-help">
                {batch.data?.comparison_source === "SAVED_VERIFICATION"
                  ? `Values saved when this report was verified · ${batch.data?.report_period || batch.data?.business_date}`
                  : "Historical comparison was not recorded. This shows the saved report against current sale details; it does not change the verification result."}
              </p>
              <SRComparison
                key={selectedBatch}
                data={batch.data || {}}
                branch={branch}
              />
            </>
          )}
        </div>
      )}
    </section>
  );
}
