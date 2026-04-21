import { useCallback, useEffect, useRef, useState } from "react";
import type { PlacementConfig, ServerMessage } from "../types";
import type {
  ScenarioConfig,
  GameState,
  SensorConfig,
  EffectorConfig,
  BaseTemplate,
  EquipmentCatalog,
  CatalogSensor,
  CatalogEffector,
  CatalogCombined,
} from "@opensentry/game/state";
import {
  buildSensorsFromPlacement,
  buildEffectorsFromPlacement,
} from "@opensentry/game/helpers";
import {
  initGameState,
  buildGameStartMsg,
  buildStateMsg,
  buildDebrief,
  tickSpawns,
  tickWaves,
  tickFreePlaySpawns,
  tickPendingDirectedEnergyEngagements,
  tickEffectorRecharge,
  tickPassiveJamming,
  tickDrones,
  advanceTutorialStep,
  checkTutorialPrompts,
} from "@opensentry/game/loop";
import {
  handleConfirmTrack,
  handleIdentify,
  handleDeclareAffiliation,
  handleEngage,
  handleHoldFire,
  handleReleaseHoldFire,
  handleJammerToggle,
  handleJamAll,
  handleCeaseJam,
  handleClearAirspace,
  handlePauseMission,
  handleResumeMission,
  handleEndMission,
} from "@opensentry/game/actions";
import { normalizeLoadedBaseTemplate } from "../utils/recenterCustomBase";
import { loadBaseTemplateWithBrowserOverride } from "../utils/browserBasePresets";

// Re-export the same interfaces used by useWebSocket
export interface ConnectOptions {
  scenarioId: string;
  baseId?: string;
  placement?: PlacementConfig;
  baseTemplate?: BaseTemplate | null;
  /** When true, placement is scored in debrief (custom mission with PlacementScreen). */
  scorePlacement?: boolean;
}

type MessageHandler = (msg: ServerMessage) => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Msg = Record<string, any>;

export function useGameEngine(onMessage: MessageHandler) {
  const gsRef = useRef<GameState | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const catalogRef = useRef<EquipmentCatalog | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const dispatch = useCallback((msg: Msg) => {
    onMessageRef.current(msg as ServerMessage);
  }, []);

  const dispatchAll = useCallback(
    (msgs: Msg[]) => {
      for (const m of msgs) dispatch(m);
    },
    [dispatch],
  );

  const connect = useCallback(
    async (connectOpts: ConnectOptions | string) => {
      // Clean up any prior game
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      gsRef.current = null;
      setConnectionError(null);

      try {
        const scenarioId =
          typeof connectOpts === "string"
            ? connectOpts
            : connectOpts.scenarioId;
        const baseId =
          typeof connectOpts === "string" ? undefined : connectOpts.baseId;
        const placement =
          typeof connectOpts === "string" ? undefined : connectOpts.placement;
        const providedBaseTemplate =
          typeof connectOpts === "string" ? undefined : connectOpts.baseTemplate;
        const scorePlacement =
          typeof connectOpts === "string" ? false : (connectOpts.scorePlacement ?? false);

        // Load scenario JSON
        const scenarioRes = await fetch(
          `${import.meta.env.BASE_URL}data/scenarios/${scenarioId}.json`,
        );
        if (!scenarioRes.ok) throw new Error(`Scenario not found: ${scenarioId}`);
        const scenarioData = await scenarioRes.json();

        // Normalize scenario: add missing defaults
        const scenario: ScenarioConfig = {
          tutorial: false,
          tutorial_prompts: null,
          no_ambient: false,
          ...scenarioData,
          drones: (scenarioData.drones ?? []).map(
            (d: Record<string, unknown>) => ({
              spawn_delay: 0,
              rf_emitting: true,
              should_engage: true,
              ...d,
            }),
          ),
          sensors: (scenarioData.sensors ?? []).map(
            (s: Record<string, unknown>) => ({
              x: 0,
              y: 0,
              fov_deg: 360,
              facing_deg: 0,
              requires_los: false,
              ...s,
            }),
          ),
          effectors: (scenarioData.effectors ?? []).map(
            (e: Record<string, unknown>) => ({
              x: 0,
              y: 0,
              fov_deg: 360,
              facing_deg: 0,
              requires_los: false,
              single_use: false,
              recharge_seconds: 0,
              ammo_count: null,
              ammo_remaining: null,
              ...e,
            }),
          ),
        };

        // Load base template + equipment catalog in parallel
        const resolvedBaseId = baseId ?? (placement?.base_id ?? null);
        const [baseTemplate, catalog] = await Promise.all([
          // Base template
          (async (): Promise<BaseTemplate | null> => {
            if (providedBaseTemplate) {
              return normalizeLoadedBaseTemplate(providedBaseTemplate);
            }
            if (!resolvedBaseId) return null;
            try {
              const baseRes = await loadBaseTemplateWithBrowserOverride(resolvedBaseId);
              if (baseRes) return normalizeLoadedBaseTemplate(baseRes);
              console.warn(`[OpenSentry Engine] Base template not found: ${resolvedBaseId}`);
            } catch (err) {
              console.warn(`[OpenSentry Engine] Failed to load base template:`, err);
            }
            return null;
          })(),
          // Equipment catalog
          (async (): Promise<EquipmentCatalog | null> => {
            try {
              const catRes = await fetch(`${import.meta.env.BASE_URL}data/equipment/catalog.json`);
              if (catRes.ok) return await catRes.json();
              console.warn("[OpenSentry Engine] Equipment catalog not found — placement scoring unavailable");
            } catch (err) {
              console.warn("[OpenSentry Engine] Failed to load equipment catalog:", err);
            }
            return null;
          })(),
        ]);
        catalogRef.current = catalog;

        // Build sensor/effector configs from placement or scenario defaults
        let sensorConfigs: SensorConfig[];
        let effectorConfigs: EffectorConfig[];

        if (placement && catalog) {
          const catSensors = new Map<string, CatalogSensor>();
          for (const s of catalog.sensors) catSensors.set(s.catalog_id, s);
          const catEffectors = new Map<string, CatalogEffector>();
          for (const e of catalog.effectors) catEffectors.set(e.catalog_id, e);
          const catCombined = new Map<string, CatalogCombined>();
          for (const c of catalog.combined) catCombined.set(c.catalog_id, c);

          sensorConfigs = buildSensorsFromPlacement(
            placement,
            catSensors,
            catCombined,
          );
          effectorConfigs = buildEffectorsFromPlacement(
            placement,
            catEffectors,
            catCombined,
          );
        } else {
          sensorConfigs = scenario.sensors;
          effectorConfigs = scenario.effectors;
        }

        // Initialize game state
        const gs = initGameState(
          scenario,
          sensorConfigs,
          effectorConfigs,
          placement && scorePlacement ? placement : null,
          baseTemplate,
          baseTemplate?.terrain ?? [],
        );

        gsRef.current = gs;
        setConnected(true);

        // Dispatch game_start message
        const startMsg = buildGameStartMsg(gs);
        dispatch(startMsg);

        // Start 10Hz game loop
        intervalRef.current = setInterval(() => {
          const g = gsRef.current;
          if (!g || g.phase === "debrief") return;

          if (g.paused) {
            // Still send state so UI stays updated
            const elapsed =
              Date.now() / 1000 -
              g.start_time -
              g.total_paused_seconds -
              (Date.now() / 1000 - g.pause_start_time);
            const timeRemaining = Math.max(0, g.max_duration - elapsed);
            dispatch(buildStateMsg(g, elapsed, timeRemaining));
            return;
          }

          const elapsed =
            Date.now() / 1000 - g.start_time - g.total_paused_seconds;
          const isFreePlay = g.scenario.free_play === true;
          const timeRemaining = Math.max(0, g.max_duration - elapsed);

          // Time's up — but free_play scenarios keep going
          if (timeRemaining <= 0 && !isFreePlay) {
            g.phase = "debrief";
            dispatch(buildDebrief(g, catalogRef.current ?? undefined));
            if (intervalRef.current) {
              clearInterval(intervalRef.current);
              intervalRef.current = null;
            }
            return;
          }

          // Run all tick functions
          dispatchAll(tickSpawns(g, elapsed));
          dispatchAll(tickWaves(g, elapsed));
          if (isFreePlay) dispatchAll(tickFreePlaySpawns(g, elapsed));
          dispatchAll(tickPendingDirectedEnergyEngagements(g, elapsed));
          dispatchAll(tickEffectorRecharge(g, elapsed));
          dispatchAll(tickPassiveJamming(g, elapsed));
          dispatchAll(tickDrones(g, elapsed));
          dispatchAll(checkTutorialPrompts(g));

          // Build and dispatch state
          dispatch(buildStateMsg(g, elapsed, timeRemaining));
        }, 100);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Failed to start game";
        setConnectionError(msg);
        console.error("[OpenSentry Engine]", msg);
      }
    },
    [dispatch, dispatchAll],
  );

  const send = useCallback(
    (data: Record<string, unknown>) => {
      const gs = gsRef.current;
      if (!gs) return;

      const elapsed =
        Date.now() / 1000 - gs.start_time - gs.total_paused_seconds;

      if (data.type === "restart") {
        // Disconnect and let the caller reconnect
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        gsRef.current = null;
        setConnected(false);
        return;
      }

      if (data.type !== "action") return;

      const action = data.action as string;
      const targetId = (data.target_id as string) ?? "";
      let msgs: Msg[] = [];

      switch (action) {
        case "confirm_track":
          msgs = handleConfirmTrack(gs, targetId, elapsed);
          dispatchAll(advanceTutorialStep(gs, "confirm_track", targetId));
          break;

        case "identify":
          msgs = handleIdentify(
            gs,
            targetId,
            (data.classification as string) ?? null,
            (data.affiliation as string) ?? "unknown",
            elapsed,
          );
          dispatchAll(advanceTutorialStep(gs, "identify", targetId));
          break;

        case "engage":
          msgs = handleEngage(
            gs,
            targetId,
            (data.effector as string) ?? "",
            elapsed,
          );
          dispatchAll(advanceTutorialStep(gs, "engage", targetId, data.effector as string));
          break;

        case "shenobi_hold":
        case "shenobi_land_now":
        case "shenobi_deafen":
          msgs = handleEngage(
            gs,
            targetId,
            (data.effector as string) ?? "",
            elapsed,
            action,
          );
          dispatchAll(advanceTutorialStep(gs, "engage", targetId, data.effector as string));
          break;

        case "declare_affiliation":
          msgs = handleDeclareAffiliation(gs, targetId, (data.affiliation as string) ?? "unknown", elapsed);
          dispatchAll(advanceTutorialStep(gs, "declare_affiliation", targetId));
          break;

        case "hold_fire":
          msgs = handleHoldFire(gs, targetId, elapsed);
          break;

        case "release_hold_fire":
          msgs = handleReleaseHoldFire(gs, targetId, elapsed);
          break;

        case "jammer_toggle":
          msgs = handleJammerToggle(
            gs,
            (data.effector_id as string) ?? "",
            elapsed,
          );
          break;

        case "jam_all":
          msgs = handleJamAll(gs, elapsed);
          break;

        case "cease_jam":
          msgs = handleCeaseJam(gs, elapsed);
          break;

        case "clear_airspace":
          msgs = handleClearAirspace(gs, elapsed);
          break;

        case "pause_mission":
          msgs = handlePauseMission(gs, elapsed);
          break;

        case "resume_mission":
          msgs = handleResumeMission(gs, elapsed);
          break;

        case "end_mission":
          msgs = handleEndMission(gs);
          dispatch(buildDebrief(gs, catalogRef.current ?? undefined));
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          break;

        case "slew_camera":
          // Camera slew is handled client-side in App.tsx
          // But we still need to notify the game engine for tutorial gating
          dispatchAll(advanceTutorialStep(gs, "slew_camera", targetId));
          break;

        case "select_track":
          // Tutorial step 1→2: track selected (client-side action, game engine gating only)
          dispatchAll(advanceTutorialStep(gs, "select_track", targetId));
          break;

        case "call_atc":
          // Tutorial step 2→3: ATC called (client-side action, game engine gating only)
          dispatchAll(advanceTutorialStep(gs, "call_atc", targetId));
          break;

        default:
          console.warn("[OpenSentry Engine] Unknown action:", action);
      }

      dispatchAll(msgs);
    },
    [dispatch, dispatchAll],
  );

  const disconnect = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    gsRef.current = null;
    setConnected(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  return { connect, send, disconnect, connected, connectionError };
}
