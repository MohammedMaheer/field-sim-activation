import { useEffect, useRef, useState } from "react";
import type { Map as LibreMap, Marker, GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { MapPin, Maximize2 } from "lucide-react";
import { Row } from "./api";

export type Center = { latitude: number; longitude: number; radius_m: number };
type MapView = "street" | "3d" | "satellite";
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
  imagery,
}: {
  boundary?: Center | null;
  members?: Row[];
  editable?: boolean;
  onCenter?: (center: { latitude: number; longitude: number }) => void;
  focus?: { latitude: number; longitude: number; key: string } | null;
  imagery?: Row;
}) {
  const container = useRef<HTMLDivElement>(null),
    map = useRef<LibreMap | null>(null);
  const handlers = useRef({ editable, onCenter });
  handlers.current = { editable, onCenter };
  const data = useRef({ boundary, members });
  data.current = { boundary, members };
  const markers = useRef(new Map<string, Marker>()),
    update = useRef<() => void>(() => {});
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [view, setView] = useState<MapView>("street"),
    [ready, setReady] = useState(false);
  const imageryRef = useRef(imagery);
  imageryRef.current = imagery;
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
          if (handlers.current.editable)
            handlers.current.onCenter?.({
              latitude: Number(event.lngLat.lat.toFixed(6)),
              longitude: Number(event.lngLat.lng.toFixed(6)),
            });
        });
        active.on("error", (event) => {
          if ((event as unknown as Row).sourceId === "work-satellite") {
            setNotice(
              "Satellite imagery is unavailable for this view. Street map restored; imagery may have cloud cover or missing coverage.",
            );
            setView("street");
          } else if (!event.error?.message?.includes("WebGL")) {
            setNotice(
              "Some map tiles could not load. Coordinates and radius controls remain available.",
            );
          }
          if (event.error?.message?.includes("WebGL"))
            setError(
              "Map rendering is unavailable. You can still enter coordinates and a radius.",
            );
        });
        update.current = () => {
          if (!active.isStyleLoaded()) return;
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
              const pin = document.createElement("span");
              pin.className = "work-map-center";
              pin.title = "Boundary center";
              marker = new library.Marker({ element: pin })
                .setLngLat([current.longitude, current.latitude])
                .addTo(active);
              markers.current.set("center", marker);
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
            setReady(true);
            update.current();
          }
        });
        active.on("style.load", () => update.current());
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
    if (map.current && focus)
      map.current.easeTo({
        center: [focus.longitude, focus.latitude],
        zoom: 16,
        duration: 450,
      });
  }, [focus?.key]);
  useEffect(() => {
    const active = map.current;
    if (!active || !ready) return;
    if (view === "satellite" && imageryRef.current?.tile_url) {
      if (active.getLayer("work-buildings"))
        active.setLayoutProperty("work-buildings", "visibility", "none");
      if (!active.getSource("work-satellite"))
        active.addSource("work-satellite", {
          type: "raster",
          tiles: [imageryRef.current.tile_url],
          tileSize: 256,
          maxzoom: Number(imageryRef.current.max_zoom) || 9,
          attribution:
            '<a href="https://earthdata.nasa.gov/gibs">NASA GIBS</a>',
        });
      if (!active.getLayer("work-satellite"))
        active.addLayer(
          { id: "work-satellite", type: "raster", source: "work-satellite" },
          "work-boundary-fill",
        );
      active.setLayoutProperty("work-satellite", "visibility", "visible");
      active.easeTo({ pitch: 0, duration: 350 });
      return;
    }
    if (active.getLayer("work-satellite"))
      active.setLayoutProperty("work-satellite", "visibility", "none");
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
    active.easeTo({ pitch: view === "3d" ? 45 : 0, duration: 350 });
  }, [view, ready]);
  return (
    <div className="work-map-shell">
      <div className="work-map-tools" aria-label="Map view">
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
        {imagery?.tile_url && (
          <button
            type="button"
            aria-pressed={view === "satellite"}
            onClick={() => setView("satellite")}
          >
            Satellite
          </button>
        )}
        {boundary && (
          <button
            type="button"
            onClick={() =>
              map.current?.easeTo({
                center: [boundary.longitude, boundary.latitude],
                zoom: 15,
                duration: 400,
              })
            }
            aria-label="Center map on boundary"
          >
            <Maximize2 size={16} />
          </button>
        )}
      </div>
      <div
        ref={container}
        className="work-map"
        aria-label={
          editable
            ? "Choose boundary center on map"
            : "Authorized member locations map"
        }
      />
      {error && (
        <div className="work-map-error" role="status">
          <MapPin size={22} />
          <span>{error}</span>
        </div>
      )}
      <div className="work-map-caption">
        {notice && <span role="status">{notice} </span>}
        {view === "satellite"
          ? `NASA GIBS · ${imagery?.available_date || "Date unavailable"} · ${imagery?.resolution_m || 250} m imagery. Cloud cover or missing coverage is possible. Regional context; street view is best for branch boundaries.`
          : editable
            ? "Click the map to choose the boundary center. Coordinates remain editable below."
            : "Markers show the latest reported location; dimmed markers need a fresh update."}
      </div>
    </div>
  );
}
