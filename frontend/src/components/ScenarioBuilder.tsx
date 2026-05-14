import React, { useCallback, useMemo, useState } from "react";
import BdaStepIndicator from "./bda/BdaStepIndicator";
import BdaBaseSelection from "./bda/BdaBaseSelection";
import BdaEquipmentSelection from "./bda/BdaEquipmentSelection";
import WaveComposer, { type WaveDef } from "./WaveComposer";
import { COLORS } from "./bda/constants";
import type { BdaStep, PlacedSystem, SelectedEquipment } from "./bda/types";
import type { BaseTemplate, PlacementConfig } from "../types";
import { generateScenarioId, saveCustomScenario } from "../utils/customScenarios";

interface Props {
  onBack: () => void;
  onLaunchScenario: (
    scenario: Record<string, unknown>,
    baseId: string,
    placement: PlacementConfig,
  ) => void;
}

type DroneType =
  | "commercial_quad"
  | "micro"
  | "fixed_wing"
  | "improvised"
  | "improvised_hardened"
  | "shahed";

interface DroneTemplate {
  altitude: number;
  speed: number;
  rf_emitting: boolean;
  optimal_effectors: string[];
  acceptable_effectors: string[];
}

const DRONE_TEMPLATES: Record<DroneType, DroneTemplate> = {
  commercial_quad: {
    altitude: 150,
    speed: 35,
    rf_emitting: true,
    optimal_effectors: ["de_laser", "electronic"],
    acceptable_effectors: ["electronic", "kinetic", "de_laser"],
  },
  micro: {
    altitude: 80,
    speed: 25,
    rf_emitting: true,
    optimal_effectors: ["electronic", "de_laser"],
    acceptable_effectors: ["electronic", "de_laser", "kinetic"],
  },
  fixed_wing: {
    altitude: 300,
    speed: 60,
    rf_emitting: false,
    optimal_effectors: ["kinetic", "de_laser"],
    acceptable_effectors: ["kinetic", "de_laser", "electronic"],
  },
  improvised: {
    altitude: 100,
    speed: 50,
    rf_emitting: true,
    optimal_effectors: ["electronic", "de_laser"],
    acceptable_effectors: ["electronic", "de_laser", "kinetic"],
  },
  improvised_hardened: {
    altitude: 100,
    speed: 55,
    rf_emitting: true,
    optimal_effectors: ["de_laser", "kinetic"],
    acceptable_effectors: ["kinetic", "de_laser", "electronic"],
  },
  shahed: {
    altitude: 300,
    speed: 100,
    rf_emitting: false,
    optimal_effectors: ["kinetic"],
    acceptable_effectors: ["kinetic", "de_laser"],
  },
};

const DEFAULT_ROE = [
  "Positive identification required before any engagement",
  "Do not engage tracks classified as FRIENDLY or CIVILIAN",
  "Electronic countermeasures authorized against confirmed hostile UAS",
  "Kinetic engagement authorized only when electronic defeat is ineffective or unavailable",
  "All engagements must occur within the weapon engagement zone (WEZ)",
];

const WaveComposerView = WaveComposer as unknown as React.ComponentType<Record<string, unknown>>;
type ScenarioBuilderPlacedSystem = PlacedSystem;

function totalQty(list: { catalogId: string; qty: number }[]): number {
  return list.reduce((sum, item) => sum + item.qty, 0);
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asDroneType(value: unknown): DroneType {
  return typeof value === "string" && value in DRONE_TEMPLATES
    ? (value as DroneType)
    : "commercial_quad";
}

function sectorToBearing(sector: unknown, fallback: number): number {
  if (typeof sector === "number" && Number.isFinite(sector)) return sector;
  if (typeof sector !== "string") return fallback;

  const normalized = sector.toLowerCase().trim();
  const cardinal: Record<string, number> = {
    n: 90,
    north: 90,
    ne: 45,
    northeast: 45,
    e: 0,
    east: 0,
    se: 315,
    southeast: 315,
    s: 270,
    south: 270,
    sw: 225,
    southwest: 225,
    w: 180,
    west: 180,
    nw: 135,
    northwest: 135,
  };

  if (normalized in cardinal) return cardinal[normalized];
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function headingTowardOrigin(x: number, y: number): number {
  return (((Math.atan2(-y, -x) * 180) / Math.PI) + 360) % 360;
}

function expandEquipment(list: { catalogId: string; qty: number }[], radius: number) {
  const expanded: { catalog_id: string; x: number; y: number; facing_deg: number }[] = [];
  const total = Math.max(1, totalQty(list));
  let idx = 0;

  for (const item of list) {
    for (let i = 0; i < item.qty; i += 1) {
      const angle = (idx / total) * Math.PI * 2;
      expanded.push({
        catalog_id: item.catalogId,
        x: Number((Math.cos(angle) * radius).toFixed(3)),
        y: Number((Math.sin(angle) * radius).toFixed(3)),
        facing_deg: Math.round(((angle * 180) / Math.PI + 360) % 360),
      });
      idx += 1;
    }
  }

  return expanded;
}

function buildPlacement(
  baseTemplate: BaseTemplate,
  selectedEquipment: SelectedEquipment,
  boundary: number[][],
): PlacementConfig {
  const xs = boundary.map(([x]) => x);
  const ys = boundary.map(([, y]) => y);
  const width = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  const height = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
  const maxDim = Math.max(width, height);
  const placementBoundsKm = Math.max(maxDim * 1.5, baseTemplate.placement_bounds_km);

  return {
    base_id: baseTemplate.id,
    sensors: expandEquipment(selectedEquipment.sensors, 0.1),
    effectors: expandEquipment(selectedEquipment.effectors, 0.16),
    combined: expandEquipment(selectedEquipment.combined, 0.06),
    boundary: boundary.length ? boundary : baseTemplate.boundary,
    placement_bounds_km: placementBoundsKm,
  };
}

function buildScenarioDrones(waves: WaveDef[]): Record<string, unknown>[] {
  const drones: Record<string, unknown>[] = [];

  waves.forEach((wave, waveIdx) => {
    const data = wave as unknown as Record<string, unknown>;
    const droneType = asDroneType(data.droneType ?? data.drone_type ?? data.type);
    const template = DRONE_TEMPLATES[droneType];
    const count = Math.max(1, Math.round(asNumber(data.count ?? data.qty ?? data.quantity ?? data.droneCount, 1)));
    const delaySeconds = asNumber(data.delaySeconds ?? data.delay_seconds ?? data.delay, 0);
    const staggerSeconds = asNumber(data.staggerSeconds ?? data.stagger_seconds ?? data.stagger, 5);
    const bearingDeg = sectorToBearing(data.spawnSector ?? data.spawn_sector ?? data.sector, waveIdx * 90);

    for (let droneIdx = 0; droneIdx < count; droneIdx += 1) {
      const offsetDeg = count > 1 ? (droneIdx - (count - 1) / 2) * 8 : 0;
      const bearingRad = ((bearingDeg + offsetDeg) * Math.PI) / 180;
      const distanceKm = 4 + ((waveIdx + droneIdx) % 6) * 0.18;
      const startX = Number((Math.cos(bearingRad) * distanceKm).toFixed(2));
      const startY = Number((Math.sin(bearingRad) * distanceKm).toFixed(2));

      drones.push({
        id: `wave-${waveIdx + 1}-${droneIdx + 1}`,
        drone_type: droneType,
        start_x: startX,
        start_y: startY,
        altitude: template.altitude,
        speed: template.speed,
        heading: Math.round(headingTowardOrigin(startX, startY)),
        behavior: "direct_approach",
        rf_emitting: template.rf_emitting,
        spawn_delay: delaySeconds + droneIdx * staggerSeconds,
        correct_classification: droneType,
        correct_affiliation: "hostile",
        optimal_effectors: template.optimal_effectors,
        acceptable_effectors: template.acceptable_effectors,
        spawn_variance: {
          x_range: [-0.6, 0.6],
          y_range: [-0.6, 0.6],
          heading_variance: 12,
          speed_variance: 6,
        },
      });
    }
  });

  return drones;
}

function buildScenarioJson(
  scenarioName: string,
  instructorNotes: string,
  waves: WaveDef[],
): Record<string, unknown> {
  const name = scenarioName.trim() || "Custom Scenario";
  const firstType = asDroneType(
    ((waves[0] as unknown as Record<string, unknown> | undefined)?.droneType) ??
      ((waves[0] as unknown as Record<string, unknown> | undefined)?.drone_type) ??
      ((waves[0] as unknown as Record<string, unknown> | undefined)?.type),
  );
  const firstTemplate = DRONE_TEMPLATES[firstType];

  return {
    id: generateScenarioId(name),
    name,
    description: instructorNotes.trim() || "Custom instructor-built scenario.",
    difficulty: "Custom",
    duration_seconds: 480,
    base_radius_km: 0.1,
    roe_briefing: DEFAULT_ROE,
    engagement_zones: {
      detection_range_km: 5.0,
      identification_range_km: 1.5,
      engagement_range_km: 2.5,
    },
    sensors: [],
    effectors: [],
    correct_classification: firstType,
    correct_affiliation: "hostile",
    optimal_effectors: firstTemplate.optimal_effectors,
    acceptable_effectors: firstTemplate.acceptable_effectors,
    roe_violations: [],
    drones: buildScenarioDrones(waves),
  };
}

function ScenarioSummary({
  baseTemplate,
  selectedBaseId,
  selectedEquipment,
  boundary,
  waves,
  scenarioName,
  instructorNotes,
  onScenarioNameChange,
  onInstructorNotesChange,
  onBack,
  onLaunchScenario,
}: {
  baseTemplate: BaseTemplate;
  selectedBaseId: string;
  selectedEquipment: SelectedEquipment;
  boundary: number[][];
  waves: WaveDef[];
  scenarioName: string;
  instructorNotes: string;
  onScenarioNameChange: (name: string) => void;
  onInstructorNotesChange: (notes: string) => void;
  onBack: () => void;
  onLaunchScenario: Props["onLaunchScenario"];
}) {
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  const sensorCount = totalQty(selectedEquipment.sensors) + totalQty(selectedEquipment.combined);
  const effectorCount = totalQty(selectedEquipment.effectors) + totalQty(selectedEquipment.combined);
  const canFinalize = waves.length > 0 && scenarioName.trim().length > 0;

  const assemble = useCallback(() => {
    const scenario = buildScenarioJson(scenarioName, instructorNotes, waves);
    const placement = buildPlacement(baseTemplate, selectedEquipment, boundary);
    return { scenario, placement };
  }, [baseTemplate, boundary, instructorNotes, scenarioName, selectedEquipment, waves]);

  const handleSave = useCallback(() => {
    const { scenario } = assemble();
    const id = String(scenario.id ?? generateScenarioId(scenarioName));
    const ok = saveCustomScenario({
      id,
      name: String(scenario.name ?? scenarioName),
      instructorNotes,
      scenarioData: scenario,
      baseId: selectedBaseId,
      createdAt: new Date().toISOString(),
    });
    setSaveStatus(ok ? "Scenario saved locally." : "Unable to save scenario in this browser.");
  }, [assemble, instructorNotes, scenarioName, selectedBaseId]);

  const handleLaunch = useCallback(() => {
    const { scenario, placement } = assemble();
    onLaunchScenario(scenario, selectedBaseId, placement);
  }, [assemble, onLaunchScenario, selectedBaseId]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: COLORS.bg,
        color: COLORS.text,
        fontFamily: "'JetBrains Mono', 'Courier New', monospace",
      }}
    >
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 16px" }}>
        <div
          style={{
            maxWidth: 960,
            margin: "0 auto",
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.1fr) minmax(280px, 0.9fr)",
            gap: 20,
            minHeight: "calc(100vh - 180px)",
          }}
        >
          <div
            style={{
              background: COLORS.card,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 8,
              padding: 20,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: COLORS.text }}>
                Scenario Summary
              </h2>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: COLORS.muted }}>
                Name, brief, save, and launch the custom training scenario.
              </p>
            </div>

            <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontSize: 11, letterSpacing: "0.12em", color: COLORS.muted, textTransform: "uppercase" }}>
                Scenario Name
              </span>
              <input
                value={scenarioName}
                onChange={(e) => onScenarioNameChange(e.target.value)}
                placeholder="Custom Scenario"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  background: COLORS.bg,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 6,
                  color: COLORS.text,
                  padding: "10px 12px",
                  fontSize: 14,
                  fontFamily: "inherit",
                  outline: "none",
                }}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minHeight: 260 }}>
              <span style={{ fontSize: 11, letterSpacing: "0.12em", color: COLORS.muted, textTransform: "uppercase" }}>
                Instructor Notes
              </span>
              <textarea
                value={instructorNotes}
                onChange={(e) => onInstructorNotesChange(e.target.value)}
                placeholder="Training objective, expected operator actions, injects, and evaluation criteria..."
                style={{
                  width: "100%",
                  height: "100%",
                  flex: 1,
                  boxSizing: "border-box",
                  resize: "vertical",
                  background: COLORS.bg,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 6,
                  color: COLORS.text,
                  padding: 12,
                  fontSize: 13,
                  fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                  lineHeight: 1.5,
                  outline: "none",
                }}
              />
            </label>
          </div>

          <div
            style={{
              background: COLORS.card,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 8,
              padding: 20,
              display: "flex",
              flexDirection: "column",
              gap: 20,
            }}
          >
            <div>
              <div style={{ fontSize: 11, letterSpacing: "0.12em", color: COLORS.muted, textTransform: "uppercase", marginBottom: 12 }}>
                Read-only Summary
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
                <SummaryRow label="Base" value={baseTemplate.name} />
                <SummaryRow label="Sensors" value={String(sensorCount)} />
                <SummaryRow label="Effectors" value={String(effectorCount)} />
                <SummaryRow label="Waves" value={String(waves.length)} />
              </div>
            </div>

            {saveStatus && (
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 6,
                  background: saveStatus.startsWith("Scenario saved") ? "rgba(63, 185, 80, 0.12)" : "rgba(248, 81, 73, 0.12)",
                  border: `1px solid ${saveStatus.startsWith("Scenario saved") ? COLORS.success : COLORS.danger}`,
                  color: COLORS.text,
                  fontSize: 12,
                }}
              >
                {saveStatus}
              </div>
            )}

            <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
              <button
                type="button"
                onClick={handleSave}
                disabled={!canFinalize}
                style={primaryButtonStyle(canFinalize)}
              >
                SAVE SCENARIO
              </button>
              <button
                type="button"
                onClick={handleLaunch}
                disabled={!canFinalize}
                style={primaryButtonStyle(canFinalize)}
              >
                LAUNCH SCENARIO
              </button>
            </div>
          </div>
        </div>
      </div>

      <div style={bottomBarStyle}>
        <button type="button" onClick={onBack} style={secondaryButtonStyle}>
          ← BACK
        </button>
        <div style={{ color: COLORS.muted, fontSize: 13 }}>
          {canFinalize ? "Ready to save or launch" : "Add at least one wave and scenario name"}
        </div>
        <div style={{ width: 96 }} />
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
      <span style={{ color: COLORS.muted }}>{label}</span>
      <span style={{ color: COLORS.text, textAlign: "right" }}>{value}</span>
    </div>
  );
}

const bottomBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "14px 24px",
  borderTop: `1px solid ${COLORS.border}`,
  background: COLORS.card,
};

const secondaryButtonStyle: React.CSSProperties = {
  background: "transparent",
  border: `1px solid ${COLORS.border}`,
  borderRadius: 6,
  color: COLORS.muted,
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 13,
  padding: "8px 18px",
};

function primaryButtonStyle(enabled: boolean): React.CSSProperties {
  return {
    width: "100%",
    padding: "14px 0",
    background: enabled ? COLORS.accent : COLORS.border,
    border: "none",
    borderRadius: 6,
    color: enabled ? COLORS.bg : COLORS.muted,
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: "0.1em",
    fontFamily: "inherit",
    cursor: enabled ? "pointer" : "not-allowed",
    textTransform: "uppercase",
  };
}

export default function ScenarioBuilder({ onBack, onLaunchScenario }: Props) {
  const [currentStep, setCurrentStep] = useState<BdaStep>(1);

  // Step 1 state
  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null);
  const [baseTemplate, setBaseTemplate] = useState<BaseTemplate | null>(null);
  const [boundary, setBoundary] = useState<number[][]>([]);

  // Step 2 state
  const [selectedEquipment, setSelectedEquipment] = useState<SelectedEquipment>({
    sensors: [],
    effectors: [],
    combined: [],
  });

  // Step 3 state
  const [waves, setWaves] = useState<WaveDef[]>([]);

  // Step 4 state
  const [scenarioName, setScenarioName] = useState("Custom Scenario");
  const [instructorNotes, setInstructorNotes] = useState("");

  const _placedSystemTypeCheck: ScenarioBuilderPlacedSystem | null = null;
  void _placedSystemTypeCheck;

  const completedSteps = useMemo(() => {
    const completed = new Set<BdaStep>();
    if (selectedBaseId && baseTemplate) completed.add(1);
    const totalEquipment =
      totalQty(selectedEquipment.sensors) +
      totalQty(selectedEquipment.effectors) +
      totalQty(selectedEquipment.combined);
    if (totalEquipment > 0) completed.add(2);
    if (waves.length > 0) completed.add(3);
    if (scenarioName.trim() && waves.length > 0) completed.add(4);
    return completed;
  }, [baseTemplate, scenarioName, selectedBaseId, selectedEquipment, waves]);

  const goToStep = useCallback((step: BdaStep) => {
    setCurrentStep(step);
  }, []);

  const handleBaseSelect = useCallback((baseId: string, template: BaseTemplate) => {
    setSelectedBaseId(baseId);
    setBaseTemplate(template);
    setBoundary(template.boundary ?? []);
  }, []);

  const handleEquipmentChange = useCallback((equipment: SelectedEquipment) => {
    setSelectedEquipment(equipment);
  }, []);

  const handleWavesChange = useCallback((nextWaves: WaveDef[]) => {
    setWaves(nextWaves);
  }, []);

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: COLORS.bg,
        color: COLORS.text,
        fontFamily: "'Inter', 'JetBrains Mono', monospace",
        overflow: "hidden",
      }}
    >
      <BdaStepIndicator
        currentStep={currentStep}
        completedSteps={completedSteps}
        onStepClick={goToStep}
      />

      {currentStep === 1 && (
        <BdaBaseSelection
          selectedBaseId={selectedBaseId}
          onSelectBase={handleBaseSelect}
          onBack={onBack}
          onNext={() => setCurrentStep(2)}
        />
      )}

      {currentStep === 2 && baseTemplate && (
        <BdaEquipmentSelection
          selectedEquipment={selectedEquipment}
          onUpdateEquipment={handleEquipmentChange}
          onBack={() => setCurrentStep(1)}
          onNext={() => setCurrentStep(3)}
        />
      )}

      {currentStep === 3 && baseTemplate && (
        <WaveComposerView
          waves={waves}
          onWavesChange={handleWavesChange}
          onBack={() => setCurrentStep(2)}
          onNext={() => setCurrentStep(4)}
        />
      )}

      {currentStep === 4 && baseTemplate && selectedBaseId && (
        <ScenarioSummary
          baseTemplate={baseTemplate}
          selectedBaseId={selectedBaseId}
          selectedEquipment={selectedEquipment}
          boundary={boundary.length ? boundary : baseTemplate.boundary}
          waves={waves}
          scenarioName={scenarioName}
          instructorNotes={instructorNotes}
          onScenarioNameChange={setScenarioName}
          onInstructorNotesChange={setInstructorNotes}
          onBack={() => setCurrentStep(3)}
          onLaunchScenario={onLaunchScenario}
        />
      )}
    </div>
  );
}
