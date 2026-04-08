import type { EffectorStatus } from "../types";

interface Props {
  effectors: EffectorStatus[];
  activeJammers?: Record<string, number>;
}

const STATUS_COLORS: Record<string, string> = {
  ready: "#3fb950",
  recharging: "#d29922",
  offline: "#f85149",
  depleted: "#f85149",
  radiating: "#58a6ff",
};

function EffectorRow({ eff, activeJammers }: { eff: EffectorStatus; activeJammers: Record<string, number> }) {
  const isDepleted = eff.ammo_remaining != null && eff.ammo_remaining <= 0;
  const isRadiating = eff.id in activeJammers;
  const effectiveStatus = isDepleted ? "depleted" : isRadiating ? "radiating" : eff.status;
  const color = STATUS_COLORS[effectiveStatus] || "#484f58";
  const displayName = eff.name || eff.id.toUpperCase();
  return (
    <div key={eff.id} style={{ display:"flex", alignItems:"center", gap:8, height:36, padding:"0 4px", borderRadius:4, marginBottom:2 }}>
      <div style={{ width:8, height:8, borderRadius:"50%", background:color, flexShrink:0 }} />
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:11, fontWeight:600, color:"#e6edf3", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{displayName}</div>
        {eff.ammo_remaining != null && (
          <div style={{ fontSize:9, color:"#8b949e" }}>AMMO: {eff.ammo_remaining}</div>
        )}
      </div>
      <div style={{ fontSize:9, color, fontWeight:700, letterSpacing:.5, flexShrink:0 }}>
        {effectiveStatus.toUpperCase().replace("_", " ")}
      </div>
    </div>
  );
}

export default function EffectorPanel({ effectors, activeJammers = {} }: Props) {
  const standaloneEffectors = effectors.filter((e) => !e.id.startsWith("combined_effector_"));
  const combinedEffectors = effectors.filter((e) => e.id.startsWith("combined_effector_"));

  // Group combined effectors by system name (strip "combined_effector_N_" prefix → get base name)
  const combinedNames = [...new Set(combinedEffectors.map((e) => {
    const match = e.name || e.id.replace(/^combined_effector_\d+_/, "").toUpperCase();
    return match;
  }))];

  return (
    <div style={{ padding: "12px 12px 8px" }}>
      {standaloneEffectors.length > 0 && (
        <>
          <div style={{ fontSize:10, fontWeight:600, color:"#8b949e", letterSpacing:1.5, marginBottom:10 }}>EFFECTORS</div>
          {standaloneEffectors.map((eff) => (
            <EffectorRow key={eff.id} eff={eff} activeJammers={activeJammers} />
          ))}
        </>
      )}
      {combinedEffectors.length > 0 && (
        <>
          <div style={{ fontSize:10, fontWeight:600, color:"#8b949e", letterSpacing:1.5, marginBottom:10, marginTop: standaloneEffectors.length > 0 ? 12 : 0 }}>COMBINED</div>
          {combinedEffectors.map((eff) => {
            // Show a clean name: strip the "combined_effector_N_" prefix
            const cleanName = eff.name || eff.id.replace(/^combined_effector_\d+_/, "").toUpperCase();
            return <EffectorRow key={eff.id} eff={{ ...eff, name: cleanName }} activeJammers={activeJammers} />;
          })}
        </>
      )}
    </div>
  );
}
