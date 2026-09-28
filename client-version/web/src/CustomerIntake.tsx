import IntakeCamera from "./IntakeCamera";
import { useEffect, useState } from "react";
import { api, post, Row } from "./api";
import { useResource } from "./App";
import { Signature } from "./TransactionJourney";
import { Camera, ArrowLeft, ArrowRight, Check } from "lucide-react";
export default function CustomerIntake({
  value,
  onChange,
  onReady,
}: {
  value: Row;
  onChange: (v: Row) => void;
  onReady: () => void;
}) {
  const [camera, setCamera] = useState("");
  const [reading,setReading]=useState(false),[scanImage,setScanImage]=useState("");
  const plans = useResource("plans");
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
          onChange({ ...r.data, ...value });
          setVersion(r.version);
          setStep(Math.min(r.data.step || 0, 1));
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
    setError("");
    onChange({ ...value, [key]: v });
  };
  async function photo(file: File | undefined, key: string) {
    if (!file) return;
    setBusy(true);
    setReading(key==='document_image');
    setError("");
    try {
      if (
        !["image/png", "image/jpeg"].includes(file.type) ||
        file.size > 10000000
      )
        throw Error("Choose a PNG or JPEG photo under 10 MB.");
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas"),
        scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
      canvas.width = bitmap.width * scale;
      canvas.height = bitmap.height * scale;
      canvas
        .getContext("2d")!
        .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const image = canvas.toDataURL("image/jpeg", 0.75).split(",")[1];
      if (image.length > 1333336) throw Error("Choose a smaller photo.");
      if(key==='document_image')setScanImage(image);
      let details = {};
      if (key === "document_image") {
        try {
          details = await post("/kyc-captures/read-document", {
            image_base64: image,
          });
        } catch {
          setError("Photo saved. Please enter or check the details below.");
        }
      }
      onChange({ ...value, ...details, [key]: image });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);setReading(false);
    }
  }
  async function save(next: boolean) {
    setBusy(true);
    setError("");
    try {
      if (next) {
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
            : ["sim_identifier", "plan_id", "msisdn"];
        if (keys.some((k) => !String(value[k] || "").trim()))
          throw Error("Please complete the required details.");
        if (
          step === 0 &&
          (value.expiry_date < new Date().toISOString().slice(0, 10) ||
            value.birth_date >= new Date().toISOString().slice(0, 10))
        )
          throw Error("Check date of birth and document expiry.");
        if (step === 1 && (value.signature || []).flat().length < 8)
          throw Error("Please add the customer signature.");
      }
      const data = { ...value, step: next ? step + 1 : step };
      const r = await api("/kyc-captures/draft", {
        method: "PUT",
        body: JSON.stringify({ version, data }),
      });
      setVersion(r.version);
      onChange(data);
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
      <label key={key}>
        {label}
        <input
          type={type}
          maxLength={max}
          value={value[key] || ""}
          onChange={(e) => set(key, e.target.value)}
        />
      </label>
    );
  }
  return (
    <section className="customer-intake">
      <ol className="transaction-stages">
        {["Identity", "SIM & plan", "Receipt"].map((s, i) => (
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
      {camera && (
        <IntakeCamera
          selfie={camera === "selfie_image"}
          barcode={camera === "barcode"}
          onPhoto={(f) => photo(f, camera)}
          onCode={(code) => set("sim_identifier", code)}
          onClose={() => setCamera("")}
        />
      )}
      {step === 0 ? (
        <>
          <h2>Customer identity</h2>
          <div className="intake-choice">
            <button
              className={value.document_type !== "Passport" ? "primary" : ""}
              onClick={() => set("document_type", "National ID")}
            >
              Emirates ID
            </button>
            <button
              className={value.document_type === "Passport" ? "primary" : ""}
              onClick={() => set("document_type", "Passport")}
            >
              Passport
            </button>
          </div>
          <div className="intake-choice">
            <button onClick={() => setCamera("document_image")}>
              <Camera size={18} />
              Scan document
            </button>
            <button onClick={() => setCamera("selfie_image")}>
              Selfie · optional
            </button>
          </div>
          <div className={`document-scan ${reading?'reading':value.document_image?'complete':'ready'}`} aria-live="polite">{(scanImage||value.document_image)?<img src={'data:image/jpeg;base64,'+(scanImage||value.document_image)} alt="Captured identity document"/>:<div className="scan-document-placeholder"><Camera size={42}/><strong>{value.document_type==='Passport'?'Passport':'Emirates ID'}</strong></div>}<div className="scan-beam"/><span className="scan-status">{reading?'Reading document…':value.document_image?'Document captured':'Position document'}</span></div>
          <div className="intake-photos">
            {[
              ["document_image", "Identity document"],
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
          <div className="intake-grid">
            {input("name", "Full name")}
            {input("document_number", "Document number", "text", 80)}
            {input("nationality", "Nationality", "text", 80)}
            {input("birth_date", "Date of birth", "date")}
            {input("expiry_date", "Expiry date", "date")}
          </div>
        </>
      ) : (
        <>
          <h2>SIM & plan</h2>
          <div className="intake-choice">
            <button
              className={value.sim_type !== "ESIM" ? "primary" : ""}
              onClick={() => set("sim_type", "PHYSICAL")}
            >
              Physical SIM
            </button>
            <button
              className={value.sim_type === "ESIM" ? "primary" : ""}
              onClick={() => set("sim_type", "ESIM")}
            >
              eSIM
            </button>
          </div>
          <div className="intake-grid">
            {input(
              "sim_identifier",
              value.sim_type === "ESIM"
                ? "eSIM identifier"
                : "SIM serial / ICCID",
              "text",
              100,
            )}
            {input("msisdn", "Phone number", "tel", 40)}
          </div>
          <button onClick={() => setCamera("barcode")}>Scan SIM barcode</button>
          <h3>Select plan</h3>
          {plans.isPending ? (
            <p>Loading plans…</p>
          ) : plans.error ? (
            <button onClick={() => plans.refetch()}>Reload plans</button>
          ) : (
            <div className="intake-plans">
              {plans.data?.map((p: Row) => (
                <button
                  key={p.id}
                  className={value.plan_id === p.id ? "selected" : ""}
                  onClick={() =>
                    onChange({ ...value, plan_id: p.id, plan_name: p.name })
                  }
                >
                  <strong>{p.name}</strong>
                  <span>AED {p.monthly_cost}</span>
                  {value.plan_id === p.id && <Check size={18} />}
                </button>
              ))}
            </div>
          )}
          <h3>Customer signature</h3>
          <Signature
            value={value.signature || []}
            onChange={(v) => set("signature", v)}
          />
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
