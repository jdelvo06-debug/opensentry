import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Circle,
  Polyline,
  Marker,
  useMap,
  ScaleControl,
  LayersControl,
} from "react-leaflet";
import L from "leaflet";
import type { Affiliation, EffectorStatus, EngagementZones, SensorStatus, TrackData } from "../types";
import { gameXYToLatLng } from "../utils/coordinates";
import RadialActionWheel from "./RadialActionWheel";

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
}

interface WheelState {
  trackId: string;
  screenX: number;
  screenY: number;
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
    </div>` : `
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
}: Props) {
  const baseCenter: [number, number] = [baseLat, baseLng];
  const [wheelState, setWheelState] = useState<WheelState | null>(null);

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

        {/* Base marker with pulsing circle */}
        <PulsingBaseCircle center={baseCenter} />
        <Marker
          position={baseCenter}
          icon={baseIcon}
          interactive={false}
        />

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

      {/* Radial action wheel */}
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
    </div>
  );
}
