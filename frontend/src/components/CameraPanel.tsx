import { useRef, useEffect, useCallback, useState } from "react";
import type { TrackData, SensorStatus } from "../types";

interface Props {
  track: TrackData | null;
  allTracks: TrackData[];
  sensorConfigs: SensorStatus[];
  degraded?: boolean;
}

const CANVAS_W = 480;
const CANVAS_H = 300;
const HUD_COLOR_THERMAL = "#3fb950";
const HUD_COLOR_DAYLIGHT = "#58a6ff";

// Camera field of view in degrees
const FOV_H = 30;
const FOV_V = 20;

type CameraMode = "thermal" | "daylight";

function calcRange(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

function calcBearing(x: number, y: number): number {
  const rad = Math.atan2(x, -y);
  return ((rad * 180) / Math.PI + 360) % 360;
}

function calcElevation(altFt: number, rangeKm: number): number {
  if (rangeKm < 0.01) return 45;
  const altKm = altFt * 0.0003048;
  return Math.atan2(altKm, rangeKm) * (180 / Math.PI);
}

function noiseFactor(rangeKm: number): number {
  if (rangeKm < 0.3) return 0.05;
  if (rangeKm < 0.8) return 0.25;
  if (rangeKm < 1.5) return 0.55;
  return 0.8;
}

function silhouetteScale(rangeKm: number): number {
  if (rangeKm < 0.15) return 2.5;
  if (rangeKm < 0.3) return 2.0;
  if (rangeKm < 0.5) return 1.5;
  if (rangeKm < 0.8) return 1.0;
  if (rangeKm < 1.5) return 0.6;
  return 0.35;
}

function shakeAmplitude(rangeKm: number): number {
  if (rangeKm < 0.3) return 1;
  if (rangeKm < 0.8) return 3;
  if (rangeKm < 1.5) return 6;
  return 10;
}

/** Normalize angle difference to [-180, 180] */
function angleDiff(a: number, b: number): number {
  let d = ((a - b + 180) % 360) - 180;
  if (d < -180) d += 360;
  return d;
}

// ---------------------------------------------------------------------------
// Silhouette drawing helpers
// ---------------------------------------------------------------------------

function drawCommercialQuad(ctx: CanvasRenderingContext2D, s: number) {
  const armLen = 28 * s;
  const rotorR = 8 * s;
  const bodyW = 12 * s;
  const bodyH = 8 * s;

  ctx.fillRect(-bodyW / 2, -bodyH / 2, bodyW, bodyH);

  const angles = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
  for (const a of angles) {
    const ex = Math.cos(a) * armLen;
    const ey = Math.sin(a) * armLen;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ex, ey, rotorR, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawFixedWing(ctx: CanvasRenderingContext2D, s: number) {
  const fuseL = 40 * s;
  const fuseW = 6 * s;
  ctx.fillRect(-fuseL / 2, -fuseW / 2, fuseL, fuseW);

  ctx.beginPath();
  ctx.moveTo(-4 * s, 0);
  ctx.lineTo(-22 * s, -28 * s);
  ctx.lineTo(-16 * s, -28 * s);
  ctx.lineTo(4 * s, 0);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(-4 * s, 0);
  ctx.lineTo(-22 * s, 28 * s);
  ctx.lineTo(-16 * s, 28 * s);
  ctx.lineTo(4 * s, 0);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(-fuseL / 2, 0);
  ctx.lineTo(-fuseL / 2 - 6 * s, -10 * s);
  ctx.lineTo(-fuseL / 2 - 3 * s, -10 * s);
  ctx.lineTo(-fuseL / 2 + 2 * s, 0);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(-fuseL / 2, 0);
  ctx.lineTo(-fuseL / 2 - 6 * s, 10 * s);
  ctx.lineTo(-fuseL / 2 - 3 * s, 10 * s);
  ctx.lineTo(-fuseL / 2 + 2 * s, 0);
  ctx.closePath();
  ctx.fill();
}

function drawMicro(ctx: CanvasRenderingContext2D, s: number) {
  const armLen = 14 * s;
  const rotorR = 4 * s;
  const bodyR = 4 * s;

  ctx.beginPath();
  ctx.arc(0, 0, bodyR, 0, Math.PI * 2);
  ctx.fill();

  const angles = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
  for (const a of angles) {
    const ex = Math.cos(a) * armLen;
    const ey = Math.sin(a) * armLen;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ex, ey, rotorR, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawBird(ctx: CanvasRenderingContext2D, s: number) {
  ctx.beginPath();
  ctx.ellipse(0, 0, 18 * s, 8 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(20 * s, -2 * s, 5 * s, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(-4 * s, -6 * s);
  ctx.quadraticCurveTo(-12 * s, -34 * s, -28 * s, -18 * s);
  ctx.lineTo(-8 * s, -6 * s);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(-4 * s, 6 * s);
  ctx.quadraticCurveTo(-12 * s, 34 * s, -28 * s, 18 * s);
  ctx.lineTo(-8 * s, 6 * s);
  ctx.closePath();
  ctx.fill();
}

function drawBalloon(ctx: CanvasRenderingContext2D, s: number) {
  ctx.beginPath();
  ctx.ellipse(0, -14 * s, 20 * s, 26 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(0, 12 * s);
  ctx.lineTo(0, 36 * s);
  ctx.stroke();

  ctx.fillRect(-6 * s, 36 * s, 12 * s, 8 * s);
}

function drawImprovised(ctx: CanvasRenderingContext2D, s: number) {
  ctx.beginPath();
  const pts: [number, number][] = [
    [12 * s, -4 * s],
    [8 * s, -16 * s],
    [-6 * s, -14 * s],
    [-16 * s, -2 * s],
    [-10 * s, 12 * s],
    [6 * s, 14 * s],
  ];
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fill();

  ctx.fillRect(12 * s, -8 * s, 10 * s, 4 * s);
  ctx.fillRect(-16 * s, 4 * s, 8 * s, 3 * s);
  ctx.fillRect(-2 * s, 14 * s, 5 * s, 9 * s);
}

function drawUnknownBlob(ctx: CanvasRenderingContext2D, s: number) {
  ctx.beginPath();
  ctx.ellipse(0, 0, 16 * s, 12 * s, 0.3, 0, Math.PI * 2);
  ctx.fill();
}

function drawSilhouette(
  ctx: CanvasRenderingContext2D,
  classification: string | null,
  scale: number,
  mode: CameraMode,
) {
  if (mode === "thermal") {
    ctx.fillStyle = "rgba(230,230,230,0.9)";
    ctx.strokeStyle = "rgba(230,230,230,0.9)";
  } else {
    ctx.fillStyle = "rgba(40,50,60,0.85)";
    ctx.strokeStyle = "rgba(40,50,60,0.85)";
  }
  ctx.lineWidth = Math.max(1, 1.5 * scale);

  switch (classification) {
    case "commercial_quad":
      drawCommercialQuad(ctx, scale);
      break;
    case "fixed_wing":
      drawFixedWing(ctx, scale);
      break;
    case "micro":
      drawMicro(ctx, scale);
      break;
    case "bird":
      drawBird(ctx, scale);
      break;
    case "weather_balloon":
      drawBalloon(ctx, scale);
      break;
    case "improvised":
      drawImprovised(ctx, scale);
      break;
    default:
      drawUnknownBlob(ctx, scale);
      break;
  }
}

// ---------------------------------------------------------------------------
// Reticle
// ---------------------------------------------------------------------------

function drawReticle(ctx: CanvasRenderingContext2D, w: number, h: number, hudColor: string) {
  const cx = w / 2;
  const cy = h / 2;
  const gap = 14;
  const lineLen = 45;
  const tickSpacing = 12;
  const tickSize = 3;

  ctx.strokeStyle = hudColor + "88";
  ctx.lineWidth = 1;

  ctx.beginPath();
  ctx.moveTo(cx - lineLen, cy);
  ctx.lineTo(cx - gap, cy);
  ctx.moveTo(cx + gap, cy);
  ctx.lineTo(cx + lineLen, cy);
  ctx.moveTo(cx, cy - lineLen);
  ctx.lineTo(cx, cy - gap);
  ctx.moveTo(cx, cy + gap);
  ctx.lineTo(cx, cy + lineLen);
  ctx.stroke();

  for (let d = tickSpacing; d <= lineLen; d += tickSpacing) {
    ctx.beginPath();
    ctx.moveTo(cx - d, cy - tickSize);
    ctx.lineTo(cx - d, cy + tickSize);
    ctx.moveTo(cx + d, cy - tickSize);
    ctx.lineTo(cx + d, cy + tickSize);
    ctx.moveTo(cx - tickSize, cy - d);
    ctx.lineTo(cx + tickSize, cy - d);
    ctx.moveTo(cx - tickSize, cy + d);
    ctx.lineTo(cx + tickSize, cy + d);
    ctx.stroke();
  }

  const boxHalf = 60;
  const bracketLen = 15;

  const corners: [number, number, number, number][] = [
    [-1, -1, cx - boxHalf, cy - boxHalf],
    [1, -1, cx + boxHalf, cy - boxHalf],
    [-1, 1, cx - boxHalf, cy + boxHalf],
    [1, 1, cx + boxHalf, cy + boxHalf],
  ];

  ctx.lineWidth = 1.5;
  for (const [dx, dy, bx, by] of corners) {
    ctx.beginPath();
    ctx.moveTo(bx, by + dy * -bracketLen);
    ctx.lineTo(bx, by);
    ctx.lineTo(bx + dx * bracketLen, by);
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------

function drawNoise(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  density: number,
  mode: CameraMode,
) {
  const count = Math.floor(w * h * density * 0.003);
  ctx.fillStyle = mode === "thermal"
    ? "rgba(180,200,180,0.12)"
    : "rgba(100,100,120,0.1)";
  for (let i = 0; i < count; i++) {
    const px = Math.random() * w;
    const py = Math.random() * h;
    const sz = Math.random() < 0.3 ? 2 : 1;
    ctx.fillRect(px, py, sz, sz);
  }

  if (density > 0.2) {
    const lineCount = Math.floor(density * 8);
    ctx.strokeStyle = mode === "thermal"
      ? `rgba(160,200,160,${0.03 * density})`
      : `rgba(120,130,160,${0.03 * density})`;
    ctx.lineWidth = 1;
    for (let i = 0; i < lineCount; i++) {
      const ly = Math.random() * h;
      ctx.beginPath();
      ctx.moveTo(0, ly);
      ctx.lineTo(w, ly);
      ctx.stroke();
    }
  }
}

// ---------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------

function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number, mode: CameraMode) {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  if (mode === "thermal") {
    grad.addColorStop(0, "#0c0e10");
    grad.addColorStop(0.5, "#15191d");
    grad.addColorStop(1, "#1c2228");
  } else {
    grad.addColorStop(0, "#8ba4c0");
    grad.addColorStop(0.5, "#b0c4de");
    grad.addColorStop(1, "#c8d8e8");
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

// ---------------------------------------------------------------------------
// Scan lines for standby
// ---------------------------------------------------------------------------

function drawScanLines(ctx: CanvasRenderingContext2D, w: number, h: number, time: number) {
  ctx.strokeStyle = "rgba(60,70,80,0.15)";
  ctx.lineWidth = 1;
  const spacing = 4;
  for (let y = 0; y < h; y += spacing) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  // Moving scan bar
  const barY = (time * 40) % (h + 60) - 30;
  const grad = ctx.createLinearGradient(0, barY - 30, 0, barY + 30);
  grad.addColorStop(0, "rgba(63,185,80,0)");
  grad.addColorStop(0.5, "rgba(63,185,80,0.06)");
  grad.addColorStop(1, "rgba(63,185,80,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, barY - 30, w, 60);
}

// ---------------------------------------------------------------------------
// Acquiring animation
// ---------------------------------------------------------------------------

function drawAcquiring(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  progress: number,
  hudColor: string,
) {
  const cx = w / 2;
  const cy = h / 2;

  ctx.strokeStyle = hudColor;
  ctx.lineWidth = 2;
  const startAngle = progress * Math.PI * 4;
  ctx.beginPath();
  ctx.arc(cx, cy, 40, startAngle, startAngle + Math.PI * 0.8);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 40, startAngle + Math.PI, startAngle + Math.PI * 1.8);
  ctx.stroke();

  const alpha = 0.5 + 0.5 * Math.sin(progress * Math.PI * 6);
  ctx.fillStyle = hudColor;
  ctx.globalAlpha = alpha;
  ctx.font = "bold 12px monospace";
  ctx.textAlign = "center";
  ctx.fillText("ACQUIRING...", cx, cy + 65);
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Virtual Joystick Component
// ---------------------------------------------------------------------------

function VirtualJoystick({
  onMove,
  onRelease,
}: {
  onMove: (dx: number, dy: number) => void;
  onRelease: () => void;
}) {
  const baseRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const knobRef = useRef<HTMLDivElement>(null);

  const BASE_SIZE = 76;
  const KNOB_SIZE = 28;
  const MAX_OFFSET = (BASE_SIZE - KNOB_SIZE) / 2;

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current || !baseRef.current) return;
      e.preventDefault();
      const rect = baseRef.current.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > MAX_OFFSET) {
        dx = (dx / dist) * MAX_OFFSET;
        dy = (dy / dist) * MAX_OFFSET;
      }
      if (knobRef.current) {
        knobRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
      }
      // Normalize to -1..1
      onMove(dx / MAX_OFFSET, dy / MAX_OFFSET);
    },
    [onMove, MAX_OFFSET],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      draggingRef.current = false;
      if (knobRef.current) {
        knobRef.current.style.transform = "translate(0px, 0px)";
      }
      onRelease();
    },
    [onRelease],
  );

  return (
    <div
      ref={baseRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{
        width: BASE_SIZE,
        height: BASE_SIZE,
        borderRadius: "50%",
        background: "rgba(30,35,42,0.7)",
        border: "1px solid rgba(63,185,80,0.3)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "grab",
        touchAction: "none",
        userSelect: "none",
        position: "relative",
      }}
    >
      {/* Crosshair guides */}
      <div
        style={{
          position: "absolute",
          width: "60%",
          height: 1,
          background: "rgba(63,185,80,0.15)",
          top: "50%",
          left: "20%",
        }}
      />
      <div
        style={{
          position: "absolute",
          height: "60%",
          width: 1,
          background: "rgba(63,185,80,0.15)",
          left: "50%",
          top: "20%",
        }}
      />
      <div
        ref={knobRef}
        style={{
          width: KNOB_SIZE,
          height: KNOB_SIZE,
          borderRadius: "50%",
          background: "radial-gradient(circle at 40% 35%, rgba(63,185,80,0.5), rgba(63,185,80,0.2))",
          border: "1px solid rgba(63,185,80,0.6)",
          transition: draggingRef.current ? "none" : "transform 0.15s ease-out",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CameraPanel({
  track,
  allTracks,
  sensorConfigs,
  degraded = false,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const [mode, setMode] = useState<CameraMode>("thermal");
  const [acquiring, setAcquiring] = useState(false);
  const acquireStartRef = useRef(Date.now());
  const prevTrackIdRef = useRef<string | null>(null);

  // Camera bearing and elevation (absolute)
  const [cameraBearing, setCameraBearing] = useState(0);
  const [cameraElevation, setCameraElevation] = useState(15);
  // Joystick offset (applied on top of base bearing/elevation when slewed)
  const [bearingOffset, setBearingOffset] = useState(0);
  const [elevationOffset, setElevationOffset] = useState(0);
  // Whether joystick is actively being dragged (for continuous panning)
  const joystickActiveRef = useRef(false);
  const joystickDxRef = useRef(0);
  const joystickDyRef = useRef(0);

  // Reset acquiring animation when target changes
  useEffect(() => {
    if (track && track.id !== prevTrackIdRef.current) {
      setAcquiring(true);
      acquireStartRef.current = Date.now();
      setBearingOffset(0);
      setElevationOffset(0);
    }
    prevTrackIdRef.current = track?.id ?? null;
  }, [track]);

  // When slewed to a track, update base camera bearing/elevation to track position
  useEffect(() => {
    if (!track) return;
    const trackBearing = calcBearing(track.x, track.y);
    const trackRange = calcRange(track.x, track.y);
    const trackElev = calcElevation(track.altitude_ft, trackRange);
    setCameraBearing(trackBearing);
    setCameraElevation(trackElev);
  }, [track]);

  // Auto-finish acquiring after 1.5s
  useEffect(() => {
    if (!acquiring) return;
    const timer = setTimeout(() => setAcquiring(false), 1500);
    return () => clearTimeout(timer);
  }, [acquiring]);

  // Continuous pan while joystick is held
  useEffect(() => {
    let animFrame: number;
    const panSpeed = 2; // degrees per frame at full deflection

    const tick = () => {
      if (joystickActiveRef.current) {
        const dx = joystickDxRef.current;
        const dy = joystickDyRef.current;
        if (track) {
          // When slewed, adjust offset
          setBearingOffset((prev) => {
            const next = prev + dx * panSpeed;
            return Math.max(-90, Math.min(90, next));
          });
          setElevationOffset((prev) => {
            const next = prev - dy * panSpeed;
            return Math.max(-45, Math.min(45, next));
          });
        } else {
          // When not slewed, adjust absolute camera bearing/elevation
          setCameraBearing((prev) => (prev + dx * panSpeed + 360) % 360);
          setCameraElevation((prev) => {
            const next = prev - dy * panSpeed;
            return Math.max(-10, Math.min(80, next));
          });
        }
      }
      animFrame = requestAnimationFrame(tick);
    };
    animFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrame);
  }, [track]);

  const handleJoystickMove = useCallback((dx: number, dy: number) => {
    joystickActiveRef.current = true;
    joystickDxRef.current = dx;
    joystickDyRef.current = dy;
  }, []);

  const handleJoystickRelease = useCallback(() => {
    joystickActiveRef.current = false;
    joystickDxRef.current = 0;
    joystickDyRef.current = 0;
  }, []);

  const handleCenter = useCallback(() => {
    setBearingOffset(0);
    setElevationOffset(0);
  }, []);

  const hudColor = mode === "thermal" ? HUD_COLOR_THERMAL : HUD_COLOR_DAYLIGHT;

  // Effective camera direction
  const effectiveBearing = track
    ? (cameraBearing + bearingOffset + 360) % 360
    : cameraBearing;
  const effectiveElevation = track
    ? cameraElevation + elevationOffset
    : cameraElevation;

  // Find which track(s) are visible in the camera FOV
  const getVisibleTrack = useCallback((): { track: TrackData; pixelOffsetX: number; pixelOffsetY: number } | null => {
    const candidates = track ? [track] : allTracks.filter((t) => !t.neutralized);
    for (const t of candidates) {
      const tBearing = calcBearing(t.x, t.y);
      const tRange = calcRange(t.x, t.y);
      const tElev = calcElevation(t.altitude_ft, tRange);

      const dBearing = angleDiff(tBearing, effectiveBearing);
      const dElev = angleDiff(tElev, effectiveElevation);

      if (Math.abs(dBearing) <= FOV_H / 2 && Math.abs(dElev) <= FOV_V / 2) {
        // Convert angle offset to pixel offset
        const pixelOffsetX = (dBearing / (FOV_H / 2)) * (CANVAS_W / 2);
        const pixelOffsetY = -(dElev / (FOV_V / 2)) * (CANVAS_H / 2);
        return { track: t, pixelOffsetX, pixelOffsetY };
      }
    }
    return null;
  }, [track, allTracks, effectiveBearing, effectiveElevation]);

  // Check if track is covered by an EO/IR sensor (range only — camera can slew to any bearing)
  const isDegraded = useCallback(
    (t: TrackData): boolean => {
      const eoirSensors = sensorConfigs.filter(
        (s) => s.type === "eoir" && s.status === "active",
      );
      if (eoirSensors.length === 0) return true; // no camera at all
      for (const sensor of eoirSensors) {
        const sx = sensor.x ?? 0;
        const sy = sensor.y ?? 0;
        const dist = Math.sqrt((t.x - sx) ** 2 + (t.y - sy) ** 2);
        const range = sensor.range_km ?? 5.0;
        if (dist <= range) return false; // in range — camera can slew to it
      }
      return true; // all cameras out of range
    },
    [sensorConfigs],
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const time = Date.now() / 1000;

    // Background
    drawBackground(ctx, w, h, mode);

    const visibleTarget = getVisibleTrack();
    const isStandby = !track;
    const showDegraded = visibleTarget ? (degraded || isDegraded(visibleTarget.track)) : false;

    if (isStandby && !visibleTarget) {
      // Standby mode — no target in view
      drawScanLines(ctx, w, h, time);
      drawNoise(ctx, w, h, 0.3, mode);
      drawReticle(ctx, w, h, hudColor);

      // STANDBY text
      const alpha = 0.4 + 0.2 * Math.sin(time * 2);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = hudColor;
      ctx.font = "bold 24px monospace";
      ctx.textAlign = "center";
      ctx.fillText("STANDBY", w / 2, h / 2 - 10);
      ctx.font = "11px monospace";
      ctx.globalAlpha = 0.5;
      ctx.fillText("USE JOYSTICK TO SCAN", w / 2, h / 2 + 16);
      ctx.globalAlpha = 1;
    } else if (showDegraded && visibleTarget) {
      // Degraded — heavy static
      drawNoise(ctx, w, h, 1.0, mode);
      drawNoise(ctx, w, h, 0.8, mode);
      drawReticle(ctx, w, h, hudColor);
    } else if (acquiring && track) {
      // Acquiring animation
      const elapsed = (Date.now() - acquireStartRef.current) / 1500;
      drawNoise(ctx, w, h, 0.9, mode);
      drawAcquiring(ctx, w, h, elapsed, hudColor);
      drawReticle(ctx, w, h, hudColor);
    } else if (visibleTarget) {
      // Draw the visible target
      const { track: vt, pixelOffsetX, pixelOffsetY } = visibleTarget;
      const rangeKm = calcRange(vt.x, vt.y);
      const noise = noiseFactor(rangeKm);
      const scale = silhouetteScale(rangeKm);
      const amp = shakeAmplitude(rangeKm);
      const jx = (Math.random() - 0.5) * amp;
      const jy = (Math.random() - 0.5) * amp;

      ctx.save();
      ctx.translate(w / 2 + pixelOffsetX + jx, h / 2 + pixelOffsetY + jy);

      if (rangeKm > 0.8) {
        ctx.shadowColor = mode === "thermal"
          ? "rgba(200,210,200,0.5)"
          : "rgba(40,40,60,0.5)";
        ctx.shadowBlur = 12;
      } else if (rangeKm > 0.3) {
        ctx.shadowColor = mode === "thermal"
          ? "rgba(200,210,200,0.3)"
          : "rgba(40,40,60,0.3)";
        ctx.shadowBlur = 5;
      }

      drawSilhouette(ctx, vt.classification, scale, mode);
      ctx.restore();

      drawNoise(ctx, w, h, noise, mode);
      drawReticle(ctx, w, h, hudColor);
    } else {
      // Standby with scan lines (fallback)
      drawScanLines(ctx, w, h, time);
      drawNoise(ctx, w, h, 0.3, mode);
      drawReticle(ctx, w, h, hudColor);
    }

    rafRef.current = requestAnimationFrame(draw);
  }, [track, mode, acquiring, hudColor, degraded, getVisibleTrack, isDegraded]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  const visibleTarget = getVisibleTrack();
  const displayTrackId = track?.id ?? visibleTarget?.track?.id ?? null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        background: "#0d1117",
        borderTop: "1px solid #30363d",
        minHeight: 0,
        flex: "0 0 auto",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "5px 10px",
          background: "#161b22",
          borderBottom: "1px solid #30363d",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: "monospace",
            fontSize: 10,
            color: hudColor,
            letterSpacing: 1.2,
            fontWeight: 600,
          }}
        >
          EO/IR — {displayTrackId ? displayTrackId.toUpperCase() : "STANDBY"}
        </span>

        {/* Thermal / Daylight toggle */}
        <div style={{ display: "flex", gap: 3 }}>
          <button
            onClick={() => setMode("thermal")}
            style={{
              background: mode === "thermal" ? "#21262d" : "transparent",
              border: `1px solid ${mode === "thermal" ? HUD_COLOR_THERMAL : "#30363d"}`,
              color: mode === "thermal" ? HUD_COLOR_THERMAL : "#8b949e",
              cursor: "pointer",
              fontFamily: "monospace",
              fontSize: 9,
              padding: "1px 6px",
              borderRadius: 3,
              letterSpacing: 0.5,
            }}
          >
            IR
          </button>
          <button
            onClick={() => setMode("daylight")}
            style={{
              background: mode === "daylight" ? "#21262d" : "transparent",
              border: `1px solid ${mode === "daylight" ? HUD_COLOR_DAYLIGHT : "#30363d"}`,
              color: mode === "daylight" ? HUD_COLOR_DAYLIGHT : "#8b949e",
              cursor: "pointer",
              fontFamily: "monospace",
              fontSize: 9,
              padding: "1px 6px",
              borderRadius: 3,
              letterSpacing: 0.5,
            }}
          >
            VIS
          </button>
        </div>
      </div>

      {/* Viewport */}
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: `${CANVAS_W} / ${CANVAS_H}`,
          overflow: "hidden",
        }}
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          style={{ display: "block", width: "100%", height: "100%" }}
        />

        {/* Degraded overlay message */}
        {visibleTarget && (degraded || isDegraded(visibleTarget.track)) && (
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              textAlign: "center",
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                fontFamily: "monospace",
                fontSize: 13,
                fontWeight: 700,
                color: "#f85149",
                letterSpacing: 1.5,
                textShadow: "0 0 10px rgba(248, 81, 73, 0.6)",
                marginBottom: 4,
              }}
            >
              TARGET OUT OF CAMERA RANGE
            </div>
            <div
              style={{
                fontFamily: "monospace",
                fontSize: 9,
                color: "#d29922",
                letterSpacing: 0.5,
              }}
            >
              MOVE CAMERA CLOSER OR WAIT FOR APPROACH
            </div>
          </div>
        )}

        {/* HUD Overlay — bearing & elevation */}
        <span
          style={{
            position: "absolute",
            top: 6,
            left: 8,
            fontFamily: "monospace",
            fontSize: 9,
            color: hudColor,
            textShadow: `0 0 4px ${hudColor}80`,
            pointerEvents: "none",
          }}
        >
          BRG: {String(Math.round(effectiveBearing)).padStart(3, "0")}&deg;
        </span>
        <span
          style={{
            position: "absolute",
            top: 6,
            right: 8,
            fontFamily: "monospace",
            fontSize: 9,
            color: hudColor,
            textShadow: `0 0 4px ${hudColor}80`,
            pointerEvents: "none",
          }}
        >
          ELEV: {effectiveElevation.toFixed(1)}&deg;
        </span>

        {/* Target data HUD */}
        {visibleTarget && !acquiring && (
          <>
            <span
              style={{
                position: "absolute",
                bottom: 6,
                left: 8,
                fontFamily: "monospace",
                fontSize: 9,
                color: hudColor,
                textShadow: `0 0 4px ${hudColor}80`,
                pointerEvents: "none",
              }}
            >
              RNG: {calcRange(visibleTarget.track.x, visibleTarget.track.y).toFixed(2)} km
            </span>
            <span
              style={{
                position: "absolute",
                bottom: 6,
                right: 8,
                fontFamily: "monospace",
                fontSize: 9,
                color: hudColor,
                textShadow: `0 0 4px ${hudColor}80`,
                pointerEvents: "none",
              }}
            >
              ALT: {Math.round(visibleTarget.track.altitude_ft)} ft
            </span>
            <span
              style={{
                position: "absolute",
                top: 6,
                left: "50%",
                transform: "translateX(-50%)",
                fontFamily: "monospace",
                fontSize: 9,
                color: hudColor,
                textShadow: `0 0 4px ${hudColor}80`,
                pointerEvents: "none",
              }}
            >
              {Math.round(visibleTarget.track.speed_kts)} kts | HDG {String(Math.round(visibleTarget.track.heading_deg)).padStart(3, "0")}&deg;
            </span>
          </>
        )}

        {/* Mode indicator */}
        <span
          style={{
            position: "absolute",
            bottom: 6,
            left: "50%",
            transform: "translateX(-50%)",
            fontFamily: "monospace",
            fontSize: 8,
            color: hudColor + "88",
            pointerEvents: "none",
          }}
        >
          {mode === "thermal" ? "IR" : "VIS"} | FOV {FOV_H}&deg;
        </span>

        {/* Joystick + CENTER button */}
        <div
          style={{
            position: "absolute",
            bottom: 8,
            right: 8,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 4,
          }}
        >
          {track && (bearingOffset !== 0 || elevationOffset !== 0) && (
            <button
              onClick={handleCenter}
              style={{
                background: "rgba(30,35,42,0.8)",
                border: "1px solid rgba(63,185,80,0.4)",
                color: HUD_COLOR_THERMAL,
                cursor: "pointer",
                fontFamily: "monospace",
                fontSize: 8,
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: 3,
                letterSpacing: 1,
              }}
            >
              CENTER
            </button>
          )}
          <VirtualJoystick onMove={handleJoystickMove} onRelease={handleJoystickRelease} />
        </div>
      </div>
    </div>
  );
}

/** Check if a track is within camera FOV — exported for use in track lists */
export function isTrackInCameraFov(
  t: TrackData,
  cameraBearing: number,
  cameraElevation: number,
  bearingOffset: number,
  elevationOffset: number,
  slewedTrack: TrackData | null,
): boolean {
  const effBearing = slewedTrack
    ? (calcBearing(slewedTrack.x, slewedTrack.y) + bearingOffset + 360) % 360
    : cameraBearing;
  const effElev = slewedTrack
    ? calcElevation(slewedTrack.altitude_ft, calcRange(slewedTrack.x, slewedTrack.y)) + elevationOffset
    : cameraElevation;

  const tBearing = calcBearing(t.x, t.y);
  const tRange = calcRange(t.x, t.y);
  const tElev = calcElevation(t.altitude_ft, tRange);
  const dBearing = angleDiff(tBearing, effBearing);
  const dElev = angleDiff(tElev, effElev);
  return Math.abs(dBearing) <= FOV_H / 2 && Math.abs(dElev) <= FOV_V / 2;
}
