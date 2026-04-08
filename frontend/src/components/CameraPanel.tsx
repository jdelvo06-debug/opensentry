import { useRef, useEffect, useCallback, useState } from "react";
import type { TrackData, SensorStatus } from "../types";

interface Props {
  track: TrackData | null;
  allTracks: TrackData[];
  sensorConfigs: SensorStatus[];
  degraded?: boolean;
}

const CANVAS_W = 640;
const CANVAS_H = 400;
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

/**
 * Compute the aspect angle: the angle between the camera→drone bearing and the
 * drone's own heading.  Returns 0-180 where 0 = head-on, 90 = broadside, 180 = tail-on.
 * Also returns a signed visual rotation angle (-180..180) for orienting the silhouette
 * on the canvas (positive = drone crossing left-to-right from camera's POV).
 */
function calcAspectAngle(
  droneX: number,
  droneY: number,
  headingDeg: number,
): { aspect: number; visualRotationDeg: number } {
  const bearingToDrone = calcBearing(droneX, droneY); // bearing from base/camera to drone
  // Signed difference: how far the drone heading deviates from the bearing *toward* the camera
  // If the drone is flying straight at the camera, heading ≈ bearingToDrone + 180
  const inboundBearing = (bearingToDrone + 180) % 360;
  const signed = angleDiff(headingDeg, inboundBearing); // [-180, 180]
  const aspect = Math.abs(signed); // 0 = head-on, 180 = tail-on
  return { aspect, visualRotationDeg: signed };
}

/**
 * Compute horizontal scale compression based on aspect angle.
 * Head-on / tail-on views compress the silhouette laterally;
 * broadside views show full width.
 */
function aspectScaleX(aspect: number): number {
  // 0° (head-on) → 0.35, 90° (broadside) → 1.0, 180° (tail-on) → 0.35
  const t = Math.abs(aspect - 90) / 90; // 0 at broadside, 1 at head/tail
  return 1 - t * 0.65;
}

// ---------------------------------------------------------------------------
// Silhouette drawing helpers — all accept `time` (seconds) for animation
// ---------------------------------------------------------------------------

function drawCommercialQuad(ctx: CanvasRenderingContext2D, s: number, time: number) {
  // DJI Phantom style: bulky rectangular body, fixed X-arms, landing gear, center gimbal
  const wobbleY = Math.sin(time * 2.8) * 1.2 * s;
  const wobbleRot = Math.sin(time * 1.9) * 0.025;
  ctx.save();
  ctx.translate(0, wobbleY);
  ctx.rotate(wobbleRot);

  const bodyW = 32 * s;   // wider than tall — bulky rectangular body
  const bodyH = 20 * s;
  const armLen = 34 * s;
  const rotorR = 16 * s;
  const rotorSpeed = 22;

  // ── 4 fixed diagonal arms (X-configuration, straight out from corners) ──
  const armAngle = Math.PI / 4; // 45° diagonals
  const arms = [
    { ax: -armAngle, label: "FL" },           // front-left
    { ax: armAngle, label: "FR" },            // front-right
    { ax: Math.PI - armAngle, label: "RL" },  // rear-left
    { ax: -(Math.PI - armAngle), label: "RR" }, // rear-right
  ].map(a => ({
    sx: Math.cos(a.ax) * bodyW * 0.35,
    sy: Math.sin(a.ax) * bodyH * 0.35,
    ex: Math.cos(a.ax) * armLen,
    ey: Math.sin(a.ax) * armLen,
  }));

  ctx.lineWidth = Math.max(2, 3 * s);
  arms.forEach(arm => {
    ctx.beginPath();
    ctx.moveTo(arm.sx, arm.sy);
    ctx.lineTo(arm.ex, arm.ey);
    ctx.stroke();
  });

  // ── Large bulky rectangular/rounded body ──
  const br = 6 * s; // corner radius — chunky Phantom housing
  ctx.beginPath();
  ctx.moveTo(-bodyW / 2 + br, -bodyH / 2);
  ctx.lineTo(bodyW / 2 - br, -bodyH / 2);
  ctx.quadraticCurveTo(bodyW / 2, -bodyH / 2, bodyW / 2, -bodyH / 2 + br);
  ctx.lineTo(bodyW / 2, bodyH / 2 - br);
  ctx.quadraticCurveTo(bodyW / 2, bodyH / 2, bodyW / 2 - br, bodyH / 2);
  ctx.lineTo(-bodyW / 2 + br, bodyH / 2);
  ctx.quadraticCurveTo(-bodyW / 2, bodyH / 2, -bodyW / 2, bodyH / 2 - br);
  ctx.lineTo(-bodyW / 2, -bodyH / 2 + br);
  ctx.quadraticCurveTo(-bodyW / 2, -bodyH / 2, -bodyW / 2 + br, -bodyH / 2);
  ctx.closePath();
  ctx.fill();

  // Body highlight (top ridge)
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.beginPath();
  ctx.ellipse(0, -bodyH * 0.15, bodyW * 0.4, bodyH * 0.22, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.restore();

  // ── 4 landing gear legs splayed in 4 distinct directions (top-down view) ──
  ctx.lineWidth = Math.max(1.5, 2 * s);
  const legs = [
    // Front-left: attach at front-left of body, splay forward-left
    { bx: -bodyW * 0.4, by: -bodyH / 2, ex: -bodyW * 0.65, ey: -bodyH / 2 - 14 * s },
    // Front-right: attach at front-right, splay forward-right
    { bx: bodyW * 0.4, by: -bodyH / 2, ex: bodyW * 0.65, ey: -bodyH / 2 - 14 * s },
    // Rear-left: attach at rear-left, splay backward-left
    { bx: -bodyW * 0.4, by: bodyH / 2, ex: -bodyW * 0.65, ey: bodyH / 2 + 20 * s },
    // Rear-right: attach at rear-right, splay backward-right
    { bx: bodyW * 0.4, by: bodyH / 2, ex: bodyW * 0.65, ey: bodyH / 2 + 20 * s },
  ];
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(legs[i].bx, legs[i].by);
    ctx.lineTo(legs[i].ex, legs[i].ey);
    ctx.stroke();
    // Foot bar
    ctx.beginPath();
    ctx.moveTo(legs[i].ex - 3 * s, legs[i].ey);
    ctx.lineTo(legs[i].ex + 3 * s, legs[i].ey);
    ctx.stroke();
  }

  // ── Gimbal camera pod hanging under CENTER of body ──
  ctx.lineWidth = Math.max(1, 1.5 * s);
  ctx.beginPath();
  ctx.moveTo(0, bodyH / 2);
  ctx.lineTo(0, bodyH / 2 + 5 * s);
  ctx.stroke();
  // Gimbal housing (sphere)
  ctx.beginPath();
  ctx.arc(0, bodyH / 2 + 8 * s, 5 * s, 0, Math.PI * 2);
  ctx.fill();
  // Lens glint
  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = "#58a6ff";
  ctx.beginPath();
  ctx.arc(1 * s, bodyH / 2 + 7.5 * s, 2 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // ── Motor hubs + spinning rotor discs at arm tips ──
  arms.forEach((arm, i) => {
    // Motor hub
    ctx.beginPath();
    ctx.arc(arm.ex, arm.ey, 4.5 * s, 0, Math.PI * 2);
    ctx.fill();

    // Rotor disc blur (spinning effect)
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    ctx.arc(arm.ex, arm.ey, rotorR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 2-blade prop spinning
    const phase = time * rotorSpeed + i * (Math.PI / 2);
    ctx.lineWidth = Math.max(1.5, 2.5 * s);
    ctx.save();
    ctx.globalAlpha = 0.7;
    for (let b = 0; b < 2; b++) {
      const angle = phase + b * Math.PI;
      ctx.beginPath();
      ctx.moveTo(arm.ex + Math.cos(angle) * rotorR, arm.ey + Math.sin(angle) * rotorR);
      ctx.lineTo(arm.ex - Math.cos(angle) * rotorR, arm.ey - Math.sin(angle) * rotorR);
      ctx.stroke();
    }
    ctx.restore();
  });

  ctx.restore();
}

function drawFixedWing(ctx: CanvasRenderingContext2D, s: number, time: number) {
  // Penguin/VTOL fixed wing: high-span straight wing, slender fuselage, pusher prop, sensor nose
  const bankAngle = Math.sin(time * 1.5) * 0.06;
  ctx.save();
  ctx.rotate(bankAngle);

  const fuseL = 44 * s;
  const fuseW = 4.5 * s;
  const wingSpan = 42 * s; // high aspect ratio — very long span

  // ── Slender cylindrical fuselage ──
  ctx.beginPath();
  ctx.ellipse(0, 0, fuseL / 2, fuseW / 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── Sensor/camera ball on nose ──
  ctx.beginPath();
  ctx.arc(fuseL / 2 + 3 * s, 0, 3.5 * s, 0, Math.PI * 2);
  ctx.fill();
  // Lens glint
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = "#58a6ff";
  ctx.beginPath();
  ctx.arc(fuseL / 2 + 4 * s, -0.5 * s, 1.5 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // ── High aspect ratio straight wings (very long span, narrow chord) ──
  const wingChord = 8 * s;
  const wingX = 2 * s; // slightly forward of center
  // Left wing
  ctx.beginPath();
  ctx.moveTo(wingX + wingChord / 2, -fuseW / 2);
  ctx.lineTo(wingX + wingChord / 2, -wingSpan);
  ctx.lineTo(wingX - wingChord / 2, -wingSpan);
  ctx.lineTo(wingX - wingChord / 2, -fuseW / 2);
  ctx.closePath();
  ctx.fill();
  // Rounded wingtip left
  ctx.beginPath();
  ctx.ellipse(wingX, -wingSpan, wingChord / 2, 2 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // Right wing
  ctx.beginPath();
  ctx.moveTo(wingX + wingChord / 2, fuseW / 2);
  ctx.lineTo(wingX + wingChord / 2, wingSpan);
  ctx.lineTo(wingX - wingChord / 2, wingSpan);
  ctx.lineTo(wingX - wingChord / 2, fuseW / 2);
  ctx.closePath();
  ctx.fill();
  // Rounded wingtip right
  ctx.beginPath();
  ctx.ellipse(wingX, wingSpan, wingChord / 2, 2 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── Inverted V-tail (twin boom style) ──
  const tailX = -fuseL / 2;
  // Left V-tail fin (angled inward-down = inverted V)
  ctx.beginPath();
  ctx.moveTo(tailX, 0);
  ctx.lineTo(tailX - 8 * s, -10 * s);
  ctx.lineTo(tailX - 6 * s, -10 * s);
  ctx.lineTo(tailX + 2 * s, 0);
  ctx.closePath();
  ctx.fill();
  // Right V-tail fin
  ctx.beginPath();
  ctx.moveTo(tailX, 0);
  ctx.lineTo(tailX - 8 * s, 10 * s);
  ctx.lineTo(tailX - 6 * s, 10 * s);
  ctx.lineTo(tailX + 2 * s, 0);
  ctx.closePath();
  ctx.fill();

  // ── Pusher prop at tail (rear-facing) ──
  const propR = 7 * s;
  const propPhase = time * 22;
  const px = tailX - 3 * s;
  ctx.lineWidth = Math.max(1, 2 * s);
  ctx.save();
  ctx.globalAlpha = 0.7;
  for (let b = 0; b < 3; b++) {
    const ba = propPhase + b * (Math.PI * 2 / 3);
    ctx.beginPath();
    ctx.moveTo(px + Math.cos(ba) * propR, Math.sin(ba) * propR);
    ctx.lineTo(px - Math.cos(ba) * propR, -Math.sin(ba) * propR);
    ctx.stroke();
  }
  ctx.restore();
  // Prop disc blur
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.beginPath();
  ctx.arc(px, 0, propR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

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
  // Weather/surveillance balloon: large sphere, long tether, dangling payload stack
  const swayX = Math.sin(time * 0.8) * 3 * s;
  const swayRot = Math.sin(time * 0.6) * 0.03;
  ctx.save();
  ctx.translate(swayX, 0);
  ctx.rotate(swayRot);

  const sphereR = 26 * s; // dominant feature — large perfect sphere
  const sphereY = -22 * s; // sphere center (top of frame)

  // ── Large perfect sphere ──
  ctx.beginPath();
  ctx.arc(0, sphereY, sphereR, 0, Math.PI * 2);
  ctx.fill();

  // Sphere highlight (specular)
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.beginPath();
  ctx.arc(-8 * s, sphereY - 8 * s, sphereR * 0.4, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.restore();

  // Neck/valve at bottom of sphere
  const neckY = sphereY + sphereR;
  ctx.beginPath();
  ctx.moveTo(-4 * s, neckY - 2 * s);
  ctx.lineTo(-3 * s, neckY + 4 * s);
  ctx.lineTo(3 * s, neckY + 4 * s);
  ctx.lineTo(4 * s, neckY - 2 * s);
  ctx.closePath();
  ctx.fill();

  // ── Long thin tether line ──
  const tetherSway = Math.sin(time * 1.2 + 1) * 2.5 * s;
  const tetherTop = neckY + 4 * s;
  const tetherEnd = tetherTop + 60 * s; // very tall aspect ratio
  ctx.lineWidth = Math.max(1, 1 * s);
  ctx.beginPath();
  ctx.moveTo(0, tetherTop);
  ctx.quadraticCurveTo(tetherSway, tetherTop + 30 * s, 0, tetherEnd);
  ctx.stroke();

  // ── Payload module 1: small instrument package just below sphere ──
  const pkg1Y = tetherTop + 14 * s;
  ctx.fillRect(-5 * s, pkg1Y - 3 * s, 10 * s, 6 * s);
  // Antenna on instrument package
  ctx.lineWidth = Math.max(1, 0.8 * s);
  ctx.beginPath();
  ctx.moveTo(0, pkg1Y - 3 * s);
  ctx.lineTo(0, pkg1Y - 7 * s);
  ctx.moveTo(-3 * s, pkg1Y - 7 * s);
  ctx.lineTo(3 * s, pkg1Y - 7 * s);
  ctx.stroke();

  // ── Payload module 2: larger box/crate further down ──
  const pkg2Y = tetherTop + 42 * s;
  ctx.fillRect(-8 * s, pkg2Y - 5 * s, 16 * s, 10 * s);
  // Cross strapping detail on crate
  ctx.lineWidth = Math.max(1, 0.7 * s);
  ctx.beginPath();
  ctx.moveTo(-8 * s, pkg2Y - 5 * s);
  ctx.lineTo(8 * s, pkg2Y + 5 * s);
  ctx.moveTo(8 * s, pkg2Y - 5 * s);
  ctx.lineTo(-8 * s, pkg2Y + 5 * s);
  ctx.stroke();

  ctx.restore();
}

function drawShahed(ctx: CanvasRenderingContext2D, s: number, _time: number) {
  // Shahed-136: near-equilateral triangle delta wing, bullet nose, pusher prop at tail center
  // Very flat — mostly wing, minimal fuselage

  const wingSpan = 40 * s;  // half-span
  const chordLen = 36 * s;  // nose to trailing edge

  // ── Near-equilateral triangle delta wing (wide flat triangle) ──
  ctx.beginPath();
  ctx.moveTo(chordLen / 2, 0);              // bullet nose tip (extends forward)
  ctx.lineTo(-chordLen / 2, -wingSpan);     // left wingtip trailing edge
  ctx.lineTo(-chordLen / 2, wingSpan);      // right wingtip trailing edge
  ctx.closePath();
  ctx.fill();

  // ── Bullet-shaped nose cone extending forward from leading edge ──
  ctx.beginPath();
  ctx.ellipse(chordLen / 2 + 5 * s, 0, 7 * s, 3.5 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  // Nose tip
  ctx.beginPath();
  ctx.moveTo(chordLen / 2 + 10 * s, 0);
  ctx.lineTo(chordLen / 2 + 3 * s, -2.5 * s);
  ctx.lineTo(chordLen / 2 + 3 * s, 2.5 * s);
  ctx.closePath();
  ctx.fill();

  // ── Subtle fuselage spine (minimal — mostly wing) ──
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.beginPath();
  ctx.ellipse(0, 0, chordLen * 0.35, 3.5 * s, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.restore();

  // ── Small rectangular wingtip stabilizers/fins at each tip ──
  const tipFinW = 6 * s;
  const tipFinH = 3 * s;
  // Left wingtip fin
  ctx.fillRect(-chordLen / 2 - tipFinW, -wingSpan - tipFinH / 2, tipFinW, tipFinH);
  // Right wingtip fin
  ctx.fillRect(-chordLen / 2 - tipFinW, wingSpan - tipFinH / 2, tipFinW, tipFinH);

  // ── Pusher prop at tail center ──
  const propX = -chordLen / 2 - 2 * s;
  const propR = 5 * s;
  // Prop disc
  ctx.lineWidth = Math.max(1, 1.5 * s);
  ctx.beginPath();
  ctx.arc(propX, 0, propR, 0, Math.PI * 2);
  ctx.stroke();
  // Prop hub
  ctx.beginPath();
  ctx.arc(propX, 0, 2 * s, 0, Math.PI * 2);
  ctx.fill();
}

function drawImprovised(ctx: CanvasRenderingContext2D, s: number, time: number) {
  // FPV racing/attack drone: exposed X-frame, no shell, front camera, box cam on top
  const wobble = Math.sin(time * 4.5) * 0.06;
  const drift = Math.sin(time * 2.3) * 1.5 * s;
  ctx.save();
  ctx.translate(drift, 0);
  ctx.rotate(wobble);

  const armLen = 26 * s;
  const propR = 11 * s;

  // ── Exposed carbon fiber X-frame (thin arm tubes) ──
  const stackW = 11 * s;
  const stackH = 13 * s;
  const armAngles = [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4];
  const armEnds = armAngles.map(a => ({
    x: Math.cos(a) * armLen,
    y: Math.sin(a) * armLen,
  }));
  ctx.lineWidth = Math.max(1.5, 2 * s);
  armEnds.forEach((end, i) => {
    // Start each arm at the edge of the center stack, not from (0,0)
    const angle = armAngles[i];
    const startDist = Math.abs(Math.cos(angle)) > Math.abs(Math.sin(angle))
      ? stackW / 2 / Math.abs(Math.cos(angle))
      : stackH / 2 / Math.abs(Math.sin(angle));
    const sx = Math.cos(angle) * startDist;
    const sy = Math.sin(angle) * startDist;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  });

  // ── Compact aggressive squarish center stack (FC, ESC, battery) ──
  ctx.fillRect(-stackW / 2, -stackH / 2, stackW, stackH);

  // Battery pack on bottom (slightly wider)
  ctx.fillRect(-stackW * 0.65, stackH * 0.1, stackW * 1.3, 4 * s);

  // ── Front-facing FPV camera at ~35° angle on front center of frame ──
  ctx.save();
  ctx.translate(0, -stackH / 2 - 1 * s);
  ctx.rotate(-0.6); // ~35° tilt up
  ctx.fillRect(-2 * s, -2.5 * s, 4 * s, 5 * s);
  // Lens
  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = "#ff6666";
  ctx.beginPath();
  ctx.arc(0, -1.5 * s, 1.5 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.restore();

  // ── Action camera (GoPro style box) mounted on top — prominent ──
  const camW = 8 * s;
  const camH = 6 * s;
  ctx.fillRect(-camW / 2, -stackH / 2 - camH - 1 * s, camW, camH);
  // Camera lens (front face)
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = "#58a6ff";
  ctx.beginPath();
  ctx.arc(0, -stackH / 2 - camH / 2 - 1 * s, 2.5 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // ── 4 colored props (actual blade shapes, NOT just discs) ──
  ctx.lineWidth = Math.max(1.5, 2 * s);
  for (let i = 0; i < armEnds.length; i++) {
    const { x: ex, y: ey } = armEnds[i];
    const phase = time * (18 + i * 3) + i * 1.8; // slightly uneven speeds

    // Draw 3 visible blades (tri-blade props typical on FPV)
    ctx.save();
    ctx.globalAlpha = 0.7;
    for (let b = 0; b < 3; b++) {
      const ba = phase + b * (Math.PI * 2 / 3);
      const tipX = ex + Math.cos(ba) * propR;
      const tipY = ey + Math.sin(ba) * propR;
      // Blade shape — tapered: wide at hub, narrow at tip
      const perpAngle = ba + Math.PI / 2;
      const hubW = 2 * s;
      const tipW = 0.8 * s;
      ctx.beginPath();
      ctx.moveTo(ex + Math.cos(perpAngle) * hubW, ey + Math.sin(perpAngle) * hubW);
      ctx.lineTo(tipX + Math.cos(perpAngle) * tipW, tipY + Math.sin(perpAngle) * tipW);
      ctx.lineTo(tipX - Math.cos(perpAngle) * tipW, tipY - Math.sin(perpAngle) * tipW);
      ctx.lineTo(ex - Math.cos(perpAngle) * hubW, ey - Math.sin(perpAngle) * hubW);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // Motor hub dot
    ctx.beginPath();
    ctx.arc(ex, ey, 2 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawJackal(ctx: CanvasRenderingContext2D, s: number, time: number) {
  // Interceptor missile silhouette — matte black tactical missile
  // Reference: compact 8-10:1 body, pointed conical nose, small canards, 4 symmetric tail fins
  const isThermal = (ctx.fillStyle as string).includes("230,230,230");

  // Thermal: bright hot body with glowing exhaust; EO: matte black
  const bodyColor   = isThermal ? "rgba(255,240,180,0.97)" : "rgba(18,18,18,0.97)";
  const finColor    = isThermal ? "rgba(240,220,140,0.85)" : "rgba(30,30,30,0.95)";
  const noseColor   = isThermal ? "rgba(255,255,200,1.0)"  : "rgba(12,12,12,1.0)";
  const exhaustCol  = isThermal ? "rgba(255,180,60,0.95)"  : "rgba(140,160,255,0.75)";
  const highlightCol = isThermal ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.07)";

  // --- Rocket exhaust plume (aft/bottom) ---
  const plumeLen = (14 + 5 * Math.sin(time * 18)) * s;
  const plumeGrad = ctx.createLinearGradient(0, 12 * s, 0, 12 * s + plumeLen);
  plumeGrad.addColorStop(0,   exhaustCol);
  plumeGrad.addColorStop(0.45, isThermal ? "rgba(255,120,20,0.35)" : "rgba(80,100,255,0.25)");
  plumeGrad.addColorStop(1,   "rgba(0,0,0,0)");
  ctx.fillStyle = plumeGrad;
  ctx.beginPath();
  ctx.ellipse(0, 12 * s + plumeLen * 0.45, 2 * s, plumeLen * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();

  // --- Tail fins (4 symmetric — two visible planes, X config) ---
  ctx.fillStyle = finColor;
  // Horizontal plane fins
  ctx.beginPath();
  ctx.moveTo(-2.5 * s,  8 * s);
  ctx.lineTo(-9  * s, 13 * s);
  ctx.lineTo(-2.5 * s, 12 * s);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo( 2.5 * s,  8 * s);
  ctx.lineTo( 9  * s, 13 * s);
  ctx.lineTo( 2.5 * s, 12 * s);
  ctx.closePath();
  ctx.fill();
  // Vertical plane fins (slightly smaller — foreshortened aspect)
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.moveTo(-1.5 * s,  8 * s);
  ctx.lineTo(-6  * s, 13 * s);
  ctx.lineTo(-1.5 * s, 12 * s);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo( 1.5 * s,  8 * s);
  ctx.lineTo( 6  * s, 13 * s);
  ctx.lineTo( 1.5 * s, 12 * s);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1.0;

  // --- Main body — long slim cylinder ---
  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.roundRect(-2.5 * s, -11 * s, 5 * s, 23 * s, 1.5 * s);
  ctx.fill();

  // Subtle highlight stripe (gives the cylinder a 3D rounded look)
  ctx.fillStyle = highlightCol;
  ctx.beginPath();
  ctx.roundRect(-1 * s, -10 * s, 1.5 * s, 20 * s, 0.75 * s);
  ctx.fill();

  // --- Conical nosecone ---
  ctx.fillStyle = noseColor;
  ctx.beginPath();
  ctx.moveTo(-2.5 * s, -11 * s);
  ctx.lineTo(0,        -22 * s);
  ctx.lineTo( 2.5 * s, -11 * s);
  ctx.closePath();
  ctx.fill();

  // --- Small canard fins near nose ---
  ctx.fillStyle = finColor;
  ctx.beginPath();
  ctx.moveTo(-2.5 * s, -7 * s);
  ctx.lineTo(-7  * s, -3 * s);
  ctx.lineTo(-2.5 * s, -4.5 * s);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo( 2.5 * s, -7 * s);
  ctx.lineTo( 7  * s, -3 * s);
  ctx.lineTo( 2.5 * s, -4.5 * s);
  ctx.closePath();
  ctx.fill();
}

function drawUnknownBlob(ctx: CanvasRenderingContext2D, s: number, time: number) {
  // Ambiguous heat smear — looks like a real unresolved thermal contact, not a placeholder
  const pulse = 1 + Math.sin(time * 2.1) * 0.06;
  const wobble = Math.sin(time * 1.7) * 0.08;

  // Outer diffuse glow (heat bloom)
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 28 * s * pulse);
  const isThermal = ctx.fillStyle === "rgba(230,230,230,0.9)" || (ctx.fillStyle as string).includes("230");
  if (isThermal) {
    glow.addColorStop(0, "rgba(255,255,240,0.55)");
    glow.addColorStop(0.4, "rgba(220,220,200,0.25)");
    glow.addColorStop(1, "rgba(180,180,160,0)");
  } else {
    glow.addColorStop(0, "rgba(20,25,30,0.7)");
    glow.addColorStop(0.4, "rgba(30,40,50,0.35)");
    glow.addColorStop(1, "rgba(40,50,60,0)");
  }
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.ellipse(0, 0, 28 * s * pulse, 20 * s * pulse, wobble, 0, Math.PI * 2);
  ctx.fill();

  // Inner hot core — irregular, not a perfect ellipse
  ctx.save();
  ctx.rotate(wobble * 0.5);
  const core = ctx.createRadialGradient(0, -2 * s, 0, 0, 0, 10 * s * pulse);
  if (isThermal) {
    core.addColorStop(0, "rgba(255,255,255,0.95)");
    core.addColorStop(0.5, "rgba(240,240,220,0.7)");
    core.addColorStop(1, "rgba(200,200,180,0)");
  } else {
    core.addColorStop(0, "rgba(15,18,22,0.95)");
    core.addColorStop(0.5, "rgba(25,30,38,0.7)");
    core.addColorStop(1, "rgba(35,42,50,0)");
  }
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.ellipse(0, 0, 10 * s * pulse, 7 * s * pulse, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawExplosion(ctx: CanvasRenderingContext2D, w: number, h: number, elapsed: number) {
  const cx = w / 2;
  const cy = h / 2;

  if (elapsed < 0.1) {
    // White flash (0-100ms)
    const alpha = 1 - elapsed / 0.1;
    ctx.fillStyle = `rgba(255,255,255,${alpha * 0.9})`;
    ctx.fillRect(0, 0, w, h);
    const r = 30 + elapsed * 600;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,240,${alpha})`;
    ctx.fill();
  } else if (elapsed < 0.4) {
    // Orange fireball (100-400ms)
    const t = (elapsed - 0.1) / 0.3;
    const r = 40 + t * 30;
    const alpha = 1 - t * 0.6;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, `rgba(255,200,50,${alpha})`);
    grad.addColorStop(0.4, `rgba(255,120,20,${alpha * 0.8})`);
    grad.addColorStop(1, `rgba(200,60,10,0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  } else if (elapsed < 0.9) {
    // Smoke/debris (400-900ms)
    const t = (elapsed - 0.4) / 0.5;
    const alpha = 0.4 * (1 - t);
    // Smoke puffs
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + t * 0.5;
      const dist = 20 + t * 50;
      const px = cx + Math.cos(angle) * dist;
      const py = cy + Math.sin(angle) * dist - t * 30; // drift upward
      const sr = 8 + t * 12;
      const grad = ctx.createRadialGradient(px, py, 0, px, py, sr);
      grad.addColorStop(0, `rgba(180,160,140,${alpha})`);
      grad.addColorStop(1, `rgba(100,90,80,0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px, py, sr, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawApproachingJackal(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  offsetX: number,
  offsetY: number,
  mode: CameraMode,
  time: number,
) {
  // Bright fast-moving dot approaching center from the edge
  const cx = w / 2 + offsetX;
  const cy = h / 2 + offsetY;
  const pulse = 0.7 + 0.3 * Math.sin(time * 20);
  const dotColor = mode === "thermal" ? `rgba(255,255,240,${pulse})` : `rgba(200,220,255,${pulse})`;
  ctx.fillStyle = dotColor;
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fill();
  // Glow
  ctx.fillStyle = mode === "thermal" ? `rgba(255,240,200,${pulse * 0.3})` : `rgba(150,180,255,${pulse * 0.3})`;
  ctx.beginPath();
  ctx.arc(cx, cy, 8, 0, Math.PI * 2);
  ctx.fill();
}

function drawSilhouette(
  ctx: CanvasRenderingContext2D,
  classification: string | null,
  scale: number,
  mode: CameraMode,
  time: number,
  aspect?: { aspect: number; visualRotationDeg: number },
) {
  // Civilian aircraft: light grey in daylight to distinguish from military
  const isCivilian = classification === "passenger_aircraft";
  if (mode === "thermal") {
    ctx.fillStyle = "rgba(230,230,230,0.9)";
    ctx.strokeStyle = "rgba(230,230,230,0.9)";
  } else if (isCivilian) {
    ctx.fillStyle = "rgba(200,210,220,0.85)";
    ctx.strokeStyle = "rgba(200,210,220,0.85)";
  } else {
    ctx.fillStyle = "rgba(40,50,60,0.85)";
    ctx.strokeStyle = "rgba(40,50,60,0.85)";
  }
  ctx.lineWidth = Math.max(1, 1.5 * scale);

  // Apply aspect-angle orientation: rotate silhouette and compress horizontally
  // for head-on / tail-on views. Birds, balloons, and unknowns are exempt
  // (symmetrical or irrelevant).
  const orientable = classification != null && ![
    "bird", "weather_balloon",
  ].includes(classification);

  if (aspect && orientable) {
    const rotRad = (aspect.visualRotationDeg * Math.PI) / 180;
    const sx = aspectScaleX(aspect.aspect);
    ctx.save();
    ctx.rotate(rotRad);
    ctx.scale(sx, 1);
  }

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
    case "improvised_hardened":
      drawImprovised(ctx, scale, time);
      break;
    case "shahed":
    case "loitering_munition":
    case "one_way_attack":
      drawShahed(ctx, scale, time);
      break;
    case "jackal":
    case "interceptor":
      drawJackal(ctx, scale, time);
      break;
    default:
      drawUnknownBlob(ctx, scale, time);
      break;
  }

  if (aspect && orientable) {
    ctx.restore();
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

// Noise cache: pre-rendered offscreen canvases, regenerated every ~200ms
const noiseCache: {
  thermal: OffscreenCanvas | null;
  daylight: OffscreenCanvas | null;
  density: number;
  timestamp: number;
  w: number;
  h: number;
} = { thermal: null, daylight: null, density: -1, timestamp: 0, w: 0, h: 0 };

function drawNoise(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  density: number,
  mode: CameraMode,
) {
  const now = Date.now();
  const densityBucket = Math.round(density * 10) / 10; // quantize to avoid thrashing
  const needsRegen =
    noiseCache.w !== w ||
    noiseCache.h !== h ||
    noiseCache.density !== densityBucket ||
    now - noiseCache.timestamp > 200;

  if (needsRegen) {
    // Regenerate both thermal and daylight noise canvases
    for (const m of ["thermal", "daylight"] as const) {
      let offscreen = noiseCache[m];
      if (!offscreen || offscreen.width !== w || offscreen.height !== h) {
        offscreen = new OffscreenCanvas(w, h);
        noiseCache[m] = offscreen;
      }
      const offCtx = offscreen.getContext("2d")!;
      offCtx.clearRect(0, 0, w, h);

      const count = Math.floor(w * h * densityBucket * 0.003);
      offCtx.fillStyle = m === "thermal"
        ? "rgba(180,200,180,0.12)"
        : "rgba(100,100,120,0.1)";
      for (let i = 0; i < count; i++) {
        const px = Math.random() * w;
        const py = Math.random() * h;
        const sz = Math.random() < 0.3 ? 2 : 1;
        offCtx.fillRect(px, py, sz, sz);
      }

      if (densityBucket > 0.2) {
        const lineCount = Math.floor(densityBucket * 8);
        offCtx.strokeStyle = m === "thermal"
          ? `rgba(160,200,160,${0.03 * densityBucket})`
          : `rgba(120,130,160,${0.03 * densityBucket})`;
        offCtx.lineWidth = 1;
        for (let i = 0; i < lineCount; i++) {
          const ly = Math.random() * h;
          offCtx.beginPath();
          offCtx.moveTo(0, ly);
          offCtx.lineTo(w, ly);
          offCtx.stroke();
        }
      }
    }
    noiseCache.density = densityBucket;
    noiseCache.timestamp = now;
    noiseCache.w = w;
    noiseCache.h = h;
  }

  // Blit cached noise
  const cached = noiseCache[mode];
  if (cached) {
    ctx.drawImage(cached, 0, 0);
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
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  } else {
    // Daylight sky — realistic gradient, darker at top, hazy horizon
    const horizonY = h * 0.62;
    grad.addColorStop(0, "#4a6f94");      // Deep blue at top
    grad.addColorStop(0.45, "#7aa0c4");   // Mid sky
    grad.addColorStop(0.6, "#a8c4d8");    // Horizon haze
    grad.addColorStop(0.65, "#b8ccd8");   // Horizon line
    grad.addColorStop(0.7, "#8a9a8e");    // Ground start (dull green-grey)
    grad.addColorStop(1, "#6b7a6f");      // Ground (muted)
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Subtle horizon glow
    const hGlow = ctx.createLinearGradient(0, horizonY - 20, 0, horizonY + 20);
    hGlow.addColorStop(0, "rgba(200,220,235,0)");
    hGlow.addColorStop(0.5, "rgba(200,220,235,0.18)");
    hGlow.addColorStop(1, "rgba(200,220,235,0)");
    ctx.fillStyle = hGlow;
    ctx.fillRect(0, horizonY - 20, w, 40);

    // Slight vignette (EO lens falloff at edges)
    const vignette = ctx.createRadialGradient(w/2, h/2, h * 0.3, w/2, h/2, h * 0.85);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,0.22)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);
  }
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

  // Explosion state for JACKAL intercept
  const explosionRef = useRef<{ startTime: number; x: number; y: number } | null>(null);
  const prevNeutralizedRef = useRef(false);

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

  // Detect when tracked target gets intercepted — trigger explosion
  useEffect(() => {
    if (track) {
      if (!prevNeutralizedRef.current && track.neutralized) {
        // Target just got neutralized — check if a Jackal did it
        const activeJackal = allTracks.find(
          (t) => t.is_interceptor && t.interceptor_target === track.id && t.neutralized
        );
        if (activeJackal) {
          explosionRef.current = { startTime: Date.now(), x: 0, y: 0 };
        }
      }
      prevNeutralizedRef.current = track.neutralized;
    } else {
      prevNeutralizedRef.current = false;
    }
  }, [track, track?.neutralized, allTracks]);

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
      // Smooth gimbal sway using multi-frequency sinusoids instead of random jitter
      const jx = (Math.sin(time * 1.3 + 0.7) + 0.3 * Math.sin(time * 3.7 + 2.1) + 0.15 * Math.sin(time * 7.3)) * amp * 0.35;
      const jy = (Math.sin(time * 1.1 + 1.4) + 0.3 * Math.sin(time * 4.1 + 0.3) + 0.15 * Math.sin(time * 6.1)) * amp * 0.35;

      // Thermal heat shimmer: subtle vertical displacement in thermal mode
      const shimmerY = mode === "thermal"
        ? Math.sin(time * 5.3 + pixelOffsetX * 0.1) * 1.5 * Math.min(1, rangeKm / 0.5)
        : 0;

      ctx.save();
      ctx.translate(w / 2 + pixelOffsetX + jx, h / 2 + pixelOffsetY + jy + shimmerY);

      // Shadow blur: crisp at close range, blurry at long range
      if (rangeKm > 1.5) {
        ctx.shadowColor = mode === "thermal"
          ? "rgba(200,210,200,0.5)"
          : "rgba(40,40,60,0.5)";
        ctx.shadowBlur = 12;
      } else if (rangeKm > 0.8) {
        ctx.shadowColor = mode === "thermal"
          ? "rgba(200,210,200,0.4)"
          : "rgba(40,40,60,0.4)";
        ctx.shadowBlur = 7;
      } else if (rangeKm > 0.3) {
        ctx.shadowColor = mode === "thermal"
          ? "rgba(200,210,200,0.2)"
          : "rgba(40,40,60,0.2)";
        ctx.shadowBlur = 3;
      } else {
        // Close range: crisp edges, slight thermal glow only
        if (mode === "thermal") {
          ctx.shadowColor = "rgba(230,240,230,0.15)";
          ctx.shadowBlur = 1;
        }
        // Daylight: no shadow blur at all
      }

      // Use drone_type for silhouette (always available) — camera shows what it sees.
      // classification only matters for scoring; visuals use ground truth type.
      const aspectInfo = calcAspectAngle(vt.x, vt.y, vt.heading_deg);
      drawSilhouette(ctx, vt.drone_type ?? vt.classification, scale, mode, time, aspectInfo);
      ctx.restore();

      // Draw approaching JACKAL as bright dot if one is targeting this track
      const inboundJackal = allTracks.find(
        (t) => t.is_interceptor && !t.neutralized && t.interceptor_target === vt.id
      );
      if (inboundJackal) {
        const cBearing = calcBearing(inboundJackal.x, inboundJackal.y);
        const cRange = calcRange(inboundJackal.x, inboundJackal.y);
        const cElev = calcElevation(inboundJackal.altitude_ft, cRange);
        const dBearing = angleDiff(cBearing, cameraBearing);
        const dElev = angleDiff(cElev, cameraElevation);
        if (Math.abs(dBearing) <= fovH / 2 && Math.abs(dElev) <= fovV / 2) {
          const cpx = (dBearing / (fovH / 2)) * (w / 2);
          const cpy = -(dElev / (fovV / 2)) * (h / 2);
          drawApproachingJackal(ctx, w, h, cpx, cpy, mode, time);
        }
      }

      drawNoise(ctx, w, h, noise, mode);
      drawReticle(ctx, w, h, hudColor);
    } else {
      // Manual/standby with no visible target — scan lines
      drawScanLines(ctx, w, h, time);
      drawNoise(ctx, w, h, 0.3, mode);
      drawReticle(ctx, w, h, hudColor);
    }

    // Draw explosion overlay (on top of everything)
    if (explosionRef.current) {
      const expElapsed = (Date.now() - explosionRef.current.startTime) / 1000;
      if (expElapsed < 0.9) {
        drawExplosion(ctx, w, h, expElapsed);
      } else {
        explosionRef.current = null;
      }
    }

    rafRef.current = requestAnimationFrame(draw);
  }, [track, allTracks, mode, acquiring, hudColor, degraded, getVisibleTrack, isDegraded, gimbalMode, trackLost, zoom, cameraBearing, cameraElevation, fovH, fovV]);

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
