import { useContext, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  Download,
  LocateFixed,
  MapPin,
  Plus,
  ShieldCheck,
  Square,
  Users,
} from "lucide-react";
import { Context } from "./App";
import { useBranchScope, salesAgentRole } from "./BranchScope";
import { BranchFilter } from "./Dashboard";
import { api, patch, post, download, Row } from "./api";
import { businessDate } from "./businessTime";
import { ErrorState, Loading, Panel, Drawer, Empty } from "./components";
import { currentGPS, useWorkLocation } from "./WorkLocation";
import GeofenceMap, { Center } from "./GeofenceMap";
import "./location-tracking.css";

const stateNames: Record<string, string> = {
  INSIDE: "Inside boundary",
  OUTSIDE: "Outside boundary",
  UNCERTAIN: "Accuracy needs improvement",
  STALE: "Update needed",
  MOCKED: "Location not accepted",
  UNASSIGNED: "No boundary assigned",
  NO_LOCATION: "Not recorded",
};
const status = (member: Row) =>
  member.latest_location?.fresh === false
    ? "STALE"
    : member.latest_location?.state || "NO_LOCATION";
const failureMessage = (failure: unknown) =>
  failure instanceof Error ? failure.message : "Could not save. Try again.";
const recordedAt = (point?: Row | null) =>
  point?.captured_at
    ? new Date(point.captured_at).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Not recorded";
const coordinate = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(6)
    : "Not recorded";
const defaultFence = () => ({
  name: "",
  branch_id: "",
  latitude: "",
  longitude: "",
  radius_m: "150",
  enabled: true,
});

export default function LocationTracking() {
  const { user, notify } = useContext(Context),
    client = useQueryClient();
  const {
    me,
    otherDevice,
    error: locationError,
    busy: workBusy,
    start,
    end,
    refresh,
  } = useWorkLocation();
  const { branch, setBranch } = useBranchScope();
  const canManage =
    user.permissions?.includes("location.manage") && !!me?.permissions?.manage;
  const canTrack = user.permissions?.includes("location.self");
  const canRead =
    user.permissions?.includes("location.read") &&
    !!me?.permissions?.read_members;
  const members = useQuery<Row>({
    queryKey: ["work-location", "members", user.id, branch],
    queryFn: () =>
      api(`/location-tracking/members?branch_id=${encodeURIComponent(branch)}`),
    enabled: canRead,
    refetchInterval: 15000,
  });
  const fences = useQuery<Row[]>({
    queryKey: ["work-location", "fences", user.id],
    queryFn: () => api("/location-tracking/fences"),
    enabled: canRead || canManage,
    staleTime: 30000,
  });
  const settings = useQuery<Row>({
    queryKey: ["work-location", "settings", user.id],
    queryFn: () => api("/location-tracking/settings"),
    enabled: canManage,
  });
  const [view, setView] = useState<"locations" | "boundaries">("locations");
  const [assignmentMode, setAssignmentMode] = useState<
    "branch" | "saved" | "individual"
  >("branch");
  const [search, setSearch] = useState(""),
    [stateFilter, setStateFilter] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);
  const [previewFence, setPreviewFence] = useState<Row | null>(null);
  const [individualMember, setIndividualMember] = useState<Row | null>(null);
  const [focus, setFocus] = useState<{
    latitude: number;
    longitude: number;
    key: string;
    radius_m?: number;
  } | null>(null);
  const [editorFocus, setEditorFocus] = useState<typeof focus>(null);
  const [editing, setEditing] = useState<Row | null>(null),
    [form, setForm] = useState(defaultFence);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [assignment, setAssignment] = useState<Row | null>(null),
    [fenceId, setFenceId] = useState("");
  const [fromDate, setFromDate] = useState(businessDate),
    [toDate, setToDate] = useState(businessDate);
  const [exportMember, setExportMember] = useState(""),
    [areaFilter, setAreaFilter] = useState(false);
  const [exportLat, setExportLat] = useState(""),
    [exportLng, setExportLng] = useState(""),
    [exportRadius, setExportRadius] = useState("500");
  const [exportOpen, setExportOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get("export") === "1") setExportOpen(true);
  }, [params]);
  const closeExport = () => {
    setExportOpen(false);
    if (params.has("export")) {
      const next = new URLSearchParams(params);
      next.delete("export");
      setParams(next, { replace: true });
    }
  };
  useEffect(() => {
    setSelected(null);
    setPreviewFence(null);
    setExportMember("");
  }, [branch]);
  const allRows: Row[] = canRead
    ? members.data?.items || []
    : me
      ? [{ ...me, user_id: user.id, name: user.name, role: user.role }]
      : [];
  const rows = useMemo(
    () =>
      allRows.filter(
        (row) =>
          (view !== "locations" ||
            !stateFilter ||
            status(row) === stateFilter) &&
          (!search ||
            `${row.name} ${row.email} ${row.branch}`
              .toLowerCase()
              .includes(search.toLowerCase())),
      ),
    [allRows, stateFilter, search, view],
  );
  const activeSession = me?.work_session && !me.work_session.ended_at;
  const currentSelected = selected
    ? allRows.find((row) => row.user_id === selected.user_id) || null
    : null;
  const viewedFence = previewFence
    ? fences.data?.find((row) => row.id === previewFence.id) || null
    : null;
  useEffect(() => {
    if (
      members.isSuccess &&
      selected &&
      !members.data.items.some((row: Row) => row.user_id === selected.user_id)
    )
      setSelected(null);
  }, [members.data, members.isSuccess, selected]);
  useEffect(() => {
    if (
      fences.isSuccess &&
      previewFence &&
      !fences.data.some((row) => row.id === previewFence.id)
    )
      setPreviewFence(null);
  }, [fences.data, fences.isSuccess, previewFence]);
  const branchFence = branch
    ? fences.data?.find((row) => row.branch_id === branch)
    : null;
  const boundary = currentSelected
    ? currentSelected.boundary
    : viewedFence || (branch ? branchFence : me?.boundary);
  const mapLabel = currentSelected
    ? `${currentSelected.name}'s work boundary`
    : viewedFence?.name ||
      (branch
        ? `${members.data?.branches?.find((row: Row) => row.id === branch)?.name || "Selected branch"} boundary`
        : "Work location map");
  useEffect(() => {
    if (boundary)
      setFocus({
        ...boundary,
        key: `${branch}:${currentSelected?.user_id || ""}:${viewedFence?.id || ""}:${boundary.id}`,
      });
    else if (currentSelected?.latest_location)
      setFocus({
        ...currentSelected.latest_location,
        key: currentSelected.user_id,
      });
  }, [branch, currentSelected?.user_id, viewedFence?.id, boundary?.id]);
  const ownState = me ? status(me) : "NO_LOCATION";
  const totals = allRows.reduce(
    (counts: Record<string, number>, row) => {
      if (row.work_session && !row.work_session.ended_at) counts.tracking++;
      if (status(row) === "INSIDE") counts.inside++;
      if (["OUTSIDE", "UNCERTAIN", "MOCKED"].includes(status(row)))
        counts.attention++;
      if (["NO_LOCATION", "STALE", "UNASSIGNED"].includes(status(row)))
        counts.unrecorded++;
      return counts;
    },
    { tracking: 0, inside: 0, attention: 0, unrecorded: 0 },
  );
  const refreshData = async () => {
    await client.invalidateQueries({ queryKey: ["work-location"] });
  };
  const write = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await refreshData();
      notify(success);
      return true;
    } catch (failure) {
      setError(failureMessage(failure));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const editFence = (value?: Row, member?: Row) => {
    setError("");
    setEditorFocus(null);
    setIndividualMember(member || null);
    setEditing(value || {});
    setForm(
      value
        ? {
            name: value.name,
            branch_id: value.branch_id || "",
            latitude: String(value.latitude),
            longitude: String(value.longitude),
            radius_m: String(value.radius_m),
            enabled: value.enabled,
          }
        : member
          ? {
              ...defaultFence(),
              name: `${member.name} work boundary`.slice(0, 120),
              latitude: String(
                member.boundary?.latitude ??
                  member.latest_location?.latitude ??
                  "",
              ),
              longitude: String(
                member.boundary?.longitude ??
                  member.latest_location?.longitude ??
                  "",
              ),
              radius_m: String(member.boundary?.radius_m ?? 150),
            }
          : { ...defaultFence(), branch_id: branch },
    );
  };
  const formCenter = (): Center | null => {
    const latitude = Number(form.latitude),
      longitude = Number(form.longitude),
      radius_m = Number(form.radius_m);
    return form.latitude !== "" &&
      form.longitude !== "" &&
      Number.isFinite(latitude) &&
      Math.abs(latitude) <= 85 &&
      Number.isFinite(longitude) &&
      Math.abs(longitude) <= 180 &&
      radius_m > 0
      ? { latitude, longitude, radius_m }
      : null;
  };
  const saveFence = async () => {
    if (
      !formCenter() ||
      form.name.trim().length < 2 ||
      Number(form.radius_m) < 25 ||
      Number(form.radius_m) > 100000 ||
      !Number.isInteger(Number(form.radius_m))
    ) {
      setError("Enter a boundary name, valid coordinates and radius.");
      return;
    }
    const body = {
      ...form,
      name: form.name.trim(),
      branch_id: form.branch_id || null,
      latitude: Number(form.latitude),
      longitude: Number(form.longitude),
      radius_m: Number(form.radius_m),
    };
    if (
      await write(
        () =>
          individualMember
            ? api(
                `/location-tracking/assignments/${individualMember.user_id}/boundary`,
                {
                  method: "PUT",
                  body: JSON.stringify({
                    ...body,
                    branch_id: null,
                    enabled: true,
                  }),
                },
              )
            : editing?.id
              ? patch(`/location-tracking/fences/${editing.id}`, body)
              : post("/location-tracking/fences", body),
        individualMember
          ? "Individual boundary saved and assigned"
          : "Work boundary saved",
      )
    ) {
      setEditing(null);
      setIndividualMember(null);
    }
  };
  const useCurrentCenter = async () => {
    setBusy(true);
    setError("");
    try {
      const point = await currentGPS();
      setForm((current) => ({
        ...current,
        latitude: coordinate(point.latitude),
        longitude: coordinate(point.longitude),
      }));
      setEditorFocus({
        latitude: point.latitude,
        longitude: point.longitude,
        key: crypto.randomUUID(),
        radius_m: Number(form.radius_m),
      });
    } catch (failure) {
      setError(failureMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  const exportRecords = async (format: "csv" | "xlsx") => {
    if (stateFilter === "NO_LOCATION") {
      setError(
        "Members with no recorded location have no location history to export. Choose another status or All statuses.",
      );
      return;
    }
    if (!fromDate || !toDate || fromDate > toDate) {
      setError("Choose a valid date range.");
      return;
    }
    const params = new URLSearchParams({
      format,
      from_date: fromDate,
      to_date: toDate,
      branch_id: branch,
      user_id: exportMember,
      state: stateFilter,
    });
    if (areaFilter) {
      if (
        exportLat === "" ||
        exportLng === "" ||
        !Number.isFinite(Number(exportLat)) ||
        Math.abs(Number(exportLat)) > 85 ||
        !Number.isFinite(Number(exportLng)) ||
        Math.abs(Number(exportLng)) > 180 ||
        !(Number(exportRadius) > 0)
      ) {
        setError("Choose a valid export area center and radius.");
        return;
      }
      params.set("latitude", exportLat);
      params.set("longitude", exportLng);
      params.set("radius_m", exportRadius);
    }
    setBusy(true);
    setError("");
    try {
      await download(
        `/location-tracking/export?${params}`,
        `qanawat-work-locations-${fromDate}-${toDate}.${format}`,
      );
    } catch (failure) {
      setError(failureMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  if (!me && locationError)
    return <ErrorState error={new Error(locationError)} retry={refreshData} />;
  if (!me) return <Loading />;
  const field = (
    key: keyof ReturnType<typeof defaultFence>,
    value: string | boolean,
  ) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <div className="location-workspace">
      <div className="page-head">
        <div>
          <span className="eyebrow">WORK LOCATION</span>
          <h1>
            {canRead ? "Locations & work boundaries" : "My work location"}
          </h1>
          <p>
            {canRead
              ? "See who is at work. Set allowed work areas from Manage boundaries."
              : "Start tracking at your assigned work location, then record your sales."}
          </p>
        </div>
        <div className="location-head-actions">
          {canRead && <BranchFilter value={branch} onChange={setBranch} />}
          <button
            type="button"
            onClick={() => {
              setError("");
              setExportOpen(true);
            }}
          >
            <Download size={17} /> Export locations
          </button>
        </div>
      </div>
      {canManage && (
        <nav className="location-view-tabs" aria-label="Location views">
          <button
            type="button"
            aria-pressed={view === "locations"}
            onClick={() => setView("locations")}
          >
            <Users size={17} /> Live locations
          </button>
          <button
            type="button"
            aria-pressed={view === "boundaries"}
            onClick={() => setView("boundaries")}
          >
            <MapPin size={17} /> Manage boundaries
          </button>
        </nav>
      )}
      {(view === "locations" || !canManage) && (
        <details
          className="own-work-disclosure"
          open={canRead ? undefined : true}
        >
          <summary>
            My work session{" "}
            <span>
              {activeSession ? "Tracking on" : "Off shift"} ·{" "}
              {me.boundary?.name || "No boundary assigned"}
            </span>
          </summary>
          <section
            className={`own-work-card ${ownState === "OUTSIDE" ? "attention" : ""}`}
            aria-label="My work tracking"
          >
            <div className="own-work-title">
              <span className="location-symbol">
                <LocateFixed size={23} />
              </span>
              <div>
                <h2>
                  {activeSession && otherDevice
                    ? "Work tracking is active on another device"
                    : activeSession
                      ? "Work tracking is on"
                      : "Ready to start work tracking"}
                </h2>
                <p>
                  {me.boundary
                    ? `${me.boundary.name} · ${me.boundary.radius_m} m radius`
                    : "No work boundary assigned"}
                </p>
              </div>
              <span className={`location-state ${ownState.toLowerCase()}`}>
                {stateNames[ownState] || ownState}
              </span>
            </div>
            <dl className="own-work-details">
              <div>
                <dt>Last location update</dt>
                <dd>{recordedAt(me.latest_location)}</dd>
              </div>
              <div>
                <dt>Accuracy</dt>
                <dd>
                  {me.latest_location
                    ? `±${Math.round(me.latest_location.accuracy_m)} m`
                    : "Not recorded"}
                </dd>
              </div>
              <div>
                <dt>Boundary enforcement</dt>
                <dd>
                  {me.enabled
                    ? "On · outside capture blocked"
                    : "Off · configuration mode"}
                </dd>
              </div>
            </dl>
            <div className="own-work-actions">
              {!canTrack ? (
                <p>
                  Work location recording is not permitted for this account.
                  Your authorized member view remains available.
                </p>
              ) : activeSession ? (
                <>
                  {!otherDevice && (
                    <button
                      type="button"
                      disabled={workBusy}
                      onClick={() => void refresh()}
                    >
                      <LocateFixed size={16} /> Update my location
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={workBusy}
                    onClick={() => void end()}
                  >
                    <Square size={15} />{" "}
                    {otherDevice
                      ? "End existing work tracking"
                      : "End work tracking"}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="primary"
                  disabled={workBusy}
                  onClick={() => void start()}
                >
                  <MapPin size={16} />
                  {workBusy ? "Checking your location…" : "Start work tracking"}
                </button>
              )}
              <p>
                {otherDevice
                  ? "This browser is not recording location. End the existing session before starting work here. "
                  : ""}
                Location is recorded during your work session while this browser
                is visible. It may become stale when this page is in the
                background.
              </p>
            </div>
            {(locationError ||
              (me.enabled && !me.can_capture && me.reason)) && (
              <p
                className="location-alert"
                role={locationError ? "alert" : "status"}
              >
                {locationError || me.reason}
              </p>
            )}
          </section>
        </details>
      )}
      {error && !editing && !assignment && !exportOpen && (
        <p role="alert" className="location-alert">
          {error}
        </p>
      )}
      {canRead && view === "locations" && (
        <div className="location-summary" aria-label="Location summary">
          <div>
            <Users size={19} />
            <strong>
              {members.isPending || members.error ? "—" : totals.tracking}
            </strong>
            <span>Tracking work</span>
          </div>
          <div>
            <ShieldCheck size={19} />
            <strong>
              {members.isPending || members.error ? "—" : totals.inside}
            </strong>
            <span>Inside boundary</span>
          </div>
          <div>
            <MapPin size={19} />
            <strong>
              {members.isPending || members.error ? "—" : totals.attention}
            </strong>
            <span>Need attention</span>
          </div>
          <div>
            <LocateFixed size={19} />
            <strong>
              {members.isPending || members.error ? "—" : totals.unrecorded}
            </strong>
            <span>Update or setup needed</span>
          </div>
        </div>
      )}
      <div className="location-monitor-grid">
        {(view === "locations" || !canManage) && (
          <Panel
            title={mapLabel}
            subtitle="Select a branch above or a member below to inspect their assigned radius."
            action={
              canManage && (currentSelected || branch) ? (
                <button
                  type="button"
                  onClick={() =>
                    editFence(
                      currentSelected ? undefined : branchFence || undefined,
                      currentSelected || undefined,
                    )
                  }
                >
                  <MapPin size={16} />
                  {currentSelected
                    ? "Set individual boundary"
                    : branch
                      ? branchFence
                        ? "Edit branch boundary"
                        : "Set branch boundary"
                      : "Configure boundary"}
                </button>
              ) : undefined
            }
          >
            {canRead && (
              <div className="map-focus-controls">
                <label>
                  View on map
                  <select
                    value={
                      currentSelected
                        ? `member:${currentSelected.user_id}`
                        : viewedFence
                          ? `fence:${viewedFence.id}`
                          : ""
                    }
                    onChange={(event) => {
                      const value = event.target.value;
                      setSelected(
                        value.startsWith("member:")
                          ? allRows.find(
                              (row) => row.user_id === value.slice(7),
                            ) || null
                          : null,
                      );
                      setPreviewFence(
                        value.startsWith("fence:")
                          ? fences.data?.find(
                              (row) => row.id === value.slice(6),
                            ) || null
                          : null,
                      );
                    }}
                  >
                    <option value="">
                      {branch
                        ? "Selected branch boundary"
                        : "My boundary / all members"}
                    </option>
                    <optgroup label="Members">
                      {allRows.map((row) => (
                        <option
                          key={row.user_id}
                          value={`member:${row.user_id}`}
                        >
                          {row.name} · {salesAgentRole(row.role)}
                        </option>
                      ))}
                    </optgroup>
                    {!!fences.data?.length && (
                      <optgroup label="Saved boundaries">
                        {fences.data.map((row) => (
                          <option key={row.id} value={`fence:${row.id}`}>
                            {row.name} · {row.radius_m} m
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </label>
              </div>
            )}
            <div
              className="map-boundary-summary"
              aria-label="Selected work boundary"
            >
              <MapPin size={18} />
              <div>
                <strong>{boundary?.name || "No boundary configured"}</strong>
                <span>
                  {boundary
                    ? `${boundary.radius_m} m radius · ${coordinate(boundary.latitude)}, ${coordinate(boundary.longitude)}${boundary.enabled ? "" : " · Disabled"}`
                    : "Choose a configured branch or member. No radius is invented for unassigned members."}
                </span>
              </div>
            </div>
            <GeofenceMap
              boundary={boundary}
              members={rows}
              focus={focus}
              onMemberSelect={(id) => {
                setSelected(allRows.find((row) => row.user_id === id) || null);
                setPreviewFence(null);
              }}
            />
            {currentSelected && (
              <div className="map-selected-member">
                <strong>{currentSelected.name}</strong>
                <span>
                  {currentSelected.branch || "No branch"} ·{" "}
                  {stateNames[status(currentSelected)]}
                </span>
                <button type="button" onClick={() => setSelected(null)}>
                  {branch ? "Show branch boundary" : "Show all members"}
                </button>
              </div>
            )}
          </Panel>
        )}
        {canManage && view === "boundaries" && (
          <Panel
            title="Work boundaries"
            subtitle="Set a location and radius for each branch. Assign a separate worksite only when needed."
            action={
              <button type="button" onClick={() => editFence()}>
                <Plus size={16} /> Add boundary
              </button>
            }
          >
            <div className="location-enforcement">
              <div>
                <strong>Block work outside the assigned boundary</strong>
                <p>
                  Keep off while setting up. When on, members need an assigned
                  boundary and an accurate location inside it to start work or
                  capture a sale.
                </p>
              </div>
              <label className="location-toggle">
                <input
                  type="checkbox"
                  checked={!!settings.data?.enabled}
                  disabled={busy || !settings.data}
                  onChange={(event) =>
                    void write(
                      () =>
                        patch("/location-tracking/settings", {
                          enabled: event.target.checked,
                        }),
                      event.target.checked
                        ? "Boundary enforcement enabled"
                        : "Boundary enforcement disabled",
                    )
                  }
                />
                <span>
                  {settings.isPending
                    ? "Loading..."
                    : settings.error
                      ? "Unavailable"
                      : settings.data?.enabled
                        ? "Blocking on"
                        : "Blocking off"}
                </span>
              </label>
            </div>
            {settings.error && (
              <ErrorState
                error={settings.error}
                retry={() => void settings.refetch()}
              />
            )}
            {fences.error ? (
              <ErrorState
                error={fences.error}
                retry={() => void fences.refetch()}
              />
            ) : fences.isPending ? (
              <Loading />
            ) : !fences.data?.length ? (
              <Empty
                text="No work boundaries yet"
                detail="Add a branch boundary or a worksite for members without a branch."
              />
            ) : (
              <div className="location-fence-list">
                {fences.data.map((fence) => (
                  <div key={fence.id}>
                    <span>
                      <strong>{fence.name}</strong>
                      <small>
                        {fence.branch_id
                          ? members.data?.branches?.find(
                              (b: Row) => b.id === fence.branch_id,
                            )?.name || "Branch boundary"
                          : "Member worksite"}{" "}
                        · {fence.radius_m} m ·{" "}
                        {fence.enabled ? "Active" : "Disabled"}
                      </small>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(null);
                        setPreviewFence(fence);
                        setView("locations");
                      }}
                      aria-label={`View ${fence.name} on map`}
                    >
                      View radius
                    </button>
                    <button
                      type="button"
                      onClick={() => editFence(fence)}
                      aria-label={`Edit ${fence.name}`}
                    >
                      Edit
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        )}
      </div>
      {canRead && (
        <Panel
          title={
            view === "boundaries"
              ? "Assign member boundaries"
              : "Member work locations"
          }
          subtitle={
            view === "boundaries"
              ? "Most members can use their branch boundary. Change only the members who work somewhere else."
              : "Select a member to see their boundary on the map. Only authorized members appear here."
          }
        >
          <div className="location-table-filters">
            <label>
              <span className="sr-only">Search members</span>
              <input
                placeholder="Search member or branch"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            {view === "locations" && (
              <>
                <label>
                  <span className="sr-only">Location status</span>
                  <select
                    aria-label="Location status"
                    value={stateFilter}
                    onChange={(event) => setStateFilter(event.target.value)}
                  >
                    <option value="">All location statuses</option>
                    {Object.entries(stateNames).map(([key, name]) => (
                      <option key={key} value={key}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </div>
          {members.error ? (
            <ErrorState
              error={members.error}
              retry={() => void members.refetch()}
            />
          ) : members.isPending ? (
            <Loading />
          ) : !rows.length ? (
            <Empty
              text="No members match these filters"
              detail="Change the branch, status or member search."
            />
          ) : (
            <div className="location-table-scroll">
              <table className="location-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Work boundary</th>
                    {view === "locations" && (
                      <>
                        <th>Location status</th>
                        <th>Latest update</th>
                      </>
                    )}
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((member) => (
                    <tr key={member.user_id}>
                      <td data-label="Member">
                        <strong>{member.name}</strong>
                        <small>
                          {salesAgentRole(member.role)} ·{" "}
                          {member.branch || "No branch"}
                        </small>
                      </td>
                      <td data-label="Work boundary">
                        {member.boundary?.name || "Not assigned"}
                        <small>
                          {member.assignment_fence_id
                            ? "Explicit worksite"
                            : "Inherited from branch"}
                          {member.boundary
                            ? ` · ${member.boundary.radius_m} m`
                            : ""}
                        </small>
                      </td>
                      {view === "locations" && (
                        <>
                          <td data-label="Location status">
                            <span
                              className={`location-state ${status(member).toLowerCase()}`}
                            >
                              {stateNames[status(member)] || status(member)}
                            </span>
                            <small>
                              {member.work_session &&
                              !member.work_session.ended_at
                                ? "Work tracking on"
                                : "No active work tracking"}
                            </small>
                          </td>
                          <td data-label="Latest update">
                            {recordedAt(member.latest_location)}
                            <small>
                              {member.latest_location
                                ? `${coordinate(member.latest_location.latitude)}, ${coordinate(member.latest_location.longitude)} · ±${Math.round(member.latest_location.accuracy_m)} m`
                                : "Location not recorded"}
                            </small>
                          </td>
                        </>
                      )}
                      <td data-label="Actions">
                        <div className="location-row-actions">
                          <button
                            type="button"
                            onClick={() => {
                              setSelected(member);
                              setPreviewFence(null);
                              setView("locations");
                            }}
                            aria-label={`Show ${member.name} on map`}
                          >
                            View radius
                          </button>
                          {canManage && (
                            <button
                              type="button"
                              onClick={() => {
                                setError("");
                                setAssignment(member);
                                setAssignmentMode(
                                  member.assignment_fence_id
                                    ? "saved"
                                    : "branch",
                                );
                                setFenceId(member.assignment_fence_id || "");
                              }}
                              aria-label={`Assign boundary for ${member.name}`}
                            >
                              Assign boundary
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
      {editing && (
        <Drawer
          title={
            individualMember
              ? `Individual boundary · ${individualMember.name}`
              : editing.id
                ? "Edit work boundary"
                : "Add work boundary"
          }
          onClose={() => {
            setEditing(null);
            setIndividualMember(null);
          }}
        >
          <div className="location-editor">
            <p>
              {individualMember
                ? "Choose this member’s own worksite and radius. Saving changes only their geofence; branch and team leader stay the same."
                : "Choose the center on the map or enter its coordinates. A branch boundary is inherited by its members unless they have an individual assignment."}
            </p>
            <section className="location-editor-step">
              <h3>
                <span>1</span> Choose the worksite
              </h3>
              <p>
                Search for an address, then move the pin to the actual work
                area.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void useCurrentCenter()}
              >
                <LocateFixed size={16} /> Use my current location
              </button>
              <GeofenceMap
                boundary={formCenter()}
                editable
                onCenter={(point) =>
                  setForm((current) => ({
                    ...current,
                    latitude: String(point.latitude),
                    longitude: String(point.longitude),
                  }))
                }
                focus={
                  editorFocus ||
                  (formCenter()
                    ? {
                        ...formCenter()!,
                        key: `editor:${editing.id || individualMember?.user_id || "new"}`,
                      }
                    : null)
                }
              />
              <details className="location-coordinate-details">
                <summary>Enter coordinates manually</summary>
                <div className="location-form-grid">
                  <label>
                    Latitude
                    <input
                      type="number"
                      min="-85"
                      max="85"
                      step="0.000001"
                      value={form.latitude}
                      onChange={(event) =>
                        field("latitude", event.target.value)
                      }
                    />
                  </label>
                  <label>
                    Longitude
                    <input
                      type="number"
                      min="-180"
                      max="180"
                      step="0.000001"
                      value={form.longitude}
                      onChange={(event) =>
                        field("longitude", event.target.value)
                      }
                    />
                  </label>
                </div>
              </details>
            </section>
            <section className="location-editor-step">
              <h3>
                <span>2</span> Set the allowed radius
              </h3>
              <p>
                The circle shows where this member can start work and capture a
                sale when blocking is on.
              </p>
              <div className="location-form-grid">
                <label className="full">
                  Boundary radius (meters)
                  <div className="location-radius">
                    <input
                      type="range"
                      min="25"
                      max="5000"
                      step="25"
                      aria-label="Boundary radius slider"
                      value={Math.min(5000, Number(form.radius_m) || 150)}
                      onChange={(event) =>
                        field("radius_m", event.target.value)
                      }
                    />
                    <input
                      type="number"
                      aria-label="Boundary radius value"
                      min="25"
                      max="100000"
                      value={form.radius_m}
                      onChange={(event) =>
                        field("radius_m", event.target.value)
                      }
                    />
                  </div>
                  <div className="radius-presets" aria-label="Radius presets">
                    {[100, 250, 500, 1000].map((radius) => (
                      <button
                        type="button"
                        key={radius}
                        aria-pressed={Number(form.radius_m) === radius}
                        onClick={() => field("radius_m", String(radius))}
                      >
                        {radius} m
                      </button>
                    ))}
                  </div>
                </label>
              </div>
            </section>
            <section className="location-editor-step">
              <h3>
                <span>3</span> Save who uses this boundary
              </h3>
              <div className="location-form-grid">
                <label className="full">
                  Boundary name
                  <input
                    value={form.name}
                    onChange={(event) => field("name", event.target.value)}
                    maxLength={120}
                  />
                </label>
                {!individualMember && (
                  <label className="full">
                    Applies to branch
                    <select
                      value={form.branch_id}
                      onChange={(event) =>
                        field("branch_id", event.target.value)
                      }
                    >
                      <option value="">
                        Member worksite · assign individually
                      </option>
                      {members.data?.branches?.map((item: Row) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {!individualMember && (
                  <label className="location-checkbox full">
                    <input
                      type="checkbox"
                      checked={form.enabled}
                      onChange={(event) =>
                        field("enabled", event.target.checked)
                      }
                    />{" "}
                    Boundary is active
                  </label>
                )}
              </div>
            </section>
            <p className="location-help">
              Use the center of the actual worksite. GPS accuracy must fit
              within the radius before a member can start work or capture a
              sale.
            </p>
            {error && (
              <p role="alert" className="location-alert">
                {error}
              </p>
            )}
            <div className="location-dialog-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setEditing(null);
                  setIndividualMember(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void saveFence()}
              >
                {busy ? "Saving…" : "Save boundary"}
              </button>
            </div>
          </div>
        </Drawer>
      )}
      {assignment && (
        <Drawer
          title={`Work boundary for ${assignment.name}`}
          onClose={() => setAssignment(null)}
        >
          <div className="location-editor">
            <p>
              <strong>Current:</strong>{" "}
              {assignment.boundary?.name || "Not assigned"} ·{" "}
              {assignment.branch || "No branch"}
            </p>
            <fieldset className="boundary-assignment-options">
              <legend>Choose the work area</legend>
              <label className="boundary-assignment-choice">
                <input
                  type="radio"
                  name="assignment-mode"
                  checked={assignmentMode === "branch"}
                  onChange={() => {
                    setAssignmentMode("branch");
                    setFenceId("");
                  }}
                />
                <span>
                  <strong>Use branch boundary</strong>
                  <small>
                    Recommended for members who work at their branch.
                  </small>
                </span>
              </label>
              <label className="boundary-assignment-choice">
                <input
                  type="radio"
                  name="assignment-mode"
                  checked={assignmentMode === "saved"}
                  onChange={() => setAssignmentMode("saved")}
                />
                <span>
                  <strong>Use another saved worksite</strong>
                  <small>Choose a boundary that has already been set up.</small>
                </span>
              </label>
              <label className="boundary-assignment-choice">
                <input
                  type="radio"
                  name="assignment-mode"
                  checked={assignmentMode === "individual"}
                  onChange={() => setAssignmentMode("individual")}
                />
                <span>
                  <strong>Set an individual boundary</strong>
                  <small>
                    Choose a separate location and radius for this member.
                  </small>
                </span>
              </label>
            </fieldset>
            {assignmentMode === "individual" ? (
              <button
                type="button"
                className="primary"
                onClick={() => {
                  const member = assignment;
                  setAssignment(null);
                  editFence(undefined, member);
                }}
              >
                <MapPin size={16} /> Choose individual worksite
              </button>
            ) : (
              <>
                {assignmentMode === "saved" && (
                  <label>
                    Boundary assignment
                    <select
                      value={fenceId}
                      onChange={(event) => setFenceId(event.target.value)}
                    >
                      <option value="">Choose a saved worksite</option>
                      {fences.data
                        ?.filter((fence) => fence.enabled)
                        .map((fence) => (
                          <option key={fence.id} value={fence.id}>
                            {fence.name} · {fence.radius_m} m
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                {(
                  assignmentMode === "branch"
                    ? fences.data?.find(
                        (row) => row.branch_id === assignment.branch_id,
                      )
                    : fences.data?.find((row) => row.id === fenceId)
                ) ? (
                  <GeofenceMap
                    boundary={
                      fenceId
                        ? (fences.data?.find(
                            (row) => row.id === fenceId,
                          ) as Center) || null
                        : (fences.data?.find(
                            (row) => row.branch_id === assignment.branch_id,
                          ) as Center) || null
                    }
                    focus={(() => {
                      const saved = fenceId
                        ? fences.data?.find((row) => row.id === fenceId)
                        : fences.data?.find(
                            (row) => row.branch_id === assignment.branch_id,
                          );
                      return saved
                        ? {
                            latitude: Number(saved.latitude),
                            longitude: Number(saved.longitude),
                            radius_m: Number(saved.radius_m),
                            key: `assignment:${saved.id}:${saved.radius_m}`,
                          }
                        : null;
                    })()}
                  />
                ) : (
                  <p className="location-assignment-empty">
                    {assignmentMode === "branch"
                      ? "This branch has no boundary yet. Add its worksite in Manage boundaries, or choose a separate worksite for this member."
                      : "Choose a saved worksite to preview its radius."}
                  </p>
                )}
                <p className="location-help">
                  This changes only the work boundary. It does not move the
                  member to another branch or team leader.
                </p>
                {error && (
                  <p role="alert" className="location-alert">
                    {error}
                  </p>
                )}
                <button
                  type="button"
                  className="primary"
                  disabled={busy || (assignmentMode === "saved" && !fenceId)}
                  onClick={() =>
                    void (async () => {
                      if (
                        await write(
                          () =>
                            api(
                              `/location-tracking/assignments/${assignment.user_id}`,
                              {
                                method: "PUT",
                                body: JSON.stringify({
                                  fence_id: fenceId || null,
                                }),
                              },
                            ),
                          "Member work boundary updated",
                        )
                      )
                        setAssignment(null);
                    })()
                  }
                >
                  Save boundary assignment
                </button>
              </>
            )}
          </div>
        </Drawer>
      )}
      {exportOpen && (
        <Drawer title="Export work locations" onClose={closeExport}>
          <div className="location-editor">
            <p>
              Includes member, branch, work boundary, coordinates, accuracy,
              distance, status and capture time. Your current branch and role
              scope apply.
            </p>
            <div className="location-form-grid">
              <label>
                From date
                <input
                  type="date"
                  value={fromDate}
                  onChange={(event) => setFromDate(event.target.value)}
                />
              </label>
              <label>
                To date
                <input
                  type="date"
                  value={toDate}
                  onChange={(event) => setToDate(event.target.value)}
                />
              </label>
              {canRead && (
                <label className="full">
                  Member
                  <select
                    value={exportMember}
                    onChange={(event) => setExportMember(event.target.value)}
                  >
                    <option value="">All authorized members</option>
                    {allRows.map((member) => (
                      <option key={member.user_id} value={member.user_id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="full">
                Location status
                <select
                  value={stateFilter}
                  onChange={(event) => setStateFilter(event.target.value)}
                >
                  <option value="">All statuses</option>
                  {Object.entries(stateNames).map(([key, name]) => (
                    <option
                      key={key}
                      value={key}
                      disabled={key === "NO_LOCATION"}
                    >
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="location-checkbox full">
                <input
                  type="checkbox"
                  checked={areaFilter}
                  onChange={(event) => setAreaFilter(event.target.checked)}
                />{" "}
                Limit export to a geographic radius
              </label>
            </div>
            {areaFilter && (
              <>
                <GeofenceMap
                  editable
                  boundary={
                    exportLat && exportLng
                      ? {
                          latitude: Number(exportLat),
                          longitude: Number(exportLng),
                          radius_m: Number(exportRadius),
                        }
                      : null
                  }
                  onCenter={(point) => {
                    setExportLat(String(point.latitude));
                    setExportLng(String(point.longitude));
                  }}
                />
                <div className="location-form-grid">
                  <label>
                    Center latitude
                    <input
                      type="number"
                      step="0.000001"
                      value={exportLat}
                      onChange={(event) => setExportLat(event.target.value)}
                    />
                  </label>
                  <label>
                    Center longitude
                    <input
                      type="number"
                      step="0.000001"
                      value={exportLng}
                      onChange={(event) => setExportLng(event.target.value)}
                    />
                  </label>
                  <label className="full">
                    Export radius (meters)
                    <div className="location-radius">
                      <input
                        type="range"
                        aria-label="Export radius slider"
                        min="25"
                        max="10000"
                        step="25"
                        value={Number(exportRadius) || 500}
                        onChange={(event) =>
                          setExportRadius(event.target.value)
                        }
                      />
                      <input
                        type="number"
                        min="25"
                        value={exportRadius}
                        onChange={(event) =>
                          setExportRadius(event.target.value)
                        }
                      />
                    </div>
                  </label>
                </div>
                <p className="location-help">
                  This filters exported points only; saved work boundaries stay
                  the same.
                </p>
              </>
            )}
            {stateFilter === "NO_LOCATION" && (
              <p className="location-help">
                Members with no recorded location have no location history to
                export. Choose another status or All statuses.
              </p>
            )}
            {error && (
              <p role="alert" className="location-alert">
                {error}
              </p>
            )}
            <div className="location-dialog-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => void exportRecords("csv")}
              >
                <Download size={16} /> CSV
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void exportRecords("xlsx")}
              >
                <Download size={16} /> Excel
              </button>
            </div>
          </div>
        </Drawer>
      )}
    </div>
  );
}
