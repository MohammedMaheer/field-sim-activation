import { useContext, useEffect, useRef, useState } from "react";
import { UserRoundMinus } from "lucide-react";
import { Context, useResource } from "./App";
import { Drawer } from "./components";
import { post, Row } from "./api";
import "./customer-backed-out.css";

export default function CustomerBackedOut({
  data,
  version,
  agentId,
  disabled,
  onRecorded,
}: {
  data: Row;
  version: number;
  agentId?: string;
  disabled?: boolean;
  onRecorded: () => void;
}) {
  const { user } = useContext(Context);
  const agents = useResource("agents");
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [selectedAgent, setSelectedAgent] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const alive = useRef(true);
  const current = useRef({
    account: user.id,
    transaction: data.transaction_id,
  });
  current.current = { account: user.id, transaction: data.transaction_id };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const close = () => {
    if (!sending.current) setOpen(false);
  };
  async function record(event: React.FormEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    const attempt = current.current;
    const isCurrent = () =>
      alive.current &&
      current.current.account === attempt.account &&
      current.current.transaction === attempt.transaction;
    try {
      const omitted = new Set([
        "document_image",
        "order_image",
        "selfie_image",
        "payment_image",
        "document_check",
        "order_check",
        "receipt_sr_check",
        "signature",
      ]);
      const details = Object.fromEntries(
        Object.entries(data).filter(([key]) => !omitted.has(key)),
      );
      const result = await post("/kyc-captures/customer-backed-out", {
        agent_id: selectedAgent,
        transaction_id: data.transaction_id,
        version,
        data: details,
        note: note.trim(),
      });
      if (!isCurrent()) return;
      if (result.recorded !== true)
        throw new Error(
          "The outcome was not recorded. Your draft is unchanged. Try again.",
        );
      setOpen(false);
      onRecorded();
    } catch (failure: any) {
      if (isCurrent())
        setError(
          failure.message ||
            "Could not record this outcome. Your draft is unchanged. Try again.",
        );
    } finally {
      sending.current = false;
      if (isCurrent()) setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        className="customer-backed-out-trigger"
        disabled={disabled || !data.transaction_id}
        onClick={() => {
          setSelectedAgent(
            user.agent_id ||
              agentId ||
              data.agent_id ||
              (agents.data?.length === 1 ? agents.data[0].id : ""),
          );
          setNote("");
          setError("");
          setOpen(true);
        }}
      >
        <UserRoundMinus size={16} /> Customer backed out
      </button>
      {open && (
        <Drawer title="Customer backed out" onClose={close}>
          <form className="customer-backed-out-form" onSubmit={record}>
            <p>
              Record this as a no-sale outcome and close this transaction and
              its saved drafts. No sale will be submitted.
            </p>
            <dl className="detail-list">
              <div>
                <dt>Customer</dt>
                <dd>{data.name || "Not recorded"}</dd>
              </div>
              <div>
                <dt>Product</dt>
                <dd>
                  {data.plan_name ||
                    data.package_name ||
                    data.order_type ||
                    "Not recorded"}
                </dd>
              </div>
            </dl>
            {!user.agent_id && (
              <label>
                Sales agent
                <select
                  required
                  value={selectedAgent}
                  disabled={busy}
                  onChange={(event) => setSelectedAgent(event.target.value)}
                >
                  <option value="">Choose sales agent</option>
                  {(agents.data || []).map((agent: Row) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Note · optional
              <textarea
                maxLength={1000}
                rows={3}
                value={note}
                disabled={busy}
                placeholder="Why did the customer decide not to proceed?"
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="capture-error">
                {error}
              </p>
            )}
            <div className="customer-backed-out-actions">
              <button type="button" disabled={busy} onClick={close}>
                Keep editing
              </button>
              <button className="primary" disabled={busy || !selectedAgent}>
                {busy ? "Recording…" : "Record & close draft"}
              </button>
            </div>
          </form>
        </Drawer>
      )}
    </>
  );
}
