import { useEffect, useRef, useState } from "react";
import type { Map as LibreMap, Marker, GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { MapPin, Maximize2, Search } from "lucide-react";
import { api, Row } from "./api";

export type Center = { latitude: number; longitude: number; radius_m: number };
type MapView = "street" | "3d";
const initialCenter = [55.2708, 25.2048] as [number, number];
function circle(boundary?: Center | null): GeoJSON.FeatureCollection {
  if (!boundary) return { type: "FeatureCollection", features: [] };
  const radians = Math.PI / 180,
    angular = boundary.radius_m / 6371008.8;
  const lat = boundary.latitude * radians,
    lon = boundary.longitude * radians;
  const ring = Array.from({ length: 81 }, (_, i) => {
    const bearing = (i * 2 * Math.PI) / 80;
    const y = Math.asin(
      Math.sin(lat) * Math.cos(angular) +
        Math.cos(lat) * Math.sin(angular) * Math.cos(bearing),
    );
    const x =
      lon +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angular) * Math.cos(lat),
        Math.cos(angular) - Math.sin(lat) * Math.sin(y),
      );
    return [x / radians, y / radians];
  });
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [ring] },
      },
    ],
  };
}

export default function GeofenceMap({
  boundary,
  members = [],
  editable = false,
  onCenter,
  focus,
  onMemberSelect,
}: {
  boundary?: Center | null;
  members?: Row[];
  editable?: boolean;
  onCenter?: (center: { latitude: number; longitude: number }) => void;
  focus?: {
    latitude: number;
    longitude: number;
    key: string;
    radius_m?: number;
  } | null;
  onMemberSelect?: (userId: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null),
    map = useRef<LibreMap | null>(null);
  const [pinMode, setPinMode] = useState(editable);
  const handlers = useRef({ editable, pinMode, onCenter, onMemberSelect });
  handlers.current = { editable, pinMode, onCenter, onMemberSelect };
  const data = useRef({ boundary, members });
  data.current = { boundary, members };
  const markers = useRef(new Map<string, Marker>()),
    update = useRef<() => void>(() => {});
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [view, setView] = useState<MapView>("street"),
    [ready, setReady] = useState(false);
  const [placeQuery, setPlaceQuery] = useState(""),
    [searching, setSearching] = useState(false);
  const [placeResults, setPlaceResults] = useState<Row[]>([]),
    [searchError, setSearchError] = useState("");
  const [searched, setSearched] = useState(false);
  const searchGeneration = useRef(0);
  useEffect(
    () => () => {
      searchGeneration.current++;
    },
    [],
  );
  const findPlace = async () => {
    if (placeQuery.trim().length < 2) {
      setSearchError("Enter a city, street or public place.");
      return;
    }
    const generation = ++searchGeneration.current;
    setSearching(true);
    setSearchError("");
    setSearched(false);
    try {
      const response = await api(
        `/location-tracking/place-search?q=${encodeURIComponent(placeQuery.trim())}`,
      );
      if (generation === searchGeneration.current) {
        setPlaceResults(response.results || []);
        setSearched(true);
      }
    } catch (failure) {
      if (generation === searchGeneration.current)
        setSearchError(
          (failure as Row)?.status === 429
            ? "Place search is busy. Wait a couple of seconds and search again."
            : failure instanceof Error
              ? failure.message
              : "Place search could not load. Drop a pin or enter coordinates.",
        );
    } finally {
      if (generation === searchGeneration.current) setSearching(false);
    }
  };
  const choosePlace = (place: Row) => {
    setPlaceResults([]);
    setSearched(false);
    setPlaceQuery(place.name.slice(0, 160));
    if (editable) {
      setPinMode(true);
      onCenter?.({ latitude: place.latitude, longitude: place.longitude });
    }
    map.current?.easeTo({
      center: [place.longitude, place.latitude],
      zoom: 15,
      duration: 450,
    });
  };
  const fitBoundary = (current: Center, duration = 400) => {
    const active = map.current;
    if (!active) return;
    const deltaLat = current.radius_m / 111195;
    const deltaLon =
      deltaLat / Math.max(0.05, Math.cos((current.latitude * Math.PI) / 180));
    active.fitBounds(
      [
        [current.longitude - deltaLon, current.latitude - deltaLat],
        [current.longitude + deltaLon, current.latitude + deltaLat],
      ],
      {
        padding: 48,
        maxZoom: 18,
        duration,
      },
    );
  };
  useEffect(() => {
    let cancelled = false,
      observer: ResizeObserver | undefined;
    void import("maplibre-gl")
      .then((library) => {
        if (cancelled || !container.current) return;
        library.setWorkerUrl(workerUrl);
        library.setWorkerCount(2);
        const active = new library.Map({
          container: container.current,
          style: "https://tiles.openfreemap.org/styles/bright",
          center: boundary
            ? [boundary.longitude, boundary.latitude]
            : initialCenter,
          zoom: boundary ? 15 : 9,
          attributionControl: { compact: false },
          maxPitch: 60,
        });
        map.current = active;
        active.addControl(
          new library.NavigationControl({ visualizePitch: true }),
          "top-right",
        );
        active.on("click", (event) => {
          if (handlers.current.editable && handlers.current.pinMode)
            handlers.current.onCenter?.({
              latitude: Number(event.lngLat.lat.toFixed(6)),
              longitude: Number(event.lngLat.lng.toFixed(6)),
            });
        });
        active.on("error", (event) => {
          if (!event.error?.message?.includes("WebGL")) {
            setNotice(
              "Some map tiles could not load. Coordinates and radius controls remain available.",
            );
          }
          if (event.error?.message?.includes("WebGL"))
            setError(
              "Map rendering is unavailable. You can still enter coordinates and a radius.",
            );
        });
        let styleReady = false;
        update.current = () => {
          if (!styleReady) return;
          const { boundary: current, members: rows } = data.current;
          const source = active.getSource("work-boundary") as
            GeoJSONSource | undefined;
          if (source) source.setData(circle(current));
          else {
            active.addSource("work-boundary", {
              type: "geojson",
              data: circle(current),
            });
            active.addLayer({
              id: "work-boundary-contrast",
              type: "line",
              source: "work-boundary",
              paint: {
                "line-color": "#ffffff",
                "line-width": 6,
                "line-opacity": 0.9,
              },
            });
            active.addLayer({
              id: "work-boundary-fill",
              type: "fill",
              source: "work-boundary",
              paint: { "fill-color": "#8b2554", "fill-opacity": 0.12 },
            });
            active.addLayer({
              id: "work-boundary-line",
              type: "line",
              source: "work-boundary",
              paint: { "line-color": "#8b2554", "line-width": 2.5 },
            });
          }
          const present = new Set<string>();
          if (current) {
            present.add("center");
            let marker = markers.current.get("center");
            if (!marker) {
              const pin = document.createElement("button");
              pin.type = "button";
              pin.className = "work-map-center";
              pin.title = editable
                ? "Drag the boundary pin to move its center"
                : "Boundary center";
              pin.setAttribute("aria-label", "Boundary center pin");
              marker = new library.Marker({
                element: pin,
                draggable:
                  handlers.current.editable && handlers.current.pinMode,
              })
                .setLngLat([current.longitude, current.latitude])
                .addTo(active);
              markers.current.set("center", marker);
              const centerMarker = marker;
              centerMarker.on("dragend", () => {
                const point = centerMarker.getLngLat();
                handlers.current.onCenter?.({
                  latitude: Number(point.lat.toFixed(6)),
                  longitude: Number(point.lng.toFixed(6)),
                });
              });
            } else marker.setLngLat([current.longitude, current.latitude]);
          }
          for (const member of rows) {
            const point = member.latest_location;
            if (
              !point ||
              !Number.isFinite(point.latitude) ||
              !Number.isFinite(point.longitude)
            )
              continue;
            const key = `member:${member.user_id}`;
            present.add(key);
            let marker = markers.current.get(key);
            const pin = marker
              ? marker.getElement()
              : document.createElement("button");
            if (pin instanceof HTMLButtonElement) pin.type = "button";
            pin.className = `work-map-member ${point.state?.toLowerCase() || ""} ${point.fresh ? "" : "stale"}`;
            pin.textContent = (member.name || "?")
              .split(" ")
              .map((part: string) => part[0])
              .slice(0, 2)
              .join("");
            pin.setAttribute(
              "aria-label",
              `${member.name}, ${point.state?.toLowerCase() || "location recorded"}${point.fresh ? "" : ", last recorded location"}`,
            );
            pin.onclick = (event) => {
              event.stopPropagation();
              handlers.current.onMemberSelect?.(member.user_id);
            };
            const details = document.createElement("div");
            const title = document.createElement("strong");
            title.textContent = member.name || "Member";
            details.append(title);
            const description = document.createElement("p");
            description.textContent = `${point.state?.replaceAll("_", " ") || "Location recorded"} · Accuracy ±${Math.round(point.accuracy_m)} m`;
            details.append(description);
            if (!marker) {
              marker = new library.Marker({ element: pin })
                .setLngLat([point.longitude, point.latitude])
                .setPopup(
                  new library.Popup({ offset: 20 }).setDOMContent(details),
                )
                .addTo(active);
              markers.current.set(key, marker);
            } else {
              marker.setLngLat([point.longitude, point.latitude]);
              marker.getPopup()?.setDOMContent(details);
            }
          }
          markers.current.forEach((marker, key) => {
            if (!present.has(key)) {
              marker.remove();
              markers.current.delete(key);
            }
          });
        };
        active.on("load", () => {
          if (!cancelled) {
            styleReady = true;
            setReady(true);
            update.current();
          }
        });
        active.on("style.load", () => {
          styleReady = true;
          update.current();
        });
        observer = new ResizeObserver(() => active.resize());
        observer.observe(container.current);
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "The map could not load. Use coordinates and radius to continue.",
          );
      });
    return () => {
      cancelled = true;
      observer?.disconnect();
      markers.current.forEach((marker) => marker.remove());
      markers.current.clear();
      map.current?.remove();
      map.current = null;
    };
  }, []);
  useEffect(
    () => update.current(),
    [boundary?.latitude, boundary?.longitude, boundary?.radius_m, members],
  );
  useEffect(() => {
    markers.current.get("center")?.setDraggable(editable && pinMode);
  }, [editable, pinMode, boundary?.latitude, boundary?.longitude]);
  useEffect(() => {
    if (map.current && focus) {
      if (focus.radius_m) fitBoundary(focus as Center);
      else
        map.current.easeTo({
          center: [focus.longitude, focus.latitude],
          zoom: 16,
          duration: 450,
        });
    }
  }, [focus?.key, ready]);
  useEffect(() => {
    const active = map.current;
    if (!active || !ready) return;
    active.setMaxZoom(22);
    if (view === "3d") {
      if (!active.getSource("work-buildings"))
        active.addSource("work-buildings", {
          type: "vector",
          url: "https://tiles.openfreemap.org/planet",
        });
      if (!active.getLayer("work-buildings"))
        active.addLayer({
          id: "work-buildings",
          type: "fill-extrusion",
          source: "work-buildings",
          "source-layer": "building",
          minzoom: 15,
          filter: ["!=", ["get", "hide_3d"], true],
          paint: {
            "fill-extrusion-color": "#b9afc7",
            "fill-extrusion-height": ["coalesce", ["get", "render_height"], 0],
            "fill-extrusion-base": [
              "coalesce",
              ["get", "render_min_height"],
              0,
            ],
            "fill-extrusion-opacity": 0.8,
          },
        });
      active.setLayoutProperty("work-buildings", "visibility", "visible");
    } else if (active.getLayer("work-buildings"))
      active.setLayoutProperty("work-buildings", "visibility", "none");
    const pitch = view === "3d" ? 45 : 0;
    if (Math.abs(active.getPitch() - pitch) > 0.1)
      active.easeTo({ pitch, duration: 350 });
  }, [view, ready]);
  return (
    <div className="work-map-shell">
      <details className="map-optional-tools" open={editable || undefined}>
        <summary>Search map & view options</summary>
        <div
          className="map-place-search"
          role="search"
          aria-label="Find a worksite"
        >
          <label>
            <span className="sr-only">Search place or address</span>
            <input
              value={placeQuery}
              placeholder="City, street or public place"
              maxLength={160}
              onChange={(event) => setPlaceQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void findPlace();
                }
              }}
            />
          </label>
          <button
            type="button"
            disabled={searching}
            onClick={() => void findPlace()}
          >
            <Search size={16} />
            {searching ? "Searching…" : "Search place"}
          </button>
        </div>
        {(searchError || (searched && !placeResults.length)) && (
          <p
            className="map-search-feedback"
            role={searchError ? "alert" : "status"}
          >
            {searchError ||
              "No matching place found. Try the city name, drop a pin or enter coordinates."}
          </p>
        )}
        {!!placeResults.length && (
          <div className="map-search-results" aria-label="Place search results">
            {placeResults.map((place) => (
              <button
                type="button"
                key={place.id}
                onClick={() => choosePlace(place)}
              >
                <MapPin size={17} />
                <span>{place.name}</span>
              </button>
            ))}
          </div>
        )}
        <small className="map-search-attribution">
          Search public places only ·{" "}
          <a
            href="https://operations.osmfoundation.org/policies/nominatim/"
            target="_blank"
            rel="noreferrer"
          >
            © OpenStreetMap contributors
          </a>
        </small>
        <div className="work-map-tools" aria-label="Map view">
          {editable && (
            <button
              type="button"
              aria-pressed={pinMode}
              onClick={() => setPinMode((value) => !value)}
            >
              <MapPin size={16} /> Drop pin
            </button>
          )}
          <button
            type="button"
            aria-pressed={view === "street"}
            onClick={() => setView("street")}
          >
            Street
          </button>
          <button
            type="button"
            aria-pressed={view === "3d"}
            onClick={() => setView("3d")}
          >
            3D buildings
          </button>
          {boundary && (
            <button
              type="button"
              onClick={() => fitBoundary(boundary)}
              aria-label="Center map on boundary"
            >
              <Maximize2 size={16} /> Fit radius
            </button>
          )}
        </div>
        {boundary && (
          <a
            className="map-street-view-link"
            href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${encodeURIComponent(`${boundary.latitude},${boundary.longitude}`)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open Street View where available
          </a>
        )}
      </details>
      <div
        ref={container}
        className="work-map"
        aria-label={
          editable
            ? "Choose boundary center on map"
            : "Authorized member locations map"
        }
      />
      {boundary && (
        <span className="map-radius-label">
          Boundary radius · {boundary.radius_m} m
        </span>
      )}
      {error && (
        <div className="work-map-error" role="status">
          <MapPin size={22} />
          <span>{error}</span>
        </div>
      )}
      <div className="work-map-caption">
        {notice && <span role="status">{notice} </span>}
        {editable
          ? pinMode
            ? "Click the map to drop the boundary pin, or drag it to move the center. Coordinates remain editable below."
            : "Turn on Drop pin to position the boundary, or search for a public place."
          : "Markers show the latest reported location; dimmed markers need a fresh update."}
      </div>
    </div>
  );
}
