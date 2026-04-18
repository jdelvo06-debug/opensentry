import type { SensorStatus } from "../types";

export function getSensorDisplayLabel(sensor: SensorStatus, sensorConfigs: SensorStatus[]): string {
  const matchingSensors = sensorConfigs.filter((candidate) => candidate.name === sensor.name);
  if (matchingSensors.length <= 1 || /#\d+\b/.test(sensor.name)) {
    return sensor.name || sensor.id;
  }

  const instanceIndex = matchingSensors.findIndex((candidate) => candidate.id === sensor.id);
  return instanceIndex === -1 ? (sensor.name || sensor.id) : `${sensor.name} #${instanceIndex + 1}`;
}

export function getActiveCameraSensor(
  sensorConfigs: SensorStatus[],
  selectedCameraId: string | null | undefined,
): SensorStatus | null {
  if (selectedCameraId) {
    const selectedCamera = sensorConfigs.find((sensor) => sensor.id === selectedCameraId);
    if (selectedCamera) return selectedCamera;
  }

  return sensorConfigs.find(
    (sensor) => sensor.type === "eoir" || sensor.name?.toLowerCase().includes("camera") || sensor.name?.toLowerCase().includes("eo"),
  ) ?? null;
}
