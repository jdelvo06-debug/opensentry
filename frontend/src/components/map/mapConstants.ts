import L from "leaflet";
export {
  shoelaceArea,
  verticesCentroid,
  polygonCentroid,
  degToRad,
} from "./mapGeometry";

// ─── Terrain type styles ────────────────────────────────────────────────────

export const TERRAIN_STYLES: Record<
  string,
  { fill: string; stroke: string; label: string }
> = {
  building: { fill: "#6e7681", stroke: "#484f58", label: "Building" },
  tower: { fill: "#8b949e", stroke: "#6e7681", label: "Tower" },
  berm: { fill: "#8b6914", stroke: "#6e4b0a", label: "Berm" },
  treeline: { fill: "#2ea043", stroke: "#1a7f37", label: "Treeline" },
  runway: { fill: "#484f58", stroke: "#30363d", label: "Runway" },
};

// ─── Asset priority colors ──────────────────────────────────────────────────

export const PRIORITY_COLORS: Record<number, string> = {
  1: "#f85149",
  2: "#d29922",
  3: "#2ea043",
};

// ─── Icon factories ─────────────────────────────────────────────────────────

export function createTerrainLabel(name: string): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="
      font-size:10px;
      color:#c9d1d9;
      text-shadow:0 0 3px #0a0e1a,0 0 6px #0a0e1a;
      white-space:nowrap;
      text-align:center;
      pointer-events:none;
    ">${name}</div>`,
    iconSize: [80, 16],
    iconAnchor: [40, 8],
  });
}

export function createAssetIcon(priority: number, name: string): L.DivIcon {
  const color = PRIORITY_COLORS[priority] || PRIORITY_COLORS[3];
  return L.divIcon({
    className: "",
    html: `<div style="text-align:center;">
      <svg width="20" height="20" viewBox="0 0 20 20">
        <polygon points="10,0 13,7 20,7 14,12 16,20 10,15 4,20 6,12 0,7 7,7"
          fill="${color}" stroke="#fff" stroke-width="1"/>
      </svg>
      <div style="font-size:9px;color:${color};text-shadow:0 0 3px #0a0e1a;white-space:nowrap;margin-top:-2px;">
        P${priority} ${name}
      </div>
    </div>`,
    iconSize: [80, 32],
    iconAnchor: [40, 10],
  });
}

export function createCornerHandle(): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:12px;height:12px;border-radius:50%;
      background:#d29922;border:2px solid #fff;
      cursor:grab;
    "></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
}

export function createMidpointHandle(): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:8px;height:8px;border-radius:50%;
      background:#d29922;opacity:0.5;border:1px solid #fff;
      cursor:pointer;
    "></div>`,
    iconSize: [8, 8],
    iconAnchor: [4, 4],
  });
}

// Geometry helpers are in mapGeometry.ts (re-exported above)
