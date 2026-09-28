import { Link } from "react-router-dom";
import { useState } from "react";
import { CheckCircle2, Clock3, Download, Printer } from "lucide-react";
import { download, Row } from "./api";

export default function ActivationReceipt({ capture }: { capture: Row }) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  async function exportPdf() {
    setExporting(true);
    setError("");
    try {
      await download(
        `/kyc-captures/${capture.id}/receipt`,
        `${capture.document_kind === "PAYMENT_CONFIRMATION" ? "invoice" : "receipt"}-${capture.id}.pdf`,
      );
    } catch {
      setError(`Could not download ${capture.document_kind === "PAYMENT_CONFIRMATION" ? "invoice" : "receipt"}. Please try again.`);
    } finally {
      setExporting(false);
    }
  }
  if (!capture.intake || capture.status === "DRAFT") return null;
  const payment = capture.document_kind === "PAYMENT_CONFIRMATION";
  const success = capture.status === "VERIFIED";
  const title = payment
    ? capture.invoice?.heading || "Payment successful"
    : success
      ? "Success · Receipt verified"
      : capture.status === "REJECTED"
        ? "Correction required"
        : "Final review pending";
  const fields: Row[] = (capture.rows ?? []).flatMap(
    (row: Row) =>
      row.fields ??
      Object.entries(row)
        .filter(
          ([k, v]) =>
            ["reference", "customer", "account", "details"].includes(k) && v,
        )
        .map(([label, value]) => ({ label, value })),
  );
  return (
    <section
      className={`verified-receipt receipt-${capture.status.toLowerCase()}`}
      aria-label={payment ? "Payment invoice" : "Activation receipt"}
    >
      <header className="verified-receipt-heading">
        <span>
          {success ? <CheckCircle2 size={30} /> : <Clock3 size={30} />}
        </span>
        <div>
          <h2>{title}</h2>
          <p>{payment ? capture.invoice?.status : capture.source_reference}</p>
        </div>
        <button className="receipt-print" onClick={() => window.print()}>
          <Printer size={16} /> {payment ? "Print invoice" : "Print receipt"}
        </button>
        <button
          className="receipt-print"
          disabled={exporting}
          onClick={exportPdf}
        >
          <Download size={16} /> PDF
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      <div className="receipt-paper-brand">
        <strong>relay.</strong>
        <span>{payment ? "PAYMENT INVOICE" : "ACTIVATION RECEIPT"}</span>
      </div>
      {payment ? (
        <div className="invoice-sections">
          {capture.invoice?.sections?.map((section: Row) => (
            <section key={section.title}>
              <h3>{section.title}</h3>
              <dl className="verified-receipt-grid">
                {section.fields.map((field: Row, index: number) => (
                  <div
                    key={index}
                    className={
                      /total paid/i.test(field.label) ? "receipt-total" : ""
                    }
                  >
                    <dt>{field.label}</dt>
                    <dd>{field.value || "Not recorded"}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      ) : (
        <>
          <dl className="verified-receipt-grid">
            {[
              ["Invoice / reference", capture.source_reference],
              ["Date", new Date(capture.created_at).toLocaleString()],
              ["Customer", capture.intake.name],
              [
                "ID number",
                `•••• ${String(capture.intake.document_number ?? "").slice(-4)}`,
              ],
              ["Phone number", capture.intake.msisdn],
              [
                "SIM type",
                capture.intake.sim_type === "ESIM" ? "eSIM" : "Physical SIM",
              ],
              ["Plan", capture.intake.plan_name],
              ["SIM serial", capture.intake.sim_identifier],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value || "Not recorded"}</dd>
              </div>
            ))}
          </dl>
          <div className="verified-receipt-lines">
            <h3>{"Receipt details"}</h3>
            {fields
              .filter((f) => String(f.value ?? "").trim())
              .map((f, i) => (
                <div
                  key={i}
                  className={
                    /total|amount paid/i.test(f.label) ? "receipt-total" : ""
                  }
                >
                  <span>{f.label}</span>
                  <strong>
                    {/document|passport|identity|customer.*id|subscriber.*id|emirates.*id|national.*id|^id(?:\s|$)/i.test(
                      f.label,
                    )
                      ? `•••• ${String(f.value).slice(-4)}`
                      : f.value}
                  </strong>
                </div>
              ))}
          </div>
        </>
      )}
      <Link className="primary receipt-done" to="/">
        Done · Return to dashboard
      </Link>
    </section>
  );
}
