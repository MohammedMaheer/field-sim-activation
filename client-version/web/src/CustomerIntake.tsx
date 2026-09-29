import IntakeCamera from "./IntakeCamera";
import { useEffect, useState } from "react";
import { api, post, Row } from "./api";
import { useResource } from "./App";
import { Camera, ArrowLeft, ArrowRight } from "lucide-react";
export default function CustomerIntake({
  value,
  onChange,
  onReady,
  onSaved,
}: {
  value: Row;
  onChange: (v: Row) => void;
  onReady: () => void;
  onSaved: () => void;
}) {
  const [camera, setCamera] = useState("");
  const [reading, setReading] = useState(false),
    [scanImage, setScanImage] = useState("");
  const plans = useResource("plans");
  const [missing, setMissing] = useState<string[]>([]);
  const fieldLabels: Record<string, string> = {
    name: "full name",
    document_number: "document number",
    nationality: "nationality",
    birth_date: "date of birth",
    expiry_date: "document expiry date",
    document_image: "customer details screen",
    order_image: "order details screen",
    order_reference: "request ID",
    sim_identifier: "SIM barcode",
    plan_id: "subscriber plan",
    msisdn: "phone number",
    signature: "customer signature",
  };
  const [step, setStep] = useState(0),
    [version, setVersion] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    api("/kyc-captures/draft")
      .then((r) => {
        if (live) {
          const restored: Row = { ...value, capture_mode: value.capture_mode || "SCREENSHOT_ORDER", transaction_id: value.transaction_id || crypto.randomUUID() };
          if (!restored.document_check) {
            restored.document_image = "";
            restored.step = 0;
          }
          onChange(restored);
          setVersion(r.version);
          setStep(Math.min(restored.step || 0, 1));
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  const set = (key: string, v: any) => {
    const remaining = missing.filter((item) => item !== key);
    setMissing(remaining);
    setError(
      remaining.length
        ? "Required to continue: " +
            remaining.map((item) => fieldLabels[item] || item).join(", ") +
            "."
        : "",
    );
    onChange({ ...value, [key]: v });
  };
  const clearMissing = (keys: string[]) => {
    const remaining = missing.filter((item) => !keys.includes(item));
    setMissing(remaining);
    setError(
      remaining.length
        ? "Required to continue: " +
            remaining.map((item) => fieldLabels[item] || item).join(", ") +
            "."
        : "",
    );
  };
  async function preparedImage(file: File) {
    if (
      !["image/png", "image/jpeg"].includes(file.type) ||
      file.size > 10000000
    )
      throw Error("Choose a PNG or JPEG photo under 10 MB.");
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas"),
      scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas
      .getContext("2d")!
      .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const image = canvas.toDataURL("image/jpeg", 0.75).split(",")[1];
    if (image.length > 1333336) throw Error("Choose a smaller photo.");
    return image;
  }
  async function detectDocument(file: File) {
    try {
      const image = await preparedImage(file);
      const details = await post("/kyc-captures/read-document", {
        image_base64: image,
      });
      if (!details.document_check) return false;
      setScanImage(image);
      clearMissing(["document_image", ...Object.keys(details)]);
      onChange({ ...value, ...details, document_image: image });
      return true;
    } catch {
      return false;
    }
  }
  async function detectOrder(file: File) {
    try {
      const image = await preparedImage(file);
      const details = await post("/kyc-captures/read-order", { image_base64: image });
      if (!details.order_check) return false;
      setScanImage(image);
      clearMissing(["order_image", ...Object.keys(details)]);
      onChange({ ...value, ...details, order_image: image, capture_mode: "SCREENSHOT_ORDER" });
      return true;
    } catch { return false; }
  }
  async function photo(file: File | undefined, key: string) {
    if (!file) return;
    setBusy(true);
    setReading(key === "document_image" || key === "order_image");
    setError("");
    try {
      const image = await preparedImage(file);
      if (key === "document_image" || key === "order_image") setScanImage(image);
      let details: Row = {};
      if (key === "document_image" || key === "order_image") {
        try {
          details = await post(key === "order_image" ? "/kyc-captures/read-order" : "/kyc-captures/read-document", {
            image_base64: image,
          });
          if (!details[key === "order_image" ? "order_check" : "document_check"]) throw Error("Screen unreadable");
        } catch {
          setScanImage("");
          onChange({ ...value, [key]: "", [key === "order_image" ? "order_check" : "document_check"]: "" });
          throw Error(
            key === "order_image" ? "Order details weren't captured clearly. Try again." : "Customer details weren't captured clearly. Try again.",
          );
        }
      }
      onChange({ ...value, ...details, [key]: image });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
      setReading(false);
    }
  }
  async function save(next: boolean) {
    setBusy(true);
    setError("");
    try {
      if (next) {
        if (step === 0 && !value.document_check)
          throw Error(
            "Customer details weren't captured clearly. Scan or upload the checkout screen.",
          );
        if (step === 1 && !value.order_check)
          throw Error("Order details weren't captured clearly. Scan or upload the order screen.");
        const keys =
          step === 0
            ? [
                "name",
                "document_number",
                "nationality",
                "birth_date",
                "expiry_date",
                "document_image",
              ]
            : ["order_image", "order_reference", "plan_id", "msisdn"];
        const absent = keys.filter((k) => !String(value[k] || "").trim());
        if (absent.length) {
          setMissing(absent);
          const labels: Record<string, string> = {
            name: "full name",
            document_number: "document number",
            nationality: "nationality",
            birth_date: "date of birth",
            expiry_date: "document expiry date",
            document_image: "customer details screen",
            order_image: "order details screen",
            order_reference: "request ID",
            plan_id: "subscriber plan",
            msisdn: "phone number",
          };
          setError(
            `Required to continue: ${absent.map((key) => labels[key] || key).join(", ")}.`,
          );
          const target =
            document.querySelector<HTMLElement>(
              `[data-intake-field="${absent[0]}"] input, [data-intake-field="${absent[0]}"] canvas`,
            ) ||
            document.querySelector<HTMLElement>(
              `[data-intake-field="${absent[0]}"]`,
            );
          target?.scrollIntoView({ behavior: "smooth", block: "center" });
          if (target instanceof HTMLInputElement)
            target.focus({ preventScroll: true });
          return;
        }
        if (
          step === 0 &&
          (value.expiry_date < new Date().toISOString().slice(0, 10) ||
            value.birth_date >= new Date().toISOString().slice(0, 10))
        )
          throw Error("Check date of birth and document expiry.");
      }
      const scan = next && step === 1 && value.sim_identifier ? await post('/inventory/scan',{code:value.sim_identifier,transaction_id:value.transaction_id,agent_id:value.agent_id}) : {};
      const data = { ...value, capture_mode: "SCREENSHOT_ORDER", ...scan, step: next ? step + 1 : step };
      const r = await api("/kyc-captures/draft", {
        method: "PUT",
        body: JSON.stringify({ version, data }),
      });
      setVersion(r.version);
      onChange(data);
      if (!next) {
        await post('/kyc-captures/saved-drafts',{data});
        onSaved();
      }
      if (next) {
        if (step === 1) onReady();
        else setStep(1);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function input(key: string, label: string, type = "text", max = 120) {
    return (
      <label
        key={key}
        data-intake-field={key}
        className={missing.includes(key) ? "field-missing" : ""}
      >
        {label}
        <input
          type={type}
          maxLength={max}
          value={value[key] || ""}
          aria-invalid={missing.includes(key)}
          aria-required="true"
          onChange={(e) => set(key, e.target.value)}
        />
      </label>
    );
  }
  return (
    <section className="customer-intake">
      <ol className="transaction-stages">
        {["Customer", "Order & plan", "Payment"].map((s, i) => (
          <li
            key={s}
            className={i === step ? "active" : i < step ? "complete" : ""}
          >
            <span>{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>
      {error && (
        <p role="alert" className="capture-error">
          {error}
        </p>
      )}
      {step === 0 ? (
        <>
          <h2>Customer details</h2>
          <div className="identity-capture-actions">
            <div
              className="intake-choice"
              role="group"
              aria-label="Document capture"
            >
              <button
                onClick={() => {
                  if (value.document_image) {
                    onChange({ ...value, document_image: undefined });
                    setScanImage("");
                  } else {
                    document
                      .querySelector<HTMLButtonElement>(".camera-expand")
                      ?.click();
                  }
                }}
              >
                <Camera size={18} />
                Scan details
              </button>
              <button onClick={() => setCamera("selfie_image")}>
                Selfie · optional
              </button>
            </div>
          </div>
          {camera === "selfie_image" && (
            <IntakeCamera
              selfie={camera === "selfie_image"}
              onPhoto={(f) => photo(f, camera)}
              onCode={() => {}}
              onClose={() => setCamera("")}
            />
          )}
          {loaded &&
            !value.document_image &&
            !reading &&
            camera !== "selfie_image" && (
              <IntakeCamera
                embedded
                onPhoto={(file) => photo(file, "document_image")}
                onDetect={detectDocument}
                onCode={() => {}}
                onClose={() => setCamera("")}
              />
            )}
          {(value.document_image || reading) && (
            <div
              data-intake-field="document_image"
              className={`document-scan ${reading ? "reading" : value.document_image ? "complete" : "ready"} ${missing.includes("document_image") ? "field-missing" : ""}`}
              aria-live="polite"
            >
              {scanImage || value.document_image ? (
                <img
                  src={
                    "data:image/jpeg;base64," +
                    (scanImage || value.document_image)
                  }
                  alt="Captured customer details"
                />
              ) : (
                <div className="scan-document-placeholder">
                  <Camera size={42} />
                  <strong>Customer details</strong>
                </div>
              )}
              <div className="scan-beam" />
              <span className="scan-status">
                {reading
                  ? "Reading details…"
                  : value.document_image
                    ? "Details captured"
                    : "Position customer screen"}
              </span>
            </div>
          )}
          <div className="intake-photos">
            {[
              ["document_image", "Customer details screen"],
              ["selfie_image", "Selfie · optional"],
            ].map(([key, label]) => (
              <label key={key} className="intake-photo">
                {value[key] ? (
                  <img
                    src={"data:image/jpeg;base64," + value[key]}
                    alt={label}
                  />
                ) : (
                  <Camera size={32} />
                )}
                <strong>{label}</strong>
                <input
                  type="file"
                  aria-label={label}
                  accept="image/png,image/jpeg"
                  capture={key === "selfie_image" ? "user" : "environment"}
                  disabled={busy}
                  onChange={(e) => photo(e.target.files?.[0], key)}
                />
              </label>
            ))}
          </div>
          {<div className="intake-grid">
            {input("name", "Full name")}
            {input("document_number", "Document number", "text", 80)}
            {input("nationality", "Nationality", "text", 80)}
            {input("birth_date", "Date of birth", "date")}
            {input("expiry_date", "Expiry date", "date")}
          </div>}
        </>
      ) : (
        <>
          <h2>Order & plan</h2>
          {loaded && !value.order_image && !reading && <IntakeCamera embedded onPhoto={(file) => photo(file, "order_image")} onDetect={detectOrder} onCode={() => {}} onClose={() => setCamera("")} />}
          {(value.order_image || reading) && <div data-intake-field="order_image" className={`document-scan ${reading ? "reading" : "complete"}`} aria-live="polite">
            {value.order_image && <img src={"data:image/jpeg;base64," + value.order_image} alt="Captured order details" />}
            <div className="scan-beam" /><span className="scan-status">{reading ? "Reading order…" : "Order captured"}</span>
          </div>}
          <div className="intake-photos"><label className="intake-photo">
            <Camera size={28} /><strong>Capture order details</strong>
            <input type="file" aria-label="Order details screen" accept="image/png,image/jpeg" capture="environment" disabled={busy} onChange={(e) => photo(e.target.files?.[0], "order_image")} />
          </label></div>
          {<>
            <div className="intake-grid order-fields">
              {[["package_name","Package name"],["order_reference","Request ID"],["msisdn","Phone number"],["monthly_cost","Monthly charge"],["prepayment","Order prepayment"]].map(([key,label]) => <label key={key}>{label}<input value={value[key] || ""} readOnly /></label>)}
            </div>
            <label data-intake-field="plan_id">Subscriber plan
              <select value={value.plan_id || ""} onChange={(e) => { const plan = (plans.data || []).find((p:Row) => p.id === e.target.value); onChange({...value,plan_id:e.target.value,plan_name:plan?.name || ""}); clearMissing(["plan_id"]); }}>
                <option value="">Choose plan</option>
                {(plans.data || []).map((p:Row) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          </>}
        </>
      )}
      <footer className="intake-actions">
        {step > 0 && (
          <button disabled={busy} onClick={() => setStep(0)}>
            <ArrowLeft size={16} />
            Back
          </button>
        )}
        <button disabled={busy || !loaded} onClick={() => save(false)}>
          Save draft
        </button>
        <button
          className="primary"
          disabled={busy || !loaded}
          onClick={() => save(true)}
        >
          {busy ? "Saving…" : "Continue"}
          <ArrowRight size={16} />
        </button>
      </footer>
    </section>
  );
}
