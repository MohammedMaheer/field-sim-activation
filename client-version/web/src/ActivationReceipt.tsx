import { Link } from "react-router-dom";
import { useState } from "react";
import {
  CheckCircle2,
  Clock3,
  Download,
  Printer,
  RotateCcw,
} from "lucide-react";
import { download, Row } from "./api";

export default function ActivationReceipt({ capture }: { capture: Row }) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [printRun, setPrintRun] = useState(0);
  async function exportPdf() {
    setExporting(true);
    setError("");
    try {
      await download(
        `/kyc-captures/${capture.id}/receipt`,
        `${capture.document_kind === "PAYMENT_CONFIRMATION" ? "invoice" : "receipt"}-${capture.id}.pdf`,
      );
    } catch {
      setError(
        `Could not download ${capture.document_kind === "PAYMENT_CONFIRMATION" ? "invoice" : "receipt"}. Please try again.`,
      );
    } finally {
      setExporting(false);
    }
  }
  if (!capture.intake || capture.status === "DRAFT") return null;
  const payment = capture.document_kind === "PAYMENT_CONFIRMATION";
  const saleMode = capture.intake?.capture_mode === "SCREENSHOT_SALE";
  const orderMode = ["SCREENSHOT_ORDER", "SCREENSHOT_SALE"].includes(
    capture.intake?.capture_mode,
  );
  const success = capture.status === "VERIFIED";
  const title = saleMode
    ? capture.status === "REJECTED"
      ? "Correction required"
      : success
        ? "Sale verified"
        : "Sale submitted"
    : payment
      ? capture.invoice?.heading ||
        (orderMode ? "Payment recorded" : "Payment successful")
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
  const sections: Row[] = capture.invoice?.sections || [];
  const primaryLabels: Record<string, string[]> = {
    Invoice: ["Invoice number", "Date"],
    Customer: ["Customer name", "Document number", "Phone number"],
    "SIM & plan": orderMode
      ? ["Request ID", "Plan", "Monthly charge", "Prepayment on order"]
      : ["SIM type", "SIM serial", "Plan", "Plan price"],
    Payment: orderMode
      ? ["Agent payment record", "Backend confirmation"]
      : ["Payment reference", "Total paid"],
    Sale: [
      "Request ID",
      "SR number",
      "Backend verification",
      "SR verification",
      "Payment receipt",
    ],
  };
  const primarySections = sections
    .filter((section) => primaryLabels[section.title])
    .map((section) => ({
      ...section,
      fields: section.fields.filter((field: Row) =>
        primaryLabels[section.title].includes(field.label),
      ),
    }));
  const otherFields = sections
    .filter((section) => primaryLabels[section.title])
    .flatMap((section) =>
      section.fields.filter(
        (field: Row) =>
          !primaryLabels[section.title].includes(field.label) &&
          field.label !== "Review",
      ),
    );
  const supportingSections = [
    ...(otherFields.length
      ? [{ title: "More invoice details", fields: otherFields }]
      : []),
    ...sections.filter((section) => !primaryLabels[section.title]),
  ];
  const renderSection = (section: Row) => (
    <section key={section.title}>
      <h3>{section.title}</h3>
      <dl className="verified-receipt-grid">
        {section.fields.map((field: Row, index: number) => (
          <div
            key={index}
            className={/total paid/i.test(field.label) ? "receipt-total" : ""}
          >
            <dt>{field.label}</dt>
            <dd>{field.value || "Not recorded"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
  return (
    <div className="receipt-kiosk-assembly">
      <div className="receipt-kiosk-machine">
        <div className="receipt-kiosk-screen">
          <strong>relay.</strong>
          <span>{saleMode ? "SALE RECEIPT" : "PAYMENT INVOICE"}</span>
          <button
            type="button"
            aria-label="Replay invoice printing"
            onClick={() => setPrintRun((n) => n + 1)}
          >
            <RotateCcw size={17} />
          </button>
          <i />
        </div>
        <div className="receipt-kiosk-slot" />
      </div>
      <div className="receipt-paper-outlet">
        <section
          key={`${capture.id}-${printRun}`}
          className={`verified-receipt receipt-${capture.status.toLowerCase()}`}
          aria-label={
            saleMode
              ? "Sale receipt"
              : payment
                ? "Payment invoice"
                : "Activation receipt"
          }
        >
          <header className="verified-receipt-heading">
            <span>
              {success ? <CheckCircle2 size={30} /> : <Clock3 size={30} />}
            </span>
            <div>
              <h2>{title}</h2>
              <p>
                {saleMode
                  ? capture.status === "VERIFIED"
                    ? "Backend verification complete"
                    : "Pending backend verification"
                  : payment
                    ? capture.invoice?.status
                    : capture.source_reference}
              </p>
            </div>
            <button className="receipt-print" onClick={() => window.print()}>
              <Printer size={16} />{" "}
              {saleMode
                ? "Print receipt"
                : payment
                  ? "Print invoice"
                  : "Print receipt"}
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
            <span>
              {saleMode
                ? "SALE RECEIPT"
                : payment
                  ? "PAYMENT INVOICE"
                  : "ACTIVATION RECEIPT"}
            </span>
          </div>
          {saleMode && (
            <dl className="sale-verification-summary">
              <div>
                <dt>SR verification</dt>
                <dd>
                  {String(
                    capture.sr_verification?.status ||
                      "PENDING_SR_VERIFICATION",
                  ).replaceAll("_", " ")}
                </dd>
              </div>
              <div>
                <dt>Payment receipt</dt>
                <dd>
                  {capture.payment_record_status === "RECORDED"
                    ? "Recorded"
                    : "Not recorded"}
                </dd>
              </div>
            </dl>
          )}
          {payment || saleMode ? (
            <div className="invoice-sections">
              {primarySections.map(renderSection)}
              {supportingSections.length > 0 && (
                <div className="invoice-more">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setExpanded(!expanded)}
                  >
                    {expanded
                      ? "Hide supporting details"
                      : "Show supporting details"}
                  </button>
                  <div
                    className={
                      expanded
                        ? "invoice-more-content expanded"
                        : "invoice-more-content"
                    }
                  >
                    {supportingSections.map(renderSection)}
                  </div>
                </div>
              )}
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
                    capture.intake.sim_type === "ESIM"
                      ? "eSIM"
                      : "Physical SIM",
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
                        /total|amount paid/i.test(f.label)
                          ? "receipt-total"
                          : ""
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
      </div>
    </div>
  );
}
