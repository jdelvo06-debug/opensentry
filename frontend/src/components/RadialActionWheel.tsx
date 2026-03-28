import { useCallback, useEffect, useRef, useState } from "react";
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
  onEngage: (trackId: string, effectorId: string, shenobiCm?: string) => void;
  onSlewCamera: (trackId: string) => void;
  onHoldFire?: (trackId: string) => void;
  onReleaseHoldFire?: (trackId: string) => void;
  onCallATC?: (trackId: string) => void;
  iffStatus?: string;
  atcCalled?: boolean;
  classification?: string;
  onClose: () => void;
}

const CLASSIFICATIONS = [
  { value: "commercial_quad", label: "COMM QUAD", icon: "\u2B1A", affiliation: "hostile", color: "#f85149" },
  { value: "fixed_wing", label: "FIXED WING", icon: "\u2708", affiliation: "hostile", color: "#f85149" },
  { value: "micro", label: "MICRO UAS", icon: "\u25C7", affiliation: "hostile", color: "#f85149" },
  { value: "improvised", label: "IMPROVISED", icon: "\u26A0", affiliation: "hostile", color: "#f85149" },
  { value: "shahed", label: "SHAHED", icon: "\u2622", affiliation: "hostile", color: "#f85149" },
  { value: "passenger_aircraft", label: "AIRLINER", icon: "\u2708", affiliation: "friendly", color: "#58a6ff" },
  { value: "military_jet", label: "MIL JET", icon: "\u2708", affiliation: "friendly", color: "#58a6ff" },
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
  shenobi_pm: "#a371f7",  // Purple for Shenobi
};

const Shenobi_CM_OPTIONS = [
  { id: "shenobi_hold", label: "HOLD", icon: "\u23F8", color: "#a371f7", desc: "Freeze in place" },
  { id: "shenobi_land_now", label: "LAND NOW", icon: "\u2B07", color: "#f0883e", desc: "Force descent" },
  { id: "shenobi_deafen", label: "DEAFEN", icon: "\u{1F507}", color: "#f85149", desc: "Sever link" },
];

// Phase accent colors for center hub ring
const PHASE_COLORS: Record<DTIDPhase, string> = {
  detected: "#58a6ff",   // blue
  tracked: "#f0883e",    // orange
  identified: "#f85149", // red (overridden to green for friendly/neutral)
  defeated: "#3fb950",   // green
};

type SubMenu = "none" | "identify" | "engage" | "shenobi_cm";

function getActionsForPhase(dtidPhase: DTIDPhase, holdFire?: boolean, iffStatus?: string, atcCalled?: boolean, classification?: string): WheelAction[] {
  switch (dtidPhase) {
    case "detected": {
      const actions: WheelAction[] = [
        { id: "confirm_track", label: "CONFIRM", icon: "\u2714", color: "#58a6ff" },
        { id: "slew_camera", label: "SLEW CAM", icon: "\u25CE", color: "#d29922" },
      ];
      if (iffStatus === "unknown" && classification !== "bird" && classification !== "weather_balloon") {
        actions.push({
          id: "call_atc",
          label: atcCalled ? "ATC CALLED" : "CALL ATC",
          icon: "\u{1F4DE}",
          color: atcCalled ? "#484f58" : "#22d3ee",
          disabled: atcCalled,
        });
      } else {
        actions.push({ id: "monitor", label: "MONITOR", icon: "\u25C9", color: "#484f58", disabled: true });
      }
      actions.push({ id: "dismiss", label: "DISMISS", icon: "\u2715", color: "#484f58", disabled: true });
      return actions;
    }
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

function linePath(angleDeg: number, innerR: number, outerR: number): string {
  const [x1, y1] = polarToXY(angleDeg, innerR);
  const [x2, y2] = polarToXY(angleDeg, outerR);
  return `M ${x1} ${y1} L ${x2} ${y2}`;
}

function WheelSegments({
  actions,
  onSelect,
  hoveredId,
  pressedId,
  onHover,
  onPress,
}: {
  actions: WheelAction[];
  onSelect: (id: string) => void;
  hoveredId: string | null;
  pressedId: string | null;
  onHover: (id: string | null) => void;
  onPress: (id: string | null) => void;
}) {
  const n = actions.length;
  const sliceAngle = 360 / n;

  return (
    <>
      {/* Radial gradient for slice backgrounds */}
      {actions.map((action, i) => {
        const startAngle = i * sliceAngle;
        const endAngle = startAngle + sliceAngle;
        const midAngle = startAngle + sliceAngle / 2;
        const isHovered = hoveredId === action.id;
        const isPressed = pressedId === action.id;
        const iconR = (WHEEL_RADIUS + INNER_RADIUS) / 2 - 6;
        const labelR = (WHEEL_RADIUS + INNER_RADIUS) / 2 + 8;
        const [ix, iy] = polarToXY(midAngle, iconR);
        const [lx, ly] = polarToXY(midAngle, labelR);

        const sliceFill = action.disabled
          ? "rgba(22, 27, 34, 0.7)"
          : isHovered
            ? `${action.color}30`
            : "rgba(22, 27, 34, 0.92)";

        const sliceStroke = isHovered && !action.disabled ? action.color : "#30363d";
        const sliceStrokeWidth = isHovered && !action.disabled ? 1.5 : 0.5;
        const scaleTransform = isPressed && !action.disabled
          ? `translate(${CENTER}, ${CENTER}) scale(0.95) translate(${-CENTER}, ${-CENTER})`
          : undefined;

        return (
          <g
            key={action.id}
            style={{ cursor: action.disabled ? "default" : "pointer" }}
            transform={scaleTransform}
            onMouseEnter={() => !action.disabled && onHover(action.id)}
            onMouseLeave={() => { onHover(null); onPress(null); }}
            onMouseDown={() => !action.disabled && onPress(action.id)}
            onMouseUp={() => onPress(null)}
            onClick={(e) => {
              e.stopPropagation();
              if (!action.disabled) onSelect(action.id);
            }}
          >
            {/* Slice background */}
            <path
              d={arcPath(startAngle, endAngle, WHEEL_RADIUS - 2, INNER_RADIUS)}
              fill={sliceFill}
              stroke={sliceStroke}
              strokeWidth={sliceStrokeWidth}
              filter={isHovered && !action.disabled ? "url(#hover-glow)" : undefined}
            />

            {/* Disabled strikethrough overlay */}
            {action.disabled && (
              <line
                x1={ix - 8}
                y1={iy + 2}
                x2={ix + 8}
                y2={iy - 2}
                stroke="#484f58"
                strokeWidth={1}
                opacity={0.5}
                style={{ pointerEvents: "none" }}
              />
            )}

            {/* Icon — slightly larger */}
            <text
              x={ix}
              y={iy}
              textAnchor="middle"
              dominantBaseline="central"
              style={{
                fontSize: 16,
                fill: action.disabled ? "#484f5880" : action.color,
                opacity: action.disabled ? 0.3 : 1,
                pointerEvents: "none",
                userSelect: "none",
              }}
            >
              {action.icon}
            </text>

            {/* Label — smaller, below icon */}
            <text
              x={lx}
              y={ly}
              textAnchor="middle"
              dominantBaseline="central"
              style={{
                fontSize: 7,
                fontWeight: 600,
                fontFamily: "'JetBrains Mono', monospace",
                fill: action.disabled ? "#484f5860" : isHovered ? "#e6edf3" : "#8b949e",
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
                y={ly + 9}
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

      {/* Separator lines between slices */}
      {n > 1 && actions.map((_, i) => {
        const angle = i * sliceAngle;
        return (
          <path
            key={`sep-${i}`}
            d={linePath(angle, INNER_RADIUS, WHEEL_RADIUS - 2)}
            stroke="#1b1f27"
            strokeWidth={1}
            style={{ pointerEvents: "none" }}
          />
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
  onCallATC,
  iffStatus,
  atcCalled,
  classification,
  onClose,
}: Props) {
  const [subMenu, setSubMenu] = useState<SubMenu>("none");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pressedId, setPressedId] = useState<string | null>(null);
  const [animState, setAnimState] = useState<"entering" | "visible" | "exiting">("entering");
  const [selectedNexusEffector, setSelectedNexusEffector] = useState<string | null>(null);
  const closingRef = useRef(false);

  // Animate open: entering → visible
  useEffect(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setAnimState("visible"));
    });
  }, []);

  // Animated close helper
  const animatedClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setAnimState("exiting");
    setTimeout(() => onClose(), 100);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (subMenu !== "none") {
          setSubMenu("none");
        } else {
          animatedClose();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [animatedClose, subMenu]);

  const handleSelect = useCallback(
    (actionId: string) => {
      switch (actionId) {
        case "confirm_track":
          onConfirmTrack(trackId);
          animatedClose();
          break;
        case "slew_camera":
          onSlewCamera(trackId);
          animatedClose();
          break;
        case "identify":
          setSubMenu("identify");
          break;
        case "engage":
          setSubMenu("engage");
          break;
        case "hold_fire":
          onHoldFire?.(trackId);
          animatedClose();
          break;
        case "release_hold_fire":
          onReleaseHoldFire?.(trackId);
          animatedClose();
          break;
        case "call_atc":
          onCallATC?.(trackId);
          animatedClose();
          break;
        default:
          break;
      }
    },
    [trackId, onConfirmTrack, onSlewCamera, onHoldFire, onReleaseHoldFire, onCallATC, animatedClose],
  );

  const handleClassify = useCallback(
    (cls: (typeof CLASSIFICATIONS)[number]) => {
      onIdentify(trackId, cls.value, cls.affiliation);
      animatedClose();
    },
    [trackId, onIdentify, animatedClose],
  );

  const handleEngage = useCallback(
    (effectorId: string) => {
      // Check if this is a Shenobi effector — show CM submenu
      const eff = effectors.find((e) => e.id === effectorId);
      if (eff && eff.type === "shenobi_pm") {
        setSelectedNexusEffector(effectorId);
        setSubMenu("shenobi_cm");
        return;
      }
      onEngage(trackId, effectorId);
      animatedClose();
    },
    [trackId, effectors, onEngage, animatedClose],
  );

  const handleNexusCM = useCallback(
    (cmType: string) => {
      if (selectedNexusEffector) {
        onEngage(trackId, selectedNexusEffector, cmType);
      }
      animatedClose();
    },
    [trackId, selectedNexusEffector, onEngage, animatedClose],
  );

  const actions = getActionsForPhase(dtidPhase, holdFire, iffStatus, atcCalled, classification);

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
      const isShenobi = eff.type === "shenobi_pm";
      return {
        id: eff.id,
        label: (eff.name || eff.id).toUpperCase().slice(0, 10),
        icon: isShenobi ? "\u{1F977}" : isReady ? "\u25C6" : "\u25C7",
        color: isReady ? color : "#484f58",
        disabled: !isReady,
        statusText: eff.status.toUpperCase(),
      };
    });
  } else if (subMenu === "shenobi_cm") {
    subActions = Shenobi_CM_OPTIONS.map((cm) => ({
      id: cm.id,
      label: cm.label,
      icon: cm.icon,
      color: cm.color,
      statusText: cm.desc,
    }));
  }

  const handleSubSelect = (id: string) => {
    if (subMenu === "identify") {
      const cls = CLASSIFICATIONS.find((c) => c.value === id);
      if (cls) handleClassify(cls);
    } else if (subMenu === "engage") {
      handleEngage(id);
    } else if (subMenu === "shenobi_cm") {
      handleNexusCM(id);
    }
  };

  // Phase accent color
  const phaseColor = PHASE_COLORS[dtidPhase];

  // Animation CSS values
  const isVisible = animState === "visible";
  const isExiting = animState === "exiting";
  const scale = isVisible ? 1 : isExiting ? 0.85 : 0.6;
  const opacity = isVisible ? 1 : 0;

  return (
    <div
      onClick={(e) => {
        // Only close if clicking the backdrop itself, not children
        if (e.target === e.currentTarget) {
          if (subMenu !== "none") {
            setSubMenu("none");
          } else {
            animatedClose();
          }
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        animatedClose();
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
          transform: `scale(${scale})`,
          transition: isExiting
            ? "opacity 100ms ease-in, transform 100ms ease-in"
            : "opacity 150ms ease-out, transform 150ms cubic-bezier(0.34, 1.56, 0.64, 1)",
          transformOrigin: "center center",
          pointerEvents: "auto",
        }}
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Filters */}
          <defs>
            <filter id="wheel-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="6" floodColor="#000" floodOpacity="0.5" />
            </filter>
            <filter id="hover-glow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="phase-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="3" />
            </filter>
            {/* Radial gradient for slice fill — darker at center, lighter at edge */}
            <radialGradient id="slice-grad" cx="50%" cy="50%" r="50%">
              <stop offset="30%" stopColor="rgba(22, 27, 34, 0.95)" />
              <stop offset="100%" stopColor="rgba(33, 38, 45, 0.92)" />
            </radialGradient>
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

          {/* Phase accent glow ring (behind inner circle) */}
          <circle
            cx={CENTER}
            cy={CENTER}
            r={INNER_RADIUS + 1}
            fill="none"
            stroke={phaseColor}
            strokeWidth={2}
            opacity={0.4}
            filter="url(#phase-glow)"
          />

          {/* Phase accent ring */}
          <circle
            cx={CENTER}
            cy={CENTER}
            r={INNER_RADIUS}
            fill="rgba(13, 17, 23, 0.95)"
            stroke={phaseColor}
            strokeWidth={1.5}
            opacity={0.9}
          />

          {subMenu === "none" ? (
            <WheelSegments
              actions={actions}
              onSelect={handleSelect}
              hoveredId={hoveredId}
              pressedId={pressedId}
              onHover={setHoveredId}
              onPress={setPressedId}
            />
          ) : (
            <>
              <WheelSegments
                actions={subActions}
                onSelect={handleSubSelect}
                hoveredId={hoveredId}
                pressedId={pressedId}
                onHover={setHoveredId}
                onPress={setPressedId}
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

          {/* Center hub: track ID + phase label */}
          {subMenu === "none" && (
            <>
              {/* Track ID callsign */}
              <text
                x={CENTER}
                y={CENTER - 6}
                textAnchor="middle"
                dominantBaseline="central"
                style={{
                  fontSize: 8,
                  fontWeight: 700,
                  fontFamily: "'JetBrains Mono', monospace",
                  fill: phaseColor,
                  letterSpacing: 0.5,
                  pointerEvents: "none",
                  userSelect: "none",
                }}
              >
                {trackId.length > 9 ? trackId.slice(0, 9) : trackId}
              </text>

              {/* Phase label */}
              <text
                x={CENTER}
                y={CENTER + 8}
                textAnchor="middle"
                dominantBaseline="central"
                style={{
                  fontSize: 6,
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
            </>
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
              {subMenu === "identify" ? "CLASSIFY" : subMenu === "shenobi_cm" ? "Shenobi CM" : "SELECT EFFECTOR"}
            </text>
          )}
        </svg>
      </div>
    </div>
  );
}
