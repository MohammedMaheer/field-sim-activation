export const stages = ["Customer", "Order & plan", "Submit sale"];
export function captureStage(_status?: string) {
  return 2;
}
export default function KycJourney({ status }: { status?: string }) {
  const step = captureStage(status);
  return (
    <section
      className="journey-guide"
      aria-label="Transaction capture progress"
    >
      <div className="journey-heading">
        <h2>Your transaction</h2>
        <span>STEP {step + 1} OF 3</span>
      </div>
      <ol className="transaction-stages">
        {stages.map((title, i) => (
          <li
            key={title}
            className={i === step ? "active" : i < step ? "complete" : ""}
            aria-current={i === step ? "step" : undefined}
          >
            <span>{i + 1}</span>
            {title}
          </li>
        ))}
      </ol>
    </section>
  );
}
