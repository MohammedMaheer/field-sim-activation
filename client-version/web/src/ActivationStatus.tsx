import { Row } from "./api";

export function activationLabel(row: Row): string {
  if (row.activation_label) return row.activation_label;
  if (row.status === "CANCELLED") return "Cancelled";
  if (row.status === "ACTIVATED") return "Activated";
  if (["CLOSED", "VERIFIED"].includes(row.status)) {
    if (row.sr_verification?.status === "MATCHED") return "Fully activated";
    return row.sr_verification?.status === "MISMATCH"
      ? "Activated · SR mismatch"
      : "Activated · pending SR verification";
  }
  return String(row.status || "Not recorded")
    .replaceAll("_", " ")
    .toLowerCase();
}

export default function ActivationStatus({ row }: { row: Row }) {
  const label = activationLabel(row);
  const tone =
    row.status === "CANCELLED" || label.includes("mismatch")
      ? "danger"
      : label === "Fully activated" || label === "Activated"
        ? "success"
        : "warning";
  return (
    <span className={`badge activation-status ${tone}`}>
      <i />
      {label}
    </span>
  );
}
