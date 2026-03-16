import { useCallback, useEffect, useRef, useState } from "react";
import HeaderBar from "./components/HeaderBar";
import SensorPanel from "./components/SensorPanel";
import EffectorPanel from "./components/EffectorPanel";
import TacticalMap from "./components/TacticalMap";
import TrackDetailPanel from "./components/TrackDetailPanel";
import EngagementPanel from "./components/EngagementPanel";
import EventLog from "./components/EventLog";
import DebriefScreen from "./components/DebriefScreen";
import ScenarioSelect from "./components/ScenarioSelect";
import LoadoutScreen from "./components/LoadoutScreen";
import PlacementScreen from "./components/PlacementScreen";
import CameraPanel from "./components/CameraPanel";
import { useWebSocket } from "./hooks/useWebSocket";
import { soundEngine } from "./audio/SoundEngine";
import type {
  BaseTemplate,
  CatalogEffector,
  CatalogSensor,
  EffectorStatus,
  EngagementZones,
  EventEntry,
  GamePhase,
  PlacementConfig,
  ScoreBreakdown,
  SensorStatus,
  ServerMessage,
  ThreatLevel,
  TrackData,
} from "./types";

const API_BASE = window.location.origin;

export default function App() {
  // --- Flow state ---
  const [phase, setPhase] = useState<GamePhase>("waiting");

  // Scenario + base selection
  const [scenarioId, setScenarioId] = useState<string>("");
  const [baseId, setBaseId] = useState<string>("");
  const [baseTemplate, setBaseTemplate] = useState<BaseTemplate | null>(null);

  // Equipment loadout
  const [selectedSensors, setSelectedSensors] = useState<CatalogSensor[]>([]);
  const [selectedEffectors, setSelectedEffectors] = useState<CatalogEffector[]>(
    [],
  );
  const [maxSensors, setMaxSensors] = useState(4);
  const [maxEffectors, setMaxEffectors] = useState(3);

  // Placement
  const [placementConfig, setPlacementConfig] =
    useState<PlacementConfig | null>(null);

  // Running phase state
  const [tracks, setTracks] = useState<TrackData[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [sensors, setSensors] = useState<SensorStatus[]>([]);
  const [sensorConfigs, setSensorConfigs] = useState<SensorStatus[]>([]);
  const [effectors, setEffectors] = useState<EffectorStatus[]>([]);
  const [effectorConfigs, setEffectorConfigs] = useState<EffectorStatus[]>([]);
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [threatLevel, setThreatLevel] = useState<ThreatLevel>("green");
  const [scenarioName, setScenarioName] = useState("");
  const [score, setScore] = useState<ScoreBreakdown | null>(null);
  const [droneReachedBase, setDroneReachedBase] = useState(false);
  const [engagementZones, setEngagementZones] =
    useState<EngagementZones | null>(null);

  // Camera panel
  const [cameraTrackId, setCameraTrackId] = useState<string | null>(null);

  // Track which tracks have already auto-opened the camera (so we only do it once)
  const autoOpenedCameraRef = useRef<Set<string>>(new Set());

  // Tutorial state
  const [isTutorial, setIsTutorial] = useState(false);
  const [tutorialMessage, setTutorialMessage] = useState<string | null>(null);
  const tutorialTimeoutRef = useRef<number>(0);

  // Pause state
  const [paused, setPaused] = useState(false);

  // Audio state
  const [audioMuted, setAudioMuted] = useState(soundEngine.muted);
  const [audioVolume, setAudioVolume] = useState(soundEngine.volume);
  const prevThreatLevelRef = useRef<ThreatLevel>("green");

  const handleToggleMute = useCallback(() => {
    soundEngine.init();
    const next = !soundEngine.muted;
    soundEngine.muted = next;
    setAudioMuted(next);
  }, []);

  const handleVolumeChange = useCallback((v: number) => {
    soundEngine.init();
    soundEngine.volume = v;
    setAudioVolume(v);
    if (soundEngine.muted && v > 0) {
      soundEngine.muted = false;
      setAudioMuted(false);
    }
  }, []);

  const handleMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case "game_start":
        setScenarioName(msg.scenario.name);
        setSensors(msg.sensors);
        setSensorConfigs(msg.sensors);
        setEffectors(msg.effectors);
        setEffectorConfigs(msg.effectors);
        setEngagementZones(msg.engagement_zones);
        setIsTutorial(msg.tutorial ?? false);
        setPhase("running");
        setEvents([
          {
            timestamp: 0,
            message: `SCENARIO LOADED: ${msg.scenario.name}`,
          },
        ]);
        break;

      case "state":
        setTracks(msg.tracks);
        setElapsed(msg.elapsed);
        setTimeRemaining(msg.time_remaining);
        setThreatLevel(msg.threat_level);
        setSensors((prev) => {
          const configs = prev.length ? prev : [];
          return msg.sensors.map((s) => {
            const cfg = configs.find((c) => c.id === s.id);
            return cfg ? { ...cfg, ...s } : s;
          });
        });
        setEffectors((prev) => {
          const configs = prev.length ? prev : [];
          return msg.effectors.map((e) => {
            const cfg = configs.find((c) => c.id === e.id);
            return cfg ? { ...cfg, ...e } : e;
          });
        });

        if (msg.tracks.length > 0) {
          setSelectedTrackId((prev) => {
            if (prev && msg.tracks.some((t) => t.id === prev)) return prev;
            const first = msg.tracks.find((t) => !t.neutralized);
            return first ? first.id : prev;
          });
        }
        break;

      case "event": {
        setEvents((prev) => [
          ...prev,
          { timestamp: msg.timestamp, message: msg.message },
        ]);
        // Trigger sounds based on event message content
        const m = msg.message;
        if (m.includes("New contact detected") || m.includes("New contact emerging")) {
          soundEngine.play("detection_ping");
        } else if (m.includes("Track") && m.includes("confirmed")) {
          soundEngine.play("track_confirmed");
        } else if (m.includes("identified as")) {
          soundEngine.play("identification_complete");
        }
        break;
      }

      case "engagement_result": {
        setEvents((prev) => [
          ...prev,
          {
            timestamp: 0,
            message: `ENGAGEMENT: ${msg.effector.toUpperCase()} → ${msg.target_id.toUpperCase()} — ${msg.effective ? "EFFECTIVE" : "INEFFECTIVE"} (${(msg.effectiveness * 100).toFixed(0)}%)`,
          },
        ]);
        // Play engagement sound based on effector type, then success/fail
        const eff = msg.effector.toLowerCase();
        if (eff.includes("kinetic") || eff.includes("interceptor")) {
          soundEngine.play("engagement_kinetic");
        } else if (eff.includes("jammer") || eff.includes("rf")) {
          soundEngine.play("engagement_electronic");
        } else if (eff.includes("directed") || eff.includes("energy") || eff.includes("laser")) {
          soundEngine.play("engagement_directed_energy");
        } else {
          soundEngine.play("engagement_electronic");
        }
        if (msg.effective) {
          setTimeout(() => soundEngine.play("target_defeated"), 500);
        }
        break;
      }

      case "tutorial":
        setTutorialMessage(msg.message);
        // Auto-dismiss after 12 seconds
        window.clearTimeout(tutorialTimeoutRef.current);
        tutorialTimeoutRef.current = window.setTimeout(() => {
          setTutorialMessage(null);
        }, 12000);
        break;

      case "debrief":
        setScore(msg.score);
        setDroneReachedBase(msg.drone_reached_base);
        setPhase("debrief");
        if (msg.drone_reached_base) {
          soundEngine.play("mission_fail");
        } else {
          soundEngine.play("debrief_reveal");
        }
        break;
    }
  }, []);

  const { connect, send, connected } = useWebSocket(handleMessage);

  // Sound: threat level change
  useEffect(() => {
    const prev = prevThreatLevelRef.current;
    if (threatLevel !== prev && phase === "running") {
      prevThreatLevelRef.current = threatLevel;
      if (threatLevel === "yellow") soundEngine.play("threat_yellow");
      else if (threatLevel === "orange") soundEngine.play("threat_orange");
      else if (threatLevel === "red") soundEngine.play("threat_red");
    } else {
      prevThreatLevelRef.current = threatLevel;
    }
  }, [threatLevel, phase]);

  // --- Refs for keyboard shortcut callbacks ---
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const selectedTrackIdRef = useRef(selectedTrackId);
  selectedTrackIdRef.current = selectedTrackId;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // --- Keyboard shortcuts ---
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only active during running phase
      if (phaseRef.current !== "running" && phaseRef.current !== "debrief")
        return;
      // Don't capture when typing in inputs
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;

      switch (e.code) {
        case "Space": {
          e.preventDefault();
          setPaused((p) => !p);
          break;
        }
        case "Digit1": {
          // Confirm track (DETECT→TRACK)
          const tid = selectedTrackIdRef.current;
          if (tid) {
            send({
              type: "action",
              action: "confirm_track",
              target_id: tid,
            });
          }
          break;
        }
        case "Digit2": {
          // Slew camera to selected track (re-center)
          const tid = selectedTrackIdRef.current;
          if (tid) {
            setCameraTrackId(tid);
            soundEngine.play("camera_slew");
          }
          break;
        }
        case "Digit3": {
          // Quick engage with first ready effector - just a shortcut hint
          // The actual engagement requires effector selection, so this is a no-op hint
          break;
        }
        case "Digit4": {
          // Unslew camera (return to standby/free-look)
          setCameraTrackId(null);
          break;
        }
        case "KeyM": {
          handleToggleMute();
          break;
        }
        case "Tab": {
          e.preventDefault();
          // Cycle through tracks
          const currentTracks = tracksRef.current.filter(
            (t) => !t.neutralized,
          );
          if (currentTracks.length === 0) break;
          const currentId = selectedTrackIdRef.current;
          const currentIdx = currentTracks.findIndex(
            (t) => t.id === currentId,
          );
          const nextIdx = (currentIdx + 1) % currentTracks.length;
          setSelectedTrackId(currentTracks[nextIdx].id);
          break;
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [send, handleToggleMute]);

  // --- Flow handlers ---

  const handleScenarioSelect = async (
    selScenarioId: string,
    selBaseId: string,
  ) => {
    setScenarioId(selScenarioId);
    setBaseId(selBaseId);

    // Fetch base template for the loadout screen limits
    try {
      const res = await fetch(`${API_BASE}/bases/${selBaseId}`);
      const data = await res.json();
      setBaseTemplate(data);
      setMaxSensors(data.max_sensors);
      setMaxEffectors(data.max_effectors);
    } catch {
      setMaxSensors(4);
      setMaxEffectors(3);
    }

    setPhase("equip");
  };

  const handleLoadoutConfirm = (
    sensors: CatalogSensor[],
    effectors: CatalogEffector[],
  ) => {
    setSelectedSensors(sensors);
    setSelectedEffectors(effectors);
    setPhase("plan");
  };

  const handlePlacementConfirm = (placement: PlacementConfig) => {
    setPlacementConfig(placement);
    // Reset running state
    setScore(null);
    setTracks([]);
    setSelectedTrackId(null);
    setEvents([]);
    setSensors([]);
    setSensorConfigs([]);
    setEffectors([]);
    setEffectorConfigs([]);
    setEngagementZones(null);
    setElapsed(0);
    setTimeRemaining(0);
    setThreatLevel("green");
    setCameraTrackId(null);
    autoOpenedCameraRef.current.clear();
    setTutorialMessage(null);
    setIsTutorial(false);
    setPaused(false);

    // Connect with placement data
    connect({
      scenarioId,
      baseId,
      placement,
    });
  };

  const handleRestart = () => {
    send({ type: "restart" });
    // Go back to scenario select
    setPhase("waiting");
    setScore(null);
    setTracks([]);
    setSelectedTrackId(null);
    setEvents([]);
    setSensors([]);
    setSensorConfigs([]);
    setEffectors([]);
    setEffectorConfigs([]);
    setEngagementZones(null);
    setElapsed(0);
    setTimeRemaining(0);
    setThreatLevel("green");
    setCameraTrackId(null);
    autoOpenedCameraRef.current.clear();
    setPlacementConfig(null);
    setTutorialMessage(null);
    setIsTutorial(false);
    setPaused(false);
  };

  const confirmTrack = (trackId: string) => {
    send({ type: "action", action: "confirm_track", target_id: trackId });
  };

  const identify = (
    trackId: string,
    classification: string,
    affiliation: string,
  ) => {
    send({
      type: "action",
      action: "identify",
      target_id: trackId,
      classification,
      affiliation,
    });
  };

  const engage = (trackId: string, effectorId: string) => {
    send({
      type: "action",
      action: "engage",
      target_id: trackId,
      effector: effectorId,
    });
  };

  const handleSlewCamera = (trackId: string) => {
    setCameraTrackId(trackId);
    soundEngine.play("camera_slew");
  };

  // --- Phase: Waiting (title screen) ---
  if (phase === "waiting") {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0d1117",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "linear-gradient(#1c233322 1px, transparent 1px), linear-gradient(90deg, #1c233322 1px, transparent 1px)",
            backgroundSize: "40px 40px",
            opacity: 0.6,
          }}
        />
        <div
          style={{
            position: "relative",
            zIndex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 24,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 48,
                fontWeight: 700,
                color: "#e6edf3",
                letterSpacing: 6,
                fontFamily: "'Inter', sans-serif",
              }}
            >
              SKYSHIELD
            </div>
            <div
              style={{
                fontSize: 12,
                color: "#8b949e",
                letterSpacing: 4,
                textAlign: "center",
                marginTop: 4,
                fontWeight: 500,
              }}
            >
              C-UAS TRAINING SIMULATOR
            </div>
          </div>

          <div
            style={{
              marginTop: 16,
              padding: "20px 28px",
              background: "#161b22",
              border: "1px solid #30363d",
              borderRadius: 8,
              maxWidth: 480,
              width: "100%",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: 9,
                fontWeight: 600,
                color: "#8b949e",
                letterSpacing: 1.5,
                marginBottom: 12,
              }}
            >
              TRAINING FLOW
            </div>
            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "center",
                marginBottom: 16,
              }}
            >
              {["SELECT", "EQUIP", "PLAN", "EXECUTE", "DEBRIEF"].map(
                (step) => (
                  <span
                    key={step}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 4,
                      background: "#21262d",
                      color: "#8b949e",
                      fontSize: 9,
                      fontWeight: 600,
                      letterSpacing: 1,
                    }}
                  >
                    {step}
                  </span>
                ),
              )}
            </div>
            <div
              style={{
                color: "#8b949e",
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              Select a scenario and base, choose your equipment, plan your
              defense, then execute the DTID kill chain.
            </div>
          </div>

          <button
            onClick={() => { soundEngine.init(); setPhase("scenario_select"); }}
            style={{
              marginTop: 8,
              padding: "14px 56px",
              background: "#58a6ff",
              border: "none",
              borderRadius: 6,
              color: "#0d1117",
              fontFamily: "'Inter', sans-serif",
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: 2,
              cursor: "pointer",
              transition: "all 0.15s",
              boxShadow: "0 4px 16px rgba(88, 166, 255, 0.3)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "#79b8ff";
              (e.currentTarget as HTMLElement).style.boxShadow =
                "0 6px 24px rgba(88, 166, 255, 0.45)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "#58a6ff";
              (e.currentTarget as HTMLElement).style.boxShadow =
                "0 4px 16px rgba(88, 166, 255, 0.3)";
            }}
          >
            BEGIN TRAINING
          </button>
        </div>
      </div>
    );
  }

  // --- Phase: Scenario Select ---
  if (phase === "scenario_select") {
    return <ScenarioSelect onSelect={handleScenarioSelect} />;
  }

  // --- Phase: Equipment Loadout ---
  if (phase === "equip") {
    return (
      <LoadoutScreen
        maxSensors={maxSensors}
        maxEffectors={maxEffectors}
        onConfirm={handleLoadoutConfirm}
        onBack={() => setPhase("scenario_select")}
      />
    );
  }

  // --- Phase: Placement ---
  if (phase === "plan" && baseTemplate) {
    return (
      <PlacementScreen
        baseTemplate={baseTemplate}
        selectedSensors={selectedSensors}
        selectedEffectors={selectedEffectors}
        onConfirm={handlePlacementConfirm}
        onBack={() => setPhase("equip")}
      />
    );
  }

  // --- Phase: Running ---
  const selectedTrack =
    tracks.find((t) => t.id === selectedTrackId) || null;
  const cameraTrack =
    cameraTrackId ? tracks.find((t) => t.id === cameraTrackId) || null : null;

  return (
    <div
      style={{
        height: "100vh",
        display: "grid",
        gridTemplateRows: "48px 1fr 120px",
        gridTemplateColumns: "220px 1fr 280px",
        background: "#0d1117",
      }}
    >
      {/* Header */}
      <HeaderBar
        elapsed={elapsed}
        timeRemaining={timeRemaining}
        threatLevel={threatLevel}
        scenarioName={scenarioName}
        muted={audioMuted}
        volume={audioVolume}
        onToggleMute={handleToggleMute}
        onVolumeChange={handleVolumeChange}
      />

      {/* Left sidebar */}
      <div
        style={{
          gridRow: "2",
          gridColumn: "1",
          background: "#161b22",
          borderRight: "1px solid #30363d",
          display: "flex",
          flexDirection: "column",
          overflow: "auto",
        }}
      >
        <SensorPanel sensors={sensors} />
        <EffectorPanel effectors={effectors} />
      </div>

      {/* Center: Tactical Map */}
      <div
        style={{
          gridRow: "2",
          gridColumn: "2",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <TacticalMap
          tracks={tracks}
          selectedTrackId={selectedTrackId}
          onSelectTrack={setSelectedTrackId}
          engagementZones={engagementZones}
          elapsed={elapsed}
          baseLat={baseTemplate?.center_lat}
          baseLng={baseTemplate?.center_lng}
          defaultZoom={baseTemplate?.default_zoom}
          effectors={effectors}
          onConfirmTrack={confirmTrack}
          onIdentify={identify}
          onEngage={engage}
          onSlewCamera={handleSlewCamera}
        />

        {/* Tutorial overlay banner */}
        {isTutorial && tutorialMessage && (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              zIndex: 100,
              background: "rgba(88, 166, 255, 0.15)",
              borderBottom: "1px solid rgba(88, 166, 255, 0.4)",
              backdropFilter: "blur(4px)",
              padding: "12px 20px",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <span
              style={{
                fontFamily: "monospace",
                fontSize: 10,
                fontWeight: 700,
                color: "#58a6ff",
                letterSpacing: 1.5,
                flexShrink: 0,
              }}
            >
              TUTORIAL
            </span>
            <span
              style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: 13,
                color: "#e6edf3",
                lineHeight: 1.5,
              }}
            >
              {tutorialMessage}
            </span>
            <button
              onClick={() => setTutorialMessage(null)}
              style={{
                marginLeft: "auto",
                background: "none",
                border: "1px solid rgba(88, 166, 255, 0.3)",
                color: "#8b949e",
                cursor: "pointer",
                fontFamily: "monospace",
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 3,
                flexShrink: 0,
              }}
            >
              OK
            </button>
          </div>
        )}

        {/* Pause overlay */}
        {paused && phase === "running" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 90,
              background: "rgba(0,0,0,0.6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                fontFamily: "monospace",
                fontSize: 28,
                color: "#d29922",
                letterSpacing: 6,
                fontWeight: 700,
              }}
            >
              PAUSED
            </div>
          </div>
        )}
      </div>

      {/* Right sidebar — split: top scrollable (track+engagement), bottom fixed (camera) */}
      <div
        style={{
          gridRow: "2",
          gridColumn: "3",
          background: "#161b22",
          borderLeft: "1px solid #30363d",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
          <TrackDetailPanel track={selectedTrack} />
          <EngagementPanel
            track={selectedTrack}
            effectors={effectors}
            onConfirmTrack={confirmTrack}
            onIdentify={identify}
            onEngage={engage}
            onSlewCamera={handleSlewCamera}
          />
        </div>
        <CameraPanel
          track={cameraTrack}
          allTracks={tracks}
          sensorConfigs={sensorConfigs}
        />
      </div>

      {/* Bottom: Event Log */}
      <EventLog events={events} />

      {/* Keyboard shortcuts hint */}
      {phase === "running" && (
        <div
          style={{
            position: "fixed",
            bottom: 6,
            left: 8,
            zIndex: 50,
            fontFamily: "monospace",
            fontSize: 9,
            color: "#484f58",
            letterSpacing: 0.5,
          }}
        >
          SPACE:Pause TAB:Cycle 1:Confirm 2:Slew 4:Unslew M:Mute
        </div>
      )}

      {/* Debrief overlay */}
      {phase === "debrief" && score && (
        <DebriefScreen
          score={score}
          droneReachedBase={droneReachedBase}
          scenarioName={scenarioName}
          onRestart={handleRestart}
        />
      )}
    </div>
  );
}
