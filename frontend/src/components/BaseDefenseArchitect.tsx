import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Circle,
  Polygon,
  Marker,
  Rectangle,
  useMap,
  useMapEvents,
  ScaleControl,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type {
  EquipmentCatalog,
  BaseInfo,
  PlacementConfig,
} from "../types";
import { latLngToGameXY } from "../utils/coordinates";

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

const TYPE_COLORS: Record<string, string> = {
  radar: "#388bfd",
  eoir: "#e3b341",
  electronic: "#00bfbf",
  kinetic: "#f85149",
  rf: "#bc8cff",
  shenobi_pm: "#bc8cff",
};

// ─── Altitude band presets ───────────────────────────────────────────────────

interface AltitudeBand {
  label: string;
  color: string;
  icon: string;
  presets: { value: number; label: string }[];
}

const ALTITUDE_BANDS: AltitudeBand[] = [
  {
    label: "LOW",
    color: "#3fb950",
    icon: "🟢",
    presets: [
      { value: 10, label: "10m" },
      { value: 25, label: "25m" },
      { value: 50, label: "50m" },
    ],
  },
  {
    label: "MED",
    color: "#d29922",
    icon: "🟡",
    presets: [
      { value: 100, label: "100m" },
      { value: 200, label: "200m" },
      { value: 300, label: "300m" },
    ],
  },
  {
    label: "HIGH",
    color: "#f85149",
    icon: "🔴",
    presets: [
      { value: 500, label: "500m" },
      { value: 1000, label: "1km" },
      { value: 2000, label: "2km" },
    ],
  },
];

function getAltitudeBand(altM: number): AltitudeBand {
  if (altM <= 50) return ALTITUDE_BANDS[0];
  if (altM <= 300) return ALTITUDE_BANDS[1];
  return ALTITUDE_BANDS[2];
}

function getAltitudeBandLabel(altM: number): string {
  const band = getAltitudeBand(altM);
  if (band.label === "LOW") return "Ground vehicles / low drones";
  if (band.label === "MED") return "Tactical drones / helicopters";
  return "Fixed-wing / high-altitude";
}

// ─── Unified system definition (built from catalog.json) ─────────────────────

interface SystemDef {
  id: string;
  name: string;
  category: "sensor" | "effector" | "combined";
  type: string;
  range_km: number;
  sensor_range_km?: number;
  effector_range_km?: number;
  fov_deg: number;
  color: string;
  letter: string;
  description: string;
  requires_los: boolean;
}

function buildSystemDefs(catalog: EquipmentCatalog): SystemDef[] {
  const defs: SystemDef[] = [];

  for (const s of catalog.sensors) {
    defs.push({
      id: s.catalog_id,
      name: s.name,
      category: "sensor",
      type: s.type,
      range_km: s.range_km,
      fov_deg: s.fov_deg,
      color: TYPE_COLORS[s.type] || COLORS.muted,
      letter: s.catalog_id === "tpq51" ? "L" : s.catalog_id === "kufcs" ? "K" : "E",
      description: s.description,
      requires_los: s.requires_los,
    });
  }

  for (const e of catalog.effectors) {
    defs.push({
      id: e.catalog_id,
      name: e.name,
      category: "effector",
      type: e.type,
      range_km: e.range_km,
      fov_deg: e.fov_deg,
      color: TYPE_COLORS[e.type] || COLORS.muted,
      letter: e.catalog_id === "rf_jammer" ? "R" : "J",
      description: e.description,
      requires_los: e.requires_los,
    });
  }

  for (const c of catalog.combined || []) {
    defs.push({
      id: c.catalog_id,
      name: c.name,
      category: "combined",
      type: c.sensor_type,
      range_km: c.sensor_range_km,
      sensor_range_km: c.sensor_range_km,
      effector_range_km: c.effector_range_km,
      fov_deg: c.fov_deg,
      color: TYPE_COLORS[c.sensor_type] || "#bc8cff",
      letter: "S",
      description: c.description,
      requires_los: c.requires_los,
    });
  }

  return defs;
}

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
  altitude: number;
  facing_deg: number;
  viewshed: [number, number][] | null;
  blockedSectors: [number, number][][] | null;
  viewshedLoading: boolean;
  viewshedArea: number | null;
  viewshedStats: ViewshedStats | null;
  visible: boolean; // Per-system coverage visibility toggle
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

function cacheKey(lat: number, lng: number, alt: number, rangeKm?: number): string {
  return `${lat.toFixed(6)},${lng.toFixed(6)},${alt}${rangeKm != null ? `,${rangeKm}` : ''}`;
}

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

async function fetchElevations(
  points: { latitude: number; longitude: number }[],
): Promise<number[]> {
  const BATCH = 200;
  const results: number[] = [];
  for (let i = 0; i < points.length; i += BATCH) {
    const batch = points.slice(i, i + BATCH);
    let retries = 0;
    let resp: Response | null = null;
    let lastError: string | null = null;
    while (retries < 3) {
      try {
        resp = await fetch("https://api.open-elevation.com/api/v1/lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locations: batch }),
        });
        if (resp.ok) break;
        lastError = `HTTP ${resp.status}`;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
      retries++;
      if (retries < 3) {
        await new Promise((r) => setTimeout(r, 500 * retries)); // Exponential backoff
      }
    }
    if (!resp || !resp.ok) {
      console.error(`[BDA] Elevation API failed after ${retries} retries: ${lastError}`);
      throw new Error(`Elevation API error: ${lastError || 'no response'}`);
    }
    const data = await resp.json();
    for (const r of data.results) {
      results.push(r.elevation);
    }
  }
  return results;
}

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

  let minElev = Infinity;
  let maxElev = -Infinity;
  for (let i = 1; i < elevations.length; i++) {
    if (elevations[i] < minElev) minElev = elevations[i];
    if (elevations[i] > maxElev) maxElev = elevations[i];
  }

  const visibleEdge: [number, number][] = [];
  const blockedSectors: [number, number][][] = [];
  let totalCells = 0;
  let visibleCells = 0;

  for (let r = 0; r < NUM_RAYS; r++) {
    let maxAngle = -(Math.PI / 2);
    let lastVisible: [number, number] | null = null;
    let firstBlocked: [number, number] | null = null;
    const bearing = (r / NUM_RAYS) * 2 * Math.PI;
    const nextBearing = ((r + 1) / NUM_RAYS) * 2 * Math.PI;

    for (let s = 0; s < steps; s++) {
      totalCells++;
      const idx = 1 + r * steps + s;
      const dist = (s + 1) * STEP_KM;
      const elev = elevations[idx];
      const distM = dist * 1000;
      const angle = Math.atan2(elev - centerElev, distM);

      if (angle >= maxAngle) {
        maxAngle = angle;
        lastVisible = [
          rayPoints[r * steps + s].lat,
          rayPoints[r * steps + s].lng,
        ];
        visibleCells++;
        if (firstBlocked) {
          firstBlocked = null;
        }
      } else {
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

    if (lastVisible) {
      const lastVisibleDist = Math.sqrt(
        Math.pow((lastVisible[0] - lat) * 111.32, 2) +
          Math.pow(
            (lastVisible[1] - lng) * 111.32 * Math.cos(degToRad(lat)),
            2,
          ),
      );
      if (lastVisibleDist < effectiveRange * 0.95) {
        const sector: [number, number][] = [lastVisible];
        const nextR = (r + 1) % NUM_RAYS;
        const nextRayEnd: [number, number] = [
          rayPoints[Math.min(nextR * steps + steps - 1, rayPoints.length - 1)]
            ?.lat ?? lat,
          rayPoints[Math.min(nextR * steps + steps - 1, rayPoints.length - 1)]
            ?.lng ?? lng,
        ];
        sector.push(offsetLatLng(lat, lng, effectiveRange, bearing));
        sector.push(offsetLatLng(lat, lng, effectiveRange, nextBearing));
        const nextLastIdx = 1 + nextR * steps + (steps - 1);
        if (nextLastIdx < elevations.length) {
          sector.push(nextRayEnd);
        }
        sector.push(lastVisible);
        if (sector.length >= 4) {
          blockedSectors.push(sector);
        }
      }
    }
  }

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

// ─── FOV cone computation ────────────────────────────────────────────────────

function computeFovCone(
  lat: number,
  lng: number,
  rangeKm: number,
  facingDeg: number,
  fovDeg: number,
): [number, number][] {
  const points: [number, number][] = [[lat, lng]];
  const halfFov = fovDeg / 2;
  const startAngle = facingDeg - halfFov;
  const steps = Math.max(12, Math.ceil(fovDeg));
  for (let i = 0; i <= steps; i++) {
    const angleDeg = startAngle + (i / steps) * fovDeg;
    const bearingRad = degToRad(angleDeg);
    points.push(offsetLatLng(lat, lng, rangeKm, bearingRad));
  }
  points.push([lat, lng]);
  return points;
}

// ─── Leaflet icon factory ────────────────────────────────────────────────────

function createSystemIcon(
  letter: string,
  color: string,
  selected: boolean,
): L.DivIcon {
  const bgColor = selected ? "#1a8fff" : color;
  const borderColor = selected ? "#ffffff" : color;
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

// ─── Map fly-to component ──────────────────────────────────────────────────

function MapFlyTo({ lat, lng, zoom }: { lat: number; lng: number; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo([lat, lng], zoom ?? map.getZoom(), { duration: 1.5 });
  }, [lat, lng, zoom, map]);
  return null;
}

// ─── Draggable base perimeter (mirrors Custom Mission) ─────────────────────

function DraggableBasePerimeter({
  perimeter,
  onChange,
}: {
  perimeter: { centerLat: number; centerLng: number; widthKm: number; heightKm: number };
  onChange: (p: { centerLat: number; centerLng: number; widthKm: number; heightKm: number }) => void;
}) {
  const map = useMap();
  const [dragging, setDragging] = useState<"center" | "nw" | "ne" | "sw" | "se" | null>(null);

  const bounds = useMemo(() => {
    const halfW = perimeter.widthKm / 2;
    const halfH = perimeter.heightKm / 2;
    // Simple lat/lng offset — 1 degree lat ≈ 111km, 1 degree lng ≈ 111km * cos(lat)
    const latDelta = halfH / 111.0;
    const lngDelta = halfW / (111.0 * Math.cos((perimeter.centerLat * Math.PI) / 180));
    const nw: [number, number] = [perimeter.centerLat + latDelta, perimeter.centerLng - lngDelta];
    const se: [number, number] = [perimeter.centerLat - latDelta, perimeter.centerLng + lngDelta];
    return [nw, se] as [[number, number], [number, number]];
  }, [perimeter]);

  useMapEvents({
    mousedown(e) {
      const [lat, lng] = [e.latlng.lat, e.latlng.lng];
      const [nw, se] = bounds;
      const isCenter = lat < nw[0] && lat > se[0] && lng > nw[1] && lng < se[1];
      if (isCenter) setDragging("center");
    },
    mouseup() {
      setDragging(null);
    },
    mousemove(e) {
      if (!dragging) return;
      const { lat, lng } = e.latlng;
      if (dragging === "center") {
        onChange({ ...perimeter, centerLat: lat, centerLng: lng });
      }
    },
  });

  return (
    <Rectangle
      bounds={bounds}
      pathOptions={{ color: COLORS.warning, fillOpacity: 0.05, weight: 2, dashArray: "8,4" }}
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
  onExportToMission?: (placement: PlacementConfig, scenarioId: string, baseId: string) => void;
}

export default function BaseDefenseArchitect({ onBack, onExportToMission }: Props) {
  const [catalog, setCatalog] = useState<EquipmentCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [bases, setBases] = useState<BaseInfo[]>([]);
  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null);

  const [systems, setSystems] = useState<PlacedSystem[]>([]);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [placingDef, setPlacingDef] = useState<SystemDef | null>(null);
  const [paletteFilter, setPaletteFilter] = useState<
    "sensor" | "effector" | "combined"
  >("sensor");
  const [baseSearch, setBaseSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ name: string; lat: number; lng: number }[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number; zoom: number } | null>(null);

  // Draggable base perimeter (mirrors Custom Mission)
  const [basePerimeter, setBasePerimeter] = useState<{
    centerLat: number;
    centerLng: number;
    widthKm: number;
    heightKm: number;
  } | null>(null);

  const uidCounter = useRef(0);

  // ─── Geolocation search ─────────────────────────────────────────────────

  const handleGeocodeSearch = useCallback(
    (query: string) => {
      console.log(`[BDA GeoSearch] Query: "${query}"`);
      setSearchQuery(query);
      if (query.trim().length < 2) {
        console.log('[BDA GeoSearch] Too short, clearing results');
        setSearchResults([]);
        return;
      }
      setSearchLoading(true);
      fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`,
        { headers: { "Accept-Language": "en", "User-Agent": "OpenSentry-BDA/1.0" } },
      )
        .then((res) => {
          console.log(`[BDA GeoSearch] Response status: ${res.status}`);
          return res.json();
        })
        .then((data) => {
          console.log(`[BDA GeoSearch] Results: ${data.length} items`, data);
          setSearchResults(
            data.map((r: { display_name: string; lat: string; lon: string }) => ({
              name: r.display_name.split(",").slice(0, 2).join(","),
              lat: parseFloat(r.lat),
              lng: parseFloat(r.lon),
            })),
          );
          setSearchLoading(false);
        })
        .catch((err) => {
          console.error('[BDA GeoSearch] Error:', err);
          setSearchResults([]);
          setSearchLoading(false);
        });
    },
    [],
  );

  const handleSelectGeocodeResult = useCallback(
    (result: { name: string; lat: number; lng: number }) => {
      setFlyTo({ lat: result.lat, lng: result.lng, zoom: 14 });
      setSearchQuery(result.name);
      setSearchResults([]);
    },
    [],
  );

  // ─── Load catalog ───────────────────────────────────────────────────────

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/equipment/catalog.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: EquipmentCatalog) => {
        setCatalog(data);
        setCatalogLoading(false);
      })
      .catch((err) => {
        setCatalogError(err.message);
        setCatalogLoading(false);
      });
  }, []);

  // ─── Load base index ────────────────────────────────────────────────────

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/bases/index.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: BaseInfo[]) => {
        setBases(data);
      })
      .catch((err) => {
        console.warn("Failed to load base index:", err);
      });
  }, []);

  // ─── Derived: selected base template limits ─────────────────────────────

  const selectedBase = useMemo(
    () => bases.find((b) => b.id === selectedBaseId) ?? null,
    [bases, selectedBaseId],
  );

  const [selectedBaseTemplate, setSelectedBaseTemplate] = useState<{
    center_lat: number;
    center_lng: number;
    placement_bounds_km: number;
  } | null>(null);

  // Load full base template when selected
  useEffect(() => {
    if (!selectedBaseId) {
      setSelectedBaseTemplate(null);
      return;
    }
    fetch(`${import.meta.env.BASE_URL}data/bases/${selectedBaseId}.json`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data) {
          setSelectedBaseTemplate({
            center_lat: SHAW_AFB.lat,   // Use current map center (Shaw AFB default)
            center_lng: SHAW_AFB.lng,
            placement_bounds_km: data.placement_bounds_km ?? 1.0,
          });
        }
      })
      .catch(() => setSelectedBaseTemplate(null));
  }, [selectedBaseId]);

  const maxSensors = selectedBase?.max_sensors ?? null;
  const maxEffectors = selectedBase?.max_effectors ?? null;

  // Initialize base perimeter when base template changes
  useEffect(() => {
    if (selectedBaseTemplate?.center_lat && selectedBaseTemplate?.center_lng) {
      setBasePerimeter({
        centerLat: selectedBaseTemplate.center_lat,
        centerLng: selectedBaseTemplate.center_lng,
        widthKm: selectedBaseTemplate.placement_bounds_km * 2,
        heightKm: selectedBaseTemplate.placement_bounds_km * 2,
      });
    } else {
      setBasePerimeter(null);
    }
  }, [selectedBaseTemplate]);

  // ─── Derived: current placed counts ────────────────────────────────────

  const placedSensorCount = useMemo(
    () => systems.filter((s) => s.def.category === "sensor" || s.def.category === "combined").length,
    [systems],
  );

  const placedEffectorCount = useMemo(
    () => systems.filter((s) => s.def.category === "effector" || s.def.category === "combined").length,
    [systems],
  );

  const sensorLimitReached = maxSensors !== null && placedSensorCount >= maxSensors;
  const effectorLimitReached = maxEffectors !== null && placedEffectorCount >= maxEffectors;

  const sensorLimitExceeded = maxSensors !== null && placedSensorCount > maxSensors;
  const effectorLimitExceeded = maxEffectors !== null && placedEffectorCount > maxEffectors;

  const systemDefs = useMemo(
    () => (catalog ? buildSystemDefs(catalog) : []),
    [catalog],
  );

  const selectedSystem = useMemo(
    () => systems.find((s) => s.uid === selectedUid) ?? null,
    [systems, selectedUid],
  );

  // ─── Place a system on the map ──────────────────────────────────────────

  const handlePlace = useCallback(
    (lat: number, lng: number) => {
      if (!placingDef) return;

      // Enforce limits when a base template is selected
      const isSensorType = placingDef.category === "sensor" || placingDef.category === "combined";
      const isEffectorType = placingDef.category === "effector" || placingDef.category === "combined";
      if (isSensorType && sensorLimitReached) {
        setPlacingDef(null);
        return;
      }
      if (isEffectorType && effectorLimitReached) {
        setPlacingDef(null);
        return;
      }
      const uid = `sys_${++uidCounter.current}`;
      const newSystem: PlacedSystem = {
        uid,
        def: placingDef,
        lat,
        lng,
        altitude: 10,
        facing_deg: 0,
        viewshed: null,
        blockedSectors: null,
        viewshedLoading: false,
        viewshedArea: null,
        viewshedStats: null,
        visible: true, // Default: show coverage for newly placed system
      };
      setSystems((prev) => [...prev, newSystem]);
      setSelectedUid(uid);
      setPlacingDef(null);

      // Only fetch viewshed for LOS-dependent systems
      if (placingDef.requires_los && placingDef.range_km) {
        // Default altitude: 10m for ground systems, but user can adjust
        fetchViewshedForSystem(uid, lat, lng, 10, placingDef.range_km);
      } else {
        console.log(`[BDA] Skipping viewshed for ${placingDef.name}: requires_los=${placingDef.requires_los}, range_km=${placingDef.range_km}`);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [placingDef, sensorLimitReached, effectorLimitReached],
  );

  // ─── Fetch viewshed ────────────────────────────────────────────────────

  const fetchViewshedForSystem = useCallback(
    (uid: string, lat: number, lng: number, alt: number, rangeKm: number) => {
      const key = cacheKey(lat, lng, alt, rangeKm);
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
          console.warn(`[BDA] Viewshed fetch failed for ${uid} at ${lat.toFixed(4)},${lng.toFixed(4)} alt=${alt}m:`, err.message || err);
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
      const sys = systems.find((s) => s.uid === uid);
      if (!sys) return;
      const { lat, lng } = sys;
      setSystems((prev) =>
        prev.map((s) =>
          s.uid === uid
            ? {
                ...s,
                altitude: newAlt,
                viewshed: null,
                blockedSectors: null,
                viewshedArea: null,
                viewshedStats: null,
                viewshedLoading: sys.def.requires_los,
              }
            : s,
        ),
      );
      if (sys.def.requires_los && sys.def.range_km) {
        fetchViewshedForSystem(uid, lat, lng, newAlt, sys.def.range_km);
      }
    },
    [systems, fetchViewshedForSystem],
  );

  // ─── Recalculate viewshed ─────────────────────────────────────────────

  const handleRecalculate = useCallback(
    (uid: string) => {
      const sys = systems.find((s) => s.uid === uid);
      if (sys && sys.def.requires_los && sys.def.range_km) {
        const key = cacheKey(sys.lat, sys.lng, sys.altitude, sys.def.range_km);
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

  // ─── Rotate facing ─────────────────────────────────────────────────────

  const handleRotate = useCallback(
    (uid: string, deltaDeg: number) => {
      setSystems((prev) =>
        prev.map((s) =>
          s.uid === uid
            ? { ...s, facing_deg: (s.facing_deg + deltaDeg + 360) % 360 }
            : s,
        ),
      );
    },
    [],
  );

  // ─── Drag end ──────────────────────────────────────────────────────────

  const handleDragEnd = useCallback(
    (uid: string, lat: number, lng: number) => {
      const sys = systems.find((s) => s.uid === uid);
      if (!sys) return;
      const { altitude } = sys;
      setSystems((prev) =>
        prev.map((s) => (s.uid === uid ? { ...s, lat, lng } : s)),
      );
      if (sys.def.requires_los && sys.def.range_km) {
        fetchViewshedForSystem(uid, lat, lng, altitude, sys.def.range_km);
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

  // ─── Toggle system visibility ────────────────────────────────────────────

  const handleToggleVisibility = useCallback((uid: string) => {
    setSystems((prev) =>
      prev.map((s) => (s.uid === uid ? { ...s, visible: !s.visible } : s)),
    );
  }, []);

  // ─── Category counts for loadout summary ──────────────────────────────────

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const sys of systems) {
      const key = sys.def.type;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [systems]);

  // ─── Filtered palette ──────────────────────────────────────────────────

  const filteredDefs = useMemo(
    () => systemDefs.filter((s) => s.category === paletteFilter),
    [systemDefs, paletteFilter],
  );

  // ─── Loading / error states ────────────────────────────────────────────

  if (catalogLoading) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: COLORS.bg,
          color: COLORS.muted,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 14,
        }}
      >
        LOADING EQUIPMENT CATALOG...
      </div>
    );
  }

  if (catalogError || !catalog) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          background: COLORS.bg,
          color: COLORS.danger,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 14,
        }}
      >
        <span>FAILED TO LOAD CATALOG: {catalogError || "Unknown error"}</span>
        <button
          onClick={onBack}
          style={{
            padding: "8px 20px",
            fontSize: 12,
            fontWeight: 600,
            background: COLORS.card,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 6,
            color: COLORS.muted,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          BACK
        </button>
      </div>
    );
  }

  // ─── Helper: is this a narrow-FOV system? ──────────────────────────────

  const isNarrowFov = (def: SystemDef) => def.fov_deg < 360;

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
              {selectedBase && (
                <span style={{ color: COLORS.accent, marginLeft: 12 }}>
                  {selectedBase.name}: {selectedBase.max_sensors}S / {selectedBase.max_effectors}E max
                </span>
              )}
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
            {/* Base template selector */}
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 1.5,
                color: COLORS.muted,
                marginBottom: 6,
              }}
            >
              BASE TEMPLATE
            </div>
            <select
              value={selectedBaseId ?? ""}
              onChange={(e) => setSelectedBaseId(e.target.value || null)}
              style={{
                width: "100%",
                padding: "5px 8px",
                fontSize: 11,
                fontWeight: 600,
                background: COLORS.bg,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 4,
                color: selectedBaseId ? COLORS.text : COLORS.muted,
                fontFamily: "inherit",
                cursor: "pointer",
                marginBottom: 10,
              }}
            >
              <option value="">No template (freeform)</option>
              {bases.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} — {b.max_sensors}S / {b.max_effectors}E
                </option>
              ))}
            </select>

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
                  ["sensor", "SENSORS"],
                  ["effector", "EFFECTORS"],
                  ["combined", "COMBINED"],
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
            {filteredDefs.map((def) => {
              const isPlacing = placingDef?.id === def.id;
              const typeColor = TYPE_COLORS[def.type] || COLORS.muted;
              // Determine if this item is blocked by a limit
              const isSensorType = def.category === "sensor" || def.category === "combined";
              const isEffectorType = def.category === "effector" || def.category === "combined";
              const blockedBySensor = isSensorType && sensorLimitReached && !isPlacing;
              const blockedByEffector = isEffectorType && effectorLimitReached && !isPlacing;
              const isBlocked = blockedBySensor || blockedByEffector;
              return (
                <button
                  key={def.id}
                  onClick={() => {
                    if (isBlocked) return;
                    setPlacingDef(isPlacing ? null : def);
                  }}
                  disabled={isBlocked}
                  title={isBlocked ? `Limit reached for ${def.category}s` : undefined}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    padding: "10px 10px",
                    background: isBlocked
                      ? `${COLORS.danger}08`
                      : isPlacing ? `${def.color}18` : COLORS.bg,
                    border: `1px solid ${isBlocked ? COLORS.danger + "40" : isPlacing ? def.color : COLORS.border}`,
                    borderRadius: 6,
                    cursor: isBlocked ? "not-allowed" : "pointer",
                    textAlign: "left",
                    fontFamily: "inherit",
                    transition: "all 0.1s",
                    width: "100%",
                    opacity: isBlocked ? 0.5 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!isPlacing && !isBlocked) {
                      (e.currentTarget as HTMLElement).style.borderColor =
                        def.color;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isPlacing && !isBlocked) {
                      (e.currentTarget as HTMLElement).style.borderColor =
                        COLORS.border;
                    }
                  }}
                >
                  {/* Name + type tag row */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: isPlacing ? def.color : COLORS.text,
                        letterSpacing: 0.3,
                      }}
                    >
                      {def.name}
                    </span>
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 600,
                        fontFamily: "'JetBrains Mono', monospace",
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                        color: typeColor,
                        background: `${typeColor}1a`,
                        padding: "1px 6px",
                        borderRadius: 3,
                        border: `1px solid ${typeColor}33`,
                      }}
                    >
                      {def.type}
                    </span>
                    {def.requires_los && (
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 600,
                          fontFamily: "'JetBrains Mono', monospace",
                          color: COLORS.muted,
                          background: `${COLORS.muted}1a`,
                          padding: "1px 6px",
                          borderRadius: 3,
                          border: `1px solid ${COLORS.muted}33`,
                        }}
                      >
                        LOS
                      </span>
                    )}
                  </div>
                  {/* Stats row */}
                  <div
                    style={{
                      display: "flex",
                      gap: 10,
                      fontSize: 10,
                      fontFamily: "'JetBrains Mono', monospace",
                      color: COLORS.muted,
                    }}
                  >
                    {def.category === "combined" ? (
                      <>
                        <span>
                          DET <span style={{ color: COLORS.text, fontWeight: 600 }}>{def.sensor_range_km}km</span>
                        </span>
                        <span>
                          DEF <span style={{ color: COLORS.text, fontWeight: 600 }}>{def.effector_range_km}km</span>
                        </span>
                      </>
                    ) : (
                      <span>
                        RNG <span style={{ color: COLORS.text, fontWeight: 600 }}>{def.range_km}km</span>
                      </span>
                    )}
                    {def.fov_deg < 360 && (
                      <span>
                        FOV <span style={{ color: COLORS.text, fontWeight: 600 }}>{def.fov_deg}&deg;</span>
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Limits / count footer */}
          <div
            style={{
              padding: "10px 12px",
              borderTop: `1px solid ${COLORS.border}`,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {/* Sensor count bar */}
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                  fontFamily: "'JetBrains Mono', monospace",
                  marginBottom: 3,
                }}
              >
                <span style={{ color: sensorLimitExceeded ? COLORS.danger : COLORS.muted }}>
                  SENSORS
                  {sensorLimitExceeded && (
                    <span style={{ marginLeft: 4, color: COLORS.danger }}>⚠ OVER LIMIT</span>
                  )}
                </span>
                <span style={{
                  color: sensorLimitExceeded
                    ? COLORS.danger
                    : sensorLimitReached
                    ? COLORS.warning
                    : COLORS.text,
                }}>
                  {placedSensorCount}
                  {maxSensors !== null ? ` / ${maxSensors}` : ""}
                </span>
              </div>
              {maxSensors !== null && (
                <div
                  style={{
                    height: 4,
                    background: COLORS.border,
                    borderRadius: 2,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.min((placedSensorCount / maxSensors) * 100, 100)}%`,
                      background: sensorLimitExceeded
                        ? COLORS.danger
                        : sensorLimitReached
                        ? COLORS.warning
                        : COLORS.accent,
                      borderRadius: 2,
                      transition: "width 0.2s",
                    }}
                  />
                </div>
              )}
            </div>

            {/* Effector count bar */}
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                  fontFamily: "'JetBrains Mono', monospace",
                  marginBottom: 3,
                }}
              >
                <span style={{ color: effectorLimitExceeded ? COLORS.danger : COLORS.muted }}>
                  EFFECTORS
                  {effectorLimitExceeded && (
                    <span style={{ marginLeft: 4, color: COLORS.danger }}>⚠ OVER LIMIT</span>
                  )}
                </span>
                <span style={{
                  color: effectorLimitExceeded
                    ? COLORS.danger
                    : effectorLimitReached
                    ? COLORS.warning
                    : COLORS.text,
                }}>
                  {placedEffectorCount}
                  {maxEffectors !== null ? ` / ${maxEffectors}` : ""}
                </span>
              </div>
              {maxEffectors !== null && (
                <div
                  style={{
                    height: 4,
                    background: COLORS.border,
                    borderRadius: 2,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.min((placedEffectorCount / maxEffectors) * 100, 100)}%`,
                      background: effectorLimitExceeded
                        ? COLORS.danger
                        : effectorLimitReached
                        ? COLORS.warning
                        : COLORS.success,
                      borderRadius: 2,
                      transition: "width 0.2s",
                    }}
                  />
                </div>
              )}
            </div>

            {/* Total count line */}
            {maxSensors === null && maxEffectors === null && (
              <div style={{ fontSize: 10, color: COLORS.muted, display: "flex", justifyContent: "space-between" }}>
                <span>{systems.length} system{systems.length !== 1 ? "s" : ""} placed</span>
                <span>
                  {systems.filter((s) => s.def.category === "sensor").length}S /{" "}
                  {systems.filter((s) => s.def.category === "effector").length}E /{" "}
                  {systems.filter((s) => s.def.category === "combined").length}C
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Center — Map */}
        <div style={{ flex: 1, position: "relative" }}>
          {/* Geolocation search overlay */}
          <div
            style={{
              position: "absolute",
              top: 10,
              left: 10,
              zIndex: 1000,
              width: 280,
            }}
          >
            <input
              type="text"
              placeholder="Search location (e.g., Shaw AFB, Lugoff SC)..."
              value={searchQuery}
              onChange={(e) => handleGeocodeSearch(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 10px",
                fontSize: 11,
                fontWeight: 500,
                background: COLORS.card,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 4,
                color: COLORS.text,
                fontFamily: "inherit",
              }}
            />
            {searchLoading && (
              <div
                style={{
                  marginTop: 4,
                  padding: "6px 8px",
                  fontSize: 10,
                  color: COLORS.muted,
                  background: COLORS.card,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 4,
                }}
              >
                Searching...
              </div>
            )}
            {searchResults.length > 0 && (
              <div
                style={{
                  marginTop: 4,
                  background: COLORS.card,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 4,
                  overflow: "hidden",
                }}
              >
                {searchResults.map((result, i) => (
                  <button
                    key={i}
                    onClick={() => handleSelectGeocodeResult(result)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "6px 8px",
                      fontSize: 10,
                      color: COLORS.text,
                      background: "transparent",
                      border: "none",
                      borderBottom: i < searchResults.length - 1 ? `1px solid ${COLORS.border}` : "none",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {result.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <MapContainer
            center={[SHAW_AFB.lat, SHAW_AFB.lng]}
            zoom={DEFAULT_ZOOM}
            style={{ width: "100%", height: "100%" }}
            zoomControl={false}
          >
            {flyTo && <MapFlyTo lat={flyTo.lat} lng={flyTo.lng} zoom={flyTo.zoom} />}
            {basePerimeter && (
              <DraggableBasePerimeter
                perimeter={basePerimeter}
                onChange={setBasePerimeter}
              />
            )}
            <ScaleControl position="bottomleft" />
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              attribution="Tiles &copy; Esri"
              maxZoom={19}
            />

            <MapClickHandler placingDef={placingDef} onPlace={handlePlace} />

            {/* Viewshed polygons — green for visible (LOS systems only) */}
            {systems
              .filter((sys) => sys.visible)
              .map(
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

            {/* Blocked sectors — red (LOS systems only) */}
            {systems
              .filter((sys) => sys.visible)
              .map((sys) =>
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

            {/* Range rings for non-LOS systems (no viewshed) */}
            {systems.map((sys) => {
              if (sys.def.requires_los) return null;
              if (sys.def.category === "combined") {
                // Shenobi: dual rings
                return (
                  <React.Fragment key={`rr-${sys.uid}`}>
                    {/* Outer ring — sensor/detect (blue tint) */}
                    <Circle
                      center={[sys.lat, sys.lng]}
                      radius={(sys.def.sensor_range_km ?? sys.def.range_km) * 1000}
                      pathOptions={{
                        color: "#388bfd",
                        fillColor: "#388bfd",
                        fillOpacity: 0.06,
                        weight: 1,
                        dashArray: "6,4",
                      }}
                    />
                    {/* Inner ring — effector/defeat (red tint) */}
                    <Circle
                      center={[sys.lat, sys.lng]}
                      radius={(sys.def.effector_range_km ?? sys.def.range_km) * 1000}
                      pathOptions={{
                        color: "#f85149",
                        fillColor: "#f85149",
                        fillOpacity: 0.06,
                        weight: 1,
                        dashArray: "6,4",
                      }}
                    />
                  </React.Fragment>
                );
              }
              // Standard non-LOS system: single range ring
              return (
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
              );
            })}

            {/* FOV cone for narrow-FOV systems (e.g. EO/IR Camera) */}
            {systems.map((sys) => {
              if (!isNarrowFov(sys.def)) return null;
              const cone = computeFovCone(
                sys.lat,
                sys.lng,
                sys.def.range_km,
                sys.facing_deg,
                sys.def.fov_deg,
              );
              return (
                <Polygon
                  key={`fov-${sys.uid}`}
                  positions={cone}
                  pathOptions={{
                    color: sys.def.color,
                    fillColor: sys.def.color,
                    fillOpacity: selectedUid === sys.uid ? 0.25 : 0.15,
                    weight: selectedUid === sys.uid ? 2 : 1,
                  }}
                />
              );
            })}

            {/* Range ring / cone labels */}
            {systems.map((sys) => {
              if (sys.def.category === "combined") {
                // Shenobi: label for outer (detect) ring
                return (
                  <React.Fragment key={`rl-${sys.uid}`}>
                    <Marker
                      position={[
                        sys.lat + (sys.def.sensor_range_km ?? sys.def.range_km) / 111.32,
                        sys.lng,
                      ]}
                      icon={createRingLabel(
                        `${sys.def.name} DET`,
                        sys.def.sensor_range_km ?? sys.def.range_km,
                        "#388bfd",
                      )}
                      interactive={false}
                    />
                    <Marker
                      position={[
                        sys.lat + (sys.def.effector_range_km ?? sys.def.range_km) / 111.32,
                        sys.lng + 0.01,
                      ]}
                      icon={createRingLabel(
                        `${sys.def.name} DEF`,
                        sys.def.effector_range_km ?? sys.def.range_km,
                        "#f85149",
                      )}
                      interactive={false}
                    />
                  </React.Fragment>
                );
              }
              return (
                <Marker
                  key={`rl-${sys.uid}`}
                  position={[
                    sys.lat + sys.def.range_km / 111.32,
                    sys.lng,
                  ]}
                  icon={createRingLabel(
                    sys.def.name,
                    sys.def.range_km,
                    sys.def.color,
                  )}
                  interactive={false}
                />
              );
            })}

            {/* Fallback range ring for LOS systems while viewshed not yet loaded */}
            {systems.map(
              (sys) =>
                sys.def.requires_los &&
                !sys.viewshed &&
                !sys.viewshedLoading &&
                !isNarrowFov(sys.def) && (
                  <Circle
                    key={`rr-fallback-${sys.uid}`}
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

          {/* Over-limit warning banner */}
          {(sensorLimitExceeded || effectorLimitExceeded) && (
            <div
              style={{
                position: "absolute",
                bottom: 16,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 1000,
                background: `${COLORS.card}f0`,
                border: `1px solid ${COLORS.danger}`,
                borderRadius: 6,
                padding: "8px 16px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 11,
                fontWeight: 600,
                color: COLORS.danger,
                whiteSpace: "nowrap",
              }}
            >
              ⚠ LOADOUT EXCEEDS BASE LIMITS — Remove systems to comply
              {sensorLimitExceeded && (
                <span style={{ opacity: 0.8, marginLeft: 4, fontSize: 10 }}>
                  ({placedSensorCount}/{maxSensors} sensors)
                </span>
              )}
              {effectorLimitExceeded && (
                <span style={{ opacity: 0.8, marginLeft: 4, fontSize: 10 }}>
                  ({placedEffectorCount}/{maxEffectors} effectors)
                </span>
              )}
            </div>
          )}

          <style>{`
            @keyframes bda-spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
        </div>

        {/* Right panel — Loadout Summary + Equipment List + Selected System */}
        <div
          style={{
            width: 320,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            borderLeft: `1px solid ${COLORS.border}`,
            background: COLORS.card,
            overflowY: "auto",
          }}
        >
          {/* Loadout Summary */}
          <div style={{ padding: "14px", borderBottom: `1px solid ${COLORS.border}` }}>
            <SectionHeader title="LOADOUT SUMMARY" />
            <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: COLORS.muted, marginBottom: 4 }}>SENSORS</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: COLORS.success }}>
                  {placedSensorCount}
                  {maxSensors && (
                    <span style={{ fontSize: 10, color: sensorLimitExceeded ? COLORS.danger : COLORS.muted, marginLeft: 4 }}>
                      /{maxSensors}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: COLORS.muted, marginBottom: 4 }}>EFFECTORS</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: COLORS.danger }}>
                  {placedEffectorCount}
                  {maxEffectors && (
                    <span style={{ fontSize: 10, color: effectorLimitExceeded ? COLORS.danger : COLORS.muted, marginLeft: 4 }}>
                      /{maxEffectors}
                    </span>
                  )}
                </div>
              </div>
            </div>
            {/* Category breakdown */}
            {Object.entries(categoryCounts).length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {Object.entries(categoryCounts).map(([type, count]) => (
                  <div
                    key={type}
                    style={{
                      padding: "4px 8px",
                      background: `${COLORS.border}40`,
                      borderRadius: 4,
                      fontSize: 10,
                      fontWeight: 600,
                      color: COLORS.text,
                    }}
                  >
                    {type.toUpperCase()}: {count}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Equipment List */}
          <div style={{ padding: "14px", borderBottom: `1px solid ${COLORS.border}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <SectionHeader title="PLACED SYSTEMS" />
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  onClick={() => setSystems((prev) => prev.map((s) => ({ ...s, visible: true })))}
                  style={{
                    padding: "3px 6px",
                    fontSize: 9,
                    fontWeight: 600,
                    background: "transparent",
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: 3,
                    color: COLORS.muted,
                    cursor: "pointer",
                  }}
                >
                  SHOW ALL
                </button>
                <button
                  onClick={() => setSystems((prev) => prev.map((s) => ({ ...s, visible: false })))}
                  style={{
                    padding: "3px 6px",
                    fontSize: 9,
                    fontWeight: 600,
                    background: "transparent",
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: 3,
                    color: COLORS.muted,
                    cursor: "pointer",
                  }}
                >
                  HIDE ALL
                </button>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflowY: "auto" }}>
              {systems.length === 0 ? (
                <div style={{ fontSize: 10, color: COLORS.muted, textAlign: "center", padding: 12 }}>
                  No systems placed
                </div>
              ) : (
                systems.map((sys) => (
                  <div
                    key={sys.uid}
                    onClick={() => setSelectedUid(sys.uid)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 8px",
                      background: selectedUid === sys.uid ? `${COLORS.accent}18` : "transparent",
                      border: `1px solid ${selectedUid === sys.uid ? COLORS.accent : COLORS.border}`,
                      borderRadius: 4,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={sys.visible}
                      onChange={(e) => {
                        e.stopPropagation();
                        handleToggleVisibility(sys.uid);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      style={{ accentColor: COLORS.accent, width: 14, height: 14 }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: COLORS.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {sys.def.name}
                      </div>
                      <div style={{ fontSize: 9, color: COLORS.muted }}>
                        {sys.def.type} • {sys.altitude}m
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(sys.uid);
                      }}
                      style={{
                        padding: "2px 6px",
                        fontSize: 12,
                        background: "transparent",
                        border: `1px solid ${COLORS.danger}40`,
                        borderRadius: 3,
                        color: COLORS.danger,
                        cursor: "pointer",
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Selected System Detail */}
          {selectedSystem && (
            <div style={{ padding: "14px" }}>
              {/* SENSOR section */}
              <div style={{ padding: "14px 14px 12px" }}>
                <SectionHeader title={selectedSystem.def.category.toUpperCase()} />
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: COLORS.text,
                    marginBottom: 6,
                  }}
                >
                  {selectedSystem.def.name}
                </div>
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

              {/* Altitude slider + band presets */}
              <div style={{ padding: "0 14px 14px" }}>
                {/* Altitude Legend */}
                {(() => {
                  const band = getAltitudeBand(selectedSystem.altitude);
                  return (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        marginBottom: 8,
                        padding: "5px 8px",
                        background: `${band.color}18`,
                        border: `1px solid ${band.color}44`,
                        borderRadius: 5,
                      }}
                    >
                      <span style={{ fontSize: 13 }}>{band.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: band.color, letterSpacing: 0.5 }}>
                          {band.label} BAND — {selectedSystem.altitude}m AGL
                        </div>
                        <div style={{ fontSize: 9, color: COLORS.muted, marginTop: 1 }}>
                          {getAltitudeBandLabel(selectedSystem.altitude)}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                <input
                  type="range"
                  min={1}
                  max={2000}
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
                    marginBottom: 10,
                  }}
                />

                {/* Band preset rows */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {ALTITUDE_BANDS.map((band) => (
                    <div key={band.label}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                          marginBottom: 4,
                        }}
                      >
                        <span style={{ fontSize: 10 }}>{band.icon}</span>
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            color: band.color,
                            letterSpacing: 1,
                            fontFamily: "'JetBrains Mono', monospace",
                          }}
                        >
                          {band.label}
                        </span>
                        <div
                          style={{
                            flex: 1,
                            height: 1,
                            background: `${band.color}33`,
                            marginLeft: 2,
                          }}
                        />
                      </div>
                      <div style={{ display: "flex", gap: 4 }}>
                        {band.presets.map((preset) => {
                          const isActive = selectedSystem.altitude === preset.value;
                          return (
                            <button
                              key={preset.value}
                              onClick={() =>
                                handleAltitudeChange(selectedSystem.uid, preset.value)
                              }
                              style={{
                                flex: 1,
                                padding: "5px 4px",
                                fontSize: 10,
                                fontWeight: 600,
                                border: `1px solid ${
                                  isActive ? band.color : COLORS.border
                                }`,
                                borderRadius: 4,
                                background: isActive
                                  ? `${band.color}22`
                                  : "transparent",
                                color: isActive ? band.color : COLORS.muted,
                                cursor: "pointer",
                                fontFamily: "inherit",
                                transition: "all 0.1s",
                              }}
                            >
                              {preset.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* FOV rotation controls — only for narrow-FOV systems */}
              {isNarrowFov(selectedSystem.def) && (
                <div
                  style={{
                    padding: "14px",
                    borderTop: `1px solid ${COLORS.border}`,
                  }}
                >
                  <SectionHeader title="FACING" />
                  <div
                    style={{
                      fontSize: 11,
                      color: COLORS.text,
                      fontFamily: "'JetBrains Mono', monospace",
                      marginBottom: 10,
                    }}
                  >
                    {selectedSystem.facing_deg}&deg; ({selectedSystem.def.fov_deg}&deg; FOV)
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={() => handleRotate(selectedSystem.uid, -15)}
                      style={{
                        flex: 1,
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
                      -15&deg;
                    </button>
                    <button
                      onClick={() => handleRotate(selectedSystem.uid, -5)}
                      style={{
                        flex: 1,
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
                      -5&deg;
                    </button>
                    <button
                      onClick={() => handleRotate(selectedSystem.uid, 5)}
                      style={{
                        flex: 1,
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
                      +5&deg;
                    </button>
                    <button
                      onClick={() => handleRotate(selectedSystem.uid, 15)}
                      style={{
                        flex: 1,
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
                      +15&deg;
                    </button>
                  </div>
                </div>
              )}

              {/* VIEWSHED section — LOS systems only */}
              {selectedSystem.def.requires_los && (
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

              {/* Delete + Export */}
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

                {/* Export to Mission — launches a Free Play mission with placed equipment */}
                <button
                  disabled={systems.length === 0}
                  onClick={() => {
                    // Determine the base center for coordinate conversion.
                    // BDA places systems in real-world lat/lng; the game engine
                    // uses km offsets (x=east, y=north) from the base template center.
                    // We use the base template's game-world center_lat/center_lng.
                    const baseLat = selectedBaseTemplate?.center_lat ?? 32.5;
                    const baseLng = selectedBaseTemplate?.center_lng ?? 45.5;
                    const effectiveBaseId = selectedBaseId ?? "medium_airbase";

                    const placement: PlacementConfig = {
                      base_id: effectiveBaseId,
                      sensors: [],
                      effectors: [],
                      combined: [],
                      placement_bounds_km: selectedBaseTemplate?.placement_bounds_km,
                    };

                    systems.forEach((sys) => {
                      const { x, y } = latLngToGameXY(sys.lat, sys.lng, baseLat, baseLng);
                      const item = {
                        catalog_id: sys.def.id,
                        x,
                        y,
                        facing_deg: sys.facing_deg,
                      };
                      if (sys.def.category === "sensor") placement.sensors.push(item);
                      else if (sys.def.category === "effector") placement.effectors.push(item);
                      else if (sys.def.category === "combined") placement.combined.push(item);
                    });

                    // If onExportToMission callback provided, launch the mission
                    if (onExportToMission) {
                      onExportToMission(placement, "free_play", effectiveBaseId);
                    } else {
                      // Fallback: download JSON for manual inspection
                      const blob = new Blob([JSON.stringify(placement, null, 2)], { type: "application/json" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `bda-${effectiveBaseId}-${Date.now()}.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }
                  }}
                  style={{
                    width: "100%",
                    padding: "10px 0",
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: 1,
                    background: systems.length === 0 ? `${COLORS.accent}40` : COLORS.accent,
                    border: `1px solid ${systems.length === 0 ? COLORS.border : COLORS.accent}`,
                    borderRadius: 5,
                    color: systems.length === 0 ? COLORS.muted : COLORS.bg,
                    cursor: systems.length === 0 ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {onExportToMission ? "▶ LAUNCH MISSION" : "EXPORT TO MISSION"}
                </button>
                {systems.length === 0 && (
                  <div style={{ fontSize: 9, color: COLORS.muted, textAlign: "center", marginTop: 4, opacity: 0.6 }}>
                    Place at least one system to launch
                  </div>
                )}
                {systems.length > 0 && !onExportToMission && (
                  <div style={{ fontSize: 9, color: COLORS.muted, textAlign: "center", marginTop: 4, opacity: 0.6 }}>
                    Downloads placement JSON
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
