import { useBranchScope } from "./BranchScope";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { api, download, Row } from "./api";
import { Drawer, ErrorState, Loading } from "./components";

export default function InventoryImport({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => Promise<unknown>;
}) {
  const branches = useQuery<Row[]>({
    queryKey: ["branches"],
    queryFn: () => api("/resources/branches"),
  });
  const scope = useBranchScope();
  const [branch, setBranch] = useState(scope.branch);
  const [file, setFile] = useState<File | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError("");
    setResult("");
    try {
      if (!file.name.toLowerCase().endsWith(".xlsx") || file.size > 1_000_000)
        throw new Error("Choose an Excel .xlsx file up to 1 MB.");
      const encoded = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () =>
          reject(new Error("Could not read the Excel file."));
        reader.readAsDataURL(file);
      });
      const saved = await api("/inventory/bulk", {
        method: "POST",
        body: JSON.stringify({
          branch_id: branch,
          content_base64: encoded,
          reason,
        }),
      });
      await onImported();
      setResult(`${saved.imported} SIMs added to ${saved.branch}.`);
      setFile(null);
    } catch (failure: any) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer title="Import SIM stock" onClose={() => !busy && onClose()}>
      {branches.isPending ? (
        <Loading />
      ) : branches.error ? (
        <ErrorState error={branches.error} retry={branches.refetch} />
      ) : (
        <>
          <button
            type="button"
            className="secondary"
            onClick={() =>
              download(
                "/inventory/bulk-template",
                "sim-stock-template.xlsx",
              ).catch((failure) => setError(failure.message))
            }
          >
            <Download size={16} /> Download Excel template
          </button>
          <form className="proposal-form" onSubmit={submit}>
            <label className="wide">
              Branch
              <select
                required
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
              >
                <option value="">Select branch</option>
                {branches.data.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="wide">
              Excel file
              <input
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                required
                onChange={(event) => setFile(event.target.files?.[0] || null)}
              />
            </label>
            <label className="wide">
              Reason for stock addition
              <input
                minLength={5}
                maxLength={300}
                required
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <p className="field-help wide">
              <FileSpreadsheet size={16} /> The file can contain up to 500 SIMs.
              Every addition is recorded in stock history.
            </p>
            {error && (
              <p className="wide" role="alert">
                {error}
              </p>
            )}
            {result && (
              <p className="wide setup-success" role="status">
                {result}
              </p>
            )}
            <button className="primary wide" disabled={busy || !file}>
              <Upload size={16} /> {busy ? "Importing…" : "Import stock"}
            </button>
          </form>
        </>
      )}
    </Drawer>
  );
}
