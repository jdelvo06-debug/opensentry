import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Circle,
  Polygon,
  Polyline,
  Marker,
  useMap,
  useMapEvents,
  ScaleControl,
  LayersControl,
} from "react-leaflet";
import L from "leaflet";
import type {
  BaseTemplate,
  CatalogCombined,
  CatalogSensor,
  CatalogEffector,
  PlacedEquipment,
  PlacementConfig,
} from "../types";
import {
  gameXYToLatLng,
  latLngToGameXY,
  gamePolygonToLatLng,
  getBaseCenter,
} from "../utils/coordinates";

import "leaflet/dist/leaflet.css";

interface Props {
  baseTemplate: BaseTemplate;
  selectedSensors: CatalogSensor[];
  selectedEffectors: CatalogEffector[];
  selectedCombined?: CatalogCombined[];
  onConfirm: (placement: PlacementConfig) => void;
  onBack: () => void;
}

interface PlacedItem {
  equipment: PlacedEquipment;
  kind: "sensor" | "effector" | "combined";
  catalogIndex: number;
}

type PaletteItem = {
  kind: "sensor" | "effector" | "combined";
  index: number;
  catalog: CatalogSensor | CatalogEffector | CatalogCombined;
};

const SENSOR_TYPE_LETTERS: Record<string, string> = {
  radar: "R",
  rf: "F",
  eoir: "C",
  acoustic: "A",
};

const COLORS = {
  bg: "#0d1117",
  card: "#161b22",
  border: "#30363d",
  text: "#e6edf3",
  muted: "#8b949e",
  grid: "#1c2333",
  sensorRange: "#58a6ff44",
  effectorRange: "#f8514944",
  coverageOverlay: "#58a6ff08",
  accent: "#58a6ff",
  danger: "#f85149",
  warning: "#d29922",
  success: "#3fb950",
};

// Per-system range ring styling keyed by catalog_id
const RANGE_RING_STYLES: Record<string, { color: string; dashArray?: string }> = {
  tpq51:         { color: "#58a6ff", dashArray: "8,4" },      // blue, dashed
  kufcs:          { color: "#d29922" },                          // orange, solid (sector)
  eoir_camera:   { color: "#3fb950", dashArray: "2,4" },       // green, dotted
  rf_jammer:     { color: "#e3b341", dashArray: "8,4" },       // yellow, dashed
  jackal_pallet: { color: "#f85149", dashArray: "8,4" },       // red, dashed
  shenobi:       { color: "#a371f7", dashArray: "6,4" },       // purple, dashed (combined)
};

function getRingStyle(catalogId: string, isSensor: boolean): { color: string; dashArray?: string } {
  return RANGE_RING_STYLES[catalogId] || { color: isSensor ? "#58a6ff" : "#f85149", dashArray: "6,4" };
}

// Create a ring label DivIcon
function createRingLabel(name: string, rangeKm: number, color: string): L.DivIcon {
  const html = `<span style="font:600 9px 'JetBrains Mono',monospace;color:${color};white-space:nowrap;pointer-events:none;background:rgba(13,17,23,0.75);padding:1px 5px;border-radius:2px;">${name} — ${rangeKm}km</span>`;
  return L.divIcon({
    html,
    className: "",
    iconSize: [120, 14],
    iconAnchor: [60, 7],
  });
}

const TERRAIN_STYLES: Record<string, { fill: string; stroke: string }> = {
  building: { fill: "#30363d", stroke: "#484f58" },
  tower: { fill: "#484f58", stroke: "#8b949e" },
  berm: { fill: "#2d1f00", stroke: "#6e4b00" },
  treeline: { fill: "#0d2818", stroke: "#1a5c30" },
  runway: { fill: "#1c2333", stroke: "#30363d" },
};

const PRIORITY_COLORS: Record<number, string> = {
  1: "#f85149",
  2: "#d29922",
  3: "#3fb950",
};

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function polygonCentroid(points: number[][]): [number, number] {
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p[0];
    cy += p[1];
  }
  return [cx / points.length, cy / points.length];
}

// Create sensor icon (circle with type letter)
function createSensorIcon(
  type: string,
  isSelected: boolean,
): L.DivIcon {
  const letter = SENSOR_TYPE_LETTERS[type] || "?";
  const color = isSelected ? "#58a6ff" : "#58a6ffbb";
  const svg = `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" fill="${color}" stroke="#58a6ff" stroke-width="1.5"/>
    <text x="12" y="12" text-anchor="middle" dominant-baseline="central" fill="#0d1117" font-size="11" font-weight="700" font-family="monospace">${letter}</text>
    ${isSelected ? `<circle cx="12" cy="12" r="14" fill="none" stroke="#ffffff88" stroke-width="2" stroke-dasharray="4,4"/>` : ""}
  </svg>`;
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

// Create effector icon (diamond with first letter)
function createEffectorIcon(
  name: string,
  isSelected: boolean,
): L.DivIcon {
  const letter = name.charAt(0).toUpperCase();
  const color = isSelected ? "#f85149" : "#f85149bb";
  const svg = `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <polygon points="12,2 22,12 12,22 2,12" fill="${color}" stroke="#f85149" stroke-width="1.5"/>
    <text x="12" y="12" text-anchor="middle" dominant-baseline="central" fill="#0d1117" font-size="10" font-weight="700" font-family="monospace">${letter}</text>
    ${isSelected ? `<circle cx="12" cy="12" r="14" fill="none" stroke="#ffffff88" stroke-width="2" stroke-dasharray="4,4"/>` : ""}
  </svg>`;
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

// Create combined system icon (purple hexagon with "N")
function createCombinedIcon(
  name: string,
  isSelected: boolean,
): L.DivIcon {
  const letter = name.charAt(0).toUpperCase();
  const color = isSelected ? "#a371f7" : "#a371f7bb";
  const svg = `<svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
    <polygon points="14,2 25,8 25,20 14,26 3,20 3,8" fill="${color}" stroke="#a371f7" stroke-width="1.5"/>
    <text x="14" y="14" text-anchor="middle" dominant-baseline="central" fill="#0d1117" font-size="11" font-weight="700" font-family="monospace">${letter}</text>
    ${isSelected ? `<circle cx="14" cy="14" r="16" fill="none" stroke="#ffffff88" stroke-width="2" stroke-dasharray="4,4"/>` : ""}
  </svg>`;
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

// Create protected asset icon (star)
function createAssetIcon(
  priority: number,
  name: string,
): L.DivIcon {
  const color = PRIORITY_COLORS[priority] || COLORS.muted;
  const html = `<div style="text-align:center;white-space:nowrap;">
    <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <polygon points="8,1 9.8,5.8 15,6 11,9.5 12.5,15 8,11.5 3.5,15 5,9.5 1,6 6.2,5.8" fill="${color}" stroke="${color}" stroke-width="0.5"/>
    </svg>
    <div style="font:500 9px 'Inter',sans-serif;color:${color};margin-top:1px;">${name}</div>
    <div style="position:absolute;top:-4px;right:-8px;width:12px;height:12px;border-radius:50%;background:${color};font:600 7px 'JetBrains Mono',monospace;color:#0d1117;display:flex;align-items:center;justify-content:center;">${priority}</div>
  </div>`;
  return L.divIcon({
    html,
    className: "",
    iconSize: [60, 32],
    iconAnchor: [30, 8],
  });
}

// Create terrain label
function createTerrainLabel(name: string): L.DivIcon {
  const html = `<span style="font:400 9px 'Inter',sans-serif;color:${COLORS.muted};white-space:nowrap;pointer-events:none;">${name}</span>`;
  return L.divIcon({
    html,
    className: "",
    iconSize: [80, 14],
    iconAnchor: [40, 7],
  });
}

// Create perimeter corner drag handle
function createCornerHandle(): L.DivIcon {
  const svg = `<svg width="14" height="14" viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg">
    <circle cx="7" cy="7" r="6" fill="#d29922" stroke="#ffb800" stroke-width="1.5" opacity="0.9"/>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

// Create midpoint handle for polygon vertex insertion
function createMidpointHandle(): L.DivIcon {
  const svg = `<svg width="10" height="10" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg">
    <circle cx="5" cy="5" r="4" fill="#d29922" stroke="#ffb800" stroke-width="1" opacity="0.6"/>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  });
}

// Create polygon centroid label showing vertex count and area
function createPolygonLabel(text: string): L.DivIcon {
  const html = `<span style="font:600 10px 'JetBrains Mono',monospace;color:#d29922;white-space:nowrap;pointer-events:none;background:rgba(13,17,23,0.85);padding:2px 6px;border-radius:3px;border:1px solid #d2992244;">${text}</span>`;
  return L.divIcon({
    html,
    className: "",
    iconSize: [120, 16],
    iconAnchor: [60, 8],
  });
}

// Shoelace formula for polygon area in km²
function shoelaceArea(vertices: { x: number; y: number }[]): number {
  let area = 0;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += vertices[i].x * vertices[j].y;
    area -= vertices[j].x * vertices[i].y;
  }
  return Math.abs(area) / 2;
}

// Centroid of polygon vertices in game XY
function verticesCentroid(vertices: { x: number; y: number }[]): { x: number; y: number } {
  let cx = 0;
  let cy = 0;
  for (const v of vertices) {
    cx += v.x;
    cy += v.y;
  }
  return { x: cx / vertices.length, y: cy / vertices.length };
}

// Create item name label
function createItemLabel(name: string, isSensor: boolean): L.DivIcon {
  const color = isSensor ? "#58a6ff" : "#f85149";
  const html = `<span style="font:500 9px 'Inter',sans-serif;color:${color};white-space:nowrap;pointer-events:none;">${name}</span>`;
  return L.divIcon({
    html,
    className: "",
    iconSize: [80, 14],
    iconAnchor: [40, -8],
  });
}

// Map click handler for placement
function MapPlacementClickHandler({
  onMapClick,
}: {
  onMapClick: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click: (e) => {
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// Set view on mount
function MapViewController({
  center,
  zoom,
}: {
  center: [number, number];
  zoom: number;
}) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// Map search control component — lives inside MapContainer to access useMap
function MapSearchControl() {
  const map = useMap();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ place_id: number; display_name: string; lat: string; lon: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<number>(0);

  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length < 3) { setResults([]); return; }
    setSearching(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5`,
        { headers: { "User-Agent": "OpenSentry-Training-Sim/1.0" } },
      );
      setResults(await res.json());
    } catch { setResults([]); }
    finally { setSearching(false); }
  }, []);

  const handleInput = useCallback((v: string) => {
    setQuery(v);
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => doSearch(v), 300);
  }, [doSearch]);

  if (!open) {
    return (
      <div
        style={{
          position: "absolute", bottom: 10, left: 10, zIndex: 1000,
        }}
        onClick={(e) => { e.stopPropagation(); L.DomEvent.disableClickPropagation(e.currentTarget); }}
      >
        <button
          onClick={() => setOpen(true)}
          style={{
            padding: "5px 10px",
            background: "rgba(13, 17, 23, 0.8)",
            border: "1px solid #30363d",
            borderRadius: 4,
            color: "#8b949e",
            fontSize: 10,
            fontWeight: 600,
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: 1,
            cursor: "pointer",
          }}
        >
          &#128269; SEARCH LOCATION
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "absolute", bottom: 10, left: 10, zIndex: 1000,
        width: 280, background: "rgba(13, 17, 23, 0.92)", border: "1px solid #30363d",
        borderRadius: 6, padding: 8,
      }}
      onClick={(e) => e.stopPropagation()}
      ref={(el) => { if (el) L.DomEvent.disableClickPropagation(el); }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          placeholder="Search location..."
          autoFocus
          style={{
            flex: 1, padding: "6px 10px", background: "#0d1117",
            border: "1px solid #30363d", borderRadius: 4, color: "#e6edf3",
            fontSize: 12, fontFamily: "'Inter', sans-serif", outline: "none",
          }}
        />
        <button
          onClick={() => { setOpen(false); setQuery(""); setResults([]); }}
          style={{
            background: "none", border: "none", color: "#8b949e",
            cursor: "pointer", fontSize: 14, padding: "2px 4px",
          }}
        >
          &#10005;
        </button>
      </div>
      {searching && <div style={{ fontSize: 10, color: "#8b949e", marginTop: 4 }}>Searching...</div>}
      {results.length > 0 && (
        <div style={{ marginTop: 4, maxHeight: 150, overflowY: "auto" }}>
          {results.map((r) => (
            <div
              key={r.place_id}
              onClick={() => {
                map.setView([parseFloat(r.lat), parseFloat(r.lon)], map.getZoom());
                setOpen(false);
                setQuery("");
                setResults([]);
              }}
              style={{
                padding: "6px 8px", fontSize: 11, color: "#e6edf3",
                cursor: "pointer", borderBottom: "1px solid #21262d",
                lineHeight: 1.3,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "#161b22"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
            >
              {r.display_name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Generate FOV arc polygon points as lat/lng
function generateFovArc(
  centerX: number,
  centerY: number,
  rangeKm: number,
  facingDeg: number,
  fovDeg: number,
  baseLat: number,
  baseLng: number,
  segments: number = 32,
): [number, number][] {
  const points: [number, number][] = [];
  // Center point
  points.push(gameXYToLatLng(centerX, centerY, baseLat, baseLng));

  if (fovDeg >= 360) {
    // Full circle
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * 2 * Math.PI;
      const px = centerX + Math.cos(angle) * rangeKm;
      const py = centerY + Math.sin(angle) * rangeKm;
      points.push(gameXYToLatLng(px, py, baseLat, baseLng));
    }
  } else {
    // Arc: facing_deg is compass bearing (0=N, 90=E)
    // Convert to math angle: math_angle = 90 - compass_bearing
    const facingRad = degToRad(90 - facingDeg);
    const halfFov = degToRad(fovDeg / 2);
    const startAngle = facingRad - halfFov;
    const endAngle = facingRad + halfFov;

    for (let i = 0; i <= segments; i++) {
      const angle = startAngle + (i / segments) * (endAngle - startAngle);
      const px = centerX + Math.cos(angle) * rangeKm;
      const py = centerY + Math.sin(angle) * rangeKm;
      points.push(gameXYToLatLng(px, py, baseLat, baseLng));
    }
  }

  return points;
}

export default function PlacementScreen({
  baseTemplate,
  selectedSensors,
  selectedEffectors,
  selectedCombined = [],
  onConfirm,
  onBack,
}: Props) {
  const [placedItems, setPlacedItems] = useState<PlacedItem[]>([]);
  const [selectedPalette, setSelectedPalette] = useState<number | null>(null);
  const [selectedPlaced, setSelectedPlaced] = useState<number | null>(null);
  const [facingDeg, setFacingDeg] = useState(0);
  const [showRangeRings, setShowRangeRings] = useState(true);

  // Freeform polygon perimeter vertices in game XY (km from base center)
  const [perimVertices, setPerimVertices] = useState<{x: number; y: number}[]>([
    { x: -0.5, y: -0.5 },
    { x: -0.5, y:  0.5 },
    { x:  0.5, y:  0.5 },
    { x:  0.5, y: -0.5 },
  ]);

  // Draggable asset positions
  const [assetPositions, setAssetPositions] = useState<Record<string, { x: number; y: number }>>(
    () => Object.fromEntries(baseTemplate.protected_assets.map(a => [a.id, { x: a.x, y: a.y }]))
  );

  const { lat: baseLat, lng: baseLng } = getBaseCenter(baseTemplate);
  const baseCenter: [number, number] = [baseLat, baseLng];

  // Compute zoom level based on placement bounds
  const zoom = useMemo(() => {
    const bounds = baseTemplate.placement_bounds_km;
    if (bounds <= 0.4) return 16;
    if (bounds <= 0.9) return 15;
    if (bounds <= 1.5) return 14;
    return 13;
  }, [baseTemplate.placement_bounds_km]);

  // Polygon perimeter as lat/lng positions
  const perimPositions = useMemo(
    () => perimVertices.map(v => gameXYToLatLng(v.x, v.y, baseLat, baseLng)),
    [perimVertices, baseLat, baseLng],
  );

  // Polygon area and centroid
  const perimArea = useMemo(() => shoelaceArea(perimVertices), [perimVertices]);
  const perimCentroid = useMemo(() => verticesCentroid(perimVertices), [perimVertices]);
  const perimLabelPos = useMemo(
    () => gameXYToLatLng(perimCentroid.x, perimCentroid.y, baseLat, baseLng),
    [perimCentroid, baseLat, baseLng],
  );

  // Midpoints between consecutive vertices
  const perimMidpoints = useMemo(() => {
    return perimVertices.map((v, i) => {
      const next = perimVertices[(i + 1) % perimVertices.length];
      return {
        x: (v.x + next.x) / 2,
        y: (v.y + next.y) / 2,
        afterIndex: i,
      };
    });
  }, [perimVertices]);

  const resetPerimeter = useCallback(() => {
    setPerimVertices([
      { x: -0.5, y: -0.5 },
      { x: -0.5, y:  0.5 },
      { x:  0.5, y:  0.5 },
      { x:  0.5, y: -0.5 },
    ]);
  }, []);

  // Build palette list
  const paletteItems: PaletteItem[] = [
    ...selectedSensors.map((s, i) => ({
      kind: "sensor" as const,
      index: i,
      catalog: s,
    })),
    ...selectedEffectors.map((e, i) => ({
      kind: "effector" as const,
      index: i,
      catalog: e,
    })),
    ...selectedCombined.map((c, i) => ({
      kind: "combined" as const,
      index: i,
      catalog: c,
    })),
  ];

  // Build instance labels for duplicate items (e.g., "EO/IR Camera #1", "EO/IR Camera #2")
  const sensorInstanceLabels = useMemo(() => {
    const counts: Record<string, number> = {};
    selectedSensors.forEach((s) => { counts[s.catalog_id] = (counts[s.catalog_id] || 0) + 1; });
    const seen: Record<string, number> = {};
    return selectedSensors.map((s) => {
      seen[s.catalog_id] = (seen[s.catalog_id] || 0) + 1;
      return counts[s.catalog_id] > 1 ? `${s.name} #${seen[s.catalog_id]}` : s.name;
    });
  }, [selectedSensors]);

  const effectorInstanceLabels = useMemo(() => {
    const counts: Record<string, number> = {};
    selectedEffectors.forEach((e) => { counts[e.catalog_id] = (counts[e.catalog_id] || 0) + 1; });
    const seen: Record<string, number> = {};
    return selectedEffectors.map((e) => {
      seen[e.catalog_id] = (seen[e.catalog_id] || 0) + 1;
      return counts[e.catalog_id] > 1 ? `${e.name} #${seen[e.catalog_id]}` : e.name;
    });
  }, [selectedEffectors]);

  const combinedInstanceLabels = useMemo(() => {
    const counts: Record<string, number> = {};
    selectedCombined.forEach((c) => { counts[c.catalog_id] = (counts[c.catalog_id] || 0) + 1; });
    const seen: Record<string, number> = {};
    return selectedCombined.map((c) => {
      seen[c.catalog_id] = (seen[c.catalog_id] || 0) + 1;
      return counts[c.catalog_id] > 1 ? `${c.name} #${seen[c.catalog_id]}` : c.name;
    });
  }, [selectedCombined]);

  // Track which palette items are placed
  const placedSet = new Set(
    placedItems.map((p) => `${p.kind}-${p.catalogIndex}`),
  );

  const allPlaced = paletteItems.every((pi) =>
    placedSet.has(`${pi.kind}-${pi.index}`),
  );

  // When selecting a placed item, sync facing slider
  useEffect(() => {
    if (selectedPlaced !== null && placedItems[selectedPlaced]) {
      setFacingDeg(placedItems[selectedPlaced].equipment.facing_deg);
    }
  }, [selectedPlaced, placedItems]);

  // Update facing of selected placed item
  const handleFacingChange = useCallback(
    (newFacing: number) => {
      setFacingDeg(newFacing);
      if (selectedPlaced !== null) {
        setPlacedItems((prev) =>
          prev.map((item, i) =>
            i === selectedPlaced
              ? {
                  ...item,
                  equipment: { ...item.equipment, facing_deg: newFacing },
                }
              : item,
          ),
        );
      }
    },
    [selectedPlaced],
  );

  // Get catalog data for a placed item
  const getCatalog = useCallback(
    (item: PlacedItem): CatalogSensor | CatalogEffector | CatalogCombined => {
      if (item.kind === "sensor") return selectedSensors[item.catalogIndex];
      if (item.kind === "combined") return selectedCombined[item.catalogIndex];
      return selectedEffectors[item.catalogIndex];
    },
    [selectedSensors, selectedEffectors, selectedCombined],
  );

  // Map click handler — places equipment
  const handleMapClick = useCallback(
    (lat: number, lng: number) => {
      const { x: wx, y: wy } = latLngToGameXY(lat, lng, baseLat, baseLng);

      // If a palette item is selected, place it
      if (selectedPalette !== null) {
        const pi = paletteItems[selectedPalette];
        const key = `${pi.kind}-${pi.index}`;

        const existingIdx = placedItems.findIndex(
          (p) => `${p.kind}-${p.catalogIndex}` === key,
        );

        const newEquipment: PlacedEquipment = {
          catalog_id: pi.catalog.catalog_id,
          x: Math.round(wx * 100) / 100,
          y: Math.round(wy * 100) / 100,
          facing_deg: facingDeg,
        };

        if (existingIdx >= 0) {
          setPlacedItems((prev) =>
            prev.map((item, i) =>
              i === existingIdx ? { ...item, equipment: newEquipment } : item,
            ),
          );
        } else {
          setPlacedItems((prev) => [
            ...prev,
            {
              equipment: newEquipment,
              kind: pi.kind,
              catalogIndex: pi.index,
            },
          ]);
        }
        setSelectedPalette(null);
        setSelectedPlaced(null);
      } else {
        setSelectedPlaced(null);
      }
    },
    [placedItems, selectedPalette, paletteItems, facingDeg, baseLat, baseLng],
  );

  // Coverage analysis for right sidebar
  const computeCoverage = useCallback(() => {
    const corridors = baseTemplate.approach_corridors;
    return corridors.map((corridor) => {
      const bearingRad = degToRad(corridor.bearing_deg);
      const halfWidth = degToRad(corridor.width_deg / 2);

      const coveringSensors: string[] = [];
      for (const item of placedItems) {
        if (item.kind !== "sensor") continue;
        const cat = selectedSensors[item.catalogIndex];
        const eq = item.equipment;

        if (cat.fov_deg >= 360) {
          coveringSensors.push(cat.name);
          continue;
        }

        const facingRad = degToRad(eq.facing_deg);
        const halfFov = degToRad(cat.fov_deg / 2);

        let angleDiff = bearingRad - facingRad;
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

        if (Math.abs(angleDiff) <= halfFov + halfWidth) {
          coveringSensors.push(cat.name);
        }
      }

      return {
        name: corridor.name,
        bearing_deg: corridor.bearing_deg,
        covered: coveringSensors.length > 0,
        sensors: coveringSensors,
      };
    });
  }, [baseTemplate, placedItems, selectedSensors]);

  const coverage = computeCoverage();

  const coveredCount = coverage.filter((c) => c.covered).length;
  const coveragePct =
    coverage.length > 0
      ? Math.round((coveredCount / coverage.length) * 100)
      : 0;

  // Build PlacementConfig and confirm
  const handleConfirm = useCallback(() => {
    // Derive boundary from polygon vertices (game XY km coords)
    const boundary: number[][] = perimVertices.map(v => [v.x, v.y]);
    // placement_bounds_km = 1.5× largest dimension of bounding box
    const xs = perimVertices.map(v => v.x);
    const ys = perimVertices.map(v => v.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    const maxDim = Math.max(width, height);
    const placementBoundsKm = Math.max(maxDim * 1.5, baseTemplate.placement_bounds_km);

    const movedAssets = baseTemplate.protected_assets
      .filter(a => assetPositions[a.id].x !== a.x || assetPositions[a.id].y !== a.y)
      .map(a => ({ id: a.id, x: assetPositions[a.id].x, y: assetPositions[a.id].y }));

    const config: PlacementConfig = {
      base_id: baseTemplate.id,
      sensors: placedItems
        .filter((p) => p.kind === "sensor")
        .map((p) => p.equipment),
      effectors: placedItems
        .filter((p) => p.kind === "effector")
        .map((p) => p.equipment),
      combined: placedItems
        .filter((p) => p.kind === "combined")
        .map((p) => p.equipment),
      boundary,
      placement_bounds_km: placementBoundsKm,
      ...(movedAssets.length > 0 ? { moved_assets: movedAssets } : {}),
    };
    onConfirm(config);
  }, [baseTemplate.id, baseTemplate.placement_bounds_km, baseTemplate.protected_assets, placedItems, onConfirm, perimVertices, assetPositions]);

  // Active selection info for palette
  const activeItem =
    selectedPalette !== null
      ? paletteItems[selectedPalette]
      : selectedPlaced !== null
        ? {
            kind: placedItems[selectedPlaced].kind,
            index: placedItems[selectedPlaced].catalogIndex,
            catalog: getCatalog(placedItems[selectedPlaced]),
          }
        : null;

  // Approach corridor lines
  const corridorLines = useMemo(() => {
    const boundsKm = baseTemplate.placement_bounds_km * 1.2;
    return baseTemplate.approach_corridors.map((corridor) => {
      const bearingRad = degToRad(90 - corridor.bearing_deg);
      const endX = Math.cos(bearingRad) * boundsKm;
      const endY = Math.sin(bearingRad) * boundsKm;
      const end = gameXYToLatLng(endX, endY, baseLat, baseLng);
      const labelDist = boundsKm * 0.85;
      const labelX = Math.cos(bearingRad) * labelDist;
      const labelY = Math.sin(bearingRad) * labelDist;
      const labelPos = gameXYToLatLng(labelX, labelY, baseLat, baseLng);
      return { corridor, end, labelPos };
    });
  }, [baseTemplate, baseLat, baseLng]);

  // Terrain polygons as lat/lng
  const terrainPolygons = useMemo(
    () =>
      baseTemplate.terrain.map((t) => ({
        terrain: t,
        positions: gamePolygonToLatLng(t.polygon, baseLat, baseLng),
        centroid: gameXYToLatLng(
          ...polygonCentroid(t.polygon),
          baseLat,
          baseLng,
        ),
      })),
    [baseTemplate.terrain, baseLat, baseLng],
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: COLORS.bg,
        color: COLORS.text,
        fontFamily: "'Inter', sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 20px",
          borderBottom: `1px solid ${COLORS.border}`,
          background: COLORS.card,
          minHeight: 48,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              color: COLORS.muted,
              letterSpacing: 2,
              textTransform: "uppercase",
            }}
          >
            Base Defense Planner
          </span>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: COLORS.text,
            }}
          >
            {baseTemplate.name}
          </span>
        </div>
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            color: COLORS.muted,
          }}
        >
          {placedItems.length}/{paletteItems.length} placed
        </div>
      </div>

      {/* Main content */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Left sidebar: Equipment Palette */}
        <div
          style={{
            width: 240,
            borderRight: `1px solid ${COLORS.border}`,
            background: COLORS.card,
            display: "flex",
            flexDirection: "column",
            overflowY: "auto",
          }}
        >
          <div
            style={{
              padding: "12px 16px 8px",
              fontSize: 11,
              fontWeight: 600,
              color: COLORS.muted,
              letterSpacing: 1,
              textTransform: "uppercase",
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Equipment
          </div>

          {/* Sensors */}
          {selectedSensors.length > 0 && (
            <>
              <div
                style={{
                  padding: "8px 16px 4px",
                  fontSize: 10,
                  fontWeight: 600,
                  color: COLORS.accent,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                Sensors
              </div>
              {selectedSensors.map((sensor, i) => {
                const paletteIdx = i;
                const isPlaced = placedSet.has(`sensor-${i}`);
                const isActive = selectedPalette === paletteIdx;

                return (
                  <div
                    key={`sensor-${i}`}
                    onClick={() => {
                      setSelectedPalette(isActive ? null : paletteIdx);
                      setSelectedPlaced(null);
                    }}
                    style={{
                      padding: "8px 16px",
                      cursor: "pointer",
                      background: isActive ? "#58a6ff18" : "transparent",
                      borderLeft: isActive
                        ? `2px solid ${COLORS.accent}`
                        : "2px solid transparent",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive)
                        (e.currentTarget as HTMLDivElement).style.background =
                          "#ffffff08";
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive)
                        (e.currentTarget as HTMLDivElement).style.background =
                          "transparent";
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: COLORS.text,
                          }}
                        >
                          {sensorInstanceLabels[i]}
                        </span>
                      </div>
                      {isPlaced && (
                        <span
                          style={{
                            color: COLORS.success,
                            fontSize: 14,
                            fontWeight: 700,
                          }}
                        >
                          ✓
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        marginTop: 4,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 9,
                          padding: "1px 5px",
                          borderRadius: 3,
                          background: "#58a6ff22",
                          color: COLORS.accent,
                          fontFamily: "'JetBrains Mono', monospace",
                          fontWeight: 600,
                          textTransform: "uppercase",
                        }}
                      >
                        {sensor.type}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          color: COLORS.muted,
                          fontFamily: "'JetBrains Mono', monospace",
                        }}
                      >
                        {sensor.range_km}km /{" "}
                        {sensor.fov_deg >= 360
                          ? "360°"
                          : `${sensor.fov_deg}°`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* Effectors */}
          {selectedEffectors.length > 0 && (
            <>
              <div
                style={{
                  padding: "12px 16px 4px",
                  fontSize: 10,
                  fontWeight: 600,
                  color: COLORS.danger,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                Effectors
              </div>
              {selectedEffectors.map((effector, i) => {
                const paletteIdx = selectedSensors.length + i;
                const isPlaced = placedSet.has(`effector-${i}`);
                const isActive = selectedPalette === paletteIdx;

                return (
                  <div
                    key={`effector-${i}`}
                    onClick={() => {
                      setSelectedPalette(isActive ? null : paletteIdx);
                      setSelectedPlaced(null);
                    }}
                    style={{
                      padding: "8px 16px",
                      cursor: "pointer",
                      background: isActive ? "#f8514918" : "transparent",
                      borderLeft: isActive
                        ? `2px solid ${COLORS.danger}`
                        : "2px solid transparent",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive)
                        (e.currentTarget as HTMLDivElement).style.background =
                          "#ffffff08";
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive)
                        (e.currentTarget as HTMLDivElement).style.background =
                          "transparent";
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: COLORS.text,
                        }}
                      >
                        {effectorInstanceLabels[i]}
                      </span>
                      {isPlaced && (
                        <span
                          style={{
                            color: COLORS.success,
                            fontSize: 14,
                            fontWeight: 700,
                          }}
                        >
                          ✓
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        marginTop: 4,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 9,
                          padding: "1px 5px",
                          borderRadius: 3,
                          background: "#f8514922",
                          color: COLORS.danger,
                          fontFamily: "'JetBrains Mono', monospace",
                          fontWeight: 600,
                          textTransform: "uppercase",
                        }}
                      >
                        {effector.type}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          color: COLORS.muted,
                          fontFamily: "'JetBrains Mono', monospace",
                        }}
                      >
                        {effector.range_km}km /{" "}
                        {effector.fov_deg >= 360
                          ? "360°"
                          : `${effector.fov_deg}°`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* Combined Systems */}
          {selectedCombined.length > 0 && (
            <>
              <div
                style={{
                  padding: "12px 16px 4px",
                  fontSize: 10,
                  fontWeight: 600,
                  color: "#a371f7",
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                Combined
              </div>
              {selectedCombined.map((item, i) => {
                const paletteIdx = selectedSensors.length + selectedEffectors.length + i;
                const isPlaced = placedSet.has(`combined-${i}`);
                const isActive = selectedPalette === paletteIdx;

                return (
                  <div
                    key={`combined-${i}`}
                    onClick={() => {
                      setSelectedPalette(isActive ? null : paletteIdx);
                      setSelectedPlaced(null);
                    }}
                    style={{
                      padding: "8px 16px",
                      cursor: "pointer",
                      background: isActive ? "#a371f718" : "transparent",
                      borderLeft: isActive
                        ? "2px solid #a371f7"
                        : "2px solid transparent",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive)
                        (e.currentTarget as HTMLDivElement).style.background =
                          "#ffffff08";
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive)
                        (e.currentTarget as HTMLDivElement).style.background =
                          "transparent";
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: COLORS.text,
                        }}
                      >
                        {combinedInstanceLabels[i]}
                      </span>
                      {isPlaced && (
                        <span
                          style={{
                            color: COLORS.success,
                            fontSize: 14,
                            fontWeight: 700,
                          }}
                        >
                          ✓
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        marginTop: 4,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 9,
                          padding: "1px 5px",
                          borderRadius: 3,
                          background: "#a371f722",
                          color: "#a371f7",
                          fontFamily: "'JetBrains Mono', monospace",
                          fontWeight: 600,
                          textTransform: "uppercase",
                        }}
                      >
                        DETECT+DEFEAT
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          color: COLORS.muted,
                          fontFamily: "'JetBrains Mono', monospace",
                        }}
                      >
                        {item.sensor_range_km}/{item.effector_range_km}km
                      </span>
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* Facing slider */}
          <div
            style={{
              padding: "16px",
              borderTop: `1px solid ${COLORS.border}`,
              marginTop: "auto",
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: COLORS.muted,
                letterSpacing: 1,
                textTransform: "uppercase",
                fontFamily: "'JetBrains Mono', monospace",
                marginBottom: 8,
              }}
            >
              Facing Direction
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <input
                type="range"
                min={0}
                max={360}
                step={1}
                value={facingDeg}
                onChange={(e) => handleFacingChange(Number(e.target.value))}
                disabled={activeItem === null}
                style={{
                  flex: 1,
                  accentColor: COLORS.accent,
                  opacity: activeItem === null ? 0.3 : 1,
                }}
              />
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 12,
                  color: activeItem === null ? COLORS.border : COLORS.text,
                  minWidth: 36,
                  textAlign: "right",
                }}
              >
                {facingDeg}°
              </span>
            </div>
            {activeItem !== null &&
              activeItem.catalog.fov_deg < 360 &&
              selectedPlaced !== null && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginTop: 8,
                  }}
                >
                  <button
                    onClick={() =>
                      handleFacingChange((facingDeg - 15 + 360) % 360)
                    }
                    style={{
                      flex: 1,
                      padding: "4px 0",
                      background: "transparent",
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: 4,
                      color: COLORS.text,
                      fontSize: 12,
                      fontWeight: 600,
                      fontFamily: "'JetBrains Mono', monospace",
                      cursor: "pointer",
                      transition: "border-color 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      (
                        e.currentTarget as HTMLButtonElement
                      ).style.borderColor = COLORS.accent;
                    }}
                    onMouseLeave={(e) => {
                      (
                        e.currentTarget as HTMLButtonElement
                      ).style.borderColor = COLORS.border;
                    }}
                  >
                    -15°
                  </button>
                  <button
                    onClick={() => handleFacingChange((facingDeg + 15) % 360)}
                    style={{
                      flex: 1,
                      padding: "4px 0",
                      background: "transparent",
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: 4,
                      color: COLORS.text,
                      fontSize: 12,
                      fontWeight: 600,
                      fontFamily: "'JetBrains Mono', monospace",
                      cursor: "pointer",
                      transition: "border-color 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      (
                        e.currentTarget as HTMLButtonElement
                      ).style.borderColor = COLORS.accent;
                    }}
                    onMouseLeave={(e) => {
                      (
                        e.currentTarget as HTMLButtonElement
                      ).style.borderColor = COLORS.border;
                    }}
                  >
                    +15°
                  </button>
                </div>
              )}
            <div
              style={{
                fontSize: 10,
                color: COLORS.muted,
                marginTop: 4,
              }}
            >
              {activeItem
                ? `${activeItem.catalog.name} — ${activeItem.catalog.fov_deg >= 360 ? "omnidirectional" : `${activeItem.catalog.fov_deg}° FOV`}`
                : "Select an item to adjust"}
            </div>
          </div>
        </div>

        {/* Center: Leaflet Map */}
        <div
          style={{
            flex: 1,
            position: "relative",
            overflow: "hidden",
            background: COLORS.bg,
          }}
        >
          <MapContainer
            center={baseCenter}
            zoom={zoom}
            zoomControl={false}
            attributionControl={false}
            style={{
              width: "100%",
              height: "100%",
              background: COLORS.bg,
              cursor: selectedPalette !== null ? "crosshair" : "default",
            }}
          >
            <MapViewController center={baseCenter} zoom={zoom} />
            <MapPlacementClickHandler onMapClick={handleMapClick} />
            <ScaleControl position="bottomleft" />

            <LayersControl position="topright">
              <LayersControl.BaseLayer name="Dark">
                <TileLayer
                  url="https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                  maxZoom={20}
                />
              </LayersControl.BaseLayer>
              <LayersControl.BaseLayer name="Satellite" checked>
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

            {/* Freeform polygon perimeter */}
            <Polygon
              positions={perimPositions}
              pathOptions={{
                color: "#d29922",
                fillColor: "#d29922",
                fillOpacity: 0.06,
                weight: 2,
                dashArray: "8,4",
              }}
            />
            {/* Vertex drag handles */}
            {perimVertices.map((v, i) => {
              const pos = gameXYToLatLng(v.x, v.y, baseLat, baseLng);
              return (
                <Marker
                  key={`perim-v-${i}`}
                  position={pos}
                  icon={createCornerHandle()}
                  draggable
                  eventHandlers={{
                    dragend: (e: L.LeafletEvent) => {
                      const latlng = (e.target as L.Marker).getLatLng();
                      const { x, y } = latLngToGameXY(latlng.lat, latlng.lng, baseLat, baseLng);
                      setPerimVertices(prev => prev.map((pv, j) =>
                        j === i ? { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 } : pv
                      ));
                    },
                    contextmenu: (e: L.LeafletMouseEvent) => {
                      L.DomEvent.preventDefault(e.originalEvent);
                      L.DomEvent.stopPropagation(e.originalEvent);
                      if (perimVertices.length > 3) {
                        setPerimVertices(prev => prev.filter((_, j) => j !== i));
                      }
                    },
                  }}
                />
              );
            })}
            {/* Midpoint handles — click to insert vertex */}
            {perimMidpoints.map((mp, i) => {
              const pos = gameXYToLatLng(mp.x, mp.y, baseLat, baseLng);
              return (
                <Marker
                  key={`perim-mid-${i}`}
                  position={pos}
                  icon={createMidpointHandle()}
                  eventHandlers={{
                    click: (e: L.LeafletMouseEvent) => {
                      L.DomEvent.stopPropagation(e.originalEvent);
                      const insertIdx = mp.afterIndex + 1;
                      setPerimVertices(prev => [
                        ...prev.slice(0, insertIdx),
                        { x: Math.round(mp.x * 100) / 100, y: Math.round(mp.y * 100) / 100 },
                        ...prev.slice(insertIdx),
                      ]);
                    },
                  }}
                />
              );
            })}
            {/* Polygon centroid label */}
            <Marker
              position={perimLabelPos}
              icon={createPolygonLabel(`${perimVertices.length} pts — ${perimArea.toFixed(1)} km²`)}
              interactive={false}
            />

            {/* Terrain features */}
            {terrainPolygons.map(({ terrain, positions, centroid }) => {
              const style =
                TERRAIN_STYLES[terrain.type] || TERRAIN_STYLES.building;
              return (
                <span key={terrain.id}>
                  <Polygon
                    positions={positions}
                    pathOptions={{
                      color: style.stroke,
                      fillColor: style.fill,
                      fillOpacity: 0.8,
                      weight: 1,
                    }}
                  />
                  <Marker
                    position={centroid}
                    icon={createTerrainLabel(terrain.name)}
                    interactive={false}
                  />
                </span>
              );
            })}

            {/* Protected assets (draggable) */}
            {baseTemplate.protected_assets.map((asset) => {
              const ap = assetPositions[asset.id] || { x: asset.x, y: asset.y };
              const pos = gameXYToLatLng(ap.x, ap.y, baseLat, baseLng);
              return (
                <Marker
                  key={asset.id}
                  position={pos}
                  icon={createAssetIcon(asset.priority, asset.name)}
                  draggable
                  eventHandlers={{
                    dragend: (e: L.LeafletEvent) => {
                      const latlng = (e.target as L.Marker).getLatLng();
                      const { x, y } = latLngToGameXY(latlng.lat, latlng.lng, baseLat, baseLng);
                      setAssetPositions(prev => ({
                        ...prev,
                        [asset.id]: { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 },
                      }));
                    },
                  }}
                />
              );
            })}

            {/* Approach corridors */}
            {corridorLines.map(({ corridor, end, labelPos }) => (
              <span key={corridor.name}>
                <Polyline
                  positions={[baseCenter, end]}
                  pathOptions={{
                    color: "#484f5866",
                    weight: 1,
                    dashArray: "6,6",
                  }}
                />
                <Marker
                  position={labelPos}
                  icon={createTerrainLabel(corridor.name)}
                  interactive={false}
                />
              </span>
            ))}

            {/* Coverage arcs for placed sensors */}
            {placedItems.map((item, pi) => {
              if (item.kind !== "sensor") return null;
              const cat = selectedSensors[item.catalogIndex];
              const eq = item.equipment;
              const style = getRingStyle(eq.catalog_id, true);

              const arcPositions = generateFovArc(
                eq.x,
                eq.y,
                cat.range_km,
                eq.facing_deg,
                cat.fov_deg,
                baseLat,
                baseLng,
              );

              return (
                <Polygon
                  key={`coverage-${pi}`}
                  positions={arcPositions}
                  pathOptions={{
                    color: "transparent",
                    fillColor: style.color,
                    fillOpacity: 0.04,
                    weight: 0,
                  }}
                />
              );
            })}

            {/* Placed items: range arcs and icons */}
            {placedItems.map((item, pi) => {
              const cat = getCatalog(item);
              const eq = item.equipment;
              const pos = gameXYToLatLng(eq.x, eq.y, baseLat, baseLng);
              const isSelected = selectedPlaced === pi;
              const isSensor = item.kind === "sensor";
              const isCombined = item.kind === "combined";
              const ringStyle = getRingStyle(eq.catalog_id, isSensor || isCombined);
              const shouldShowRing = showRangeRings || isSelected;

              // For combined systems, show two rings (detect + defeat)
              const combCat = isCombined ? (cat as CatalogCombined) : null;
              const primaryRange = isCombined ? combCat!.sensor_range_km : (cat as CatalogSensor | CatalogEffector).range_km;
              const primaryFov = cat.fov_deg;

              // Range arc/circle
              const rangeArcPositions = generateFovArc(
                eq.x, eq.y, primaryRange, eq.facing_deg, primaryFov, baseLat, baseLng,
              );

              // Ring label position: offset north of the ring edge
              const labelAngleRad = degToRad(90 - eq.facing_deg);
              const labelX = eq.x + Math.cos(labelAngleRad) * primaryRange;
              const labelY = eq.y + Math.sin(labelAngleRad) * primaryRange;
              const labelPos = gameXYToLatLng(labelX, labelY, baseLat, baseLng);

              return (
                <span key={`item-${pi}`}>
                  {/* Range arc/ring — primary (detect for combined, normal for others) */}
                  {shouldShowRing && (primaryFov >= 360 ? (
                    <Circle
                      center={pos}
                      radius={primaryRange * 1000}
                      pathOptions={{
                        color: ringStyle.color,
                        fillColor: ringStyle.color,
                        fillOpacity: isSelected ? 0.08 : 0.05,
                        weight: isSelected ? 2 : 1.5,
                        opacity: 0.7,
                        dashArray: ringStyle.dashArray,
                      }}
                    />
                  ) : (
                    <Polygon
                      positions={rangeArcPositions}
                      pathOptions={{
                        color: ringStyle.color,
                        fillColor: ringStyle.color,
                        fillOpacity: isSelected ? 0.12 : 0.08,
                        weight: isSelected ? 2 : 1.5,
                        opacity: 0.7,
                        dashArray: ringStyle.dashArray,
                      }}
                    />
                  ))}

                  {/* Combined systems: second ring for defeat range */}
                  {shouldShowRing && isCombined && combCat && (
                    <Circle
                      center={pos}
                      radius={combCat.effector_range_km * 1000}
                      pathOptions={{
                        color: "#d63bf8",
                        fillColor: "#d63bf8",
                        fillOpacity: isSelected ? 0.06 : 0.03,
                        weight: isSelected ? 2 : 1.5,
                        opacity: 0.6,
                        dashArray: "4,4",
                      }}
                    />
                  )}

                  {/* Ring label */}
                  {shouldShowRing && (
                    <Marker
                      position={labelPos}
                      icon={createRingLabel(
                        isCombined ? `${cat.name} DETECT` : cat.name,
                        primaryRange,
                        ringStyle.color,
                      )}
                      interactive={false}
                    />
                  )}
                  {/* Combined defeat ring label */}
                  {shouldShowRing && isCombined && combCat && (() => {
                    const defLabelX = eq.x + Math.cos(labelAngleRad) * combCat.effector_range_km;
                    const defLabelY = eq.y + Math.sin(labelAngleRad) * combCat.effector_range_km;
                    const defLabelPos = gameXYToLatLng(defLabelX, defLabelY, baseLat, baseLng);
                    return (
                      <Marker
                        position={defLabelPos}
                        icon={createRingLabel(`${cat.name} DEFEAT`, combCat.effector_range_km, "#d63bf8")}
                        interactive={false}
                      />
                    );
                  })()}

                  {/* Icon marker */}
                  <Marker
                    position={pos}
                    icon={
                      isCombined
                        ? createCombinedIcon(cat.name, isSelected)
                        : isSensor
                          ? createSensorIcon(
                              (cat as CatalogSensor).type,
                              isSelected,
                            )
                          : createEffectorIcon(cat.name, isSelected)
                    }
                    eventHandlers={{
                      click: (e) => {
                        L.DomEvent.stopPropagation(e.originalEvent);
                        setSelectedPlaced(pi);
                        setSelectedPalette(null);
                      },
                      contextmenu: (e) => {
                        L.DomEvent.preventDefault(e.originalEvent);
                        L.DomEvent.stopPropagation(e.originalEvent);
                        setPlacedItems((prev) =>
                          prev.filter((_, idx) => idx !== pi),
                        );
                        if (selectedPlaced === pi) setSelectedPlaced(null);
                        else if (
                          selectedPlaced !== null &&
                          selectedPlaced > pi
                        )
                          setSelectedPlaced(selectedPlaced - 1);
                      },
                    }}
                  />

                  {/* Name label */}
                  <Marker
                    position={pos}
                    icon={createItemLabel(cat.name, isSensor || isCombined)}
                    interactive={false}
                  />
                </span>
              );
            })}

            {/* Base center marker */}
            <Circle
              center={baseCenter}
              radius={5}
              pathOptions={{
                color: COLORS.accent,
                fillColor: COLORS.accent,
                fillOpacity: 1,
                weight: 0,
              }}
            />

            {/* Location search control */}
            <MapSearchControl />
          </MapContainer>

          {/* Range rings toggle */}
          <button
            onClick={() => setShowRangeRings((v) => !v)}
            style={{
              position: "absolute",
              top: 10,
              left: 10,
              zIndex: 1000,
              padding: "5px 10px",
              background: showRangeRings ? "rgba(88, 166, 255, 0.15)" : "rgba(13, 17, 23, 0.8)",
              border: `1px solid ${showRangeRings ? "#58a6ff55" : COLORS.border}`,
              borderRadius: 4,
              color: showRangeRings ? "#58a6ff" : COLORS.muted,
              fontSize: 10,
              fontWeight: 600,
              fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: 1,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            RANGE RINGS {showRangeRings ? "ON" : "OFF"}
          </button>

          {/* Instructions overlay */}
          {placedItems.length === 0 && selectedPalette === null && (
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                textAlign: "center",
                color: COLORS.muted,
                pointerEvents: "none",
                zIndex: 1000,
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  marginBottom: 8,
                }}
              >
                Select equipment from the left panel
              </div>
              <div style={{ fontSize: 12 }}>
                Click the map to place. Right-click to remove.
              </div>
            </div>
          )}
        </div>

        {/* Right sidebar: Coverage Summary */}
        <div
          style={{
            width: 240,
            borderLeft: `1px solid ${COLORS.border}`,
            background: COLORS.card,
            display: "flex",
            flexDirection: "column",
            overflowY: "auto",
          }}
        >
          {/* Perimeter control panel */}
          <div
            style={{
              padding: "12px 16px 8px",
              fontSize: 11,
              fontWeight: 600,
              color: "#d29922",
              letterSpacing: 1,
              textTransform: "uppercase",
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Perimeter
          </div>
          <div style={{ padding: "4px 16px 12px" }}>
            <div
              style={{
                fontSize: 10,
                color: COLORS.muted,
                marginBottom: 6,
                lineHeight: 1.4,
              }}
            >
              Drag vertices to reshape. Click midpoints to add. Right-click vertex to remove.
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 6,
                marginBottom: 8,
              }}
            >
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  fontFamily: "'JetBrains Mono', monospace",
                  color: "#d29922",
                }}
              >
                {perimVertices.length} pts — {perimArea.toFixed(1)}
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: COLORS.muted,
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                km²
              </span>
            </div>
            <button
              onClick={resetPerimeter}
              style={{
                padding: "4px 10px",
                background: "transparent",
                border: `1px solid ${COLORS.border}`,
                borderRadius: 4,
                color: COLORS.muted,
                fontSize: 10,
                fontWeight: 600,
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: 0.5,
                cursor: "pointer",
                transition: "border-color 0.15s, color 0.15s",
                width: "100%",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = "#d29922";
                (e.currentTarget as HTMLButtonElement).style.color = "#d29922";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = COLORS.border;
                (e.currentTarget as HTMLButtonElement).style.color = COLORS.muted;
              }}
            >
              Reset to default (1km²)
            </button>
          </div>

          <div
            style={{
              borderTop: `1px solid ${COLORS.border}`,
              padding: "12px 16px 8px",
              fontSize: 11,
              fontWeight: 600,
              color: COLORS.muted,
              letterSpacing: 1,
              textTransform: "uppercase",
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Coverage Analysis
          </div>

          {/* Coverage percentage */}
          <div
            style={{
              padding: "8px 16px 12px",
              display: "flex",
              alignItems: "baseline",
              gap: 6,
            }}
          >
            <span
              style={{
                fontSize: 28,
                fontWeight: 700,
                fontFamily: "'JetBrains Mono', monospace",
                color:
                  coveragePct === 100
                    ? COLORS.success
                    : coveragePct >= 50
                      ? COLORS.warning
                      : COLORS.danger,
              }}
            >
              {coveragePct}%
            </span>
            <span
              style={{
                fontSize: 11,
                color: COLORS.muted,
                fontFamily: "'JetBrains Mono', monospace",
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              Coverage
            </span>
          </div>

          {/* Approach corridors */}
          <div
            style={{
              padding: "8px 16px 4px",
              fontSize: 10,
              fontWeight: 600,
              color: COLORS.muted,
              letterSpacing: 1,
              textTransform: "uppercase",
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Approach Corridors
          </div>

          {coverage.map((c, i) => (
            <div
              key={i}
              style={{
                padding: "8px 16px",
                borderLeft: `2px solid ${c.covered ? COLORS.success : COLORS.danger}`,
                margin: "2px 0",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: COLORS.text,
                  }}
                >
                  {c.name}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontFamily: "'JetBrains Mono', monospace",
                    color: COLORS.muted,
                  }}
                >
                  {c.bearing_deg}°
                </span>
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: c.covered ? COLORS.success : COLORS.danger,
                  marginTop: 4,
                  fontWeight: 500,
                }}
              >
                {c.covered
                  ? `Covered: ${c.sensors.join(", ")}`
                  : "GAP — No sensor coverage"}
              </div>
            </div>
          ))}

          {/* Summary stats */}
          <div
            style={{
              padding: "16px",
              borderTop: `1px solid ${COLORS.border}`,
              marginTop: 16,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: COLORS.muted,
                letterSpacing: 1,
                textTransform: "uppercase",
                fontFamily: "'JetBrains Mono', monospace",
                marginBottom: 8,
              }}
            >
              Summary
            </div>
            <div
              style={{ display: "flex", flexDirection: "column", gap: 6 }}
            >
              <SummaryRow
                label="Corridors covered"
                value={`${coverage.filter((c) => c.covered).length}/${coverage.length}`}
                color={
                  coverage.every((c) => c.covered)
                    ? COLORS.success
                    : COLORS.warning
                }
              />
              <SummaryRow
                label="Sensors placed"
                value={`${placedItems.filter((p) => p.kind === "sensor").length}/${selectedSensors.length}`}
                color={COLORS.accent}
              />
              <SummaryRow
                label="Effectors placed"
                value={`${placedItems.filter((p) => p.kind === "effector").length}/${selectedEffectors.length}`}
                color={COLORS.danger}
              />
            </div>

            {coverage.some((c) => !c.covered) && placedItems.length > 0 && (
              <div
                style={{
                  marginTop: 12,
                  padding: "8px 10px",
                  background: "#f8514912",
                  borderRadius: 4,
                  border: `1px solid ${COLORS.danger}33`,
                  fontSize: 11,
                  color: COLORS.danger,
                  lineHeight: 1.4,
                }}
              >
                Warning: Coverage gaps detected on{" "}
                {coverage
                  .filter((c) => !c.covered)
                  .map((c) => c.name)
                  .join(", ")}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 20px",
          borderTop: `1px solid ${COLORS.border}`,
          background: COLORS.card,
          minHeight: 48,
        }}
      >
        <button
          onClick={onBack}
          style={{
            padding: "8px 20px",
            background: "transparent",
            border: `1px solid ${COLORS.border}`,
            borderRadius: 6,
            color: COLORS.muted,
            fontSize: 13,
            fontWeight: 500,
            fontFamily: "'Inter', sans-serif",
            cursor: "pointer",
            transition: "border-color 0.15s, color 0.15s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor =
              COLORS.muted;
            (e.currentTarget as HTMLButtonElement).style.color = COLORS.text;
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor =
              COLORS.border;
            (e.currentTarget as HTMLButtonElement).style.color = COLORS.muted;
          }}
        >
          BACK
        </button>

        <button
          onClick={() => {
            setPlacedItems([]);
            setSelectedPlaced(null);
            setSelectedPalette(null);
          }}
          disabled={placedItems.length === 0}
          style={{
            padding: "8px 20px",
            background: "transparent",
            border: `1px solid ${placedItems.length > 0 ? COLORS.danger : COLORS.border}`,
            borderRadius: 6,
            color: placedItems.length > 0 ? COLORS.danger : COLORS.muted,
            fontSize: 13,
            fontWeight: 500,
            fontFamily: "'Inter', sans-serif",
            cursor: placedItems.length > 0 ? "pointer" : "not-allowed",
            opacity: placedItems.length > 0 ? 1 : 0.4,
            transition: "background 0.15s, border-color 0.15s",
            letterSpacing: 1,
            textTransform: "uppercase",
          }}
          onMouseEnter={(e) => {
            if (placedItems.length > 0) {
              (e.currentTarget as HTMLButtonElement).style.background =
                "#f8514918";
            }
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "transparent";
          }}
        >
          Reset Placement
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              fontSize: 11,
              color: COLORS.muted,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {allPlaced
              ? "All equipment placed"
              : `${paletteItems.length - placedItems.length} remaining`}
          </span>
          <button
            onClick={handleConfirm}
            disabled={!allPlaced}
            style={{
              padding: "8px 24px",
              background: allPlaced ? COLORS.accent : COLORS.border,
              border: "none",
              borderRadius: 6,
              color: allPlaced ? "#ffffff" : COLORS.muted,
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "'Inter', sans-serif",
              cursor: allPlaced ? "pointer" : "not-allowed",
              opacity: allPlaced ? 1 : 0.5,
              transition: "background 0.15s, opacity 0.15s",
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
            onMouseEnter={(e) => {
              if (allPlaced)
                (e.currentTarget as HTMLButtonElement).style.background =
                  "#79b8ff";
            }}
            onMouseLeave={(e) => {
              if (allPlaced)
                (e.currentTarget as HTMLButtonElement).style.background =
                  COLORS.accent;
            }}
          >
            Start Mission
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Helper components ---

function SummaryRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <span style={{ fontSize: 11, color: COLORS.muted }}>{label}</span>
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          fontFamily: "'JetBrains Mono', monospace",
          color,
        }}
      >
        {value}
      </span>
    </div>
  );
}
