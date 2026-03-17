import { useCallback, useEffect, useState } from "react";
import type { DTIDPhase, EffectorStatus } from "../types";

interface WheelAction {
  id: string;
  label: string;
  icon: string;
  color: string;
  disabled?: boolean;
  statusText?: string;
}

interface Props {
  trackId: string;
  dtidPhase: DTIDPhase;
  screenX: number;
  screenY: number;
  effectors: EffectorStatus[];
  holdFire?: boolean;
  onConfirmTrack: (trackId: string) => void;
  onIdentify: (trackId: string, classification: string, affiliation: string) => void;
  onEngage: (trackId: string, effectorId: string) => void;
  onSlewCamera: (trackId: string) => void;
  onHoldFire?: (trackId: string) => void;
  onReleaseHoldFire?: (trackId: string) => void;
  onClose: () => void;
}

const CLASSIFICATIONS = [
  { value: "commercial_quad", label: "COMM QUAD", icon: "\u2B1A", affiliation: "hostile", color: "#f85149" },
  { value: "fixed_wing", label: "FIXED WING", icon: "\u2708", affiliation: "hostile", color: "#f85149" },
  { value: "micro", label: "MICRO UAS", icon: "\u25C7", affiliation: "hostile", color: "#f85149" },
  { value: "improvised", label: "IMPROVISED", icon: "\u26A0", affiliation: "hostile", color: "#f85149" },
  { value: "bird", label: "BIRD", icon: "\u{1F426}", affiliation: "neutral", color: "#3fb950" },
  { value: "weather_balloon", label: "BALLOON", icon: "\u25CB", affiliation: "neutral", color: "#3fb950" },
];

const EFFECTOR_COLORS: Record<string, string> = {
  jammer: "#58a6ff",
  rf_jam: "#58a6ff",
  kinetic: "#f85149",
  interceptor: "#3fb950",
  net_interceptor: "#3fb950",
  de_weapon: "#bc8cff",
  directed_energy: "#bc8cff",
};

type SubMenu = "none" | "identify" | "engage";

function getActionsForPhase(dtidPhase: DTIDPhase, holdFire?: boolean): WheelAction[] {
  switch (dtidPhase) {
    case "detected":
      return [
        { id: "confirm_track", label: "CONFIRM", icon: "\u2714", color: "#58a6ff" },
        { id: "slew_camera", label: "SLEW CAM", icon: "\u25CE", color: "#d29922" },
        { id: "monitor", label: "MONITOR", icon: "\u25C9", color: "#484f58", disabled: true },
        { id: "dismiss", label: "DISMISS", icon: "\u2715", color: "#484f58", disabled: true },
      ];
    case "tracked":
      return [
        { id: "slew_camera", label: "SLEW CAM", icon: "\u25CE", color: "#d29922" },
        { id: "identify", label: "IDENTIFY", icon: "\u{1F50D}", color: "#f0883e" },
        { id: "track_history", label: "HISTORY", icon: "\u2630", color: "#484f58", disabled: true },
        { id: "monitor", label: "MONITOR", icon: "\u25C9", color: "#484f58", disabled: true },
      ];
    case "identified":
      return [
        { id: "engage", label: "ENGAGE", icon: "\u{1F3AF}", color: holdFire ? "#484f58" : "#f85149", disabled: holdFire },
        { id: "slew_camera", label: "SLEW CAM", icon: "\u25CE", color: "#d29922" },
        holdFire
          ? { id: "release_hold_fire", label: "RLS HOLD", icon: "\u25B6", color: "#3fb950" }
          : { id: "hold_fire", label: "HOLD FIRE", icon: "\u270B", color: "#d29922" },
        { id: "re_identify", label: "RE-ID", icon: "\u21BA", color: "#484f58", disabled: true },
      ];
    case "defeated":
      return [
        { id: "monitor", label: "COMPLETE", icon: "\u2714", color: "#3fb950", disabled: true },
      ];
  }
}

const WHEEL_RADIUS = 100;
const INNER_RADIUS = 36;
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

function WheelSegments({
  actions,
  onSelect,
  hoveredId,
  onHover,
}: {
  actions: WheelAction[];
  onSelect: (id: string) => void;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
}) {
  const n = actions.length;
  const sliceAngle = 360 / n;

  return (
    <>
      {actions.map((action, i) => {
        const startAngle = i * sliceAngle;
        const endAngle = startAngle + sliceAngle;
        const midAngle = startAngle + sliceAngle / 2;
        const isHovered = hoveredId === action.id;
        const labelR = (WHEEL_RADIUS + INNER_RADIUS) / 2;
        const [lx, ly] = polarToXY(midAngle, labelR);
        const iconR = labelR - 10;
        const [ix, iy] = polarToXY(midAngle, iconR);

        return (
          <g
            key={action.id}
            style={{ cursor: action.disabled ? "default" : "pointer" }}
            onMouseEnter={() => !action.disabled && onHover(action.id)}
            onMouseLeave={() => onHover(null)}
            onClick={(e) => {
              e.stopPropagation();
              if (!action.disabled) onSelect(action.id);
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
                fontSize: 14,
                fill: action.disabled ? "#484f58" : action.color,
                pointerEvents: "none",
                userSelect: "none",
              }}
            >
              {action.icon}
            </text>
            <text
              x={lx}
              y={ly + 10}
              textAnchor="middle"
              dominantBaseline="central"
              style={{
                fontSize: 8,
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
                y={ly + 20}
                textAnchor="middle"
                dominantBaseline="central"
                style={{
                  fontSize: 7,
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
    </>
  );
}

export default function RadialActionWheel({
  trackId,
  dtidPhase,
  screenX,
  screenY,
  effectors,
  holdFire,
  onConfirmTrack,
  onIdentify,
  onEngage,
  onSlewCamera,
  onHoldFire,
  onReleaseHoldFire,
  onClose,
}: Props) {
  const [subMenu, setSubMenu] = useState<SubMenu>("none");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [opacity, setOpacity] = useState(0);

  // Fade in
  useEffect(() => {
    requestAnimationFrame(() => setOpacity(1));
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (subMenu !== "none") {
          setSubMenu("none");
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, subMenu]);

  const handleSelect = useCallback(
    (actionId: string) => {
      switch (actionId) {
        case "confirm_track":
          onConfirmTrack(trackId);
          onClose();
          break;
        case "slew_camera":
          onSlewCamera(trackId);
          onClose();
          break;
        case "identify":
          setSubMenu("identify");
          break;
        case "engage":
          setSubMenu("engage");
          break;
        case "hold_fire":
          onHoldFire?.(trackId);
          onClose();
          break;
        case "release_hold_fire":
          onReleaseHoldFire?.(trackId);
          onClose();
          break;
        default:
          break;
      }
    },
    [trackId, onConfirmTrack, onSlewCamera, onHoldFire, onReleaseHoldFire, onClose],
  );

  const handleClassify = useCallback(
    (cls: (typeof CLASSIFICATIONS)[number]) => {
      onIdentify(trackId, cls.value, cls.affiliation);
      onClose();
    },
    [trackId, onIdentify, onClose],
  );

  const handleEngage = useCallback(
    (effectorId: string) => {
      onEngage(trackId, effectorId);
      onClose();
    },
    [trackId, onEngage, onClose],
  );

  const actions = getActionsForPhase(dtidPhase, holdFire);

  // Clamp position so wheel stays on screen
  const size = WHEEL_RADIUS * 2;
  const x = Math.max(WHEEL_RADIUS, Math.min(window.innerWidth - WHEEL_RADIUS, screenX));
  const y = Math.max(WHEEL_RADIUS, Math.min(window.innerHeight - WHEEL_RADIUS, screenY));

  // Build submenu items
  let subActions: WheelAction[] = [];
  if (subMenu === "identify") {
    subActions = CLASSIFICATIONS.map((cls) => ({
      id: cls.value,
      label: cls.label,
      icon: cls.icon,
      color: cls.color,
    }));
  } else if (subMenu === "engage") {
    subActions = effectors.map((eff) => {
      const color = EFFECTOR_COLORS[eff.id] || EFFECTOR_COLORS[eff.type || ""] || "#58a6ff";
      const isReady = eff.status === "ready";
      return {
        id: eff.id,
        label: (eff.name || eff.id).toUpperCase().slice(0, 10),
        icon: isReady ? "\u25C6" : "\u25C7",
        color: isReady ? color : "#484f58",
        disabled: !isReady,
        statusText: eff.status.toUpperCase(),
      };
    });
  }

  const handleSubSelect = (id: string) => {
    if (subMenu === "identify") {
      const cls = CLASSIFICATIONS.find((c) => c.value === id);
      if (cls) handleClassify(cls);
    } else if (subMenu === "engage") {
      handleEngage(id);
    }
  };

  return (
    <div
      onClick={(e) => {
        // Only close if clicking the backdrop itself, not children
        if (e.target === e.currentTarget) {
          if (subMenu !== "none") {
            setSubMenu("none");
          } else {
            onClose();
          }
        }
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
          {/* Drop shadow filter */}
          <defs>
            <filter id="wheel-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="6" floodColor="#000" floodOpacity="0.5" />
            </filter>
          </defs>

          {/* Background ring */}
          <circle
            cx={CENTER}
            cy={CENTER}
            r={WHEEL_RADIUS - 1}
            fill="none"
            stroke="#30363d"
            strokeWidth={1}
            filter="url(#wheel-shadow)"
          />

          {/* Inner dark circle */}
          <circle cx={CENTER} cy={CENTER} r={INNER_RADIUS} fill="rgba(13, 17, 23, 0.95)" stroke="#30363d" strokeWidth={1} />

          {subMenu === "none" ? (
            <WheelSegments
              actions={actions}
              onSelect={handleSelect}
              hoveredId={hoveredId}
              onHover={setHoveredId}
            />
          ) : (
            <>
              <WheelSegments
                actions={subActions}
                onSelect={handleSubSelect}
                hoveredId={hoveredId}
                onHover={setHoveredId}
              />
              {/* Back button in center */}
              <g
                style={{ cursor: "pointer" }}
                onClick={(e) => {
                  e.stopPropagation();
                  setSubMenu("none");
                }}
              >
                <circle cx={CENTER} cy={CENTER} r={INNER_RADIUS - 2} fill="rgba(13, 17, 23, 0.95)" />
                <text
                  x={CENTER}
                  y={CENTER - 4}
                  textAnchor="middle"
                  dominantBaseline="central"
                  style={{
                    fontSize: 14,
                    fill: "#8b949e",
                    pointerEvents: "none",
                    userSelect: "none",
                  }}
                >
                  {"\u2190"}
                </text>
                <text
                  x={CENTER}
                  y={CENTER + 10}
                  textAnchor="middle"
                  dominantBaseline="central"
                  style={{
                    fontSize: 7,
                    fontWeight: 600,
                    fontFamily: "'JetBrains Mono', monospace",
                    fill: "#484f58",
                    letterSpacing: 0.5,
                    pointerEvents: "none",
                    userSelect: "none",
                  }}
                >
                  BACK
                </text>
              </g>
            </>
          )}

          {/* Center dot */}
          {subMenu === "none" && (
            <circle cx={CENTER} cy={CENTER} r={3} fill="#58a6ff" opacity={0.6} />
          )}

          {/* Phase label in center */}
          {subMenu === "none" && (
            <text
              x={CENTER}
              y={CENTER + 14}
              textAnchor="middle"
              dominantBaseline="central"
              style={{
                fontSize: 7,
                fontWeight: 600,
                fontFamily: "'JetBrains Mono', monospace",
                fill: "#8b949e",
                letterSpacing: 1,
                pointerEvents: "none",
                userSelect: "none",
              }}
            >
              {dtidPhase.toUpperCase()}
            </text>
          )}

          {/* Submenu title in center */}
          {subMenu !== "none" && (
            <text
              x={CENTER}
              y={CENTER + 20}
              textAnchor="middle"
              dominantBaseline="central"
              style={{
                fontSize: 6,
                fontWeight: 600,
                fontFamily: "'JetBrains Mono', monospace",
                fill: "#484f58",
                letterSpacing: 0.5,
                pointerEvents: "none",
                userSelect: "none",
              }}
            >
              {subMenu === "identify" ? "CLASSIFY" : "SELECT EFFECTOR"}
            </text>
          )}
        </svg>
      </div>
    </div>
  );
}
