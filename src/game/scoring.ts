/**
 * DTID scoring engine -- grades player performance after scenario ends.
 * Direct port of backend/app/scoring.py to TypeScript.
 */

import type {
  BaseTemplate,
  DroneStartConfig,
  EquipmentCatalog,
  PlacedEquipment,
  PlacementConfig,
  PlayerAction,
  ScenarioConfig,
  ScoreBreakdown,
} from './state';

// ---------------------------------------------------------------------------
// Weights
// ---------------------------------------------------------------------------

const WEIGHT_DETECTION = 0.20;
const WEIGHT_TRACKING = 0.15;
const WEIGHT_IDENTIFICATION = 0.25;
const WEIGHT_DEFEAT = 0.25;
const WEIGHT_ROE = 0.15;

// ---------------------------------------------------------------------------
// Grade scale
// ---------------------------------------------------------------------------

function _totalToGrade(total: number): string {
  if (total >= 95) return 'S';
  if (total >= 85) return 'A';
  if (total >= 70) return 'B';
  if (total >= 50) return 'C';
  return 'F';
}

function _normalizeEffectorForScoring(effector: string | null | undefined): string | null {
  if (!effector) return null;
  const lower = effector.toLowerCase();
  if (lower === 'rf_jam' || lower.includes('rf_jammer') || lower.includes('jammer')) return 'electronic';
  if (lower === 'kinetic' || lower.includes('jackal')) return 'kinetic';
  if (lower === 'de_laser' || lower.includes('de_laser') || lower.includes('de-laser')) return 'de_laser';
  if (lower === 'de_hpm' || lower.includes('de_hpm') || lower.includes('de-hpm') || lower.includes('hpm')) return 'de_hpm';
  if (lower === 'shenobi_pm' || lower.includes('shenobi')) return 'shenobi_pm';
  return effector;
}

// ---------------------------------------------------------------------------
// Internal: score individual components for a single drone
// ---------------------------------------------------------------------------

function _scoreDroneComponents(
  correctClass: string,
  correctAffil: string,
  optimalEffectors: string[],
  acceptableEffectors: string[],
  roeViolations: string[],
  shouldEngage: boolean,
  actions: PlayerAction[],
  detectionTime: number,
  confirmTime: number | null,
  identifyTime: number | null,
  classificationGiven: string | null,
  affiliationGiven: string | null,
  effectorUsed: string | null,
  droneReachedBase: boolean,
  confidenceAtIdentify: number,
  firstClickTime: number | null,
  droneSpeed: number,
): [Record<string, number>, Record<string, string>] {
  const scores: Record<string, number> = {};
  const details: Record<string, string> = {};

  // --- Detection Awareness (60% of WEIGHT_DETECTION) ---
  // Measures time from drone spawn (detectionTime) to operator first click
  if (firstClickTime != null && detectionTime != null) {
    const timeToFirstClick = firstClickTime - detectionTime;
    if (timeToFirstClick <= 3.0) {
      scores['detection_awareness'] = 100;
    } else if (timeToFirstClick <= 8.0) {
      scores['detection_awareness'] = 85;
    } else if (timeToFirstClick <= 15.0) {
      scores['detection_awareness'] = 70;
    } else if (timeToFirstClick <= 30.0) {
      scores['detection_awareness'] = 50;
    } else {
      scores['detection_awareness'] = 20;
    }
    details['detection_awareness'] = `Detected contact in ${timeToFirstClick.toFixed(1)}s`;

    // Weight by threat urgency: fast-closing drones demand faster operator response.
    // Penalty applies when the drone is fast (>40 kt) AND the operator was slow (>8s).
    const isHighSpeed = droneSpeed > 40;
    const isSlowResponse = timeToFirstClick > 8.0;
    if (isHighSpeed && isSlowResponse) {
      scores['detection_awareness'] = Math.max(0, scores['detection_awareness'] - 10);
      details['detection_awareness'] += ' (slow response to fast threat)';
    }
  } else {
    scores['detection_awareness'] = 0;
    details['detection_awareness'] = 'No operator interaction with contact';
  }

  if (droneReachedBase && shouldEngage) {
    scores['detection_awareness'] = Math.max(0, scores['detection_awareness'] - 30);
    details['detection_awareness'] += ' -- DRONE REACHED BASE';
  }

  // --- Confirmation Quality (40% of WEIGHT_DETECTION) ---
  // Rewards methodical confirmation over impulsive clicking
  if (confirmTime != null && firstClickTime != null) {
    const clickToConfirm = confirmTime - firstClickTime;
    if (clickToConfirm >= 3.0 && clickToConfirm <= 15.0) {
      scores['confirmation_quality'] = 100;
      details['confirmation_quality'] = `Confirmed after ${clickToConfirm.toFixed(1)}s of assessment`;
    } else if (clickToConfirm < 2.0) {
      scores['confirmation_quality'] = 80;
      details['confirmation_quality'] = 'Quick confirm \u2014 verify not a false track';
    } else {
      scores['confirmation_quality'] = 60;
      details['confirmation_quality'] = `Slow confirmation (${clickToConfirm.toFixed(1)}s)`;
    }
  } else if (confirmTime != null) {
    // First click was confirm itself — still counts, but no assessment gap
    scores['confirmation_quality'] = 80;
    details['confirmation_quality'] = 'Confirmed on first interaction';
  } else {
    scores['confirmation_quality'] = 0;
    details['confirmation_quality'] = 'Track was never confirmed';
  }

  // --- Tracking (15%) ---
  if (identifyTime != null && confirmTime != null) {
    const trackingDuration = identifyTime - confirmTime;
    if (confidenceAtIdentify >= 0.7 && trackingDuration >= 3.0) {
      scores['tracking'] = 100;
      details['tracking'] = 'Good sensor correlation before identification';
    } else if (confidenceAtIdentify >= 0.5) {
      scores['tracking'] = 70;
      details['tracking'] = 'Adequate sensor data before identification';
    } else if (trackingDuration < 2.0) {
      scores['tracking'] = 30;
      details['tracking'] = 'Rushed identification';
    } else {
      scores['tracking'] = 50;
      details['tracking'] = 'Limited sensor confidence at identification';
    }
  } else if (confirmTime != null) {
    scores['tracking'] = 20;
    details['tracking'] = 'Track confirmed but never identified';
  } else {
    scores['tracking'] = 0;
    details['tracking'] = 'No tracking performed';
  }

  // --- Identification (25%) ---
  // TODO: Consider adjusting identification time expectations based on camera aspect angle.
  // Head-on views (aspect 0-30°) make visual ID much harder than broadside (60-120°);
  // could grant extra time or reduce penalty for slow ID at unfavorable aspects.
  if (classificationGiven != null && affiliationGiven != null) {
    const classCorrect = classificationGiven === correctClass;
    const affilCorrect = affiliationGiven === correctAffil;

    if (classCorrect && affilCorrect) {
      scores['identification'] = 100;
      details['identification'] = `Correctly identified as ${classificationGiven}`;
    } else if (classCorrect) {
      scores['identification'] = 60;
      details['identification'] = `Correct classification, wrong affiliation (${affiliationGiven})`;
    } else if (affilCorrect) {
      scores['identification'] = 40;
      details['identification'] = `Correct affiliation, wrong classification (${classificationGiven})`;
    } else {
      scores['identification'] = 0;
      details['identification'] = `Misidentified as ${classificationGiven}/${affiliationGiven}`;
    }
  } else if (classificationGiven != null) {
    scores['identification'] = 30;
    details['identification'] = 'Classified but affiliation not set';
  } else {
    scores['identification'] = 0;
    details['identification'] = 'Threat was not identified';
  }

  // --- Defeat Method (25%) ---
  if (!shouldEngage) {
    const engageActions = actions.filter((a) => a.action === 'engage');
    if (engageActions.length === 0) {
      scores['defeat'] = 100;
      details['defeat'] = 'Correctly did not engage (non-threat)';
    } else {
      scores['defeat'] = 0;
      details['defeat'] = 'Engaged a non-threat target';
    }
  } else if (effectorUsed != null) {
    const effectorLabel = effectorUsed.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    if (optimalEffectors.includes(effectorUsed)) {
      scores['defeat'] = 100;
      details['defeat'] = `${effectorLabel} was optimal response`;
    } else if (acceptableEffectors.includes(effectorUsed)) {
      scores['defeat'] = 70;
      details['defeat'] = `${effectorLabel} was acceptable but not optimal`;
    } else {
      scores['defeat'] = 30;
      details['defeat'] = `${effectorLabel} was a poor choice`;
    }

    const collateralPenaltyMap: Record<string, number> = {
      de_hpm: 15,
      kinetic: 10,
      de_laser: 0,
      electronic: 0,
      shenobi_pm: 5,
    };
    const collateralPenalty = collateralPenaltyMap[effectorUsed] ?? 0;
    if (collateralPenalty > 0) {
      scores['defeat'] = Math.max(0, scores['defeat'] - collateralPenalty);
      details['defeat'] += ` (collateral risk: -${collateralPenalty})`;
    }
  } else {
    if (droneReachedBase) {
      scores['defeat'] = 0;
      details['defeat'] = 'No engagement -- base compromised';
    } else {
      scores['defeat'] = 10;
      details['defeat'] = 'No engagement attempted';
    }
  }

  // --- ROE Compliance (15%) ---
  const engageActions = actions.filter((a) => a.action === 'engage');
  const roeViolationsFound: string[] = [];
  for (const a of engageActions) {
    const normalizedEffector = _normalizeEffectorForScoring(a.effector);
    if (normalizedEffector && roeViolations.includes(normalizedEffector)) {
      roeViolationsFound.push(normalizedEffector);
    }
  }
  if (!shouldEngage && engageActions.length > 0) {
    roeViolationsFound.push('engaged_non_threat');
  }

  if (roeViolationsFound.length === 0) {
    scores['roe'] = 100;
    details['roe'] = 'All actions within ROE';
  } else {
    scores['roe'] = 0;
    details['roe'] = `ROE violation: ${roeViolationsFound.join(', ')}`;
  }

  return [scores, details];
}

// ---------------------------------------------------------------------------
// Internal: score a single-drone scenario
// ---------------------------------------------------------------------------

function _scoreSingleDrone(
  correctClass: string,
  correctAffil: string,
  optimalEffectors: string[],
  acceptableEffectors: string[],
  roeViolations: string[],
  actions: PlayerAction[],
  detectionTime: number,
  confirmTime: number | null,
  identifyTime: number | null,
  _engageTime: number | null,
  classificationGiven: string | null,
  affiliationGiven: string | null,
  effectorUsed: string | null,
  droneReachedBase: boolean,
  confidenceAtIdentify: number,
  firstClickTime: number | null = null,
  droneSpeed: number = 0,
  placementConfig: PlacementConfig | null = null,
  baseTemplate: BaseTemplate | null = null,
  catalog: EquipmentCatalog | null = null,
): ScoreBreakdown {
  const [scores, details] = _scoreDroneComponents(
    correctClass,
    correctAffil,
    optimalEffectors,
    acceptableEffectors,
    roeViolations,
    correctAffil === 'hostile',
    actions,
    detectionTime,
    confirmTime,
    identifyTime,
    classificationGiven,
    affiliationGiven,
    effectorUsed,
    droneReachedBase,
    confidenceAtIdentify,
    firstClickTime,
    droneSpeed,
  );

  // Split WEIGHT_DETECTION: 60% awareness, 40% confirmation quality
  const detectionScore =
    scores['detection_awareness'] * 0.6 + scores['confirmation_quality'] * 0.4;

  const total =
    detectionScore * WEIGHT_DETECTION +
    scores['tracking'] * WEIGHT_TRACKING +
    scores['identification'] * WEIGHT_IDENTIFICATION +
    scores['defeat'] * WEIGHT_DEFEAT +
    scores['roe'] * WEIGHT_ROE;

  const grade = _totalToGrade(total);

  let placementScoreVal: number | null = null;
  let placementDetailsVal: Record<string, string> | null = null;
  if (placementConfig != null && baseTemplate != null && catalog != null) {
    [placementScoreVal, placementDetailsVal] = calculatePlacementScore(
      placementConfig,
      baseTemplate,
      catalog,
    );
  }

  return {
    detection_awareness_score: Math.round(scores['detection_awareness'] * 10) / 10,
    confirmation_quality_score: Math.round(scores['confirmation_quality'] * 10) / 10,
    tracking_score: Math.round(scores['tracking'] * 10) / 10,
    identification_score: Math.round(scores['identification'] * 10) / 10,
    defeat_score: Math.round(scores['defeat'] * 10) / 10,
    roe_score: Math.round(scores['roe'] * 10) / 10,
    total_score: Math.round(total * 10) / 10,
    grade,
    details,
    placement_score: placementScoreVal,
    placement_details: placementDetailsVal,
    completion_multiplier: 1.0,
    time_bonus_detail: 'Mission completed (100% duration)',
  };
}

// ---------------------------------------------------------------------------
// Public: applyCompletionMultiplier
// ---------------------------------------------------------------------------

export function applyCompletionMultiplier(
  elapsed: number,
  maxDuration: number,
): { completion_multiplier: number; time_bonus_detail: string } {
  const pct = Math.min(elapsed / maxDuration, 1.0);
  const pctRounded = Math.round(pct * 100);

  let multiplier: number;
  if (pct >= 0.9) {
    multiplier = 1.0;
  } else if (pct >= 0.7) {
    multiplier = 0.95;
  } else if (pct >= 0.5) {
    multiplier = 0.85;
  } else {
    multiplier = 0.70;
  }

  const detail =
    multiplier === 1.0
      ? `Mission completed (${pctRounded}% duration)`
      : `Early exit penalty applied (${pctRounded}% completion)`;

  return { completion_multiplier: multiplier, time_bonus_detail: detail };
}

// ---------------------------------------------------------------------------
// Segment intersection helper (for LOS checks)
// ---------------------------------------------------------------------------

function _segmentsIntersect(
  ax1: number, ay1: number, ax2: number, ay2: number,
  bx1: number, by1: number, bx2: number, by2: number,
): boolean {
  const dax = ax2 - ax1;
  const day = ay2 - ay1;
  const dbx = bx2 - bx1;
  const dby = by2 - by1;

  const denom = dax * dby - day * dbx;
  if (Math.abs(denom) < 1e-12) return false;

  const t = ((bx1 - ax1) * dby - (by1 - ay1) * dbx) / denom;
  const u = ((bx1 - ax1) * day - (by1 - ay1) * dax) / denom;

  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

// ---------------------------------------------------------------------------
// Public: calculateScore (single drone, backward compatible)
// ---------------------------------------------------------------------------

export function calculateScore(
  scenario: ScenarioConfig,
  actions: PlayerAction[],
  detectionTime: number,
  confirmTime: number | null,
  identifyTime: number | null,
  engageTime: number | null,
  classificationGiven: string | null,
  affiliationGiven: string | null,
  effectorUsed: string | null,
  droneReachedBase: boolean,
  confidenceAtIdentify: number,
  firstClickTime: number | null = null,
  droneSpeed: number = 0,
  placementConfig: PlacementConfig | null = null,
  baseTemplate: BaseTemplate | null = null,
  catalog: EquipmentCatalog | null = null,
): ScoreBreakdown {
  return _scoreSingleDrone(
    scenario.correct_classification,
    scenario.correct_affiliation,
    scenario.optimal_effectors,
    scenario.acceptable_effectors,
    scenario.roe_violations,
    actions,
    detectionTime,
    confirmTime,
    identifyTime,
    engageTime,
    classificationGiven,
    affiliationGiven,
    effectorUsed,
    droneReachedBase,
    confidenceAtIdentify,
    firstClickTime,
    droneSpeed,
    placementConfig,
    baseTemplate,
    catalog,
  );
}

// ---------------------------------------------------------------------------
// Public: calculateScoreMulti (multi drone)
// ---------------------------------------------------------------------------

export function calculateScoreMulti(
  scenario: ScenarioConfig,
  droneConfigs: DroneStartConfig[],
  actions: PlayerAction[],
  detectionTimes: Map<string, number>,
  confirmTimes: Map<string, number>,
  identifyTimes: Map<string, number>,
  engageTimes: Map<string, number>,
  classificationsGiven: Map<string, string>,
  affiliationsGiven: Map<string, string>,
  effectorsUsed: Map<string, string>,
  dronesReachedBase: Set<string>,
  confidenceAtIdentify: Map<string, number>,
  firstClickTimes: Map<string, number>,
  droneSpeeds: Map<string, number>,
  placementConfig: PlacementConfig | null = null,
  baseTemplate: BaseTemplate | null = null,
  catalog: EquipmentCatalog | null = null,
): ScoreBreakdown {
  if (droneConfigs.length <= 1) {
    const cfg = droneConfigs.length > 0 ? droneConfigs[0] : null;
    const droneId = cfg ? cfg.id : '';
    return _scoreSingleDrone(
      (cfg?.correct_classification || scenario.correct_classification),
      (cfg?.correct_affiliation || scenario.correct_affiliation),
      cfg?.optimal_effectors ?? scenario.optimal_effectors,
      cfg?.acceptable_effectors ?? scenario.acceptable_effectors,
      cfg?.roe_violations ?? scenario.roe_violations,
      actions.filter((a) => a.target_id === droneId),
      detectionTimes.get(droneId) ?? 0.0,
      confirmTimes.get(droneId) ?? null,
      identifyTimes.get(droneId) ?? null,
      engageTimes.get(droneId) ?? null,
      classificationsGiven.get(droneId) ?? null,
      affiliationsGiven.get(droneId) ?? null,
      effectorsUsed.get(droneId) ?? null,
      dronesReachedBase.has(droneId),
      confidenceAtIdentify.get(droneId) ?? 0.0,
      firstClickTimes.get(droneId) ?? null,
      droneSpeeds.get(droneId) ?? 0,
      placementConfig,
      baseTemplate,
      catalog,
    );
  }

  // Score each drone independently
  const perDroneScores: Record<string, number>[] = [];
  const perDroneDetails: Record<string, string>[] = [];

  for (const cfg of droneConfigs) {
    const droneId = cfg.id;
    const correctClass = cfg.correct_classification || scenario.correct_classification;
    const correctAffil = cfg.correct_affiliation || scenario.correct_affiliation;
    const optimal = cfg.optimal_effectors ?? scenario.optimal_effectors;
    const acceptable = cfg.acceptable_effectors ?? scenario.acceptable_effectors;
    const roe = cfg.roe_violations ?? scenario.roe_violations;
    const droneActions = actions.filter((a) => a.target_id === droneId);

    const [scores, details] = _scoreDroneComponents(
      correctClass,
      correctAffil,
      optimal,
      acceptable,
      roe,
      cfg.should_engage,
      droneActions,
      detectionTimes.get(droneId) ?? 0.0,
      confirmTimes.get(droneId) ?? null,
      identifyTimes.get(droneId) ?? null,
      classificationsGiven.get(droneId) ?? null,
      affiliationsGiven.get(droneId) ?? null,
      effectorsUsed.get(droneId) ?? null,
      dronesReachedBase.has(droneId),
      confidenceAtIdentify.get(droneId) ?? 0.0,
      firstClickTimes.get(droneId) ?? null,
      droneSpeeds.get(droneId) ?? 0,
    );
    perDroneScores.push(scores);
    perDroneDetails.push(details);
  }

  // Weighted average across all drones
  const n = perDroneScores.length;
  const avgAwareness = perDroneScores.reduce((s, d) => s + d['detection_awareness'], 0) / n;
  const avgConfirmQuality = perDroneScores.reduce((s, d) => s + d['confirmation_quality'], 0) / n;
  const avgDetection = avgAwareness * 0.6 + avgConfirmQuality * 0.4;
  const avgTracking = perDroneScores.reduce((s, d) => s + d['tracking'], 0) / n;
  const avgIdentification = perDroneScores.reduce((s, d) => s + d['identification'], 0) / n;
  const avgDefeat = perDroneScores.reduce((s, d) => s + d['defeat'], 0) / n;
  const avgRoe = perDroneScores.reduce((s, d) => s + d['roe'], 0) / n;

  const total =
    avgDetection * WEIGHT_DETECTION +
    avgTracking * WEIGHT_TRACKING +
    avgIdentification * WEIGHT_IDENTIFICATION +
    avgDefeat * WEIGHT_DEFEAT +
    avgRoe * WEIGHT_ROE;

  // Build combined details
  const combinedDetails: Record<string, string> = {};
  for (let i = 0; i < droneConfigs.length; i++) {
    const prefix = droneConfigs[i].id.toUpperCase();
    const d = perDroneDetails[i];
    for (const [key, val] of Object.entries(d)) {
      combinedDetails[`${prefix}_${key}`] = val;
    }
  }
  combinedDetails['summary'] = `Scored ${n} tracks (weighted average)`;

  const grade = _totalToGrade(total);

  // Placement scoring
  let placementScoreVal: number | null = null;
  let placementDetailsVal: Record<string, string> | null = null;
  if (placementConfig != null && baseTemplate != null && catalog != null) {
    [placementScoreVal, placementDetailsVal] = calculatePlacementScore(
      placementConfig,
      baseTemplate,
      catalog,
    );
  }

  return {
    detection_awareness_score: Math.round(avgAwareness * 10) / 10,
    confirmation_quality_score: Math.round(avgConfirmQuality * 10) / 10,
    tracking_score: Math.round(avgTracking * 10) / 10,
    identification_score: Math.round(avgIdentification * 10) / 10,
    defeat_score: Math.round(avgDefeat * 10) / 10,
    roe_score: Math.round(avgRoe * 10) / 10,
    total_score: Math.round(total * 10) / 10,
    grade,
    details: combinedDetails,
    placement_score: placementScoreVal,
    placement_details: placementDetailsVal,
    completion_multiplier: 1.0,
    time_bonus_detail: 'Mission completed (100% duration)',
  };
}

// ---------------------------------------------------------------------------
// Public: calculatePlacementScore
// ---------------------------------------------------------------------------

export function calculatePlacementScore(
  placement: PlacementConfig,
  base: BaseTemplate,
  catalog: EquipmentCatalog,
): [number, Record<string, string>] {
  const details: Record<string, string> = {};

  // Build lookup maps from catalog
  const sensorCatalog = new Map(catalog.sensors.map((s) => [s.catalog_id, s]));
  const effectorCatalog = new Map(catalog.effectors.map((e) => [e.catalog_id, e]));

  const totalCorridors = base.approach_corridors.length;

  // 1. Coverage completeness (40%)
  let coveredCorridors = 0;
  for (const corridor of base.approach_corridors) {
    const bearingRad = (corridor.bearing_deg * Math.PI) / 180;
    const sampleX = 3.0 * Math.sin(bearingRad);
    const sampleY = 3.0 * Math.cos(bearingRad);

    for (const placed of placement.sensors) {
      const cat = sensorCatalog.get(placed.catalog_id);
      if (cat == null) continue;
      const dist = Math.sqrt((sampleX - placed.x) ** 2 + (sampleY - placed.y) ** 2);
      if (dist <= cat.range_km) {
        coveredCorridors++;
        break;
      }
    }
  }

  const coveragePct = coveredCorridors / Math.max(1, totalCorridors);
  const coverageScore = coveragePct * 100;
  details['coverage'] = `${coveredCorridors}/${totalCorridors} approach corridors covered`;

  // 2. Sensor overlap quality (25%)
  let overlapCorridors = 0;
  for (const corridor of base.approach_corridors) {
    const bearingRad = (corridor.bearing_deg * Math.PI) / 180;
    const sampleX = 2.0 * Math.sin(bearingRad);
    const sampleY = 2.0 * Math.cos(bearingRad);

    let sensorCount = 0;
    for (const placed of placement.sensors) {
      const cat = sensorCatalog.get(placed.catalog_id);
      if (cat == null) continue;
      const dist = Math.sqrt((sampleX - placed.x) ** 2 + (sampleY - placed.y) ** 2);
      if (dist <= cat.range_km) {
        sensorCount++;
      }
    }
    if (sensorCount >= 2) {
      overlapCorridors++;
    }
  }

  const overlapPct = overlapCorridors / Math.max(1, totalCorridors);
  const overlapScore = overlapPct * 100;
  details['overlap'] = `${overlapCorridors}/${totalCorridors} corridors with multi-sensor coverage`;

  // 3. Effector positioning (25%)
  let corridorsWithEffector = 0;
  for (const corridor of base.approach_corridors) {
    const bearingRad = (corridor.bearing_deg * Math.PI) / 180;
    const sampleX = 1.5 * Math.sin(bearingRad);
    const sampleY = 1.5 * Math.cos(bearingRad);

    for (const placed of placement.effectors) {
      const cat = effectorCatalog.get(placed.catalog_id);
      if (cat == null) continue;
      const dist = Math.sqrt((sampleX - placed.x) ** 2 + (sampleY - placed.y) ** 2);
      if (dist <= cat.range_km) {
        corridorsWithEffector++;
        break;
      }
    }
  }

  const effPct = corridorsWithEffector / Math.max(1, totalCorridors);
  const effectorScore = effPct * 100;
  details['effector_reach'] = `${corridorsWithEffector}/${totalCorridors} corridors within effector range`;

  // 4. LOS management (10%)
  const losSensors: PlacedEquipment[] = placement.sensors.filter((p) => {
    const cat = sensorCatalog.get(p.catalog_id);
    return cat != null && cat.requires_los;
  });

  let losScore: number;
  if (losSensors.length > 0) {
    let unblocked = 0;
    let checks = 0;

    for (const placed of losSensors) {
      for (const corridor of base.approach_corridors) {
        checks++;
        const bearingRad = (corridor.bearing_deg * Math.PI) / 180;
        const sampleX = 1.5 * Math.sin(bearingRad);
        const sampleY = 1.5 * Math.cos(bearingRad);

        let blocked = false;
        for (const terrain of base.terrain) {
          if (!terrain.blocks_los) continue;
          const poly = terrain.polygon;
          const pn = poly.length;
          for (let i = 0; i < pn; i++) {
            const [px1, py1] = poly[i];
            const [px2, py2] = poly[(i + 1) % pn];
            if (_segmentsIntersect(placed.x, placed.y, sampleX, sampleY, px1, py1, px2, py2)) {
              blocked = true;
              break;
            }
          }
          if (blocked) break;
        }
        if (!blocked) {
          unblocked++;
        }
      }
    }

    const losPct = unblocked / Math.max(1, checks);
    losScore = losPct * 100;
    details['los'] = `${Math.round(losPct * 100)}% of LOS sensor sightlines unblocked`;
  } else {
    losScore = 100;
    details['los'] = 'No LOS-dependent sensors placed';
  }

  // Weighted total
  const total =
    coverageScore * 0.40 +
    overlapScore * 0.25 +
    effectorScore * 0.25 +
    losScore * 0.10;

  return [Math.round(total * 10) / 10, details];
}
