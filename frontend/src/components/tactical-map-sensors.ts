import type { SensorStatus } from "../types";

export function getSensorDisplayLabel(sensor: SensorStatus, sensorConfigs: SensorStatus[]): string {
  const sensorName = sensor.name ?? sensor.id ?? "SENSOR";
  const matchingSensors = sensorConfigs.filter((candidate) => (candidate.name ?? candidate.id ?? "SENSOR") === sensorName);
  if (matchingSensors.length <= 1 || /#\d+\b/.test(sensorName)) {
    return sensorName;
  }

  const instanceIndex = matchingSensors.findIndex((candidate) => candidate.id === sensor.id);
  return instanceIndex === -1 ? sensorName : `${sensorName} #${instanceIndex + 1}`;
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
