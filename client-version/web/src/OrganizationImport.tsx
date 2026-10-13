import { useContext, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Context } from "./App";
import { download, post, Row } from "./api";
import { Drawer } from "./components";

export default function OrganizationImport({
  kind,
  onClose,
}: {
  kind: "branches" | "teams" | "agents";
  onClose: () => void;
}) {
  const { notify } = useContext(Context),
    cache = useQueryClient();
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const saving = useRef(false),
    input = useRef<HTMLInputElement>(null);
  const title =
    kind === "branches"
      ? "branches"
      : kind === "teams"
        ? "team leaders"
        : "sales agents";
  async function process(apply: boolean) {
    if (!file || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      if (file.size > 2_000_000) throw new Error("Choose a file under 2 MB.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const result = await post("/organization/import/" + kind, {
        filename: file.name,
        content_base64: btoa(binary),
        apply,
      });
      if (apply) {
        setFile(null);
        setPreview(null);
        if (input.current) input.current.value = "";
        await cache.invalidateQueries();
        notify(
          `${result.count} ${title} added · ${result.already_recorded} already recorded`,
        );
      } else setPreview(result);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Import failed. No records were added.",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <Drawer
      title={`Import ${title} from Excel`}
      onClose={() => !busy && onClose()}
    >
      <p>
        Create branches first, then team leaders, then sales agents. The whole
        file is checked before any records are added.
      </p>
      <button
        disabled={busy}
        onClick={() =>
          download(
            `/organization/import/${kind}/template`,
            `qanawat-${kind}-template.xlsx`,
          ).catch((e) => setError(e.message))
        }
      >
        Download Excel template
      </button>
      <div className="sales-form compact">
        <label>
          Excel / CSV · up to 50 rows
          <input
            ref={input}
            aria-label={`${title} import file`}
            type="file"
            accept=".xlsx,.csv"
            disabled={busy}
            onChange={(event) => {
              setFile(event.target.files?.[0] || null);
              setPreview(null);
              setError("");
            }}
          />
        </label>
        <button
          className="primary"
          disabled={busy || !file}
          onClick={() => process(false)}
        >
          {busy ? "Checking…" : "Preview import"}
        </button>
      </div>
      {kind !== "branches" && (
        <p>
          Use existing branch names and leader emails. Keep files containing
          passwords private; existing accounts and assignments will be
          preserved.
        </p>
      )}
      {preview && (
        <div className="sales-preview">
          <h3>Review before adding</h3>
          <p>
            {preview.count} new records · {preview.already_recorded} already
            recorded
          </p>
          <ul>
            {preview.rows.map((row: Row, index: number) => (
              <li key={index}>
                {row.name} · {row.branch}
                {row.email ? ` · ${row.email}` : ""}
              </li>
            ))}
          </ul>
          <button
            className="primary"
            disabled={busy || !preview.count}
            onClick={() => process(true)}
          >
            Add {preview.count} {title}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="sales-error">
          {error}
        </p>
      )}
    </Drawer>
  );
}
