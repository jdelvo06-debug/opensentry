import { Polygon, Marker } from "react-leaflet";
import { gameXYToLatLng } from "../../utils/coordinates";
import {
  createCornerHandle,
  createMidpointHandle,
  shoelaceArea,
  verticesCentroid,
} from "./mapConstants";
import L from "leaflet";

interface BoundaryEditorProps {
  vertices: { x: number; y: number }[];
  baseLat: number;
  baseLng: number;
  onChange: (vertices: { x: number; y: number }[]) => void;
}

export default function BoundaryEditor({
  vertices,
  baseLat,
  baseLng,
  onChange,
}: BoundaryEditorProps) {
  const positions = vertices.map((v) =>
    gameXYToLatLng(v.x, v.y, baseLat, baseLng),
  );

  const centroid = verticesCentroid(vertices);
  const centroidLatLng = gameXYToLatLng(centroid.x, centroid.y, baseLat, baseLng);
  const area = shoelaceArea(vertices);

  const handleVertexDrag = (index: number, e: L.LeafletEvent) => {
    const latlng = (e.target as L.Marker).getLatLng();
    const kmPerDegLat = 111.32;
    const kmPerDegLng = 111.32 * Math.cos((baseLat * Math.PI) / 180);
    const x = (latlng.lng - baseLng) * kmPerDegLng;
    const y = (latlng.lat - baseLat) * kmPerDegLat;
    const updated = [...vertices];
    updated[index] = { x, y };
    onChange(updated);
  };

  const handleVertexDelete = (index: number) => {
    if (vertices.length <= 3) return;
    const updated = vertices.filter((_, i) => i !== index);
    onChange(updated);
  };

  const handleMidpointInsert = (afterIndex: number) => {
    const a = vertices[afterIndex];
    const b = vertices[(afterIndex + 1) % vertices.length];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const updated = [...vertices];
    updated.splice(afterIndex + 1, 0, mid);
    onChange(updated);
  };

  return (
    <>
      <Polygon
        positions={positions}
        pathOptions={{
          color: "#d29922",
          weight: 2,
          dashArray: "8,4",
          fillColor: "#d29922",
          fillOpacity: 0.06,
        }}
      />

      {vertices.map((_, i) => (
        <Marker
          key={`vertex-${i}`}
          position={positions[i]}
          icon={createCornerHandle()}
          draggable
          eventHandlers={{
            dragend: (e) => handleVertexDrag(i, e),
            contextmenu: (e) => {
              L.DomEvent.preventDefault(e);
              handleVertexDelete(i);
            },
          }}
        />
      ))}

      {vertices.map((_, i) => {
        const next = (i + 1) % vertices.length;
        const midLat = (positions[i][0] + positions[next][0]) / 2;
        const midLng = (positions[i][1] + positions[next][1]) / 2;
        return (
          <Marker
            key={`mid-${i}`}
            position={[midLat, midLng]}
            icon={createMidpointHandle()}
            eventHandlers={{
              click: () => handleMidpointInsert(i),
            }}
          />
        );
      })}

      <Marker
        position={centroidLatLng}
        icon={L.divIcon({
          className: "",
          html: `<div style="
            font-size:11px;color:#d29922;
            text-shadow:0 0 4px #0a0e1a;
            white-space:nowrap;text-align:center;
            pointer-events:none;
          ">${vertices.length} vertices | ${area.toFixed(3)} km&sup2;</div>`,
          iconSize: [120, 16],
          iconAnchor: [60, 8],
        })}
      />
    </>
  );
}
