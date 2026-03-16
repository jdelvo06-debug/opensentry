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

// Base camera field of view in degrees (at 1x zoom)
const BASE_FOV_H = 30;
const BASE_FOV_V = 20;

const ZOOM_LEVELS = [1, 2, 4, 8] as const;
type ZoomLevel = (typeof ZOOM_LEVELS)[number];

type CameraMode = "thermal" | "daylight";
type GimbalMode = "auto-track" | "manual" | "standby";

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
// Silhouette drawing helpers — all accept `time` (seconds) for animation
// ---------------------------------------------------------------------------

function drawCommercialQuad(ctx: CanvasRenderingContext2D, s: number, time: number) {
  // Hover wobble
  const wobbleY = Math.sin(time * 3.2) * 1.5 * s;
  const wobbleRot = Math.sin(time * 2.1) * 0.04;
  ctx.save();
  ctx.translate(0, wobbleY);
  ctx.rotate(wobbleRot);

  const armLen = 28 * s;
  const armW = Math.max(1, 2.5 * s);
  const bodyW = 14 * s;
  const bodyH = 10 * s;
  const rotorR = 10 * s;

  // Landing gear legs
  ctx.lineWidth = Math.max(1, 2 * s);
  ctx.beginPath();
  ctx.moveTo(-bodyW * 0.6, bodyH / 2);
  ctx.lineTo(-bodyW * 0.8, bodyH / 2 + 12 * s);
  ctx.moveTo(bodyW * 0.6, bodyH / 2);
  ctx.lineTo(bodyW * 0.8, bodyH / 2 + 12 * s);
  ctx.stroke();
  // Landing skids
  ctx.lineWidth = Math.max(1, 2.5 * s);
  ctx.beginPath();
  ctx.moveTo(-bodyW * 1.1, bodyH / 2 + 12 * s);
  ctx.lineTo(-bodyW * 0.4, bodyH / 2 + 12 * s);
  ctx.moveTo(bodyW * 0.4, bodyH / 2 + 12 * s);
  ctx.lineTo(bodyW * 1.1, bodyH / 2 + 12 * s);
  ctx.stroke();

  // Central body (rounded rectangle)
  const cr = 3 * s;
  ctx.beginPath();
  ctx.moveTo(-bodyW / 2 + cr, -bodyH / 2);
  ctx.lineTo(bodyW / 2 - cr, -bodyH / 2);
  ctx.quadraticCurveTo(bodyW / 2, -bodyH / 2, bodyW / 2, -bodyH / 2 + cr);
  ctx.lineTo(bodyW / 2, bodyH / 2 - cr);
  ctx.quadraticCurveTo(bodyW / 2, bodyH / 2, bodyW / 2 - cr, bodyH / 2);
  ctx.lineTo(-bodyW / 2 + cr, bodyH / 2);
  ctx.quadraticCurveTo(-bodyW / 2, bodyH / 2, -bodyW / 2, bodyH / 2 - cr);
  ctx.lineTo(-bodyW / 2, -bodyH / 2 + cr);
  ctx.quadraticCurveTo(-bodyW / 2, -bodyH / 2, -bodyW / 2 + cr, -bodyH / 2);
  ctx.closePath();
  ctx.fill();

  // Camera/gimbal bump underneath
  ctx.beginPath();
  ctx.ellipse(0, bodyH / 2 + 3 * s, 4 * s, 3 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // Arms + spinning rotors
  const armAngles = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
  for (let i = 0; i < armAngles.length; i++) {
    const a = armAngles[i];
    const ex = Math.cos(a) * armLen;
    const ey = Math.sin(a) * armLen;

    // Arm
    ctx.lineWidth = armW;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(ex, ey);
    ctx.stroke();

    // Motor hub
    ctx.beginPath();
    ctx.arc(ex, ey, 3 * s, 0, Math.PI * 2);
    ctx.fill();

    // Spinning rotor blades (2 blades per rotor, different phase per rotor)
    const rotorSpeed = 18; // rad/s
    const phase = time * rotorSpeed + i * (Math.PI / 2);
    ctx.lineWidth = Math.max(1, 2.2 * s);
    ctx.globalAlpha = 0.7;
    for (let b = 0; b < 2; b++) {
      const bladeAngle = phase + b * Math.PI;
      const bx1 = ex + Math.cos(bladeAngle) * rotorR;
      const by1 = ey + Math.sin(bladeAngle) * rotorR;
      const bx2 = ex - Math.cos(bladeAngle) * rotorR;
      const by2 = ey - Math.sin(bladeAngle) * rotorR;
      ctx.beginPath();
      ctx.moveTo(bx1, by1);
      ctx.lineTo(bx2, by2);
      ctx.stroke();
    }
    // Rotor disc (motion blur circle)
    ctx.globalAlpha = 0.15;
    ctx.beginPath();
    ctx.arc(ex, ey, rotorR, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function drawFixedWing(ctx: CanvasRenderingContext2D, s: number, time: number) {
  // Slight bank/roll oscillation
  const bankAngle = Math.sin(time * 1.5) * 0.06;
  ctx.save();
  ctx.rotate(bankAngle);

  // Narrow fuselage
  const fuseL = 44 * s;
  const fuseW = 5 * s;
  ctx.beginPath();
  ctx.moveTo(fuseL / 2 + 4 * s, 0); // nose point
  ctx.lineTo(fuseL / 2, -fuseW / 2);
  ctx.lineTo(-fuseL / 2, -fuseW / 2);
  ctx.lineTo(-fuseL / 2 - 2 * s, 0);
  ctx.lineTo(-fuseL / 2, fuseW / 2);
  ctx.lineTo(fuseL / 2, fuseW / 2);
  ctx.closePath();
  ctx.fill();

  // Delta/swept wings
  ctx.beginPath();
  ctx.moveTo(8 * s, 0);
  ctx.lineTo(-12 * s, -32 * s);
  ctx.lineTo(-18 * s, -30 * s);
  ctx.lineTo(-6 * s, 0);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(8 * s, 0);
  ctx.lineTo(-12 * s, 32 * s);
  ctx.lineTo(-18 * s, 30 * s);
  ctx.lineTo(-6 * s, 0);
  ctx.closePath();
  ctx.fill();

  // V-tail
  ctx.beginPath();
  ctx.moveTo(-fuseL / 2, 0);
  ctx.lineTo(-fuseL / 2 - 8 * s, -12 * s);
  ctx.lineTo(-fuseL / 2 - 4 * s, -11 * s);
  ctx.lineTo(-fuseL / 2 + 2 * s, 0);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(-fuseL / 2, 0);
  ctx.lineTo(-fuseL / 2 - 8 * s, 12 * s);
  ctx.lineTo(-fuseL / 2 - 4 * s, 11 * s);
  ctx.lineTo(-fuseL / 2 + 2 * s, 0);
  ctx.closePath();
  ctx.fill();

  // Rear propeller (spinning)
  const propR = 7 * s;
  const propPhase = time * 22;
  const px = -fuseL / 2 - 2 * s;
  ctx.lineWidth = Math.max(1, 2 * s);
  ctx.globalAlpha = 0.7;
  for (let b = 0; b < 3; b++) {
    const ba = propPhase + b * (Math.PI * 2 / 3);
    ctx.beginPath();
    ctx.moveTo(px + Math.cos(ba) * propR, Math.sin(ba) * propR);
    ctx.lineTo(px - Math.cos(ba) * propR, -Math.sin(ba) * propR);
    ctx.stroke();
  }
  // Prop disc blur
  ctx.globalAlpha = 0.12;
  ctx.beginPath();
  ctx.arc(px, 0, propR, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.restore();
}

function drawPassengerAircraft(ctx: CanvasRenderingContext2D, s: number, time: number) {
  // Very steady — large aircraft, minimal movement
  const drift = Math.sin(time * 0.5) * 0.01;
  ctx.save();
  ctx.rotate(drift);

  // Scale up — much larger than drones
  const sc = s * 1.8;

  // Tube fuselage
  const fuseL = 55 * sc;
  const fuseW = 7 * sc;
  ctx.beginPath();
  ctx.moveTo(fuseL / 2 + 6 * sc, 0); // nose cone
  ctx.quadraticCurveTo(fuseL / 2 + 2 * sc, -fuseW / 2, fuseL / 2, -fuseW / 2);
  ctx.lineTo(-fuseL / 2, -fuseW / 2);
  ctx.lineTo(-fuseL / 2 - 3 * sc, 0);
  ctx.lineTo(-fuseL / 2, fuseW / 2);
  ctx.lineTo(fuseL / 2, fuseW / 2);
  ctx.quadraticCurveTo(fuseL / 2 + 2 * sc, fuseW / 2, fuseL / 2 + 6 * sc, 0);
  ctx.closePath();
  ctx.fill();

  // Swept wings
  ctx.beginPath();
  ctx.moveTo(6 * sc, -fuseW / 2);
  ctx.lineTo(-10 * sc, -38 * sc);
  ctx.lineTo(-16 * sc, -38 * sc);
  ctx.lineTo(-8 * sc, -fuseW / 2);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(6 * sc, fuseW / 2);
  ctx.lineTo(-10 * sc, 38 * sc);
  ctx.lineTo(-16 * sc, 38 * sc);
  ctx.lineTo(-8 * sc, fuseW / 2);
  ctx.closePath();
  ctx.fill();

  // Engine nacelles (under wings)
  const engY1 = -16 * sc;
  const engY2 = 16 * sc;
  const engX = -2 * sc;
  const engL = 10 * sc;
  const engW = 4 * sc;

  // Left engine
  ctx.beginPath();
  ctx.ellipse(engX, engY1, engL / 2, engW / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  // Pylon
  ctx.fillRect(engX - 1 * sc, engY1 + engW / 2, 2 * sc, Math.abs(engY1) - fuseW / 2 - engW / 2);

  // Right engine
  ctx.beginPath();
  ctx.ellipse(engX, engY2, engL / 2, engW / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  // Pylon
  ctx.fillRect(engX - 1 * sc, fuseW / 2, 2 * sc, engY2 - fuseW / 2 - engW / 2);

  // T-tail vertical stabilizer
  ctx.beginPath();
  ctx.moveTo(-fuseL / 2, -fuseW / 2);
  ctx.lineTo(-fuseL / 2 - 5 * sc, -fuseW / 2 - 14 * sc);
  ctx.lineTo(-fuseL / 2 - 2 * sc, -fuseW / 2 - 14 * sc);
  ctx.lineTo(-fuseL / 2 + 3 * sc, -fuseW / 2);
  ctx.closePath();
  ctx.fill();

  // T-tail horizontal stabilizer
  const tailY = -fuseW / 2 - 13 * sc;
  ctx.beginPath();
  ctx.moveTo(-fuseL / 2 - 3 * sc, tailY);
  ctx.lineTo(-fuseL / 2 - 8 * sc, tailY - 8 * sc);
  ctx.lineTo(-fuseL / 2 - 6 * sc, tailY - 8 * sc);
  ctx.lineTo(-fuseL / 2 - 1 * sc, tailY);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(-fuseL / 2 - 3 * sc, tailY);
  ctx.lineTo(-fuseL / 2 - 8 * sc, tailY + 8 * sc);
  ctx.lineTo(-fuseL / 2 - 6 * sc, tailY + 8 * sc);
  ctx.lineTo(-fuseL / 2 - 1 * sc, tailY);
  ctx.closePath();
  ctx.fill();

  // Cockpit windows (subtle bright spot)
  ctx.globalAlpha = 0.4;
  ctx.beginPath();
  ctx.ellipse(fuseL / 2 + 2 * sc, -1 * sc, 3 * sc, 2 * sc, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.restore();
}

function drawMicro(ctx: CanvasRenderingContext2D, s: number, time: number) {
  // Fast jitter — micro drones are twitchy
  const jitterX = (Math.sin(time * 25) + Math.sin(time * 37)) * 1.2 * s;
  const jitterY = (Math.cos(time * 31) + Math.cos(time * 19)) * 1.0 * s;
  const jitterRot = Math.sin(time * 15) * 0.08;
  ctx.save();
  ctx.translate(jitterX, jitterY);
  ctx.rotate(jitterRot);

  const armLen = 12 * s;
  const rotorR = 4 * s;
  const bodyR = 3 * s;

  // Tiny central body
  ctx.beginPath();
  ctx.arc(0, 0, bodyR, 0, Math.PI * 2);
  ctx.fill();

  // X-frame arms + spinning rotors
  const angles = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
  ctx.lineWidth = Math.max(1, 1.5 * s);
  for (let i = 0; i < angles.length; i++) {
    const a = angles[i];
    const ex = Math.cos(a) * armLen;
    const ey = Math.sin(a) * armLen;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(ex, ey);
    ctx.stroke();

    // Motor dot
    ctx.beginPath();
    ctx.arc(ex, ey, 1.5 * s, 0, Math.PI * 2);
    ctx.fill();

    // Spinning blades
    const phase = time * 24 + i * 1.2;
    ctx.globalAlpha = 0.6;
    for (let b = 0; b < 2; b++) {
      const ba = phase + b * Math.PI;
      ctx.beginPath();
      ctx.moveTo(ex + Math.cos(ba) * rotorR, ey + Math.sin(ba) * rotorR);
      ctx.lineTo(ex - Math.cos(ba) * rotorR, ey - Math.sin(ba) * rotorR);
      ctx.stroke();
    }
    // Blur disc
    ctx.globalAlpha = 0.1;
    ctx.beginPath();
    ctx.arc(ex, ey, rotorR, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function drawBird(ctx: CanvasRenderingContext2D, s: number, time: number) {
  // Wing flapping cycle ~3 Hz
  const flapPhase = time * Math.PI * 6; // 3 Hz full cycle
  const flapAngle = Math.sin(flapPhase) * 0.6; // wing deflection in radians
  // Slight body wobble from flapping
  const bodyBob = Math.sin(flapPhase) * 2 * s;
  const bodyTilt = Math.sin(flapPhase + 0.5) * 0.05;

  ctx.save();
  ctx.translate(0, bodyBob);
  ctx.rotate(bodyTilt);

  // Streamlined body
  ctx.beginPath();
  ctx.ellipse(0, 0, 14 * s, 6 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // Head
  ctx.beginPath();
  ctx.ellipse(16 * s, -1.5 * s, 5 * s, 4 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // Beak
  ctx.beginPath();
  ctx.moveTo(20 * s, -2 * s);
  ctx.lineTo(25 * s, -1.5 * s);
  ctx.lineTo(20 * s, 0);
  ctx.closePath();
  ctx.fill();

  // Tail feathers
  ctx.beginPath();
  ctx.moveTo(-14 * s, -2 * s);
  ctx.lineTo(-24 * s, -5 * s);
  ctx.lineTo(-22 * s, 0);
  ctx.lineTo(-24 * s, 5 * s);
  ctx.lineTo(-14 * s, 2 * s);
  ctx.closePath();
  ctx.fill();

  // Left wing (flapping)
  ctx.save();
  ctx.translate(0, -5 * s);
  ctx.rotate(-flapAngle);
  ctx.beginPath();
  ctx.moveTo(4 * s, 0);
  ctx.quadraticCurveTo(0, -18 * s, -10 * s, -30 * s);
  ctx.lineTo(-14 * s, -28 * s);
  ctx.quadraticCurveTo(-6 * s, -14 * s, -8 * s, 0);
  ctx.closePath();
  ctx.fill();
  // Feather tips
  ctx.lineWidth = Math.max(1, 1.2 * s);
  ctx.beginPath();
  ctx.moveTo(-10 * s, -28 * s);
  ctx.lineTo(-16 * s, -32 * s);
  ctx.moveTo(-7 * s, -24 * s);
  ctx.lineTo(-14 * s, -30 * s);
  ctx.stroke();
  ctx.restore();

  // Right wing (flapping — mirrored)
  ctx.save();
  ctx.translate(0, 5 * s);
  ctx.rotate(flapAngle);
  ctx.beginPath();
  ctx.moveTo(4 * s, 0);
  ctx.quadraticCurveTo(0, 18 * s, -10 * s, 30 * s);
  ctx.lineTo(-14 * s, 28 * s);
  ctx.quadraticCurveTo(-6 * s, 14 * s, -8 * s, 0);
  ctx.closePath();
  ctx.fill();
  // Feather tips
  ctx.lineWidth = Math.max(1, 1.2 * s);
  ctx.beginPath();
  ctx.moveTo(-10 * s, 28 * s);
  ctx.lineTo(-16 * s, 32 * s);
  ctx.moveTo(-7 * s, 24 * s);
  ctx.lineTo(-14 * s, 30 * s);
  ctx.stroke();
  ctx.restore();

  ctx.restore();
}

function drawBalloon(ctx: CanvasRenderingContext2D, s: number, time: number) {
  // Gentle sway
  const swayX = Math.sin(time * 0.8) * 3 * s;
  const swayRot = Math.sin(time * 0.6) * 0.04;
  ctx.save();
  ctx.translate(swayX, 0);
  ctx.rotate(swayRot);

  // Large balloon envelope
  ctx.beginPath();
  ctx.ellipse(0, -16 * s, 22 * s, 28 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // Balloon highlight (thermal hotspot)
  ctx.globalAlpha = 0.15;
  ctx.beginPath();
  ctx.ellipse(-5 * s, -22 * s, 8 * s, 12 * s, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Neck/skirt at bottom of balloon
  ctx.beginPath();
  ctx.moveTo(-6 * s, 11 * s);
  ctx.lineTo(-4 * s, 16 * s);
  ctx.lineTo(4 * s, 16 * s);
  ctx.lineTo(6 * s, 11 * s);
  ctx.closePath();
  ctx.fill();

  // Tether lines (slight sway)
  const tetherSway = Math.sin(time * 1.2 + 1) * 2 * s;
  ctx.lineWidth = Math.max(1, 1 * s);
  ctx.beginPath();
  ctx.moveTo(-2 * s, 16 * s);
  ctx.quadraticCurveTo(tetherSway, 28 * s, 0, 40 * s);
  ctx.moveTo(2 * s, 16 * s);
  ctx.quadraticCurveTo(tetherSway * 0.7, 28 * s, 0, 40 * s);
  ctx.stroke();

  // Payload box
  ctx.fillRect(-7 * s, 40 * s, 14 * s, 9 * s);

  // Payload antenna
  ctx.lineWidth = Math.max(1, 0.8 * s);
  ctx.beginPath();
  ctx.moveTo(0, 40 * s);
  ctx.lineTo(0, 36 * s);
  ctx.moveTo(-3 * s, 36 * s);
  ctx.lineTo(3 * s, 36 * s);
  ctx.stroke();

  ctx.restore();
}

function drawImprovised(ctx: CanvasRenderingContext2D, s: number, time: number) {
  // Slight wobble — improvised drones are unstable
  const wobble = Math.sin(time * 4.5) * 0.06;
  const drift = Math.sin(time * 2.3) * 1.5 * s;
  ctx.save();
  ctx.translate(drift, 0);
  ctx.rotate(wobble);

  // Irregular body
  ctx.beginPath();
  const pts: [number, number][] = [
    [14 * s, -5 * s],
    [10 * s, -16 * s],
    [-4 * s, -15 * s],
    [-18 * s, -3 * s],
    [-12 * s, 13 * s],
    [8 * s, 15 * s],
  ];
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fill();

  // Strapped-on appendages
  ctx.fillRect(14 * s, -9 * s, 12 * s, 5 * s);
  ctx.fillRect(-18 * s, 5 * s, 10 * s, 4 * s);
  ctx.fillRect(-3 * s, 15 * s, 6 * s, 10 * s);

  // Spinning rotors (taped-on look, uneven)
  const rotorPositions: [number, number][] = [
    [-12 * s, -14 * s],
    [10 * s, -14 * s],
    [-14 * s, 12 * s],
    [8 * s, 13 * s],
  ];
  ctx.lineWidth = Math.max(1, 1.5 * s);
  for (let i = 0; i < rotorPositions.length; i++) {
    const [rx, ry] = rotorPositions[i];
    const rr = 6 * s;
    const phase = time * (16 + i * 3) + i * 2; // uneven speeds
    ctx.globalAlpha = 0.5;
    for (let b = 0; b < 2; b++) {
      const ba = phase + b * Math.PI;
      ctx.beginPath();
      ctx.moveTo(rx + Math.cos(ba) * rr, ry + Math.sin(ba) * rr);
      ctx.lineTo(rx - Math.cos(ba) * rr, ry - Math.sin(ba) * rr);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.1;
    ctx.beginPath();
    ctx.arc(rx, ry, rr, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function drawUnknownBlob(ctx: CanvasRenderingContext2D, s: number, time: number) {
  const pulse = 1 + Math.sin(time * 3) * 0.08;
  ctx.beginPath();
  ctx.ellipse(0, 0, 16 * s * pulse, 12 * s * pulse, 0.3, 0, Math.PI * 2);
  ctx.fill();
}

function drawSilhouette(
  ctx: CanvasRenderingContext2D,
  classification: string | null,
  scale: number,
  mode: CameraMode,
  time: number,
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
      drawCommercialQuad(ctx, scale, time);
      break;
    case "fixed_wing":
      drawFixedWing(ctx, scale, time);
      break;
    case "passenger_aircraft":
      drawPassengerAircraft(ctx, scale, time);
      break;
    case "micro":
      drawMicro(ctx, scale, time);
      break;
    case "bird":
      drawBird(ctx, scale, time);
      break;
    case "weather_balloon":
      drawBalloon(ctx, scale, time);
      break;
    case "improvised":
      drawImprovised(ctx, scale, time);
      break;
    default:
      drawUnknownBlob(ctx, scale, time);
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

  // Gimbal state
  const [gimbalMode, setGimbalMode] = useState<GimbalMode>("standby");
  const [cameraBearing, setCameraBearing] = useState(0);
  const [cameraElevation, setCameraElevation] = useState(15);
  const [zoom, setZoom] = useState<ZoomLevel>(1);

  // Track lost state
  const [trackLost, setTrackLost] = useState(false);

  // Joystick refs for continuous panning
  const joystickActiveRef = useRef(false);
  const joystickDxRef = useRef(0);
  const joystickDyRef = useRef(0);

  // Effective FOV based on zoom
  const fovH = BASE_FOV_H / zoom;
  const fovV = BASE_FOV_V / zoom;

  // When a new track is slewed, enter auto-track mode
  useEffect(() => {
    if (track) {
      if (track.id !== prevTrackIdRef.current) {
        // New track slewed — acquire then auto-track
        setAcquiring(true);
        acquireStartRef.current = Date.now();
        setGimbalMode("auto-track");
        setTrackLost(false);
      }
      prevTrackIdRef.current = track.id;
    } else {
      // Track unslewed
      if (prevTrackIdRef.current !== null) {
        // Was tracking something — if joystick not active, go standby
        if (!joystickActiveRef.current) {
          setGimbalMode("standby");
        }
        setTrackLost(false);
      }
      prevTrackIdRef.current = null;
    }
  }, [track]);

  // Auto-track: continuously update gimbal to follow the tracked target
  useEffect(() => {
    if (!track || gimbalMode !== "auto-track") return;

    if (track.neutralized) {
      // Target destroyed — hold position, show TRACK LOST
      setTrackLost(true);
      return;
    }

    const trackBearing = calcBearing(track.x, track.y);
    const trackRange = calcRange(track.x, track.y);
    const trackElev = calcElevation(track.altitude_ft, trackRange);
    setCameraBearing(trackBearing);
    setCameraElevation(trackElev);
    setTrackLost(false);
  }, [track, track?.x, track?.y, track?.altitude_ft, track?.neutralized, gimbalMode]);

  // Auto-finish acquiring after 1.5s
  useEffect(() => {
    if (!acquiring) return;
    const timer = setTimeout(() => setAcquiring(false), 1500);
    return () => clearTimeout(timer);
  }, [acquiring]);

  // Continuous pan while joystick is held (MANUAL mode)
  useEffect(() => {
    let animFrame: number;
    const panSpeed = 2; // degrees per frame at full deflection

    const tick = () => {
      if (joystickActiveRef.current) {
        const dx = joystickDxRef.current;
        const dy = joystickDyRef.current;
        setCameraBearing((prev) => (prev + dx * panSpeed + 360) % 360);
        setCameraElevation((prev) => {
          const next = prev - dy * panSpeed;
          return Math.max(-45, Math.min(90, next));
        });
      }
      animFrame = requestAnimationFrame(tick);
    };
    animFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrame);
  }, []);

  const handleJoystickMove = useCallback((dx: number, dy: number) => {
    joystickActiveRef.current = true;
    joystickDxRef.current = dx;
    joystickDyRef.current = dy;
    // Switch to manual mode when joystick is used
    setGimbalMode("manual");
    setTrackLost(false);
  }, []);

  const handleJoystickRelease = useCallback(() => {
    joystickActiveRef.current = false;
    joystickDxRef.current = 0;
    joystickDyRef.current = 0;
    // Stay in manual mode — don't auto-revert
  }, []);

  // CENTER button: snap back to auto-track if we have a track
  const handleCenter = useCallback(() => {
    if (track && !track.neutralized) {
      setGimbalMode("auto-track");
      const trackBearing = calcBearing(track.x, track.y);
      const trackRange = calcRange(track.x, track.y);
      const trackElev = calcElevation(track.altitude_ft, trackRange);
      setCameraBearing(trackBearing);
      setCameraElevation(trackElev);
      setTrackLost(false);
    }
  }, [track]);

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    setZoom((prev) => {
      const idx = ZOOM_LEVELS.indexOf(prev);
      return idx < ZOOM_LEVELS.length - 1 ? ZOOM_LEVELS[idx + 1] : prev;
    });
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((prev) => {
      const idx = ZOOM_LEVELS.indexOf(prev);
      return idx > 0 ? ZOOM_LEVELS[idx - 1] : prev;
    });
  }, []);

  // Mouse wheel zoom on the canvas viewport
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      setZoom((prev) => {
        const idx = ZOOM_LEVELS.indexOf(prev);
        return idx < ZOOM_LEVELS.length - 1 ? ZOOM_LEVELS[idx + 1] : prev;
      });
    } else {
      setZoom((prev) => {
        const idx = ZOOM_LEVELS.indexOf(prev);
        return idx > 0 ? ZOOM_LEVELS[idx - 1] : prev;
      });
    }
  }, []);

  const hudColor = mode === "thermal" ? HUD_COLOR_THERMAL : HUD_COLOR_DAYLIGHT;

  // Find which track(s) are visible in the camera FOV
  const getVisibleTrack = useCallback((): { track: TrackData; pixelOffsetX: number; pixelOffsetY: number } | null => {
    const candidates = track && gimbalMode === "auto-track" && !trackLost
      ? [track]
      : allTracks.filter((t) => !t.neutralized);
    for (const t of candidates) {
      const tBearing = calcBearing(t.x, t.y);
      const tRange = calcRange(t.x, t.y);
      const tElev = calcElevation(t.altitude_ft, tRange);

      const dBearing = angleDiff(tBearing, cameraBearing);
      const dElev = angleDiff(tElev, cameraElevation);

      if (Math.abs(dBearing) <= fovH / 2 && Math.abs(dElev) <= fovV / 2) {
        const pixelOffsetX = (dBearing / (fovH / 2)) * (CANVAS_W / 2);
        const pixelOffsetY = -(dElev / (fovV / 2)) * (CANVAS_H / 2);
        return { track: t, pixelOffsetX, pixelOffsetY };
      }
    }
    return null;
  }, [track, allTracks, cameraBearing, cameraElevation, fovH, fovV, gimbalMode, trackLost]);

  // Camera only degraded if no EO/IR sensor equipped at all
  const isDegraded = useCallback(
    (): boolean => {
      const eoirSensors = sensorConfigs.filter(
        (s) => s.type === "eoir" && s.status === "active",
      );
      return eoirSensors.length === 0;
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
    const isStandby = gimbalMode === "standby";
    const showDegraded = degraded || isDegraded();

    if (showDegraded) {
      // No EO/IR sensor — heavy static
      drawNoise(ctx, w, h, 1.0, mode);
      drawNoise(ctx, w, h, 0.8, mode);
      drawReticle(ctx, w, h, hudColor);
    } else if (trackLost) {
      // Track lost — hold position, show scan lines + message
      drawScanLines(ctx, w, h, time);
      drawNoise(ctx, w, h, 0.4, mode);
      drawReticle(ctx, w, h, hudColor);

      const alpha = 0.6 + 0.3 * Math.sin(time * 3);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#f85149";
      ctx.font = "bold 16px monospace";
      ctx.textAlign = "center";
      ctx.fillText("TRACK LOST", w / 2, h / 2 - 5);
      ctx.globalAlpha = 1;
      ctx.fillStyle = hudColor;
      ctx.font = "10px monospace";
      ctx.fillText("HOLDING LAST POSITION", w / 2, h / 2 + 14);
    } else if (isStandby && !visibleTarget) {
      // Standby mode — no target in view
      drawScanLines(ctx, w, h, time);
      drawNoise(ctx, w, h, 0.3, mode);
      drawReticle(ctx, w, h, hudColor);

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
      const baseScale = silhouetteScale(rangeKm);
      const scale = baseScale * Math.sqrt(zoom); // Zoom magnifies the silhouette
      const amp = shakeAmplitude(rangeKm) * (1 + (zoom - 1) * 0.3); // More shake at higher zoom
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

      drawSilhouette(ctx, vt.classification, scale, mode, time);
      ctx.restore();

      drawNoise(ctx, w, h, noise, mode);
      drawReticle(ctx, w, h, hudColor);
    } else {
      // Manual/standby with no visible target — scan lines
      drawScanLines(ctx, w, h, time);
      drawNoise(ctx, w, h, 0.3, mode);
      drawReticle(ctx, w, h, hudColor);
    }

    rafRef.current = requestAnimationFrame(draw);
  }, [track, mode, acquiring, hudColor, degraded, getVisibleTrack, isDegraded, gimbalMode, trackLost, zoom]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  const visibleTarget = getVisibleTrack();
  const displayTrackId = track?.id ?? visibleTarget?.track?.id ?? null;

  // Gimbal mode color and label
  const gimbalModeLabel = trackLost ? "TRACK LOST" : gimbalMode === "auto-track" ? "AUTO-TRACK" : gimbalMode === "manual" ? "MANUAL" : "STANDBY";
  const gimbalModeColor = trackLost ? "#f85149" : gimbalMode === "auto-track" ? "#3fb950" : gimbalMode === "manual" ? "#d29922" : "#8b949e";

  // Target data for HUD (only in auto-track with a live track)
  const tgtRange = track && gimbalMode === "auto-track" && !trackLost
    ? calcRange(track.x, track.y) : null;
  const tgtBearing = track && gimbalMode === "auto-track" && !trackLost
    ? calcBearing(track.x, track.y) : null;

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
          EO/IR — {displayTrackId ? displayTrackId.toUpperCase() : "NO TARGET"}
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
        onWheel={handleWheel}
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
        {(degraded || isDegraded()) && (
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
              NO EO/IR SENSOR
            </div>
            <div
              style={{
                fontFamily: "monospace",
                fontSize: 9,
                color: "#d29922",
                letterSpacing: 0.5,
              }}
            >
              CAMERA OFFLINE
            </div>
          </div>
        )}

        {/* HUD Overlay — Top-left: Gimbal mode */}
        <span
          style={{
            position: "absolute",
            top: 6,
            left: 8,
            fontFamily: "monospace",
            fontSize: 10,
            fontWeight: 700,
            color: gimbalModeColor,
            textShadow: `0 0 6px ${gimbalModeColor}80`,
            pointerEvents: "none",
            letterSpacing: 1,
          }}
        >
          {gimbalModeLabel}
        </span>

        {/* HUD Overlay — Top-right: Zoom level */}
        <span
          style={{
            position: "absolute",
            top: 6,
            right: 8,
            fontFamily: "monospace",
            fontSize: 10,
            fontWeight: 700,
            color: hudColor,
            textShadow: `0 0 4px ${hudColor}80`,
            pointerEvents: "none",
          }}
        >
          {zoom}x
        </span>

        {/* HUD Overlay — Bottom-left: PAN / TILT */}
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
          PAN: {cameraBearing.toFixed(1).padStart(5, " ")}&deg; | TILT: {cameraElevation >= 0 ? "+" : ""}{cameraElevation.toFixed(1)}&deg;
        </span>

        {/* HUD Overlay — Bottom-right: Target data (auto-track only) */}
        {tgtRange !== null && tgtBearing !== null && (
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
            TGT RNG: {tgtRange.toFixed(2)} km | TGT BRG: {String(Math.round(tgtBearing)).padStart(3, "0")}&deg;
          </span>
        )}

        {/* HUD Overlay — Top-center: speed/heading when target visible */}
        {visibleTarget && !acquiring && (
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
        )}

        {/* HUD Overlay — Bottom-center: Slewed track ID or NO TARGET */}
        <span
          style={{
            position: "absolute",
            bottom: 18,
            left: "50%",
            transform: "translateX(-50%)",
            fontFamily: "monospace",
            fontSize: 8,
            color: hudColor + "aa",
            pointerEvents: "none",
            letterSpacing: 0.5,
          }}
        >
          {displayTrackId ? displayTrackId.toUpperCase() : "NO TARGET"} | {mode === "thermal" ? "IR" : "VIS"} | FOV {fovH.toFixed(0)}&deg;
        </span>

        {/* Controls: Joystick + CENTER + Zoom */}
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
          {/* Zoom buttons */}
          <div style={{ display: "flex", gap: 3 }}>
            <button
              onClick={handleZoomOut}
              style={{
                background: "rgba(30,35,42,0.8)",
                border: `1px solid ${hudColor}44`,
                color: hudColor,
                cursor: "pointer",
                fontFamily: "monospace",
                fontSize: 11,
                fontWeight: 700,
                padding: "1px 7px",
                borderRadius: 3,
                lineHeight: "16px",
              }}
            >
              -
            </button>
            <span
              style={{
                fontFamily: "monospace",
                fontSize: 9,
                color: hudColor,
                alignSelf: "center",
                minWidth: 20,
                textAlign: "center",
              }}
            >
              {zoom}x
            </span>
            <button
              onClick={handleZoomIn}
              style={{
                background: "rgba(30,35,42,0.8)",
                border: `1px solid ${hudColor}44`,
                color: hudColor,
                cursor: "pointer",
                fontFamily: "monospace",
                fontSize: 11,
                fontWeight: 700,
                padding: "1px 7px",
                borderRadius: 3,
                lineHeight: "16px",
              }}
            >
              +
            </button>
          </div>
          {/* CENTER button — returns to auto-track */}
          {gimbalMode === "manual" && track && !track.neutralized && (
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
  _bearingOffset: number,
  _elevationOffset: number,
  slewedTrack: TrackData | null,
): boolean {
  const effBearing = slewedTrack
    ? calcBearing(slewedTrack.x, slewedTrack.y)
    : cameraBearing;
  const effElev = slewedTrack
    ? calcElevation(slewedTrack.altitude_ft, calcRange(slewedTrack.x, slewedTrack.y))
    : cameraElevation;

  const tBearing = calcBearing(t.x, t.y);
  const tRange = calcRange(t.x, t.y);
  const tElev = calcElevation(t.altitude_ft, tRange);
  const dBearing = angleDiff(tBearing, effBearing);
  const dElev = angleDiff(tElev, effElev);
  return Math.abs(dBearing) <= BASE_FOV_H / 2 && Math.abs(dElev) <= BASE_FOV_V / 2;
}
