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
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// ─── Constants ───────────────────────────────────────────────────────────────

const SHAW_AFB = { lat: 33.9722, lng: -80.4756 };
const DEFAULT_ZOOM = 14;

const COLORS = {
  bg: "#0a0e1a",
  card: "#0f1520",
  border: "#1a2235",
  text: "#e6edf3",
  muted: "#6b7b8d",
  accent: "#00d4ff",
  danger: "#ff4d4d",
  warning: "#d29922",
  success: "#3fb950",
  purple: "#a371f7",
};

const ALTITUDE_PRESETS: { value: number; label: string }[] = [
  { value: 2, label: "2m Ground" },
  { value: 10, label: "10m Mast" },
  { value: 30, label: "30m Tower" },
];

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
  letter: string;
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
    letter: "R",
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
    letter: "S",
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
    letter: "E",
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
    letter: "A",
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
    letter: "J",
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
    letter: "J",
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
    letter: "L",
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
    letter: "C",
    description: "Tactical operations center",
  },
  {
    id: "main_gate",
    name: "Main Gate",
    category: "infrastructure",
    type: "structure",
    color: "#8b949e",
    icon: "🚧",
    letter: "G",
    description: "Primary entry control point",
  },
  {
    id: "fuel_depot",
    name: "Fuel Depot",
    category: "infrastructure",
    type: "structure",
    color: "#8b949e",
    icon: "⛽",
    letter: "F",
    description: "Fuel storage facility",
  },
  {
    id: "barracks",
    name: "Barracks",
    category: "infrastructure",
    type: "structure",
    color: "#8b949e",
    icon: "🏠",
    letter: "B",
    description: "Personnel housing",
  },
  {
    id: "comms_tower",
    name: "Comms Tower",
    category: "infrastructure",
    type: "structure",
    color: "#8b949e",
    icon: "📶",
    letter: "T",
    description: "Communications relay tower",
  },
];

// ─── Placed system type ──────────────────────────────────────────────────────

interface ViewshedStats {
  totalCells: number;
  visibleCells: number;
  blockedCells: number;
  coveragePercent: number;
  sensorElevation: number;
  minElevation: number;
  maxElevation: number;
}

interface PlacedSystem {
  uid: string;
  def: SystemDef;
  lat: number;
  lng: number;
  altitude: number; // meters
  viewshed: [number, number][] | null; // visible polygon points
  blockedSectors: [number, number][][] | null; // blocked area polygons
  viewshedLoading: boolean;
  viewshedArea: number | null; // km²
  viewshedStats: ViewshedStats | null;
}

// ─── Viewshed computation ────────────────────────────────────────────────────

const viewshedCache = new Map<
  string,
  {
    polygon: [number, number][];
    blockedSectors: [number, number][][];
    area: number;
    stats: ViewshedStats;
  }
>();

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

/** Compute viewshed polygon with blocked areas and terrain stats */
async function computeViewshed(
  lat: number,
  lng: number,
  altitudeM: number,
  rangeKm: number,
): Promise<{
  polygon: [number, number][];
  blockedSectors: [number, number][][];
  area: number;
  stats: ViewshedStats;
}> {
  const effectiveRange = Math.min(rangeKm, MAX_RANGE_KM);
  const steps = Math.ceil(effectiveRange / STEP_KM);

  // Build all sample points: center + rays
  const allPoints: { latitude: number; longitude: number }[] = [
    { latitude: lat, longitude: lng },
  ];
  const rayPoints: { ray: number; step: number; lat: number; lng: number }[] =
    [];

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

  // Track terrain stats
  let minElev = Infinity;
  let maxElev = -Infinity;
  for (let i = 1; i < elevations.length; i++) {
    if (elevations[i] < minElev) minElev = elevations[i];
    if (elevations[i] > maxElev) maxElev = elevations[i];
  }

  // For each ray, walk outward and track visible/blocked cells
  const visibleEdge: [number, number][] = [];
  const blockedSectors: [number, number][][] = [];
  let totalCells = 0;
  let visibleCells = 0;

  for (let r = 0; r < NUM_RAYS; r++) {
    let maxAngle = -Infinity;
    let lastVisible: [number, number] | null = null;
    let firstBlocked: [number, number] | null = null;
    const bearing = (r / NUM_RAYS) * 2 * Math.PI;
    const nextBearing = ((r + 1) / NUM_RAYS) * 2 * Math.PI;

    for (let s = 0; s < steps; s++) {
      totalCells++;
      const idx = 1 + r * steps + s;
      const dist = (s + 1) * STEP_KM;
      const elev = elevations[idx];
      const angle = (elev - centerElev) / (dist * 1000);

      if (angle >= maxAngle) {
        maxAngle = angle;
        lastVisible = [
          rayPoints[r * steps + s].lat,
          rayPoints[r * steps + s].lng,
        ];
        visibleCells++;
        // If we had a blocked region starting, close it
        if (firstBlocked) {
          firstBlocked = null;
        }
      } else {
        // This cell is blocked
        if (!firstBlocked) {
          firstBlocked = [
            rayPoints[r * steps + s].lat,
            rayPoints[r * steps + s].lng,
          ];
        }
      }
    }

    if (lastVisible) {
      visibleEdge.push(lastVisible);
    } else {
      visibleEdge.push(offsetLatLng(lat, lng, effectiveRange, bearing));
    }

    // Generate blocked sector: area between lastVisible edge and max range
    if (lastVisible) {
      const lastVisibleDist = lastVisible
        ? Math.sqrt(
            Math.pow((lastVisible[0] - lat) * 111.32, 2) +
              Math.pow(
                (lastVisible[1] - lng) *
                  111.32 *
                  Math.cos(degToRad(lat)),
                2,
              ),
          )
        : 0;
      if (lastVisibleDist < effectiveRange * 0.95) {
        // There's blocked area beyond the visible edge
        const sector: [number, number][] = [lastVisible];
        // Arc at visible edge to next ray
        const nextR = (r + 1) % NUM_RAYS;
        const nextLastIdx = 1 + nextR * steps + (steps - 1);
        const nextRayEnd: [number, number] = [
          rayPoints[Math.min(nextR * steps + steps - 1, rayPoints.length - 1)]
            ?.lat ?? lat,
          rayPoints[Math.min(nextR * steps + steps - 1, rayPoints.length - 1)]
            ?.lng ?? lng,
        ];
        // Outer edge
        sector.push(offsetLatLng(lat, lng, effectiveRange, bearing));
        sector.push(offsetLatLng(lat, lng, effectiveRange, nextBearing));
        // If next ray also has a visible edge, connect to it
        if (nextLastIdx < elevations.length) {
          sector.push(nextRayEnd);
        }
        sector.push(lastVisible); // close
        if (sector.length >= 4) {
          blockedSectors.push(sector);
        }
      }
    }
  }

  // Close the polygon
  if (visibleEdge.length > 0) {
    visibleEdge.push(visibleEdge[0]);
  }

  const area = computePolygonAreaKm2(visibleEdge);
  const blockedCells = totalCells - visibleCells;
  const coveragePercent =
    totalCells > 0 ? (visibleCells / totalCells) * 100 : 0;

  return {
    polygon: visibleEdge,
    blockedSectors,
    area,
    stats: {
      totalCells,
      visibleCells,
      blockedCells,
      coveragePercent,
      sensorElevation: elevations[0] + altitudeM,
      minElevation: minElev === Infinity ? 0 : minElev,
      maxElevation: maxElev === -Infinity ? 0 : maxElev,
    },
  };
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
  letter: string,
  _color: string,
  selected: boolean,
): L.DivIcon {
  const bgColor = selected ? "#1a8fff" : "#2563eb";
  const borderColor = selected ? "#ffffff" : "#3b82f6";
  const glow = selected ? "0 0 12px rgba(59,130,246,0.6)" : "none";
  return L.divIcon({
    html: `<div style="
      width:32px;height:32px;display:flex;align-items:center;justify-content:center;
      background:${bgColor};border:2px solid ${borderColor};border-radius:50%;
      font-size:14px;font-weight:700;color:#fff;box-shadow:${glow};cursor:grab;
      font-family:'Inter','JetBrains Mono',monospace;letter-spacing:0.5px;
    ">${letter}</div>`,
    className: "",
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

function createRingLabel(
  name: string,
  rangeKm: number,
  color: string,
): L.DivIcon {
  return L.divIcon({
    html: `<span style="font:600 9px 'JetBrains Mono',monospace;color:${color};white-space:nowrap;pointer-events:none;background:rgba(10,14,26,0.75);padding:1px 5px;border-radius:2px;">${name} — ${rangeKm}km</span>`,
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
    () => createSystemIcon(system.def.letter, system.def.color, selected),
    [system.def.letter, system.def.color, selected],
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

// ─── Section header component ────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 2,
        color: COLORS.accent,
        marginBottom: 10,
        paddingBottom: 6,
        borderBottom: `1px solid ${COLORS.border}`,
      }}
    >
      {title}
    </div>
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
        blockedSectors: null,
        viewshedLoading: false,
        viewshedArea: null,
        viewshedStats: null,
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
                  blockedSectors: cached.blockedSectors,
                  viewshedArea: cached.area,
                  viewshedStats: cached.stats,
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
                    blockedSectors: result.blockedSectors,
                    viewshedArea: result.area,
                    viewshedStats: result.stats,
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
                    blockedSectors: [],
                    viewshedArea: area,
                    viewshedStats: null,
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

  // ─── Recalculate viewshed ─────────────────────────────────────────────

  const handleRecalculate = useCallback(
    (uid: string) => {
      const sys = systems.find((s) => s.uid === uid);
      if (sys && sys.def.range_km) {
        // Clear cache for this position
        const key = cacheKey(sys.lat, sys.lng, sys.altitude);
        viewshedCache.delete(key);
        fetchViewshedForSystem(
          uid,
          sys.lat,
          sys.lng,
          sys.altitude,
          sys.def.range_km,
        );
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
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <button
            onClick={onBack}
            style={{
              padding: "4px 12px",
              fontSize: 11,
              fontWeight: 600,
              background: "transparent",
              border: `1px solid ${COLORS.border}`,
              borderRadius: 4,
              color: COLORS.muted,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            &lt; BACK
          </button>
          <div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: 2,
                color: COLORS.text,
              }}
            >
              BASE DEFENSE ARCHITECT
            </div>
            <div style={{ fontSize: 10, color: COLORS.muted, letterSpacing: 0.5 }}>
              Viewshed Analysis — Terrain-aware sensor coverage
              {placingDef && (
                <span style={{ color: COLORS.accent, marginLeft: 12 }}>
                  PLACING: {placingDef.name} — click map to place
                </span>
              )}
            </div>
          </div>
        </div>
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
                      (e.currentTarget as HTMLElement).style.borderColor =
                        def.color;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isPlacing) {
                      (e.currentTarget as HTMLElement).style.borderColor =
                        COLORS.border;
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
              {systems.filter((s) => s.def.category === "infrastructure").length}
              I
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
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              attribution="Tiles &copy; Esri"
              maxZoom={19}
            />

            <MapClickHandler placingDef={placingDef} onPlace={handlePlace} />

            {/* Viewshed polygons — green for visible */}
            {systems.map(
              (sys) =>
                sys.viewshed && (
                  <Polygon
                    key={`vs-${sys.uid}`}
                    positions={sys.viewshed}
                    pathOptions={{
                      color: COLORS.success,
                      fillColor: COLORS.success,
                      fillOpacity: selectedUid === sys.uid ? 0.25 : 0.15,
                      weight: selectedUid === sys.uid ? 2 : 1,
                    }}
                  />
                ),
            )}

            {/* Blocked sectors — red */}
            {systems.map((sys) =>
              sys.blockedSectors?.map((sector, i) => (
                <Polygon
                  key={`bl-${sys.uid}-${i}`}
                  positions={sector}
                  pathOptions={{
                    color: COLORS.danger,
                    fillColor: COLORS.danger,
                    fillOpacity: selectedUid === sys.uid ? 0.2 : 0.1,
                    weight: 0,
                  }}
                />
              )),
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
            overflowY: "auto",
          }}
        >
          {selectedSystem ? (
            <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
              {/* SENSOR section */}
              <div style={{ padding: "14px 14px 12px" }}>
                <SectionHeader title="SENSOR" />
                <div
                  style={{
                    fontSize: 11,
                    color: COLORS.text,
                    fontFamily: "'JetBrains Mono', monospace",
                    marginBottom: 4,
                  }}
                >
                  {selectedSystem.lat.toFixed(6)},{" "}
                  {selectedSystem.lng.toFixed(6)}
                </div>
                <div style={{ fontSize: 10, color: COLORS.muted }}>
                  Height AGL: {selectedSystem.altitude}m
                </div>
              </div>

              {/* Altitude slider */}
              {selectedSystem.def.category !== "infrastructure" && (
                <div
                  style={{
                    padding: "0 14px 14px",
                  }}
                >
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
                      width: "100%",
                      accentColor: COLORS.accent,
                      marginBottom: 8,
                    }}
                  />
                  <div style={{ display: "flex", gap: 6 }}>
                    {ALTITUDE_PRESETS.map((preset) => (
                      <button
                        key={preset.value}
                        onClick={() =>
                          handleAltitudeChange(selectedSystem.uid, preset.value)
                        }
                        style={{
                          flex: 1,
                          padding: "6px 4px",
                          fontSize: 10,
                          fontWeight: 600,
                          border: `1px solid ${selectedSystem.altitude === preset.value ? COLORS.accent : COLORS.border}`,
                          borderRadius: 4,
                          background:
                            selectedSystem.altitude === preset.value
                              ? `${COLORS.accent}22`
                              : "transparent",
                          color:
                            selectedSystem.altitude === preset.value
                              ? COLORS.accent
                              : COLORS.muted,
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* VIEWSHED section */}
              {selectedSystem.def.range_km && (
                <div
                  style={{
                    padding: "14px",
                    borderTop: `1px solid ${COLORS.border}`,
                  }}
                >
                  <SectionHeader title="VIEWSHED" />
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
                    <>
                      {/* Big coverage % */}
                      <div style={{ textAlign: "center", marginBottom: 12 }}>
                        <div
                          style={{
                            fontSize: 36,
                            fontWeight: 700,
                            color: COLORS.accent,
                            fontFamily: "'JetBrains Mono', monospace",
                            lineHeight: 1,
                          }}
                        >
                          {selectedSystem.viewshedStats
                            ? `${selectedSystem.viewshedStats.coveragePercent.toFixed(1)}%`
                            : "—"}
                        </div>
                        <div
                          style={{
                            fontSize: 10,
                            color: COLORS.muted,
                            marginTop: 4,
                          }}
                        >
                          Coverage
                        </div>
                      </div>

                      {/* Stats grid */}
                      {selectedSystem.viewshedStats && (
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr",
                            gap: "6px 12px",
                            marginBottom: 12,
                            fontSize: 10,
                          }}
                        >
                          <div style={{ color: COLORS.muted }}>Total cells</div>
                          <div
                            style={{
                              textAlign: "right",
                              fontFamily: "'JetBrains Mono', monospace",
                              color: COLORS.text,
                              fontWeight: 600,
                            }}
                          >
                            {selectedSystem.viewshedStats.totalCells}
                          </div>
                          <div style={{ color: COLORS.muted }}>Visible</div>
                          <div
                            style={{
                              textAlign: "right",
                              fontFamily: "'JetBrains Mono', monospace",
                              color: COLORS.success,
                              fontWeight: 600,
                            }}
                          >
                            {selectedSystem.viewshedStats.visibleCells}
                          </div>
                          <div style={{ color: COLORS.muted }}>Blocked</div>
                          <div
                            style={{
                              textAlign: "right",
                              fontFamily: "'JetBrains Mono', monospace",
                              color: COLORS.danger,
                              fontWeight: 600,
                            }}
                          >
                            {selectedSystem.viewshedStats.blockedCells}
                          </div>
                        </div>
                      )}

                      {/* Recalculate button */}
                      <button
                        onClick={() => handleRecalculate(selectedSystem.uid)}
                        style={{
                          width: "100%",
                          padding: "8px 0",
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: 1,
                          background: COLORS.bg,
                          border: `1px solid ${COLORS.border}`,
                          borderRadius: 5,
                          color: COLORS.text,
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        RECALCULATE
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* TERRAIN INFO section */}
              {selectedSystem.viewshedStats && (
                <div
                  style={{
                    padding: "14px",
                    borderTop: `1px solid ${COLORS.border}`,
                  }}
                >
                  <SectionHeader title="TERRAIN INFO" />
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "6px 12px",
                      fontSize: 10,
                    }}
                  >
                    <div style={{ color: COLORS.muted }}>Sensor elev</div>
                    <div
                      style={{
                        textAlign: "right",
                        fontFamily: "'JetBrains Mono', monospace",
                        color: COLORS.text,
                        fontWeight: 600,
                      }}
                    >
                      {Math.round(selectedSystem.viewshedStats.sensorElevation)}m
                    </div>
                    <div style={{ color: COLORS.muted }}>Min elev</div>
                    <div
                      style={{
                        textAlign: "right",
                        fontFamily: "'JetBrains Mono', monospace",
                        color: COLORS.text,
                        fontWeight: 600,
                      }}
                    >
                      {Math.round(selectedSystem.viewshedStats.minElevation)}m
                    </div>
                    <div style={{ color: COLORS.muted }}>Max elev</div>
                    <div
                      style={{
                        textAlign: "right",
                        fontFamily: "'JetBrains Mono', monospace",
                        color: COLORS.text,
                        fontWeight: 600,
                      }}
                    >
                      {Math.round(selectedSystem.viewshedStats.maxElevation)}m
                    </div>
                    <div style={{ color: COLORS.muted }}>Relief</div>
                    <div
                      style={{
                        textAlign: "right",
                        fontFamily: "'JetBrains Mono', monospace",
                        color: COLORS.text,
                        fontWeight: 600,
                      }}
                    >
                      {Math.round(
                        selectedSystem.viewshedStats.maxElevation -
                          selectedSystem.viewshedStats.minElevation,
                      )}
                      m
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 8,
                      color: COLORS.muted,
                      marginTop: 10,
                      opacity: 0.6,
                    }}
                  >
                    SRTM 30m via Open-Elevation
                  </div>
                </div>
              )}

              {/* Spacer */}
              <div style={{ flex: 1 }} />

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
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 1,
                    background: `${COLORS.danger}18`,
                    border: `1px solid ${COLORS.danger}50`,
                    borderRadius: 5,
                    color: COLORS.danger,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    marginBottom: 8,
                  }}
                >
                  DELETE SYSTEM
                </button>

                {/* Export button */}
                <button
                  disabled
                  style={{
                    width: "100%",
                    padding: "10px 0",
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: 1,
                    background: COLORS.bg,
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: 5,
                    color: COLORS.muted,
                    cursor: "not-allowed",
                    fontFamily: "inherit",
                    opacity: 0.6,
                  }}
                >
                  EXPORT TO MISSION
                </button>
                <div
                  style={{
                    fontSize: 9,
                    color: COLORS.muted,
                    textAlign: "center",
                    marginTop: 4,
                    opacity: 0.5,
                  }}
                >
                  Coming soon
                </div>
              </div>
            </div>
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
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: "50%",
                  border: `2px solid ${COLORS.border}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 20,
                  color: COLORS.muted,
                  opacity: 0.4,
                }}
              >
                +
              </div>
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
    </div>
  );
}
