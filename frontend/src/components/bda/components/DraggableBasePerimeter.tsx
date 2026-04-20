import { useEffect, useMemo, useState, type SetStateAction } from "react";
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
  const svg = `<svg width="12" height="12" viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg">
    <circle cx="6" cy="6" r="5" fill="#d29922" stroke="#ffb800" stroke-width="1.5" opacity="0.85"/>
    <line x1="3" y1="6" x2="9" y2="6" stroke="#ffb800" stroke-width="1.5"/>
    <line x1="6" y1="3" x2="6" y2="9" stroke="#ffb800" stroke-width="1.5"/>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
}

function createPolygonLabel(text: string, hint: string): L.DivIcon {
  const html = `<div style="text-align:center;pointer-events:none;">
    <span style="font:600 10px 'JetBrains Mono',monospace;color:#d29922;white-space:nowrap;background:rgba(13,17,23,0.85);padding:2px 6px;border-radius:3px;border:1px solid #d2992244;">${text}</span><br/>
    <span style="font:500 8px 'JetBrains Mono',monospace;color:#8b949e;white-space:nowrap;background:rgba(13,17,23,0.85);padding:1px 5px;border-radius:2px;">${hint}</span>
  </div>`;
  return L.divIcon({
    html,
    className: "",
    iconSize: [200, 28],
    iconAnchor: [100, 14],
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
  boundary?: number[][];
  onBoundaryChange?: (boundary: number[][]) => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function DraggableBasePerimeter({
  baseLat,
  baseLng,
  placementBoundsKm,
  boundary,
  onBoundaryChange,
}: Props) {
  const half = placementBoundsKm / 2;
  const defaultBoundary = useMemo(
    () => [
      [-half, -half],
      [-half, half],
      [half, half],
      [half, -half],
    ],
    [half],
  );
  // Keep the default simple: 4 main sides, with midpoint handles for quick refinement
  const [perimVertices, setPerimVertices] = useState<{ x: number; y: number }[]>(
    (boundary?.length ? boundary : defaultBoundary).map(([x, y]) => ({ x, y })),
  );

  useEffect(() => {
    if (boundary?.length) {
      setPerimVertices(boundary.map(([x, y]) => ({ x, y })));
    }
  }, [boundary]);

  const updateVertices = (updater: SetStateAction<{ x: number; y: number }[]>) => {
    setPerimVertices((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      onBoundaryChange?.(next.map((v) => [v.x, v.y]));
      return next;
    });
  };

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
                updateVertices((prev) =>
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
                  updateVertices((prev) => prev.filter((_, j) => j !== i));
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
                updateVertices((prev) => [
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
        icon={createPolygonLabel(
          `${perimVertices.length} pts \u2014 ${perimArea.toFixed(1)} km\u00B2`,
          'click \u2295 to add \u2022 right-click to remove',
        )}
        interactive={false}
      />
    </>
  );
}
