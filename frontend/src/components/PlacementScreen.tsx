import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BaseTemplate,
  CatalogSensor,
  CatalogEffector,
  PlacedEquipment,
  PlacementConfig,
  TerrainFeature,
  ProtectedAsset,
} from "../types";

interface Props {
  baseTemplate: BaseTemplate;
  selectedSensors: CatalogSensor[];
  selectedEffectors: CatalogEffector[];
  onConfirm: (placement: PlacementConfig) => void;
  onBack: () => void;
}

interface PlacedItem {
  equipment: PlacedEquipment;
  kind: "sensor" | "effector";
  catalogIndex: number; // index into selectedSensors or selectedEffectors
}

type PaletteItem = {
  kind: "sensor" | "effector";
  index: number;
  catalog: CatalogSensor | CatalogEffector;
};

const SENSOR_TYPE_LETTERS: Record<string, string> = {
  radar: "R",
  rf: "F",
  eoir: "C",
  acoustic: "A",
};

const COLORS = {
  bg: "#0d1117",
  card: "#161b22",
  border: "#30363d",
  text: "#e6edf3",
  muted: "#8b949e",
  grid: "#1c2333",
  sensorRange: "#58a6ff44",
  effectorRange: "#f8514944",
  coverageOverlay: "#58a6ff08",
  accent: "#58a6ff",
  danger: "#f85149",
  warning: "#d29922",
  success: "#3fb950",
};

const TERRAIN_STYLES: Record<string, { fill: string; stroke: string }> = {
  building: { fill: "#30363d", stroke: "#484f58" },
  tower: { fill: "#484f58", stroke: "#8b949e" },
  berm: { fill: "#2d1f00", stroke: "#6e4b00" },
  treeline: { fill: "#0d2818", stroke: "#1a5c30" },
  runway: { fill: "#1c2333", stroke: "#30363d" },
};

const PRIORITY_COLORS: Record<number, string> = {
  1: "#f85149",
  2: "#d29922",
  3: "#3fb950",
};

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export default function PlacementScreen({
  baseTemplate,
  selectedSensors,
  selectedEffectors,
  onConfirm,
  onBack,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 800, h: 600 });
  const scaleRef = useRef(100); // px per km

  const [placedItems, setPlacedItems] = useState<PlacedItem[]>([]);
  const [selectedPalette, setSelectedPalette] = useState<number | null>(null); // index into paletteItems
  const [selectedPlaced, setSelectedPlaced] = useState<number | null>(null); // index into placedItems
  const [facingDeg, setFacingDeg] = useState(0);

  // Build palette list
  const paletteItems: PaletteItem[] = [
    ...selectedSensors.map((s, i) => ({
      kind: "sensor" as const,
      index: i,
      catalog: s,
    })),
    ...selectedEffectors.map((e, i) => ({
      kind: "effector" as const,
      index: i,
      catalog: e,
    })),
  ];

  // Track which palette items are placed
  const placedSet = new Set(
    placedItems.map((p) => `${p.kind}-${p.catalogIndex}`)
  );

  const allPlaced = paletteItems.every((pi) =>
    placedSet.has(`${pi.kind}-${pi.index}`)
  );

  // When selecting a placed item, sync facing slider
  useEffect(() => {
    if (selectedPlaced !== null && placedItems[selectedPlaced]) {
      setFacingDeg(placedItems[selectedPlaced].equipment.facing_deg);
    }
  }, [selectedPlaced, placedItems]);

  // Update facing of selected placed item
  const handleFacingChange = useCallback(
    (newFacing: number) => {
      setFacingDeg(newFacing);
      if (selectedPlaced !== null) {
        setPlacedItems((prev) =>
          prev.map((item, i) =>
            i === selectedPlaced
              ? {
                  ...item,
                  equipment: { ...item.equipment, facing_deg: newFacing },
                }
              : item
          )
        );
      }
    },
    [selectedPlaced]
  );

  // Coordinate conversion helpers
  const worldToCanvas = useCallback(
    (wx: number, wy: number): [number, number] => {
      const { w, h } = sizeRef.current;
      const scale = scaleRef.current;
      const cx = w / 2;
      const cy = h / 2;
      return [cx + wx * scale, cy - wy * scale];
    },
    []
  );

  const canvasToWorld = useCallback(
    (px: number, py: number): [number, number] => {
      const { w, h } = sizeRef.current;
      const scale = scaleRef.current;
      const cx = w / 2;
      const cy = h / 2;
      return [(px - cx) / scale, (cy - py) / scale];
    },
    []
  );

  // Get catalog data for a placed item
  const getCatalog = useCallback(
    (item: PlacedItem): CatalogSensor | CatalogEffector => {
      return item.kind === "sensor"
        ? selectedSensors[item.catalogIndex]
        : selectedEffectors[item.catalogIndex];
    },
    [selectedSensors, selectedEffectors]
  );

  // Canvas click handler
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;
      const [wx, wy] = canvasToWorld(clickX, clickY);

      // Check if clicking on an existing placed item
      const scale = scaleRef.current;
      for (let i = 0; i < placedItems.length; i++) {
        const item = placedItems[i];
        const [ix, iy] = worldToCanvas(item.equipment.x, item.equipment.y);
        const dist = Math.sqrt((clickX - ix) ** 2 + (clickY - iy) ** 2);
        if (dist < 16) {
          setSelectedPlaced(i);
          setSelectedPalette(null);
          return;
        }
      }

      // If a palette item is selected, place it
      if (selectedPalette !== null) {
        const pi = paletteItems[selectedPalette];
        const key = `${pi.kind}-${pi.index}`;

        // If already placed, reposition
        const existingIdx = placedItems.findIndex(
          (p) => `${p.kind}-${p.catalogIndex}` === key
        );

        const newEquipment: PlacedEquipment = {
          catalog_id: pi.catalog.catalog_id,
          x: Math.round(wx * 100) / 100,
          y: Math.round(wy * 100) / 100,
          facing_deg: facingDeg,
        };

        if (existingIdx >= 0) {
          setPlacedItems((prev) =>
            prev.map((item, i) =>
              i === existingIdx
                ? { ...item, equipment: newEquipment }
                : item
            )
          );
        } else {
          setPlacedItems((prev) => [
            ...prev,
            {
              equipment: newEquipment,
              kind: pi.kind,
              catalogIndex: pi.index,
            },
          ]);
        }
        setSelectedPalette(null);
        setSelectedPlaced(null);
      } else {
        // Deselect
        setSelectedPlaced(null);
      }
    },
    [
      canvasToWorld,
      worldToCanvas,
      placedItems,
      selectedPalette,
      paletteItems,
      facingDeg,
    ]
  );

  // Right-click / double-click to remove
  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      for (let i = 0; i < placedItems.length; i++) {
        const item = placedItems[i];
        const [ix, iy] = worldToCanvas(item.equipment.x, item.equipment.y);
        const dist = Math.sqrt((clickX - ix) ** 2 + (clickY - iy) ** 2);
        if (dist < 16) {
          setPlacedItems((prev) => prev.filter((_, idx) => idx !== i));
          if (selectedPlaced === i) setSelectedPlaced(null);
          else if (selectedPlaced !== null && selectedPlaced > i)
            setSelectedPlaced(selectedPlaced - 1);
          return;
        }
      }
    },
    [placedItems, worldToCanvas, selectedPlaced]
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      for (let i = 0; i < placedItems.length; i++) {
        const item = placedItems[i];
        const [ix, iy] = worldToCanvas(item.equipment.x, item.equipment.y);
        const dist = Math.sqrt((clickX - ix) ** 2 + (clickY - iy) ** 2);
        if (dist < 16) {
          setPlacedItems((prev) => prev.filter((_, idx) => idx !== i));
          if (selectedPlaced === i) setSelectedPlaced(null);
          else if (selectedPlaced !== null && selectedPlaced > i)
            setSelectedPlaced(selectedPlaced - 1);
          return;
        }
      }
    },
    [placedItems, worldToCanvas, selectedPlaced]
  );

  // ResizeObserver for canvas
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        sizeRef.current = { w: width, h: height };
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = width * devicePixelRatio;
          canvas.height = height * devicePixelRatio;
          canvas.style.width = `${width}px`;
          canvas.style.height = `${height}px`;
        }
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Coverage analysis for right sidebar
  const computeCoverage = useCallback(() => {
    const corridors = baseTemplate.approach_corridors;
    return corridors.map((corridor) => {
      const bearingRad = degToRad(corridor.bearing_deg);
      const halfWidth = degToRad(corridor.width_deg / 2);

      // Check which placed sensors cover this corridor bearing
      const coveringSensors: string[] = [];
      for (const item of placedItems) {
        if (item.kind !== "sensor") continue;
        const cat = selectedSensors[item.catalogIndex];
        const eq = item.equipment;

        if (cat.fov_deg >= 360) {
          // Omnidirectional — covers all corridors within range
          coveringSensors.push(cat.name);
          continue;
        }

        // Check if the corridor bearing falls within this sensor's FOV arc
        const facingRad = degToRad(eq.facing_deg);
        const halfFov = degToRad(cat.fov_deg / 2);

        let angleDiff = bearingRad - facingRad;
        // Normalize to [-PI, PI]
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

        if (Math.abs(angleDiff) <= halfFov + halfWidth) {
          coveringSensors.push(cat.name);
        }
      }

      return {
        name: corridor.name,
        bearing_deg: corridor.bearing_deg,
        covered: coveringSensors.length > 0,
        sensors: coveringSensors,
      };
    });
  }, [baseTemplate, placedItems, selectedSensors]);

  const coverage = computeCoverage();

  // Compute coverage percentage and weakest corridor
  const coveredCount = coverage.filter((c) => c.covered).length;
  const coveragePct =
    coverage.length > 0
      ? Math.round((coveredCount / coverage.length) * 100)
      : 0;

  // Find weakest corridor (fewest covering sensors, among those with least coverage)
  const weakestCorridor = (() => {
    if (coverage.length === 0) return null;
    let weakest = coverage[0];
    for (const c of coverage) {
      if (c.sensors.length < weakest.sensors.length) {
        weakest = c;
      }
    }
    // Only highlight if coverage is incomplete (at least one gap)
    return weakest.sensors.length === 0 ? weakest : null;
  })();

  // Canvas render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let running = true;

    function draw() {
      if (!running || !ctx || !canvas) return;

      const dpr = devicePixelRatio;
      const { w, h } = sizeRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const cx = w / 2;
      const cy = h / 2;

      // Compute scale from placement_bounds_km
      const boundsKm = baseTemplate.placement_bounds_km;
      const minDim = Math.min(w, h);
      const scale = (minDim * 0.4) / boundsKm;
      scaleRef.current = scale;

      // --- Background ---
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, w, h);

      // --- Grid at 0.1km ---
      const gridSpacingKm = 0.1;
      const gridPx = gridSpacingKm * scale;
      ctx.strokeStyle = COLORS.grid;
      ctx.lineWidth = 0.5;
      if (gridPx > 8) {
        // Only draw if grid lines are reasonably spaced
        for (let gx = cx % gridPx; gx < w; gx += gridPx) {
          ctx.beginPath();
          ctx.moveTo(gx, 0);
          ctx.lineTo(gx, h);
          ctx.stroke();
        }
        for (let gy = cy % gridPx; gy < h; gy += gridPx) {
          ctx.beginPath();
          ctx.moveTo(0, gy);
          ctx.lineTo(w, gy);
          ctx.stroke();
        }
      }

      // --- Base boundary polygon (dashed white) ---
      const boundary = baseTemplate.boundary;
      if (boundary.length > 0) {
        ctx.strokeStyle = "#ffffff88";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([8, 4]);
        ctx.beginPath();
        const [bx0, by0] = [
          cx + boundary[0][0] * scale,
          cy - boundary[0][1] * scale,
        ];
        ctx.moveTo(bx0, by0);
        for (let i = 1; i < boundary.length; i++) {
          ctx.lineTo(
            cx + boundary[i][0] * scale,
            cy - boundary[i][1] * scale
          );
        }
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // --- Terrain features ---
      for (const terrain of baseTemplate.terrain) {
        const style = TERRAIN_STYLES[terrain.type] || TERRAIN_STYLES.building;
        ctx.fillStyle = style.fill;
        ctx.strokeStyle = style.stroke;
        ctx.lineWidth = 1;

        if (terrain.polygon.length > 0) {
          ctx.beginPath();
          ctx.moveTo(
            cx + terrain.polygon[0][0] * scale,
            cy - terrain.polygon[0][1] * scale
          );
          for (let i = 1; i < terrain.polygon.length; i++) {
            ctx.lineTo(
              cx + terrain.polygon[i][0] * scale,
              cy - terrain.polygon[i][1] * scale
            );
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          // Label
          const centroid = polygonCentroid(terrain.polygon);
          ctx.font = "400 9px 'Inter', sans-serif";
          ctx.fillStyle = COLORS.muted;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(
            terrain.name,
            cx + centroid[0] * scale,
            cy - centroid[1] * scale
          );
        }
      }

      // --- Protected assets ---
      for (const asset of baseTemplate.protected_assets) {
        const ax = cx + asset.x * scale;
        const ay = cy - asset.y * scale;
        const color = PRIORITY_COLORS[asset.priority] || COLORS.muted;

        // Star marker
        drawStar(ctx, ax, ay, 6, 3, color);

        // Label
        ctx.font = "500 9px 'Inter', sans-serif";
        ctx.fillStyle = color;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(asset.name, ax, ay + 10);

        // Priority badge
        ctx.font = "600 7px 'JetBrains Mono', monospace";
        ctx.fillStyle = COLORS.bg;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.beginPath();
        ctx.arc(ax + 8, ay - 6, 5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.fillStyle = COLORS.bg;
        ctx.fillText(`${asset.priority}`, ax + 8, ay - 6);
      }

      // --- Approach corridors ---
      for (const corridor of baseTemplate.approach_corridors) {
        const bearingRad = degToRad(90 - corridor.bearing_deg); // convert to math angle (0=east, CCW)
        const corridorLen = boundsKm * scale * 1.2;

        ctx.strokeStyle = "#484f5866";
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(
          cx + Math.cos(bearingRad) * corridorLen,
          cy - Math.sin(bearingRad) * corridorLen
        );
        ctx.stroke();
        ctx.setLineDash([]);

        // Label at edge
        const labelDist = corridorLen * 0.85;
        ctx.font = "500 9px 'Inter', sans-serif";
        ctx.fillStyle = "#484f58";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(
          corridor.name,
          cx + Math.cos(bearingRad) * labelDist,
          cy - Math.sin(bearingRad) * labelDist
        );
      }

      // --- Coverage overlay ---
      // Draw coverage arcs for placed sensors
      for (const item of placedItems) {
        if (item.kind !== "sensor") continue;
        const cat = selectedSensors[item.catalogIndex];
        const eq = item.equipment;
        const ix = cx + eq.x * scale;
        const iy = cy - eq.y * scale;
        const rangeR = cat.range_km * scale;

        ctx.fillStyle = COLORS.coverageOverlay;
        ctx.beginPath();
        if (cat.fov_deg >= 360) {
          ctx.arc(ix, iy, rangeR, 0, Math.PI * 2);
        } else {
          const facingRad = degToRad(90 - eq.facing_deg);
          const halfFov = degToRad(cat.fov_deg / 2);
          ctx.moveTo(ix, iy);
          ctx.arc(ix, iy, rangeR, -facingRad - halfFov, -facingRad + halfFov);
          ctx.closePath();
        }
        ctx.fill();
      }

      // --- Placed items: range rings and icons ---
      for (let pi = 0; pi < placedItems.length; pi++) {
        const item = placedItems[pi];
        const cat = getCatalog(item);
        const eq = item.equipment;
        const ix = cx + eq.x * scale;
        const iy = cy - eq.y * scale;
        const rangeR = cat.range_km * scale;
        const isSelected = selectedPlaced === pi;
        const isSensor = item.kind === "sensor";
        const rangeColor = isSensor ? COLORS.sensorRange : COLORS.effectorRange;

        // Range ring / arc
        ctx.strokeStyle = rangeColor;
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.beginPath();
        if (cat.fov_deg >= 360) {
          ctx.arc(ix, iy, rangeR, 0, Math.PI * 2);
        } else {
          const facingRad = degToRad(90 - eq.facing_deg);
          const halfFov = degToRad(cat.fov_deg / 2);
          ctx.moveTo(ix, iy);
          ctx.arc(ix, iy, rangeR, -facingRad - halfFov, -facingRad + halfFov);
          ctx.closePath();
        }
        ctx.stroke();

        // FOV cone fill for limited FOV
        if (cat.fov_deg < 360) {
          ctx.fillStyle = rangeColor;
          ctx.beginPath();
          const facingRad = degToRad(90 - eq.facing_deg);
          const halfFov = degToRad(cat.fov_deg / 2);
          ctx.moveTo(ix, iy);
          ctx.arc(ix, iy, rangeR, -facingRad - halfFov, -facingRad + halfFov);
          ctx.closePath();
          ctx.fill();
        }

        // Selection highlight
        if (isSelected) {
          ctx.strokeStyle = "#ffffff88";
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.arc(ix, iy, 18, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Icon
        const iconSize = 10;
        if (isSensor) {
          // Circle with type letter
          ctx.fillStyle = isSelected ? "#58a6ff" : "#58a6ffbb";
          ctx.strokeStyle = "#58a6ff";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(ix, iy, iconSize, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          const letter =
            SENSOR_TYPE_LETTERS[(cat as CatalogSensor).type] || "?";
          ctx.font = "700 10px 'JetBrains Mono', monospace";
          ctx.fillStyle = COLORS.bg;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(letter, ix, iy);
        } else {
          // Diamond with first letter
          ctx.fillStyle = isSelected ? "#f85149" : "#f85149bb";
          ctx.strokeStyle = "#f85149";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(ix, iy - iconSize);
          ctx.lineTo(ix + iconSize, iy);
          ctx.lineTo(ix, iy + iconSize);
          ctx.lineTo(ix - iconSize, iy);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          const letter = cat.name.charAt(0).toUpperCase();
          ctx.font = "700 9px 'JetBrains Mono', monospace";
          ctx.fillStyle = COLORS.bg;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(letter, ix, iy);
        }

        // Name label
        ctx.font = "500 9px 'Inter', sans-serif";
        ctx.fillStyle = isSensor ? "#58a6ff" : "#f85149";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(cat.name, ix, iy + iconSize + 4);
      }

      // --- Base center marker ---
      ctx.fillStyle = COLORS.accent;
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fill();

      // --- Scale bar ---
      const scaleBarKm = boundsKm > 1 ? 1 : 0.5;
      const scaleBarLen = scaleBarKm * scale;
      ctx.strokeStyle = COLORS.muted;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(16, h - 24);
      ctx.lineTo(16 + scaleBarLen, h - 24);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(16, h - 28);
      ctx.lineTo(16, h - 20);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(16 + scaleBarLen, h - 28);
      ctx.lineTo(16 + scaleBarLen, h - 20);
      ctx.stroke();

      ctx.font = "400 10px 'JetBrains Mono', monospace";
      ctx.fillStyle = COLORS.muted;
      ctx.textAlign = "center";
      ctx.fillText(
        scaleBarKm >= 1 ? `${scaleBarKm} km` : `${scaleBarKm * 1000} m`,
        16 + scaleBarLen / 2,
        h - 10
      );

      // --- Weakest sector pulsing arc ---
      if (weakestCorridor) {
        const pulse = (Math.sin(Date.now() / 400) + 1) / 2; // 0..1 pulsing
        const alpha = 0.15 + pulse * 0.45;
        const bearingRadW = degToRad(90 - weakestCorridor.bearing_deg);
        const corridorW = baseTemplate.approach_corridors.find(
          (c) => c.name === weakestCorridor.name
        );
        const halfW = corridorW
          ? degToRad(corridorW.width_deg / 2)
          : degToRad(15);
        const arcRadius = boundsKm * scale * 0.9;

        ctx.save();
        ctx.strokeStyle = `rgba(248, 81, 73, ${alpha})`;
        ctx.fillStyle = `rgba(248, 81, 73, ${alpha * 0.3})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(
          cx,
          cy,
          arcRadius,
          -bearingRadW - halfW,
          -bearingRadW + halfW
        );
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      // --- Compass ---
      ctx.font = "500 10px 'Inter', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#484f58";
      ctx.fillText("N", cx, 14);
      ctx.fillText("S", cx, h - 14);
      ctx.fillText("E", w - 14, cy);
      ctx.fillText("W", 14, cy);

      requestAnimationFrame(draw);
    }

    const frameId = requestAnimationFrame(draw);
    return () => {
      running = false;
      cancelAnimationFrame(frameId);
    };
  }, [baseTemplate, placedItems, selectedPlaced, selectedSensors, selectedEffectors, getCatalog, weakestCorridor]);

  // Build PlacementConfig and confirm
  const handleConfirm = useCallback(() => {
    const config: PlacementConfig = {
      base_id: baseTemplate.id,
      sensors: placedItems
        .filter((p) => p.kind === "sensor")
        .map((p) => p.equipment),
      effectors: placedItems
        .filter((p) => p.kind === "effector")
        .map((p) => p.equipment),
    };
    onConfirm(config);
  }, [baseTemplate.id, placedItems, onConfirm]);

  // Active selection info for palette
  const activeItem =
    selectedPalette !== null
      ? paletteItems[selectedPalette]
      : selectedPlaced !== null
        ? {
            kind: placedItems[selectedPlaced].kind,
            index: placedItems[selectedPlaced].catalogIndex,
            catalog: getCatalog(placedItems[selectedPlaced]),
          }
        : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: COLORS.bg,
        color: COLORS.text,
        fontFamily: "'Inter', sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 20px",
          borderBottom: `1px solid ${COLORS.border}`,
          background: COLORS.card,
          minHeight: 48,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              color: COLORS.muted,
              letterSpacing: 2,
              textTransform: "uppercase",
            }}
          >
            Base Defense Planner
          </span>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: COLORS.text,
            }}
          >
            {baseTemplate.name}
          </span>
        </div>
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            color: COLORS.muted,
          }}
        >
          {placedItems.length}/{paletteItems.length} placed
        </div>
      </div>

      {/* Main content */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Left sidebar: Equipment Palette */}
        <div
          style={{
            width: 240,
            borderRight: `1px solid ${COLORS.border}`,
            background: COLORS.card,
            display: "flex",
            flexDirection: "column",
            overflowY: "auto",
          }}
        >
          <div
            style={{
              padding: "12px 16px 8px",
              fontSize: 11,
              fontWeight: 600,
              color: COLORS.muted,
              letterSpacing: 1,
              textTransform: "uppercase",
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Equipment
          </div>

          {/* Sensors */}
          {selectedSensors.length > 0 && (
            <>
              <div
                style={{
                  padding: "8px 16px 4px",
                  fontSize: 10,
                  fontWeight: 600,
                  color: COLORS.accent,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                Sensors
              </div>
              {selectedSensors.map((sensor, i) => {
                const paletteIdx = i;
                const isPlaced = placedSet.has(`sensor-${i}`);
                const isActive = selectedPalette === paletteIdx;

                return (
                  <div
                    key={`sensor-${i}`}
                    onClick={() => {
                      setSelectedPalette(isActive ? null : paletteIdx);
                      setSelectedPlaced(null);
                    }}
                    style={{
                      padding: "8px 16px",
                      cursor: "pointer",
                      background: isActive ? "#58a6ff18" : "transparent",
                      borderLeft: isActive
                        ? `2px solid ${COLORS.accent}`
                        : "2px solid transparent",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive)
                        (e.currentTarget as HTMLDivElement).style.background =
                          "#ffffff08";
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive)
                        (e.currentTarget as HTMLDivElement).style.background =
                          "transparent";
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: COLORS.text,
                          }}
                        >
                          {sensor.name}
                        </span>
                      </div>
                      {isPlaced && (
                        <span
                          style={{
                            color: COLORS.success,
                            fontSize: 14,
                            fontWeight: 700,
                          }}
                        >
                          ✓
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        marginTop: 4,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 9,
                          padding: "1px 5px",
                          borderRadius: 3,
                          background: "#58a6ff22",
                          color: COLORS.accent,
                          fontFamily: "'JetBrains Mono', monospace",
                          fontWeight: 600,
                          textTransform: "uppercase",
                        }}
                      >
                        {sensor.type}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          color: COLORS.muted,
                          fontFamily: "'JetBrains Mono', monospace",
                        }}
                      >
                        {sensor.range_km}km /{" "}
                        {sensor.fov_deg >= 360
                          ? "360°"
                          : `${sensor.fov_deg}°`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* Effectors */}
          {selectedEffectors.length > 0 && (
            <>
              <div
                style={{
                  padding: "12px 16px 4px",
                  fontSize: 10,
                  fontWeight: 600,
                  color: COLORS.danger,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                Effectors
              </div>
              {selectedEffectors.map((effector, i) => {
                const paletteIdx = selectedSensors.length + i;
                const isPlaced = placedSet.has(`effector-${i}`);
                const isActive = selectedPalette === paletteIdx;

                return (
                  <div
                    key={`effector-${i}`}
                    onClick={() => {
                      setSelectedPalette(isActive ? null : paletteIdx);
                      setSelectedPlaced(null);
                    }}
                    style={{
                      padding: "8px 16px",
                      cursor: "pointer",
                      background: isActive ? "#f8514918" : "transparent",
                      borderLeft: isActive
                        ? `2px solid ${COLORS.danger}`
                        : "2px solid transparent",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive)
                        (e.currentTarget as HTMLDivElement).style.background =
                          "#ffffff08";
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive)
                        (e.currentTarget as HTMLDivElement).style.background =
                          "transparent";
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: COLORS.text,
                        }}
                      >
                        {effector.name}
                      </span>
                      {isPlaced && (
                        <span
                          style={{
                            color: COLORS.success,
                            fontSize: 14,
                            fontWeight: 700,
                          }}
                        >
                          ✓
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        marginTop: 4,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 9,
                          padding: "1px 5px",
                          borderRadius: 3,
                          background: "#f8514922",
                          color: COLORS.danger,
                          fontFamily: "'JetBrains Mono', monospace",
                          fontWeight: 600,
                          textTransform: "uppercase",
                        }}
                      >
                        {effector.type}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          color: COLORS.muted,
                          fontFamily: "'JetBrains Mono', monospace",
                        }}
                      >
                        {effector.range_km}km /{" "}
                        {effector.fov_deg >= 360
                          ? "360°"
                          : `${effector.fov_deg}°`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* Facing slider */}
          <div
            style={{
              padding: "16px",
              borderTop: `1px solid ${COLORS.border}`,
              marginTop: "auto",
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: COLORS.muted,
                letterSpacing: 1,
                textTransform: "uppercase",
                fontFamily: "'JetBrains Mono', monospace",
                marginBottom: 8,
              }}
            >
              Facing Direction
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <input
                type="range"
                min={0}
                max={360}
                step={1}
                value={facingDeg}
                onChange={(e) => handleFacingChange(Number(e.target.value))}
                disabled={activeItem === null}
                style={{
                  flex: 1,
                  accentColor: COLORS.accent,
                  opacity: activeItem === null ? 0.3 : 1,
                }}
              />
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 12,
                  color: activeItem === null ? COLORS.border : COLORS.text,
                  minWidth: 36,
                  textAlign: "right",
                }}
              >
                {facingDeg}°
              </span>
            </div>
            {/* Rotation step buttons for directional sensors/effectors */}
            {activeItem !== null &&
              activeItem.catalog.fov_deg < 360 &&
              selectedPlaced !== null && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginTop: 8,
                  }}
                >
                  <button
                    onClick={() =>
                      handleFacingChange((facingDeg - 15 + 360) % 360)
                    }
                    style={{
                      flex: 1,
                      padding: "4px 0",
                      background: "transparent",
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: 4,
                      color: COLORS.text,
                      fontSize: 12,
                      fontWeight: 600,
                      fontFamily: "'JetBrains Mono', monospace",
                      cursor: "pointer",
                      transition: "border-color 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.borderColor =
                        COLORS.accent;
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.borderColor =
                        COLORS.border;
                    }}
                  >
                    -15°
                  </button>
                  <button
                    onClick={() => handleFacingChange((facingDeg + 15) % 360)}
                    style={{
                      flex: 1,
                      padding: "4px 0",
                      background: "transparent",
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: 4,
                      color: COLORS.text,
                      fontSize: 12,
                      fontWeight: 600,
                      fontFamily: "'JetBrains Mono', monospace",
                      cursor: "pointer",
                      transition: "border-color 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.borderColor =
                        COLORS.accent;
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.borderColor =
                        COLORS.border;
                    }}
                  >
                    +15°
                  </button>
                </div>
              )}
            <div
              style={{
                fontSize: 10,
                color: COLORS.muted,
                marginTop: 4,
              }}
            >
              {activeItem
                ? `${activeItem.catalog.name} — ${activeItem.catalog.fov_deg >= 360 ? "omnidirectional" : `${activeItem.catalog.fov_deg}° FOV`}`
                : "Select an item to adjust"}
            </div>
          </div>
        </div>

        {/* Center: Canvas */}
        <div
          ref={containerRef}
          style={{
            flex: 1,
            position: "relative",
            overflow: "hidden",
            background: COLORS.bg,
          }}
        >
          <canvas
            ref={canvasRef}
            style={{
              display: "block",
              cursor: selectedPalette !== null ? "crosshair" : "default",
            }}
            onClick={handleCanvasClick}
            onContextMenu={handleContextMenu}
            onDoubleClick={handleDoubleClick}
          />
          {/* Instructions overlay */}
          {placedItems.length === 0 && selectedPalette === null && (
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                textAlign: "center",
                color: COLORS.muted,
                pointerEvents: "none",
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  marginBottom: 8,
                }}
              >
                Select equipment from the left panel
              </div>
              <div style={{ fontSize: 12 }}>
                Click the map to place. Right-click to remove.
              </div>
            </div>
          )}
        </div>

        {/* Right sidebar: Coverage Summary */}
        <div
          style={{
            width: 240,
            borderLeft: `1px solid ${COLORS.border}`,
            background: COLORS.card,
            display: "flex",
            flexDirection: "column",
            overflowY: "auto",
          }}
        >
          <div
            style={{
              padding: "12px 16px 8px",
              fontSize: 11,
              fontWeight: 600,
              color: COLORS.muted,
              letterSpacing: 1,
              textTransform: "uppercase",
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Coverage Analysis
          </div>

          {/* Coverage percentage */}
          <div
            style={{
              padding: "8px 16px 12px",
              display: "flex",
              alignItems: "baseline",
              gap: 6,
            }}
          >
            <span
              style={{
                fontSize: 28,
                fontWeight: 700,
                fontFamily: "'JetBrains Mono', monospace",
                color:
                  coveragePct === 100
                    ? COLORS.success
                    : coveragePct >= 50
                      ? COLORS.warning
                      : COLORS.danger,
              }}
            >
              {coveragePct}%
            </span>
            <span
              style={{
                fontSize: 11,
                color: COLORS.muted,
                fontFamily: "'JetBrains Mono', monospace",
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              Coverage
            </span>
          </div>

          {/* Approach corridors */}
          <div
            style={{
              padding: "8px 16px 4px",
              fontSize: 10,
              fontWeight: 600,
              color: COLORS.muted,
              letterSpacing: 1,
              textTransform: "uppercase",
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Approach Corridors
          </div>

          {coverage.map((c, i) => (
            <div
              key={i}
              style={{
                padding: "8px 16px",
                borderLeft: `2px solid ${c.covered ? COLORS.success : COLORS.danger}`,
                margin: "2px 0",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: COLORS.text,
                  }}
                >
                  {c.name}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontFamily: "'JetBrains Mono', monospace",
                    color: COLORS.muted,
                  }}
                >
                  {c.bearing_deg}°
                </span>
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: c.covered ? COLORS.success : COLORS.danger,
                  marginTop: 4,
                  fontWeight: 500,
                }}
              >
                {c.covered
                  ? `Covered: ${c.sensors.join(", ")}`
                  : "GAP — No sensor coverage"}
              </div>
            </div>
          ))}

          {/* Summary stats */}
          <div
            style={{
              padding: "16px",
              borderTop: `1px solid ${COLORS.border}`,
              marginTop: 16,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: COLORS.muted,
                letterSpacing: 1,
                textTransform: "uppercase",
                fontFamily: "'JetBrains Mono', monospace",
                marginBottom: 8,
              }}
            >
              Summary
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <SummaryRow
                label="Corridors covered"
                value={`${coverage.filter((c) => c.covered).length}/${coverage.length}`}
                color={
                  coverage.every((c) => c.covered)
                    ? COLORS.success
                    : COLORS.warning
                }
              />
              <SummaryRow
                label="Sensors placed"
                value={`${placedItems.filter((p) => p.kind === "sensor").length}/${selectedSensors.length}`}
                color={COLORS.accent}
              />
              <SummaryRow
                label="Effectors placed"
                value={`${placedItems.filter((p) => p.kind === "effector").length}/${selectedEffectors.length}`}
                color={COLORS.danger}
              />
            </div>

            {coverage.some((c) => !c.covered) && placedItems.length > 0 && (
              <div
                style={{
                  marginTop: 12,
                  padding: "8px 10px",
                  background: "#f8514912",
                  borderRadius: 4,
                  border: `1px solid ${COLORS.danger}33`,
                  fontSize: 11,
                  color: COLORS.danger,
                  lineHeight: 1.4,
                }}
              >
                Warning: Coverage gaps detected on{" "}
                {coverage
                  .filter((c) => !c.covered)
                  .map((c) => c.name)
                  .join(", ")}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 20px",
          borderTop: `1px solid ${COLORS.border}`,
          background: COLORS.card,
          minHeight: 48,
        }}
      >
        <button
          onClick={onBack}
          style={{
            padding: "8px 20px",
            background: "transparent",
            border: `1px solid ${COLORS.border}`,
            borderRadius: 6,
            color: COLORS.muted,
            fontSize: 13,
            fontWeight: 500,
            fontFamily: "'Inter', sans-serif",
            cursor: "pointer",
            transition: "border-color 0.15s, color 0.15s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor =
              COLORS.muted;
            (e.currentTarget as HTMLButtonElement).style.color = COLORS.text;
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor =
              COLORS.border;
            (e.currentTarget as HTMLButtonElement).style.color = COLORS.muted;
          }}
        >
          BACK
        </button>

        <button
          onClick={() => {
            setPlacedItems([]);
            setSelectedPlaced(null);
            setSelectedPalette(null);
          }}
          disabled={placedItems.length === 0}
          style={{
            padding: "8px 20px",
            background: "transparent",
            border: `1px solid ${placedItems.length > 0 ? COLORS.danger : COLORS.border}`,
            borderRadius: 6,
            color: placedItems.length > 0 ? COLORS.danger : COLORS.muted,
            fontSize: 13,
            fontWeight: 500,
            fontFamily: "'Inter', sans-serif",
            cursor: placedItems.length > 0 ? "pointer" : "not-allowed",
            opacity: placedItems.length > 0 ? 1 : 0.4,
            transition: "background 0.15s, border-color 0.15s",
            letterSpacing: 1,
            textTransform: "uppercase",
          }}
          onMouseEnter={(e) => {
            if (placedItems.length > 0) {
              (e.currentTarget as HTMLButtonElement).style.background =
                "#f8514918";
            }
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "transparent";
          }}
        >
          Reset Placement
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              fontSize: 11,
              color: COLORS.muted,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {allPlaced
              ? "All equipment placed"
              : `${paletteItems.length - placedItems.length} remaining`}
          </span>
          <button
            onClick={handleConfirm}
            disabled={!allPlaced}
            style={{
              padding: "8px 24px",
              background: allPlaced ? COLORS.accent : COLORS.border,
              border: "none",
              borderRadius: 6,
              color: allPlaced ? "#ffffff" : COLORS.muted,
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "'Inter', sans-serif",
              cursor: allPlaced ? "pointer" : "not-allowed",
              opacity: allPlaced ? 1 : 0.5,
              transition: "background 0.15s, opacity 0.15s",
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
            onMouseEnter={(e) => {
              if (allPlaced)
                (e.currentTarget as HTMLButtonElement).style.background =
                  "#79b8ff";
            }}
            onMouseLeave={(e) => {
              if (allPlaced)
                (e.currentTarget as HTMLButtonElement).style.background =
                  COLORS.accent;
            }}
          >
            Start Mission
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Helper components ---

function SummaryRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <span style={{ fontSize: 11, color: COLORS.muted }}>{label}</span>
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          fontFamily: "'JetBrains Mono', monospace",
          color,
        }}
      >
        {value}
      </span>
    </div>
  );
}

// --- Canvas helper functions ---

function drawStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  outerR: number,
  innerR: number,
  color: string
) {
  const points = 5;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (Math.PI / points) * i - Math.PI / 2;
    const px = x + Math.cos(angle) * r;
    const py = y + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function polygonCentroid(points: number[][]): [number, number] {
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p[0];
    cy += p[1];
  }
  return [cx / points.length, cy / points.length];
}
