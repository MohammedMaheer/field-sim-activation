import { useContext, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import {
  Camera,
  ScanLine,
  CheckCircle2,
  LoaderCircle,
  CircleAlert,
  ArrowRight,
  FileText,
  RefreshCw,
} from "lucide-react";
import { Context, useResource } from "./App";
import { api, post, download, Row } from "./api";
import { Badge, Drawer, ErrorState } from "./components";
import "./transaction.css";
import TransactionProgress from "./TransactionProgress";
type Point = [number, number];
function Signature({
  value,
  onChange,
}: {
  value: Point[][];
  onChange: (v: Point[][]) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null),
    active = useRef(false);
  useEffect(() => {
    const c = ref.current!,
      ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.strokeStyle = "#642341";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (const stroke of value) {
      ctx.beginPath();
      stroke.forEach(([x, y], i) =>
        i
          ? ctx.lineTo(x * c.width, y * c.height)
          : ctx.moveTo(x * c.width, y * c.height),
      );
      ctx.stroke();
    }
  }, [value]);
  function point(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const r = e.currentTarget.getBoundingClientRect();
    return [
      Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    ];
  }
  return (
    <div className="txn-signature">
      <canvas
        ref={ref}
        width={800}
        height={200}
        aria-label="Customer signature pad"
        onPointerDown={(e) => {
          active.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          onChange([...value, [point(e)]]);
        }}
        onPointerMove={(e) => {
          if (active.current && value.flat().length < 3000)
            onChange([
              ...value.slice(0, -1),
              [...value[value.length - 1], point(e)],
            ]);
        }}
        onPointerUp={() => (active.current = false)}
        onPointerCancel={() => (active.current = false)}
      />
      <div>
        <span>Draw a synthetic customer signature</span>
        <button type="button" onClick={() => onChange([])}>
          Clear signature
        </button>
      </div>
    </div>
  );
}
export default function TransactionJourney() {
  const { user } = useContext(Context),
    agents = useResource("agents"),
    navigate = useNavigate();
  const canWrite = user.permissions.includes("ekyc.write");
  const [agent, setAgent] = useState(user.agent_id || ""),
    [record, setRecord] = useState<Row | null>(null),
    [identity, setIdentity] = useState<Row>({}),
    [kind, setKind] = useState("National Identity Card"),
    [step, setStep] = useState(1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [history, setHistory] = useState(false),
    [selfie, setSelfie] = useState(false),
    [plan, setPlan] = useState(""),
    [sim, setSim] = useState(""),
    [type, setType] = useState("Physical"),
    [number, setNumber] = useState("DEMO-050-0001"),
    [signature, setSignature] = useState<Point[][]>([]),
    [search, setSearch] = useState("");
  const operation = useRef(crypto.randomUUID());
  useEffect(() => {
    const id = sessionStorage.getItem("relay-transaction-" + user.id);
    if (id)
      api("/transactions/" + id)
        .then(apply)
        .catch(() => sessionStorage.removeItem("relay-transaction-" + user.id));
  }, [user.id]);
  const aid = agent || agents.data?.[0]?.id || "";
  const catalog = useQuery({
    queryKey: ["transaction-catalog", record?.agent_id || aid],
    queryFn: () =>
      api(
        "/transactions/catalog?agent_id=" +
          encodeURIComponent(record?.agent_id || aid),
      ),
    enabled: !!aid,
  });
  const list = useQuery<Row[]>({
    queryKey: ["transactions"],
    queryFn: () => api("/transactions"),
    enabled: history,
  });
  function apply(r: Row) {
    sessionStorage.setItem("relay-transaction-" + user.id, r.id);
    setRecord(r);
    setIdentity(r.data);
    setKind(r.data.document_type);
    setStep(r.stage);
    setPlan(r.plan_id || "");
    setSim(r.sim_id || "");
    setNumber(r.msisdn?.startsWith("DEMO-05") ? r.msisdn : "DEMO-050-0001");
    setSignature(r.data.signature || []);
    if (r.data.sim_type) setType(r.data.sim_type);
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function ensure() {
    if (record) return record;
    const r = await post("/transactions", {
      agent_id: aid,
      operation_id: operation.current,
    });
    apply(r);
    return r;
  }
  async function scan(encoded: string) {
    const r = await ensure();
    apply(
      await post(`/transactions/${r.id}/scan`, {
        version: r.version,
        document_type: kind,
        image_base64: encoded,
      }),
    );
  }
  useEffect(() => {
    if (!record || record.status !== "PROCESSING") return;
    let mounted = true;
    const timer = setInterval(
      () =>
        api("/transactions/" + record.id)
          .then((r) => {
            if (mounted) apply(r);
          })
          .catch((e) => {
            if (mounted) setError(e.message);
          }),
      3000,
    );
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [record?.id, record?.status]);
  function reset() {
    if (
      record?.status === "DRAFT" &&
      !confirm(
        "Your saved draft remains in transaction history. Start another?",
      )
    )
      return;
    sessionStorage.removeItem("relay-transaction-" + user.id);
    setRecord(null);
    setIdentity({});
    setSignature([]);
    setStep(1);
    setPlan("");
    setSim("");
    setError("");
    operation.current = crypto.randomUUID();
  }
  const plans = catalog.data?.plans || [],
    sims = (catalog.data?.sims || []).filter(
      (s: Row) =>
        s.sim_type === type &&
        `${s.iccid} ${s.serial}`.toLowerCase().includes(search.toLowerCase()),
    );
  return (
    <div className="txn-page">
      <div className="page-header">
        <div>
          <div className="eyebrow">IDENTIFY · ALLOCATE · COMPLETE</div>
          <h1>New connection</h1>
          <p>The complete field transaction, one step at a time.</p>
        </div>
        <div className="page-actions">
          <button onClick={() => setHistory(true)}>Saved transactions</button>
          <Link className="txn-link" to="/screenshot-capture">
            Screenshot OCR & review
          </Link>
        </div>
      </div>
      <div className="txn-demo">
        <FileText size={17} />
        <span>
          Demo workspace · VPS OCR is real. Identity, liveness, carrier
          activation and SMS are simulated. No payment is collected.
        </span>
      </div>
      <div className="txn-shell">
        <TransactionProgress step={step} />
        {error && (
          <div className="capture-error" role="alert">
            {error}
            {record && (
              <button
                disabled={busy}
                onClick={() =>
                  run(async () =>
                    apply(await api("/transactions/" + record.id)),
                  )
                }
              >
                Reload saved transaction
              </button>
            )}
          </div>
        )}
        {notice && (
          <p role="status" className="txn-notice">
            {notice}
          </p>
        )}
        {!canWrite ? (
          <p>
            Open Saved transactions to inspect a transaction, or use Screenshot
            OCR & review for backend verification.
          </p>
        ) : null}
        {step === 1 && canWrite && (
          <section>
            <div className="txn-section-head">
              <div>
                <span className="eyebrow">STEP 1 OF 3</span>
                <h2>Verify the customer</h2>
                <p>
                  Scan a synthetic document, review its details, then run the
                  demo selfie check.
                </p>
              </div>
              {record && <Badge value="DRAFT" />}
            </div>
            <div
              className={
                identity.ocr_lines ? "txn-grid" : "txn-grid txn-capture-only"
              }
            >
              <div>
                <label>
                  Assigned agent
                  <select
                    aria-label="Assigned agent"
                    value={record?.agent_id || aid}
                    disabled={!!record || busy}
                    onChange={(e) => setAgent(e.target.value)}
                  >
                    {agents.data?.map((a: Row) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="txn-segment">
                  {["National Identity Card", "Passport"].map((k) => (
                    <button
                      disabled={busy}
                      aria-pressed={kind === k}
                      key={k}
                      onClick={() => {
                        setKind(k);
                        if (k !== kind) setIdentity({});
                      }}
                    >
                      {k === "Passport" ? "Passport" : "National ID"}
                    </button>
                  ))}
                </div>
                <div className="txn-scanner">
                  {identity.image ? (
                    <img
                      alt="Synthetic document preview"
                      src={"data:image/png;base64," + identity.image}
                    />
                  ) : (
                    <>
                      <ScanLine size={44} />
                      <h3>Position the document clearly</h3>
                      <p>PNG or JPEG · up to 4 MB</p>
                    </>
                  )}
                  <label className="txn-file">
                    <Camera size={17} /> Scan / upload document
                    <input
                      aria-label="Scan document"
                      type="file"
                      accept="image/png,image/jpeg"
                      disabled={busy}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        run(async () => {
                          if (f.size > 4000000)
                            throw new Error("Maximum image size is 4 MB");
                          const encoded = await new Promise<string>(
                            (resolve, reject) => {
                              const reader = new FileReader();
                              reader.onload = () =>
                                resolve(String(reader.result).split(",")[1]);
                              reader.onerror = reject;
                              reader.readAsDataURL(f);
                            },
                          );
                          await scan(encoded);
                        });
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <button
                    disabled={busy || !aid}
                    onClick={() =>
                      run(async () => {
                        const sample = await api(
                          "/transactions/sample/" +
                            (kind === "Passport" ? "passport" : "id"),
                        );
                        await scan(sample.image_base64);
                      })
                    }
                  >
                    Use synthetic sample
                  </button>
                </div>
              </div>
              {identity.ocr_lines && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(async () => {
                      const r = await ensure();
                      apply(
                        await post(`/transactions/${r.id}/identity`, {
                          version: r.version,
                          ...Object.fromEntries(
                            [
                              "name",
                              "document_number",
                              "nationality",
                              "expiry",
                              "dob",
                            ].map((k) => [k, identity[k] || ""]),
                          ),
                        }),
                      );
                      setNotice(
                        "Details saved. Continue with the demo selfie check.",
                      );
                    });
                  }}
                >
                  <h3>Extracted customer details</h3>
                  <p className="muted">
                    Review and correct OCR results before continuing.
                  </p>
                  <div className="txn-fields">
                    {[
                      ["name", "Full legal name"],
                      ["document_number", "Document number"],
                      ["nationality", "Nationality"],
                      ["expiry", "Document expiry"],
                      ["dob", "Date of birth"],
                    ].map(([key, label]) => (
                      <label key={key}>
                        {label}
                        <input
                          required
                          disabled={busy || !identity.ocr_lines}
                          type={
                            ["expiry", "dob"].includes(key) ? "date" : "text"
                          }
                          maxLength={key === "document_number" ? 75 : 120}
                          value={identity[key] || ""}
                          onChange={(e) =>
                            setIdentity({
                              ...identity,
                              [key]: e.target.value,
                              identity_saved: false,
                              identity_verified: false,
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <button
                    className="primary"
                    disabled={busy || !identity.ocr_lines}
                  >
                    Save reviewed details
                  </button>
                </form>
              )}
            </div>
            {identity.ocr_lines && (
              <details className="txn-ocr">
                <summary>OCR text & confidence</summary>
                {identity.ocr_lines.map((l: Row, i: number) => (
                  <p key={i}>
                    {l.text}
                    <b>{l.confidence}%</b>
                  </p>
                ))}
              </details>
            )}
            {identity.ocr_lines && (
              <div className="txn-biometric">
                <div>
                  <h3>Selfie / liveness check</h3>
                  <p>
                    {identity.liveness === "SIMULATED_FAIL"
                      ? "Demo check failed. Retry to continue."
                      : identity.identity_verified
                        ? "Demo identity check passed."
                        : "Simulation only — no biometric verification or selfie storage."}
                  </p>
                </div>
                <button
                  disabled={busy || !identity.identity_saved}
                  onClick={() => setSelfie(true)}
                >
                  {identity.identity_verified
                    ? "Repeat demo check"
                    : "Open demo selfie check"}
                </button>
              </div>
            )}
            <div className="txn-footer">
              <button disabled={busy} onClick={() => navigate("/")}>
                Cancel & return
              </button>
              <button
                className="primary"
                disabled={!identity.identity_verified || busy}
                onClick={() => setStep(2)}
              >
                Continue to SIM & plan <ArrowRight size={16} />
              </button>
            </div>
          </section>
        )}
        {step === 2 && record && (
          <section>
            <div className="txn-section-head">
              <div>
                <span className="eyebrow">STEP 2 OF 3</span>
                <h2>Allocate SIM & plan</h2>
                <p>
                  {identity.name} · {identity.document_type} · demo identity
                  checked
                </p>
              </div>
              <button disabled={busy} onClick={() => setStep(1)}>
                Back to identity
              </button>
            </div>
            {catalog.error ? (
              <ErrorState error={catalog.error} retry={catalog.refetch} />
            ) : (
              <>
                <div className="txn-grid">
                  <div>
                    <h3>SIM / eSIM allocation</h3>
                    <div className="txn-segment">
                      {["Physical", "eSIM"].map((t) => (
                        <button
                          key={t}
                          aria-pressed={type === t}
                          disabled={busy}
                          onClick={() => {
                            setType(t);
                            setSim("");
                          }}
                        >
                          {t === "Physical" ? "Physical SIM" : "Digital eSIM"}
                        </button>
                      ))}
                    </div>
                    <label>
                      Scan or search ICCID
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Enter or paste the scanned serial"
                      />
                    </label>
                    <label>
                      Assigned SIM
                      <select
                        aria-label="Assigned SIM"
                        value={sim}
                        onChange={(e) => setSim(e.target.value)}
                        disabled={busy}
                      >
                        <option value="">Choose available stock</option>
                        {sims.map((s: Row) => (
                          <option key={s.id} value={s.id}>
                            {s.iccid}
                          </option>
                        ))}
                      </select>
                    </label>
                    {!sims.length && (
                      <p>
                        No matching stock. Change the search or ask inventory to
                        assign stock.
                      </p>
                    )}
                    <button onClick={() => catalog.refetch()}>
                      <RefreshCw size={15} /> Refresh available stock
                    </button>
                    <h3>Phone number</h3>
                    <div className="txn-numbers">
                      {catalog.data?.numbers.map((n: string) => (
                        <button
                          key={n}
                          aria-pressed={number === n}
                          onClick={() => setNumber(n)}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3>Subscriber plan</h3>
                    <div className="txn-plans">
                      {plans.map((p: Row) => (
                        <button
                          key={p.id}
                          className={plan === p.id ? "selected" : ""}
                          onClick={() => setPlan(p.id)}
                          aria-pressed={plan === p.id}
                        >
                          <b>{p.name}</b>
                          <strong>
                            AED {p.monthly_cost}
                            <small> / month</small>
                          </strong>
                          <span>
                            {p.data_gb} GB · {p.speed} · {p.contract}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <h3>Customer signature</h3>
                <Signature value={signature} onChange={setSignature} />
                <div className="txn-footer">
                  <span>Changes are saved before dispatch.</span>
                  <button
                    disabled={
                      busy || !plan || !sim || signature.flat().length < 8
                    }
                    onClick={() =>
                      run(async () => {
                        apply(
                          await post(`/transactions/${record.id}/allocate`, {
                            version: record.version,
                            plan_id: plan,
                            sim_id: sim,
                            msisdn: number,
                            signature,
                          }),
                        );
                        setNotice(
                          "Allocation draft saved. You can resume from Saved transactions.",
                        );
                      })
                    }
                  >
                    Save allocation draft
                  </button>
                  <button
                    className="primary"
                    disabled={
                      busy || !plan || !sim || signature.flat().length < 8
                    }
                    onClick={() =>
                      run(async () => {
                        const r = await post(
                          `/transactions/${record.id}/allocate`,
                          {
                            version: record.version,
                            plan_id: plan,
                            sim_id: sim,
                            msisdn: number,
                            signature,
                          },
                        );
                        apply(r);
                        apply(
                          await post(`/transactions/${record.id}/submit`, {
                            version: r.version,
                          }),
                        );
                      })
                    }
                  >
                    {busy ? "Saving…" : "Dispatch demo activation"}{" "}
                    <ArrowRight size={16} />
                  </button>
                </div>
              </>
            )}
          </section>
        )}
        {step === 3 && record && (
          <section>
            <div className="txn-success">
              {record.status === "ACTIVATED" ? (
                <CheckCircle2 size={46} />
              ) : ["PROCESSING", "SUBMITTED"].includes(record.status) ? (
                <LoaderCircle size={46} />
              ) : (
                <CircleAlert size={46} color="#b42318" />
              )}
              <h2>
                {record.status === "ACTIVATED"
                  ? "Demo activation successful"
                  : record.status === "PROCESSING"
                    ? "Activation processing"
                    : record.status}
              </h2>
              <p>
                {record.status === "PROCESSING"
                  ? "Saved securely. The result will update automatically."
                  : "Simulated carrier result · no real service activated."}
              </p>
              <Badge value={record.status} />
            </div>
            <div className="txn-receipt">
              <div className="txn-section-head">
                <h3>Relay · Demo receipt</h3>
                <b>{record.reference}</b>
              </div>
              <div className="txn-receipt-grid">
                {[
                  ["Customer", record.customer],
                  ["Document", identity.document_type],
                  ["Phone number", record.msisdn],
                  ["SIM", identity.iccid],
                  ["Plan", record.plan],
                  ["Request", record.request_id],
                  ["Agent", record.agent],
                  ["Outlet", record.outlet],
                ].map(([k, v]) => (
                  <div key={k}>
                    <span>{k}</span>
                    <b>{v}</b>
                  </div>
                ))}
              </div>
              <div className="txn-total">
                <span>Plan total · VAT included</span>
                <strong>AED {record.receipt?.total || "—"}</strong>
              </div>
              <p>
                VAT: AED {record.receipt?.vat || "—"} · No payment collected.
                Not a tax invoice or regulatory certificate.
              </p>
            </div>
            <div className="txn-footer">
              <button
                disabled={busy || record.status !== "ACTIVATED"}
                onClick={() =>
                  run(() =>
                    download(
                      `/transactions/${record.id}/receipt`,
                      record.reference + ".pdf",
                    ),
                  )
                }
              >
                Download / print receipt
              </button>
              <button
                disabled={busy || record.status !== "ACTIVATED"}
                onClick={() =>
                  run(async () => {
                    await post(`/transactions/${record.id}/sms`);
                    setNotice("SMS dispatch simulated. No message was sent.");
                  })
                }
              >
                Simulate SMS dispatch
              </button>
              <button className="primary" onClick={reset}>
                Start new transaction
              </button>
              <button onClick={() => navigate("/")}>
                Done · return to dashboard
              </button>
            </div>
          </section>
        )}
      </div>
      {history && (
        <Drawer title="Saved transactions" onClose={() => setHistory(false)}>
          {list.isPending ? (
            <p>Loading saved transactions…</p>
          ) : list.error ? (
            <ErrorState error={list.error} retry={list.refetch} />
          ) : (
            <div className="capture-history">
              {list.data?.length ? (
                list.data.map((r) => (
                  <button
                    key={r.id}
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        apply(await api("/transactions/" + r.id));
                        setHistory(false);
                      })
                    }
                  >
                    <span>
                      <b>{r.reference}</b>
                      <small>
                        {r.customer} · {r.agent}
                      </small>
                    </span>
                    <Badge value={r.status} />
                  </button>
                ))
              ) : (
                <p>No saved transactions yet.</p>
              )}
            </div>
          )}
        </Drawer>
      )}
      {selfie && (
        <Drawer title="Demo selfie / liveness" onClose={() => setSelfie(false)}>
          <div className="txn-selfie">
            <Camera size={64} />
            <h2>Look forward · blink · hold still</h2>
            <p>
              Demo selfie check. No camera image or biometric data is captured
              by this simulation.
            </p>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  apply(
                    await post(`/transactions/${record!.id}/liveness`, {
                      version: record!.version,
                      scenario: "pass",
                    }),
                  );
                  setStep(1);
                  setSelfie(false);
                })
              }
            >
              Run passing demo check
            </button>
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  apply(
                    await post(`/transactions/${record!.id}/liveness`, {
                      version: record!.version,
                      scenario: "fail",
                    }),
                  );
                  setStep(1);
                  setSelfie(false);
                })
              }
            >
              Test failed check
            </button>
          </div>
        </Drawer>
      )}
    </div>
  );
}
