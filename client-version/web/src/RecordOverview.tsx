import { Row } from "./api";

export default function RecordOverview({ rows, field = "status", title = "Record overview", numeric = false, categories = [] }: { rows: Row[]; field?: string; title?: string; numeric?: boolean; categories?: string[] }) {
  const totals = new Map<string, number>();
  categories.forEach(label => totals.set(label,0));
  rows.forEach(row => {
    const label = numeric ? String(row.name || row.branch || "Not recorded") : String(row[field] ?? "Not recorded").replaceAll("_", " ");
    totals.set(label, (totals.get(label) || 0) + (numeric ? Number(row[field] || 0) : 1));
  });
  const sorted = [...totals].sort((a,b) => b[1]-a[1]);
  const items = sorted.slice(0,4);
  if (sorted.length > 4) items.push(["Other", sorted.slice(4).reduce((sum,item) => sum+item[1],0)]);
  const max = Math.max(1,...items.map(item => item[1]));
  return <section className="record-overview" aria-label={title}>
    <div className="record-overview-title"><b>{title}</b><span>{rows.length} {rows.length === 1 ? "record" : "records"}</span></div>
    {items.length ? <div className="record-overview-bars">{items.map(([label,value],index) => <div className="record-overview-item" key={label}>
      <div><span title={label}>{label}</span><b>{value.toLocaleString()}</b></div>
      <div className="record-overview-track"><i style={{width:`${value/max*100}%`,background:["#9d2870","#7641d8","#008e80","#2578c6","#c57a10"][index]}} /></div>
    </div>)}</div> : <span>No records yet</span>}
  </section>;
}
