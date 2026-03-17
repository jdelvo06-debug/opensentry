import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Circle,
  Polyline,
  Polygon,
  Marker,
  useMap,
  ScaleControl,
  LayersControl,
} from "react-leaflet";
import L from "leaflet";
import type { Affiliation, EffectorStatus, EngagementZones, ProtectedAreaInfo, SensorStatus, TrackData } from "../types";
import { gameXYToLatLng } from "../utils/coordinates";
import RadialActionWheel from "./RadialActionWheel";
import DeviceWheel from "./DeviceWheel";

// Import leaflet CSS
import "leaflet/dist/leaflet.css";

interface Props {
  tracks: TrackData[];
  selectedTrackId: string | null;
  onSelectTrack: (id: string | null) => void;
  engagementZones: EngagementZones | null;
  elapsed: number;
  baseLat?: number;
  baseLng?: number;
  defaultZoom?: number;
  effectors?: EffectorStatus[];
  onConfirmTrack?: (trackId: string) => void;
  onIdentify?: (trackId: string, classification: string, affiliation: string) => void;
  onEngage?: (trackId: string, effectorId: string) => void;
  onSlewCamera?: (trackId: string) => void;
  onHoldFire?: (trackId: string) => void;
  onReleaseHoldFire?: (trackId: string) => void;
  cameraTrackId?: string | null;
  sensorConfigs?: SensorStatus[];
  protectedArea?: ProtectedAreaInfo | null;
}

interface WheelState {
  trackId: string;
  screenX: number;
  screenY: number;
}

interface DeviceWheelState {
  deviceId: string;
  deviceType: "sensor" | "effector";
  screenX: number;
  screenY: number;
}

// Per-system range ring styling by name/type pattern
function getRingStyleByName(name?: string, type?: string): { color: string; dashArray?: string } {
  const n = (name || "").toLowerCase();
  if (n.includes("tpq")) return { color: "#58a6ff", dashArray: "8,4" };
  if (n.includes("kurfs")) return { color: "#d29922" };
  if (n.includes("nighthawk") || type === "eoir") return { color: "#3fb950", dashArray: "2,4" };
  if (n.includes("jammer") || type === "electronic") return { color: "#e3b341", dashArray: "8,4" };
  if (n.includes("coyote") || type === "kinetic") return { color: "#f85149", dashArray: "8,4" };
  if (type === "radar") return { color: "#58a6ff", dashArray: "6,4" };
  return { color: "#8b949e", dashArray: "6,4" };
}

function createRingLabel(name: string, rangeKm: number, color: string): L.DivIcon {
  const html = `<span style="font:600 9px 'JetBrains Mono',monospace;color:${color};white-space:nowrap;pointer-events:none;background:rgba(13,17,23,0.75);padding:1px 5px;border-radius:2px;">${name} — ${rangeKm}km</span>`;
  return L.divIcon({
    html,
    className: "",
    iconSize: [120, 14],
    iconAnchor: [60, 7],
  });
}

const AFFILIATION_COLORS: Record<Affiliation, string> = {
  unknown: "#d29922",
  hostile: "#f85149",
  friendly: "#58a6ff",
  neutral: "#3fb950",
};

// SVG icon generators for MIL-STD-2525 symbology
function createTrackIcon(
  affiliation: Affiliation,
  isSelected: boolean,
  neutralized: boolean,
  coasting?: boolean,
  holdFire?: boolean,
  headingDeg?: number,
  speedKts?: number,
): L.DivIcon {
  const color = AFFILIATION_COLORS[affiliation];
  const size = 40; // Increased to fit HF box and velocity line
  const cx = 20;
  const cy = 20;
  const iconR = 12; // half the icon shape size
  let svg: string;

  const opacity = coasting ? 0.4 : 1.0;
  const dashArray = coasting ? 'stroke-dasharray="3,2"' : "";

  if (neutralized) {
    svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <line x1="${cx - 8}" y1="${cy - 8}" x2="${cx + 8}" y2="${cy + 8}" stroke="#484f58" stroke-width="2.5"/>
      <line x1="${cx + 8}" y1="${cy - 8}" x2="${cx - 8}" y2="${cy + 8}" stroke="#484f58" stroke-width="2.5"/>
    </svg>`;
  } else {
    const fill = `${color}33`;
    const stroke = color;
    const sw = isSelected ? 2.5 : 1.5;

    // Velocity indicator line (FAAD C2 style)
    let velocityLine = "";
    if (speedKts != null && headingDeg != null && speedKts > 0) {
      const speedMs = speedKts * 0.5144; // knots to m/s
      const headingRad = ((headingDeg - 90) * Math.PI) / 180;
      const cosH = Math.cos(headingRad);
      const sinH = Math.sin(headingRad);
      // Brighten color for velocity line
      const velColor = color;

      if (speedMs >= 160) {
        // High speed: long line extending past icon edge
        const len = iconR + 8;
        velocityLine = `<line x1="${cx}" y1="${cy}" x2="${cx + cosH * len}" y2="${cy + sinH * len}" stroke="${velColor}" stroke-width="2" opacity="${opacity}" stroke-linecap="round"/>`;
      } else if (speedMs >= 20) {
        // Medium speed: short line from center to icon edge
        const len = iconR;
        velocityLine = `<line x1="${cx}" y1="${cy}" x2="${cx + cosH * len}" y2="${cy + sinH * len}" stroke="${velColor}" stroke-width="1.5" opacity="${opacity}" stroke-linecap="round"/>`;
      }
      // Low speed (<20 m/s): no line
    }

    let shape: string;
    switch (affiliation) {
      case "hostile":
        // Diamond
        shape = `<polygon points="${cx},${cy - 10} ${cx + 10},${cy} ${cx},${cy + 10} ${cx - 10},${cy}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" ${dashArray} opacity="${opacity}"/>`;
        break;
      case "friendly":
        // Rectangle
        shape = `<rect x="${cx - 11}" y="${cy - 8}" width="22" height="16" rx="1" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" ${dashArray} opacity="${opacity}"/>`;
        break;
      case "neutral":
        shape = `<rect x="${cx - 9}" y="${cy - 9}" width="18" height="18" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" ${dashArray} opacity="${opacity}"/>`;
        break;
      case "unknown":
      default:
        shape = `<rect x="${cx - 9}" y="${cy - 9}" width="18" height="18" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" ${dashArray} opacity="${opacity}"/>`;
        break;
    }

    const selectedRing = isSelected
      ? `<circle cx="${cx}" cy="${cy}" r="14" fill="none" stroke="${stroke}" stroke-width="1" stroke-dasharray="3,2" opacity="0.6"/>`
      : "";

    // Hold Fire indicator: dashed rectangle with "HF" text
    let hfIndicator = "";
    if (holdFire) {
      hfIndicator = `
        <rect x="${cx - 14}" y="${cy - 14}" width="28" height="28" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-dasharray="4,2" opacity="0.8"/>
        <text x="${cx + 12}" y="${cy - 10}" text-anchor="middle" font-size="7" font-weight="700" font-family="monospace" fill="${stroke}" opacity="0.9">HF</text>
      `;
    }

    // Coasting indicator text
    let coastIndicator = "";
    if (coasting) {
      coastIndicator = `<text x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="6" font-weight="600" font-family="monospace" fill="${stroke}" opacity="0.6">COAST</text>`;
    }

    svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      ${velocityLine}
      ${shape}
      ${selectedRing}
      ${hfIndicator}
      ${coastIndicator}
    </svg>`;
  }

  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function createBaseIcon(): L.DivIcon {
  const svg = `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    <circle cx="16" cy="16" r="6" fill="#58a6ff"/>
    <circle cx="16" cy="16" r="11" fill="none" stroke="#58a6ff" stroke-width="1.5" opacity="0.5"/>
    <text x="16" y="30" text-anchor="middle" fill="#58a6ff" font-size="7" font-weight="600" font-family="monospace">BASE</text>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

function createSensorIcon(name: string): L.DivIcon {
  const label = (name || "SENSOR").toUpperCase().slice(0, 8);
  const svg = `<svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
    <circle cx="14" cy="14" r="8" fill="rgba(88,166,255,0.15)" stroke="#58a6ff" stroke-width="1.5"/>
    <circle cx="14" cy="14" r="2" fill="#58a6ff"/>
    <text x="14" y="27" text-anchor="middle" fill="#58a6ff" font-size="6" font-weight="600" font-family="monospace">${label}</text>
  </svg>`;
  return L.divIcon({ html: svg, className: "", iconSize: [28, 28], iconAnchor: [14, 14] });
}

function createEffectorIcon(name: string): L.DivIcon {
  const label = (name || "EFFECTOR").toUpperCase().slice(0, 8);
  const svg = `<svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
    <rect x="6" y="6" width="16" height="16" rx="2" fill="rgba(240,136,62,0.15)" stroke="#f0883e" stroke-width="1.5"/>
    <line x1="14" y1="9" x2="14" y2="19" stroke="#f0883e" stroke-width="1.5"/>
    <line x1="9" y1="14" x2="19" y2="14" stroke="#f0883e" stroke-width="1.5"/>
    <text x="14" y="27" text-anchor="middle" fill="#f0883e" font-size="6" font-weight="600" font-family="monospace">${label}</text>
  </svg>`;
  return L.divIcon({ html: svg, className: "", iconSize: [28, 28], iconAnchor: [14, 14] });
}

// Component to handle map click for deselecting tracks
function MapClickHandler({
  onSelectTrack,
}: {
  onSelectTrack: (id: string | null) => void;
}) {
  const map = useMap();
  useEffect(() => {
    const handler = () => onSelectTrack(null);
    map.on("click", handler);
    return () => {
      map.off("click", handler);
    };
  }, [map, onSelectTrack]);
  return null;
}

// Component to keep map view centered on base
function MapViewController({
  center,
  zoom,
}: {
  center: [number, number];
  zoom: number;
}) {
  const map = useMap();
  const initialized = useRef(false);
  useEffect(() => {
    if (!initialized.current) {
      map.setView(center, zoom);
      initialized.current = true;
    }
  }, [map, center, zoom]);
  return null;
}

// Pulsing base circle overlay using CSS animation
function PulsingBaseCircle({
  center,
}: {
  center: [number, number];
}) {
  return (
    <>
      <Circle
        center={center}
        radius={300}
        pathOptions={{
          color: "rgba(88, 166, 255, 0.15)",
          fillColor: "rgba(88, 166, 255, 0.04)",
          fillOpacity: 1,
          weight: 1,
          dashArray: "3,3",
        }}
      />
    </>
  );
}

const DTID_PHASE_LETTER: Record<string, string> = {
  detected: "D",
  tracked: "T",
  identified: "I",
  defeated: "F",
};

// Track data block (hook bubble) — persistent info label attached to each track
function TrackDataBlock({
  track,
  position,
  isSelected,
  offsetIndex,
}: {
  track: TrackData;
  position: [number, number];
  isSelected: boolean;
  offsetIndex: number;
}) {
  const color = track.neutralized
    ? "#484f58"
    : AFFILIATION_COLORS[track.affiliation];
  const phaseChar = DTID_PHASE_LETTER[track.dtid_phase] || "?";
  const range = Math.sqrt(track.x * track.x + track.y * track.y);
  const bearing = ((Math.atan2(track.x, track.y) * 180) / Math.PI + 360) % 360;

  // Offset to avoid overlaps: alternate right/left for stacked tracks
  const yOff = offsetIndex * 18;

  const isCoasting = track.coasting;
  const blockOpacity = isCoasting ? 0.5 : 1.0;
  const coastLabel = isCoasting
    ? `<span style="color:#d29922;font-size:7px;font-weight:700;margin-left:4px;">COAST</span>`
    : "";
  const hfLabel = track.hold_fire
    ? `<span style="color:#f85149;font-size:7px;font-weight:700;margin-left:4px;">HF</span>`
    : "";

  // ETA to protected area
  const eta = track.eta_protected;
  let etaLabel = "";
  if (eta != null && !track.neutralized) {
    const etaColor = eta <= 15 ? "#f85149" : eta <= 30 ? "#db6d28" : "#bc8cff";
    etaLabel = `<div style="color:${etaColor};font-size:8px;font-weight:600;">ETA: ${Math.round(eta)}s</div>`;
  }

  const html = `<div style="
    pointer-events:none;
    background:rgba(13,17,23,${isSelected ? "0.92" : "0.78"});
    border:1px solid ${isSelected ? color : "#30363d"};
    ${isCoasting ? "border-style:dashed;" : ""}
    border-radius:3px;
    padding:2px 5px;
    white-space:nowrap;
    font-family:'JetBrains Mono',monospace;
    line-height:1.35;
    position:relative;
    opacity:${blockOpacity};
  ">
    <div style="
      position:absolute;
      left:-9px;
      top:8px;
      width:8px;
      height:1px;
      background:${isSelected ? color : "#30363d"};
    "></div>
    <div style="color:${color};font-size:${isSelected ? "10px" : "9px"};font-weight:600;letter-spacing:0.5px;">
      ${track.id.toUpperCase()} <span style="opacity:0.6;font-weight:400;">${phaseChar}</span>${coastLabel}${hfLabel}
    </div>
    ${!track.neutralized ? `
    <div style="color:#8b949e;font-size:8px;opacity:${isSelected ? 0.9 : 0.65};">
      SPD:${Math.round(track.speed_kts)} | ALT:${Math.round(track.altitude_ft)}
    </div>
    <div style="color:#8b949e;font-size:8px;opacity:${isSelected ? 0.9 : 0.65};">
      BRG:${Math.round(bearing)}\u00B0 | RNG:${range.toFixed(1)}km
    </div>
    ${etaLabel}` : `
    <div style="color:#484f58;font-size:8px;">NEUTRALIZED</div>`}
  </div>`;

  const icon = L.divIcon({
    html,
    className: "",
    iconSize: [120, 48],
    iconAnchor: [-18, 12 - yOff],
  });

  return <Marker position={position} icon={icon} interactive={false} />;
}

export default function TacticalMap({
  tracks,
  selectedTrackId,
  onSelectTrack,
  engagementZones,
  baseLat = 32.5,
  baseLng = 45.5,
  defaultZoom = 13,
  effectors = [],
  onConfirmTrack,
  onIdentify,
  onEngage,
  onSlewCamera,
  onHoldFire,
  onReleaseHoldFire,
  cameraTrackId,
  sensorConfigs = [],
  protectedArea,
}: Props) {
  const baseCenter: [number, number] = [baseLat, baseLng];
  const [wheelState, setWheelState] = useState<WheelState | null>(null);
  const [deviceWheelState, setDeviceWheelState] = useState<DeviceWheelState | null>(null);
  const [showRangeRings, setShowRangeRings] = useState(true);
  const [hiddenRings, setHiddenRings] = useState<Set<string>>(new Set());

  // Compute zoom from engagement zones to fit detection range
  const zoom = useMemo(() => {
    if (!engagementZones) return defaultZoom;
    const rangeKm = engagementZones.detection_range_km;
    // Approximate: at zoom 13, ~10km fits. Each zoom doubles.
    if (rangeKm <= 2) return 15;
    if (rangeKm <= 5) return 14;
    if (rangeKm <= 10) return 13;
    return 12;
  }, [engagementZones, defaultZoom]);

  const baseIcon = useMemo(() => createBaseIcon(), []);

  // Convert track to lat/lng
  const trackPosition = useCallback(
    (track: TrackData): [number, number] => {
      return gameXYToLatLng(track.x, track.y, baseLat, baseLng);
    },
    [baseLat, baseLng],
  );

  // Convert trail points to lat/lng
  const trailToLatLng = useCallback(
    (trail: [number, number][]): [number, number][] => {
      return trail.map(([x, y]) => gameXYToLatLng(x, y, baseLat, baseLng));
    },
    [baseLat, baseLng],
  );

  // Speed leader line endpoint
  const speedLeaderEnd = useCallback(
    (track: TrackData): [number, number] | null => {
      if (track.speed_kts <= 0 || track.neutralized) return null;
      const headingRad = ((track.heading_deg - 90) * Math.PI) / 180;
      const leaderKm = (track.speed_kts / 100) * 0.5;
      const endX = track.x + Math.cos(headingRad) * leaderKm;
      const endY = track.y + Math.sin(headingRad) * leaderKm;
      return gameXYToLatLng(endX, endY, baseLat, baseLng);
    },
    [baseLat, baseLng],
  );

  // Projected path endpoint (longer dashed line)
  const projectedEnd = useCallback(
    (track: TrackData): [number, number] | null => {
      if (track.speed_kts <= 0 || track.neutralized) return null;
      const headingRad = ((track.heading_deg - 90) * Math.PI) / 180;
      const projKm = Math.max((track.speed_kts / 60) * 1.5, 0.5);
      const endX = track.x + Math.cos(headingRad) * projKm;
      const endY = track.y + Math.sin(headingRad) * projKm;
      return gameXYToLatLng(endX, endY, baseLat, baseLng);
    },
    [baseLat, baseLng],
  );

  return (
    <div
      style={{
        flex: 1,
        position: "relative",
        overflow: "hidden",
        background: "#0d1117",
        width: "100%",
        height: "100%",
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
          background: "#0d1117",
          cursor: "crosshair",
        }}
      >
        <MapViewController center={baseCenter} zoom={zoom} />
        <MapClickHandler onSelectTrack={onSelectTrack} />
        <ScaleControl position="bottomleft" />

        {/* Layer switcher */}
        <LayersControl position="topright">
          <LayersControl.BaseLayer name="Dark">
            <TileLayer
              url="https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              maxZoom={20}
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer checked name="Satellite">
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

        {/* Engagement zone rings */}
        {engagementZones && (
          <>
            <Circle
              center={baseCenter}
              radius={engagementZones.detection_range_km * 1000}
              pathOptions={{
                color: "#30363d",
                fillColor: "transparent",
                fillOpacity: 0,
                weight: 1,
                dashArray: "6,4",
              }}
            />
            <Circle
              center={baseCenter}
              radius={engagementZones.engagement_range_km * 1000}
              pathOptions={{
                color: "rgba(88, 166, 255, 0.2)",
                fillColor: "transparent",
                fillOpacity: 0,
                weight: 1,
                dashArray: "6,4",
              }}
            />
            <Circle
              center={baseCenter}
              radius={engagementZones.identification_range_km * 1000}
              pathOptions={{
                color: "rgba(210, 153, 34, 0.2)",
                fillColor: "transparent",
                fillOpacity: 0,
                weight: 1,
                dashArray: "6,4",
              }}
            />
          </>
        )}

        {/* Protected Area overlay (purple) */}
        {protectedArea && (() => {
          const paCenter = gameXYToLatLng(
            protectedArea.center_x, protectedArea.center_y, baseLat, baseLng
          );
          // Check if any track is within 30s of reaching protected area
          const anyWithin30s = tracks.some(
            (t) => !t.neutralized && t.eta_protected != null && t.eta_protected <= 30
          );
          return (
            <>
              {/* Warning Area (outer, amber dashed) */}
              <Circle
                center={paCenter}
                radius={protectedArea.warning_radius_km * 1000}
                pathOptions={{
                  color: "#db6d28",
                  fillColor: "#db6d28",
                  fillOpacity: 0.03,
                  weight: 1.5,
                  opacity: 0.5,
                  dashArray: "8,6",
                }}
              />
              {/* Warning Area label */}
              <Marker
                position={gameXYToLatLng(
                  protectedArea.center_x,
                  protectedArea.center_y + protectedArea.warning_radius_km,
                  baseLat, baseLng
                )}
                icon={L.divIcon({
                  html: `<span style="font:600 8px 'JetBrains Mono',monospace;color:#db6d28;white-space:nowrap;pointer-events:none;background:rgba(13,17,23,0.75);padding:1px 5px;border-radius:2px;">WARNING AREA</span>`,
                  className: "",
                  iconSize: [90, 14],
                  iconAnchor: [45, 7],
                })}
                interactive={false}
              />
              {/* Protected Area (inner, purple) */}
              <Circle
                center={paCenter}
                radius={protectedArea.radius_km * 1000}
                pathOptions={{
                  color: anyWithin30s ? "#da3633" : "#bc8cff",
                  fillColor: "#bc8cff",
                  fillOpacity: 0.06,
                  weight: anyWithin30s ? 2.5 : 2,
                  opacity: anyWithin30s ? 0.9 : 0.7,
                  dashArray: anyWithin30s ? undefined : "4,4",
                  className: anyWithin30s ? "protected-area-pulse" : undefined,
                }}
              />
              {/* Protected Area label */}
              <Marker
                position={gameXYToLatLng(
                  protectedArea.center_x,
                  protectedArea.center_y + protectedArea.radius_km,
                  baseLat, baseLng
                )}
                icon={L.divIcon({
                  html: `<span style="font:600 8px 'JetBrains Mono',monospace;color:#bc8cff;white-space:nowrap;pointer-events:none;background:rgba(13,17,23,0.75);padding:1px 5px;border-radius:2px;">PROTECTED AREA</span>`,
                  className: "",
                  iconSize: [100, 14],
                  iconAnchor: [50, 7],
                })}
                interactive={false}
              />
            </>
          );
        })()}

        {/* Range rings at 1km intervals */}
        {Array.from({ length: 10 }, (_, i) => i + 1).map((r) => (
          <Circle
            key={`ring-${r}`}
            center={baseCenter}
            radius={r * 1000}
            pathOptions={{
              color: "rgba(48, 54, 61, 0.4)",
              fillColor: "transparent",
              fillOpacity: 0,
              weight: 0.5,
              dashArray: "4,6",
            }}
          />
        ))}

        {/* Per-sensor range rings */}
        {sensorConfigs.map((sensor) => {
          if (!sensor.x && sensor.x !== 0) return null;
          if (!sensor.range_km) return null;
          const style = getRingStyleByName(sensor.name, sensor.type);
          const sPos = gameXYToLatLng(sensor.x ?? 0, sensor.y ?? 0, baseLat, baseLng);
          const rangeKm = sensor.range_km;
          const fov = sensor.fov_deg ?? 360;
          const facing = sensor.facing_deg ?? 0;
          const isSelected = false; // sensors don't have selection in tactical map
          const shouldShow = (showRangeRings && !hiddenRings.has(sensor.id)) || isSelected;
          if (!shouldShow) return null;

          // For limited FOV sensors, draw a sector wedge
          if (fov < 360) {
            const steps = 32;
            const facingRad = ((90 - facing) * Math.PI) / 180;
            const halfFov = (fov / 2 * Math.PI) / 180;
            const points: [number, number][] = [sPos];
            for (let i = 0; i <= steps; i++) {
              const angle = facingRad - halfFov + (2 * halfFov * i) / steps;
              const px = (sensor.x ?? 0) + Math.cos(angle) * rangeKm;
              const py = (sensor.y ?? 0) + Math.sin(angle) * rangeKm;
              points.push(gameXYToLatLng(px, py, baseLat, baseLng));
            }
            // Label at the tip of the sector
            const labelAngle = facingRad;
            const labelX = (sensor.x ?? 0) + Math.cos(labelAngle) * rangeKm;
            const labelY = (sensor.y ?? 0) + Math.sin(labelAngle) * rangeKm;
            const labelPos = gameXYToLatLng(labelX, labelY, baseLat, baseLng);
            return (
              <span key={`sensor-ring-${sensor.id}`}>
                <Polygon
                  positions={points}
                  pathOptions={{
                    color: style.color,
                    fillColor: style.color,
                    fillOpacity: 0.06,
                    weight: 1.5,
                    opacity: 0.6,
                    dashArray: style.dashArray,
                  }}
                />
                <Marker
                  position={labelPos}
                  icon={createRingLabel(sensor.name || sensor.id, rangeKm, style.color)}
                  interactive={false}
                />
              </span>
            );
          }

          // Full 360° ring
          const labelPos = gameXYToLatLng(sensor.x ?? 0, (sensor.y ?? 0) + rangeKm, baseLat, baseLng);
          return (
            <span key={`sensor-ring-${sensor.id}`}>
              <Circle
                center={sPos}
                radius={rangeKm * 1000}
                pathOptions={{
                  color: style.color,
                  fillColor: style.color,
                  fillOpacity: 0.04,
                  weight: 1.5,
                  opacity: 0.6,
                  dashArray: style.dashArray,
                }}
              />
              <Marker
                position={labelPos}
                icon={createRingLabel(sensor.name || sensor.id, rangeKm, style.color)}
                interactive={false}
              />
            </span>
          );
        })}

        {/* Per-effector range rings */}
        {showRangeRings && effectors.filter((e) => !hiddenRings.has(e.id)).map((eff) => {
          if (!eff.x && eff.x !== 0) return null;
          if (!eff.range_km) return null;
          const style = getRingStyleByName(eff.name, eff.type);
          const ePos = gameXYToLatLng(eff.x ?? 0, eff.y ?? 0, baseLat, baseLng);
          const rangeKm = eff.range_km;
          const labelPos = gameXYToLatLng(eff.x ?? 0, (eff.y ?? 0) + rangeKm, baseLat, baseLng);
          return (
            <span key={`effector-ring-${eff.id}`}>
              <Circle
                center={ePos}
                radius={rangeKm * 1000}
                pathOptions={{
                  color: style.color,
                  fillColor: style.color,
                  fillOpacity: 0.03,
                  weight: 1.5,
                  opacity: 0.5,
                  dashArray: style.dashArray,
                }}
              />
              <Marker
                position={labelPos}
                icon={createRingLabel(eff.name || eff.id, rangeKm, style.color)}
                interactive={false}
              />
            </span>
          );
        })}

        {/* Base marker with pulsing circle */}
        <PulsingBaseCircle center={baseCenter} />
        <Marker
          position={baseCenter}
          icon={baseIcon}
          interactive={false}
        />

        {/* Sensor device markers (right-clickable) */}
        {sensorConfigs.map((sensor) => {
          if (sensor.x == null && sensor.x !== 0) return null;
          const sPos = gameXYToLatLng(sensor.x ?? 0, sensor.y ?? 0, baseLat, baseLng);
          return (
            <Marker
              key={`sensor-marker-${sensor.id}`}
              position={sPos}
              icon={createSensorIcon(sensor.name || sensor.id)}
              eventHandlers={{
                contextmenu: (e) => {
                  L.DomEvent.stopPropagation(e.originalEvent);
                  e.originalEvent.preventDefault();
                  setWheelState(null);
                  setDeviceWheelState({
                    deviceId: sensor.id,
                    deviceType: "sensor",
                    screenX: e.originalEvent.clientX,
                    screenY: e.originalEvent.clientY,
                  });
                },
              }}
            />
          );
        })}

        {/* Effector device markers (right-clickable) */}
        {effectors.map((eff) => {
          if (eff.x == null && eff.x !== 0) return null;
          const ePos = gameXYToLatLng(eff.x ?? 0, eff.y ?? 0, baseLat, baseLng);
          return (
            <Marker
              key={`effector-marker-${eff.id}`}
              position={ePos}
              icon={createEffectorIcon(eff.name || eff.id)}
              eventHandlers={{
                contextmenu: (e) => {
                  L.DomEvent.stopPropagation(e.originalEvent);
                  e.originalEvent.preventDefault();
                  setWheelState(null);
                  setDeviceWheelState({
                    deviceId: eff.id,
                    deviceType: "effector",
                    screenX: e.originalEvent.clientX,
                    screenY: e.originalEvent.clientY,
                  });
                },
              }}
            />
          );
        })}

        {/* Camera FOV Cone */}
        {(() => {
          // Find the EO/IR camera sensor
          const cameraSensor = sensorConfigs.find(
            (s) => s.type === "eoir" || s.name?.toLowerCase().includes("camera") || s.name?.toLowerCase().includes("eo"),
          );
          if (!cameraSensor) return null;

          const camX = cameraSensor.x ?? 0;
          const camY = cameraSensor.y ?? 0;
          const camRange = cameraSensor.range_km ?? 2;
          const camFov = cameraSensor.fov_deg ?? 30;
          const camPos = gameXYToLatLng(camX, camY, baseLat, baseLng);

          // Determine cone direction: toward slewed track, or facing_deg
          const cameraTarget = cameraTrackId
            ? tracks.find((t) => t.id === cameraTrackId)
            : null;

          let bearingDeg: number;
          if (cameraTarget) {
            const dx = cameraTarget.x - camX;
            const dy = cameraTarget.y - camY;
            bearingDeg = (Math.atan2(dx, dy) * 180) / Math.PI;
          } else {
            bearingDeg = cameraSensor.facing_deg ?? 0;
          }

          // Build cone polygon: camera position -> arc at range
          const halfFov = camFov / 2;
          const steps = 16;
          const conePoints: [number, number][] = [camPos];

          for (let i = 0; i <= steps; i++) {
            const angle = bearingDeg - halfFov + (camFov * i) / steps;
            const angleRad = (angle * Math.PI) / 180;
            const px = camX + Math.sin(angleRad) * camRange;
            const py = camY + Math.cos(angleRad) * camRange;
            conePoints.push(gameXYToLatLng(px, py, baseLat, baseLng));
          }

          // LOS center line to target or center of cone
          const centerAngleRad = (bearingDeg * Math.PI) / 180;
          const losDist = cameraTarget
            ? Math.sqrt((cameraTarget.x - camX) ** 2 + (cameraTarget.y - camY) ** 2)
            : camRange;
          const losEndX = camX + Math.sin(centerAngleRad) * losDist;
          const losEndY = camY + Math.cos(centerAngleRad) * losDist;
          const losEnd = gameXYToLatLng(losEndX, losEndY, baseLat, baseLng);

          return (
            <>
              <Polygon
                positions={conePoints}
                pathOptions={{
                  color: "#3fb950",
                  fillColor: "#3fb950",
                  fillOpacity: 0.08,
                  weight: 1,
                  opacity: 0.4,
                }}
              />
              <Polyline
                positions={[camPos, losEnd]}
                pathOptions={{
                  color: "#d29922",
                  weight: 1.5,
                  opacity: 0.7,
                  dashArray: "6,3",
                }}
              />
            </>
          );
        })()}

        {/* Tracks */}
        {tracks.map((track) => {
          const pos = trackPosition(track);
          const color = AFFILIATION_COLORS[track.affiliation];
          const isSelected = track.id === selectedTrackId;

          return (
            <span key={track.id}>
              {/* Trail polyline */}
              {track.trail && track.trail.length > 1 && (
                <Polyline
                  positions={trailToLatLng(track.trail)}
                  pathOptions={{
                    color,
                    weight: 1,
                    opacity: track.coasting ? 0.2 : 0.5,
                    dashArray: track.coasting ? "4,4" : undefined,
                  }}
                />
              )}

              {/* Projected path (dashed) */}
              {projectedEnd(track) && (
                <Polyline
                  positions={[pos, projectedEnd(track)!]}
                  pathOptions={{
                    color,
                    weight: 1,
                    opacity: 0.35,
                    dashArray: "6,4",
                  }}
                />
              )}

              {/* Speed leader line (solid) */}
              {speedLeaderEnd(track) && (
                <Polyline
                  positions={[pos, speedLeaderEnd(track)!]}
                  pathOptions={{
                    color,
                    weight: 1.5,
                    opacity: 0.7,
                  }}
                />
              )}

              {/* Track icon marker */}
              <Marker
                position={pos}
                icon={createTrackIcon(
                  track.affiliation,
                  isSelected,
                  track.neutralized,
                  track.coasting,
                  track.hold_fire,
                  track.heading_deg,
                  track.speed_kts,
                )}
                eventHandlers={{
                  click: (e) => {
                    L.DomEvent.stopPropagation(e.originalEvent);
                    onSelectTrack(track.id);
                  },
                  contextmenu: (e) => {
                    L.DomEvent.stopPropagation(e.originalEvent);
                    e.originalEvent.preventDefault();
                    onSelectTrack(track.id);
                    setWheelState({
                      trackId: track.id,
                      screenX: e.originalEvent.clientX,
                      screenY: e.originalEvent.clientY,
                    });
                  },
                }}
              />

              {/* Track data block (hook bubble) */}
              <TrackDataBlock
                track={track}
                position={pos}
                isSelected={isSelected}
                offsetIndex={0}
              />
            </span>
          );
        })}
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
          border: `1px solid ${showRangeRings ? "#58a6ff55" : "#30363d"}`,
          borderRadius: 4,
          color: showRangeRings ? "#58a6ff" : "#8b949e",
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

      {/* Zone labels overlay (positioned absolutely over map) */}
      {engagementZones && (
        <div
          style={{
            position: "absolute",
            top: 8,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            gap: 16,
            zIndex: 1000,
            pointerEvents: "none",
          }}
        >
          {[
            { label: "DETECTION", range: engagementZones.detection_range_km },
            { label: "ENGAGEMENT", range: engagementZones.engagement_range_km },
            { label: "ID", range: engagementZones.identification_range_km },
          ].map(({ label, range }) => (
            <span
              key={label}
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 9,
                color: "#484f58",
                background: "rgba(13, 17, 23, 0.7)",
                padding: "2px 6px",
                borderRadius: 2,
              }}
            >
              {label}: {range}km
            </span>
          ))}
        </div>
      )}

      {/* Radial action wheel (track WOD) */}
      {wheelState && onConfirmTrack && onIdentify && onEngage && onSlewCamera && (() => {
        const wheelTrack = tracks.find((t) => t.id === wheelState.trackId);
        if (!wheelTrack || wheelTrack.neutralized) return null;
        return (
          <RadialActionWheel
            trackId={wheelTrack.id}
            dtidPhase={wheelTrack.dtid_phase}
            screenX={wheelState.screenX}
            screenY={wheelState.screenY}
            effectors={effectors}
            holdFire={wheelTrack.hold_fire}
            onConfirmTrack={onConfirmTrack}
            onIdentify={onIdentify}
            onEngage={onEngage}
            onSlewCamera={onSlewCamera}
            onHoldFire={onHoldFire}
            onReleaseHoldFire={onReleaseHoldFire}
            onClose={() => setWheelState(null)}
          />
        );
      })()}

      {/* Device wheel (sensor/effector WOD) */}
      {deviceWheelState && (() => {
        const device = deviceWheelState.deviceType === "sensor"
          ? sensorConfigs.find((s) => s.id === deviceWheelState.deviceId)
          : effectors.find((e) => e.id === deviceWheelState.deviceId);
        if (!device) return null;
        return (
          <DeviceWheel
            device={device}
            deviceType={deviceWheelState.deviceType}
            screenX={deviceWheelState.screenX}
            screenY={deviceWheelState.screenY}
            onToggleRangeRing={(id) => {
              setHiddenRings((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              });
            }}
            onSlewTo={onSlewCamera ? (_id) => {
              // For camera sensors, find nearest track to slew to
              const nearestTrack = tracks
                .filter((t) => !t.neutralized)
                .sort((a, b) => {
                  const da = Math.sqrt(a.x * a.x + a.y * a.y);
                  const db = Math.sqrt(b.x * b.x + b.y * b.y);
                  return da - db;
                })[0];
              if (nearestTrack) onSlewCamera(nearestTrack.id);
            } : undefined}
            onEngageNearest={onEngage ? (effectorId) => {
              // Find nearest hostile track
              const nearestHostile = tracks
                .filter((t) => !t.neutralized && t.affiliation === "hostile" && t.dtid_phase === "identified")
                .sort((a, b) => {
                  const da = Math.sqrt(a.x * a.x + a.y * a.y);
                  const db = Math.sqrt(b.x * b.x + b.y * b.y);
                  return da - db;
                })[0];
              if (nearestHostile) onEngage(nearestHostile.id, effectorId);
            } : undefined}
            onClose={() => setDeviceWheelState(null)}
          />
        );
      })()}
    </div>
  );
}
