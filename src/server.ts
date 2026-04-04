/**
 * SKYSHIELD TypeScript backend — Fastify + WebSocket server.
 * Ported from Python FastAPI backend.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import type { WebSocket } from 'ws';

import type {
  ScenarioConfig, BaseTemplate, EquipmentCatalog,
  PlacementConfig, PlacedEquipment, GameState,
  SensorConfig, EffectorConfig, TerrainFeature,
} from './game/state.js';
import { buildSensorsFromPlacement, buildEffectorsFromPlacement } from './game/helpers.js';
import {
  initGameState, buildGameStartMsg, buildStateMsg, buildDebrief,
  tickSpawns, tickWaves, tickEffectorRecharge, tickPassiveJamming, tickDrones,
  advanceTutorialStep, checkTutorialPrompts,
} from './game/loop.js';
import {
  handleConfirmTrack, handleIdentify, handleDeclareAffiliation, handleHoldFire,
  handleReleaseHoldFire, handleEngage, handleJammerToggle,
  handleJamAll, handleCeaseJam, handleClearAirspace,
  handlePauseMission, handleResumeMission, handleEndMission,
} from './game/actions.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// In dev (tsx): src/server.ts -> backend/ is at ../backend
// In prod (dist/server.js): dist/ -> backend/ is at ../backend
const projectRoot = resolve(__dirname, '..');
const SCENARIOS_DIR = join(projectRoot, 'backend', 'scenarios');
const BASES_DIR = join(projectRoot, 'backend', 'bases');
const EQUIPMENT_DIR = join(projectRoot, 'backend', 'equipment');
const FRONTEND_DIST = join(projectRoot, 'frontend', 'dist');

// ---------------------------------------------------------------------------
// Data loaders
// ---------------------------------------------------------------------------

const VALID_SCENARIO_IDS = new Set(['lone_wolf', 'swarm_attack', 'recon_probe', 'tutorial']);
const VALID_BASE_IDS = new Set(['small_fob', 'medium_airbase', 'large_installation']);
const VALID_ACTION_NAMES = new Set([
  'confirm_track', 'identify', 'declare_affiliation', 'engage', 'hold_fire',
  'release_hold_fire', 'end_mission', 'slew_camera',
  'shenobi_hold', 'shenobi_land_now', 'shenobi_deafen',
  'jammer_toggle', 'jam_all', 'cease_jam', 'clear_airspace',
  'pause_mission', 'resume_mission',
]);

function loadScenario(scenarioId: string): ScenarioConfig {
  const path = join(SCENARIOS_DIR, `${scenarioId}.json`);
  if (!existsSync(path)) throw new Error(`Scenario not found: ${scenarioId}`);
  const data = JSON.parse(readFileSync(path, 'utf-8'));
  // Apply defaults for optional fields
  return {
    base_radius_km: 0.1,
    correct_affiliation: 'hostile',
    optimal_effectors: [],
    acceptable_effectors: [],
    roe_violations: [],
    tutorial: false,
    tutorial_prompts: null,
    no_ambient: false,
    ...data,
  } as ScenarioConfig;
}

function listScenarios(): Array<Record<string, string>> {
  const scenarios: Array<Record<string, string>> = [];
  for (const file of readdirSync(SCENARIOS_DIR).filter(f => f.endsWith('.json'))) {
    const data = JSON.parse(readFileSync(join(SCENARIOS_DIR, file), 'utf-8'));
    scenarios.push({
      id: data.id, name: data.name,
      description: data.description, difficulty: data.difficulty,
    });
  }
  return scenarios;
}

function loadBase(baseId: string): BaseTemplate {
  const path = join(BASES_DIR, `${baseId}.json`);
  if (!existsSync(path)) throw new Error(`Base template not found: ${baseId}`);
  return JSON.parse(readFileSync(path, 'utf-8')) as BaseTemplate;
}

function listBases(): Array<Record<string, unknown>> {
  const bases: Array<Record<string, unknown>> = [];
  for (const file of readdirSync(BASES_DIR).filter(f => f.endsWith('.json')).sort()) {
    const data = JSON.parse(readFileSync(join(BASES_DIR, file), 'utf-8'));
    bases.push({
      id: data.id, name: data.name, description: data.description,
      size: data.size, max_sensors: data.max_sensors, max_effectors: data.max_effectors,
    });
  }
  return bases;
}

function loadEquipmentCatalog(): EquipmentCatalog {
  const path = join(EQUIPMENT_DIR, 'catalog.json');
  if (!existsSync(path)) throw new Error('Equipment catalog not found');
  const data = JSON.parse(readFileSync(path, 'utf-8'));
  return { sensors: data.sensors ?? [], effectors: data.effectors ?? [], combined: data.combined ?? [] };
}

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const fastify = Fastify({ logger: true });

await fastify.register(fastifyWebsocket);

// Serve frontend static files in production
if (existsSync(FRONTEND_DIST)) {
  await fastify.register(fastifyStatic, {
    root: FRONTEND_DIST,
    prefix: '/',
    wildcard: false,
  });
}

// CORS headers
fastify.addHook('onSend', async (_request, reply, payload) => {
  reply.header('Access-Control-Allow-Origin', '*');
  reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  reply.header('Access-Control-Allow-Headers', '*');
  return payload;
});

// ---------------------------------------------------------------------------
// REST endpoints
// ---------------------------------------------------------------------------

fastify.get('/api/health', async () => ({ name: 'SKYSHIELD', version: '2.0.0' }));

fastify.get('/scenarios', async () => {
  try { return listScenarios(); }
  catch (e) { return { error: 'Failed to load scenarios' }; }
});

fastify.get('/bases', async () => {
  try { return listBases(); }
  catch (e) { return { error: 'Failed to load bases' }; }
});

fastify.get<{ Params: { base_id: string } }>('/bases/:base_id', async (request) => {
  const { base_id } = request.params;
  if (!VALID_BASE_IDS.has(base_id)) return { error: `Unknown base: ${base_id}` };
  try { return loadBase(base_id); }
  catch (e) { return { error: `Failed to load base: ${base_id}` }; }
});

fastify.get('/equipment', async () => {
  try { return loadEquipmentCatalog(); }
  catch (e) { return { error: 'Failed to load equipment catalog' }; }
});

// Also serve at /equipment/catalog for backward compat
fastify.get('/equipment/catalog', async () => {
  try { return loadEquipmentCatalog(); }
  catch (e) { return { error: 'Failed to load equipment catalog' }; }
});

// ---------------------------------------------------------------------------
// WebSocket game endpoint
// ---------------------------------------------------------------------------

fastify.register(async function (fastify) {
  fastify.get('/ws/game', { websocket: true }, (socket: WebSocket) => {
    handleGameSession(socket).catch(err => {
      console.error('Game session error:', err);
      try { socket.close(1011); } catch { /* ignore */ }
    });
  });
});

async function handleGameSession(ws: WebSocket): Promise<void> {
  // Wait for init message
  const initMsg = await waitForMessage(ws, 30000);
  if (!initMsg) {
    sendJson(ws, { type: 'error', code: 'init_timeout', message: 'Timed out waiting for scenario selection' });
    ws.close(1000);
    return;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(initMsg as string);
  } catch {
    sendJson(ws, { type: 'error', code: 'invalid_json', message: 'Invalid JSON in init message' });
    ws.close(1000);
    return;
  }

  const scenarioId = (parsed.scenario_id as string) ?? 'lone_wolf';
  if (!VALID_SCENARIO_IDS.has(scenarioId)) {
    sendJson(ws, { type: 'error', code: 'invalid_scenario', message: `Unknown scenario: ${scenarioId}` });
    ws.close(1000);
    return;
  }

  let scenario: ScenarioConfig;
  try {
    scenario = loadScenario(scenarioId);
  } catch (e) {
    sendJson(ws, { type: 'error', code: 'scenario_not_found', message: `Scenario not found: ${scenarioId}` });
    ws.close(1000);
    return;
  }

  // Placement config
  let placementConfig: PlacementConfig | null = null;
  let baseTemplate: BaseTemplate | null = null;
  const baseId = parsed.base_id as string | undefined;
  let pd: Record<string, unknown> | null = null;

  if (baseId && parsed.placement) {
    if (!VALID_BASE_IDS.has(baseId)) {
      sendJson(ws, { type: 'error', code: 'invalid_base', message: `Unknown base: ${baseId}` });
      ws.close(1000);
      return;
    }
    try {
      baseTemplate = loadBase(baseId);
    } catch {
      sendJson(ws, { type: 'error', code: 'base_not_found', message: `Base not found: ${baseId}` });
      ws.close(1000);
      return;
    }

    try {
      pd = parsed.placement as Record<string, unknown>;
      placementConfig = {
        base_id: baseId,
        sensors: ((pd.sensors as unknown[]) ?? []).map(s => s as PlacedEquipment),
        effectors: ((pd.effectors as unknown[]) ?? []).map(e => e as PlacedEquipment),
        combined: ((pd.combined as unknown[]) ?? []).map(c => c as PlacedEquipment),
      };

      // Apply client perimeter overrides
      if (pd.boundary && Array.isArray(pd.boundary)) {
        baseTemplate = { ...baseTemplate, boundary: pd.boundary as number[][] };
        const pts = pd.boundary as number[][];
        if (pts.length >= 2) {
          const xs = pts.map(p => p[0]);
          const ys = pts.map(p => p[1]);
          const w = Math.max(...xs) - Math.min(...xs);
          const h = Math.max(...ys) - Math.min(...ys);
          const halfDiag = Math.sqrt(w ** 2 + h ** 2) / 2;
          scenario = { ...scenario, base_radius_km: Math.max(halfDiag, 0.2) };
        }
      }
      if (typeof pd.placement_bounds_km === 'number') {
        baseTemplate = { ...baseTemplate, placement_bounds_km: pd.placement_bounds_km };
      }
    } catch (e) {
      sendJson(ws, { type: 'error', code: 'invalid_placement', message: `Invalid placement: ${e}` });
      ws.close(1000);
      return;
    }
  }

  // Build sensor/effector configs
  let sensorConfigs: SensorConfig[];
  let effectorConfigsList: EffectorConfig[];

  if (placementConfig && baseTemplate) {
    const catalog = loadEquipmentCatalog();
    const catSensors = new Map(catalog.sensors.map(s => [s.catalog_id, s]));
    const catEffectors = new Map(catalog.effectors.map(e => [e.catalog_id, e]));
    const catCombined = new Map(catalog.combined.map(c => [c.catalog_id, c]));
    sensorConfigs = buildSensorsFromPlacement(placementConfig, catSensors, catCombined);
    effectorConfigsList = buildEffectorsFromPlacement(placementConfig, catEffectors, catCombined);
  } else {
    sensorConfigs = scenario.sensors ?? [];
    effectorConfigsList = scenario.effectors ?? [];
  }

  const terrain: TerrainFeature[] = baseTemplate?.terrain ?? [];
  const gs = initGameState(scenario, sensorConfigs, effectorConfigsList, placementConfig, baseTemplate, terrain);

  // Override protected/warning radii for custom perimeter
  if (pd && pd.boundary && Array.isArray(pd.boundary)) {
    const pts = pd.boundary as number[][];
    if (pts.length >= 2) {
      const xs = pts.map(p => p[0]);
      const ys = pts.map(p => p[1]);
      const w = Math.max(...xs) - Math.min(...xs);
      const h = Math.max(...ys) - Math.min(...ys);
      const halfDiag = Math.sqrt(w ** 2 + h ** 2) / 2;
      gs.protected_area_radius = Math.max(halfDiag, 0.2);
      gs.warning_area_radius = gs.protected_area_radius * 1.5;
    }
  }

  // Send game_start
  sendJson(ws, buildGameStartMsg(gs));

  // Tutorial start prompt
  if (scenario.tutorial && scenario.tutorial_prompts) {
    for (const tp of scenario.tutorial_prompts) {
      if (tp.trigger === 'start') {
        sendJson(ws, { type: 'tutorial', message: tp.message });
        gs.tutorial_prompts_sent.add('start');
      }
    }
  }

  // Load catalog for debrief scoring (if needed)
  let catalog: EquipmentCatalog | undefined;
  try { catalog = loadEquipmentCatalog(); } catch { /* ignore */ }

  // --- Main game loop ---
  let closed = false;
  ws.on('close', () => { closed = true; });
  ws.on('error', () => { closed = true; });

  // Message queue
  const messageQueue: string[] = [];
  ws.on('message', (data) => {
    messageQueue.push(typeof data === 'string' ? data : data.toString());
  });

  while (gs.phase === 'running' && !closed) {
    const tickStart = Date.now() / 1000;

    // Calculate elapsed
    const wallElapsed = tickStart - gs.start_time;
    const pausedNow = gs.paused ? (tickStart - gs.pause_start_time) : 0;
    const elapsed = wallElapsed - gs.total_paused_seconds - pausedNow;
    const timeRemaining = Math.max(0, gs.max_duration - elapsed);
    const events: Record<string, unknown>[] = [];

    if (!gs.paused) {
      events.push(...tickSpawns(gs, elapsed));
      events.push(...tickWaves(gs, elapsed));
      events.push(...tickEffectorRecharge(gs, elapsed));
      events.push(...tickPassiveJamming(gs, elapsed));
      events.push(...tickDrones(gs, elapsed));
    }

    // Send state
    sendJson(ws, buildStateMsg(gs, elapsed, timeRemaining));

    // Send events
    for (const ev of events) sendJson(ws, ev);

    // Tutorial prompts
    for (const tp of checkTutorialPrompts(gs)) sendJson(ws, tp);

    // Timeout
    if (timeRemaining <= 0) {
      gs.phase = 'debrief';
      break;
    }

    // Process queued player input
    while (messageQueue.length > 0) {
      const raw = messageQueue.shift()!;
      try {
        if (raw.length > 8192) {
          sendJson(ws, { type: 'error', code: 'msg_too_large', message: 'Message too large' });
          continue;
        }
        const msg = JSON.parse(raw);
        const msgType = msg.type;

        if (msgType === 'action') {
          const actionName = msg.action ?? '';
          const targetId = msg.target_id ?? (gs.drones[0]?.id ?? '');

          if (!VALID_ACTION_NAMES.has(actionName)) {
            sendJson(ws, { type: 'error', code: 'invalid_action', message: `Unknown action: ${actionName}` });
          } else if (actionName === 'confirm_track') {
            sendMsgs(ws, handleConfirmTrack(gs, targetId, elapsed));
            sendMsgs(ws, advanceTutorialStep(gs, 'confirm_track', targetId));
          } else if (actionName === 'identify') {
            sendMsgs(ws, handleIdentify(gs, targetId, msg.classification, msg.affiliation ?? 'unknown', elapsed));
            sendMsgs(ws, advanceTutorialStep(gs, 'identify', targetId));
          } else if (actionName === 'declare_affiliation') {
            sendMsgs(ws, handleDeclareAffiliation(gs, targetId, msg.affiliation ?? 'unknown', elapsed));
          } else if (actionName === 'slew_camera') {
            sendMsgs(ws, advanceTutorialStep(gs, 'slew_camera', targetId));
          } else if (actionName === 'hold_fire') {
            sendMsgs(ws, handleHoldFire(gs, targetId, elapsed));
          } else if (actionName === 'release_hold_fire') {
            sendMsgs(ws, handleReleaseHoldFire(gs, targetId, elapsed));
          } else if (actionName === 'engage') {
            const effId = msg.effector ?? '';
            sendMsgs(ws, handleEngage(gs, targetId, effId, elapsed, msg.shenobi_cm));
            sendMsgs(ws, advanceTutorialStep(gs, 'engage', targetId, effId));
          } else if (['shenobi_hold', 'shenobi_land_now', 'shenobi_deafen'].includes(actionName)) {
            sendMsgs(ws, handleEngage(gs, targetId, msg.effector ?? '', elapsed, actionName));
          } else if (actionName === 'jammer_toggle') {
            sendMsgs(ws, handleJammerToggle(gs, msg.effector_id ?? '', elapsed));
          } else if (actionName === 'jam_all') {
            sendMsgs(ws, handleJamAll(gs, elapsed));
          } else if (actionName === 'cease_jam') {
            sendMsgs(ws, handleCeaseJam(gs, elapsed));
          } else if (actionName === 'clear_airspace') {
            sendMsgs(ws, handleClearAirspace(gs, elapsed));
          } else if (actionName === 'pause_mission') {
            sendMsgs(ws, handlePauseMission(gs, elapsed));
            const tr = Math.max(0, gs.max_duration - elapsed);
            sendJson(ws, buildStateMsg(gs, elapsed, tr));
          } else if (actionName === 'resume_mission') {
            sendMsgs(ws, handleResumeMission(gs, elapsed));
            const tr = Math.max(0, gs.max_duration - elapsed);
            sendJson(ws, buildStateMsg(gs, elapsed, tr));
          } else if (actionName === 'end_mission') {
            handleEndMission(gs);
          }
        } else if (msgType === 'restart') {
          gs.phase = 'debrief'; // break out of loop
        }
      } catch (e) {
        sendJson(ws, { type: 'error', code: 'invalid_json', message: 'Invalid JSON message' });
      }
    }

    // Tick budget: wait remaining time
    const tickElapsedMs = (Date.now() / 1000 - tickStart) * 1000;
    const sleepMs = Math.max(10, gs.tick_rate * 1000 - tickElapsedMs);
    await sleep(sleepMs);
  }

  if (!closed) {
    // Send debrief
    sendJson(ws, buildDebrief(gs, catalog));

    // Keep connection open for restart
    await new Promise<void>((resolve) => {
      const onMessage = (data: Buffer | string) => {
        try {
          const msg = JSON.parse(typeof data === 'string' ? data : data.toString());
          if (msg.type === 'restart') {
            ws.off('message', onMessage);
            resolve();
          }
        } catch { /* ignore */ }
      };
      ws.on('message', onMessage);
      ws.on('close', () => resolve());
    });
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sendJson(ws: WebSocket, data: Record<string, unknown>): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function sendMsgs(ws: WebSocket, msgs: Record<string, unknown>[]): void {
  for (const m of msgs) sendJson(ws, m);
}

function waitForMessage(ws: WebSocket, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      resolve(null);
    }, timeoutMs);

    function onMessage(data: Buffer | string) {
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(typeof data === 'string' ? data : data.toString());
    }

    ws.on('message', onMessage);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT ?? '8000', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

try {
  await fastify.listen({ port: PORT, host: HOST });
  console.log(`SKYSHIELD server running on http://${HOST}:${PORT}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
