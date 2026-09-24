import { useState } from "react";
import { ArrowRight, CheckCheck } from "lucide-react";
export const stages = [
  [
    "Emirates ID & OCR",
    "Complete identity verification in Etisalat. Enter or scan the Emirates ID and review the source system’s extracted identity fields and required checks.",
  ],
  [
    "Customer information",
    "Complete the customer information in Etisalat and confirm that it matches the identity document.",
  ],
  [
    "Plan information",
    "Confirm the chosen plan, SIM or eSIM allocation, mobile number and applicable terms in the source telecom system.",
  ],
  [
    "Order & customer details",
    "Complete the order, remaining customer information and any required consent in Etisalat. Keep the completed transaction or receipt screen ready.",
  ],
  [
    "Capture, OCR & handoff",
    "Take or upload the completed transaction screenshot below. Review extracted rows, validate them, generate Excel and submit the preserved image and data for backend review.",
  ],
  [
    "Verification & live status",
    "An authorized reviewer checks the original image and extracted rows. The recorded decision synchronizes to the portal and field app. Open capture history to follow the result.",
  ],
];
export default function KycJourney() {
  const [step, setStep] = useState(0);
  return (
    <section className="journey-guide" aria-label="Guided KYC stages">
      <div className="journey-heading">
        <h2>Your verification journey</h2>
        <span>eKYC & ID → SIM & PLAN → SYNC & RECEIPT</span>
      </div>
      <div className="journey-tabs">
        {stages.map(([title], i) => (
          <button
            type="button"
            key={title}
            className={step === i ? "active" : ""}
            aria-current={step === i ? "step" : undefined}
            onClick={() => setStep(i)}
          >
            <span>{i + 1}</span>
            {title}
          </button>
        ))}
      </div>
      <div className="journey-detail">
        <div>
          <b>
            {step < 4 ? "Complete in Etisalat" : "Continue in Relay"} · Stage{" "}
            {step + 1} of 6
          </b>
          <p>{stages[step][1]}</p>
        </div>
        {step < 4 ? (
          <button onClick={() => setStep(step + 1)}>
            Next stage
            <ArrowRight size={16} />
          </button>
        ) : (
          <button
            className="primary"
            onClick={() =>
              document
                .getElementById(step === 4 ? "capture-form" : "capture-history")
                ?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          >
            {step === 4 ? "Go to capture" : "View history"}
            <CheckCheck size={16} />
          </button>
        )}
      </div>
    </section>
  );
}
