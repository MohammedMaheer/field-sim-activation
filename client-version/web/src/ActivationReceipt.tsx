import { Link } from "react-router-dom";
import { useState } from "react";
import { CheckCircle2, Clock3, Download, Printer } from "lucide-react";
import { download, Row } from "./api";

export default function ActivationReceipt({ capture }: { capture: Row }) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  async function exportPdf() {
    setExporting(true); setError("");
    try { await download(`/kyc-captures/${capture.id}/receipt`, `receipt-${capture.id}.pdf`); }
    catch { setError("Could not download receipt. Please try again."); }
    finally { setExporting(false); }
  }
  if (!capture.intake) return null;
  const success = capture.status === "VERIFIED";
  const title = success ? "Success · Receipt verified" : capture.status === "REJECTED"
    ? "Correction required" : "Final review pending";
  const fields: Row[] = (capture.rows ?? []).flatMap((row: Row) => row.fields ??
    Object.entries(row).filter(([k, v]) => ["reference", "customer", "account", "details"].includes(k) && v)
      .map(([label, value]) => ({ label, value })));
  return <section className={`verified-receipt receipt-${capture.status.toLowerCase()}`} aria-label="Activation receipt">
    <header className="verified-receipt-heading">
      <span>{success ? <CheckCircle2 size={30} /> : <Clock3 size={30} />}</span>
      <div><h2>{title}</h2><p>{capture.source_reference}</p></div>
      <button className="receipt-print" onClick={() => window.print()}><Printer size={16} /> Print receipt</button>
      <button className="receipt-print" disabled={exporting} onClick={exportPdf}><Download size={16} /> PDF</button>
    </header>
    {error && <p role="alert">{error}</p>}
    <dl className="verified-receipt-grid">
      {[
        ["Invoice / reference", capture.source_reference],
        ["Date", new Date(capture.created_at).toLocaleString()],
        ["Customer", capture.intake.name],
        ["ID number", `•••• ${String(capture.intake.document_number ?? "").slice(-4)}`],
        ["Phone number", capture.intake.msisdn],
        ["SIM type", capture.intake.sim_type === "ESIM" ? "eSIM" : "Physical SIM"],
        ["Plan", capture.intake.plan_name],
        ["SIM serial", capture.intake.sim_identifier],
      ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "—"}</dd></div>)}
    </dl>
    <div className="verified-receipt-lines">
      <h3>Receipt details</h3>
      {fields.filter(f => String(f.value ?? "").trim()).map((f, i) => <div key={i}><span>{f.label}</span><strong>{/document|passport|identity|\bid\b/i.test(f.label) ? `•••• ${String(f.value).slice(-4)}` : f.value}</strong></div>)}
    </div>
    <Link className="primary receipt-done" to="/">Done · Return to dashboard</Link>
  </section>;
}
