import { createPortal } from "react-dom";
import { useEffect, useRef, useState, ReactNode } from "react";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
  ArrowUpDown,
  SlidersHorizontal,
  Inbox,
} from "lucide-react";
import { Row } from "./api";

export function Badge({ value }: { value: string }) {
  const success = [
    "ACTIVE",
    "ACTIVATED",
    "VERIFIED",
    "IN BOUNDS",
    "AVAILABLE",
    "RESOLVED",
  ];
  const danger = [
    "FAILED",
    "OUT OF BOUNDS",
    "BLOCKED",
    "CRITICAL",
    "DAMAGED",
    "REJECTED",
    "OCR_FAILED",
  ];
  const warn = [
    "PROCESSING",
    "MANUAL REVIEW",
    "NEAR BOUNDARY",
    "WARNING",
    "REVIEW",
    "INVESTIGATING",
    "RESERVED",
    "SUBMITTED",
    "EXTRACTED",
    "VALIDATED",
  ];
  const tone = success.includes(value)
    ? "success"
    : danger.includes(value)
      ? "danger"
      : warn.includes(value)
        ? "warning"
        : "neutral";
  return (
    <span className={"badge " + tone}>
      <i />
      {value?.replaceAll("_", " ").toLowerCase()}
    </span>
  );
}
export function Avatar({ name, size = "" }: { name: string; size?: string }) {
  return (
    <span className={"avatar " + size}>
      {name
        ?.split(" ")
        .slice(0, 2)
        .map((s) => s[0])
        .join("")}
    </span>
  );
}
export function Progress({ value }: { value: number }) {
  return (
    <div className="progress-cell">
      <div className="progress">
        <span style={{ width: Math.min(100, value) + "%" }} />
      </div>
      <span>{value}%</span>
    </div>
  );
}
export function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={"panel " + className}>
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Empty({
  text = "No matching records",
  detail = "Try changing your search or filters.",
}: {
  text?: string;
  detail?: string;
}) {
  return (
    <div className="empty">
      <Inbox size={30} />
      <h3>{text}</h3>
      <p>{detail}</p>
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading-grid" aria-label="Loading data" role="status">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div className="skeleton" key={i} />
      ))}
    </div>
  );
}
export function ErrorState({
  error,
  retry,
}: {
  error: any;
  retry: () => void;
}) {
  return (
    <div className="error-state">
      <h3>We couldn’t load this view</h3>
      <p>{error.message}</p>
      <button onClick={retry}>Try again</button>
    </div>
  );
}
export function Metric({
  label,
  value,
  sub,
  icon,
  trend,
  onClick,
}: {
  label: string;
  value: any;
  sub: string;
  icon: ReactNode;
  trend?: number[];
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="metric-top">
        <span>{label}</span>
        {icon}
      </div>
      <div className="metric-number">
        {value}
        {trend && (
          <svg className="sparkline" viewBox="0 0 90 30" aria-hidden="true">
            <polyline
              points={trend
                .map(
                  (v, i) =>
                    `${i * 14},${28 - (v / (Math.max(...(trend || [11])) || 1)) * 24}`,
                )
                .join(" ")}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
          </svg>
        )}
      </div>
      <div className="metric-sub">
        <ArrowUpRight size={13} />
        {sub}
      </div>
    </>
  );
  return onClick ? (
    <button
      type="button"
      className="metric metric-interactive"
      onClick={onClick}
      aria-label={`View ${label.toLowerCase()}`}
    >
      {content}
    </button>
  ) : (
    <div className="metric">{content}</div>
  );
}
export type Column = {
  key: string;
  label: string;
  render?: (row: Row) => ReactNode;
};
export function DataTable({
  rows,
  columns,
  onRow,
  searchPlaceholder = "Search records…",
}: {
  rows: Row[];
  columns: Column[];
  onRow?: (row: Row) => void;
  searchPlaceholder?: string;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("");
  const [asc, setAsc] = useState(true);
  const [page, setPage] = useState(0);
  const statuses = [...new Set(rows.map((r) => r.status).filter(Boolean))];
  const filtered = rows
    .filter(
      (r) =>
        (!q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase())) &&
        (!status || r.status === status),
    )
    .sort((a, b) => {
      const x = a[sort] ?? "",
        y = b[sort] ?? "";
      return (
        (typeof x === "number" ? x - y : String(x).localeCompare(String(y))) *
        (asc ? 1 : -1)
      );
    });
  const pages = Math.max(1, Math.ceil(filtered.length / 8));
  const safePage = Math.min(page, pages - 1);
  return (
    <div className="table-shell">
      <div className="table-tools">
        <label className="search">
          <Search size={16} />
          <input
            aria-label="Search records"
            placeholder={searchPlaceholder}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
          />
        </label>
        {statuses.length > 0 && (
          <label className="filter-control">
            <SlidersHorizontal size={14} />
            <select
              aria-label="Filter status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(0);
              }}
            >
              <option value="">All statuses</option>
              {statuses.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        )}
        <span className="muted record-count">{filtered.length} records</span>
      </div>
      <div className="mobile-table-sort">
        <label>
          Sort by
          <select
            aria-label="Sort records"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              setPage(0);
            }}
          >
            <option value="">Default order</option>
            {columns.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => setAsc(!asc)}
          aria-label="Reverse sort direction"
        >
          {asc ? "Ascending" : "Descending"}
        </button>
      </div>
      {!filtered.length ? (
        <Empty />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key}>
                    <button
                      onClick={() => {
                        setSort(c.key);
                        setAsc(sort === c.key ? !asc : true);
                      }}
                    >
                      {c.label}
                      <ArrowUpDown size={11} />
                    </button>
                  </th>
                ))}
                {onRow && <th>Details</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.slice(safePage * 8, safePage * 8 + 8).map((r) => (
                <tr key={r.id}>
                  {columns.map((c) => (
                    <td key={c.key} data-label={c.label}>
                      {c.render ? c.render(r) : String(r[c.key] ?? "—")}
                    </td>
                  ))}
                  {onRow && (
                    <td>
                      <button
                        className="icon-btn"
                        aria-label={
                          "View " +
                          (r.name || r.reference || r.iccid || "record")
                        }
                        onClick={() => onRow(r)}
                      >
                        <ArrowUpRight size={16} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="pagination">
        <span>
          Showing {filtered.length ? safePage * 8 + 1 : 0}–
          {Math.min((safePage + 1) * 8, filtered.length)} of {filtered.length}
        </span>
        <div>
          <button
            aria-label="Previous page"
            disabled={safePage === 0}
            onClick={() => setPage(safePage - 1)}
          >
            <ChevronLeft size={15} />
          </button>
          <span>
            {safePage + 1} / {pages}
          </span>
          <button
            aria-label="Next page"
            disabled={safePage >= pages - 1}
            onClick={() => setPage(safePage + 1)}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
export function Drawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const shell = document.querySelector(".app-shell") as HTMLElement;
    shell?.setAttribute("inert", "");
    ref.current?.focus();
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const nodes = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
          ) || [],
        ).filter((node) => node.getClientRects().length > 0);
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      shell?.removeAttribute("inert");
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return createPortal(
    <div className="drawer-backdrop" onClick={onClose}>
      <div
        ref={ref}
        tabIndex={-1}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-head">
          <h2>{title}</h2>
          <button
            className="icon-btn"
            aria-label="Close details"
            onClick={onClose}
          >
            <X />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
export function DetailList({ data }: { data: Row }) {
  return (
    <dl className="detail-list">
      {Object.entries(data)
        .filter(([, v]) => typeof v !== "object")
        .map(([k, v]) => (
          <div key={k}>
            <dt>{k.replaceAll("_", " ")}</dt>
            <dd>{String(v ?? "—")}</dd>
          </div>
        ))}
    </dl>
  );
}
