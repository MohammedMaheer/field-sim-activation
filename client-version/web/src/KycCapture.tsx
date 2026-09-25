import KycJourney from "./KycJourney";
import { useContext, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Camera,
  Upload,
  FileSpreadsheet,
  Image as ImageIcon,
  RefreshCw,
  Plus,
  Trash2,
} from "lucide-react";
import { Context, useResource } from "./App";
import { api, post, patch, download, Row } from "./api";
import { Badge, Panel, ErrorState, Loading } from "./components";

export default function KycCapture() {
  const { user } = useContext(Context),
    agents = useResource("agents"),
    client = useQueryClient();
  const canWrite = user.permissions.some((p: string) =>
    ["activation.write", "ekyc.write"].includes(p),
  );
  const [selected, setSelected] = useState(""),
    [agent, setAgent] = useState(""),
    [source, setSource] = useState(""),
    [file, setFile] = useState<File | null>(null);
  const [operation, setOperation] = useState(() => crypto.randomUUID()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [rows, setRows] = useState<Row[]>([]),
    [reason, setReason] = useState("Reviewed against original screenshot"),
    [review, setReview] = useState(""),
    [dirty, setDirty] = useState(false),
    [preview, setPreview] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [historyStatus, setHistoryStatus] = useState("");
  const [historyPage, setHistoryPage] = useState(0);
  const list = useQuery({
    queryKey: ["kyc-captures", historySearch, historyStatus, historyPage],
    queryFn: () => api(`/kyc-captures?limit=20&offset=${historyPage*20}&search=${encodeURIComponent(historySearch)}&status=${historyStatus}`),
    refetchInterval: 8000,
  });
  const detail = useQuery({
    queryKey: ["kyc-capture", selected],
    queryFn: () => api("/kyc-captures/" + selected),
    enabled: !!selected,
    refetchInterval: 5000,
  });
  const capture = detail.data;
  useEffect(() => {
    if (capture && !dirty) setRows(capture.rows || []);
  }, [capture, dirty]);
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  async function run(action: () => Promise<any>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await client.invalidateQueries({ queryKey: ["kyc-captures"] });
      await client.invalidateQueries({ queryKey: ["kyc-capture"] });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    await run(async () => {
      if (file.size > 4000000)
        throw new Error("Choose a PNG or JPEG screenshot up to 4 MB.");
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(new Error("Could not read this image"));
        reader.readAsDataURL(file);
      });
      const result = await post("/kyc-captures", {
        agent_id: agent || user.agent_id || agents.data?.[0]?.id,
        operation_id: operation,
        source_reference: source,
        image_base64: base64,
      });
      setDirty(false);
      setSelected(result.id);
      setFile(null);
      setSource("");
      setOperation(crypto.randomUUID());
    });
  }
  const selectCapture = (id: string) => {
    if (dirty && !window.confirm("Discard unsaved row changes?")) return;
    setDirty(false);
    setSelected(id);
    setError("");
    setReview("");
  };
  const editable =
    canWrite &&
    ["EXTRACTED", "VALIDATED", "REJECTED"].includes(capture?.status);
  function change(index: number, key: string, value: any) {
    setDirty(true);
    setRows(rows.map((r, i) => (i === index ? { ...r, [key]: value } : r)));
  }
  return (
    <>
      <div className="page-header">
        <div>
          <div className="eyebrow">CAPTURE · EXTRACT · VERIFY</div>
          <h1>KYC transaction capture</h1>
          <p>
            Turn transaction screenshots into reviewed records and an auditable
            Excel file.
          </p>
        </div>
        <button
          onClick={() =>
            run(async () => {
              await list.refetch();
              await detail.refetch();
            })
          }
          disabled={busy}
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>
      <KycJourney status={capture?.status} />
      {error && (
        <div role="alert" className="capture-error">
          {error}
        </div>
      )}
      <div className="capture-layout">
        <div>
          {canWrite && (
            <Panel
              title="Capture a transaction"
              subtitle="PNG or JPEG · up to 4 MB and 6 megapixels"
            >
              <form
                id="capture-form"
                className="capture-upload"
                onSubmit={upload}
              >
                <label>
                  Assigned agent
                  <select
                    required
                    value={agent || user.agent_id || agents.data?.[0]?.id || ""}
                    onChange={(e) => setAgent(e.target.value)}
                  >
                    {agents.data?.map((a: Row) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Source transaction reference
                  <input
                    required
                    minLength={2}
                    maxLength={120}
                    placeholder="Reference from the telecom screen"
                    value={source}
                    onChange={(e) => {
                      setSource(e.target.value);
                      setOperation(crypto.randomUUID());
                    }}
                  />
                </label>
                <div className="capture-picker">
                  <ImageIcon size={28} />
                  <b>{file?.name || "Choose a transaction screenshot"}</b>
                  <span>
                    Original image is encrypted and retained for review.
                  </span>
                  <div>
                    <label className="capture-file">
                      <Upload size={16} />
                      Upload image
                      <input
                        aria-label="Upload screenshot"
                        type="file"
                        accept="image/png,image/jpeg"
                        onChange={(e) => {
                          setFile(e.target.files?.[0] || null);
                          setOperation(crypto.randomUUID());
                        }}
                      />
                    </label>
                    <label className="capture-file">
                      <Camera size={16} />
                      Take photo
                      <input
                        aria-label="Take transaction photo"
                        type="file"
                        accept="image/png,image/jpeg"
                        capture="environment"
                        onChange={(e) => {
                          setFile(e.target.files?.[0] || null);
                          setOperation(crypto.randomUUID());
                        }}
                      />
                    </label>
                  </div>
                </div>
                {preview && (
                  <img
                    className="capture-preview"
                    src={preview}
                    alt="Selected transaction screenshot"
                  />
                )}
                <button
                  className="primary"
                  disabled={busy || !file || !agents.data?.length}
                >
                  {busy ? "Uploading…" : "Upload & run VPS OCR"}
                </button>
              </form>
            </Panel>
          )}
          <Panel
            title="Capture history"
            subtitle="Search every capture in your authorized scope"
          >
            <div className="capture-upload">
              <label>Search capture reference<input value={historySearch} maxLength={120} onChange={e=>{setHistorySearch(e.target.value);setHistoryPage(0);}} placeholder="Transaction reference"/></label>
              <label>Verification status<select value={historyStatus} onChange={e=>{setHistoryStatus(e.target.value);setHistoryPage(0);}}><option value="">All statuses</option>{["QUEUED","OCR_FAILED","EXTRACTED","VALIDATED","SUBMITTED","VERIFIED","REJECTED"].map(s=><option key={s} value={s}>{s.replaceAll("_"," ")}</option>)}</select></label>
              <div className="capture-toolbar"><button disabled={!historyPage||list.isFetching} onClick={()=>setHistoryPage(p=>p-1)}>Previous captures</button><span>Page {historyPage+1}</span><button disabled={list.isFetching||(list.data?.length||0)<20} onClick={()=>setHistoryPage(p=>p+1)}>Next captures</button></div>
            </div>
            {list.isPending ? (
              <Loading />
            ) : list.error ? (
              <ErrorState error={list.error} retry={list.refetch} />
            ) : (
              <div id="capture-history" className="capture-history">
                {list.data?.length ? (
                  list.data.map((r: Row) => (
                    <button
                      className={r.id === selected ? "selected" : ""}
                      key={r.id}
                      onClick={() => selectCapture(r.id)}
                    >
                      <span>
                        <b>{r.source_reference}</b>
                        <small>
                          {new Date(r.created_at + "Z").toLocaleString()}
                        </small>
                      </span>
                      <Badge value={r.status} />
                    </button>
                  ))
                ) : (
                  <p>{historySearch || historyStatus || historyPage ? "No matching captures. Adjust the filters or return to the previous page." : "No captures yet. Upload a screenshot to begin."}</p>
                )}
              </div>
            )}
          </Panel>
        </div>
        <div>
          {!selected ? (
            <Panel
              title={
                list.data?.length
                  ? "Select a capture to inspect"
                  : "Ready for your first capture"
              }
            >
              <div className="capture-empty">
                <ImageIcon size={32} />
                <div>
                  <h2>
                    {list.data?.length
                      ? "Review the original and extracted rows"
                      : "One original. A complete history."}
                  </h2>
                  <p>
                    {list.data?.length
                      ? "Choose an item from capture history, or upload a new transaction screenshot."
                      : "Upload a screen, review its OCR lines, organize transaction rows and send them to your backend team."}
                  </p>
                </div>
              </div>
            </Panel>
          ) : detail.isPending ? (
            <Loading />
          ) : detail.error ? (
            <ErrorState error={detail.error} retry={detail.refetch} />
          ) : (
            capture && (
              <>
                <Panel
                  title={capture.source_reference}
                  subtitle={"Capture " + capture.id.slice(0, 8)}
                >
                  <div className="capture-detail">
                    <div className="capture-toolbar">
                      <Badge value={capture.status} />
                      <button
                        disabled={busy}
                        onClick={() =>
                          run(() =>
                            download(
                              "/kyc-captures/" + capture.id + "/original",
                              "original-" +
                                capture.id +
                                "." +
                                (capture.image_type === "image/jpeg"
                                  ? "jpg"
                                  : "png"),
                            ),
                          )
                        }
                      >
                        Download original
                      </button>
                    </div>
                    <p className="field-help">
                      Original SHA-256:{" "}
                      <span className="capture-hash">{capture.image_hash}</span>
                    </p>
                    {capture.status === "QUEUED" && (
                      <p role="status">
                        Screenshot saved. VPS OCR is processing it; you can
                        leave this page and return.
                      </p>
                    )}
                    {capture.status === "OCR_FAILED" && (
                      <div role="alert">
                        <p>{capture.error}</p>
                        {canWrite && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              run(() =>
                                post("/kyc-captures/" + capture.id + "/retry", {
                                  version: capture.version,
                                }),
                              )
                            }
                          >
                            Retry VPS OCR
                          </button>
                        )}
                      </div>
                    )}
                    {!!capture.lines?.length && (
                      <details open>
                        <summary>
                          Extracted text · {capture.lines.length} lines
                        </summary>
                        <p className="field-help">
                          OCR confidence is not verification. Add relevant lines
                          to the transaction table and correct any recognition
                          errors.
                        </p>
                        <div className="ocr-lines">
                          {capture.lines.map((line: Row, i: number) => (
                            <div key={i}>
                              <span>
                                <small>
                                  Line {i + 1} · {line.confidence}%
                                </small>
                                <p dir="auto">{line.text}</p>
                              </span>
                              {editable && (
                                <button
                                  aria-label={"Add OCR line " + (i + 1)}
                                  disabled={rows.length >= 100}
                                  onClick={() => {
                                    setRows([
                                      ...rows,
                                      {
                                        reference: "",
                                        customer: "",
                                        account: "",
                                        details: line.text,
                                        source_line: i,
                                      },
                                    ]);
                                    setDirty(true);
                                  }}
                                >
                                  <Plus size={16} />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                    {(editable || rows.length > 0) && (
                      <section className="capture-rows">
                        <h2>Transaction rows</h2>
                        {rows.length === 0 && (
                          <p>Select an OCR line above or add a row below.</p>
                        )}
                        {rows.map((r, i) => (
                          <fieldset key={i}>
                            <legend>
                              Transaction {i + 1}
                              {r.source_line !== null
                                ? " · OCR line " + (r.source_line + 1)
                                : " · Manual entry"}
                            </legend>
                            <label>
                              Transaction reference
                              <input
                                required
                                minLength={2}
                                maxLength={120}
                                disabled={!editable}
                                value={r.reference}
                                onChange={(e) =>
                                  change(i, "reference", e.target.value)
                                }
                              />
                            </label>
                            <label>
                              Customer
                              <input
                                maxLength={120}
                                disabled={!editable}
                                value={r.customer}
                                onChange={(e) =>
                                  change(i, "customer", e.target.value)
                                }
                              />
                            </label>
                            <label>
                              Account / MSISDN
                              <input
                                maxLength={80}
                                disabled={!editable}
                                value={r.account}
                                onChange={(e) =>
                                  change(i, "account", e.target.value)
                                }
                              />
                            </label>
                            <label>
                              Transaction details
                              <textarea
                                required
                                minLength={2}
                                maxLength={1000}
                                disabled={!editable}
                                value={r.details}
                                onChange={(e) =>
                                  change(i, "details", e.target.value)
                                }
                              />
                            </label>
                            {editable && (
                              <button
                                onClick={() => {
                                  setRows(rows.filter((_, n) => n !== i));
                                  setDirty(true);
                                }}
                              >
                                <Trash2 size={15} />
                                Remove row
                              </button>
                            )}
                          </fieldset>
                        ))}
                        {editable && (
                          <>
                            <button
                              disabled={rows.length >= 100}
                              onClick={() => {
                                setRows([
                                  ...rows,
                                  {
                                    reference: "",
                                    customer: "",
                                    account: "",
                                    details: "",
                                    source_line: null,
                                  },
                                ]);
                                setDirty(true);
                              }}
                            >
                              <Plus size={16} />
                              Add transaction row
                            </button>
                            <label>
                              Review / correction note
                              <input
                                minLength={3}
                                maxLength={300}
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                              />
                            </label>
                            <button
                              className="primary"
                              disabled={
                                busy ||
                                !rows.length ||
                                reason.trim().length < 3 ||
                                rows.some(
                                  (r) =>
                                    r.reference.trim().length < 2 ||
                                    r.details.trim().length < 2,
                                )
                              }
                              onClick={() =>
                                run(async () => {
                                  await patch(
                                    "/kyc-captures/" + capture.id + "/rows",
                                    { version: capture.version, rows, reason },
                                  );
                                  setDirty(false);
                                })
                              }
                            >
                              Save & validate rows
                            </button>
                            {dirty && (
                              <p className="field-help">
                                Unsaved changes. Validate before leaving or
                                exporting.
                              </p>
                            )}
                          </>
                        )}
                      </section>
                    )}
                    {!!capture.rows?.length &&
                      capture.status !== "EXTRACTED" && (
                        <div className="capture-toolbar">
                          <button
                            disabled={busy || dirty}
                            onClick={() =>
                              run(() =>
                                download(
                                  "/kyc-captures/" + capture.id + "/excel",
                                  "kyc-" + capture.id + ".xlsx",
                                ),
                              )
                            }
                          >
                            <FileSpreadsheet size={16} />
                            Generate Excel
                          </button>
                          {capture.status === "VALIDATED" && canWrite && (
                            <button
                              className="primary"
                              disabled={busy || dirty}
                              onClick={() =>
                                run(() =>
                                  post(
                                    "/kyc-captures/" + capture.id + "/submit",
                                    { version: capture.version },
                                  ),
                                )
                              }
                            >
                              Submit to backend team
                            </button>
                          )}
                        </div>
                      )}
                    {capture.status === "SUBMITTED" && (
                      <section className="capture-review">
                        <h2>Awaiting backend review</h2>
                        <p>
                          The backend team compares the original screenshot and
                          validated rows. The decision will sync here
                          automatically.
                        </p>
                        {user.permissions.includes("compliance.write") && (
                          <>
                            <label>
                              Review decision reason
                              <textarea
                                minLength={5}
                                maxLength={300}
                                value={review}
                                onChange={(e) => setReview(e.target.value)}
                              />
                            </label>
                            <div className="capture-toolbar">
                              {["VERIFIED", "REJECTED"].map((outcome) => (
                                <button
                                  key={outcome}
                                  disabled={busy || review.trim().length < 5}
                                  onClick={() =>
                                    run(() =>
                                      post(
                                        "/kyc-captures/" +
                                          capture.id +
                                          "/review",
                                        {
                                          version: capture.version,
                                          outcome,
                                          reason: review,
                                        },
                                      ),
                                    )
                                  }
                                >
                                  {outcome === "VERIFIED"
                                    ? "Mark verified"
                                    : "Reject for correction"}
                                </button>
                              ))}
                            </div>
                            <p className="field-help">
                              A different authorized user must review the
                              capture.
                            </p>
                          </>
                        )}
                      </section>
                    )}
                    {capture.review && (
                      <div className="compliance-banner">
                        <div>
                          <b>
                            {capture.review.outcome} · {capture.review.reviewer}
                          </b>
                          <p>{capture.review.reason}</p>
                        </div>
                      </div>
                    )}
                    <h2>History</h2>
                    <ol className="capture-timeline">
                      {capture.history?.map((event: Row, i: number) => (
                        <li key={i}>
                          <b>{event.action}</b>
                          <span>
                            {event.actor} ·{" "}
                            {new Date(event.at + "Z").toLocaleString()}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </Panel>
              </>
            )
          )}
        </div>
      </div>
    </>
  );
}
