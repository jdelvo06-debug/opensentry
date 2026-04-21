import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Circle,
  Polygon,
  Marker,
  ScaleControl,
  LayersControl,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import type { BaseTemplate } from "../../types";
import type { PlacedSystem, SelectedEquipment, SystemDef } from "./types";
import { COLORS, buildSystemDefs } from "./constants";
import {
  computeViewshed,
  computeFovCone,
  viewshedCache,
  cacheKey,
  offsetLatLng,
  NUM_RAYS,
} from "./viewshed";
import { gameXYToLatLng } from "../../utils/coordinates";

import MapClickHandler from "./components/MapClickHandler";
import DraggableSystemMarker from "./components/DraggableSystemMarker";
import EquipmentPalette, { type PaletteItem } from "./components/EquipmentPalette";
import SystemDetailPanel from "./components/SystemDetailPanel";
import DraggableBasePerimeter from "./components/DraggableBasePerimeter";

// ─── Leaflet icon for ring labels ───────────────────────────────────────────

function createRingLabel(
  name: string,
  rangeKm: number,
  color: string,
): L.DivIcon {
  return L.divIcon({
    html: `<span style="font:600 9px 'JetBrains Mono',monospace;color:${color};white-space:nowrap;pointer-events:none;background:rgba(10,14,26,0.75);padding:1px 5px;border-radius:2px;">${name} \u2014 ${rangeKm}km</span>`,
    className: "",
    iconSize: [120, 14],
    iconAnchor: [60, 7],
  });
}

// ─── Leaflet icon for protected assets ──────────────────────────────────────

function createAssetIcon(priority: number): L.DivIcon {
  const color =
    priority === 1
      ? COLORS.danger
      : priority === 2
        ? COLORS.warning
        : COLORS.muted;
  return L.divIcon({
    html: `<div style="font-size:16px;color:${color};text-shadow:0 0 4px rgba(0,0,0,0.8);text-align:center;line-height:1;">&#9733;</div>`,
    className: "",
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

// ─── FlyTo component ────────────────────────────────────────────────────────

function MapFlyTo({ lat, lng, zoom }: { lat: number; lng: number; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo([lat, lng], zoom ?? map.getZoom(), { duration: 1.5 });
  }, [lat, lng, zoom, map]);
  return null;
}

// ─── Helper ─────────────────────────────────────────────────────────────────

function isNarrowFov(def: SystemDef): boolean {
  return def.fov_deg < 360;
}

// ─── Props ──────────────────────────────────────────────────────────────────

interface Props {
  baseTemplate: BaseTemplate;
  selectedEquipment: SelectedEquipment;
  systems: PlacedSystem[];
  boundary: number[][];
  onSystemsChange: (systems: PlacedSystem[]) => void;
  onBoundaryChange: (boundary: number[][]) => void;
  onBack: () => void;
  onNext: () => void;
}

const GENERIC_BASE_IDS = new Set(["small_fob", "medium_airbase", "large_installation"]);

export default function BdaPlacement({
  baseTemplate,
  selectedEquipment,
  systems,
  boundary,
  onSystemsChange,
  onBoundaryChange,
  onBack,
  onNext,
}: Props) {
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [activeDef, setActiveDef] = useState<SystemDef | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const uidCounter = useRef(0);
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number; zoom: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ name: string; lat: number; lng: number }[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Keep counter ahead of existing systems
  useEffect(() => {
    for (const sys of systems) {
      const num = parseInt(sys.uid.replace("sys_", ""), 10);
      if (!isNaN(num) && num >= uidCounter.current) {
        uidCounter.current = num + 1;
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Geo search ───────────────────────────────────────────────────────

  const handleGeoSearch = useCallback((query: string) => {
    setSearchQuery(query);
    if (query.trim().length < 2) { setSearchResults([]); return; }
    setSearchLoading(true);
    fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`,
      { headers: { "Accept-Language": "en", "User-Agent": "OpenSentry-BDA/1.0" } },
    )
      .then((res) => res.json())
      .then((data) => {
        setSearchResults(
          data.map((r: { display_name: string; lat: string; lon: string }) => ({
            name: r.display_name.split(",").slice(0, 2).join(","),
            lat: parseFloat(r.lat),
            lng: parseFloat(r.lon),
          })),
        );
        setSearchLoading(false);
      })
      .catch(() => { setSearchResults([]); setSearchLoading(false); });
  }, []);

  // ─── Save perimeter ───────────────────────────────────────────────────

  const handleSavePerimeter = useCallback(async () => {
    setSaveStatus("saving");
    // Derive a valid base_id from the name for custom locations
    const baseId = baseTemplate.id === "custom" || baseTemplate.id === "custom_location"
      ? baseTemplate.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").replace(/_+/g, "_")
      : baseTemplate.id;
    try {
      const res = await fetch(`http://localhost:8000/bases/${baseId}/polygon`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          boundary,
          center_lat: baseTemplate.center_lat,
          center_lng: baseTemplate.center_lng,
          base_name: baseTemplate.name,
          base_size: baseTemplate.size,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setSaveStatus("error");
      } else {
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 3000);
      }
    } catch {
      setSaveStatus("error");
    }
  }, [boundary, baseTemplate]);

  // ─── Map center ───────────────────────────────────────────────────────

  const mapCenter: [number, number] = useMemo(
    () => [baseTemplate.center_lat ?? 33.9722, baseTemplate.center_lng ?? -80.4756],
    [baseTemplate.center_lat, baseTemplate.center_lng],
  );

  const baseLat = baseTemplate.center_lat ?? 32.5;
  const baseLng = baseTemplate.center_lng ?? 45.5;

  // ─── Build catalog-based SystemDef lookup ────────────────────────────

  const [catalog, setCatalog] = useState<import("../../types").EquipmentCatalog | null>(null);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/equipment/catalog.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => setCatalog(data))
      .catch((err) => console.warn("[BdaPlacement] Failed to load catalog:", err));
  }, []);

  const allDefs = useMemo(() => (catalog ? buildSystemDefs(catalog) : []), [catalog]);

  const defMap = useMemo(() => {
    const m = new Map<string, SystemDef>();
    for (const d of allDefs) m.set(d.id, d);
    return m;
  }, [allDefs]);

  // ─── Build palette items from selectedEquipment ──────────────────────

  const paletteItems: PaletteItem[] = useMemo(() => {
    const items: PaletteItem[] = [];
    const groups = [
      ...selectedEquipment.sensors,
      ...selectedEquipment.effectors,
      ...selectedEquipment.combined,
    ];

    // Track instance numbers per catalogId
    const instanceCounts = new Map<string, number>();

    for (const grp of groups) {
      const def = defMap.get(grp.catalogId);
      if (!def) continue;
      for (let i = 0; i < grp.qty; i++) {
        const count = (instanceCounts.get(grp.catalogId) ?? 0) + 1;
        instanceCounts.set(grp.catalogId, count);
        const label =
          grp.qty > 1 ? `${def.name} #${count}` : def.name;

        // Check how many of this catalogId are placed
        const placedOfType = systems.filter((s) => s.def.id === grp.catalogId).length;
        items.push({
          def,
          totalQty: 1,
          placedQty: i < placedOfType ? 1 : 0,
          instanceLabel: label,
        });
      }
    }
    return items;
  }, [selectedEquipment, defMap, systems]);

  const allPlaced = useMemo(
    () =>
      paletteItems.length > 0 &&
      paletteItems.every((it) => it.placedQty >= it.totalQty),
    [paletteItems],
  );

  // ─── Selected system ──────────────────────────────────────────────────

  const selectedSystem = useMemo(
    () => systems.find((s) => s.uid === selectedUid) ?? null,
    [systems, selectedUid],
  );

  // onSystemsChange is React's setState — supports both direct values and
  // functional updaters. Use functional form (prev => ...) to avoid stale closures.
  const setSystems = onSystemsChange as React.Dispatch<React.SetStateAction<PlacedSystem[]>>;

  // ─── Fetch viewshed ──────────────────────────────────────────────────

  const fetchViewshedForSystem = useCallback(
    (uid: string, lat: number, lng: number, alt: number, rangeKm: number) => {
      const key = cacheKey(lat, lng, alt, rangeKm);
      const cached = viewshedCache.get(key);
      if (cached) {
        setSystems((prev) =>
          prev.map((s) =>
            s.uid === uid
              ? {
                  ...s,
                  viewshed: cached.polygon,
                  blockedSectors: cached.blockedSectors,
                  viewshedArea: cached.area,
                  viewshedStats: cached.stats,
                  viewshedLoading: false,
                }
              : s,
          ),
        );
        return;
      }

      setSystems((prev) =>
        prev.map((s) => (s.uid === uid ? { ...s, viewshedLoading: true } : s)),
      );

      computeViewshed(lat, lng, alt, rangeKm)
        .then((result) => {
          viewshedCache.set(key, result);
          setSystems((prev) =>
            prev.map((s) =>
              s.uid === uid
                ? {
                    ...s,
                    viewshed: result.polygon,
                    blockedSectors: result.blockedSectors,
                    viewshedArea: result.area,
                    viewshedStats: result.stats,
                    viewshedLoading: false,
                  }
                : s,
            ),
          );
        })
        .catch((err) => {
          console.warn(
            `[BDA] Viewshed fetch failed for ${uid}:`,
            err.message || err,
          );
          const fallbackPoly: [number, number][] = [];
          for (let i = 0; i <= NUM_RAYS; i++) {
            const bearing = (i / NUM_RAYS) * 2 * Math.PI;
            fallbackPoly.push(offsetLatLng(lat, lng, rangeKm, bearing));
          }
          const area = Math.PI * rangeKm * rangeKm;
          setSystems((prev) =>
            prev.map((s) =>
              s.uid === uid
                ? {
                    ...s,
                    viewshed: fallbackPoly,
                    blockedSectors: [],
                    viewshedArea: area,
                    viewshedStats: null,
                    viewshedLoading: false,
                  }
                : s,
            ),
          );
        });
    },
    [setSystems],
  );

  // ─── Place handler ────────────────────────────────────────────────────

  const handlePlace = useCallback(
    (lat: number, lng: number) => {
      if (!activeDef) return;
      const uid = `sys_${++uidCounter.current}`;
      const newSystem: PlacedSystem = {
        uid,
        def: activeDef,
        lat,
        lng,
        altitude: 10,
        facing_deg: 0,
        viewshed: null,
        blockedSectors: null,
        viewshedLoading: false,
        viewshedArea: null,
        viewshedStats: null,
        visible: true,
      };
      setSystems((prev) => [...prev, newSystem]);
      setSelectedUid(uid);

      // Check if there are more instances of this type to place
      const placedOfType = systems.filter(s => s.def.id === activeDef.id).length + 1;
      const totalOfType = [...selectedEquipment.sensors, ...selectedEquipment.effectors, ...selectedEquipment.combined]
        .filter(g => g.catalogId === activeDef.id)
        .reduce((sum, g) => sum + g.qty, 0);
      if (placedOfType >= totalOfType) {
        setActiveDef(null);
      }

      if (activeDef.requires_los && activeDef.range_km) {
        fetchViewshedForSystem(uid, lat, lng, 10, activeDef.range_km);
      }
    },
    [activeDef, systems, selectedEquipment, setSystems, fetchViewshedForSystem],
  );

  // ─── Drag end ─────────────────────────────────────────────────────────

  const handleDragEnd = useCallback(
    (uid: string, lat: number, lng: number) => {
      const sys = systems.find((s) => s.uid === uid);
      if (!sys) return;
      setSystems((prev) =>
        prev.map((s) => (s.uid === uid ? { ...s, lat, lng } : s)),
      );
      if (sys.def.requires_los && sys.def.range_km) {
        fetchViewshedForSystem(uid, lat, lng, sys.altitude, sys.def.range_km);
      }
    },
    [systems, setSystems, fetchViewshedForSystem],
  );

  // ─── Altitude change ──────────────────────────────────────────────────

  const handleAltitudeChange = useCallback(
    (uid: string, newAlt: number) => {
      const sys = systems.find((s) => s.uid === uid);
      if (!sys) return;
      setSystems((prev) =>
        prev.map((s) =>
          s.uid === uid
            ? {
                ...s,
                altitude: newAlt,
                viewshed: null,
                blockedSectors: null,
                viewshedArea: null,
                viewshedStats: null,
                viewshedLoading: sys.def.requires_los,
              }
            : s,
        ),
      );
      if (sys.def.requires_los && sys.def.range_km) {
        fetchViewshedForSystem(uid, sys.lat, sys.lng, newAlt, sys.def.range_km);
      }
    },
    [systems, setSystems, fetchViewshedForSystem],
  );

  // ─── Rotate ───────────────────────────────────────────────────────────

  const handleRotate = useCallback(
    (uid: string, deltaDeg: number) => {
      setSystems((prev) =>
        prev.map((s) =>
          s.uid === uid
            ? { ...s, facing_deg: (s.facing_deg + deltaDeg + 360) % 360 }
            : s,
        ),
      );
    },
    [setSystems],
  );

  // ─── Delete ───────────────────────────────────────────────────────────

  const handleDelete = useCallback(
    (uid: string) => {
      setSystems((prev) => prev.filter((s) => s.uid !== uid));
      if (selectedUid === uid) setSelectedUid(null);
    },
    [selectedUid, setSystems],
  );

  // ─── Toggle visibility ────────────────────────────────────────────────

  const handleToggleVisibility = useCallback(
    (uid: string) => {
      setSystems((prev) =>
        prev.map((s) => (s.uid === uid ? { ...s, visible: !s.visible } : s)),
      );
    },
    [setSystems],
  );

  const handleShowAll = useCallback(() => {
    setSystems((prev) => prev.map((s) => ({ ...s, visible: true })));
  }, [setSystems]);

  const handleHideAll = useCallback(() => {
    setSystems((prev) => prev.map((s) => ({ ...s, visible: false })));
  }, [setSystems]);

  // ─── Recalculate viewshed ─────────────────────────────────────────────

  const handleRecalculate = useCallback(
    (uid: string) => {
      const sys = systems.find((s) => s.uid === uid);
      if (sys && sys.def.requires_los && sys.def.range_km) {
        const key = cacheKey(sys.lat, sys.lng, sys.altitude, sys.def.range_km);
        viewshedCache.delete(key);
        fetchViewshedForSystem(uid, sys.lat, sys.lng, sys.altitude, sys.def.range_km);
      }
    },
    [systems, fetchViewshedForSystem],
  );

  // ─── Derived ──────────────────────────────────────────────────────────

  const loadingSystems = systems.filter((s) => s.viewshedLoading).length;

  // ─── Coordinate conversion helpers for base template features ─────────

  const boundaryPositions = useMemo(() => {
    if (!baseTemplate.boundary?.length) return [];
    return baseTemplate.boundary.map(([x, y]) =>
      gameXYToLatLng(x, y, baseLat, baseLng),
    );
  }, [baseTemplate.boundary, baseLat, baseLng]);

  const terrainFeatures = useMemo(() => {
    if (!baseTemplate.terrain?.length) return [];
    return baseTemplate.terrain.map((t) => ({
      ...t,
      positions: t.polygon.map(([x, y]) => gameXYToLatLng(x, y, baseLat, baseLng)),
    }));
  }, [baseTemplate.terrain, baseLat, baseLng]);

  const assetPositions = useMemo(() => {
    if (!baseTemplate.protected_assets?.length) return [];
    return baseTemplate.protected_assets.map((a) => ({
      ...a,
      position: gameXYToLatLng(a.x, a.y, baseLat, baseLng) as [number, number],
    }));
  }, [baseTemplate.protected_assets, baseLat, baseLng]);

  const corridorLines = useMemo(() => {
    if (!baseTemplate.approach_corridors?.length) return [];
    const center: [number, number] = [baseLat, baseLng];
    return baseTemplate.approach_corridors.map((c) => {
      const bearingRad = (c.bearing_deg * Math.PI) / 180;
      const endPoint = offsetLatLng(center[0], center[1], 15, bearingRad);
      return { name: c.name, positions: [center, endPoint] as [[number, number], [number, number]] };
    });
  }, [baseTemplate.approach_corridors, baseLat, baseLng]);

  // ─── Render ───────────────────────────────────────────────────────────

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: COLORS.bg,
        color: COLORS.text,
        fontFamily: "'Inter', 'JetBrains Mono', monospace",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 16px",
          background: COLORS.card,
          borderBottom: `1px solid ${COLORS.border}`,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={onBack}
            style={{
              padding: "4px 12px",
              fontSize: 11,
              fontWeight: 600,
              background: "transparent",
              border: `1px solid ${COLORS.border}`,
              borderRadius: 4,
              color: COLORS.muted,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            &lt; BACK
          </button>
          <button
            onClick={handleSavePerimeter}
            disabled={GENERIC_BASE_IDS.has(baseTemplate.id) || saveStatus === "saving"}
            title={GENERIC_BASE_IDS.has(baseTemplate.id) ? "Cannot save generic templates" : "Save boundary to preset file"}
            style={{
              padding: "4px 12px",
              fontSize: 11,
              fontWeight: 600,
              background: "transparent",
              border: `1px solid ${
                saveStatus === "saved" ? COLORS.success :
                saveStatus === "error" ? COLORS.danger :
                GENERIC_BASE_IDS.has(baseTemplate.id) ? COLORS.border :
                COLORS.accent
              }`,
              borderRadius: 4,
              color: saveStatus === "saved" ? COLORS.success :
                     saveStatus === "error" ? COLORS.danger :
                     GENERIC_BASE_IDS.has(baseTemplate.id) ? COLORS.muted :
                     COLORS.accent,
              cursor: GENERIC_BASE_IDS.has(baseTemplate.id) || saveStatus === "saving" ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              opacity: GENERIC_BASE_IDS.has(baseTemplate.id) ? 0.4 : 1,
            }}
          >
            {saveStatus === "saving" ? "SAVING..." :
             saveStatus === "saved" ? "SAVED!" :
             saveStatus === "error" ? "SAVE FAILED" :
             "SAVE PERIMETER"}
          </button>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1, color: COLORS.text }}>
              PLACE SYSTEMS
            </div>
            <div style={{ fontSize: 10, color: COLORS.muted }}>
              {baseTemplate.name}
              {activeDef && (
                <span style={{ color: COLORS.accent, marginLeft: 12 }}>
                  PLACING: {activeDef.name} &mdash; click map
                </span>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={onNext}
          disabled={!allPlaced}
          style={{
            padding: "6px 18px",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1,
            background: allPlaced ? COLORS.accent : `${COLORS.accent}40`,
            border: `1px solid ${allPlaced ? COLORS.accent : COLORS.border}`,
            borderRadius: 5,
            color: allPlaced ? COLORS.bg : COLORS.muted,
            cursor: allPlaced ? "pointer" : "not-allowed",
            fontFamily: "inherit",
          }}
        >
          {allPlaced ? "NEXT \u25B6" : "Place all systems to continue"}
        </button>
      </div>

      {/* 3-panel layout */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Left: Equipment Palette */}
        <EquipmentPalette
          items={paletteItems}
          activeDef={activeDef}
          onSelectDef={setActiveDef}
        />

        {/* Center: Map */}
        <div style={{ flex: 1, position: "relative" }}>
          <MapContainer
            center={mapCenter}
            zoom={baseTemplate.default_zoom ?? 14}
            style={{ width: "100%", height: "100%" }}
            zoomControl={false}
          >
            <MapFlyTo
              lat={flyTo?.lat ?? mapCenter[0]}
              lng={flyTo?.lng ?? mapCenter[1]}
              zoom={flyTo?.zoom ?? baseTemplate.default_zoom ?? 14}
            />
            <ScaleControl position="bottomleft" />
            <LayersControl position="topright">
              <LayersControl.BaseLayer name="Dark">
                <TileLayer
                  url="https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                  maxZoom={20}
                />
              </LayersControl.BaseLayer>
              <LayersControl.BaseLayer name="Satellite" checked>
                <TileLayer
                  url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                  maxZoom={19}
                />
              </LayersControl.BaseLayer>
              <LayersControl.BaseLayer name="Topo">
                <TileLayer
                  url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
                  maxZoom={17}
                />
              </LayersControl.BaseLayer>
            </LayersControl>

            <MapClickHandler
              active={activeDef !== null}
              placingDef={activeDef}
              onMapClick={handlePlace}
            />

            {/* Draggable base boundary */}
            <DraggableBasePerimeter
              baseLat={baseLat}
              baseLng={baseLng}
              placementBoundsKm={baseTemplate.placement_bounds_km}
              boundary={boundary}
              onBoundaryChange={onBoundaryChange}
            />

            {/* Terrain features */}
            {terrainFeatures.map((t) => (
              <Polygon
                key={t.id}
                positions={t.positions}
                pathOptions={{
                  color: t.blocks_los ? COLORS.warning : COLORS.muted,
                  fillColor: t.blocks_los ? COLORS.warning : COLORS.muted,
                  fillOpacity: t.blocks_los ? 0.15 : 0.08,
                  weight: 1,
                }}
              />
            ))}

            {/* Protected assets */}
            {assetPositions.map((a) => (
              <Marker
                key={a.id}
                position={a.position}
                icon={createAssetIcon(a.priority)}
                interactive={false}
              />
            ))}

            {/* Approach corridors */}
            {corridorLines.map((c) => (
              <Polygon
                key={c.name}
                positions={c.positions}
                pathOptions={{
                  color: COLORS.danger,
                  weight: 1,
                  dashArray: "6,4",
                  fillOpacity: 0,
                }}
              />
            ))}

            {/* Viewshed polygons (green) */}
            {systems
              .filter((sys) => sys.visible)
              .map(
                (sys) =>
                  sys.viewshed && (
                    <Polygon
                      key={`vs-${sys.uid}`}
                      positions={sys.viewshed}
                      pathOptions={{
                        color: COLORS.success,
                        fillColor: COLORS.success,
                        fillOpacity: selectedUid === sys.uid ? 0.25 : 0.15,
                        weight: selectedUid === sys.uid ? 2 : 1,
                      }}
                    />
                  ),
              )}

            {/* Blocked sectors (red) */}
            {systems
              .filter((sys) => sys.visible)
              .map((sys) =>
                sys.blockedSectors?.map((sector, i) => (
                  <Polygon
                    key={`bl-${sys.uid}-${i}`}
                    positions={sector}
                    pathOptions={{
                      color: COLORS.danger,
                      fillColor: COLORS.danger,
                      fillOpacity: selectedUid === sys.uid ? 0.2 : 0.1,
                      weight: 0,
                    }}
                  />
                )),
              )}

            {/* Range rings for non-LOS systems (respects visibility toggle) */}
            {systems.filter((sys) => sys.visible).map((sys) => {
              if (sys.def.requires_los) return null;
              if (sys.def.category === "combined") {
                return (
                  <React.Fragment key={`rr-${sys.uid}`}>
                    <Circle
                      center={[sys.lat, sys.lng]}
                      radius={
                        (sys.def.sensor_range_km ?? sys.def.range_km) * 1000
                      }
                      pathOptions={{
                        color: "#388bfd",
                        fillColor: "#388bfd",
                        fillOpacity: 0.06,
                        weight: 1,
                        dashArray: "6,4",
                      }}
                    />
                    <Circle
                      center={[sys.lat, sys.lng]}
                      radius={
                        (sys.def.effector_range_km ?? sys.def.range_km) * 1000
                      }
                      pathOptions={{
                        color: "#f85149",
                        fillColor: "#f85149",
                        fillOpacity: 0.06,
                        weight: 1,
                        dashArray: "6,4",
                      }}
                    />
                  </React.Fragment>
                );
              }
              return (
                <Circle
                  key={`rr-${sys.uid}`}
                  center={[sys.lat, sys.lng]}
                  radius={sys.def.range_km * 1000}
                  pathOptions={{
                    color: sys.def.color,
                    fillColor: sys.def.color,
                    fillOpacity: 0.06,
                    weight: 1,
                    dashArray: "6,4",
                  }}
                />
              );
            })}

            {/* FOV cones for narrow-FOV systems (respects visibility toggle) */}
            {systems.filter((sys) => sys.visible).map((sys) => {
              if (!isNarrowFov(sys.def)) return null;
              const cone = computeFovCone(
                sys.lat,
                sys.lng,
                sys.def.range_km,
                sys.facing_deg,
                sys.def.fov_deg,
              );
              return (
                <Polygon
                  key={`fov-${sys.uid}`}
                  positions={cone}
                  pathOptions={{
                    color: sys.def.color,
                    fillColor: sys.def.color,
                    fillOpacity: selectedUid === sys.uid ? 0.25 : 0.15,
                    weight: selectedUid === sys.uid ? 2 : 1,
                  }}
                />
              );
            })}

            {/* Range ring labels (respects visibility toggle) */}
            {systems.filter((sys) => sys.visible).map((sys) => {
              if (sys.def.category === "combined") {
                return (
                  <React.Fragment key={`rl-${sys.uid}`}>
                    <Marker
                      position={[
                        sys.lat +
                          (sys.def.sensor_range_km ?? sys.def.range_km) / 111.32,
                        sys.lng,
                      ]}
                      icon={createRingLabel(
                        `${sys.def.name} DET`,
                        sys.def.sensor_range_km ?? sys.def.range_km,
                        "#388bfd",
                      )}
                      interactive={false}
                    />
                    <Marker
                      position={[
                        sys.lat +
                          (sys.def.effector_range_km ?? sys.def.range_km) /
                            111.32,
                        sys.lng + 0.01,
                      ]}
                      icon={createRingLabel(
                        `${sys.def.name} DEF`,
                        sys.def.effector_range_km ?? sys.def.range_km,
                        "#f85149",
                      )}
                      interactive={false}
                    />
                  </React.Fragment>
                );
              }
              return (
                <Marker
                  key={`rl-${sys.uid}`}
                  position={[sys.lat + sys.def.range_km / 111.32, sys.lng]}
                  icon={createRingLabel(sys.def.name, sys.def.range_km, sys.def.color)}
                  interactive={false}
                />
              );
            })}

            {/* Fallback range ring for LOS systems while viewshed not loaded */}
            {systems.filter((sys) => sys.visible).map(
              (sys) =>
                sys.def.requires_los &&
                !sys.viewshed &&
                !sys.viewshedLoading &&
                !isNarrowFov(sys.def) && (
                  <Circle
                    key={`rr-fallback-${sys.uid}`}
                    center={[sys.lat, sys.lng]}
                    radius={sys.def.range_km * 1000}
                    pathOptions={{
                      color: sys.def.color,
                      fillColor: sys.def.color,
                      fillOpacity: 0.06,
                      weight: 1,
                      dashArray: "6,4",
                    }}
                  />
                ),
            )}

            {/* System markers */}
            {systems.map((sys) => (
              <DraggableSystemMarker
                key={sys.uid}
                system={sys}
                selected={selectedUid === sys.uid}
                onSelect={() => setSelectedUid(sys.uid)}
                onDragEnd={(lat, lng) => handleDragEnd(sys.uid, lat, lng)}
              />
            ))}
          </MapContainer>

          {/* Geo search overlay */}
          <div
            style={{
              position: "absolute",
              top: 10,
              left: 10,
              zIndex: 1000,
              width: 260,
            }}
          >
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleGeoSearch(e.target.value)}
              placeholder="Search location..."
              style={{
                width: "100%",
                padding: "8px 10px",
                background: `${COLORS.card}ee`,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 6,
                color: COLORS.text,
                fontSize: 12,
                fontFamily: "'Inter', sans-serif",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
            {searchLoading && (
              <div style={{ fontSize: 11, color: COLORS.muted, padding: "4px 8px", background: `${COLORS.card}ee`, borderRadius: 4, marginTop: 2 }}>
                Searching...
              </div>
            )}
            {searchResults.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 2 }}>
                {searchResults.map((r, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setFlyTo({ lat: r.lat, lng: r.lng, zoom: 14 });
                      setSearchQuery(r.name);
                      setSearchResults([]);
                    }}
                    style={{
                      background: `${COLORS.card}ee`,
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: 4,
                      padding: "6px 8px",
                      color: COLORS.text,
                      fontSize: 11,
                      cursor: "pointer",
                      textAlign: "left",
                      fontFamily: "'Inter', sans-serif",
                    }}
                  >
                    {r.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Loading indicator overlay */}
          {loadingSystems > 0 && (
            <div
              style={{
                position: "absolute",
                top: 10,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 1000,
                background: `${COLORS.card}ee`,
                border: `1px solid ${COLORS.warning}`,
                borderRadius: 6,
                padding: "8px 16px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 11,
                fontWeight: 600,
                color: COLORS.warning,
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 12,
                  height: 12,
                  border: `2px solid ${COLORS.warning}40`,
                  borderTop: `2px solid ${COLORS.warning}`,
                  borderRadius: "50%",
                  animation: "bda-spin 0.8s linear infinite",
                }}
              />
              Computing viewshed ({loadingSystems} remaining)...
            </div>
          )}

          <style>{`
            @keyframes bda-spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
        </div>

        {/* Right: System Detail Panel */}
        <SystemDetailPanel
          systems={systems}
          selectedSystem={selectedSystem}
          onSelectSystem={setSelectedUid}
          onAltitudeChange={handleAltitudeChange}
          onRotate={handleRotate}
          onToggleVisibility={handleToggleVisibility}
          onShowAll={handleShowAll}
          onHideAll={handleHideAll}
          onDelete={handleDelete}
          onRecalculate={handleRecalculate}
        />
      </div>
    </div>
  );
}
