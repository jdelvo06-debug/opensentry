import { useEffect } from "react";
import { useMap, useMapEvents } from "react-leaflet";
import type { SystemDef } from "../types";

interface Props {
  active: boolean;
  placingDef: SystemDef | null;
  onMapClick: (lat: number, lng: number) => void;
}

export default function MapClickHandler({ active, placingDef, onMapClick }: Props) {
  const map = useMap();

  useEffect(() => {
    if (placingDef) {
      map.getContainer().style.cursor = "crosshair";
    } else {
      map.getContainer().style.cursor = "";
    }
    return () => {
      map.getContainer().style.cursor = "";
    };
  }, [placingDef, map]);

  useMapEvents({
    click(e) {
      if (active) {
        onMapClick(e.latlng.lat, e.latlng.lng);
      }
    },
  });

  return null;
}
