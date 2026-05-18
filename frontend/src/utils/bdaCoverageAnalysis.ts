import type { ApproachCorridor } from "../types";
import type { PlacedSystem, SystemDef } from "../components/bda/types";

export type CoverageStatus = "COVERED" | "PARTIAL" | "GAP";
export type ReadinessLevel = "GOOD" | "CAUTION" | "HIGH RISK";

export interface CorridorLayerCoverage {
  count: number;
  systems: string[];
  status: CoverageStatus;
}

export interface CorridorCoverage {
  name: string;
  bearing_deg: number;
  sensor: CorridorLayerCoverage;
  effector: CorridorLayerCoverage;
  status: CoverageStatus;
  recommendation: string;
}

export interface BdaCoverageSummary {
  corridors: CorridorCoverage[];
  sensorGapCount: number;
  effectorGapCount: number;
  partialCount: number;
  coveredCount: number;
  readiness: ReadinessLevel;
  headline: string;
  recommendations: string[];
}

export function bearingInFov(
  systemFacing: number,
  fovDeg: number,
  corridorBearing: number,
): boolean {
  const half = fovDeg / 2;
  const diff = ((corridorBearing - systemFacing + 540) % 360) - 180;
  return Math.abs(diff) <= half;
}

function systemCoversBearing(def: SystemDef, facingDeg: number, bearingDeg: number): boolean {
  if (def.fov_deg >= 360) return true;
  return bearingInFov(facingDeg, def.fov_deg, bearingDeg);
}

function coverageStatus(count: number): CoverageStatus {
  if (count === 0) return "GAP";
  if (count === 1) return "PARTIAL";
  return "COVERED";
}

function analyzeLayer(
  corridorBearing: number,
  systems: PlacedSystem[],
  layer: "sensor" | "effector",
): CorridorLayerCoverage {
  const covering = systems.filter((sys) => {
    if (layer === "sensor") {
      if (sys.def.category !== "sensor" && sys.def.category !== "combined") return false;
    } else if (sys.def.category !== "effector" && sys.def.category !== "combined") {
      return false;
    }
    return systemCoversBearing(sys.def, sys.facing_deg, corridorBearing);
  });

  return {
    count: covering.length,
    systems: covering.map((sys) => sys.def.name),
    status: coverageStatus(covering.length),
  };
}

function combineStatus(sensor: CorridorLayerCoverage, effector: CorridorLayerCoverage): CoverageStatus {
  if (sensor.count === 0 || effector.count === 0) return "GAP";
  if (sensor.count === 1 || effector.count === 1) return "PARTIAL";
  return "COVERED";
}

function corridorRecommendation(
  name: string,
  sensor: CorridorLayerCoverage,
  effector: CorridorLayerCoverage,
): string {
  if (sensor.count === 0 && effector.count === 0) {
    return `${name}: add both detection and defeat coverage.`;
  }
  if (sensor.count === 0) {
    return `${name}: add or rotate a sensor onto this approach.`;
  }
  if (effector.count === 0) {
    return `${name}: add or rotate a defeat option onto this approach.`;
  }
  if (sensor.count === 1 || effector.count === 1) {
    return `${name}: single-threaded coverage; consider overlap for resilience.`;
  }
  return `${name}: layered coverage present.`;
}

export function analyzeBdaCoverage(
  corridors: ApproachCorridor[] | undefined,
  systems: PlacedSystem[],
): BdaCoverageSummary {
  const analyzed = (corridors ?? []).map((corridor) => {
    const sensor = analyzeLayer(corridor.bearing_deg, systems, "sensor");
    const effector = analyzeLayer(corridor.bearing_deg, systems, "effector");
    const status = combineStatus(sensor, effector);
    return {
      name: corridor.name,
      bearing_deg: corridor.bearing_deg,
      sensor,
      effector,
      status,
      recommendation: corridorRecommendation(corridor.name, sensor, effector),
    };
  });

  const sensorGapCount = analyzed.filter((c) => c.sensor.status === "GAP").length;
  const effectorGapCount = analyzed.filter((c) => c.effector.status === "GAP").length;
  const partialCount = analyzed.filter((c) => c.status === "PARTIAL").length;
  const coveredCount = analyzed.filter((c) => c.status === "COVERED").length;
  const gapCount = analyzed.filter((c) => c.status === "GAP").length;

  let readiness: ReadinessLevel = "GOOD";
  if (gapCount > 0) readiness = "HIGH RISK";
  else if (partialCount > 0) readiness = "CAUTION";

  const recommendations = analyzed
    .filter((c) => c.status !== "COVERED")
    .map((c) => c.recommendation);

  const headline = analyzed.length === 0
    ? "No approach corridors defined for this base."
    : readiness === "GOOD"
      ? "All approach corridors have layered detect-and-defeat coverage."
      : readiness === "CAUTION"
        ? "All corridors are covered, but at least one is single-threaded."
        : `${gapCount} approach corridor${gapCount === 1 ? " has" : "s have"} detect-or-defeat gaps.`;

  return {
    corridors: analyzed,
    sensorGapCount,
    effectorGapCount,
    partialCount,
    coveredCount,
    readiness,
    headline,
    recommendations,
  };
}
