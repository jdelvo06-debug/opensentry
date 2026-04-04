import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Circle,
  Polygon,
  Marker,
  useMap,
  useMapEvents,
  ScaleControl,
  LayersControl,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// ─── Constants ───────────────────────────────────────────────────────────────

const SHAW_AFB = { lat: 33.9722, lng: -80.4756 };
const DEFAULT_ZOOM = 14;

const COLORS = {
  bg: "#0d1117",
  card: "#161b22",
  border: "#30363d",
  text: "#e6edf3",
  muted: "#8b949e",
  accent: "#58a6ff",
  danger: "#f85149",
  warning: "#d29922",
  success: "#3fb950",
  purple: "#a371f7",
};

const ALTITUDE_PRESETS = [2, 10, 30];

// System definitions for the palette
interface SystemDef {
  id: string;
  name: string;
  category: "sensor" | "effector" | "infrastructure";
  type: string;
  range_km?: number;
  fov_deg?: number;
  color: string;
  icon: string;
  description: string;
}

const SYSTEM_CATALOG: SystemDef[] = [
  // Sensors
  {
    id: "tpq51",
    name: "L-Band Radar (AN/TPQ-51)",
    category: "sensor",
    type: "radar",
    range_km: 10.0,
    fov_deg: 360,
    color: "#58a6ff",
    icon: "📡",
    description: "360° surveillance radar, 10km range",
  },
  {
    id: "shenobi",
    name: "Shenobi (RF Detector)",
    category: "sensor",
    type: "rf",
    range_km: 8.0,
    fov_deg: 360,
    color: "#a371f7",
    icon: "📻",
    description: "Passive RF detection, 8km range",
  },
  {
    id: "eoir_camera",
    name: "EO/IR Camera",
    category: "sensor",
    type: "eoir",
    range_km: 8.0,
    fov_deg: 15,
    color: "#3fb950",
    icon: "📷",
    description: "Electro-optical/infrared, 8km range, 15° FOV",
  },
  {
    id: "acoustic",
    name: "Acoustic Array",
    category: "sensor",
    type: "acoustic",
    range_km: 3.0,
    fov_deg: 360,
    color: "#79c0ff",
    icon: "🔊",
    description: "Passive acoustic detection, 3km range",
  },
  // Effectors
  {
    id: "jackal_pallet",
    name: "JACKAL Interceptor",
    category: "effector",
    type: "kinetic",
    range_km: 10.0,
    fov_deg: 360,
    color: "#f85149",
    icon: "🚀",
    description: "Kinetic interceptor pallet, 10km range",
  },
  {
    id: "rf_jammer",
    name: "RF Jammer",
    category: "effector",
    type: "electronic",
    range_km: 5.0,
    fov_deg: 360,
    color: "#e3b341",
    icon: "⚡",
    description: "RF/PNT jammer, 5km range",
  },
  {
    id: "lmadis",
    name: "LMADIS",
    category: "effector",
    type: "electronic",
    range_km: 6.0,
    fov_deg: 360,
    color: "#d29922",
    icon: "🛡️",
    description: "Light Marine Air Defense, 6km range",
  },
  // Infrastructure (no coverage)
  {
    id: "command_post",
    name: "Command Post",
    category: "infrastructure",
    type: "structure",
    color: "#8b949e",
    icon: "🏢",
    description: "Tactical operations center",
  },
  {
    id: "main_gate",
    name: "Main Gate",
    category: "infrastructure",
    type: "structure",
    color: "#8b949e",
    icon: "🚧",
    description: "Primary entry control point",
  },
  {
    id: "fuel_depot",
    name: "Fuel Depot",
    category: "infrastructure",
    type: "structure",
    color: "#8b949e",
    icon: "⛽",
    description: "Fuel storage facility",
  },
  {
    id: "barracks",
    name: "Barracks",
    category: "infrastructure",
    type: "structure",
    color: "#8b949e",
    icon: "🏠",
    description: "Personnel housing",
  },
  {
    id: "comms_tower",
    name: "Comms Tower",
    category: "infrastructure",
    type: "structure",
    color: "#8b949e",
    icon: "📶",
    description: "Communications relay tower",
  },
];

// ─── Placed system type ──────────────────────────────────────────────────────

interface PlacedSystem {
  uid: string;
  def: SystemDef;
  lat: number;
  lng: number;
  altitude: number; // meters
  viewshed: [number, number][] | null; // polygon points or null if loading/unavailable
  viewshedLoading: boolean;
  viewshedArea: number | null; // km²
}

// ─── Viewshed computation ────────────────────────────────────────────────────

const viewshedCache = new Map<string, { polygon: [number, number][]; area: number }>();

function cacheKey(lat: number, lng: number, alt: number): string {
  return `${lat.toFixed(6)},${lng.toFixed(6)},${alt}`;
}

// Number of radial rays and distance steps for viewshed
const NUM_RAYS = 72;
const MAX_RANGE_KM = 15;
const STEP_KM = 0.15;
const EARTH_RADIUS_KM = 6371;

function degToRad(d: number): number {
  return (d * Math.PI) / 180;
}
function radToDeg(r: number): number {
  return (r * 180) / Math.PI;
}

/** Offset a lat/lng by a distance (km) and bearing (radians) */
function offsetLatLng(
  lat: number,
  lng: number,
  distKm: number,
  bearingRad: number,
): [number, number] {
  const angDist = distKm / EARTH_RADIUS_KM;
  const latR = degToRad(lat);
  const lngR = degToRad(lng);
  const newLat = Math.asin(
    Math.sin(latR) * Math.cos(angDist) +
      Math.cos(latR) * Math.sin(angDist) * Math.cos(bearingRad),
  );
  const newLng =
    lngR +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(angDist) * Math.cos(latR),
      Math.cos(angDist) - Math.sin(latR) * Math.sin(newLat),
    );
  return [radToDeg(newLat), radToDeg(newLng)];
}

/** Fetch elevations from open-elevation API in batches */
async function fetchElevations(
  points: { latitude: number; longitude: number }[],
): Promise<number[]> {
  // Batch into groups of 200 to avoid oversized requests
  const BATCH = 200;
  const results: number[] = [];
  for (let i = 0; i < points.length; i += BATCH) {
    const batch = points.slice(i, i + BATCH);
    const resp = await fetch("https://api.open-elevation.com/api/v1/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locations: batch }),
    });
    if (!resp.ok) throw new Error(`Elevation API error: ${resp.status}`);
    const data = await resp.json();
    for (const r of data.results) {
      results.push(r.elevation);
    }
  }
  return results;
}

/** Compute viewshed polygon: cast rays from center, check LOS along each */
async function computeViewshed(
  lat: number,
  lng: number,
  altitudeM: number,
  rangeKm: number,
): Promise<{ polygon: [number, number][]; area: number }> {
  const effectiveRange = Math.min(rangeKm, MAX_RANGE_KM);
  const steps = Math.ceil(effectiveRange / STEP_KM);

  // Build all sample points: center + rays
  const allPoints: { latitude: number; longitude: number }[] = [
    { latitude: lat, longitude: lng },
  ];
  const rayPoints: { ray: number; step: number; lat: number; lng: number }[] = [];

  for (let r = 0; r < NUM_RAYS; r++) {
    const bearing = (r / NUM_RAYS) * 2 * Math.PI;
    for (let s = 1; s <= steps; s++) {
      const dist = s * STEP_KM;
      const [pLat, pLng] = offsetLatLng(lat, lng, dist, bearing);
      allPoints.push({ latitude: pLat, longitude: pLng });
      rayPoints.push({ ray: r, step: s, lat: pLat, lng: pLng });
    }
  }

  const elevations = await fetchElevations(allPoints);
  const centerElev = elevations[0] + altitudeM;

  // For each ray, walk outward and find max visible distance
  const visibleEdge: [number, number][] = [];
  for (let r = 0; r < NUM_RAYS; r++) {
    let maxAngle = -Infinity;
    let lastVisible: [number, number] | null = null;

    for (let s = 0; s < steps; s++) {
      const idx = 1 + r * steps + s;
      const dist = (s + 1) * STEP_KM;
      const elev = elevations[idx];
      // Angle from observer to this point (simplified, no earth curvature for short range)
      const angle = (elev - centerElev) / (dist * 1000); // rise/run in meters

      if (angle >= maxAngle) {
        maxAngle = angle;
        lastVisible = [rayPoints[r * steps + s].lat, rayPoints[r * steps + s].lng];
      }
    }
    if (lastVisible) {
      visibleEdge.push(lastVisible);
    } else {
      // Fallback: just use the system range as max
      const bearing = (r / NUM_RAYS) * 2 * Math.PI;
      visibleEdge.push(offsetLatLng(lat, lng, effectiveRange, bearing));
    }
  }

  // Close the polygon
  if (visibleEdge.length > 0) {
    visibleEdge.push(visibleEdge[0]);
  }

  // Approximate area using shoelace on lat/lng (convert to km)
  const area = computePolygonAreaKm2(visibleEdge);

  return { polygon: visibleEdge, area };
}

/** Approximate polygon area in km² using shoelace on equirectangular projection */
function computePolygonAreaKm2(points: [number, number][]): number {
  if (points.length < 3) return 0;
  const avgLat = points.reduce((s, p) => s + p[0], 0) / points.length;
  const kmPerDegLat = 111.32;
  const kmPerDegLng = 111.32 * Math.cos(degToRad(avgLat));

  let area = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const x1 = points[i][1] * kmPerDegLng;
    const y1 = points[i][0] * kmPerDegLat;
    const x2 = points[i + 1][1] * kmPerDegLng;
    const y2 = points[i + 1][0] * kmPerDegLat;
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

// ─── Leaflet icon factory ────────────────────────────────────────────────────

function createSystemIcon(
  icon: string,
  color: string,
  selected: boolean,
): L.DivIcon {
  const borderColor = selected ? "#ffffff" : color;
  const glow = selected ? `0 0 12px ${color}` : "none";
  return L.divIcon({
    html: `<div style="
      width:36px;height:36px;display:flex;align-items:center;justify-content:center;
      background:${COLORS.card};border:2px solid ${borderColor};border-radius:50%;
      font-size:18px;box-shadow:${glow};cursor:grab;
    ">${icon}</div>`,
    className: "",
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

function createRingLabel(name: string, rangeKm: number, color: string): L.DivIcon {
  return L.divIcon({
    html: `<span style="font:600 9px 'JetBrains Mono',monospace;color:${color};white-space:nowrap;pointer-events:none;background:rgba(13,17,23,0.75);padding:1px 5px;border-radius:2px;">${name} — ${rangeKm}km</span>`,
    className: "",
    iconSize: [120, 14],
    iconAnchor: [60, 7],
  });
}

// ─── Map interaction component ───────────────────────────────────────────────

function MapClickHandler({
  placingDef,
  onPlace,
}: {
  placingDef: SystemDef | null;
  onPlace: (lat: number, lng: number) => void;
}) {
  const map = useMap();

  useEffect(() => {
    if (placingDef) {
      map.getContainer().style.cursor = "crosshair";
    } else {
      map.getContainer().style.cursor = "";
    }
    return () => {
      map.getContainer().style.cursor = "";
    };
  }, [placingDef, map]);

  useMapEvents({
    click(e) {
      if (placingDef) {
        onPlace(e.latlng.lat, e.latlng.lng);
      }
    },
  });

  return null;
}

// ─── Draggable system marker ─────────────────────────────────────────────────

function DraggableSystemMarker({
  system,
  selected,
  onSelect,
  onDragEnd,
}: {
  system: PlacedSystem;
  selected: boolean;
  onSelect: () => void;
  onDragEnd: (lat: number, lng: number) => void;
}) {
  const markerRef = useRef<L.Marker>(null);
  const icon = useMemo(
    () => createSystemIcon(system.def.icon, system.def.color, selected),
    [system.def.icon, system.def.color, selected],
  );

  const eventHandlers = useMemo(
    () => ({
      click: (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        onSelect();
      },
      dragend: () => {
        const m = markerRef.current;
        if (m) {
          const pos = m.getLatLng();
          onDragEnd(pos.lat, pos.lng);
        }
      },
    }),
    [onSelect, onDragEnd],
  );

  return (
    <Marker
      ref={markerRef}
      position={[system.lat, system.lng]}
      icon={icon}
      draggable
      eventHandlers={eventHandlers}
    />
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
}

export default function BaseDefenseArchitect({ onBack }: Props) {
  const [systems, setSystems] = useState<PlacedSystem[]>([]);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [placingDef, setPlacingDef] = useState<SystemDef | null>(null);
  const [paletteFilter, setPaletteFilter] = useState<
    "all" | "sensor" | "effector" | "infrastructure"
  >("all");

  const uidCounter = useRef(0);

  const selectedSystem = useMemo(
    () => systems.find((s) => s.uid === selectedUid) ?? null,
    [systems, selectedUid],
  );

  // ─── Place a system on the map ──────────────────────────────────────────

  const handlePlace = useCallback(
    (lat: number, lng: number) => {
      if (!placingDef) return;
      const uid = `sys_${++uidCounter.current}`;
      const newSystem: PlacedSystem = {
        uid,
        def: placingDef,
        lat,
        lng,
        altitude: 10,
        viewshed: null,
        viewshedLoading: false,
        viewshedArea: null,
      };
      setSystems((prev) => [...prev, newSystem]);
      setSelectedUid(uid);
      setPlacingDef(null);

      // Fetch viewshed for non-infrastructure
      if (placingDef.range_km) {
        fetchViewshedForSystem(uid, lat, lng, 10, placingDef.range_km);
      }
    },
    [placingDef],
  );

  // ─── Fetch viewshed ────────────────────────────────────────────────────

  const fetchViewshedForSystem = useCallback(
    (uid: string, lat: number, lng: number, alt: number, rangeKm: number) => {
      const key = cacheKey(lat, lng, alt);
      const cached = viewshedCache.get(key);
      if (cached) {
        setSystems((prev) =>
          prev.map((s) =>
            s.uid === uid
              ? {
                  ...s,
                  viewshed: cached.polygon,
                  viewshedArea: cached.area,
                  viewshedLoading: false,
                }
              : s,
          ),
        );
        return;
      }

      // Mark loading
      setSystems((prev) =>
        prev.map((s) =>
          s.uid === uid ? { ...s, viewshedLoading: true } : s,
        ),
      );

      computeViewshed(lat, lng, alt, rangeKm)
        .then((result) => {
          viewshedCache.set(key, result);
          setSystems((prev) =>
            prev.map((s) =>
              s.uid === uid
                ? {
                    ...s,
                    viewshed: result.polygon,
                    viewshedArea: result.area,
                    viewshedLoading: false,
                  }
                : s,
            ),
          );
        })
        .catch((err) => {
          console.warn("Viewshed fetch failed:", err);
          // Fall back to a simple circle approximation
          const fallbackPoly: [number, number][] = [];
          for (let i = 0; i <= NUM_RAYS; i++) {
            const bearing = (i / NUM_RAYS) * 2 * Math.PI;
            fallbackPoly.push(offsetLatLng(lat, lng, rangeKm, bearing));
          }
          const area = Math.PI * rangeKm * rangeKm;
          setSystems((prev) =>
            prev.map((s) =>
              s.uid === uid
                ? {
                    ...s,
                    viewshed: fallbackPoly,
                    viewshedArea: area,
                    viewshedLoading: false,
                  }
                : s,
            ),
          );
        });
    },
    [],
  );

  // ─── Update altitude ───────────────────────────────────────────────────

  const handleAltitudeChange = useCallback(
    (uid: string, newAlt: number) => {
      setSystems((prev) =>
        prev.map((s) => (s.uid === uid ? { ...s, altitude: newAlt } : s)),
      );
      const sys = systems.find((s) => s.uid === uid);
      if (sys && sys.def.range_km) {
        fetchViewshedForSystem(uid, sys.lat, sys.lng, newAlt, sys.def.range_km);
      }
    },
    [systems, fetchViewshedForSystem],
  );

  // ─── Drag end ──────────────────────────────────────────────────────────

  const handleDragEnd = useCallback(
    (uid: string, lat: number, lng: number) => {
      setSystems((prev) =>
        prev.map((s) => (s.uid === uid ? { ...s, lat, lng } : s)),
      );
      const sys = systems.find((s) => s.uid === uid);
      if (sys && sys.def.range_km) {
        fetchViewshedForSystem(uid, lat, lng, sys.altitude, sys.def.range_km);
      }
    },
    [systems, fetchViewshedForSystem],
  );

  // ─── Delete system ─────────────────────────────────────────────────────

  const handleDelete = useCallback(
    (uid: string) => {
      setSystems((prev) => prev.filter((s) => s.uid !== uid));
      if (selectedUid === uid) setSelectedUid(null);
    },
    [selectedUid],
  );

  // ─── Aggregate coverage ────────────────────────────────────────────────

  const aggregateCoverage = useMemo(() => {
    const areas = systems
      .filter((s) => s.viewshedArea !== null && s.def.category !== "infrastructure")
      .map((s) => s.viewshedArea!);
    // Simple sum (overlaps not subtracted — would need union geometry for that)
    return areas.reduce((sum, a) => sum + a, 0);
  }, [systems]);

  const loadingSystems = systems.filter((s) => s.viewshedLoading).length;

  // ─── Filtered palette ──────────────────────────────────────────────────

  const filteredCatalog = useMemo(
    () =>
      paletteFilter === "all"
        ? SYSTEM_CATALOG
        : SYSTEM_CATALOG.filter((s) => s.category === paletteFilter),
    [paletteFilter],
  );

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: COLORS.bg,
        color: COLORS.text,
        fontFamily: "'Inter', 'JetBrains Mono', monospace",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          background: COLORS.card,
          borderBottom: `1px solid ${COLORS.border}`,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 18 }}>🏗️</span>
          <div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: 2,
                color: COLORS.warning,
              }}
            >
              BASE DEFENSE ARCHITECT
            </div>
            <div style={{ fontSize: 10, color: COLORS.muted, letterSpacing: 1 }}>
              TERRAIN-AWARE COVERAGE PLANNER
              {placingDef && (
                <span style={{ color: COLORS.accent, marginLeft: 12 }}>
                  PLACING: {placingDef.name} — click map to place
                </span>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: 1,
              padding: "3px 8px",
              borderRadius: 4,
              background: `${COLORS.warning}20`,
              color: COLORS.warning,
            }}
          >
            BETA
          </span>
        </div>
      </div>

      {/* Main 3-column layout */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Left panel — Palette */}
        <div
          style={{
            width: 260,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            borderRight: `1px solid ${COLORS.border}`,
            background: COLORS.card,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "10px 12px 8px",
              borderBottom: `1px solid ${COLORS.border}`,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 1.5,
                color: COLORS.muted,
                marginBottom: 8,
              }}
            >
              EQUIPMENT PALETTE
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              {(
                [
                  ["all", "ALL"],
                  ["sensor", "SENSORS"],
                  ["effector", "EFFECTORS"],
                  ["infrastructure", "INFRA"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setPaletteFilter(key)}
                  style={{
                    flex: 1,
                    padding: "4px 0",
                    fontSize: 9,
                    fontWeight: 600,
                    letterSpacing: 0.5,
                    border: `1px solid ${paletteFilter === key ? COLORS.accent : COLORS.border}`,
                    borderRadius: 4,
                    background:
                      paletteFilter === key ? `${COLORS.accent}18` : "transparent",
                    color: paletteFilter === key ? COLORS.accent : COLORS.muted,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "8px 10px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {filteredCatalog.map((def) => {
              const isPlacing = placingDef?.id === def.id;
              return (
                <button
                  key={def.id}
                  onClick={() => setPlacingDef(isPlacing ? null : def)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 10px",
                    background: isPlacing ? `${def.color}18` : COLORS.bg,
                    border: `1px solid ${isPlacing ? def.color : COLORS.border}`,
                    borderRadius: 6,
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: "inherit",
                    transition: "all 0.1s",
                    width: "100%",
                  }}
                  onMouseEnter={(e) => {
                    if (!isPlacing) {
                      (e.currentTarget as HTMLElement).style.borderColor = def.color;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isPlacing) {
                      (e.currentTarget as HTMLElement).style.borderColor = COLORS.border;
                    }
                  }}
                >
                  <span style={{ fontSize: 20, flexShrink: 0 }}>{def.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: isPlacing ? def.color : COLORS.text,
                        letterSpacing: 0.3,
                      }}
                    >
                      {def.name}
                    </div>
                    <div
                      style={{
                        fontSize: 9,
                        color: COLORS.muted,
                        marginTop: 2,
                      }}
                    >
                      {def.description}
                    </div>
                  </div>
                  {def.category !== "infrastructure" && (
                    <div
                      style={{
                        fontSize: 8,
                        fontWeight: 700,
                        color: def.color,
                        letterSpacing: 0.5,
                        flexShrink: 0,
                      }}
                    >
                      {def.category.toUpperCase().slice(0, 3)}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Placed systems count */}
          <div
            style={{
              padding: "8px 12px",
              borderTop: `1px solid ${COLORS.border}`,
              fontSize: 10,
              color: COLORS.muted,
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>
              {systems.length} system{systems.length !== 1 ? "s" : ""} placed
            </span>
            <span>
              {systems.filter((s) => s.def.category === "sensor").length}S /{" "}
              {systems.filter((s) => s.def.category === "effector").length}E /{" "}
              {systems.filter((s) => s.def.category === "infrastructure").length}I
            </span>
          </div>
        </div>

        {/* Center — Map */}
        <div style={{ flex: 1, position: "relative" }}>
          <MapContainer
            center={[SHAW_AFB.lat, SHAW_AFB.lng]}
            zoom={DEFAULT_ZOOM}
            style={{ width: "100%", height: "100%" }}
            zoomControl={false}
          >
            <ScaleControl position="bottomleft" />
            <LayersControl position="topright">
              <LayersControl.BaseLayer name="Dark" checked>
                <TileLayer
                  url="https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                  maxZoom={20}
                />
              </LayersControl.BaseLayer>
              <LayersControl.BaseLayer name="Satellite">
                <TileLayer
                  url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                  maxZoom={19}
                />
              </LayersControl.BaseLayer>
              <LayersControl.BaseLayer name="Topo">
                <TileLayer
                  url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
                  maxZoom={17}
                />
              </LayersControl.BaseLayer>
            </LayersControl>

            <MapClickHandler placingDef={placingDef} onPlace={handlePlace} />

            {/* Viewshed polygons */}
            {systems.map(
              (sys) =>
                sys.viewshed && (
                  <Polygon
                    key={`vs-${sys.uid}`}
                    positions={sys.viewshed}
                    pathOptions={{
                      color: sys.def.color,
                      fillColor: sys.def.color,
                      fillOpacity: selectedUid === sys.uid ? 0.2 : 0.1,
                      weight: selectedUid === sys.uid ? 2 : 1,
                      dashArray: "4,4",
                    }}
                  />
                ),
            )}

            {/* Range rings for systems without viewshed yet */}
            {systems.map(
              (sys) =>
                sys.def.range_km &&
                !sys.viewshed && (
                  <Circle
                    key={`rr-${sys.uid}`}
                    center={[sys.lat, sys.lng]}
                    radius={sys.def.range_km * 1000}
                    pathOptions={{
                      color: sys.def.color,
                      fillColor: sys.def.color,
                      fillOpacity: 0.06,
                      weight: 1,
                      dashArray: "6,4",
                    }}
                  />
                ),
            )}

            {/* Range ring labels */}
            {systems.map(
              (sys) =>
                sys.def.range_km && (
                  <Marker
                    key={`rl-${sys.uid}`}
                    position={[
                      sys.lat + sys.def.range_km / 111.32,
                      sys.lng,
                    ]}
                    icon={createRingLabel(
                      sys.def.name.split("(")[0].trim(),
                      sys.def.range_km,
                      sys.def.color,
                    )}
                    interactive={false}
                  />
                ),
            )}

            {/* System markers */}
            {systems.map((sys) => (
              <DraggableSystemMarker
                key={sys.uid}
                system={sys}
                selected={selectedUid === sys.uid}
                onSelect={() => setSelectedUid(sys.uid)}
                onDragEnd={(lat, lng) => handleDragEnd(sys.uid, lat, lng)}
              />
            ))}
          </MapContainer>

          {/* Loading indicator */}
          {loadingSystems > 0 && (
            <div
              style={{
                position: "absolute",
                top: 10,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 1000,
                background: `${COLORS.card}ee`,
                border: `1px solid ${COLORS.warning}`,
                borderRadius: 6,
                padding: "8px 16px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 11,
                fontWeight: 600,
                color: COLORS.warning,
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 12,
                  height: 12,
                  border: `2px solid ${COLORS.warning}40`,
                  borderTop: `2px solid ${COLORS.warning}`,
                  borderRadius: "50%",
                  animation: "bda-spin 0.8s linear infinite",
                }}
              />
              Computing viewshed ({loadingSystems} remaining)...
            </div>
          )}

          {/* Spinner animation */}
          <style>{`
            @keyframes bda-spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
        </div>

        {/* Right panel — Detail */}
        <div
          style={{
            width: 280,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            borderLeft: `1px solid ${COLORS.border}`,
            background: COLORS.card,
            overflow: "hidden",
          }}
        >
          {selectedSystem ? (
            <>
              {/* System header */}
              <div
                style={{
                  padding: "14px 14px 10px",
                  borderBottom: `1px solid ${COLORS.border}`,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 6,
                  }}
                >
                  <span style={{ fontSize: 22 }}>{selectedSystem.def.icon}</span>
                  <div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: selectedSystem.def.color,
                        letterSpacing: 0.5,
                      }}
                    >
                      {selectedSystem.def.name}
                    </div>
                    <div style={{ fontSize: 10, color: COLORS.muted }}>
                      {selectedSystem.def.category.toUpperCase()} —{" "}
                      {selectedSystem.def.type}
                    </div>
                  </div>
                </div>
              </div>

              {/* Position */}
              <div style={{ padding: "10px 14px", borderBottom: `1px solid ${COLORS.border}` }}>
                <div
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: 1.5,
                    color: COLORS.muted,
                    marginBottom: 6,
                  }}
                >
                  POSITION
                </div>
                <div style={{ fontSize: 11, color: COLORS.text, fontFamily: "'JetBrains Mono', monospace" }}>
                  {selectedSystem.lat.toFixed(5)}°N, {Math.abs(selectedSystem.lng).toFixed(5)}°{selectedSystem.lng < 0 ? "W" : "E"}
                </div>
              </div>

              {/* Altitude */}
              {selectedSystem.def.category !== "infrastructure" && (
                <div
                  style={{
                    padding: "10px 14px",
                    borderBottom: `1px solid ${COLORS.border}`,
                  }}
                >
                  <div
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: 1.5,
                      color: COLORS.muted,
                      marginBottom: 8,
                    }}
                  >
                    ALTITUDE (METERS AGL)
                  </div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                    {ALTITUDE_PRESETS.map((a) => (
                      <button
                        key={a}
                        onClick={() =>
                          handleAltitudeChange(selectedSystem.uid, a)
                        }
                        style={{
                          flex: 1,
                          padding: "6px 0",
                          fontSize: 11,
                          fontWeight: 600,
                          border: `1px solid ${selectedSystem.altitude === a ? COLORS.accent : COLORS.border}`,
                          borderRadius: 4,
                          background:
                            selectedSystem.altitude === a
                              ? `${COLORS.accent}18`
                              : "transparent",
                          color:
                            selectedSystem.altitude === a
                              ? COLORS.accent
                              : COLORS.muted,
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        {a}m
                      </button>
                    ))}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="range"
                      min={1}
                      max={100}
                      value={selectedSystem.altitude}
                      onChange={(e) =>
                        handleAltitudeChange(
                          selectedSystem.uid,
                          parseInt(e.target.value),
                        )
                      }
                      style={{
                        flex: 1,
                        accentColor: COLORS.accent,
                      }}
                    />
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={selectedSystem.altitude}
                      onChange={(e) => {
                        const v = parseInt(e.target.value);
                        if (v >= 1 && v <= 100) {
                          handleAltitudeChange(selectedSystem.uid, v);
                        }
                      }}
                      style={{
                        width: 50,
                        padding: "4px 6px",
                        fontSize: 11,
                        fontWeight: 600,
                        background: COLORS.bg,
                        border: `1px solid ${COLORS.border}`,
                        borderRadius: 4,
                        color: COLORS.text,
                        textAlign: "center",
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Coverage stats */}
              {selectedSystem.def.range_km && (
                <div
                  style={{
                    padding: "10px 14px",
                    borderBottom: `1px solid ${COLORS.border}`,
                  }}
                >
                  <div
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: 1.5,
                      color: COLORS.muted,
                      marginBottom: 8,
                    }}
                  >
                    COVERAGE
                  </div>
                  {selectedSystem.viewshedLoading ? (
                    <div
                      style={{
                        fontSize: 11,
                        color: COLORS.warning,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <span
                        style={{
                          display: "inline-block",
                          width: 10,
                          height: 10,
                          border: `2px solid ${COLORS.warning}40`,
                          borderTop: `2px solid ${COLORS.warning}`,
                          borderRadius: "50%",
                          animation: "bda-spin 0.8s linear infinite",
                        }}
                      />
                      Computing viewshed...
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 10, color: COLORS.muted }}>
                          Viewshed area
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: COLORS.text,
                            fontFamily: "'JetBrains Mono', monospace",
                          }}
                        >
                          {selectedSystem.viewshedArea
                            ? `${selectedSystem.viewshedArea.toFixed(1)} km²`
                            : "—"}
                        </span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 10, color: COLORS.muted }}>
                          Max range
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: selectedSystem.def.color,
                            fontFamily: "'JetBrains Mono', monospace",
                          }}
                        >
                          {selectedSystem.def.range_km} km
                        </span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 10, color: COLORS.muted }}>
                          FOV
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: COLORS.text,
                            fontFamily: "'JetBrains Mono', monospace",
                          }}
                        >
                          {selectedSystem.def.fov_deg}°
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* System info */}
              <div style={{ padding: "10px 14px", flex: 1 }}>
                <div
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: 1.5,
                    color: COLORS.muted,
                    marginBottom: 6,
                  }}
                >
                  SYSTEM INFO
                </div>
                <div style={{ fontSize: 11, color: COLORS.muted, lineHeight: 1.6 }}>
                  {selectedSystem.def.description}
                </div>
              </div>

              {/* Delete */}
              <div
                style={{
                  padding: "10px 14px",
                  borderTop: `1px solid ${COLORS.border}`,
                }}
              >
                <button
                  onClick={() => handleDelete(selectedSystem.uid)}
                  style={{
                    width: "100%",
                    padding: "8px 0",
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: 1,
                    background: `${COLORS.danger}18`,
                    border: `1px solid ${COLORS.danger}50`,
                    borderRadius: 5,
                    color: COLORS.danger,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    transition: "all 0.1s",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = `${COLORS.danger}30`;
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = `${COLORS.danger}18`;
                  }}
                >
                  DELETE SYSTEM
                </button>
              </div>
            </>
          ) : (
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: 24,
                gap: 12,
              }}
            >
              <div style={{ fontSize: 32, opacity: 0.3 }}>🎯</div>
              <div
                style={{
                  fontSize: 11,
                  color: COLORS.muted,
                  textAlign: "center",
                  lineHeight: 1.6,
                }}
              >
                Select a system on the palette, then click the map to place it.
                <br />
                <br />
                Click a placed system to view details and adjust altitude.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 16px",
          background: COLORS.card,
          borderTop: `1px solid ${COLORS.border}`,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ fontSize: 10, color: COLORS.muted }}>
            <span style={{ fontWeight: 700, letterSpacing: 1 }}>
              AGGREGATE COVERAGE:
            </span>{" "}
            <span
              style={{
                fontWeight: 700,
                color: aggregateCoverage > 0 ? COLORS.success : COLORS.muted,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12,
              }}
            >
              {aggregateCoverage.toFixed(1)} km²
            </span>
          </div>
          {loadingSystems > 0 && (
            <div style={{ fontSize: 10, color: COLORS.warning }}>
              {loadingSystems} viewshed{loadingSystems > 1 ? "s" : ""} loading...
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => {
              setSystems([]);
              setSelectedUid(null);
            }}
            style={{
              padding: "6px 16px",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 1,
              background: "transparent",
              border: `1px solid ${COLORS.border}`,
              borderRadius: 5,
              color: COLORS.muted,
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "all 0.1s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = COLORS.danger;
              (e.currentTarget as HTMLElement).style.color = COLORS.danger;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = COLORS.border;
              (e.currentTarget as HTMLElement).style.color = COLORS.muted;
            }}
          >
            CLEAR ALL
          </button>
          <button
            onClick={onBack}
            style={{
              padding: "6px 16px",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 1,
              background: "transparent",
              border: `1px solid ${COLORS.border}`,
              borderRadius: 5,
              color: COLORS.muted,
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "all 0.1s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = COLORS.accent;
              (e.currentTarget as HTMLElement).style.color = COLORS.accent;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = COLORS.border;
              (e.currentTarget as HTMLElement).style.color = COLORS.muted;
            }}
          >
            BACK TO MENU
          </button>
        </div>
      </div>
    </div>
  );
}
