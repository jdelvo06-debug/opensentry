import React, { useCallback, useMemo, useState } from "react";
import BdaBaseSelection from "./bda/BdaBaseSelection";
import BdaEquipmentSelection from "./bda/BdaEquipmentSelection";
import BdaPlacement from "./bda/BdaPlacement";
import WaveComposer, { type WaveDef } from "./WaveComposer";
import { COLORS } from "./bda/constants";
import type { PlacedSystem, SelectedEquipment } from "./bda/types";
import type { BaseTemplate, PlacementConfig } from "../types";
import { generateScenarioId, saveCustomScenario } from "../utils/customScenarios";
import { latLngToGameXY } from "../utils/coordinates";
import {
  DRONE_TEMPLATES,
  asDroneType,
  buildScenarioDrones,
  computeScenarioDuration,
  normalizeWaves,
} from "../utils/scenarioBuilderUtils";

type ScenarioBuilderStep = 1 | 2 | 3 | 4 | 5;

const SCENARIO_BUILDER_STEPS: { num: ScenarioBuilderStep; label: string }[] = [
  { num: 1, label: "BASE" },
  { num: 2, label: "EQUIP" },
  { num: 3, label: "PLACE" },
  { num: 4, label: "WAVES" },
  { num: 5, label: "SAVE" },
];

interface Props {
  onBack: () => void;
  onLaunchScenario: (
    scenario: Record<string, unknown>,
    baseId: string,
    placement: PlacementConfig,
  ) => void;
}

const DEFAULT_ROE = [
  "Positive identification required before any engagement",
  "Do not engage tracks classified as FRIENDLY or CIVILIAN",
  "Electronic countermeasures authorized against confirmed hostile UAS",
  "Kinetic engagement authorized only when electronic defeat is ineffective or unavailable",
  "All engagements must occur within the weapon engagement zone (WEZ)",
];

function totalQty(list: { catalogId: string; qty: number }[]): number {
  return list.reduce((sum, item) => sum + item.qty, 0);
}

function equipmentCatalogCounts(equipment: SelectedEquipment): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (catalogId: string, qty: number) => {
    counts.set(catalogId, (counts.get(catalogId) ?? 0) + qty);
  };

  for (const item of equipment.sensors) add(item.catalogId, item.qty);
  for (const item of equipment.effectors) add(item.catalogId, item.qty);
  for (const item of equipment.combined) add(item.catalogId, item.qty);
  return counts;
}

function placedCatalogCounts(systems: PlacedSystem[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const sys of systems) {
    counts.set(sys.def.id, (counts.get(sys.def.id) ?? 0) + 1);
  }
  return counts;
}

function catalogCountsMatch(required: Map<string, number>, placed: Map<string, number>): boolean {
  if (required.size === 0 || required.size !== placed.size) return false;

  for (const [catalogId, qty] of required) {
    if (placed.get(catalogId) !== qty) return false;
  }
  return true;
}

function emptySelectedEquipment(): SelectedEquipment {
  return { sensors: [], effectors: [], combined: [] };
}

function buildPlacement(
  baseTemplate: BaseTemplate,
  systems: PlacedSystem[],
  boundary: number[][],
): PlacementConfig {
  const baseLat = baseTemplate.center_lat ?? 32.5;
  const baseLng = baseTemplate.center_lng ?? 45.5;
  const finalBoundary = boundary.length ? boundary : baseTemplate.boundary;
  const xs = finalBoundary.map(([x]) => x);
  const ys = finalBoundary.map(([, y]) => y);
  const width = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  const height = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
  const maxDim = Math.max(width, height);
  const placementBoundsKm = Math.max(maxDim * 1.5, baseTemplate.placement_bounds_km);

  const placement: PlacementConfig = {
    base_id: baseTemplate.id,
    sensors: [],
    effectors: [],
    combined: [],
    boundary: finalBoundary,
    placement_bounds_km: placementBoundsKm,
  };

  for (const sys of systems) {
    const { x, y } = latLngToGameXY(sys.lat, sys.lng, baseLat, baseLng);
    const item = { catalog_id: sys.def.id, x, y, facing_deg: sys.facing_deg };
    if (sys.def.category === "sensor") placement.sensors.push(item);
    else if (sys.def.category === "effector") placement.effectors.push(item);
    else placement.combined.push(item);
  }

  return placement;
}

function buildScenarioJson(
  scenarioName: string,
  instructorNotes: string,
  waves: WaveDef[],
): Record<string, unknown> {
  const name = scenarioName.trim() || "Custom Scenario";
  const firstType = asDroneType(normalizeWaves(waves)[0]?.threatGroups[0]?.droneType);
  const firstTemplate = DRONE_TEMPLATES[firstType];

  return {
    id: generateScenarioId(name),
    name,
    description: instructorNotes.trim() || "Custom instructor-built scenario.",
    difficulty: "Custom",
    duration_seconds: computeScenarioDuration(waves),
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
  systems,
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
  systems: PlacedSystem[];
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

  const sensorCount = systems.filter((sys) => sys.def.category === "sensor" || sys.def.category === "combined").length;
  const effectorCount = systems.filter((sys) => sys.def.category === "effector" || sys.def.category === "combined").length;
  const expectedSystems = totalQty(selectedEquipment.sensors) + totalQty(selectedEquipment.effectors) + totalQty(selectedEquipment.combined);
  const placedSystemsMatchSelection = catalogCountsMatch(
    equipmentCatalogCounts(selectedEquipment),
    placedCatalogCounts(systems),
  );
  const canFinalize = waves.length > 0 && scenarioName.trim().length > 0 && placedSystemsMatchSelection;

  const assemble = useCallback(() => {
    const scenario = buildScenarioJson(scenarioName, instructorNotes, waves);
    const placement = buildPlacement(baseTemplate, systems, boundary);
    return { scenario, placement };
  }, [baseTemplate, boundary, instructorNotes, scenarioName, systems, waves]);

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
                <SummaryRow label="Placed Systems" value={`${systems.length}/${expectedSystems}`} />
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
          {canFinalize ? "Ready to save or launch" : "Place all systems, add at least one wave, and name the scenario"}
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

function ScenarioStepIndicator({
  currentStep,
  completedSteps,
  onStepClick,
}: {
  currentStep: ScenarioBuilderStep;
  completedSteps: Set<ScenarioBuilderStep>;
  onStepClick: (step: ScenarioBuilderStep) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 0,
        padding: "12px 16px",
        background: COLORS.card,
        borderBottom: `1px solid ${COLORS.border}`,
      }}
    >
      {SCENARIO_BUILDER_STEPS.map((step, i) => {
        const isActive = step.num === currentStep;
        const isCompleted = completedSteps.has(step.num);
        const isClickable = isCompleted && step.num !== currentStep;

        return (
          <React.Fragment key={step.num}>
            {i > 0 && (
              <div
                style={{
                  width: 40,
                  height: 2,
                  background: completedSteps.has(SCENARIO_BUILDER_STEPS[i - 1].num) ? COLORS.accent : COLORS.border,
                  margin: "0 4px",
                }}
              />
            )}
            <button
              onClick={() => isClickable && onStepClick(step.num)}
              disabled={!isClickable}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "none",
                border: "none",
                cursor: isClickable ? "pointer" : "default",
                padding: 0,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: isActive || isCompleted ? COLORS.accent : COLORS.border,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: 13,
                  color: isActive || isCompleted ? COLORS.bg : COLORS.muted,
                  fontFamily: "'Inter', sans-serif",
                }}
              >
                {isCompleted && !isActive ? "✓" : step.num}
              </div>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: isActive ? 700 : 500,
                  color: isActive ? COLORS.accent : isCompleted ? COLORS.accent : COLORS.muted,
                  letterSpacing: 0.5,
                  fontFamily: "'Inter', sans-serif",
                }}
              >
                {step.label}
              </span>
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default function ScenarioBuilder({ onBack, onLaunchScenario }: Props) {
  const [currentStep, setCurrentStep] = useState<ScenarioBuilderStep>(1);

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
  const [systems, setSystems] = useState<PlacedSystem[]>([]);

  // Step 4 state
  const [waves, setWaves] = useState<WaveDef[]>([]);

  // Step 5 state
  const [scenarioName, setScenarioName] = useState("");
  const [instructorNotes, setInstructorNotes] = useState("");

  const completedSteps = useMemo(() => {
    const completed = new Set<ScenarioBuilderStep>();
    if (selectedBaseId && baseTemplate) completed.add(1);
    const selectedCounts = equipmentCatalogCounts(selectedEquipment);
    const totalEquipment = Array.from(selectedCounts.values()).reduce((sum, qty) => sum + qty, 0);
    if (totalEquipment > 0) completed.add(2);
    if (catalogCountsMatch(selectedCounts, placedCatalogCounts(systems))) completed.add(3);
    if (waves.length > 0) completed.add(4);
    if (scenarioName.trim() && waves.length > 0 && catalogCountsMatch(selectedCounts, placedCatalogCounts(systems))) {
      completed.add(5);
    }
    return completed;
  }, [baseTemplate, scenarioName, selectedBaseId, selectedEquipment, systems, waves]);

  const goToStep = useCallback((step: ScenarioBuilderStep) => {
    setCurrentStep(step);
  }, []);

  const handleBaseSelect = useCallback((baseId: string, template: BaseTemplate) => {
    const baseChanged =
      baseId !== selectedBaseId ||
      template.id !== baseTemplate?.id ||
      template.center_lat !== baseTemplate?.center_lat ||
      template.center_lng !== baseTemplate?.center_lng;

    setSelectedBaseId(baseId);
    setBaseTemplate(template);
    setBoundary(template.boundary ?? []);
    if (baseChanged) {
      setSelectedEquipment(emptySelectedEquipment());
      setSystems([]);
      setWaves([]);
      setScenarioName("");
      setInstructorNotes("");
    }
  }, [baseTemplate, selectedBaseId]);

  const handleEquipmentChange = useCallback((equipment: SelectedEquipment) => {
    setSelectedEquipment(equipment);
    setSystems([]);
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
      <ScenarioStepIndicator
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
          maxSensors={baseTemplate.max_sensors}
          maxEffectors={baseTemplate.max_effectors}
        />
      )}

      {currentStep === 3 && baseTemplate && (
        <BdaPlacement
          baseTemplate={baseTemplate}
          selectedEquipment={selectedEquipment}
          systems={systems}
          boundary={boundary}
          onSystemsChange={setSystems}
          onBoundaryChange={setBoundary}
          onBack={() => setCurrentStep(2)}
          onNext={() => setCurrentStep(4)}
        />
      )}

      {currentStep === 4 && baseTemplate && (
        <WaveComposer
          waves={waves}
          onWavesChange={handleWavesChange}
          onBack={() => setCurrentStep(3)}
          onNext={() => setCurrentStep(5)}
        />
      )}

      {currentStep === 5 && baseTemplate && selectedBaseId && (
        <ScenarioSummary
          baseTemplate={baseTemplate}
          selectedBaseId={selectedBaseId}
          selectedEquipment={selectedEquipment}
          systems={systems}
          boundary={boundary.length ? boundary : baseTemplate.boundary}
          waves={waves}
          scenarioName={scenarioName}
          instructorNotes={instructorNotes}
          onScenarioNameChange={setScenarioName}
          onInstructorNotesChange={setInstructorNotes}
          onBack={() => setCurrentStep(4)}
          onLaunchScenario={onLaunchScenario}
        />
      )}
    </div>
  );
}
