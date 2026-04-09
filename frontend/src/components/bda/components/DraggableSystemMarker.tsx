import { useMemo, useRef } from "react";
import { Marker } from "react-leaflet";
import L from "leaflet";
import type { PlacedSystem } from "../types";

function createSystemIcon(
  letter: string,
  color: string,
  selected: boolean,
): L.DivIcon {
  const bgColor = selected ? "#1a8fff" : color;
  const borderColor = selected ? "#ffffff" : color;
  const glow = selected ? "0 0 12px rgba(59,130,246,0.6)" : "none";
  return L.divIcon({
    html: `<div style="
      width:32px;height:32px;display:flex;align-items:center;justify-content:center;
      background:${bgColor};border:2px solid ${borderColor};border-radius:50%;
      font-size:14px;font-weight:700;color:#fff;box-shadow:${glow};cursor:grab;
      font-family:'Inter','JetBrains Mono',monospace;letter-spacing:0.5px;
    ">${letter}</div>`,
    className: "",
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

interface Props {
  system: PlacedSystem;
  selected: boolean;
  onSelect: () => void;
  onDragEnd: (lat: number, lng: number) => void;
}

export default function DraggableSystemMarker({
  system,
  selected,
  onSelect,
  onDragEnd,
}: Props) {
  const markerRef = useRef<L.Marker>(null);
  const icon = useMemo(
    () => createSystemIcon(system.def.letter, system.def.color, selected),
    [system.def.letter, system.def.color, selected],
  );

  const eventHandlers = useMemo(
    () => ({
      click: (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        onSelect();
      },
      dragend: () => {
        const m = markerRef.current;
        if (m) {
          const pos = m.getLatLng();
          onDragEnd(pos.lat, pos.lng);
        }
      },
    }),
    [onSelect, onDragEnd],
  );

  return (
    <Marker
      ref={markerRef}
      position={[system.lat, system.lng]}
      icon={icon}
      draggable
      eventHandlers={eventHandlers}
    />
  );
}
