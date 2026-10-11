/** Faithful supplied Qanawat wordmark; identifiers and account addresses stay stable. */
export const companyName = "Qanawat Connect Solutions LLC";
export default function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <img
      className={`qanawat-brand${compact ? " compact" : ""}`}
      src="/branding/qanawat-logo.png"
      alt={companyName}
      width="312"
      height="89"
    />
  );
}
