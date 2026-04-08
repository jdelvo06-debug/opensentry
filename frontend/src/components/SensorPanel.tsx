import type { SensorStatus } from "../types";

interface Props {
  sensors: SensorStatus[];
}

const STATUS_COLORS: Record<string, string> = {
  active: "#3fb950",
  degraded: "#d29922",
  offline: "#f85149",
  standby: "#484f58",
};

const SENSOR_ICONS: Record<string, string> = {
  radar: "RADAR",
  rf_detector: "RF DETECTOR",
  eo_ir: "EO/IR CAMERA",
  acoustic: "ACOUSTIC",
};

export default function SensorPanel({ sensors }: Props) {
  // Filter out combined system sensors — shown in EffectorPanel's COMBINED section
  const standaloneSensors = sensors.filter((s) => !s.id.startsWith("combined_sensor_"));
  return (
    <div
      style={{
        padding: "12px 12px 8px",
        borderBottom: "1px solid #30363d",
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: "#8b949e",
          letterSpacing: 1.5,
          marginBottom: 10,
        }}
      >
        SENSORS
      </div>
      {standaloneSensors.map((sensor) => {
        const color = STATUS_COLORS[sensor.status] || "#484f58";
        const displayName =
          sensor.name || SENSOR_ICONS[sensor.type || ""] || sensor.id.toUpperCase();
        return (
          <div
            key={sensor.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              height: 36,
              padding: "0 4px",
              borderRadius: 4,
              marginBottom: 2,
            }}
          >
            {/* Status dot */}
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: color,
                boxShadow: sensor.status === "active" ? `0 0 6px ${color}88` : "none",
                flexShrink: 0,
              }}
            />
            {/* Name */}
            <div
              style={{
                flex: 1,
                fontSize: 11,
                fontWeight: 500,
                color: "#e6edf3",
                letterSpacing: 0.5,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {displayName}
            </div>
          </div>
        );
      })}
    </div>
  );
}
