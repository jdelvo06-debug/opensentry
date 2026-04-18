import { useState } from "react";
import type { SensorStatus, EffectorStatus } from "../types";

interface Props {
  sensors: SensorStatus[];
  effectors: EffectorStatus[];
  activeJammers?: Record<string, number>;
}

const STATUS_COLORS: Record<string, string> = {
  active: "#3fb950",
  degraded: "#d29922",
  offline: "#f85149",
  standby: "#484f58",
  ready: "#3fb950",
  recharging: "#d29922",
  depleted: "#f85149",
  radiating: "#58a6ff",
};

function CollapsibleGroup({
  title,
  count,
  defaultOpen = true,
  children,
}: {
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{ borderBottom: "1px solid #21262d" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          padding: "4px 8px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "#8b949e",
        }}
      >
        <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: 1.5 }}>
          {title}
        </span>
        <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: 1, display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ color: "#484f58" }}>{count}</span>
          <span style={{ fontSize: 8, transform: open ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.15s" }}>▼</span>
        </span>
      </button>
      {open && <div style={{ padding: "2px 8px 6px" }}>{children}</div>}
    </div>
  );
}

function SensorRow({ sensor }: { sensor: SensorStatus }) {
  const color = STATUS_COLORS[sensor.status] || "#484f58";
  const displayName = sensor.name || sensor.type?.toUpperCase() || sensor.id.toUpperCase();

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        height: 22,
        padding: "0 2px",
        borderRadius: 3,
        marginBottom: 1,
      }}
    >
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: color,
          boxShadow: sensor.status === "active" ? `0 0 4px ${color}88` : "none",
          flexShrink: 0,
        }}
      />
      <div
        style={{
          flex: 1,
          fontSize: 10,
          fontWeight: 500,
          color: "#e6edf3",
          letterSpacing: 0.3,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {displayName}
      </div>
    </div>
  );
}

function EffectorRow({ eff, activeJammers }: { eff: EffectorStatus; activeJammers: Record<string, number> }) {
  const isDepleted = eff.ammo_remaining != null && eff.ammo_remaining <= 0;
  const isRadiating = eff.id in activeJammers;
  const effectiveStatus = isDepleted ? "depleted" : isRadiating ? "radiating" : eff.status;
  const color = STATUS_COLORS[effectiveStatus] || "#484f58";
  const displayName = eff.name || eff.id.toUpperCase();

  return (
    <div
      key={eff.id}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        height: 22,
        padding: "0 2px",
        borderRadius: 3,
        marginBottom: 1,
      }}
    >
      <div style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: "#e6edf3", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {displayName}
        </div>
      </div>
      {eff.ammo_remaining != null && (
        <div style={{ fontSize: 8, color: "#8b949e", flexShrink: 0 }}>{eff.ammo_remaining}</div>
      )}
      <div style={{ fontSize: 8, color, fontWeight: 700, letterSpacing: 0.4, flexShrink: 0 }}>
        {effectiveStatus.toUpperCase().replace("_", " ")}
      </div>
    </div>
  );
}

export default function SystemsPanel({ sensors, effectors, activeJammers = {} }: Props) {
  const standaloneSensors = sensors.filter((s) => !s.id.startsWith("combined_sensor_"));
  const standaloneEffectors = effectors.filter((e) => !e.id.startsWith("combined_effector_"));
  const combinedEffectors = effectors.filter((e) => e.id.startsWith("combined_effector_"));

  const hasCombined = combinedEffectors.length > 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {standaloneSensors.length > 0 && (
        <div data-tutorial-id="tutorial-sensors">
          <CollapsibleGroup title="SENSORS" count={standaloneSensors.length}>
            {standaloneSensors.map((sensor) => (
              <SensorRow key={sensor.id} sensor={sensor} />
            ))}
          </CollapsibleGroup>
        </div>
      )}

      {standaloneEffectors.length > 0 && (
        <div data-tutorial-id="tutorial-effectors">
          <CollapsibleGroup title="EFFECTORS" count={standaloneEffectors.length}>
            {standaloneEffectors.map((eff) => (
              <EffectorRow key={eff.id} eff={eff} activeJammers={activeJammers} />
            ))}
          </CollapsibleGroup>
        </div>
      )}

      {hasCombined && (
        <CollapsibleGroup title="COMBINED" count={combinedEffectors.length}>
          {combinedEffectors.map((eff) => {
            const cleanName = eff.name || eff.id.replace(/^combined_effector_\d+_/, "").toUpperCase();
            return <EffectorRow key={eff.id} eff={{ ...eff, name: cleanName }} activeJammers={activeJammers} />;
          })}
        </CollapsibleGroup>
      )}
    </div>
  );
}