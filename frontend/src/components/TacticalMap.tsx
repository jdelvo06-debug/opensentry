import { useCallback, useEffect, useRef } from "react";
import type { Affiliation, EngagementZones, TrackData } from "../types";

interface Props {
  tracks: TrackData[];
  selectedTrackId: string | null;
  onSelectTrack: (id: string | null) => void;
  engagementZones: EngagementZones | null;
  elapsed: number;
}

const AFFILIATION_COLORS: Record<Affiliation, string> = {
  unknown: "#d29922",
  hostile: "#f85149",
  friendly: "#58a6ff",
  neutral: "#3fb950",
};

// Convert km to canvas pixels
function kmToPixels(km: number, scale: number) {
  return km * scale;
}

export default function TacticalMap({
  tracks,
  selectedTrackId,
  onSelectTrack,
  engagementZones,
  elapsed,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);
  const sizeRef = useRef({ w: 800, h: 600 });
  const scaleRef = useRef(80); // px per km

  // Resize handler
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        sizeRef.current = { w: width, h: height };
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = width * devicePixelRatio;
          canvas.height = height * devicePixelRatio;
          canvas.style.width = `${width}px`;
          canvas.style.height = `${height}px`;
        }
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Click handler
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;
      const { w, h } = sizeRef.current;
      const cx = w / 2;
      const cy = h / 2;
      const scale = scaleRef.current;

      let closestId: string | null = null;
      let closestDist = 20; // minimum distance in pixels to select

      for (const track of tracks) {
        if (track.neutralized) continue;
        const px = cx + track.x * scale;
        const py = cy - track.y * scale;
        const dist = Math.sqrt((clickX - px) ** 2 + (clickY - py) ** 2);
        if (dist < closestDist) {
          closestDist = dist;
          closestId = track.id;
        }
      }

      onSelectTrack(closestId);
    },
    [tracks, onSelectTrack],
  );

  // Main render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let running = true;

    function draw() {
      if (!running || !ctx || !canvas) return;

      const dpr = devicePixelRatio;
      const { w, h } = sizeRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const cx = w / 2;
      const cy = h / 2;

      // Compute scale: fit detection range with some padding
      const maxRange = engagementZones?.detection_range_km || 5;
      const minDim = Math.min(w, h);
      const scale = (minDim * 0.4) / maxRange;
      scaleRef.current = scale;

      // --- Background ---
      ctx.fillStyle = "#0d1117";
      ctx.fillRect(0, 0, w, h);

      // --- Grid ---
      ctx.strokeStyle = "#1c2333";
      ctx.lineWidth = 0.5;
      const gridSpacing = scale; // 1km per grid
      for (let gx = cx % gridSpacing; gx < w; gx += gridSpacing) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, h);
        ctx.stroke();
      }
      for (let gy = cy % gridSpacing; gy < h; gy += gridSpacing) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
        ctx.stroke();
      }

      // --- Engagement zone rings ---
      if (engagementZones) {
        // Detection range (outermost)
        drawZoneRing(ctx, cx, cy, kmToPixels(engagementZones.detection_range_km, scale), "#30363d", "DETECTION");
        // Engagement range
        drawZoneRing(ctx, cx, cy, kmToPixels(engagementZones.engagement_range_km, scale), "#58a6ff33", "ENGAGEMENT");
        // Identification range (innermost of the three)
        drawZoneRing(ctx, cx, cy, kmToPixels(engagementZones.identification_range_km, scale), "#d2992233", "ID");
      }

      // --- Compass labels ---
      ctx.font = "500 10px 'Inter', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#484f58";
      ctx.fillText("N", cx, 14);
      ctx.fillText("S", cx, h - 14);
      ctx.fillText("E", w - 14, cy);
      ctx.fillText("W", 14, cy);

      // --- Radar sweep ---
      const sweepAngle = ((elapsed * 0.8) % (Math.PI * 2));
      const sweepLen = Math.max(w, h);
      const gradient = ctx.createConicGradient(sweepAngle - 0.4, cx, cy);
      gradient.addColorStop(0, "transparent");
      gradient.addColorStop(0.06, "#58a6ff12");
      gradient.addColorStop(0.12, "transparent");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(cx, cy, sweepLen, 0, Math.PI * 2);
      ctx.fill();

      // Sweep line
      ctx.strokeStyle = "#58a6ff30";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(sweepAngle) * sweepLen, cy + Math.sin(sweepAngle) * sweepLen);
      ctx.stroke();

      // --- Base marker ---
      ctx.fillStyle = "#58a6ff";
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();

      // Pulsing ring
      const pulseRadius = 8 + Math.sin(elapsed * 3) * 3;
      ctx.strokeStyle = `rgba(88, 166, 255, ${0.4 + Math.sin(elapsed * 3) * 0.2})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, pulseRadius, 0, Math.PI * 2);
      ctx.stroke();

      // Base label
      ctx.font = "500 9px 'Inter', sans-serif";
      ctx.fillStyle = "#58a6ff";
      ctx.textAlign = "center";
      ctx.fillText("BASE", cx, cy + 18);

      // --- Tracks ---
      for (const track of tracks) {
        const px = cx + track.x * scale;
        const py = cy - track.y * scale; // y inverted for screen coords
        const color = AFFILIATION_COLORS[track.affiliation];
        const isSelected = track.id === selectedTrackId;

        // Trail
        if (track.trail && track.trail.length > 1) {
          ctx.lineWidth = 1;
          for (let i = 1; i < track.trail.length; i++) {
            const alpha = (i / track.trail.length) * 0.6;
            ctx.strokeStyle = hexWithAlpha(color, alpha);
            ctx.beginPath();
            ctx.moveTo(
              cx + track.trail[i - 1][0] * scale,
              cy - track.trail[i - 1][1] * scale,
            );
            ctx.lineTo(
              cx + track.trail[i][0] * scale,
              cy - track.trail[i][1] * scale,
            );
            ctx.stroke();
          }
        }

        // Speed leader line
        if (track.speed_kts > 0 && !track.neutralized) {
          const headingRad = (track.heading_deg - 90) * (Math.PI / 180);
          const leaderLen = (track.speed_kts / 100) * scale * 0.8;
          ctx.strokeStyle = hexWithAlpha(color, 0.5);
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + Math.cos(headingRad) * leaderLen, py + Math.sin(headingRad) * leaderLen);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Selection ring
        if (isSelected) {
          const selRadius = 14 + Math.sin(elapsed * 4) * 2;
          ctx.strokeStyle = hexWithAlpha(color, 0.7);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(px, py, selRadius, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Track symbol
        if (track.neutralized) {
          drawNeutralizedSymbol(ctx, px, py);
        } else {
          drawMilSymbol(ctx, px, py, track.affiliation, color);
        }

        // Track label
        ctx.font = "600 10px 'JetBrains Mono', monospace";
        ctx.fillStyle = track.neutralized ? "#484f58" : color;
        ctx.textAlign = "left";
        ctx.fillText(track.id.toUpperCase(), px + 14, py - 6);

        // Confidence
        if (!track.neutralized) {
          ctx.font = "400 9px 'JetBrains Mono', monospace";
          ctx.fillStyle = hexWithAlpha(color, 0.7);
          ctx.fillText(`${Math.round(track.confidence * 100)}%`, px + 14, py + 6);
        }
      }

      // --- Scale bar ---
      const scaleBarLen = scale; // 1km
      ctx.strokeStyle = "#8b949e";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(16, h - 24);
      ctx.lineTo(16 + scaleBarLen, h - 24);
      ctx.stroke();
      // end caps
      ctx.beginPath();
      ctx.moveTo(16, h - 28);
      ctx.lineTo(16, h - 20);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(16 + scaleBarLen, h - 28);
      ctx.lineTo(16 + scaleBarLen, h - 20);
      ctx.stroke();

      ctx.font = "400 10px 'JetBrains Mono', monospace";
      ctx.fillStyle = "#8b949e";
      ctx.textAlign = "center";
      ctx.fillText("1 km", 16 + scaleBarLen / 2, h - 10);

      animFrameRef.current = requestAnimationFrame(draw);
    }

    draw();

    return () => {
      running = false;
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [tracks, selectedTrackId, engagementZones, elapsed]);

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        position: "relative",
        overflow: "hidden",
        background: "#0d1117",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: "block", cursor: "crosshair" }}
        onClick={handleClick}
      />
    </div>
  );
}

function drawZoneRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  color: string,
  label: string,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Label
  ctx.font = "400 9px 'Inter', sans-serif";
  ctx.fillStyle = "#484f58";
  ctx.textAlign = "center";
  ctx.fillText(label, cx, cy - radius - 4);
}

function drawMilSymbol(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  affiliation: Affiliation,
  color: string,
) {
  const s = 8; // half-size
  ctx.fillStyle = `${color}33`;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;

  switch (affiliation) {
    case "hostile": {
      // Diamond (rotated square)
      ctx.beginPath();
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + s, y);
      ctx.lineTo(x, y + s);
      ctx.lineTo(x - s, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "friendly": {
      // Rectangle (wider than tall)
      ctx.beginPath();
      ctx.rect(x - s * 1.2, y - s * 0.7, s * 2.4, s * 1.4);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "neutral": {
      // Square
      ctx.beginPath();
      ctx.rect(x - s * 0.8, y - s * 0.8, s * 1.6, s * 1.6);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "unknown":
    default: {
      // Square (yellow)
      ctx.beginPath();
      ctx.rect(x - s * 0.8, y - s * 0.8, s * 1.6, s * 1.6);
      ctx.fill();
      ctx.stroke();
      break;
    }
  }
}

function drawNeutralizedSymbol(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
) {
  const s = 7;
  ctx.strokeStyle = "#484f58";
  ctx.lineWidth = 2;
  // X shape
  ctx.beginPath();
  ctx.moveTo(x - s, y - s);
  ctx.lineTo(x + s, y + s);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + s, y - s);
  ctx.lineTo(x - s, y + s);
  ctx.stroke();
}

function hexWithAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0");
  return hex + a;
}
