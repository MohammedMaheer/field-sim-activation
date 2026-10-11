import { useState } from "react";
import { Download } from "lucide-react";
import { download } from "./api";

/** One consistent download control, keeping filters with the report request. */
export default function ExportActions({
  path,
  label = "Export",
  name,
  formats = ["xlsx", "csv", "pdf"],
}: {
  path: string;
  label?: string;
  name: string;
  formats?: string[];
}) {
  const [format, setFormat] = useState(formats[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="export-actions">
      <div className="export-controls">
        <select
          aria-label={`${label} format`}
          disabled={busy}
          value={format}
          onChange={(event) => setFormat(event.target.value)}
        >
          {formats.map((value) => (
            <option key={value} value={value}>
              {value === "xlsx" ? "Excel" : value.toUpperCase()}
            </option>
          ))}
        </select>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await download(
                `${path}${path.includes("?") ? "&" : "?"}format=${format}`,
                `${name}.${format}`,
              );
            } catch (failure) {
              setError(
                failure instanceof Error
                  ? failure.message
                  : "Could not export. Please try again.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <Download size={16} />
          {busy ? "Preparing…" : label}
        </button>
      </div>
      {error && (
        <small className="form-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
