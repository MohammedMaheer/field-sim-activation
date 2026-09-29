import ActivationReceipt from "./ActivationReceipt";
import { useEffect, useState } from "react";
import {
  CheckCircle2,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  FileSpreadsheet,
  Download,
  ArrowLeft,
  Undo2,
} from "lucide-react";
import { receiptImage, download, post, Row } from "./api";
import { Badge } from "./components";

export default function ReceiptReview({
  capture,
  agent,
  user,
  onBack,
  onSaved,
}: {
  capture: Row;
  agent?: Row;
  user: Row;
  onBack: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const [image, setImage] = useState(""),
    [imageError, setImageError] = useState(""),
    [retry, setRetry] = useState(0);
  const [zoom, setZoom] = useState(100),
    [tab, setTab] = useState("fields"),
    [evidence, setEvidence] = useState("payment"),
    [note, setNote] = useState(""),
    [checked, setChecked] = useState(false),
    [activationReference, setActivationReference] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    let url = "";
    setImage("");
    setImageError("");
    receiptImage(`/kyc-captures/${capture.id}/original`, abort.signal)
      .then((blob) => {
        if (abort.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setImage(url);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setImageError(e.message);
      });
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [capture.id, retry]);
  useEffect(() => {
    setNote("");
    setChecked(false);
    setError("");
    setZoom(100);
    setTab("fields");
    setEvidence("payment");
  }, [capture.id, capture.version]);
  const own = capture.creator_id === user.id;
  const eligible = capture.status === "SUBMITTED" && !own && user.permissions?.includes("compliance.write");
  const payment = capture.document_kind === "PAYMENT_CONFIRMATION";
  const orderMode = capture.intake?.capture_mode === "SCREENSHOT_ORDER";
  const evidenceLabel = payment ? "Payment confirmation" : "Historical activation receipt";
  const customerId = String(capture.intake?.document_number || "");
  const paidAmount = (capture.rows || [])
    .flatMap((row: Row) => row.fields || [])
    .find((field: Row) => /^(total paid|amount paid|paid amount)$/i.test(String(field.label || "").trim()))?.value;
  const summary = [
    ["Customer", capture.intake?.name],
    ["Document", customerId ? `•••• ${customerId.slice(-4)}` : ""],
    ["Phone", capture.intake?.msisdn],
    ["Plan", capture.intake?.plan_name],
    [orderMode ? "Request ID" : "SIM", orderMode ? capture.intake?.order_reference : capture.intake?.sim_identifier],
    [orderMode ? "Payment record" : payment ? "Paid amount" : "Record type", orderMode ? capture.invoice?.status || "Pending backend confirmation" : payment ? paidAmount : "Earlier receipt"],
  ];
  async function perform(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const canExcel =
    !!capture.rows?.length &&
    ["VALIDATED", "SUBMITTED", "VERIFIED", "REJECTED"].includes(capture.status);
  async function decide(outcome: string) {
    await perform(async () => {
      await post(`/kyc-captures/${capture.id}/review`, {
        version: capture.version,
        outcome,
        reason: note.trim(),
      });
      await onSaved();
    });
  }
  return (
    <section
      className="receipt-review-workspace"
      aria-label="Transaction review workspace"
    >
      <header className="review-record-header">
        <button onClick={onBack} disabled={busy}>
          <ArrowLeft size={17} />
          Review inbox
        </button>
        <div>
          <span className="review-kind">{evidenceLabel}</span>
          <h2>{capture.source_reference}</h2>
          <p>
            <strong>{agent?.name || "Assigned agent"}</strong> ·{" "}
            {agent?.employee_id || capture.agent_id}
            {agent?.branch ? ` · ${agent.branch}` : ""}
          </p>
          <small>
            Uploaded {new Date(capture.created_at + "Z").toLocaleString()}
          </small>
        </div>
        <Badge value={capture.status} />
      </header>
      {payment && (
        <div className="review-summary" aria-label="Captured transaction summary">
          {summary.map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong dir="auto">{value || "Not recorded"}</strong>
            </div>
          ))}
        </div>
      )}
      {error && (
        <div role="alert" className="capture-error">
          {error}
        </div>
      )}
      {payment && <div className="review-evidence-switch" role="group" aria-label="Evidence to compare">
        {[["payment", "Payment confirmation"], ["identity", capture.intake?.capture_mode === "SCREENSHOT_ORDER" ? "Customer details" : "Identity document"], ...(capture.intake?.order_image ? [["order", "Order details"]] : []), ...(!orderMode ? [["signature", "Signature"]] : [])].map(([key,label]) => <button key={key} className={evidence === key ? "primary" : ""} aria-pressed={evidence === key} onClick={() => {setEvidence(key); setZoom(100); setTab(key === "payment" ? "fields" : "customer");}}>{label}</button>)}
      </div>}
      <div className="review-comparison">
        <section
          className="review-pane"
          aria-label={evidenceLabel}
        >
          <div className="review-pane-heading">
            <div>
              <h3>
                {evidence === "order" ? "Order details" : evidence === "identity" ? "Customer details" : evidence === "signature" ? "Customer signature" : evidenceLabel}
              </h3>
              <small>Original image uploaded by the agent</small>
            </div>
            <div className="review-image-controls">
              <button
                aria-label="Zoom out image"
                disabled={zoom <= 100}
                onClick={() => setZoom((z) => Math.max(100, z - 25))}
              >
                <ZoomOut size={17} />
              </button>
              <button aria-label="Fit image" onClick={() => setZoom(100)}>
                {zoom}%
              </button>
              <button
                aria-label="Zoom in image"
                disabled={zoom >= 300}
                onClick={() => setZoom((z) => Math.min(300, z + 25))}
              >
                <ZoomIn size={17} />
              </button>
            </div>
          </div>
          <div
            className="review-image-stage"
            tabIndex={0}
            aria-label="Scrollable original image"
          >
            {evidence === "order" ? (capture.intake?.order_image ? <img alt="Order details" src={`data:image/jpeg;base64,${capture.intake.order_image}`} style={{width:`${zoom}%`}} /> : <p>Not recorded</p>) : evidence === "identity" ? (capture.intake?.document_image ? <img alt="Identity document" src={`data:image/${String(capture.intake.document_image).startsWith("iVBOR") ? "png" : "jpeg"};base64,${capture.intake.document_image}`} style={{width:`${zoom}%`}} /> : <p>Not recorded</p>) : evidence === "signature" ? (capture.intake?.signature?.length ? <svg viewBox="0 0 400 180" role="img" aria-label="Captured customer signature">{capture.intake.signature.map((stroke:number[][],i:number)=><polyline key={i} points={stroke.map(p=>`${p[0]*400},${p[1]*180}`).join(" ")} fill="none" stroke="#762765" strokeWidth="3" />)}</svg> : <p>Not recorded</p>) : imageError ? (
              <div role="alert">
                <p>{imageError}</p>
                <button onClick={() => setRetry((v) => v + 1)}>
                  <RotateCcw size={16} />
                  Retry image
                </button>
              </div>
            ) : image ? (
              <img
                src={image}
                alt={`${evidenceLabel} from ${agent?.name || "assigned agent"}`}
                style={{ width: `${zoom}%` }}
                onError={() =>
                  setImageError(
                    "The image could not be displayed. Retry or download the original.",
                  )
                }
              />
            ) : (
              <p role="status">Loading original image…</p>
            )}
          </div>
          <div className="review-pane-footer">
            <button
              disabled={busy || !image}
              onClick={() =>
                perform(() =>
                  download(
                    `/kyc-captures/${capture.id}/original`,
                    `confirmation-${capture.id}.${capture.image_type === "image/jpeg" ? "jpg" : "png"}`,
                  ),
                )
              }
            >
              <Download size={16} />
              Download original
            </button>
            <span>Zoom to inspect the original</span>
          </div>
        </section>
        <section className="review-pane" aria-label="Captured details">
          <div className="review-pane-heading">
            <div>
              <h3>
                {tab === "customer" ? (orderMode ? "Customer & order details" : "Customer & SIM details") : tab === "ocr" ? "Text from image" : payment ? "Payment details" : "Historical receipt details"}
              </h3>
              <small>
                {tab === "customer" ? (orderMode ? "Customer and captured order" : "Customer, document and SIM") : tab === "ocr" ? "Extracted from the uploaded image" : `${capture.rows?.length || 0} ${payment ? "payment" : "receipt"} ${capture.rows?.length === 1 ? "record" : "records"} · compare with image`}
              </small>
            </div>
            <button
              disabled={busy || !canExcel}
              onClick={() =>
                perform(() =>
                  download(
                    `/kyc-captures/${capture.id}/excel`,
                    `${payment ? "payment" : "receipt"}-${capture.id}.xlsx`,
                  ),
                )
              }
            >
              <FileSpreadsheet size={17} />
              Excel
            </button>
          </div>
          <div
            className="review-data-tabs"
            role="tablist"
            aria-label="Captured data"
          >
            {payment && <button role="tab" id="review-customer-tab" aria-controls="review-customer-panel" aria-selected={tab === "customer"} onClick={() => setTab("customer")}>{orderMode ? "Customer & order" : "Customer & SIM"}</button>}
            <button
              role="tab"
              id="review-fields-tab"
              aria-controls="review-fields-panel"
              aria-selected={tab === "fields"}
              onClick={() => setTab("fields")}
            >
              {payment ? "Payment fields" : "Transaction fields"}
            </button>
            <button
              role="tab"
              id="review-ocr-tab"
              aria-controls="review-ocr-panel"
              aria-selected={tab === "ocr"}
              onClick={() => setTab("ocr")}
            >
              {payment ? "Text from image" : "Receipt text"} ({capture.lines?.length || 0})
            </button>
          </div>
          <div
            className="review-data-scroll"
            role="tabpanel"
            id={`review-${tab}-panel`}
            aria-labelledby={`review-${tab}-tab`}
            tabIndex={0}
          >
            {tab === "customer" ? <div className="review-transaction">{(capture.invoice?.sections || []).filter((s:Row) => (evidence === "identity" ? ["Customer"] : evidence === "order" ? ["SIM & plan", "Order details"] : ["Customer", "SIM & plan", "Records"]).includes(s.title)).map((section:Row) => <section key={section.title}><h4>{section.title}</h4><dl>{section.fields.map((field:Row,i:number) => <div key={i}><dt>{field.label}</dt><dd dir="auto">{field.value || "Not recorded"}</dd></div>)}</dl></section>)}</div> : tab === "fields" ? (
              capture.rows?.length ? (
                capture.rows.map((row: Row, i: number) => (
                  <section className="review-transaction" key={i}>
                    <h4>{payment ? "Payment" : "Transaction"} {i + 1}</h4>
                    <dl>
                      {(
                        row.fields ||
                        ["reference", "customer", "account", "details"].map(
                          (key) => ({ label: key, value: row[key] }),
                        )
                      ).map((field: Row, n: number) => (
                        <div key={n}>
                          <dt>{field.label}</dt>
                          <dd dir="auto">{field.value || "Not recorded"}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ))
              ) : (
                <p>No extracted fields available yet.</p>
              )
            ) : (
              <ol className="review-raw-lines">
                {capture.lines?.map((line: Row, i: number) => (
                  <li key={i}>
                    <p dir="auto">{line.text}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      </div>
      <section className="review-decision" aria-label="Verification decision">
        {eligible ? (
          <>
            <div>
              <h3>Review decision</h3>

              <label className="review-check">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={busy || !image || !!imageError}
                  onChange={(e) => setChecked(e.target.checked)}
                />
                I checked the image against the customer, SIM and captured details.
              </label>
            </div>
            <div>
              <label>
                Review note
                <textarea
                  value={note}
                  maxLength={300}
                  minLength={5}
                  disabled={busy}
                  placeholder="Record what you checked or what the agent needs to correct"
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <div className="review-decision-actions">
                <button
                  disabled={busy || note.trim().length < 5}
                  onClick={() => decide("REJECTED")}
                >
                  <Undo2 size={17} />
                  Request correction
                </button>
                <button
                  className="primary review-verify"
                  disabled={
                    busy ||
                    !checked ||
                    !image ||
                    !!imageError ||
                    note.trim().length < 5
                  }
                  onClick={() => decide("VERIFIED")}
                >
                  <CheckCircle2 size={17} />
                  {busy ? "Saving…" : "Verify submission"}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div>
            <h3>
              {capture.status === "VERIFIED"
                ? payment ? "Payment verified" : "Historical receipt verified"
                : capture.status === "REJECTED"
                  ? "Returned for correction"
                  : own
                    ? "Independent review required"
                    : "Not ready for verification"}
            </h3>
            <p>
              {capture.review
                ? `${capture.review.reviewer}: ${capture.review.reason}`
                : own
                  ? "Another authorized team member must review your own submission."
                  : "The agent must check and submit the details before review."}
            </p>
          </div>
        )}
      </section>
      {capture.status === "VERIFIED" && <div className="setup-summary" role="status">{capture.leader_confirmation ? `Branch confirmed by ${capture.leader_confirmation.name}` : "Awaiting branch team leader confirmation"}</div>}
      {capture.document_kind === "PAYMENT_CONFIRMATION" &&
        capture.status === "VERIFIED" && (
          <section className="panel activation-completion">
            <h2>
              {capture.activation?.status === "ACTIVATED"
                ? "Activation completed"
                : "Backend activation"}
            </h2>
            {capture.activation && (
              <p>
                {capture.activation.status} · {capture.activation.reference}
              </p>
            )}
            {capture.activation?.status !== "ACTIVATED" &&
              user.permissions?.includes("ekyc.write") && (
                <>
                  <label>
                    Carrier activation reference
                    <input
                      value={activationReference}
                      onChange={(e) => setActivationReference(e.target.value)}
                      maxLength={100}
                    />
                  </label>
                  <label>
                    Completion note
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      maxLength={300}
                    />
                  </label>
                  <div className="review-decision-actions">
                    {["FAILED", "ACTIVATED"].map((outcome) => (
                      <button
                        className={outcome === "ACTIVATED" ? "primary" : ""}
                        key={outcome}
                        disabled={
                          busy ||
                          activationReference.trim().length < 3 ||
                          note.trim().length < 5
                        }
                        onClick={() =>
                          perform(async () => {
                            await post(
                              `/kyc-captures/${capture.id}/activation`,
                              {
                                version: capture.version,
                                outcome,
                                reference: activationReference,
                                reason: note,
                              },
                            );
                            await onSaved();
                          })
                        }
                      >
                        {outcome === "ACTIVATED"
                          ? "Record completed activation"
                          : "Record activation failure"}
                      </button>
                    ))}
                  </div>
                </>
              )}
          </section>
        )}
      {capture.document_kind === "PAYMENT_CONFIRMATION" && (
        <details className="review-history">
          <summary>Customer documents & signature</summary>
          <div className="review-intake-evidence">
            {[
              ["Identity document", capture.intake?.document_image],
              ["Selfie", capture.intake?.selfie_image],
            ].map(([title, image]) => (
              <section key={title}>
                <h3>{title}</h3>
                {image ? (
                  <img
                    src={`data:image/${String(image).startsWith("iVBORw0KGgo") ? "png" : "jpeg"};base64,${image}`}
                    alt={title}
                  />
                ) : (
                  <span>Not recorded</span>
                )}
              </section>
            ))}
            <section>
              <h3>Customer signature</h3>
              {capture.intake?.signature?.length ? (
                <svg
                  viewBox="0 0 400 180"
                  aria-label="Captured customer signature"
                  role="img"
                >
                  {capture.intake.signature.map(
                    (stroke: number[][], i: number) => (
                      <polyline
                        key={i}
                        points={stroke
                          .map((p) => `${p[0] * 400},${p[1] * 180}`)
                          .join(" ")}
                        fill="none"
                        stroke="#762765"
                        strokeWidth="3"
                      />
                    ),
                  )}
                </svg>
              ) : (
                <span>Not recorded</span>
              )}
            </section>
          </div>
        </details>
      )}
      <details className="review-history">
        <summary>{payment ? "Payment invoice" : "Historical receipt"}</summary>
        <ActivationReceipt capture={capture} />
      </details>
      <details className="review-history">
        <summary>Review history</summary>

        <ol className="capture-timeline">
          {capture.history?.map((event: Row, i: number) => (
            <li key={i}>
              <b>
                {event.action
                  .replace(/KYC/g, "Receipt")
                  .replace(/OCR/g, "Details")}
              </b>
              <span>
                {event.actor} · {new Date(event.at + "Z").toLocaleString()}
              </span>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
