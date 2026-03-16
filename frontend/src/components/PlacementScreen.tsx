import { useCallback, useEffect, useMemo, useState } from "react";
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
  onConfirm: (placement: PlacementConfig) => void;
  onBack: () => void;
}

interface PlacedItem {
  equipment: PlacedEquipment;
  kind: "sensor" | "effector";
  catalogIndex: number;
}

type PaletteItem = {
  kind: "sensor" | "effector";
  index: number;
  catalog: CatalogSensor | CatalogEffector;
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
  onConfirm,
  onBack,
}: Props) {
  const [placedItems, setPlacedItems] = useState<PlacedItem[]>([]);
  const [selectedPalette, setSelectedPalette] = useState<number | null>(null);
  const [selectedPlaced, setSelectedPlaced] = useState<number | null>(null);
  const [facingDeg, setFacingDeg] = useState(0);

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
  ];

  // Build instance labels for duplicate items (e.g., "Nighthawk #1", "Nighthawk #2")
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
    (item: PlacedItem): CatalogSensor | CatalogEffector => {
      return item.kind === "sensor"
        ? selectedSensors[item.catalogIndex]
        : selectedEffectors[item.catalogIndex];
    },
    [selectedSensors, selectedEffectors],
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
    const config: PlacementConfig = {
      base_id: baseTemplate.id,
      sensors: placedItems
        .filter((p) => p.kind === "sensor")
        .map((p) => p.equipment),
      effectors: placedItems
        .filter((p) => p.kind === "effector")
        .map((p) => p.equipment),
    };
    onConfirm(config);
  }, [baseTemplate.id, placedItems, onConfirm]);

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

  // Boundary polygon as lat/lng
  const boundaryPositions = useMemo(
    () => gamePolygonToLatLng(baseTemplate.boundary, baseLat, baseLng),
    [baseTemplate.boundary, baseLat, baseLng],
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

            {/* Base boundary polygon */}
            {boundaryPositions.length > 0 && (
              <Polygon
                positions={boundaryPositions}
                pathOptions={{
                  color: "#ffffff88",
                  fillColor: "transparent",
                  fillOpacity: 0,
                  weight: 1.5,
                  dashArray: "8,4",
                }}
              />
            )}

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

            {/* Protected assets */}
            {baseTemplate.protected_assets.map((asset) => {
              const pos = gameXYToLatLng(asset.x, asset.y, baseLat, baseLng);
              return (
                <Marker
                  key={asset.id}
                  position={pos}
                  icon={createAssetIcon(asset.priority, asset.name)}
                  interactive={false}
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
                    fillColor: "#58a6ff",
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

              // Range arc/circle
              const rangeArcPositions = generateFovArc(
                eq.x,
                eq.y,
                cat.range_km,
                eq.facing_deg,
                cat.fov_deg,
                baseLat,
                baseLng,
              );

              const rangeColor = isSensor ? "#58a6ff" : "#f85149";

              return (
                <span key={`item-${pi}`}>
                  {/* Range arc/ring */}
                  {cat.fov_deg >= 360 ? (
                    <Circle
                      center={pos}
                      radius={cat.range_km * 1000}
                      pathOptions={{
                        color: rangeColor,
                        fillColor: rangeColor,
                        fillOpacity: isSensor ? 0.05 : 0.03,
                        weight: isSelected ? 2 : 1,
                        opacity: 0.4,
                      }}
                    />
                  ) : (
                    <Polygon
                      positions={rangeArcPositions}
                      pathOptions={{
                        color: rangeColor,
                        fillColor: rangeColor,
                        fillOpacity: 0.1,
                        weight: isSelected ? 2 : 1,
                        opacity: 0.4,
                      }}
                    />
                  )}

                  {/* Icon marker */}
                  <Marker
                    position={pos}
                    icon={
                      isSensor
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
                    icon={createItemLabel(cat.name, isSensor)}
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
          </MapContainer>

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
