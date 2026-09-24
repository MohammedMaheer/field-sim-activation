export const stages = ["Capture transaction", "Review details", "Submit & track"];
export function captureStage(status?: string) {
  if (["EXTRACTED", "VALIDATED", "REJECTED"].includes(status || "")) return 1;
  if (["SUBMITTED", "VERIFIED"].includes(status || "")) return 2;
  return 0;
}
export default function KycJourney({status}: {status?: string}) {
  const step = captureStage(status);
  const messages = [
    "Take or upload the completed transaction screenshot. OCR extracts its details on the server.",
    status === "REJECTED" ? "Review the backend feedback, correct the details and validate before resubmitting." : "Check the extracted details against the original screenshot, make corrections and validate the rows.",
    status === "VERIFIED" ? "Backend verification is complete. The result is synchronized with your transaction history." : "The original screenshot and validated rows are submitted. Track the backend team's verification here.",
  ];
  return <section className="journey-guide" aria-label="Transaction capture progress">
    <div className="journey-heading"><h2>Your transaction</h2><span>STEP {step + 1} OF 3</span></div>
    <ol className="transaction-stages">{stages.map((title,i)=><li key={title} className={i===step?"active":i<step?"complete":""} aria-current={i===step?"step":undefined}><span>{i+1}</span>{title}</li>)}</ol>
    <p className="transaction-step-detail" role="status">{messages[step]}</p>
    {!status && <p className="transaction-source-note">Before capture: complete identity, customer, plan and order details in Etisalat.</p>}
  </section>;
}
