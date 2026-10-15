import IntakeCamera from "./IntakeCamera";
import CustomerBackedOut from "./CustomerBackedOut";
import { useEffect, useRef, useState } from "react";
import { api, post, Row } from "./api";
import { useResource } from "./App";
import { Camera, ArrowLeft, ArrowRight } from "lucide-react";
import {
  ocrOperation,
  readStageOcr,
  withoutStageCapture,
  ocrWarning,
  OcrOperation,
  OcrTemporaryFailure,
  OcrReadCancelled,
} from "./ocrJobs";
export default function CustomerIntake({
  value,
  onChange,
  onReady,
  onSaved,
  onVersionChange,
  onWithdrawn,
  agentId,
}: {
  value: Row;
  onChange: (v: Row) => void;
  onReady: () => void;
  onSaved: () => void;
  onVersionChange: (version: number) => void;
  onWithdrawn: () => void;
  agentId?: string;
}) {
  const [camera, setCamera] = useState("");
  const [reading, setReading] = useState(false),
    [scanImage, setScanImage] = useState("");
  const [captureStatus, setCaptureStatus] = useState(
    "Reading captured screen…",
  );
  const [retryKey, setRetryKey] = useState("");
  const currentValue = useRef(value),
    alive = useRef(true),
    captureRevision = useRef(0);
  const pendingReads = useRef<Record<string, OcrOperation>>({});
  currentValue.current = value;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      captureRevision.current++;
    };
  }, []);
  const replaceValue = (next: Row) => {
    currentValue.current = next;
    onChange(next);
  };
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
    order_type: "order type",
    router_serial: "router serial",
    router_fulfilment: "router fulfilment",
    sim_identifier: "SIM barcode",
    plan_id: "subscriber plan",
    msisdn: "phone number",
    signature: "customer signature",
  };
  const [step, setStep] = useState(0),
    [version, setVersion] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [loaded, setLoaded] = useState(false),
    [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    api("/kyc-captures/draft")
      .then((r) => {
        if (live) {
          const restored: Row = {
            ...value,
            capture_mode: "SCREENSHOT_SALE",
            transaction_id: value.transaction_id || crypto.randomUUID(),
          };
          if (!restored.document_check) {
            restored.document_image = "";
            restored.step = 0;
          }
          onChange(restored);
          setVersion(r.version);
          onVersionChange(r.version);
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
  }, [loadAttempt]);
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
    replaceValue({ ...currentValue.current, [key]: v });
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
  async function detect(file: File, key: string) {
    const generation = ++captureRevision.current;
    try {
      const image = await preparedImage(file);
      const stage = key === "order_image" ? "ORDER" : "DOCUMENT";
      const details = await readStageOcr(ocrOperation(stage, image), {
        isCurrent: () =>
          alive.current && generation === captureRevision.current,
        onStatus: setCaptureStatus,
      });
      if (!alive.current || generation !== captureRevision.current)
        return false;
      if (!details[key === "order_image" ? "order_check" : "document_check"]) {
        setError(ocrWarning(details));
        return false;
      }
      setScanImage(image);
      clearMissing([key, ...Object.keys(details)]);
      replaceValue({
        ...withoutStageCapture(currentValue.current, stage),
        ...details,
        ...(stage === "ORDER" ? { sr_manual: false } : {}),
        [key]: image,
        capture_mode: "SCREENSHOT_SALE",
      });
      setError(ocrWarning(details));
      return true;
    } catch (failure: any) {
      if (failure instanceof OcrTemporaryFailure && alive.current)
        setError(failure.message);
      return false;
    }
  }
  const detectDocument = (file: File) => detect(file, "document_image");
  const detectOrder = (file: File) => detect(file, "order_image");
  async function readStoredPhoto(key: string, generation: number) {
    const image = currentValue.current[key];
    const stage = key === "order_image" ? "ORDER" : "DOCUMENT";
    const operation =
      pendingReads.current[key]?.image === image
        ? pendingReads.current[key]
        : (pendingReads.current[key] = ocrOperation(stage, image));
    const details = await readStageOcr(operation, {
      isCurrent: () =>
        alive.current &&
        generation === captureRevision.current &&
        currentValue.current[key] === image,
      onStatus: setCaptureStatus,
    });
    if (!details[key === "order_image" ? "order_check" : "document_check"])
      throw Error(
        ocrWarning(details) ||
          (key === "order_image"
            ? "Order details weren't captured clearly. Try again."
            : "Customer details weren't captured clearly. Try again."),
      );
    replaceValue({
      ...currentValue.current,
      ...details,
      ...(stage === "ORDER" ? { sr_manual: false } : {}),
    });
    clearMissing([key, ...Object.keys(details)]);
    setError(ocrWarning(details));
  }
  async function retryRetainedPhoto() {
    if (!retryKey || busy) return;
    const generation = captureRevision.current;
    setBusy(true);
    setReading(true);
    setError("");
    try {
      await readStoredPhoto(retryKey, generation);
      setRetryKey("");
    } catch (failure: any) {
      if (!(failure instanceof OcrReadCancelled)) setError(failure.message);
    } finally {
      if (alive.current) {
        setBusy(false);
        setReading(false);
      }
    }
  }
  async function photo(file: File | undefined, key: string) {
    if (!file) return;
    setBusy(true);
    setReading(key === "document_image" || key === "order_image");
    setError("");
    try {
      const image = await preparedImage(file);
      if (key === "document_image" || key === "order_image")
        setScanImage(image);
      if (key === "document_image" || key === "order_image") {
        const generation = ++captureRevision.current;
        replaceValue({
          ...withoutStageCapture(
            currentValue.current,
            key === "order_image" ? "ORDER" : "DOCUMENT",
          ),
          [key]: image,
        });
        setRetryKey("");
        await readStoredPhoto(key, generation);
      } else {
        replaceValue({ ...currentValue.current, [key]: image });
      }
    } catch (e: any) {
      if (!(e instanceof OcrReadCancelled) && alive.current) {
        if (e instanceof OcrTemporaryFailure) setRetryKey(key);
        setError(e.message);
      }
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
          throw Error(
            "Order details weren't captured clearly. Scan or upload the order screen.",
          );
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
            : [
                "order_image",
                "order_reference",
                "plan_id",
                "msisdn",
                "order_type",
                ...(value.order_type === "HW" ? ["router_fulfilment"] : []),
                ...(value.order_type === "HW" &&
                value.router_fulfilment === "ON_SPOT"
                  ? ["router_serial"]
                  : []),
              ];
        const absent = keys.filter(
          (k) =>
            !String(value[k] || "").trim() ||
            (k === "order_type" && value[k] === "UNSPECIFIED"),
        );
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
      const scan =
        next && step === 1 && value.sim_identifier
          ? await post("/inventory/scan", {
              code: value.sim_identifier,
              transaction_id: value.transaction_id,
              agent_id: value.agent_id,
            })
          : {};
      const data = {
        ...value,
        capture_mode: "SCREENSHOT_SALE",
        ...scan,
        step: next ? step + 1 : step,
      };
      const r = await api("/kyc-captures/draft", {
        method: "PUT",
        body: JSON.stringify({ version, data }),
      });
      setVersion(r.version);
      onVersionChange(r.version);
      onChange(data);
      if (!next) {
        await post("/kyc-captures/saved-drafts", { data });
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
  if (!loaded)
    return (
      <section className="customer-intake" aria-busy={!error}>
        {error ? (
          <>
            <p role="alert" className="capture-error">
              {error}
            </p>
            <button
              type="button"
              onClick={() => {
                setError("");
                setLoadAttempt((n) => n + 1);
              }}
            >
              Retry draft
            </button>
          </>
        ) : (
          <p role="status">Preparing your transaction…</p>
        )}
      </section>
    );
  return (
    <section className="customer-intake">
      <ol className="transaction-stages">
        {["Customer", "Order & plan", "Submit sale"].map((s, i) => (
          <li
            key={s}
            className={i === step ? "active" : i < step ? "complete" : ""}
          >
            <span>{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>
      <div className="intake-step-head">
        <h2>{step === 0 ? "Customer details" : "Order & plan"}</h2>
        <CustomerBackedOut
          data={value}
          version={version}
          agentId={agentId}
          disabled={busy || reading || !loaded || !!camera}
          onRecorded={onWithdrawn}
        />
      </div>
      {error && (
        <p role="alert" className="capture-error">
          {error}
        </p>
      )}
      {retryKey && (
        <button type="button" disabled={busy} onClick={retryRetainedPhoto}>
          Retry retained photo
        </button>
      )}
      {step === 0 ? (
        <>
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
              className={`document-scan ${reading ? "reading" : value.document_check ? "complete" : "ready"} ${missing.includes("document_image") ? "field-missing" : ""}`}
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
                  ? captureStatus
                  : value.document_check
                    ? "Details captured"
                    : "Photo retained · capture not confirmed"}
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
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    void photo(file, key);
                  }}
                />
              </label>
            ))}
          </div>
          {
            <div className="intake-grid">
              {input("name", "Full name")}
              {input("document_number", "Document number", "text", 80)}
              {input("nationality", "Nationality", "text", 80)}
              {input("birth_date", "Date of birth", "date")}
              {input("expiry_date", "Expiry date", "date")}
            </div>
          }
        </>
      ) : (
        <>
          {loaded && !value.order_image && !reading && (
            <IntakeCamera
              embedded
              onPhoto={(file) => photo(file, "order_image")}
              onDetect={detectOrder}
              onCode={() => {}}
              onClose={() => setCamera("")}
            />
          )}
          {(value.order_image || reading) && (
            <div
              data-intake-field="order_image"
              className={`document-scan ${reading ? "reading" : value.order_check ? "complete" : "ready"}`}
              aria-live="polite"
            >
              {value.order_image && (
                <img
                  src={"data:image/jpeg;base64," + value.order_image}
                  alt="Captured order details"
                />
              )}
              <div className="scan-beam" />
              <span className="scan-status">
                {reading
                  ? captureStatus
                  : value.order_check
                    ? "Order captured"
                    : "Photo retained · capture not confirmed"}
              </span>
            </div>
          )}
          <div className="intake-photos">
            <label className="intake-photo">
              <Camera size={28} />
              <strong>Capture order details</strong>
              <input
                type="file"
                aria-label="Order details screen"
                accept="image/png,image/jpeg"
                capture="environment"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  void photo(file, "order_image");
                }}
              />
            </label>
          </div>
          {
            <>
              <label data-intake-field="order_type">
                Order type
                <select
                  value={
                    value.order_type === "UNSPECIFIED"
                      ? ""
                      : value.order_type || ""
                  }
                  onChange={(e) => set("order_type", e.target.value)}
                >
                  <option value="">Choose order type</option>
                  {[
                    ["NEW", "New postpaid"],
                    ["MNP", "Number transfer"],
                    ["P2P", "Prepaid to postpaid"],
                    ["HW", "Home wireless"],
                    ["ELIFE", "eLife"],
                    ["WASEL", "Wasel / prepaid"],
                    ["VISITOR", "Visitor"],
                  ].map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="intake-grid order-fields">
                {[
                  ["package_name", "Package name"],
                  ["order_reference", "Request ID"],
                  ["msisdn", "Phone number"],
                  ["monthly_cost", "Monthly charge"],
                  ["prepayment", "Order prepayment"],
                ].map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input value={value[key] || ""} readOnly />
                  </label>
                ))}
              </div>
              <label data-intake-field="plan_id">
                Subscriber plan
                <select
                  value={value.plan_id || ""}
                  onChange={(e) => {
                    const plan = (plans.data || []).find(
                      (p: Row) => p.id === e.target.value,
                    );
                    onChange({
                      ...value,
                      plan_id: e.target.value,
                      plan_name: plan?.name || "",
                    });
                    clearMissing(["plan_id"]);
                  }}
                >
                  <option value="">Choose plan</option>
                  {(plans.data || []).map((p: Row) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              {value.order_type === "HW" && (
                <label data-intake-field="router_fulfilment">
                  Router fulfilment
                  <select
                    value={value.router_fulfilment || ""}
                    onChange={(e) => set("router_fulfilment", e.target.value)}
                  >
                    <option value="">Choose fulfilment</option>
                    <option value="DELIVERY">Delivery</option>
                    <option value="ON_SPOT">On spot</option>
                    <option value="WITHOUT_ROUTER">Without router</option>
                  </select>
                </label>
              )}
              {value.order_type === "HW" &&
                value.router_fulfilment === "ON_SPOT" &&
                input("router_serial", "Router serial", "text", 100)}
              <div
                className="sr-auto-read"
                role="status"
                aria-label="SR number from OCR"
              >
                <span>SR number · Auto-read</span>
                <strong>{value.sr_number || "Not recorded"}</strong>
                <small>
                  {value.sr_manual && value.sr_number
                    ? "Manually recorded · pending SR verification"
                    : value.sr_number
                      ? "Read from order"
                      : "Auto-read from order or receipt"}
                </small>
              </div>
              <details className="intake-extra">
                <summary>Additional sale details</summary>
                <div className="intake-grid">
                  {!value.receipt_sr_check &&
                    (value.sr_manual || !value.sr_number) && (
                      <label>
                        SR number · enter if not read
                        <input
                          value={value.sr_number || ""}
                          maxLength={120}
                          onChange={(event) =>
                            replaceValue({
                              ...currentValue.current,
                              sr_number: event.target.value,
                              sr_manual: true,
                            })
                          }
                        />
                      </label>
                    )}
                  {input("account_number", "Account number", "text", 120)}
                  {input("sim_identifier", "SIM serial", "text", 100)}
                  {value.order_type !== "HW" &&
                    input("router_serial", "Router serial", "text", 100)}
                  {input(
                    "advance_transaction_number",
                    "Advance transaction number",
                    "text",
                    120,
                  )}
                  {input(
                    "alternate_number",
                    "Alternate contact number",
                    "tel",
                    40,
                  )}
                </div>
              </details>
            </>
          }
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
