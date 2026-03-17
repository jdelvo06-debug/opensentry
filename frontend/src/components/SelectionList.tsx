import { useEffect, useRef, useState } from "react";
import type { EffectorStatus, SensorStatus, TrackData } from "../types";

interface SelectableItem {
  id: string;
  type: "track" | "sensor" | "effector";
  label: string;
  status: string;
  color: string;
  icon: string;
}

interface Props {
  items: SelectableItem[];
  screenX: number;
  screenY: number;
  isRightClick: boolean;
  onSelectTrack: (trackId: string) => void;
  onRightClickTrack: (trackId: string, screenX: number, screenY: number) => void;
  onRightClickDevice: (deviceId: string, deviceType: "sensor" | "effector", screenX: number, screenY: number) => void;
  onClose: () => void;
}

const AFFILIATION_COLORS: Record<string, string> = {
  unknown: "#d29922",
  hostile: "#f85149",
  friendly: "#58a6ff",
  neutral: "#3fb950",
};

export function findNearbySelectables(
  screenX: number,
  screenY: number,
  tracks: TrackData[],
  sensorConfigs: SensorStatus[],
  effectors: EffectorStatus[],
  trackPositionToScreen: (track: TrackData) => { x: number; y: number } | null,
  sensorPositionToScreen: (sensor: SensorStatus) => { x: number; y: number } | null,
  effectorPositionToScreen: (effector: EffectorStatus) => { x: number; y: number } | null,
  threshold: number = 30,
): SelectableItem[] {
  const items: SelectableItem[] = [];

  for (const track of tracks) {
    if (track.neutralized) continue;
    const pos = trackPositionToScreen(track);
    if (!pos) continue;
    const dx = pos.x - screenX;
    const dy = pos.y - screenY;
    if (Math.sqrt(dx * dx + dy * dy) <= threshold) {
      const phaseMap: Record<string, string> = {
        detected: "DETECTED",
        tracked: "TRACKED",
        identified: "IDENTIFIED",
        defeated: "DEFEATED",
      };
      items.push({
        id: track.id,
        type: "track",
        label: track.id.toUpperCase(),
        status: phaseMap[track.dtid_phase] || track.dtid_phase.toUpperCase(),
        color: AFFILIATION_COLORS[track.affiliation] || "#d29922",
        icon: track.affiliation === "hostile" ? "\u25C6" : track.affiliation === "friendly" ? "\u25A0" : "\u25A0",
      });
    }
  }

  for (const sensor of sensorConfigs) {
    if (sensor.x == null) continue;
    const pos = sensorPositionToScreen(sensor);
    if (!pos) continue;
    const dx = pos.x - screenX;
    const dy = pos.y - screenY;
    if (Math.sqrt(dx * dx + dy * dy) <= threshold) {
      items.push({
        id: sensor.id,
        type: "sensor",
        label: (sensor.name || sensor.id).toUpperCase(),
        status: sensor.status.toUpperCase(),
        color: "#58a6ff",
        icon: "\u25CE",
      });
    }
  }

  for (const eff of effectors) {
    if (eff.x == null) continue;
    const pos = effectorPositionToScreen(eff);
    if (!pos) continue;
    const dx = pos.x - screenX;
    const dy = pos.y - screenY;
    if (Math.sqrt(dx * dx + dy * dy) <= threshold) {
      items.push({
        id: eff.id,
        type: "effector",
        label: (eff.name || eff.id).toUpperCase(),
        status: eff.status.toUpperCase(),
        color: "#f0883e",
        icon: "\u2716",
      });
    }
  }

  return items;
}

export default function SelectionList({
  items,
  screenX,
  screenY,
  isRightClick,
  onSelectTrack,
  onRightClickTrack,
  onRightClickDevice,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Close on click outside or Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    // Delay the click listener to avoid the triggering click closing it immediately
    const timer = setTimeout(() => {
      window.addEventListener("mousedown", handleClick);
    }, 50);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("mousedown", handleClick);
      clearTimeout(timer);
    };
  }, [onClose]);

  const trackItems = items.filter((i) => i.type === "track");
  const deviceItems = items.filter((i) => i.type === "sensor" || i.type === "effector");

  // Clamp position so popup stays on screen
  const popupWidth = 200;
  const popupHeight = (trackItems.length + deviceItems.length) * 32 + (trackItems.length > 0 ? 24 : 0) + (deviceItems.length > 0 ? 24 : 0) + 16;
  const x = Math.min(screenX, window.innerWidth - popupWidth - 8);
  const y = Math.min(screenY, window.innerHeight - popupHeight - 8);

  const handleItemClick = (item: SelectableItem) => {
    if (isRightClick) {
      if (item.type === "track") {
        onRightClickTrack(item.id, screenX, screenY);
      } else {
        onRightClickDevice(item.id, item.type as "sensor" | "effector", screenX, screenY);
      }
    } else {
      if (item.type === "track") {
        onSelectTrack(item.id);
      }
      // Left-click on devices just closes (no track selection for devices)
    }
    onClose();
  };

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        left: x,
        top: y,
        zIndex: 2100,
        background: "rgba(22, 27, 34, 0.96)",
        border: "1px solid #30363d",
        borderRadius: 6,
        padding: "6px 0",
        minWidth: popupWidth,
        boxShadow: "0 4px 20px rgba(0,0,0,0.6)",
        fontFamily: "'JetBrains Mono', monospace",
      }}
    >
      {trackItems.length > 0 && (
        <>
          <div
            style={{
              fontSize: 8,
              fontWeight: 700,
              color: "#484f58",
              letterSpacing: 1.5,
              padding: "4px 12px 2px",
            }}
          >
            TRACKS
          </div>
          {trackItems.map((item) => (
            <div
              key={item.id}
              onMouseEnter={() => setHoveredId(item.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => handleItemClick(item)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "5px 12px",
                cursor: "pointer",
                background: hoveredId === item.id ? "rgba(88,166,255,0.1)" : "transparent",
                transition: "background 80ms",
              }}
            >
              <span style={{ color: item.color, fontSize: 12 }}>{item.icon}</span>
              <span style={{ color: "#e6edf3", fontSize: 11, fontWeight: 600, flex: 1 }}>
                {item.label}
              </span>
              <span style={{ color: item.color, fontSize: 9, fontWeight: 500 }}>
                {item.status}
              </span>
            </div>
          ))}
        </>
      )}
      {trackItems.length > 0 && deviceItems.length > 0 && (
        <div style={{ height: 1, background: "#30363d", margin: "4px 8px" }} />
      )}
      {deviceItems.length > 0 && (
        <>
          <div
            style={{
              fontSize: 8,
              fontWeight: 700,
              color: "#484f58",
              letterSpacing: 1.5,
              padding: "4px 12px 2px",
            }}
          >
            DEVICES
          </div>
          {deviceItems.map((item) => (
            <div
              key={item.id}
              onMouseEnter={() => setHoveredId(item.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => handleItemClick(item)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "5px 12px",
                cursor: "pointer",
                background: hoveredId === item.id ? "rgba(88,166,255,0.1)" : "transparent",
                transition: "background 80ms",
              }}
            >
              <span style={{ color: item.color, fontSize: 12 }}>{item.icon}</span>
              <span style={{ color: "#e6edf3", fontSize: 11, fontWeight: 600, flex: 1 }}>
                {item.label}
              </span>
              <span style={{ color: item.color, fontSize: 9, fontWeight: 500 }}>
                {item.status}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
