import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { api, download, post, Row } from "./api";
import { ErrorState, Loading } from "./components";

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
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
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
    if (!file || !date || (apply && !preview?.preview_token)) return;
    setBusy(true);
    setError("");
    try {
      if (!/\.(xlsx|csv)$/i.test(file.name) || file.size > 2_000_000)
        throw Error("Choose an Excel or CSV file under 2 MB.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const result = await post("/sales-management/sr/file", {
        business_date: date,
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
      setBusy(false);
    }
  }
  return (
    <section
      className="panel sales-section sr-verification"
      aria-label="Daily SR verification"
    >
      <div className="sales-section-head">
        <h2>Daily SR verification</h2>
        <button
          disabled={busy}
          onClick={() =>
            download(
              `/sales-management/sr/template?business_date=${encodeURIComponent(date)}`,
              "daily-sr-verification.xlsx",
            ).catch((e) => setError(e.message))
          }
        >
          <Download size={16} />
          Excel template
        </button>
      </div>
      <div className="sales-form compact">
        <label>
          Sales date
          <input
            type="date"
            required
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setPreview(null);
            }}
          />
        </label>
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
          disabled={busy || !file || !date}
          onClick={() => process(false)}
        >
          <FileSpreadsheet size={16} />
          {busy ? "Checking…" : "Preview matches"}
        </button>
      </div>
      {error && (
        <p className="sales-error" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <div className="sales-preview">
          <div className="sr-result-summary">
            {[
              ["Matched", preview.summary?.matched ?? 0],
              ["Mismatch", preview.summary?.mismatch ?? 0],
              ["Pending", preview.summary?.pending ?? 0],
            ].map(([label, value]) => (
              <span key={label}>
                <b>{value}</b>
                {label}
              </span>
            ))}
          </div>
          {(preview.errors || []).map((message: string, index: number) => (
            <p role="alert" key={index}>
              {message}
            </p>
          ))}
          <div className="sales-table-wrap">
            <table className="sales-table">
              <thead>
                <tr>
                  <th>Sale</th>
                  <th>Agent / branch</th>
                  <th>SR number</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {(preview.changes || []).map((row: Row, index: number) => (
                  <tr key={row.sale_id || index}>
                    <td>
                      {row.customer_name || row.sale_id}
                      <small>{row.reason}</small>
                    </td>
                    <td>
                      {row.agent || "Not recorded"}
                      <small>{row.branch}</small>
                    </td>
                    <td>{row.sr_number || "Not recorded"}</td>
                    <td>
                      <span
                        className={`sales-status ${(row.to || "PENDING_SR_VERIFICATION").toLowerCase()}`}
                      >
                        {srStatus(row.to)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.applied ? (
            <p className="stock-clear" role="status">
              SR verification saved
            </p>
          ) : (
            !(preview.errors || []).length && (
              <button
                className="primary"
                disabled={busy || !preview.preview_token}
                onClick={() => process(true)}
              >
                <Upload size={16} />
                Apply verification
              </button>
            )
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
              </tr>
            </thead>
            <tbody>
              {batches.data.map((row) => (
                <tr key={row.id}>
                  <td>{row.business_date}</td>
                  <td>{row.filename}</td>
                  <td>{row.matched ?? row.summary?.matched ?? 0}</td>
                  <td>{row.mismatch ?? row.summary?.mismatch ?? 0}</td>
                  <td>{row.pending ?? row.summary?.pending ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
