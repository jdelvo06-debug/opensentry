import { useCallback, useEffect, useState } from "react";
import type { EffectorStatus, SensorStatus } from "../types";

interface WheelAction {
  id: string;
  label: string;
  icon: string;
  color: string;
  disabled?: boolean;
  statusText?: string;
}

interface Props {
  device: SensorStatus | EffectorStatus;
  deviceType: "sensor" | "effector";
  screenX: number;
  screenY: number;
  onToggleRangeRing?: (deviceId: string) => void;
  onSlewTo?: (deviceId: string) => void;
  onEngageNearest?: (effectorId: string) => void;
  onJammerToggle?: (effectorId: string) => void;
  onClose: () => void;
}

const WHEEL_RADIUS = 90;
const INNER_RADIUS = 32;
const CENTER = WHEEL_RADIUS;

function polarToXY(angleDeg: number, r: number): [number, number] {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return [CENTER + r * Math.cos(rad), CENTER + r * Math.sin(rad)];
}

function arcPath(startAngle: number, endAngle: number, outerR: number, innerR: number): string {
  const [sx1, sy1] = polarToXY(startAngle, outerR);
  const [ex1, ey1] = polarToXY(endAngle, outerR);
  const [sx2, sy2] = polarToXY(endAngle, innerR);
  const [ex2, ey2] = polarToXY(startAngle, innerR);
  const large = endAngle - startAngle > 180 ? 1 : 0;
  return [
    `M ${sx1} ${sy1}`,
    `A ${outerR} ${outerR} 0 ${large} 1 ${ex1} ${ey1}`,
    `L ${sx2} ${sy2}`,
    `A ${innerR} ${innerR} 0 ${large} 0 ${ex2} ${ey2}`,
    "Z",
  ].join(" ");
}

function getSensorActions(sensor: SensorStatus): WheelAction[] {
  const isCamera = sensor.type === "eoir" ||
    (sensor.name || "").toLowerCase().includes("camera") ||
    (sensor.name || "").toLowerCase().includes("eo");

  return [
    {
      id: "status",
      label: "STATUS",
      icon: sensor.status === "active" ? "\u25CF" : "\u25CB",
      color: sensor.status === "active" ? "#3fb950" : "#f85149",
      statusText: sensor.status.toUpperCase(),
      disabled: true,
    },
    ...(isCamera ? [{
      id: "slew_to",
      label: "SLEW TO",
      icon: "\u25CE",
      color: "#d29922",
    }] : []),
    {
      id: "power_cycle",
      label: "PWR CYCLE",
      icon: "\u23FB",
      color: "#484f58",
      disabled: true,
      statusText: "N/A",
    },
    {
      id: "range_ring",
      label: "RANGE RING",
      icon: "\u25EF",
      color: "#58a6ff",
    },
    {
      id: "info",
      label: "INFO",
      icon: "\u2139",
      color: "#8b949e",
      disabled: true,
      statusText: `${sensor.name || sensor.id}`,
    },
  ];
}

function getEffectorActions(effector: EffectorStatus): WheelAction[] {
  const isReady = effector.status === "ready";
  const hasJackalAmmo = effector.ammo_remaining != null;
  const isJammer = effector.type === "rf_jam" || effector.type === "electronic";
  const jammerActive = effector.jammer_active === true;

  return [
    {
      id: "status",
      label: "STATUS",
      icon: isReady ? "\u25CF" : "\u25CB",
      color: isReady ? "#3fb950" : effector.status === "recharging" ? "#d29922" : "#f85149",
      statusText: effector.status.toUpperCase(),
      disabled: true,
    },
    ...(hasJackalAmmo ? [{
      id: "ammo",
      label: "AMMO",
      icon: "\u2022\u2022\u2022",
      color: (effector.ammo_remaining ?? 0) > 0 ? "#3fb950" : "#f85149",
      statusText: `${effector.ammo_remaining}/${effector.ammo_count}`,
      disabled: true,
    }] : []),
    ...(isJammer ? [{
      id: "jammer_toggle",
      label: jammerActive ? "DEACTIVATE" : "ACTIVATE",
      icon: jammerActive ? "\u23F9" : "\u25B6",
      color: jammerActive ? "#f85149" : "#3fb950",
      statusText: jammerActive ? "JAM ACTIVE" : "JAM OFF",
    }] : []),
    {
      id: "engage_nearest",
      label: "ENG NEAR",
      icon: "\u{1F3AF}",
      color: isReady ? "#f85149" : "#484f58",
      disabled: !isReady,
    },
    {
      id: "power_cycle",
      label: "PWR CYCLE",
      icon: "\u23FB",
      color: "#484f58",
      disabled: true,
      statusText: "N/A",
    },
    {
      id: "info",
      label: "INFO",
      icon: "\u2139",
      color: "#8b949e",
      disabled: true,
      statusText: `${effector.name || effector.id}`,
    },
  ];
}

export default function DeviceWheel({
  device,
  deviceType,
  screenX,
  screenY,
  onToggleRangeRing,
  onSlewTo,
  onEngageNearest,
  onJammerToggle,
  onClose,
}: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [opacity, setOpacity] = useState(0);

  useEffect(() => {
    requestAnimationFrame(() => setOpacity(1));
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const actions = deviceType === "sensor"
    ? getSensorActions(device as SensorStatus)
    : getEffectorActions(device as EffectorStatus);

  const handleSelect = useCallback(
    (actionId: string) => {
      switch (actionId) {
        case "range_ring":
          onToggleRangeRing?.(device.id);
          onClose();
          break;
        case "slew_to":
          onSlewTo?.(device.id);
          onClose();
          break;
        case "engage_nearest":
          onEngageNearest?.(device.id);
          onClose();
          break;
        case "jammer_toggle":
          onJammerToggle?.(device.id);
          onClose();
          break;
        default:
          break;
      }
    },
    [device.id, onToggleRangeRing, onSlewTo, onEngageNearest, onJammerToggle, onClose],
  );

  const size = WHEEL_RADIUS * 2;
  const x = Math.max(WHEEL_RADIUS, Math.min(window.innerWidth - WHEEL_RADIUS, screenX));
  const y = Math.max(WHEEL_RADIUS, Math.min(window.innerHeight - WHEEL_RADIUS, screenY));

  const n = actions.length;
  const sliceAngle = 360 / n;

  const deviceColor = deviceType === "sensor" ? "#58a6ff" : "#f0883e";
  const deviceLabel = (device.name || device.id).toUpperCase().slice(0, 12);

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        cursor: "default",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          left: x - WHEEL_RADIUS,
          top: y - WHEEL_RADIUS,
          width: size,
          height: size,
          opacity,
          transition: "opacity 100ms ease-out",
          pointerEvents: "auto",
        }}
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <filter id="device-wheel-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="6" floodColor="#000" floodOpacity="0.5" />
            </filter>
          </defs>

          <circle
            cx={CENTER}
            cy={CENTER}
            r={WHEEL_RADIUS - 1}
            fill="none"
            stroke="#30363d"
            strokeWidth={1}
            filter="url(#device-wheel-shadow)"
          />

          <circle cx={CENTER} cy={CENTER} r={INNER_RADIUS} fill="rgba(13, 17, 23, 0.95)" stroke="#30363d" strokeWidth={1} />

          {actions.map((action, i) => {
            const startAngle = i * sliceAngle;
            const endAngle = startAngle + sliceAngle;
            const midAngle = startAngle + sliceAngle / 2;
            const isHovered = hoveredId === action.id;
            const labelR = (WHEEL_RADIUS + INNER_RADIUS) / 2;
            const [lx, ly] = polarToXY(midAngle, labelR);
            const iconR = labelR - 8;
            const [ix, iy] = polarToXY(midAngle, iconR);

            return (
              <g
                key={action.id}
                style={{ cursor: action.disabled ? "default" : "pointer" }}
                onMouseEnter={() => !action.disabled && setHoveredId(action.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!action.disabled) handleSelect(action.id);
                }}
              >
                <path
                  d={arcPath(startAngle, endAngle, WHEEL_RADIUS - 2, INNER_RADIUS)}
                  fill={isHovered ? `${action.color}30` : "rgba(22, 27, 34, 0.92)"}
                  stroke={isHovered ? action.color : "#30363d"}
                  strokeWidth={isHovered ? 1.5 : 1}
                />
                <text
                  x={ix}
                  y={iy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  style={{
                    fontSize: 13,
                    fill: action.disabled ? "#484f58" : action.color,
                    pointerEvents: "none",
                    userSelect: "none",
                  }}
                >
                  {action.icon}
                </text>
                <text
                  x={lx}
                  y={ly + 9}
                  textAnchor="middle"
                  dominantBaseline="central"
                  style={{
                    fontSize: 7,
                    fontWeight: 600,
                    fontFamily: "'JetBrains Mono', monospace",
                    fill: action.disabled ? "#484f5899" : isHovered ? "#e6edf3" : "#8b949e",
                    letterSpacing: 0.5,
                    pointerEvents: "none",
                    userSelect: "none",
                  }}
                >
                  {action.label}
                </text>
                {action.statusText && (
                  <text
                    x={lx}
                    y={ly + 18}
                    textAnchor="middle"
                    dominantBaseline="central"
                    style={{
                      fontSize: 6,
                      fontFamily: "'JetBrains Mono', monospace",
                      fill: "#484f58",
                      pointerEvents: "none",
                      userSelect: "none",
                    }}
                  >
                    {action.statusText}
                  </text>
                )}
              </g>
            );
          })}

          {/* Center: device icon + type */}
          <circle cx={CENTER} cy={CENTER} r={3} fill={deviceColor} opacity={0.6} />
          <text
            x={CENTER}
            y={CENTER + 12}
            textAnchor="middle"
            dominantBaseline="central"
            style={{
              fontSize: 6,
              fontWeight: 600,
              fontFamily: "'JetBrains Mono', monospace",
              fill: deviceColor,
              letterSpacing: 0.5,
              pointerEvents: "none",
              userSelect: "none",
            }}
          >
            {deviceLabel}
          </text>
          <text
            x={CENTER}
            y={CENTER + 20}
            textAnchor="middle"
            dominantBaseline="central"
            style={{
              fontSize: 5,
              fontWeight: 600,
              fontFamily: "'JetBrains Mono', monospace",
              fill: "#484f58",
              letterSpacing: 0.5,
              pointerEvents: "none",
              userSelect: "none",
            }}
          >
            {deviceType.toUpperCase()}
          </text>
        </svg>
      </div>
    </div>
  );
}
