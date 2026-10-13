import { Row } from "./api";
import { activationLabel } from "./ActivationStatus";

function text(value: unknown) {
  const string = String(value ?? "").trim() || "Not recorded";
  return string.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}

function privateValue(label: string, value: unknown) {
  const string = String(value ?? "").trim();
  if (string && string !== "Not recorded" && /document.*(?:number|id)|passport.*(?:number|no)|identity.*(?:number|id)|customer.*id|subscriber.*id|emirates.*id|national.*id|^id(?:\s|$)/i.test(label)) {
    return `•••• ${string.slice(-4)}`;
  }
  return string || "Not recorded";
}

/** Normalize cached projections without changing the compatible invoice API key. */
export function referenceBillSections(sections: Row[]) {
  return sections.map((section) => ({
    ...section,
    title: ["Invoice", "Payment invoice", "Sale receipt", "Reference bill"].includes(section.title)
      ? "Reference details" : section.title,
    fields: (section.fields || []).map((field: Row) => ({
      ...field,
      label: field.label === "Invoice number" ? "Reference bill number" : field.label,
    })),
  }));
}

/** A separate paper document avoids portal overflow, closed details and animation styles. */
export function receiptPrintDocument(capture: Row) {
  const intake = capture.intake || {};
  const sale = intake.capture_mode === "SCREENSHOT_SALE";
  const payment = capture.document_kind === "PAYMENT_CONFIRMATION";
  const title = sale || payment ? "Reference bill" : "Activation receipt";
  const status = sale ? activationLabel(capture) : capture.invoice?.heading ||
    (capture.status === "VERIFIED" ? "Receipt verified" : capture.status === "REJECTED" ? "Correction required" : "Final review pending");
  const projected: Row[] = Array.isArray(capture.invoice?.sections) ? capture.invoice.sections : [];
  const sections = projected.length ? referenceBillSections(projected) : [
    { title: "Receipt", fields: [
      { label: "Reference", value: capture.source_reference },
      { label: "Date", value: capture.created_at },
      { label: "Backend verification", value: capture.status === "VERIFIED" ? "Verified" : "Pending backend verification" },
    ] },
    { title: "Customer & plan", fields: [
      { label: "Customer name", value: intake.name },
      { label: "Document number", value: intake.document_number },
      { label: "Phone number", value: intake.msisdn },
      { label: "Plan", value: intake.plan_name },
      { label: "SIM serial", value: intake.sim_identifier },
      { label: "SIM type", value: intake.sim_identifier ? intake.sim_type === "ESIM" ? "eSIM" : "Physical SIM" : null },
    ] },
    { title: "Captured details", fields: (capture.rows || []).flatMap((row: Row) => row.fields ||
      ["reference", "customer", "account", "details"].map((label) => ({label, value: row[label]}))) },
  ];
  const logo = new URL("/branding/qanawat-logo.png", window.location.origin).href;
  const content = sections.filter((section) => Array.isArray(section.fields) && section.fields.length).map((section) =>
    `<section><h2>${text(section.title)}</h2><table><tbody>${section.fields.map((field: Row) =>
      `<tr><th>${text(field.label)}</th><td>${text(privateValue(String(field.label), field.value))}</td></tr>`).join("")}</tbody></table></section>`,
  ).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Qanawat ${text(title)} · ${text(capture.source_reference || capture.id)}</title><style>
    @page{size:A4;margin:12mm}*{box-sizing:border-box}body{margin:0;color:#242738;font:12px/1.4 Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    header{display:flex;align-items:center;justify-content:space-between;gap:20px;padding-bottom:12px;border-bottom:2px solid #85254f}header img{width:210px;height:auto}header div{text-align:right}h1{font-size:20px;margin:0 0 4px}h2{font-size:12px;margin:0;padding:7px 10px;background:#f4edf2;color:#722044;border-bottom:1px solid #e1d8df}
    .status{margin:12px 0;border:1px solid #c8d7d2;background:#effaf6;padding:10px;font-size:13px;font-weight:bold}.reference{font-size:11px;color:#5d6575;overflow-wrap:anywhere}
    main{columns:2;column-gap:14px}section{margin:0 0 12px;border:1px solid #dddfe6;border-radius:5px;overflow:hidden;break-inside:avoid}table{border-collapse:collapse;width:100%;table-layout:fixed}tr{break-inside:avoid}th,td{padding:6px 9px;text-align:left;vertical-align:top;border-bottom:1px solid #e6e8ee;overflow-wrap:anywhere;word-break:normal}th{width:43%;font-size:10px;color:#596274;font-weight:normal}td{font-size:11px;font-weight:600}tr:last-child th,tr:last-child td{border:0}
    footer{border-top:1px solid #dfe2e9;padding-top:9px;color:#687082;font-size:10px;margin-top:8px}@media(max-width:600px){main{columns:1}}@media print{main{columns:2}}
  </style></head><body><header><img src="${logo}" alt="Qanawat Connect Solutions LLC"><div><h1>${text(title)}</h1><div class="reference">${text(capture.source_reference || capture.id)}</div></div></header><div class="status">${text(status)}</div><main>${content}</main><footer>Qanawat Connect Solutions LLC · ${text(capture.invoice?.status || "Sale record")}</footer></body></html>`;
}

/** Prints a same-origin frame, with no popup or whole-page visibility hacks. */
export async function printReceipt(capture: Row) {
  const frame = document.createElement("iframe");
  frame.title = "Qanawat receipt print document";
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:800px;height:1000px;border:0;";
  const cleanup = () => frame.remove();
  await new Promise<void>((resolve, reject) => {
    frame.onload = async () => {
      try {
        const target = frame.contentWindow;
        if (!target) throw new Error("Could not open receipt printing. Download the PDF instead.");
        await target.document.fonts.ready;
        await Promise.all(Array.from(target.document.images).map((img) => img.complete ? Promise.resolve() : new Promise<void>((done) => {
          img.onload = () => done(); img.onerror = () => done();
        })));
        target.addEventListener("afterprint", cleanup, { once: true });
        target.focus();
        target.print();
        // Some browsers omit afterprint when the dialog is cancelled.
        window.setTimeout(cleanup, 180000);
        resolve();
      } catch (error) { cleanup(); reject(error); }
    };
    frame.onerror = () => { cleanup(); reject(new Error("Could not prepare receipt printing. Download the PDF instead.")); };
    frame.srcdoc = receiptPrintDocument(capture);
    document.body.appendChild(frame);
  });
}
