/**
 * OpenSentry detection simulation — ported from backend/app/detection.py
 * Sensor detection logic: radar, RF, EO/IR, acoustic with noise, FOV, LOS.
 */

import type { DroneState, SensorConfig, TerrainFeature } from './state';

// ---------------------------------------------------------------------------
// Gaussian random helper (Box-Muller transform)
// ---------------------------------------------------------------------------

let _spareGauss: number | null = null;

function gauss(mean: number, stddev: number): number {
  if (_spareGauss !== null) {
    const val = mean + stddev * _spareGauss;
    _spareGauss = null;
    return val;
  }
  let u: number, v: number, s: number;
  do {
    u = Math.random() * 2 - 1;
    v = Math.random() * 2 - 1;
    s = u * u + v * v;
  } while (s >= 1 || s === 0);
  const mul = Math.sqrt(-2.0 * Math.log(s) / s);
  _spareGauss = v * mul;
  return mean + stddev * u * mul;
}

// ---------------------------------------------------------------------------
// Private geometry helpers
// ---------------------------------------------------------------------------

function _distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

function _bearingBetween(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

function _angleDiff(a: number, b: number): number {
  const diff = ((b - a + 180) % 360 + 360) % 360 - 180;
  return Math.abs(diff);
}

function _inFov(sensor: SensorConfig, bearingToTarget: number): boolean {
  if (sensor.fov_deg >= 360) return true;
  const halfFov = sensor.fov_deg / 2.0;
  return _angleDiff(sensor.facing_deg, bearingToTarget) <= halfFov;
}

// ---------------------------------------------------------------------------
// LOS checking (exported: segmentsIntersect needed by scoring.ts)
// ---------------------------------------------------------------------------

export function segmentsIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  function cross(ox: number, oy: number, ax2: number, ay2: number, bx2: number, by2: number): number {
    return (ax2 - ox) * (by2 - oy) - (ay2 - oy) * (bx2 - ox);
  }
  const d1 = cross(cx, cy, dx, dy, ax, ay);
  const d2 = cross(cx, cy, dx, dy, bx, by);
  const d3 = cross(ax, ay, bx, by, cx, cy);
  const d4 = cross(ax, ay, bx, by, dx, dy);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return false;
}

function _losBlocked(
  sx: number, sy: number, tx: number, ty: number,
  terrain: TerrainFeature[],
): boolean {
  for (const feature of terrain) {
    if (!feature.blocks_los) continue;
    const poly = feature.polygon;
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const [px1, py1] = poly[i];
      const [px2, py2] = poly[(i + 1) % n];
      if (segmentsIntersect(sx, sy, tx, ty, px1, py1, px2, py2)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Sensor detection result types
// ---------------------------------------------------------------------------

export interface RadarReading {
  sensor_id: string;
  range_km: number;
  altitude_ft: number;
  speed_kts: number;
  heading_deg: number;
}

export interface RfReading {
  sensor_id: string;
  bearing_deg: number;
  frequency_band?: string;
  downlink_detected?: boolean;
  uplink_detected?: boolean;
  rssi_dbm?: number;
  is_shenobi?: boolean;
}

export interface EoirReading {
  sensor_id: string;
  classification_hint: string;
  altitude_ft: number;
}

export interface AcousticReading {
  sensor_id: string;
  bearing_deg: number;
}

export type SensorReading = RadarReading | RfReading | EoirReading | AcousticReading;

// ---------------------------------------------------------------------------
// SensorSimulator class
// ---------------------------------------------------------------------------

export class SensorSimulator {
  terrain: TerrainFeature[];

  constructor(terrain?: TerrainFeature[]) {
    this.terrain = terrain ?? [];
  }

  detect_radar(drone: DroneState, sensor: SensorConfig): RadarReading | null {
    const dist = _distance(sensor.x, sensor.y, drone.x, drone.y);
    if (dist > sensor.range_km) return null;
    const bearing = _bearingBetween(sensor.x, sensor.y, drone.x, drone.y);
    if (!_inFov(sensor, bearing)) return null;
    const ratio = dist / sensor.range_km;
    let detectProb: number;
    if (ratio > 0.9) {
      detectProb = Math.max(0, 1.0 - (ratio - 0.9) * 5.0);
    } else {
      detectProb = 1.0;
    }
    if (Math.random() > detectProb) return null;
    const noiseFactor = dist * 0.02;
    return {
      sensor_id: sensor.id,
      range_km: Math.round(Math.max(0, dist + gauss(0, noiseFactor)) * 100) / 100,
      altitude_ft: Math.round(Math.max(0, drone.altitude + gauss(0, 5))),
      speed_kts: Math.round(Math.max(0, drone.speed + gauss(0, 2))),
      heading_deg: Math.round(((drone.heading + gauss(0, 3)) % 360 + 360) % 360 * 10) / 10,
    };
  }

  detect_rf(drone: DroneState, sensor: SensorConfig): RfReading | null {
    if (!drone.rf_emitting) return null;
    const dist = _distance(sensor.x, sensor.y, drone.x, drone.y);
    if (dist > sensor.range_km) return null;
    const bearing = _bearingBetween(sensor.x, sensor.y, drone.x, drone.y);
    if (!_inFov(sensor, bearing)) return null;
    const ratio = dist / sensor.range_km;
    const detectProb = ratio < 0.7 ? 1.0 : 1.0 - (ratio - 0.7) * 3.0;
    if (Math.random() > Math.max(0, detectProb)) return null;
    const noiseFactor = dist * 0.03;
    const result: RfReading = {
      sensor_id: sensor.id,
      bearing_deg: Math.round(((bearing + gauss(0, noiseFactor * 5)) % 360 + 360) % 360 * 10) / 10,
    };
    const isShenobi =
      sensor.id.toLowerCase().includes('shenobi') ||
      sensor.name.toLowerCase().includes('shenobi');
    if (isShenobi) {
      const bandMap: Record<string, string> = {
        commercial_quad: '2.4GHz',
        micro: '5.8GHz',
        fixed_wing: '900MHz',
        swarm: '2.4GHz',
      };
      const freq = bandMap[drone.drone_type] ?? '2.4GHz';
      const downlink = true;
      const uplink = ratio < 0.6;
      const rssiDbm = Math.round(-30 - ratio * 60 + gauss(0, 3));
      result.frequency_band = freq;
      result.downlink_detected = downlink;
      result.uplink_detected = uplink;
      result.rssi_dbm = rssiDbm;
      result.is_shenobi = true;
    }
    return result;
  }

  detect_eoir(drone: DroneState, sensor: SensorConfig): EoirReading | null {
    const dist = _distance(sensor.x, sensor.y, drone.x, drone.y);
    if (dist > sensor.range_km) return null;
    const bearing = _bearingBetween(sensor.x, sensor.y, drone.x, drone.y);
    if (!_inFov(sensor, bearing)) return null;
    if (this.terrain.length > 0 && _losBlocked(sensor.x, sensor.y, drone.x, drone.y, this.terrain)) {
      return null;
    }
    const ratio = dist / sensor.range_km;
    const detectProb = ratio < 0.6 ? 1.0 : 1.0 - (ratio - 0.6) * 2.5;
    if (Math.random() > Math.max(0, detectProb)) return null;
    const hints: Record<string, string> = {
      commercial_quad: 'multi-rotor silhouette',
      fixed_wing: 'fixed-wing silhouette',
      micro: 'small rotary silhouette',
      swarm: 'multiple small contacts',
    };
    const hint = hints[drone.drone_type] ?? 'unknown silhouette';
    return {
      sensor_id: sensor.id,
      classification_hint: hint,
      altitude_ft: Math.round(Math.max(0, drone.altitude + gauss(0, 3))),
    };
  }

  detect_acoustic(drone: DroneState, sensor: SensorConfig): AcousticReading | null {
    const dist = _distance(sensor.x, sensor.y, drone.x, drone.y);
    if (dist > sensor.range_km) return null;
    const bearing = _bearingBetween(sensor.x, sensor.y, drone.x, drone.y);
    if (!_inFov(sensor, bearing)) return null;
    const ratio = dist / sensor.range_km;
    const detectProb = ratio < 0.5 ? 1.0 : 1.0 - (ratio - 0.5) * 2.0;
    if (Math.random() > Math.max(0, detectProb)) return null;
    return {
      sensor_id: sensor.id,
      bearing_deg: Math.round(((bearing + gauss(0, 5)) % 360 + 360) % 360 * 10) / 10,
    };
  }

  detect(drone: DroneState, sensor: SensorConfig): SensorReading | null {
    if (sensor.status !== 'active') return null;
    const methods: Record<string, (d: DroneState, s: SensorConfig) => SensorReading | null> = {
      radar: (d, s) => this.detect_radar(d, s),
      rf: (d, s) => this.detect_rf(d, s),
      eoir: (d, s) => this.detect_eoir(d, s),
      acoustic: (d, s) => this.detect_acoustic(d, s),
    };
    const method = methods[sensor.type];
    if (!method) return null;
    return method(drone, sensor);
  }
}

// ---------------------------------------------------------------------------
// updateSensors — run all sensors against a single drone
// ---------------------------------------------------------------------------

export function updateSensors(
  drone: DroneState,
  sensors: SensorConfig[],
  terrain?: TerrainFeature[],
): [string[], SensorReading[]] {
  const simulator = new SensorSimulator(terrain);
  const detecting: string[] = [];
  const readings: SensorReading[] = [];
  for (const sensor of sensors) {
    const result = simulator.detect(drone, sensor);
    if (result) {
      detecting.push(sensor.id);
      readings.push(result);
    }
  }
  return [detecting, readings];
}

// ---------------------------------------------------------------------------
// calculateConfidence — multi-sensor fusion confidence score
// ---------------------------------------------------------------------------

export function calculateConfidence(sensorsDetecting: string[], rangeKm: number): number {
  if (sensorsDetecting.length === 0) return 0.0;
  const count = sensorsDetecting.length;
  let base: number;
  if (count >= 4) base = 0.95;
  else if (count === 3) base = 0.85;
  else if (count === 2) base = 0.7;
  else base = 0.5;
  let mod: number;
  if (rangeKm < 1.0) mod = 1.0;
  else if (rangeKm < 2.0) mod = 0.95;
  else if (rangeKm < 3.0) mod = 0.85;
  else mod = 0.7;
  return Math.round(Math.min(1.0, Math.max(0.0, base * mod)) * 100) / 100;
}
