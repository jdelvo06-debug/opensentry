import { useRef, useEffect, useCallback, useState } from "react";
import type { TrackData } from "../types";

interface Props {
  track: TrackData;
  onClose: () => void;
}

const CANVAS_W = 640;
const CANVAS_H = 480;
const RETICLE_COLOR = "#3fb95088";
const HUD_COLOR_THERMAL = "#3fb950";
const HUD_COLOR_DAYLIGHT = "#58a6ff";

type CameraMode = "thermal" | "daylight";

function calcRange(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

function calcBearing(x: number, y: number): number {
  const rad = Math.atan2(x, -y);
  return ((rad * 180) / Math.PI + 360) % 360;
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

/** Camera shake amplitude increases with range */
function shakeAmplitude(rangeKm: number): number {
  if (rangeKm < 0.3) return 1;
  if (rangeKm < 0.8) return 3;
  if (rangeKm < 1.5) return 6;
  return 10;
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
  const gap = 18;
  const lineLen = 60;
  const tickSpacing = 15;
  const tickSize = 4;

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

  const boxHalf = 80;
  const bracketLen = 20;

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

  // Spinning arc
  ctx.strokeStyle = hudColor;
  ctx.lineWidth = 2;
  const startAngle = progress * Math.PI * 4;
  ctx.beginPath();
  ctx.arc(cx, cy, 50, startAngle, startAngle + Math.PI * 0.8);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 50, startAngle + Math.PI, startAngle + Math.PI * 1.8);
  ctx.stroke();

  // Text
  const alpha = 0.5 + 0.5 * Math.sin(progress * Math.PI * 6);
  ctx.fillStyle = hudColor;
  ctx.globalAlpha = alpha;
  ctx.font = "bold 14px monospace";
  ctx.textAlign = "center";
  ctx.fillText("ACQUIRING...", cx, cy + 80);
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CameraPanel({ track, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const [mode, setMode] = useState<CameraMode>("thermal");
  const [acquiring, setAcquiring] = useState(true);
  const acquireStartRef = useRef(Date.now());
  const prevTrackIdRef = useRef(track.id);

  // Reset acquiring animation when target changes
  useEffect(() => {
    if (track.id !== prevTrackIdRef.current) {
      setAcquiring(true);
      acquireStartRef.current = Date.now();
      prevTrackIdRef.current = track.id;
    }
  }, [track.id]);

  // Auto-finish acquiring after 1.5s
  useEffect(() => {
    if (!acquiring) return;
    const timer = setTimeout(() => setAcquiring(false), 1500);
    return () => clearTimeout(timer);
  }, [acquiring]);

  const hudColor = mode === "thermal" ? HUD_COLOR_THERMAL : HUD_COLOR_DAYLIGHT;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    const rangeKm = calcRange(track.x, track.y);
    const noise = noiseFactor(rangeKm);
    const scale = silhouetteScale(rangeKm);

    // Range-based camera shake
    const amp = shakeAmplitude(rangeKm);
    const jx = (Math.random() - 0.5) * amp;
    const jy = (Math.random() - 0.5) * amp;

    // Background
    drawBackground(ctx, w, h, mode);

    if (acquiring) {
      // Acquiring animation
      const elapsed = (Date.now() - acquireStartRef.current) / 1500;
      drawNoise(ctx, w, h, 0.9, mode);
      drawAcquiring(ctx, w, h, elapsed, hudColor);
      drawReticle(ctx, w, h, hudColor);
    } else {
      // Silhouette
      ctx.save();
      ctx.translate(w / 2 + jx, h / 2 + jy);

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

      drawSilhouette(ctx, track.classification, scale, mode);
      ctx.restore();

      // Noise overlay
      drawNoise(ctx, w, h, noise, mode);

      // Reticle
      drawReticle(ctx, w, h, hudColor);
    }

    rafRef.current = requestAnimationFrame(draw);
  }, [track, mode, acquiring, hudColor]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  const rangeKm = calcRange(track.x, track.y);
  const bearingDeg = calcBearing(track.x, track.y);

  const hudStyle = (pos: Record<string, unknown>) => ({
    position: "absolute" as const,
    fontFamily: "monospace",
    fontSize: 11,
    color: hudColor,
    textShadow: `0 0 6px ${hudColor}80`,
    pointerEvents: "none" as const,
    ...pos,
  });

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.85)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "#0d1117",
          border: "1px solid #30363d",
          borderRadius: 6,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          maxWidth: "95vw",
          maxHeight: "95vh",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 14px",
            background: "#161b22",
            borderBottom: "1px solid #30363d",
            gap: 12,
          }}
        >
          <span
            style={{
              fontFamily: "monospace",
              fontSize: 13,
              color: hudColor,
              letterSpacing: 1.5,
              fontWeight: 600,
            }}
          >
            EO/IR CAMERA FEED
          </span>

          {/* Thermal / Daylight toggle */}
          <div style={{ display: "flex", gap: 4 }}>
            <button
              onClick={() => setMode("thermal")}
              style={{
                background: mode === "thermal" ? "#21262d" : "transparent",
                border: `1px solid ${mode === "thermal" ? HUD_COLOR_THERMAL : "#30363d"}`,
                color: mode === "thermal" ? HUD_COLOR_THERMAL : "#8b949e",
                cursor: "pointer",
                fontFamily: "monospace",
                fontSize: 10,
                padding: "2px 8px",
                borderRadius: 3,
                letterSpacing: 0.5,
              }}
            >
              THERMAL
            </button>
            <button
              onClick={() => setMode("daylight")}
              style={{
                background: mode === "daylight" ? "#21262d" : "transparent",
                border: `1px solid ${mode === "daylight" ? HUD_COLOR_DAYLIGHT : "#30363d"}`,
                color: mode === "daylight" ? HUD_COLOR_DAYLIGHT : "#8b949e",
                cursor: "pointer",
                fontFamily: "monospace",
                fontSize: 10,
                padding: "2px 8px",
                borderRadius: 3,
                letterSpacing: 0.5,
              }}
            >
              DAYLIGHT
            </button>
          </div>

          <span
            style={{
              fontFamily: "monospace",
              fontSize: 12,
              color: "#8b949e",
            }}
          >
            TGT: {track.id.toUpperCase()}
          </span>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "1px solid #30363d",
              color: "#8b949e",
              cursor: "pointer",
              fontFamily: "monospace",
              fontSize: 14,
              padding: "2px 8px",
              borderRadius: 4,
              lineHeight: 1,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "#f85149";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "#f85149";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "#8b949e";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "#30363d";
            }}
          >
            X
          </button>
        </div>

        {/* Viewport */}
        <div
          style={{
            position: "relative",
            width: CANVAS_W,
            height: CANVAS_H,
          }}
        >
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            style={{ display: "block", width: CANVAS_W, height: CANVAS_H }}
          />

          {/* HUD Overlay */}
          <span style={hudStyle({ top: 10, left: 12 })}>
            TGT: {track.id.toUpperCase()}
          </span>
          <span style={hudStyle({ top: 10, right: 12 })}>
            RNG: {rangeKm.toFixed(2)} km
          </span>
          <span style={hudStyle({ bottom: 10, left: 12 })}>
            BRG: {String(Math.round(bearingDeg)).padStart(3, "0")}&deg;
          </span>
          <span style={hudStyle({ bottom: 10, right: 12 })}>
            ALT: {Math.round(track.altitude_ft)} ft
          </span>
          <span
            style={hudStyle({
              bottom: 10,
              left: "50%",
              transform: "translateX(-50%)",
            })}
          >
            ZOOM: 4x | {mode === "thermal" ? "IR" : "VIS"}
          </span>
          <span style={hudStyle({ top: 10, left: "50%" , transform: "translateX(-50%)" })}>
            SPD: {Math.round(track.speed_kts)} kts | HDG: {String(Math.round(track.heading_deg)).padStart(3, "0")}&deg;
          </span>
        </div>
      </div>
    </div>
  );
}
