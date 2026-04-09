import { useMemo, useState } from "react";
import { Polygon, Marker } from "react-leaflet";
import L from "leaflet";
import { gameXYToLatLng, latLngToGameXY } from "../../../utils/coordinates";

// ─── Leaflet icons ──────────────────────────────────────────────────────────

function createCornerHandle(): L.DivIcon {
  const svg = `<svg width="14" height="14" viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg">
    <circle cx="7" cy="7" r="6" fill="#d29922" stroke="#ffb800" stroke-width="1.5" opacity="0.9"/>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function createMidpointHandle(): L.DivIcon {
  const svg = `<svg width="10" height="10" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg">
    <circle cx="5" cy="5" r="4" fill="#d29922" stroke="#ffb800" stroke-width="1" opacity="0.6"/>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  });
}

function createPolygonLabel(text: string): L.DivIcon {
  const html = `<span style="font:600 10px 'JetBrains Mono',monospace;color:#d29922;white-space:nowrap;pointer-events:none;background:rgba(13,17,23,0.85);padding:2px 6px;border-radius:3px;border:1px solid #d2992244;">${text}</span>`;
  return L.divIcon({
    html,
    className: "",
    iconSize: [120, 16],
    iconAnchor: [60, 8],
  });
}

// ─── Geometry helpers ───────────────────────────────────────────────────────

function shoelaceArea(vertices: { x: number; y: number }[]): number {
  let area = 0;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += vertices[i].x * vertices[j].y;
    area -= vertices[j].x * vertices[i].y;
  }
  return Math.abs(area) / 2;
}

function verticesCentroid(vertices: { x: number; y: number }[]): { x: number; y: number } {
  let cx = 0;
  let cy = 0;
  for (const v of vertices) {
    cx += v.x;
    cy += v.y;
  }
  return { x: cx / vertices.length, y: cy / vertices.length };
}

// ─── Props ──────────────────────────────────────────────────────────────────

interface Props {
  baseLat: number;
  baseLng: number;
  placementBoundsKm: number;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function DraggableBasePerimeter({
  baseLat,
  baseLng,
  placementBoundsKm,
}: Props) {
  const half = placementBoundsKm / 2;
  const [perimVertices, setPerimVertices] = useState<{ x: number; y: number }[]>([
    { x: -half, y: -half },
    { x: -half, y: half },
    { x: half, y: half },
    { x: half, y: -half },
  ]);

  const perimPositions = useMemo(
    () => perimVertices.map((v) => gameXYToLatLng(v.x, v.y, baseLat, baseLng)),
    [perimVertices, baseLat, baseLng],
  );

  const perimArea = useMemo(() => shoelaceArea(perimVertices), [perimVertices]);
  const perimCentroid = useMemo(() => verticesCentroid(perimVertices), [perimVertices]);
  const perimLabelPos = useMemo(
    () => gameXYToLatLng(perimCentroid.x, perimCentroid.y, baseLat, baseLng),
    [perimCentroid, baseLat, baseLng],
  );

  const perimMidpoints = useMemo(() => {
    return perimVertices.map((v, i) => {
      const next = perimVertices[(i + 1) % perimVertices.length];
      return {
        x: (v.x + next.x) / 2,
        y: (v.y + next.y) / 2,
        afterIndex: i,
      };
    });
  }, [perimVertices]);

  return (
    <>
      {/* Freeform polygon perimeter */}
      <Polygon
        positions={perimPositions}
        pathOptions={{
          color: "#d29922",
          fillColor: "#d29922",
          fillOpacity: 0.06,
          weight: 2,
          dashArray: "8,4",
        }}
      />
      {/* Vertex drag handles */}
      {perimVertices.map((v, i) => {
        const pos = gameXYToLatLng(v.x, v.y, baseLat, baseLng);
        return (
          <Marker
            key={`perim-v-${i}`}
            position={pos}
            icon={createCornerHandle()}
            draggable
            eventHandlers={{
              dragend: (e: L.LeafletEvent) => {
                const latlng = (e.target as L.Marker).getLatLng();
                const { x, y } = latLngToGameXY(latlng.lat, latlng.lng, baseLat, baseLng);
                setPerimVertices((prev) =>
                  prev.map((pv, j) =>
                    j === i
                      ? { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }
                      : pv,
                  ),
                );
              },
              contextmenu: (e: L.LeafletMouseEvent) => {
                L.DomEvent.preventDefault(e.originalEvent);
                L.DomEvent.stopPropagation(e.originalEvent);
                if (perimVertices.length > 3) {
                  setPerimVertices((prev) => prev.filter((_, j) => j !== i));
                }
              },
            }}
          />
        );
      })}
      {/* Midpoint handles -- click to insert vertex */}
      {perimMidpoints.map((mp, i) => {
        const pos = gameXYToLatLng(mp.x, mp.y, baseLat, baseLng);
        return (
          <Marker
            key={`perim-mid-${i}`}
            position={pos}
            icon={createMidpointHandle()}
            eventHandlers={{
              click: (e: L.LeafletMouseEvent) => {
                L.DomEvent.stopPropagation(e.originalEvent);
                const insertIdx = mp.afterIndex + 1;
                setPerimVertices((prev) => [
                  ...prev.slice(0, insertIdx),
                  { x: Math.round(mp.x * 100) / 100, y: Math.round(mp.y * 100) / 100 },
                  ...prev.slice(insertIdx),
                ]);
              },
            }}
          />
        );
      })}
      {/* Polygon centroid label */}
      <Marker
        position={perimLabelPos}
        icon={createPolygonLabel(`${perimVertices.length} pts \u2014 ${perimArea.toFixed(1)} km\u00B2`)}
        interactive={false}
      />
    </>
  );
}
