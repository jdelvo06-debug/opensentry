import React, { useState, useCallback, useMemo } from "react";
import type { BaseTemplate, PlacementConfig } from "../types";
import type { BdaStep, PlacedSystem, SelectedEquipment } from "./bda/types";
import { COLORS } from "./bda/constants";
import BdaStepIndicator from "./bda/BdaStepIndicator";
import BdaBaseSelection from "./bda/BdaBaseSelection";
import BdaEquipmentSelection from "./bda/BdaEquipmentSelection";
import BdaPlacement from "./bda/BdaPlacement";
import BdaExport from "./bda/BdaExport";

interface Props {
  onBack: () => void;
  onExportToMission?: (placement: PlacementConfig, scenarioId: string, baseId: string, baseTemplate: BaseTemplate) => void;
}

export default function BaseDefenseArchitect({ onBack, onExportToMission }: Props) {
  const [currentStep, setCurrentStep] = useState<BdaStep>(1);

  // Step 1 state
  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null);
  const [baseTemplate, setBaseTemplate] = useState<BaseTemplate | null>(null);

  // Step 2 state
  const [selectedEquipment, setSelectedEquipment] = useState<SelectedEquipment>({
    sensors: [],
    effectors: [],
    combined: [],
  });

  // Step 3 state
  const [systems, setSystems] = useState<PlacedSystem[]>([]);

  // Track completed steps
  const completedSteps = useMemo(() => {
    const completed = new Set<BdaStep>();
    if (selectedBaseId && baseTemplate) completed.add(1);
    const totalEquipment =
      selectedEquipment.sensors.reduce((s, e) => s + e.qty, 0) +
      selectedEquipment.effectors.reduce((s, e) => s + e.qty, 0) +
      selectedEquipment.combined.reduce((s, e) => s + e.qty, 0);
    if (totalEquipment > 0) completed.add(2);
    if (systems.length > 0) completed.add(3);
    return completed;
  }, [selectedBaseId, baseTemplate, selectedEquipment, systems]);

  const goToStep = useCallback((step: BdaStep) => {
    setCurrentStep(step);
  }, []);

  const handleBaseSelect = useCallback((baseId: string, template: BaseTemplate) => {
    // Warn if changing base and selected equipment exceeds new limits
    const totalCombined = selectedEquipment.combined.reduce((s, e) => s + e.qty, 0);
    const totalSensors = selectedEquipment.sensors.reduce((s, e) => s + e.qty, 0) + totalCombined;
    const totalEffectors = selectedEquipment.effectors.reduce((s, e) => s + e.qty, 0) + totalCombined;
    if (
      (totalSensors > template.max_sensors || totalEffectors > template.max_effectors) &&
      !window.confirm(
        `This base allows max ${template.max_sensors} sensors and ${template.max_effectors} effectors. ` +
        `You have ${totalSensors} sensors and ${totalEffectors} effectors selected. ` +
        `Change base anyway? You'll need to reduce equipment in step 2.`
      )
    ) {
      return;
    }
    setSelectedBaseId(baseId);
    setBaseTemplate(template);
  }, [selectedEquipment]);

  const handleEquipmentChange = useCallback((equipment: SelectedEquipment) => {
    setSelectedEquipment(equipment);
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
          maxSensors={baseTemplate.max_sensors}
          maxEffectors={baseTemplate.max_effectors}
          selectedEquipment={selectedEquipment}
          onUpdateEquipment={handleEquipmentChange}
          onBack={() => setCurrentStep(1)}
          onNext={() => setCurrentStep(3)}
        />
      )}

      {currentStep === 3 && baseTemplate && (
        <BdaPlacement
          baseTemplate={baseTemplate}
          selectedEquipment={selectedEquipment}
          systems={systems}
          onSystemsChange={setSystems}
          onBack={() => setCurrentStep(2)}
          onNext={() => setCurrentStep(4)}
        />
      )}

      {currentStep === 4 && baseTemplate && (
        <BdaExport
          baseTemplate={baseTemplate}
          systems={systems}
          onExportToMission={onExportToMission}
          onBack={() => setCurrentStep(3)}
          onBackToMenu={onBack}
        />
      )}
    </div>
  );
}
