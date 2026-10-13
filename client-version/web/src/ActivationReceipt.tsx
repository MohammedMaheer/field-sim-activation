import { activationLabel } from "./ActivationStatus";
import { Link } from "react-router-dom";
import { useState } from "react";
import {
  CheckCircle2,
  Clock3,
  Download,
  Home,
  Printer,
  RotateCcw,
} from "lucide-react";
import { api, download, Row } from "./api";
import { printReceipt, referenceBillSections } from "./receiptPrinting";

export default function ActivationReceipt({ capture, canExport }: { capture: Row; canExport: boolean }) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [printRun, setPrintRun] = useState(0);
  const [printing, setPrinting] = useState(false);
  const generatedBill = capture.document_kind === "PAYMENT_CONFIRMATION" ||
    capture.intake?.capture_mode === "SCREENSHOT_SALE";
  async function printPaper() {
    setPrinting(true);
    setError("");
    try {
      const current = await api(`/kyc-captures/${capture.id}/print-data`);
      await printReceipt(current);
    } catch (failure: any) {
      setError(failure.message || "Could not print this receipt. Download the PDF and try again.");
    } finally {
      setPrinting(false);
    }
  }
  async function exportPdf() {
    setExporting(true);
    setError("");
    try {
      await download(
        `/kyc-captures/${capture.id}/receipt`,
        `qanawat-${generatedBill ? "reference-bill" : "activation-receipt"}-${capture.id}.pdf`,
      );
    } catch {
      setError(
        `Could not download ${generatedBill ? "reference bill" : "receipt"}. Please try again.`,
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
      : activationLabel(capture)
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
  const sections: Row[] = referenceBillSections(capture.invoice?.sections || []);
  const primaryLabels: Record<string, string[]> = {
    "Reference details": ["Reference bill number", "Sale reference", "SR number", "Date"],
    Customer: ["Customer name", "Document number", "Phone number"],
    "SIM & plan": orderMode
      ? ["Request ID", "Plan", "Monthly charge", "Prepayment on order"]
      : ["SIM type", "SIM serial", "Plan", "Plan price"],
    Payment: orderMode
      ? ["Sales agent payment record", "Backend confirmation"]
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
      ? [{ title: "More bill details", fields: otherFields }]
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
      <Link className="button-link" to="/" aria-label="Home" style={{ marginBottom: 10 }}>
        <Home size={17} /> Home
      </Link>
      <div className="receipt-kiosk-machine">
        <div className="receipt-kiosk-screen">
          <Printer size={23} aria-hidden="true" />
          <span>Paper printer</span>
          <button
            type="button"
            aria-label={generatedBill ? "Replay reference bill printing" : "Replay receipt printing"}
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
            generatedBill ? "Reference bill" : "Activation receipt"
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
            {canExport && <button type="button" className="receipt-print" disabled={printing} onClick={printPaper}>
              <Printer size={16} />{" "}
              {printing ? "Preparing…" : generatedBill ? "Print reference bill" : "Print receipt"}
            </button>}
            {canExport && <button
              className="receipt-print"
              disabled={exporting}
              onClick={exportPdf}
            >
              <Download size={16} /> PDF
            </button>}
          </header>
          {error && <p role="alert">{error}</p>}
          <div className="receipt-paper-brand">
            <img src="/branding/qanawat-logo.png" alt="Qanawat Connect Solutions LLC" style={{width: 200, maxWidth: "60%", height: "auto"}} />
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
