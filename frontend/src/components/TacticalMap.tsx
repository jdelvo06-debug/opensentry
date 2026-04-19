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
import type { Affiliation, EffectorStatus, EngagementZones, ProtectedAreaInfo, ProtectedAsset, SensorStatus, TrackData } from "../types";
import { gameXYToLatLng } from "../utils/coordinates";
import RadialActionWheel from "./RadialActionWheel";
import DeviceWheel from "./DeviceWheel";
import SelectionList, { findNearbySelectables } from "./SelectionList";
import { getActiveCameraSensor, getSensorDisplayLabel } from "./tactical-map-sensors";

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
  onCallATC?: (trackId: string) => void;
  onDeclareAffiliation?: (trackId: string, affiliation: string) => void;
  cameraTrackId?: string | null;
  selectedCameraId?: string | null;
  sensorConfigs?: SensorStatus[];
  protectedArea?: ProtectedAreaInfo | null;
  trackBlinkStates?: Record<string, string>;
  newContactBanner?: string | null;
  baseAssets?: ProtectedAsset[];
  baseBoundary?: number[][];
  activeJammers?: Record<string, number>;
  activeIntercepts?: InterceptAnimationData[];
  activeDEBeams?: DEBeamAnimationData[];
  onJammerToggle?: (effectorId: string) => void;
  baseBreached?: boolean;
}

export interface InterceptAnimationData {
  id: string;
  effectorId: string;
  targetId: string;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  effective: boolean;
  startTime: number;
  duration: number;
}

export interface DEBeamAnimationData {
  id: string;
  effectorId: string;
  targetId: string;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  effective: boolean;
  beamType: "laser" | "hpm";
  startTime: number;
  duration: number;
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

interface SelectionListState {
  items: { id: string; type: "track" | "sensor" | "effector"; label: string; status: string; color: string; icon: string }[];
  screenX: number;
  screenY: number;
  isRightClick: boolean;
}

// Per-system range ring styling by name/type pattern
function getRingStyleByName(name?: string, type?: string): { color: string; dashArray?: string } {
  const n = (name || "").toLowerCase();
  if (n.includes("tpq")) return { color: "#58a6ff", dashArray: "8,4" };
  if (n.includes("kufcs")) return { color: "#d29922" };
  if (n.includes("eoir") || n.includes("eo/ir") || type === "eoir") return { color: "#3fb950", dashArray: "2,4" };
  if (n.includes("shenobi") || type === "shenobi_pm") return { color: "#a371f7", dashArray: "4,4" };  // Purple for Shenobi
  if (n.includes("jammer") || type === "electronic") return { color: "#e3b341", dashArray: "8,4" };
  if (n.includes("jackal") || type === "kinetic") return { color: "#f85149", dashArray: "8,4" };
  if (type === "de_laser" || n.includes("de-laser") || n.includes("de_laser")) return { color: "#ff6a00", dashArray: "4,4" };
  if (type === "de_hpm" || n.includes("de-hpm") || n.includes("de_hpm")) return { color: "#00d4ff", dashArray: "4,4" };
  if (type === "rf" && n.includes("shenobi")) return { color: "#a371f7", dashArray: "4,4" };
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
  blinkClass?: string,
): L.DivIcon {
  const color = AFFILIATION_COLORS[affiliation];
  const size = 48; // Larger for readability
  const cx = 24;
  const cy = 24;
  const iconR = 14; // half the icon shape size
  let svg: string;

  const opacity = coasting ? 0.4 : 1.0;
  const dashArray = coasting ? 'stroke-dasharray="3,2"' : "";

  if (neutralized) {
    svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <line x1="${cx - 9}" y1="${cy - 9}" x2="${cx + 9}" y2="${cy + 9}" stroke="#484f58" stroke-width="2.5"/>
      <line x1="${cx + 9}" y1="${cy - 9}" x2="${cx - 9}" y2="${cy + 9}" stroke="#484f58" stroke-width="2.5"/>
    </svg>`;
  } else {
    const fill = `${color}33`;
    const stroke = color;
    const sw = isSelected ? 2.5 : 1.5;

    // Velocity indicator line (GUARDIAN C2 style)
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
        shape = `<polygon points="${cx},${cy - 12} ${cx + 12},${cy} ${cx},${cy + 12} ${cx - 12},${cy}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" ${dashArray} opacity="${opacity}"/>`;
        break;
      case "friendly":
        // Rectangle
        shape = `<rect x="${cx - 13}" y="${cy - 10}" width="26" height="20" rx="1" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" ${dashArray} opacity="${opacity}"/>`;
        break;
      case "neutral":
        shape = `<rect x="${cx - 11}" y="${cy - 11}" width="22" height="22" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" ${dashArray} opacity="${opacity}"/>`;
        break;
      case "unknown":
      default:
        shape = `<rect x="${cx - 11}" y="${cy - 11}" width="22" height="22" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" ${dashArray} opacity="${opacity}"/>`;
        break;
    }

    // Hostile pulse glow ring — only on active hostile tracks
    let hostilePulse = "";
    if (affiliation === "hostile" && !neutralized && !coasting) {
      hostilePulse = `<circle cx="${cx}" cy="${cy}" r="17" fill="none" stroke="${stroke}" stroke-width="1.5">
        <animate attributeName="opacity" values="0.3;0.8;0.3" dur="1.5s" repeatCount="indefinite"/>
      </circle>`;
    }

    const selectedRing = isSelected
      ? `<circle cx="${cx}" cy="${cy}" r="17" fill="none" stroke="${stroke}" stroke-width="1" stroke-dasharray="3,2" opacity="0.6"/>`
      : "";

    // Hold Fire indicator: dashed rectangle with "HF" text
    let hfIndicator = "";
    if (holdFire) {
      hfIndicator = `
        <rect x="${cx - 16}" y="${cy - 16}" width="32" height="32" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-dasharray="4,2" opacity="0.8"/>
        <text x="${cx + 14}" y="${cy - 12}" text-anchor="middle" font-size="7" font-weight="700" font-family="monospace" fill="${stroke}" opacity="0.9">HF</text>
      `;
    }

    // Coasting indicator text
    let coastIndicator = "";
    if (coasting) {
      coastIndicator = `<text x="${cx}" y="${cy + 21}" text-anchor="middle" font-size="6" font-weight="600" font-family="monospace" fill="${stroke}" opacity="0.6">COAST</text>`;
    }

    svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      ${hostilePulse}
      ${velocityLine}
      ${shape}
      ${selectedRing}
      ${hfIndicator}
      ${coastIndicator}
    </svg>`;
  }

  return L.divIcon({
    html: svg,
    className: blinkClass || "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function createInterceptorIcon(
  isSelected: boolean,
  neutralized: boolean,
  headingDeg?: number,
  blinkClass?: string,
  callsign?: string,
): L.DivIcon {
  const size = 44;
  const cx = 22;
  const cy = 18; // shifted up to leave room for callsign below
  const color = "#3fb950"; // green

  if (neutralized) {
    const svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <line x1="${cx - 6}" y1="${cy - 6}" x2="${cx + 6}" y2="${cy + 6}" stroke="#484f58" stroke-width="2"/>
      <line x1="${cx + 6}" y1="${cy - 6}" x2="${cx - 6}" y2="${cy + 6}" stroke="#484f58" stroke-width="2"/>
    </svg>`;
    return L.divIcon({ html: svg, className: "", iconSize: [size, size], iconAnchor: [cx, cy] });
  }

  const headingRad = headingDeg != null ? ((headingDeg) * Math.PI) / 180 : 0;
  // Triangle pointing in heading direction — larger and filled
  const triSize = 11;
  const p1x = cx + Math.sin(headingRad) * triSize;
  const p1y = cy - Math.cos(headingRad) * triSize;
  const p2x = cx + Math.sin(headingRad + 2.4) * triSize * 0.6;
  const p2y = cy - Math.cos(headingRad + 2.4) * triSize * 0.6;
  const p3x = cx + Math.sin(headingRad - 2.4) * triSize * 0.6;
  const p3y = cy - Math.cos(headingRad - 2.4) * triSize * 0.6;

  const fill = `${color}88`;
  const sw = isSelected ? 2.5 : 1.5;
  const selectedRing = isSelected
    ? `<circle cx="${cx}" cy="${cy}" r="14" fill="none" stroke="${color}" stroke-width="1" stroke-dasharray="3,2" opacity="0.6"/>`
    : "";

  // Small callsign label below icon
  const label = callsign
    ? `<text x="${cx}" y="${size - 2}" text-anchor="middle" font-size="7" font-weight="600" font-family="monospace" fill="${color}" opacity="0.8">${callsign}</text>`
    : "";

  const svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    <polygon points="${p1x},${p1y} ${p2x},${p2y} ${p3x},${p3y}" fill="${fill}" stroke="${color}" stroke-width="${sw}"/>
    ${selectedRing}
    ${label}
  </svg>`;

  return L.divIcon({
    html: svg,
    className: blinkClass || "",
    iconSize: [size, size],
    iconAnchor: [cx, cy],
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

function formatSensorMarkerLabel(name: string): string {
  const numberedCameraMatch = name.match(/^EO\/IR CAMERA\s+#(\d+)$/i);
  if (numberedCameraMatch) {
    return `EO/IR #${numberedCameraMatch[1]}`;
  }
  return (name || "SENSOR").toUpperCase().slice(0, 8);
}

function createSensorIcon(name: string, isSelected = false): L.DivIcon {
  const label = formatSensorMarkerLabel(name);
  const stroke = isSelected ? "#d29922" : "#58a6ff";
  const fill = isSelected ? "rgba(210,153,34,0.22)" : "rgba(88,166,255,0.15)";
  const svg = `<svg width="34" height="34" viewBox="0 0 34 34" xmlns="http://www.w3.org/2000/svg">
    <circle cx="17" cy="17" r="10" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
    <circle cx="17" cy="17" r="2.5" fill="${stroke}"/>
    ${isSelected ? `<circle cx="17" cy="17" r="14" fill="none" stroke="#d29922" stroke-width="1.5" stroke-dasharray="3,2" opacity="0.95"/>` : ""}
    <text x="17" y="33" text-anchor="middle" fill="${stroke}" font-size="7" font-weight="600" font-family="monospace">${label}</text>
  </svg>`;
  return L.divIcon({ html: svg, className: "", iconSize: [34, 34], iconAnchor: [17, 17] });
}

function createEffectorIcon(name: string, jammerActive?: boolean): L.DivIcon {
  const label = (name || "EFFECTOR").toUpperCase().slice(0, 8);
  const glowFilter = jammerActive
    ? `<filter id="jam-glow"><feGaussianBlur stdDeviation="2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`
    : "";
  const pulseCircle = jammerActive
    ? `<circle cx="17" cy="17" r="15" fill="none" stroke="#e3b341" stroke-width="1.5" opacity="0.6"><animate attributeName="r" values="15;20;15" dur="1.5s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.6;0.15;0.6" dur="1.5s" repeatCount="indefinite"/></circle>`
    : "";
  const filterAttr = jammerActive ? ' filter="url(#jam-glow)"' : "";
  const svg = `<svg width="34" height="34" viewBox="0 0 34 34" xmlns="http://www.w3.org/2000/svg">
    ${glowFilter}
    ${pulseCircle}
    <rect x="7" y="7" width="20" height="20" rx="2" fill="rgba(240,136,62,0.15)" stroke="#f0883e" stroke-width="1.5"${filterAttr}/>
    <line x1="17" y1="11" x2="17" y2="23" stroke="#f0883e" stroke-width="1.5"/>
    <line x1="11" y1="17" x2="23" y2="17" stroke="#f0883e" stroke-width="1.5"/>
    <text x="17" y="33" text-anchor="middle" fill="${jammerActive ? "#e3b341" : "#f0883e"}" font-size="7" font-weight="600" font-family="monospace">${label}</text>
  </svg>`;
  return L.divIcon({ html: svg, className: "", iconSize: [34, 34], iconAnchor: [17, 17] });
}

// Component to handle map click for deselecting tracks
function MapClickHandler({
  onSelectTrack,
  onMapClick,
  onMapContextMenu,
}: {
  onSelectTrack: (id: string | null) => void;
  onMapClick?: (e: L.LeafletMouseEvent) => void;
  onMapContextMenu?: (e: L.LeafletMouseEvent) => void;
}) {
  const map = useMap();
  useEffect(() => {
    const clickHandler = (e: L.LeafletMouseEvent) => {
      if (onMapClick) {
        onMapClick(e);
      } else {
        onSelectTrack(null);
      }
    };
    const ctxHandler = (e: L.LeafletMouseEvent) => {
      if (onMapContextMenu) {
        L.DomEvent.preventDefault(e.originalEvent);
        onMapContextMenu(e);
      }
    };
    map.on("click", clickHandler);
    map.on("contextmenu", ctxHandler);
    return () => {
      map.off("click", clickHandler);
      map.off("contextmenu", ctxHandler);
    };
  }, [map, onSelectTrack, onMapClick, onMapContextMenu]);
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

// Component to capture map ref
function MapRefCapture({ mapRef }: { mapRef: React.MutableRefObject<L.Map | null> }) {
  const map = useMap();
  useEffect(() => {
    mapRef.current = map;
    return () => { mapRef.current = null; };
  }, [map, mapRef]);
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

// EW Radiate animation: expanding concentric rings from jammer position
function EWRadiateOverlay({
  center,
  rangeKm,
  baseLat,
  baseLng,
}: {
  center: [number, number]; // game XY
  rangeKm: number;
  baseLat: number;
  baseLng: number;
}) {
  const map = useMap();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animRef = useRef<number>(0);
  const startRef = useRef(Date.now());

  useEffect(() => {
    const container = map.getContainer();
    let canvas = canvasRef.current;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.style.position = "absolute";
      canvas.style.top = "0";
      canvas.style.left = "0";
      canvas.style.pointerEvents = "none";
      canvas.style.zIndex = "450";
      container.appendChild(canvas);
      canvasRef.current = canvas;
    }

    startRef.current = Date.now();

    const draw = () => {
      if (!canvas) return;
      const size = map.getSize();
      canvas.width = size.x;
      canvas.height = size.y;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const pos = gameXYToLatLng(center[0], center[1], baseLat, baseLng);
      const screenPt = map.latLngToContainerPoint(L.latLng(pos[0], pos[1]));
      const edgePt = map.latLngToContainerPoint(
        L.latLng(...gameXYToLatLng(center[0] + rangeKm, center[1], baseLat, baseLng)),
      );
      const maxRadiusPx = Math.abs(edgePt.x - screenPt.x);

      const elapsed = (Date.now() - startRef.current) / 1000;
      const ringCount = 4;
      const cycleDuration = 3; // seconds for a ring to reach max radius

      for (let i = 0; i < ringCount; i++) {
        const phase = ((elapsed + (i * cycleDuration) / ringCount) % cycleDuration) / cycleDuration;
        const radius = phase * maxRadiusPx;
        const opacity = Math.max(0, 0.6 * (1 - phase));

        ctx.beginPath();
        ctx.arc(screenPt.x, screenPt.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0, 200, 255, ${opacity})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Glow at center
      const glowPhase = (Math.sin(elapsed * 4) + 1) / 2;
      const glowRadius = 8 + glowPhase * 4;
      const gradient = ctx.createRadialGradient(screenPt.x, screenPt.y, 0, screenPt.x, screenPt.y, glowRadius);
      gradient.addColorStop(0, `rgba(0, 200, 255, ${0.6 + glowPhase * 0.3})`);
      gradient.addColorStop(1, "rgba(0, 200, 255, 0)");
      ctx.beginPath();
      ctx.arc(screenPt.x, screenPt.y, glowRadius, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      // "JAMMING" label
      ctx.font = "bold 10px 'JetBrains Mono', monospace";
      ctx.fillStyle = `rgba(0, 200, 255, ${0.7 + glowPhase * 0.3})`;
      ctx.textAlign = "center";
      ctx.fillText("JAMMING", screenPt.x, screenPt.y - 20);

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);

    // Redraw on map move/zoom
    const redraw = () => {
      cancelAnimationFrame(animRef.current);
      animRef.current = requestAnimationFrame(draw);
    };
    map.on("move", redraw);
    map.on("zoom", redraw);

    return () => {
      cancelAnimationFrame(animRef.current);
      map.off("move", redraw);
      map.off("zoom", redraw);
      if (canvas && canvas.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }
      canvasRef.current = null;
    };
  }, [map, center, rangeKm, baseLat, baseLng]);

  return null;
}

// Jackal intercept animation: triangle flying from effector to target
function JackalInterceptOverlay({
  startXY,
  targetXY,
  effective,
  startTime,
  duration,
  baseLat,
  baseLng,
}: {
  startXY: [number, number];
  targetXY: [number, number];
  effective: boolean;
  startTime: number;
  duration: number;
  baseLat: number;
  baseLng: number;
}) {
  const map = useMap();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const container = map.getContainer();
    let canvas = canvasRef.current;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.style.position = "absolute";
      canvas.style.top = "0";
      canvas.style.left = "0";
      canvas.style.pointerEvents = "none";
      canvas.style.zIndex = "460";
      container.appendChild(canvas);
      canvasRef.current = canvas;
    }

    const draw = () => {
      if (!canvas) return;
      const size = map.getSize();
      canvas.width = size.x;
      canvas.height = size.y;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const elapsed = Date.now() - startTime;
      const t = Math.min(elapsed / duration, 1); // 0 to 1 = flight phase

      const startLL = gameXYToLatLng(startXY[0], startXY[1], baseLat, baseLng);
      const targetLL = gameXYToLatLng(targetXY[0], targetXY[1], baseLat, baseLng);
      const sp = map.latLngToContainerPoint(L.latLng(startLL[0], startLL[1]));
      const tp = map.latLngToContainerPoint(L.latLng(targetLL[0], targetLL[1]));

      // Current position with arc trajectory (quadratic curve for horizontal flight appearance)
      const arcHeight = Math.min(Math.hypot(tp.x - sp.x, tp.y - sp.y) * 0.15, 60); // 15% of distance, max 60px
      const arcOffset = Math.sin(t * Math.PI) * arcHeight; // Peaks at t=0.5
      // Perpendicular offset vector
      const dx = tp.x - sp.x;
      const dy = tp.y - sp.y;
      const len = Math.hypot(dx, dy) || 1;
      const perpX = -dy / len; // Perpendicular to flight path
      const perpY = dx / len;
      const cx = sp.x + dx * t + perpX * arcOffset;
      const cy = sp.y + dy * t + perpY * arcOffset;

      if (t < 1) {
        // Draw trail (red dashed line from start to current)
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = "rgba(248, 81, 73, 0.6)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(cx, cy);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw interceptor triangle
        const angle = Math.atan2(tp.y - sp.y, tp.x - sp.x);
        const sz = 8;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        ctx.fillStyle = "#f85149";
        ctx.beginPath();
        ctx.moveTo(sz, 0);
        ctx.lineTo(-sz * 0.6, -sz * 0.5);
        ctx.lineTo(-sz * 0.6, sz * 0.5);
        ctx.closePath();
        ctx.fill();

        // Glow behind interceptor
        ctx.shadowColor = "#f85149";
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.restore();
      } else {
        // Explosion phase
        const explosionElapsed = elapsed - duration;
        const explosionDuration = 1200; // ms
        const explosionT = Math.min(explosionElapsed / explosionDuration, 1);

        if (explosionT < 1) {
          if (effective) {
            // Expanding orange circle that fades
            const maxRadius = 30;
            const radius = explosionT * maxRadius;
            const opacity = 1 - explosionT;

            // Outer ring
            ctx.beginPath();
            ctx.arc(tp.x, tp.y, radius, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(240, 136, 62, ${opacity})`;
            ctx.lineWidth = 3;
            ctx.stroke();

            // Inner fill
            ctx.beginPath();
            ctx.arc(tp.x, tp.y, radius * 0.7, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(240, 136, 62, ${opacity * 0.4})`;
            ctx.fill();

            // Flash center
            if (explosionT < 0.3) {
              const flashOp = 1 - explosionT / 0.3;
              ctx.beginPath();
              ctx.arc(tp.x, tp.y, 6, 0, Math.PI * 2);
              ctx.fillStyle = `rgba(255, 255, 200, ${flashOp})`;
              ctx.fill();
            }
          } else {
            // Failed: small flash at target then interceptor self-destructs
            const flashRadius = 12 * (1 - explosionT);
            const opacity = 1 - explosionT;
            ctx.beginPath();
            ctx.arc(tp.x, tp.y, flashRadius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(248, 81, 73, ${opacity * 0.5})`;
            ctx.fill();

            // Small sparks
            if (explosionT < 0.5) {
              for (let i = 0; i < 4; i++) {
                const sa = (Math.PI * 2 * i) / 4 + explosionT * 3;
                const sd = 8 + explosionT * 15;
                ctx.beginPath();
                ctx.arc(tp.x + Math.cos(sa) * sd, tp.y + Math.sin(sa) * sd, 2, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(248, 81, 73, ${(1 - explosionT * 2) * 0.8})`;
                ctx.fill();
              }
            }
          }
        }

        // Still draw trail during explosion
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = `rgba(248, 81, 73, ${Math.max(0, 0.4 - explosionT * 0.4)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(tp.x, tp.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);

    const redraw = () => {
      cancelAnimationFrame(animRef.current);
      animRef.current = requestAnimationFrame(draw);
    };
    map.on("move", redraw);
    map.on("zoom", redraw);

    return () => {
      cancelAnimationFrame(animRef.current);
      map.off("move", redraw);
      map.off("zoom", redraw);
      if (canvas && canvas.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }
      canvasRef.current = null;
    };
  }, [map, startXY, targetXY, effective, startTime, duration, baseLat, baseLng]);

  return null;
}

function DEBeamOverlay({
  startXY,
  targetXY,
  effective,
  beamType,
  startTime,
  duration,
  baseLat,
  baseLng,
}: {
  startXY: [number, number];
  targetXY: [number, number];
  effective: boolean;
  beamType: "laser" | "hpm";
  startTime: number;
  duration: number;
  baseLat: number;
  baseLng: number;
}) {
  const map = useMap();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const container = map.getContainer();
    let canvas = canvasRef.current;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.style.position = "absolute";
      canvas.style.top = "0";
      canvas.style.left = "0";
      canvas.style.pointerEvents = "none";
      canvas.style.zIndex = "460";
      container.appendChild(canvas);
      canvasRef.current = canvas;
    }

    const draw = () => {
      if (!canvas) return;
      const size = map.getSize();
      canvas.width = size.x;
      canvas.height = size.y;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const elapsed = Date.now() - startTime;
      const t = Math.min(elapsed / duration, 1);

      const startLL = gameXYToLatLng(startXY[0], startXY[1], baseLat, baseLng);
      const targetLL = gameXYToLatLng(targetXY[0], targetXY[1], baseLat, baseLng);
      const sp = map.latLngToContainerPoint(L.latLng(startLL[0], startLL[1]));
      const tp = map.latLngToContainerPoint(L.latLng(targetLL[0], targetLL[1]));

      const dx = tp.x - sp.x;
      const dy = tp.y - sp.y;
      const len = Math.hypot(dx, dy) || 1;
      // Perpendicular unit vector
      const perpX = -dy / len;
      const perpY = dx / len;

      // Beam extends from effector to target over first 30% of duration
      const beamT = Math.min(t / 0.3, 1);
      const beamEndX = sp.x + dx * beamT;
      const beamEndY = sp.y + dy * beamT;

      if (beamType === "laser") {
        // --- LASER: tight bright beam with glow ---
        const pulseFlicker = 0.8 + 0.2 * Math.sin(elapsed * 0.02); // subtle flicker
        const sourceGlow = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, 24);
        sourceGlow.addColorStop(0, `rgba(255, 225, 160, ${0.9 * (1 - t)})`);
        sourceGlow.addColorStop(0.4, `rgba(255, 140, 60, ${0.35 * (1 - t)})`);
        sourceGlow.addColorStop(1, "rgba(255, 120, 60, 0)");

        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 24, 0, Math.PI * 2);
        ctx.fillStyle = sourceGlow;
        ctx.fill();

        // Outer glow (wide, faint red)
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(beamEndX, beamEndY);
        ctx.strokeStyle = `rgba(255, 80, 40, ${0.28 * pulseFlicker * (1 - t)})`;
        ctx.lineWidth = 16;
        ctx.stroke();

        // Mid glow
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(beamEndX, beamEndY);
        ctx.strokeStyle = `rgba(255, 140, 60, ${0.58 * pulseFlicker * (1 - t)})`;
        ctx.lineWidth = 6;
        ctx.stroke();

        // Core beam (bright white-orange, thin)
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(beamEndX, beamEndY);
        ctx.strokeStyle = `rgba(255, 235, 210, ${pulseFlicker * (1 - t)})`;
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Impact flash at target when beam arrives
        if (t >= 0.3 && t < 0.8) {
          const impactT = (t - 0.3) / 0.5;
          const flashR = 8 + impactT * 15;
          const flashOp = (1 - impactT) * pulseFlicker;
          const impactGlow = ctx.createRadialGradient(tp.x, tp.y, 0, tp.x, tp.y, flashR * 1.5);
          impactGlow.addColorStop(0, effective
            ? `rgba(255, 245, 180, ${flashOp})`
            : `rgba(255, 140, 70, ${flashOp * 0.9})`);
          impactGlow.addColorStop(0.5, effective
            ? `rgba(255, 170, 70, ${flashOp * 0.55})`
            : `rgba(255, 90, 50, ${flashOp * 0.4})`);
          impactGlow.addColorStop(1, "rgba(255, 120, 60, 0)");

          ctx.beginPath();
          ctx.arc(tp.x, tp.y, flashR * 1.5, 0, Math.PI * 2);
          ctx.fillStyle = impactGlow;
          ctx.fill();

          ctx.beginPath();
          ctx.arc(tp.x, tp.y, flashR, 0, Math.PI * 2);
          ctx.fillStyle = effective
            ? `rgba(255, 200, 100, ${flashOp * 0.6})`
            : `rgba(255, 100, 50, ${flashOp * 0.4})`;
          ctx.fill();
        }
      } else {
        // --- HPM: wide pulse cone expanding toward target ---
        const coneWidth = 34 + beamT * 52;
        const secondaryWidth = coneWidth * 0.62;
        const emPulse = 0.65 + 0.35 * Math.sin(elapsed * 0.015);
        const frontRingR = 18 + beamT * 34;
        const sustainedBeamOpacity = Math.max(0.24, 0.72 - t * 0.42);

        const sourceGlow = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, 34);
        sourceGlow.addColorStop(0, `rgba(120, 255, 255, ${0.95 * sustainedBeamOpacity})`);
        sourceGlow.addColorStop(0.45, `rgba(0, 210, 255, ${0.38 * sustainedBeamOpacity})`);
        sourceGlow.addColorStop(1, "rgba(0, 180, 255, 0)");
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 34, 0, Math.PI * 2);
        ctx.fillStyle = sourceGlow;
        ctx.fill();

        // Draw cone shape from effector to beam front
        ctx.beginPath();
        ctx.moveTo(sp.x + perpX * 6, sp.y + perpY * 6);
        ctx.lineTo(sp.x - perpX * 6, sp.y - perpY * 6);
        ctx.lineTo(beamEndX - perpX * coneWidth, beamEndY - perpY * coneWidth);
        ctx.lineTo(beamEndX + perpX * coneWidth, beamEndY + perpY * coneWidth);
        ctx.closePath();

        // Pulsing EM fill
        const coneGrad = ctx.createLinearGradient(sp.x, sp.y, beamEndX, beamEndY);
        coneGrad.addColorStop(0, `rgba(40, 255, 255, ${0.18 * sustainedBeamOpacity * emPulse})`);
        coneGrad.addColorStop(0.45, `rgba(0, 220, 255, ${0.34 * sustainedBeamOpacity * emPulse})`);
        coneGrad.addColorStop(1, `rgba(0, 160, 255, ${0.58 * sustainedBeamOpacity * emPulse})`);
        ctx.fillStyle = coneGrad;
        ctx.fill();

        // Inner cone gives the pulse a more obvious core on satellite imagery
        ctx.beginPath();
        ctx.moveTo(sp.x + perpX * 3, sp.y + perpY * 3);
        ctx.lineTo(sp.x - perpX * 3, sp.y - perpY * 3);
        ctx.lineTo(beamEndX - perpX * secondaryWidth, beamEndY - perpY * secondaryWidth);
        ctx.lineTo(beamEndX + perpX * secondaryWidth, beamEndY + perpY * secondaryWidth);
        ctx.closePath();
        ctx.fillStyle = `rgba(150, 255, 255, ${0.18 * sustainedBeamOpacity * emPulse})`;
        ctx.fill();

        // Cone edges
        ctx.strokeStyle = `rgba(80, 245, 255, ${0.78 * sustainedBeamOpacity * emPulse})`;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(beamEndX + perpX * coneWidth, beamEndY + perpY * coneWidth);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(beamEndX - perpX * coneWidth, beamEndY - perpY * coneWidth);
        ctx.stroke();

        // Core spine
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(beamEndX, beamEndY);
        ctx.strokeStyle = `rgba(210, 255, 255, ${0.85 * sustainedBeamOpacity})`;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Wavefront ring at beam front
        if (t < 0.95) {
          ctx.beginPath();
          ctx.arc(beamEndX, beamEndY, frontRingR, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(90, 255, 255, ${0.82 * sustainedBeamOpacity * emPulse})`;
          ctx.lineWidth = 3;
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(beamEndX, beamEndY, frontRingR * 0.58, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(180, 255, 255, ${0.48 * sustainedBeamOpacity * emPulse})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        // Impact ripple at target
        if (t >= 0.25 && t < 0.95) {
          const rippleT = (t - 0.25) / 0.7;
          const rippleR = 28 + rippleT * 68;
          const rippleOp = (1 - rippleT) * 0.85;
          const rippleGlow = ctx.createRadialGradient(tp.x, tp.y, 0, tp.x, tp.y, rippleR * 1.1);
          rippleGlow.addColorStop(0, `rgba(140, 255, 255, ${rippleOp * 0.35})`);
          rippleGlow.addColorStop(0.45, `rgba(0, 220, 255, ${rippleOp * 0.2})`);
          rippleGlow.addColorStop(1, "rgba(0, 200, 255, 0)");

          ctx.beginPath();
          ctx.arc(tp.x, tp.y, rippleR * 1.1, 0, Math.PI * 2);
          ctx.fillStyle = rippleGlow;
          ctx.fill();

          ctx.beginPath();
          ctx.arc(tp.x, tp.y, rippleR, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(0, 200, 255, ${rippleOp})`;
          ctx.lineWidth = 3;
          ctx.stroke();

          for (let ring = 0; ring < 3; ring++) {
            const ringRadius = rippleR * (0.35 + ring * 0.22);
            ctx.beginPath();
            ctx.arc(tp.x, tp.y, ringRadius, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(180, 255, 255, ${rippleOp * (0.45 - ring * 0.1)})`;
            ctx.lineWidth = 1.4;
            ctx.stroke();
          }

          for (let spoke = 0; spoke < 8; spoke++) {
            const angle = (Math.PI * 2 * spoke) / 8 + elapsed * 0.0025;
            const inner = rippleR * 0.25;
            const outer = rippleR * 0.95;
            ctx.beginPath();
            ctx.moveTo(tp.x + Math.cos(angle) * inner, tp.y + Math.sin(angle) * inner);
            ctx.lineTo(tp.x + Math.cos(angle) * outer, tp.y + Math.sin(angle) * outer);
            ctx.strokeStyle = `rgba(160, 255, 255, ${rippleOp * 0.38})`;
            ctx.lineWidth = 1.2;
            ctx.stroke();
          }

          ctx.beginPath();
          ctx.arc(tp.x, tp.y, 10 + rippleT * 10, 0, Math.PI * 2);
          ctx.fillStyle = effective
            ? `rgba(150, 255, 255, ${rippleOp * 0.35})`
            : `rgba(255, 120, 120, ${rippleOp * 0.18})`;
          ctx.fill();
        }
      }

      // Effective/ineffective marker after beam phase
      if (t >= 0.8 && t < 1) {
        const resultT = (t - 0.8) / 0.2;
        const markerOp = 1 - resultT;
        if (effective) {
          // Green ring expanding
          ctx.beginPath();
          ctx.arc(tp.x, tp.y, 10 + resultT * 20, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(0, 255, 100, ${markerOp})`;
          ctx.lineWidth = 3;
          ctx.stroke();
        } else {
          // Red X fading
          const xSz = 10;
          ctx.strokeStyle = `rgba(255, 80, 60, ${markerOp})`;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(tp.x - xSz, tp.y - xSz);
          ctx.lineTo(tp.x + xSz, tp.y + xSz);
          ctx.moveTo(tp.x + xSz, tp.y - xSz);
          ctx.lineTo(tp.x - xSz, tp.y + xSz);
          ctx.stroke();
        }
      }

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);

    const redraw = () => {
      cancelAnimationFrame(animRef.current);
      animRef.current = requestAnimationFrame(draw);
    };
    map.on("move", redraw);
    map.on("zoom", redraw);

    return () => {
      cancelAnimationFrame(animRef.current);
      map.off("move", redraw);
      map.off("zoom", redraw);
      if (canvas && canvas.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }
      canvasRef.current = null;
    };
  }, [map, startXY, targetXY, effective, beamType, startTime, duration, baseLat, baseLng]);

  return null;
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
  const isInterceptor = !!track.is_interceptor;
  const color = track.neutralized
    ? "#484f58"
    : isInterceptor ? "#3fb950" : AFFILIATION_COLORS[track.affiliation];
  const phaseChar = isInterceptor ? "I" : (DTID_PHASE_LETTER[track.dtid_phase] || "?");
  const range = Math.sqrt(track.x * track.x + track.y * track.y);
  const bearing = ((Math.atan2(track.x, track.y) * 180) / Math.PI + 360) % 360;

  // Offset to avoid overlaps: alternate right/left for stacked tracks
  const yOff = offsetIndex * 18;

  const isCoasting = track.coasting;
  const isJammed = track.jammed && !track.neutralized;
  const blockOpacity = isCoasting ? 0.5 : 1.0;
  const coastLabel = isCoasting
    ? `<span style="color:#d29922;font-size:7px;font-weight:700;margin-left:4px;">COAST</span>`
    : "";
  const hfLabel = track.hold_fire
    ? `<span style="color:#f85149;font-size:7px;font-weight:700;margin-left:4px;">HF</span>`
    : "";
  const jamLabel = isJammed
    ? `<span style="display:inline-block;background:#1f6feb33;border:1px solid #1f6feb88;border-radius:2px;padding:0 3px;margin-left:4px;color:#58a6ff;font-size:7px;font-weight:700;animation:track-blink 1s ease-in-out infinite;">JAM</span>`
    : "";
  const interceptPhaseLabel = isInterceptor && track.intercept_phase && !track.neutralized
    ? track.intercept_phase === "spinup"
      ? `<span style="color:#d29922;font-size:7px;font-weight:700;margin-left:4px;">SPINUP T-${Math.ceil(track.spinup_remaining ?? 0)}s</span>`
      : `<span style="color:#3fb950;font-size:7px;font-weight:700;margin-left:4px;">${track.intercept_phase.toUpperCase()}</span>`
    : "";
  const isShenobiCM = !!track.shenobi_cm_active && !track.neutralized;
  const shenobiLabel = isShenobiCM
    ? `<span style="color:#a371f7;font-size:7px;font-weight:700;margin-left:4px;animation:track-blink 1s ease-in-out infinite;">${track.shenobi_cm_state || "PM"}</span>`
    : "";
  const freqLabel = track.frequency_band && !track.neutralized
    ? `<span style="color:#a371f7;font-size:7px;opacity:0.7;margin-left:3px;">${track.frequency_band}</span>`
    : "";

  // DTID phase color for the phase badge
  const phaseColors: Record<string, string> = {
    detected: "#8b949e",
    tracked: "#d29922",
    identified: track.affiliation === "hostile" ? "#f85149" : track.affiliation === "friendly" ? "#3fb950" : "#d29922",
    defeated: "#484f58",
  };
  const phaseColor = isInterceptor ? "#3fb950" : (phaseColors[track.dtid_phase] || "#8b949e");

  // Affiliation border color for left accent
  const borderAccent = track.neutralized ? "#484f58" : (isInterceptor ? "#3fb950" : AFFILIATION_COLORS[track.affiliation]);

  // ETA to protected area
  const eta = track.eta_protected;
  let etaLabel = "";
  if (eta != null && !track.neutralized) {
    const etaColor = eta <= 15 ? "#f85149" : eta <= 30 ? "#db6d28" : "#bc8cff";
    etaLabel = `<div style="color:${etaColor};font-size:8px;font-weight:600;">ETA: ${Math.round(eta)}s</div>`;
  }

  const html = `<div style="
    pointer-events:none;
    background:rgba(13,17,23,${isSelected ? "0.94" : "0.82"});
    border:1px solid ${isSelected ? color : "#30363d"};
    border-left:3px solid ${borderAccent};
    ${isCoasting ? "border-style:dashed;border-left-style:solid;" : ""}
    border-radius:3px;
    padding:2px 6px 2px 5px;
    white-space:nowrap;
    font-family:'JetBrains Mono',monospace;
    line-height:1.35;
    position:relative;
    opacity:${blockOpacity};
  ">
    <div style="
      position:absolute;
      left:-12px;
      top:9px;
      width:9px;
      height:1px;
      background:${isSelected ? color : "#30363d"};
    "></div>
    <div style="color:${color};font-size:${isSelected ? "11px" : "10px"};font-weight:700;letter-spacing:0.5px;">
      ${(track.display_label || track.id).toUpperCase()} <span style="color:${phaseColor};font-size:8px;font-weight:600;opacity:0.9;">${phaseChar}</span>${freqLabel}${coastLabel}${hfLabel}${jamLabel}${shenobiLabel}${interceptPhaseLabel}
    </div>
    ${!track.neutralized ? `
    <div style="color:#8b949e;font-size:8px;opacity:${isSelected ? 0.9 : 0.65};">
      SPD:${Math.round(track.speed_kts)} | ALT:${Math.round(track.altitude_ft)}
    </div>
    <div style="color:#8b949e;font-size:8px;opacity:${isSelected ? 0.9 : 0.65};">
      BRG:${Math.round(bearing)}\u00B0 | RNG:${range.toFixed(1)}km
    </div>
    ${etaLabel}` : isShenobiCM ? `
    <div style="color:#a371f7;font-size:8px;font-weight:600;">Shenobi ${(track.shenobi_cm_active || "").replace("shenobi_", "").replace("_", " ").toUpperCase()} [${track.shenobi_cm_state || "?"}]</div>` : isJammed ? `
    <div style="color:#58a6ff;font-size:8px;font-weight:600;">EW EFFECT ACTIVE</div>` : `
    <div style="color:#484f58;font-size:8px;">NEUTRALIZED</div>`}
  </div>`;

  const icon = L.divIcon({
    html,
    className: "",
    iconSize: [130, 52],
    iconAnchor: [-22, 14 - yOff],
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
  onCallATC,
  onDeclareAffiliation,
  cameraTrackId,
  selectedCameraId,
  sensorConfigs = [],
  protectedArea,
  trackBlinkStates = {},
  newContactBanner,
  baseAssets = [],
  baseBoundary,
  activeJammers = {},
  activeIntercepts = [],
  activeDEBeams = [],
  onJammerToggle,
  baseBreached = false,
}: Props) {
  const baseCenter: [number, number] = [baseLat ?? 33.0, baseLng ?? 44.5];
  const [wheelState, setWheelState] = useState<WheelState | null>(null);
  const [deviceWheelState, setDeviceWheelState] = useState<DeviceWheelState | null>(null);
  const [showRangeRings, setShowRangeRings] = useState(true);
  const [hiddenRings, setHiddenRings] = useState<Set<string>>(new Set());
  const [selectionList, setSelectionList] = useState<SelectionListState | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  // Breach flash state
  const [breachFlash, setBreachFlash] = useState(false);
  useEffect(() => {
    if (!baseBreached) {
      setBreachFlash(false);
      return;
    }
    const interval = setInterval(() => setBreachFlash((v) => !v), 500);
    return () => clearInterval(interval);
  }, [baseBreached]);

  // Bulls-eye overlay state
  const [showBullseye, setShowBullseye] = useState(true);
  const [bullseyeCenter, setBullseyeCenter] = useState<[number, number]>(baseCenter);
  const [bullseyeContextMenu, setBullseyeContextMenu] = useState<{ x: number; y: number; latlng: [number, number] } | null>(null);

  // Saved locations state
  interface SavedLocation {
    label: string;
    center: [number, number];
    zoom: number;
  }
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

  const [savedLocations, setSavedLocations] = useState<SavedLocation[]>(() => {
    // Pre-populate with base center and protected assets
    const defaultZoomVal = 13;
    const locs: SavedLocation[] = [
      { label: "BASE CENTER", center: [baseLat ?? 33.0, baseLng ?? 44.5], zoom: defaultZoomVal },
    ];
    for (const asset of baseAssets) {
      const pos = gameXYToLatLng(asset.x, asset.y, baseLat ?? 33.0, baseLng ?? 44.5);
      locs.push({ label: asset.name.toUpperCase(), center: pos, zoom: Math.max(defaultZoomVal, 14) });
    }
    return locs;
  });
  const [showSavedLocs, setShowSavedLocs] = useState(false);
  const [savingNewLoc, setSavingNewLoc] = useState(false);
  const [newLocLabel, setNewLocLabel] = useState("");

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

  // Helper: convert game XY to screen pixel using map ref
  const gameXYToScreen = useCallback(
    (x: number, y: number): { x: number; y: number } | null => {
      const map = mapRef.current;
      if (!map) return null;
      const ll = gameXYToLatLng(x, y, baseLat, baseLng);
      const pt = map.latLngToContainerPoint(L.latLng(ll[0], ll[1]));
      const container = map.getContainer();
      const rect = container.getBoundingClientRect();
      return { x: pt.x + rect.left, y: pt.y + rect.top };
    },
    [baseLat, baseLng],
  );

  // Disambiguation: check if click is near multiple objects
  const checkDisambiguation = useCallback(
    (screenX: number, screenY: number, isRightClick: boolean): boolean => {
      const toScreen = (obj: { x?: number; y?: number }) =>
        obj.x != null ? gameXYToScreen(obj.x ?? 0, obj.y ?? 0) : null;

      const items = findNearbySelectables(
        screenX,
        screenY,
        tracks,
        sensorConfigs,
        effectors,
        (t) => gameXYToScreen(t.x, t.y),
        (s) => toScreen(s),
        (e) => toScreen(e),
        30,
      );

      if (items.length > 1) {
        setSelectionList({ items, screenX, screenY, isRightClick });
        return true; // disambiguation shown
      }
      return false; // no disambiguation needed
    },
    [tracks, sensorConfigs, effectors, gameXYToScreen],
  );

  // Map-level click handler with disambiguation
  const handleMapClick = useCallback(
    (e: L.LeafletMouseEvent) => {
      setBullseyeContextMenu(null);
      const sx = e.originalEvent.clientX;
      const sy = e.originalEvent.clientY;
      if (!checkDisambiguation(sx, sy, false)) {
        onSelectTrack(null);
      }
    },
    [checkDisambiguation, onSelectTrack],
  );

  const handleMapContextMenu = useCallback(
    (e: L.LeafletMouseEvent) => {
      const sx = e.originalEvent.clientX;
      const sy = e.originalEvent.clientY;
      // If right-click didn't hit a track/device, show bulls-eye context menu
      if (!checkDisambiguation(sx, sy, true)) {
        setBullseyeContextMenu({
          x: sx,
          y: sy,
          latlng: [e.latlng.lat, e.latlng.lng],
        });
      }
    },
    [checkDisambiguation],
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
        <MapRefCapture mapRef={mapRef} />
        <MapClickHandler
          onSelectTrack={onSelectTrack}
          onMapClick={handleMapClick}
          onMapContextMenu={handleMapContextMenu}
        />
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

        {/* Engagement zone rings — only when range rings are toggled on */}
        {engagementZones && showRangeRings && (
          <>
            <Circle
              center={baseCenter}
              radius={engagementZones.detection_range_km * 1000}
              pathOptions={{
                color: "#4a5568",
                fillColor: "transparent",
                fillOpacity: 0,
                weight: 2,
                opacity: 0.6,
                dashArray: "6,4",
              }}
            />
            <Circle
              center={baseCenter}
              radius={engagementZones.engagement_range_km * 1000}
              pathOptions={{
                color: "#3d6b9e",
                fillColor: "transparent",
                fillOpacity: 0,
                weight: 2,
                opacity: 0.6,
                dashArray: "6,4",
              }}
            />
            <Circle
              center={baseCenter}
              radius={engagementZones.identification_range_km * 1000}
              pathOptions={{
                color: "#7d5a1a",
                fillColor: "transparent",
                fillOpacity: 0,
                weight: 2,
                opacity: 0.6,
                dashArray: "6,4",
              }}
            />
          </>
        )}

        {/* Custom base boundary polygon */}
        {baseBoundary && baseBoundary.length >= 3 && (
          <Polygon
            positions={baseBoundary.map(([x, y]) => gameXYToLatLng(x, y, baseLat, baseLng))}
            pathOptions={{
              color: baseBreached ? (breachFlash ? "#f85149" : "#d29922") : "#d29922",
              fillColor: baseBreached && breachFlash ? "#f85149" : "#d29922",
              fillOpacity: baseBreached && breachFlash ? 0.12 : 0.05,
              weight: 2,
              dashArray: "8,4",
              opacity: 0.8,
            }}
          />
        )}

        {/* Protected Area overlay (purple) — hidden when a custom boundary polygon is shown */}
        {protectedArea && !baseBoundary && (() => {
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
              {/* Protected Area (inner, purple — flashes red on breach) */}
              <Circle
                center={paCenter}
                radius={protectedArea.radius_km * 1000}
                pathOptions={{
                  color: baseBreached
                    ? (breachFlash ? "#f85149" : "#bc8cff")
                    : (anyWithin30s ? "#da3633" : "#bc8cff"),
                  fillColor: baseBreached && breachFlash ? "#f85149" : "#bc8cff",
                  fillOpacity: baseBreached && breachFlash ? 0.15 : 0.06,
                  weight: anyWithin30s || baseBreached ? 2.5 : 2,
                  opacity: anyWithin30s || baseBreached ? 0.9 : 0.7,
                  dashArray: (anyWithin30s || baseBreached) ? undefined : "4,4",
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
          // EO/IR camera FOV is shown via the slewed cone — skip range ring entirely
          if (sensor.type === "eoir" || sensor.name?.toLowerCase().includes("camera") || sensor.name?.toLowerCase().includes("eo")) return null;
          const style = getRingStyleByName(sensor.name, sensor.type);
          const sPos = gameXYToLatLng(sensor.x ?? 0, sensor.y ?? 0, baseLat, baseLng);
          const rangeKm = sensor.range_km;
          const fov = sensor.fov_deg ?? 360;
          const facing = sensor.facing_deg ?? 0;
          const isSelected = false;
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
                    weight: 2,
                    opacity: 0.7,
                    dashArray: style.dashArray,
                    fillOpacity: 0,
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
                  weight: 2,
                  opacity: 0.7,
                  dashArray: style.dashArray,
                  fillOpacity: 0,
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
          const fov = eff.fov_deg ?? 360;
          const facing = eff.facing_deg ?? 0;

          if (fov < 360) {
            const steps = 32;
            const facingRad = ((90 - facing) * Math.PI) / 180;
            const halfFov = ((fov / 2) * Math.PI) / 180;
            const points: [number, number][] = [ePos];
            for (let i = 0; i <= steps; i++) {
              const angle = facingRad - halfFov + (2 * halfFov * i) / steps;
              const px = (eff.x ?? 0) + Math.cos(angle) * rangeKm;
              const py = (eff.y ?? 0) + Math.sin(angle) * rangeKm;
              points.push(gameXYToLatLng(px, py, baseLat, baseLng));
            }

            const labelX = (eff.x ?? 0) + Math.cos(facingRad) * rangeKm;
            const labelY = (eff.y ?? 0) + Math.sin(facingRad) * rangeKm;
            const labelPos = gameXYToLatLng(labelX, labelY, baseLat, baseLng);
            const fillOpacity = eff.type === "de_hpm" ? 0.08 : 0.04;

            return (
              <span key={`effector-ring-${eff.id}`}>
                <Polygon
                  positions={points}
                  pathOptions={{
                    color: style.color,
                    weight: 2,
                    opacity: 0.9,
                    dashArray: style.dashArray,
                    fillColor: style.color,
                    fillOpacity,
                  }}
                />
                <Marker
                  position={labelPos}
                  icon={createRingLabel(eff.name || eff.id, rangeKm, style.color)}
                  interactive={false}
                />
              </span>
            );
          }

          const labelPos = gameXYToLatLng(eff.x ?? 0, (eff.y ?? 0) + rangeKm, baseLat, baseLng);
          return (
            <span key={`effector-ring-${eff.id}`}>
              <Circle
                center={ePos}
                radius={rangeKm * 1000}
                pathOptions={{
                  color: style.color,
                  weight: 2,
                  opacity: 0.8,
                  dashArray: style.dashArray,
                  fillOpacity: 0,
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

        {/* EW Radiate animation for active jammers (engagement-triggered + passive toggle) */}
        {(() => {
          const activeIds = new Set(Object.keys(activeJammers));
          // Also include jammers with jammer_active flag from passive toggle
          effectors.forEach((e) => {
            if (e.jammer_active) activeIds.add(e.id);
          });
          return Array.from(activeIds).map((jammerId) => {
            const eff = effectors.find((e) => e.id === jammerId);
            if (!eff || eff.x == null) return null;
            return (
              <EWRadiateOverlay
                key={`ew-radiate-${jammerId}`}
                center={[eff.x ?? 0, eff.y ?? 0]}
                rangeKm={eff.range_km ?? 3}
                baseLat={baseLat}
                baseLng={baseLng}
              />
            );
          });
        })()}

        {/* JACKAL intercept animations */}
        {activeIntercepts.map((intercept) => (
          <JackalInterceptOverlay
            key={intercept.id}
            startXY={[intercept.startX, intercept.startY]}
            targetXY={[intercept.targetX, intercept.targetY]}
            effective={intercept.effective}
            startTime={intercept.startTime}
            duration={intercept.duration}
            baseLat={baseLat}
            baseLng={baseLng}
          />
        ))}

        {/* Directed Energy beam animations */}
        {activeDEBeams.map((beam) => (
          <DEBeamOverlay
            key={beam.id}
            startXY={[beam.startX, beam.startY]}
            targetXY={[beam.targetX, beam.targetY]}
            effective={beam.effective}
            beamType={beam.beamType}
            startTime={beam.startTime}
            duration={beam.duration}
            baseLat={baseLat}
            baseLng={baseLng}
          />
        ))}

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
          const sensorLabel = getSensorDisplayLabel(sensor, sensorConfigs);
          return (
            <Marker
              key={`sensor-marker-${sensor.id}`}
              position={sPos}
              icon={createSensorIcon(sensorLabel, sensor.id === selectedCameraId)}
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
              icon={createEffectorIcon(eff.name || eff.id, eff.jammer_active)}
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

        {/* Camera FOV Cone — only shown when slewed to a track */}
        {(() => {
          if (!cameraTrackId) return null;
          const cameraTarget = tracks.find((t) => t.id === cameraTrackId && !t.neutralized);
          if (!cameraTarget) return null;

          const cameraSensor = getActiveCameraSensor(sensorConfigs, selectedCameraId);
          if (!cameraSensor) return null;

          const camX = cameraSensor.x ?? 0;
          const camY = cameraSensor.y ?? 0;
          const camMaxRange = cameraSensor.range_km ?? 8;
          const camFov = cameraSensor.fov_deg ?? 30;
          const camPos = gameXYToLatLng(camX, camY, baseLat, baseLng);

          // Bearing from camera to slewed track
          const dx = cameraTarget.x - camX;
          const dy = cameraTarget.y - camY;
          const bearingDeg = (Math.atan2(dx, dy) * 180) / Math.PI;

          // Clip cone length at actual distance to target (capped at max range)
          const distToTarget = Math.sqrt(dx * dx + dy * dy);
          const coneRange = Math.min(distToTarget, camMaxRange);

          // Build cone polygon: camera position -> arc at coneRange
          const halfFov = camFov / 2;
          const steps = 16;
          const conePoints: [number, number][] = [camPos];

          for (let i = 0; i <= steps; i++) {
            const angle = bearingDeg - halfFov + (camFov * i) / steps;
            const angleRad = (angle * Math.PI) / 180;
            const px = camX + Math.sin(angleRad) * coneRange;
            const py = camY + Math.cos(angleRad) * coneRange;
            conePoints.push(gameXYToLatLng(px, py, baseLat, baseLng));
          }

          // LOS center line to target
          const targetPos = gameXYToLatLng(cameraTarget.x, cameraTarget.y, baseLat, baseLng);

          return (
            <>
              <Polygon
                positions={conePoints}
                pathOptions={{
                  color: "#d29922",
                  fillColor: "#d29922",
                  fillOpacity: 0.25,
                  weight: 1.5,
                  opacity: 0.8,
                }}
              />
              {/* LOS line removed — cone fill is sufficient */}
            </>
          );
        })()}

        {/* Bulls-eye overlay */}
        {showBullseye && (() => {
          const BULLSEYE_RINGS_KM = [1, 2, 3, 5, 10];
          const SPOKES = [
            { deg: 0, label: "N" },
            { deg: 45, label: "NE" },
            { deg: 90, label: "E" },
            { deg: 135, label: "SE" },
            { deg: 180, label: "S" },
            { deg: 225, label: "SW" },
            { deg: 270, label: "W" },
            { deg: 315, label: "NW" },
          ];
          const outerRing = BULLSEYE_RINGS_KM[BULLSEYE_RINGS_KM.length - 1];
          const bcLat = bullseyeCenter[0];
          const bcLng = bullseyeCenter[1];
          // Convert bullseye center to game XY for offset calculations
          const bcGameX = (bcLng - baseLng) * 111.32 * Math.cos((baseLat * Math.PI) / 180);
          const bcGameY = (bcLat - baseLat) * 111.32;

          return (
            <>
              {/* Range rings */}
              {BULLSEYE_RINGS_KM.map((r) => (
                <Circle
                  key={`be-ring-${r}`}
                  center={bullseyeCenter}
                  radius={r * 1000}
                  pathOptions={{
                    color: "rgba(255,255,255,0.75)",
                    fillColor: "transparent",
                    fillOpacity: 0,
                    weight: 1.5,
                    dashArray: "6,4",
                  }}
                />
              ))}
              {/* Ring labels (positioned at due-East) */}
              {BULLSEYE_RINGS_KM.map((r) => {
                const labelPos = gameXYToLatLng(bcGameX + r, bcGameY, baseLat, baseLng);
                return (
                  <Marker
                    key={`be-label-${r}`}
                    position={labelPos}
                    icon={L.divIcon({
                      html: `<span style="font:700 9px 'JetBrains Mono',monospace;color:rgba(255,255,255,0.9);white-space:nowrap;pointer-events:none;text-shadow:0 0 4px rgba(0,0,0,0.8);">${r}km</span>`,
                      className: "",
                      iconSize: [30, 12],
                      iconAnchor: [-2, 6],
                    })}
                    interactive={false}
                  />
                );
              })}
              {/* Azimuth spokes */}
              {SPOKES.map(({ deg }) => {
                const angleRad = (deg * Math.PI) / 180;
                const endX = bcGameX + Math.sin(angleRad) * outerRing;
                const endY = bcGameY + Math.cos(angleRad) * outerRing;
                const endPos = gameXYToLatLng(endX, endY, baseLat, baseLng);
                return (
                  <Polyline
                    key={`be-spoke-${deg}`}
                    positions={[bullseyeCenter, endPos]}
                    pathOptions={{
                      color: "rgba(255,255,255,0.45)",
                      weight: 1,
                      dashArray: "2,6",
                    }}
                  />
                );
              })}
              {/* Spoke labels at outer ring */}
              {SPOKES.map(({ deg, label }) => {
                const angleRad = (deg * Math.PI) / 180;
                const labelX = bcGameX + Math.sin(angleRad) * (outerRing + 0.3);
                const labelY = bcGameY + Math.cos(angleRad) * (outerRing + 0.3);
                const labelPos = gameXYToLatLng(labelX, labelY, baseLat, baseLng);
                return (
                  <Marker
                    key={`be-spoke-label-${deg}`}
                    position={labelPos}
                    icon={L.divIcon({
                      html: `<span style="font:600 9px 'JetBrains Mono',monospace;color:rgba(255,255,255,0.45);white-space:nowrap;pointer-events:none;">${label}</span>`,
                      className: "",
                      iconSize: [20, 12],
                      iconAnchor: [10, 6],
                    })}
                    interactive={false}
                  />
                );
              })}
              {/* Center crosshair marker */}
              <Marker
                position={bullseyeCenter}
                icon={L.divIcon({
                  html: `<svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="3" fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="1.5"/><line x1="10" y1="0" x2="10" y2="6" stroke="rgba(255,255,255,0.9)" stroke-width="1.5"/><line x1="10" y1="14" x2="10" y2="20" stroke="rgba(255,255,255,0.9)" stroke-width="1.5"/><line x1="0" y1="10" x2="6" y2="10" stroke="rgba(255,255,255,0.9)" stroke-width="1.5"/><line x1="14" y1="10" x2="20" y2="10" stroke="rgba(255,255,255,0.9)" stroke-width="1.5"/></svg>`,
                  className: "",
                  iconSize: [20, 20],
                  iconAnchor: [10, 10],
                })}
                interactive={false}
              />
            </>
          );
        })()}

        {/* Tracks — let the engine prune expired neutralized tracks after a short post-kill display window */}
        {tracks.map((track) => {
          const pos = trackPosition(track);
          const isSelected = track.id === selectedTrackId;
          const isInterceptor = !!track.is_interceptor;
          const color = isInterceptor ? "#3fb950" : AFFILIATION_COLORS[track.affiliation];

          // Find target track for intercept vector line
          const interceptTarget = isInterceptor && !track.neutralized && track.interceptor_target
            ? tracks.find((t) => t.id === track.interceptor_target)
            : null;

          // Terminal phase blink for interceptors
          const blinkClass = isInterceptor && track.intercept_phase === "terminal"
            ? "jackal-terminal-blink"
            : trackBlinkStates[track.id];

          return (
            <span key={track.id}>
              {/* Trail polyline */}
              {track.trail && track.trail.length > 1 && (
                <Polyline
                  positions={trailToLatLng(track.trail)}
                  pathOptions={{
                    color,
                    weight: 1,
                    opacity: isInterceptor ? 0.6 : (track.coasting ? 0.2 : 0.5),
                    dashArray: isInterceptor ? "4,3" : (track.coasting ? "4,4" : undefined),
                  }}
                />
              )}

              {/* Intercept vector line (JACKAL to target) */}
              {interceptTarget && (
                <Polyline
                  positions={[pos, trackPosition(interceptTarget)]}
                  pathOptions={{
                    color: "#3fb950",
                    weight: 1,
                    opacity: 0.5,
                    dashArray: "3,3",
                  }}
                />
              )}

              {/* Projected path (dashed) — skip for interceptors */}
              {!isInterceptor && projectedEnd(track) && (
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

              {/* Speed leader line (solid) — skip for interceptors */}
              {!isInterceptor && speedLeaderEnd(track) && (
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
                icon={isInterceptor
                  ? createInterceptorIcon(
                      isSelected,
                      track.neutralized,
                      track.heading_deg,
                      blinkClass,
                      (track.display_label || track.id).toUpperCase(),
                    )
                  : createTrackIcon(
                      track.affiliation,
                      isSelected,
                      track.neutralized,
                      track.coasting,
                      track.hold_fire,
                      track.heading_deg,
                      track.speed_kts,
                      blinkClass,
                    )
                }
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

      {/* Bulls-eye toggle */}
      <button
        onClick={() => setShowBullseye((v) => !v)}
        style={{
          position: "absolute",
          top: 38,
          left: 10,
          zIndex: 1000,
          padding: "5px 10px",
          background: showBullseye ? "rgba(255, 255, 255, 0.12)" : "rgba(13, 17, 23, 0.8)",
          border: `1px solid ${showBullseye ? "rgba(255,255,255,0.3)" : "#30363d"}`,
          borderRadius: 4,
          color: showBullseye ? "rgba(255,255,255,0.7)" : "#8b949e",
          fontSize: 10,
          fontWeight: 600,
          fontFamily: "'JetBrains Mono', monospace",
          letterSpacing: 1,
          cursor: "pointer",
          transition: "all 0.15s",
        }}
      >
        BULLS-EYE {showBullseye ? "ON" : "OFF"}
      </button>

      {/* Bulls-eye context menu (set center) */}
      {bullseyeContextMenu && (
        <div
          style={{
            position: "fixed",
            top: bullseyeContextMenu.y,
            left: bullseyeContextMenu.x,
            zIndex: 2000,
            background: "#161b22",
            border: "1px solid #30363d",
            borderRadius: 4,
            padding: 2,
            boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
          }}
        >
          <button
            onClick={() => {
              setBullseyeCenter(bullseyeContextMenu.latlng);
              setShowBullseye(true);
              setBullseyeContextMenu(null);
            }}
            style={{
              display: "block",
              width: "100%",
              padding: "6px 14px",
              background: "none",
              border: "none",
              color: "#e6edf3",
              fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace",
              cursor: "pointer",
              textAlign: "left",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "rgba(88,166,255,0.15)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "none";
            }}
          >
            SET BULLS-EYE HERE
          </button>
        </div>
      )}

      {/* Saved locations button + dropdown */}
      <div style={{ position: "absolute", top: 10, left: 160, zIndex: 1000 }}>
        <button
          onClick={() => { setShowSavedLocs((v) => !v); setSavingNewLoc(false); }}
          style={{
            padding: "5px 10px",
            background: showSavedLocs ? "rgba(88, 166, 255, 0.15)" : "rgba(13, 17, 23, 0.8)",
            border: `1px solid ${showSavedLocs ? "#58a6ff55" : "#30363d"}`,
            borderRadius: 4,
            color: showSavedLocs ? "#58a6ff" : "#8b949e",
            fontSize: 10,
            fontWeight: 600,
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: 1,
            cursor: "pointer",
            transition: "all 0.15s",
          }}
        >
          SAVED LOC
        </button>
        {showSavedLocs && (
          <div
            style={{
              position: "absolute",
              top: 32,
              left: 0,
              background: "rgba(22, 27, 34, 0.96)",
              border: "1px solid #30363d",
              borderRadius: 6,
              padding: "4px 0",
              minWidth: 200,
              boxShadow: "0 4px 20px rgba(0,0,0,0.6)",
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {savedLocations.map((loc, i) => (
              <div
                key={i}
                onClick={() => {
                  const map = mapRef.current;
                  if (map) map.setView(loc.center, loc.zoom, { animate: true, duration: 0.5 });
                  setShowSavedLocs(false);
                }}
                style={{
                  padding: "6px 12px",
                  cursor: "pointer",
                  fontSize: 10,
                  color: "#e6edf3",
                  fontWeight: 500,
                  letterSpacing: 0.5,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(88,166,255,0.1)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <span style={{ color: "#58a6ff", fontSize: 10 }}>{"\u25C9"}</span>
                {loc.label}
              </div>
            ))}
            <div style={{ height: 1, background: "#30363d", margin: "4px 8px" }} />
            {savingNewLoc ? (
              <div style={{ padding: "6px 12px", display: "flex", gap: 6 }}>
                <input
                  autoFocus
                  value={newLocLabel}
                  onChange={(e) => setNewLocLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newLocLabel.trim()) {
                      const map = mapRef.current;
                      if (map) {
                        const c = map.getCenter();
                        const z = map.getZoom();
                        setSavedLocations((prev) => [...prev, {
                          label: newLocLabel.trim().toUpperCase(),
                          center: [c.lat, c.lng],
                          zoom: z,
                        }]);
                      }
                      setNewLocLabel("");
                      setSavingNewLoc(false);
                    } else if (e.key === "Escape") {
                      setSavingNewLoc(false);
                      setNewLocLabel("");
                    }
                  }}
                  placeholder="Label..."
                  style={{
                    flex: 1,
                    background: "#0d1117",
                    border: "1px solid #30363d",
                    borderRadius: 3,
                    color: "#e6edf3",
                    fontSize: 10,
                    fontFamily: "'JetBrains Mono', monospace",
                    padding: "3px 6px",
                    outline: "none",
                  }}
                />
              </div>
            ) : (
              <div
                onClick={() => setSavingNewLoc(true)}
                style={{
                  padding: "6px 12px",
                  cursor: "pointer",
                  fontSize: 10,
                  color: "#3fb950",
                  fontWeight: 600,
                  letterSpacing: 0.5,
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(63,185,80,0.1)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                + SAVE CURRENT VIEW
              </div>
            )}
          </div>
        )}
      </div>

      {/* NEW CONTACT banner */}
      {newContactBanner && (
        <div
          className="new-contact-banner"
          style={{
            position: "absolute",
            top: 10,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1100,
            background: "rgba(210, 153, 34, 0.2)",
            border: "1px solid rgba(210, 153, 34, 0.6)",
            borderRadius: 4,
            padding: "6px 20px",
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
              fontWeight: 700,
              color: "#d29922",
              letterSpacing: 2,
            }}
          >
            NEW CONTACT — {newContactBanner}
          </span>
        </div>
      )}

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
            onCallATC={onCallATC}
            onDeclareAffiliation={onDeclareAffiliation}
            iffStatus={wheelTrack.iff_status ?? (wheelTrack.affiliation?.toLowerCase() === "unknown" ? "unknown" : undefined)}
            atcCalled={wheelTrack.atc_called}
            classification={wheelTrack.classification ?? undefined}
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
            onJammerToggle={onJammerToggle}
            onClose={() => setDeviceWheelState(null)}
          />
        );
      })()}

      {/* BASE COMPROMISED banner */}
      {baseBreached && (
        <div style={{
          position: "absolute",
          top: 16,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 1000,
          background: "rgba(248, 81, 73, 0.15)",
          border: "1px solid #f85149",
          borderRadius: 6,
          padding: "8px 20px",
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 13,
          fontWeight: 700,
          color: "#f85149",
          letterSpacing: 1.5,
          textTransform: "uppercase",
          backdropFilter: "blur(4px)",
          pointerEvents: "none",
          animation: "breach-pulse 1s ease-in-out infinite",
        }}>
          {"\u26a0"} BASE COMPROMISED {"\u2014"} HOSTILE INSIDE WIRE
        </div>
      )}

      {/* Selection disambiguation list */}
      {selectionList && (
        <SelectionList
          items={selectionList.items}
          screenX={selectionList.screenX}
          screenY={selectionList.screenY}
          isRightClick={selectionList.isRightClick}
          onSelectTrack={(trackId) => {
            onSelectTrack(trackId);
          }}
          onRightClickTrack={(trackId, sx, sy) => {
            onSelectTrack(trackId);
            setWheelState({ trackId, screenX: sx, screenY: sy });
          }}
          onRightClickDevice={(deviceId, deviceType, sx, sy) => {
            setDeviceWheelState({ deviceId, deviceType, screenX: sx, screenY: sy });
          }}
          onClose={() => setSelectionList(null)}
        />
      )}
    </div>
  );
}
