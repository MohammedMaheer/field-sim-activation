import { CheckCircle2, IdCard, ReceiptText } from "lucide-react";
import "./transaction.css";

/** The reference has three stages; in-stage actions never add extra steps. */
export default function TransactionProgress({ step }: { step: number }) {
  return (
    <ol className="txn-steps" aria-label="Transaction steps">
      {["Identity & eKYC", "SIM & Plan Allocation", "Activation & Receipt"].map(
        (title, i) => (
          <li
            key={title}
            className={step === i + 1 ? "current" : step > i + 1 ? "done" : ""}
            aria-current={step === i + 1 ? "step" : undefined}
          >
            <span className="txn-step-icon" aria-hidden="true">
              {step > i + 1 ? (
                <CheckCircle2 size={21} />
              ) : i === 0 ? (
                <IdCard size={21} />
              ) : i === 1 ? (
                <svg
                  width="21"
                  height="21"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
                  <rect x="8" y="10" width="8" height="7" rx="1" />
                  <path d="M12 10v7M8 13.5h8" />
                </svg>
              ) : (
                <ReceiptText size={21} />
              )}
            </span>
            <div>
              <small>STEP {i + 1} OF 3</small>
              {title}
            </div>
          </li>
        ),
      )}
    </ol>
  );
}
