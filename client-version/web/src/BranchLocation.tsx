import { useContext, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LocateFixed, MapPin } from "lucide-react";
import { Context } from "./App";
import { api, Row } from "./api";
import { ErrorState, Loading } from "./components";
import { currentGPS } from "./WorkLocation";
import GeofenceMap from "./GeofenceMap";
import "./location-tracking.css";
import "./branch-location.css";

export type BranchLocationValue = {
  latitude: string;
  longitude: string;
  radius_m: string;
  enabled: boolean;
};
export const emptyBranchLocation = (): BranchLocationValue => ({
  latitude: "",
  longitude: "",
  radius_m: "150",
  enabled: true,
});
export function branchLocationPayload(value: BranchLocationValue | null) {
  if (!value) return undefined;
  const latitude = Number(value.latitude),
    longitude = Number(value.longitude),
    radius_m = Number(value.radius_m);
  if (
    !value.latitude.trim() ||
    !value.longitude.trim() ||
    !value.radius_m.trim() ||
    !Number.isFinite(latitude) ||
    Math.abs(latitude) > 85 ||
    !Number.isFinite(longitude) ||
    Math.abs(longitude) > 180 ||
    !Number.isInteger(radius_m) ||
    radius_m < 25 ||
    radius_m > 100000
  )
    throw new Error(
      "Choose a branch location and a radius between 25 and 100,000 metres.",
    );
  return { latitude, longitude, radius_m, enabled: value.enabled };
}

export function BranchLocationFields({
  value,
  onChange,
  busy = false,
  optional = false,
}: {
  value: BranchLocationValue | null;
  onChange: (value: BranchLocationValue | null) => void;
  busy?: boolean;
  optional?: boolean;
}) {
  const { user } = useContext(Context);
  const [gpsBusy, setGPSBusy] = useState(false),
    [gpsError, setGPSError] = useState("");
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const imagery = useQuery<Row>({
    queryKey: ["work-location", "imagery", user.id],
    queryFn: () => api("/location-tracking/map-imagery"),
    enabled: !!value,
    retry: false,
    staleTime: 60000,
  });
  let center = null;
  try {
    center = branchLocationPayload(value) || null;
  } catch {
    /* No invented position while coordinates are incomplete. */
  }
  const field = (key: keyof BranchLocationValue, next: string | boolean) =>
    value && onChange({ ...value, [key]: next });
  return (
    <section
      className="branch-location-fields wide"
      aria-label="Branch location settings"
    >
      {optional && (
        <label className="branch-location-choice">
          <input
            type="checkbox"
            disabled={busy}
            checked={!!value}
            onChange={(event) => {
              generation.current++;
              setGPSBusy(false);
              setGPSError("");
              onChange(event.target.checked ? emptyBranchLocation() : null);
            }}
          />
          <span>
            <b>Add branch location and work radius</b>
            <small>
              Optional · configure now or later from the branch record.
            </small>
          </span>
        </label>
      )}
      {value && (
        <fieldset disabled={busy || gpsBusy}>
          <p className="location-help">
            Choose the actual worksite. This saves its branch boundary; global
            enforcement is controlled separately in Work locations.
          </p>
          <GeofenceMap
            boundary={center}
            editable
            imagery={imagery.data?.available ? imagery.data : undefined}
            onCenter={(point) =>
              onChange({
                ...value,
                latitude: String(point.latitude),
                longitude: String(point.longitude),
              })
            }
            focus={
              center
                ? {
                    ...center,
                    key: `branch-center:${center.latitude}:${center.longitude}`,
                  }
                : null
            }
          />
          {(imagery.data?.available === false || imagery.error) && (
            <p className="location-help" role="status">
              Satellite overview is unavailable. Street and 3D views remain
              available.{" "}
              <button
                type="button"
                disabled={imagery.isFetching}
                onClick={() => imagery.refetch()}
              >
                Check satellite availability
              </button>
            </p>
          )}
          <div className="location-form-grid">
            <label>
              Latitude
              <input
                aria-label="Branch latitude"
                type="number"
                min="-85"
                max="85"
                step="0.000001"
                value={value.latitude}
                onChange={(event) => field("latitude", event.target.value)}
              />
            </label>
            <label>
              Longitude
              <input
                aria-label="Branch longitude"
                type="number"
                min="-180"
                max="180"
                step="0.000001"
                value={value.longitude}
                onChange={(event) => field("longitude", event.target.value)}
              />
            </label>
            <label className="full">
              Work radius (metres)
              <div className="location-radius">
                <input
                  aria-label="Branch radius slider"
                  type="range"
                  min="25"
                  max="5000"
                  step="25"
                  value={Math.min(5000, Number(value.radius_m) || 150)}
                  onChange={(event) => field("radius_m", event.target.value)}
                />
                <input
                  aria-label="Branch radius value"
                  type="number"
                  min="25"
                  max="100000"
                  step="1"
                  value={value.radius_m}
                  onChange={(event) => field("radius_m", event.target.value)}
                />
              </div>
            </label>
            <div
              className="radius-presets full"
              aria-label="Branch radius presets"
            >
              {[100, 250, 500, 1000].map((radius) => (
                <button
                  type="button"
                  key={radius}
                  aria-pressed={Number(value.radius_m) === radius}
                  onClick={() => field("radius_m", String(radius))}
                >
                  {radius} m
                </button>
              ))}
            </div>
            <label className="location-checkbox full">
              <input
                type="checkbox"
                checked={value.enabled}
                onChange={(event) => field("enabled", event.target.checked)}
              />
              Branch boundary is active
            </label>
          </div>
          <button
            type="button"
            onClick={async () => {
              const current = ++generation.current;
              setGPSBusy(true);
              setGPSError("");
              try {
                const point = await currentGPS("Branch location setup");
                if (current === generation.current)
                  onChange({
                    ...value,
                    latitude: String(point.latitude),
                    longitude: String(point.longitude),
                  });
              } catch (failure) {
                if (current === generation.current)
                  setGPSError(
                    failure instanceof Error
                      ? failure.message
                      : "Location unavailable. Search or drop a pin.",
                  );
              } finally {
                if (current === generation.current) setGPSBusy(false);
              }
            }}
          >
            <LocateFixed size={16} />
            {gpsBusy ? "Reading location…" : "Use my current location"}
          </button>
          {gpsError && (
            <p role="alert" className="location-alert">
              {gpsError}
            </p>
          )}
        </fieldset>
      )}
    </section>
  );
}

export default function BranchLocationEditor({
  branchId,
}: {
  branchId: string;
}) {
  const { user } = useContext(Context);
  const permitted =
    ["Administrator", "Operations Manager"].includes(user.role) &&
    user.permissions.includes("location.manage");
  const [open, setOpen] = useState(false),
    [revision, setRevision] = useState(0),
    [saved, setSaved] = useState("");
  const query = useQuery<Row>({
    queryKey: ["branch-location", user.id, branchId],
    queryFn: () => api(`/organization/branches/${branchId}/location`),
    enabled: permitted,
  });
  const cache = useQueryClient();
  if (!permitted) return null;
  return (
    <section className="branch-location-editor">
      <div className="branch-location-heading">
        <div>
          <h3>Branch location</h3>
          <p>
            {query.data?.location
              ? `${query.data.location.radius_m} m radius · ${query.data.location.latitude}, ${query.data.location.longitude}${query.data.location.enabled ? "" : " · Disabled"}`
              : "Not configured"}
          </p>
        </div>
        <button
          type="button"
          disabled={query.isPending || !!query.error}
          onClick={() => {
            setOpen(!open);
            setSaved("");
          }}
        >
          <MapPin size={16} />
          {open
            ? "Close location settings"
            : query.data?.location
              ? "Edit branch location"
              : "Set branch location"}
        </button>
      </div>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} retry={query.refetch} />
      ) : (
        open && (
          <BranchLocationForm
            key={`${branchId}:${revision}`}
            data={query.data!}
            onSaved={async () => {
              await cache.invalidateQueries();
              setOpen(false);
              setSaved("Branch location saved");
            }}
            onReload={async () => {
              await query.refetch();
              setRevision((value) => value + 1);
            }}
          />
        )
      )}
      {saved && (
        <p role="status" className="setup-success">
          {saved}
        </p>
      )}
    </section>
  );
}
function BranchLocationForm({
  data,
  onSaved,
  onReload,
}: {
  data: Row;
  onSaved: () => Promise<void>;
  onReload: () => Promise<void>;
}) {
  // The expected snapshot must describe the values the editor opened with.
  // Background updates must not authorize overwriting someone else's changes.
  const [expected] = useState(() =>
    data.location
      ? Object.fromEntries(
          [
            "id",
            "latitude",
            "longitude",
            "radius_m",
            "enabled",
            "updated_at",
          ].map((key) => [key, data.location[key]]),
        )
      : null,
  );
  const [value, setValue] = useState<BranchLocationValue | null>(() =>
    data.location
      ? {
          latitude: String(data.location.latitude),
          longitude: String(data.location.longitude),
          radius_m: String(data.location.radius_m),
          enabled: data.location.enabled,
        }
      : emptyBranchLocation(),
  );
  const [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const saving = useRef(false);
  return (
    <form
      aria-label="Edit branch location"
      onSubmit={async (event) => {
        event.preventDefault();
        if (saving.current) return;
        saving.current = true;
        setBusy(true);
        setError("");
        try {
          const location = branchLocationPayload(value);
          await api(`/organization/branches/${data.branch_id}/location`, {
            method: "PUT",
            body: JSON.stringify({ location, expected, reason }),
          });
          await onSaved();
        } catch (failure) {
          setError(
            failure instanceof Error
              ? failure.message
              : "Could not save branch location",
          );
        } finally {
          saving.current = false;
          setBusy(false);
        }
      }}
    >
      <BranchLocationFields value={value} onChange={setValue} busy={busy} />
      <label>
        Reason for location change
        <input
          value={reason}
          minLength={5}
          maxLength={300}
          required
          disabled={busy}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      {error && (
        <div role="alert" className="form-error">
          <p>{error}</p>
          <button type="button" disabled={busy} onClick={onReload}>
            Reload branch location
          </button>
        </div>
      )}
      <button className="primary" disabled={busy}>
        {busy ? "Saving…" : "Save branch location"}
      </button>
    </form>
  );
}
