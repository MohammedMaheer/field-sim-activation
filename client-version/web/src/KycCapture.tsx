import ActivationReceipt from "./ActivationReceipt";
import CustomerIntake from "./CustomerIntake";
import ReceiptReview from "./ReceiptReview";
import KycJourney from "./KycJourney";
import RecordOverview from "./RecordOverview";
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
import { Badge, Panel, ErrorState, Loading, Drawer } from "./components";

export default function KycCapture() {
  const { user } = useContext(Context),
    agents = useResource("agents"),
    client = useQueryClient();
  const canWrite = user.permissions.some((p: string) =>
    ["activation.write", "ekyc.write"].includes(p),
  );
  const canReview = user.permissions.includes("compliance.write");
  const activity = useQuery<Row[]>({queryKey:["kyc-captures","overview"],queryFn:() => api("/kyc-captures?limit=100"),enabled:canReview,refetchInterval:8000});
  const [intake, setIntake] = useState<Row>({});
  const [intakeReady, setIntakeReady] = useState(false);
  const [draftsOpen,setDraftsOpen] = useState(false);
  const drafts = useQuery({queryKey:['saved-capture-drafts'],queryFn:() => api('/kyc-captures/saved-drafts'),enabled:draftsOpen});
  const [selected, setSelected] = useState(() => new URLSearchParams(window.location.search).get("capture") || ""),
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
  const [showUpload, setShowUpload] = useState(canWrite && !canReview);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [historyStatus, setHistoryStatus] = useState(
    canReview ? "SUBMITTED" : "",
  );
  const [historyPage, setHistoryPage] = useState(0);
  const [showSamples, setShowSamples] = useState(false);
  const list = useQuery({
    queryKey: ["kyc-captures", historySearch, historyStatus, historyPage, showSamples],
    queryFn: () =>
      api(
        `/kyc-captures?limit=20&offset=${historyPage * 20}&search=${encodeURIComponent(historySearch)}&status=${["READY", "COMPLETED"].includes(historyStatus) ? "" : historyStatus}&stage=${["READY", "COMPLETED"].includes(historyStatus) ? historyStatus : ""}&include_samples=${showSamples}`,
      ),
    refetchInterval: 8000,
  });
  const detail = useQuery({
    queryKey: ["kyc-capture", selected],
    queryFn: () => api("/kyc-captures/" + selected),
    enabled: !!selected,
    refetchInterval: 5000,
  });
  const capture = detail.data;
  const reviewMode =
    canReview &&
    capture &&
    !(
      capture.creator_id === user.id &&
      ["QUEUED", "OCR_FAILED", "EXTRACTED", "VALIDATED", "REJECTED"].includes(
        capture.status,
      )
    );
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
        document_kind: "PAYMENT_CONFIRMATION",
        image_base64: base64,
        intake,
      });
      setDirty(false);
      setSelected(result.id);
      setShowUpload(false);
      setFile(null);
      setSource("");
      setOperation(crypto.randomUUID());
    });
  }
  const selectCapture = (id: string) => {
    if (dirty && !window.confirm("Discard unsaved row changes?")) return;
    setDirty(false);
    setSelected(id);
    setHistoryOpen(false);
    setShowUpload(false);
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
      <div className={`page-header ${reviewMode ? "review-page-header" : ""}`}>
        <div>
          <div className="eyebrow">TRANSACTIONS</div>
          <h1>{canReview ? "Backend verification" : canWrite ? "New transaction" : "Transaction history"}</h1>
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
      <div className="capture-workspace-nav">
        <span />
        <div>
          <button onClick={() => setHistoryOpen(true)}>Capture history</button>
          {canWrite && <button onClick={() => {setDraftsOpen(true);drafts.refetch();}}>Drafts</button>}
          {canWrite && (
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  if (dirty && !window.confirm("Discard unsaved row changes?"))
                    return;
                  const draft = await api("/kyc-captures/draft");
                  await api("/kyc-captures/draft", {
                    method: "PUT",
                    body: JSON.stringify({ version: draft.version, data: {} }),
                  });
                  setIntake({});
                  setIntakeReady(false);
                  setSelected("");
                  setDirty(false);
                  setShowUpload(true);
                  setError("");
                })
              }
            >
              New transaction capture
            </button>
          )}
        </div>
      </div>
      {draftsOpen && <Drawer title="Drafts" onClose={() => setDraftsOpen(false)}>
        {drafts.isLoading ? <p>Loading drafts…</p> : drafts.isError ? <p role="alert">Could not load drafts</p> : (drafts.data || []).length === 0 ? <p>No saved drafts</p> : (drafts.data || []).map((d:Row) => <div key={d.id} className="draft-card"><button onClick={() => {setIntake(d.data);setIntakeReady(false);setSelected('');setShowUpload(true);setDraftsOpen(false);}}><b>{d.data.name || 'New customer'}</b><small>Step {(d.data.step || 0)+1} of 3</small></button><button onClick={async () => {if(!window.confirm('Discard this draft?'))return;try{await api(`/kyc-captures/saved-drafts/${d.id}`,{method:'DELETE'});drafts.refetch();}catch(e:any){setError(e.message);}}}>Discard</button></div>)}
      </Drawer>}
      {(canReview || !canWrite) && !selected && !showUpload && activity.data && (
        <RecordOverview rows={activity.data || []} title="Latest verification records" />
      )}
      {(canReview || !canWrite) && !selected && !showUpload && (
        <section className="review-inbox">
          <div className="review-inbox-header">
            <div>
              <h2>{canReview ? "Submissions for verification" : "Transaction history"}</h2>
            </div>
            <label>
              Status
              <select
                value={historyStatus}
                onChange={(e) => {
                  setHistoryStatus(e.target.value);
                  setHistoryPage(0);
                }}
              >
                <option value="SUBMITTED">Awaiting review</option>
                <option value="READY">Ready for activation</option>
                <option value="COMPLETED">Completed activations</option>
                <option value="VERIFIED">Verified history</option>
                <option value="REJECTED">Needs correction</option>
                <option value="">All captures</option>
              </select>
            </label>
            <label>
              Search reference
              <input
                value={historySearch}
                onChange={(e) => {
                  setHistorySearch(e.target.value);
                  setHistoryPage(0);
                }}
                placeholder="Transaction reference"
              />
            </label>
            <label className="review-sample-toggle"><input type="checkbox" checked={showSamples} onChange={(event) => { setShowSamples(event.target.checked); setHistoryPage(0); }} /> Include earlier records</label>
          </div>
          {list.isPending ? (
            <Loading />
          ) : list.error ? (
            <ErrorState error={list.error} retry={list.refetch} />
          ) : list.data?.length ? (
            <div className="review-inbox-list">
              {list.data.map((r: Row) => (
                <button key={r.id} onClick={() => selectCapture(r.id)}>
                  <span>
                    <strong>{r.source_reference}</strong>
                    <small>
                      {agents.data?.find((a: Row) => a.id === r.agent_id)
                        ?.name || r.agent_id}
                    </small>
                    <small>
                      {r.document_kind === "PAYMENT_CONFIRMATION"
                        ? "Payment confirmation"
                        : "Historical receipt"}
                    </small>
                  </span>
                  <span>
                    <small>
                      {new Date(r.created_at + "Z").toLocaleString()}
                    </small>
                    <Badge value={r.status} />
                  </span>
                  <b>Review →</b>
                </button>
              ))}
            </div>
          ) : (
            <div className="review-inbox-empty">
              <h3>No submissions in this view</h3>
              <p>
                New agent submissions will appear here automatically. Try
                another status or search.
              </p>
            </div>
          )}
          <div className="capture-toolbar">
            <button
              disabled={!historyPage || list.isFetching}
              onClick={() => setHistoryPage((p) => p - 1)}
            >
              Previous
            </button>
            <span>Page {historyPage + 1}</span>
            <button
              disabled={list.isFetching || (list.data?.length || 0) < 20}
              onClick={() => setHistoryPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </section>
      )}
      <div
        className={`capture-workspace ${reviewMode ? "backend-review" : ""}`}
      >
        {(selected || (showUpload && intakeReady)) && !reviewMode && (
          <KycJourney status={capture?.status} />
        )}
        {error && (
          <div role="alert" className="capture-error">
            {error}
          </div>
        )}
        <div
          className={`capture-layout capture-focused ${selected ? "has-selection" : "capture-start"} ${!canWrite ? "capture-readonly" : ""}`}
        >
          <div>
            {canWrite && showUpload && !intakeReady && (
              <CustomerIntake
                value={intake}
                onChange={v => {setIntake(v);if(v.agent_id)setAgent(v.agent_id);}}
                onReady={() => setIntakeReady(true)}
                onSaved={() => {setIntake({});setIntakeReady(false);setShowUpload(false);setDraftsOpen(true);drafts.refetch();}}
              />
            )}
            {canWrite && intakeReady && (
              <div hidden={!showUpload}>
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
                        value={
                          agent || user.agent_id || agents.data?.[0]?.id || ""
                        }
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
                      Request ID (optional)
                      <input
                        maxLength={120}
                        placeholder="Order request ID"
                        value={source}
                        onChange={(e) => {
                          setSource(e.target.value);
                          setOperation(crypto.randomUUID());
                        }}
                      />
                    </label>
                    <div className="capture-picker">
                      <ImageIcon size={28} />
                      <b>{file?.name || "Choose payment confirmation"}</b>
                      <span>
                        Your confirmation will be available for review.
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
                        alt="Selected payment confirmation"
                      />
                    )}
                    <button
                      className="primary"
                      disabled={busy || !file || !agents.data?.length}
                    >
                      {busy ? "Uploading…" : "Upload payment confirmation"}
                    </button>
                  </form>
                </Panel>
              </div>
            )}
          </div>
          <div>
            {!selected ? null : detail.isPending ? (
              <Loading />
            ) : detail.error ? (
              <ErrorState error={detail.error} retry={detail.refetch} />
            ) : (
              capture && (
                <>
                  {reviewMode ? (
                    <ReceiptReview
                      key={capture.id}
                      capture={capture}
                      agent={agents.data?.find(
                        (a: Row) => a.id === capture.agent_id,
                      )}
                      user={user}
                      onBack={() => {
                        setSelected("");
                        setShowUpload(false);
                        setHistoryStatus("SUBMITTED");
                        setReview("");
                        setDirty(false);
                      }}
                      onSaved={async () => {
                        await client.invalidateQueries({
                          queryKey: ["kyc-capture"],
                        });
                        await client.invalidateQueries({
                          queryKey: ["kyc-captures"],
                        });
                      }}
                    />
                  ) : (
                    <Panel
                      title={capture.source_reference}
                      subtitle={"Capture " + capture.id.slice(0, 8)}
                    >
                      <div className="capture-detail">
                        <ActivationReceipt capture={capture} />
                        <details className="capture-supporting" open={!["SUBMITTED", "VERIFIED", "REJECTED"].includes(capture.status) ? true : undefined}>
                        <summary>Payment details & history</summary>
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

                        {capture.status === "QUEUED" && (
                          <p role="status">
                            Your confirmation is being prepared. You can return
                            later.
                          </p>
                        )}
                        {capture.status === "OCR_FAILED" && (
                          <div role="alert">
                            <p>We couldn't read this image automatically. Add the details below or try again.</p>
                            {canWrite && (
                              <button
                                disabled={busy}
                                onClick={() =>
                                  run(() =>
                                    post(
                                      "/kyc-captures/" + capture.id + "/retry",
                                      {
                                        version: capture.version,
                                      },
                                    ),
                                  )
                                }
                              >
                                Try again
                              </button>
                            )}
                          </div>
                        )}
                        {!!capture.lines?.length && (
                          <details open={rows.length === 0}>
                            <summary>
                              {capture.document_kind === "PAYMENT_CONFIRMATION"
                                ? "Text from image"
                                : "Receipt text"} · {capture.lines.length} lines
                            </summary>
                            <p className="field-help">
                              Use the uploaded text to check or add missing
                              details.
                            </p>
                            <div className="ocr-lines">
                              {capture.lines.map((line: Row, i: number) => (
                                <div key={i}>
                                  <span>
                                    <small>Line {i + 1}</small>
                                    <p dir="auto">{line.text}</p>
                                  </span>
                                  {editable && (
                                    <button
                                    aria-label={"Add image text " + (i + 1)}
                                      disabled={rows.length >= 100}
                                      onClick={() => {
                                        setRows([
                                          ...rows,
                                          {
                                            fields: [
                                              {
                                                label: capture.document_kind === "PAYMENT_CONFIRMATION" ? "Image text" : "Receipt text",
                                                value: line.text,
                                                source_line: i,
                                                confidence: line.confidence,
                                              },
                                            ],
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
                            <h2>{capture.document_kind === "PAYMENT_CONFIRMATION" ? "Payment details" : "Transaction rows"}</h2>

                            {rows.length === 0 && (
                              <p>
                                Add details from the image or create a new row.
                              </p>
                            )}
                            {rows.map((r, i) => (
                              <fieldset key={i}>
                                <legend>
                                  Transaction {i + 1}
                                  {r.source_line !== null
                                    ? " · Line " + (r.source_line + 1)
                                    : " · Manual entry"}
                                </legend>
                                {Array.isArray(r.fields) ? (
                                  <div className="receipt-fields">
                                    {r.fields.map((field: Row, fi: number) => (
                                      <div className="receipt-field" key={fi}>
                                        <label>
                                          Field name
                                          <input
                                            aria-label={`Field name ${i + 1}.${fi + 1}`}
                                            maxLength={120}
                                            disabled={!editable}
                                            value={field.label}
                                            onChange={(e) => {
                                              change(
                                                i,
                                                "fields",
                                                r.fields.map(
                                                  (f: Row, n: number) =>
                                                    n === fi
                                                      ? {
                                                          ...f,
                                                          label: e.target.value,
                                                        }
                                                      : f,
                                                ),
                                              );
                                            }}
                                          />
                                        </label>
                                        <label>
                                          Value
                                          <textarea
                                            aria-label={`Value ${i + 1}.${fi + 1}`}
                                            dir="auto"
                                            maxLength={1000}
                                            disabled={!editable}
                                            value={field.value}
                                            onChange={(e) =>
                                              change(
                                                i,
                                                "fields",
                                                r.fields.map(
                                                  (f: Row, n: number) =>
                                                    n === fi
                                                      ? {
                                                          ...f,
                                                          value: e.target.value,
                                                        }
                                                      : f,
                                                ),
                                              )
                                            }
                                          />
                                        </label>

                                        {editable && (
                                          <button
                                            aria-label={`Remove field ${i + 1}.${fi + 1}`}
                                            onClick={() =>
                                              change(
                                                i,
                                                "fields",
                                                r.fields.filter(
                                                  (_: Row, n: number) =>
                                                    n !== fi,
                                                ),
                                              )
                                            }
                                          >
                                            <Trash2 size={15} />
                                            Remove field
                                          </button>
                                        )}
                                      </div>
                                    ))}
                                    {editable && (
                                      <button
                                        disabled={r.fields.length >= 100}
                                        onClick={() =>
                                          change(i, "fields", [
                                            ...r.fields,
                                            {
                                              label: "",
                                              value: "",
                                              source_line: null,
                                              confidence: null,
                                            },
                                          ])
                                        }
                                      >
                                        <Plus size={16} />
                                        Add field
                                      </button>
                                    )}
                                  </div>
                                ) : (
                                  <>
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
                                  </>
                                )}
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
                                        fields: [
                                          {
                                            label: "",
                                            value: "",
                                            source_line: null,
                                            confidence: null,
                                          },
                                        ],
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
                                    rows.some((r) =>
                                      Array.isArray(r.fields)
                                        ? !r.fields.length ||
                                          r.fields.some(
                                            (f: Row) => !f.label.trim(),
                                          ) ||
                                          !r.fields.some((f: Row) =>
                                            f.value.trim(),
                                          )
                                        : r.reference.trim().length < 2 ||
                                          r.details.trim().length < 2,
                                    )
                                  }
                                  onClick={() =>
                                    run(async () => {
                                      await patch(
                                        "/kyc-captures/" + capture.id + "/rows",
                                        {
                                          version: capture.version,
                                          rows,
                                          reason,
                                        },
                                      );
                                      setDirty(false);
                                    })
                                  }
                                >
                                  Save details
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
                                        "/kyc-captures/" +
                                          capture.id +
                                          "/submit",
                                        { version: capture.version },
                                      ),
                                    )
                                  }
                                >
                                  Submit for review
                                </button>
                              )}
                            </div>
                          )}
                        {capture.status === "SUBMITTED" && (
                          <section className="capture-review">
                            <h2>Awaiting backend review</h2>

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
                                      disabled={
                                        busy || review.trim().length < 5
                                      }
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
                                {capture.review.outcome} ·{" "}
                                {capture.review.reviewer}
                              </b>
                              <p>{capture.review.reason}</p>
                            </div>
                          </div>
                        )}
                        <details className="capture-evidence">
                          <summary>Transaction history</summary>
                          <ol className="capture-timeline">
                            {capture.history?.map((event: Row, i: number) => (
                              <li key={i}>
                                <b>
                                  {event.action
                                    .replace(/KYC/g, "Receipt")
                                    .replace(/OCR/g, "Details")}
                                </b>
                                <span>
                                  {event.actor} ·{" "}
                                  {new Date(event.at + "Z").toLocaleString()}
                                </span>
                              </li>
                            ))}
                          </ol>
                        </details>
                        </details>
                      </div>
                    </Panel>
                  )}
                </>
              )
            )}
          </div>
        </div>
      </div>
      {historyOpen && (
        <Drawer title="Capture history" onClose={() => setHistoryOpen(false)}>
          {" "}
          <Panel
            title="Capture history"
            subtitle="Search every capture in your authorized scope"
          >
            <div className="capture-upload">
              <label>
                Search capture reference
                <input
                  value={historySearch}
                  maxLength={120}
                  onChange={(e) => {
                    setHistorySearch(e.target.value);
                    setHistoryPage(0);
                  }}
                  placeholder="Transaction reference"
                />
              </label>
              <label>
                Verification status
                <select
                  value={historyStatus}
                  onChange={(e) => {
                    setHistoryStatus(e.target.value);
                    setHistoryPage(0);
                  }}
                >
                  <option value="">All statuses</option>
                  {[
                    "QUEUED",
                    "OCR_FAILED",
                    "EXTRACTED",
                    "VALIDATED",
                    "SUBMITTED",
                    "VERIFIED",
                    "REJECTED",
                  ].map((s) => (
                    <option key={s} value={s}>
                      {s === "OCR_FAILED"
                        ? "Needs another image"
                        : s.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <div className="capture-toolbar">
                <button
                  disabled={!historyPage || list.isFetching}
                  onClick={() => setHistoryPage((p) => p - 1)}
                >
                  Previous captures
                </button>
                <span>Page {historyPage + 1}</span>
                <button
                  disabled={list.isFetching || (list.data?.length || 0) < 20}
                  onClick={() => setHistoryPage((p) => p + 1)}
                >
                  Next captures
                </button>
              </div>
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
                  <p>
                    {historySearch || historyStatus || historyPage
                      ? "No matching captures. Adjust the filters or return to the previous page."
                      : "No captures yet. Upload a screenshot to begin."}
                  </p>
                )}
              </div>
            )}
          </Panel>
        </Drawer>
      )}
    </>
  );
}
