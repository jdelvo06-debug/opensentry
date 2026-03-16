import { useCallback, useState } from "react";
import HeaderBar from "./components/HeaderBar";
import SensorPanel from "./components/SensorPanel";
import EffectorPanel from "./components/EffectorPanel";
import TacticalMap from "./components/TacticalMap";
import TrackDetailPanel from "./components/TrackDetailPanel";
import EngagementPanel from "./components/EngagementPanel";
import EventLog from "./components/EventLog";
import DebriefScreen from "./components/DebriefScreen";
import { useWebSocket } from "./hooks/useWebSocket";
import type {
  EffectorStatus,
  EngagementZones,
  EventEntry,
  GamePhase,
  ScoreBreakdown,
  SensorStatus,
  ServerMessage,
  ThreatLevel,
  TrackData,
} from "./types";

export default function App() {
  const [phase, setPhase] = useState<GamePhase>("waiting");
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
  const [scenarioDesc, setScenarioDesc] = useState("");
  const [score, setScore] = useState<ScoreBreakdown | null>(null);
  const [droneReachedBase, setDroneReachedBase] = useState(false);
  const [engagementZones, setEngagementZones] =
    useState<EngagementZones | null>(null);

  const handleMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case "game_start":
        setScenarioName(msg.scenario.name);
        setScenarioDesc(msg.scenario.description);
        setSensors(msg.sensors);
        setSensorConfigs(msg.sensors);
        setEffectors(msg.effectors);
        setEffectorConfigs(msg.effectors);
        setEngagementZones(msg.engagement_zones);
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
        // Merge runtime status with initial configs (state msgs only have id+status)
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

        // Auto-select first detected track if nothing selected
        if (msg.tracks.length > 0) {
          setSelectedTrackId((prev) => {
            if (prev && msg.tracks.some((t) => t.id === prev)) return prev;
            const first = msg.tracks.find((t) => !t.neutralized);
            return first ? first.id : prev;
          });
        }
        break;

      case "event":
        setEvents((prev) => [
          ...prev,
          { timestamp: msg.timestamp, message: msg.message },
        ]);
        break;

      case "engagement_result":
        setEvents((prev) => [
          ...prev,
          {
            timestamp: 0,
            message: `ENGAGEMENT: ${msg.effector.toUpperCase()} → ${msg.target_id.toUpperCase()} — ${msg.effective ? "EFFECTIVE" : "INEFFECTIVE"} (${(msg.effectiveness * 100).toFixed(0)}%)`,
          },
        ]);
        break;

      case "debrief":
        setScore(msg.score);
        setDroneReachedBase(msg.drone_reached_base);
        setPhase("debrief");
        break;
    }
  }, []);

  const { connect, send, connected } = useWebSocket(handleMessage);

  const handleStart = () => {
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
    setPhase("waiting");
    connect("lone_wolf");
  };

  const handleRestart = () => {
    send({ type: "restart" });
    handleStart();
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

  // --- Waiting / Start screen ---
  if (phase === "waiting" && !connected) {
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
        {/* Subtle grid background */}
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
          {/* Logo */}
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

          {/* Scenario Card */}
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
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                marginBottom: 12,
              }}
            >
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  color: "#8b949e",
                  letterSpacing: 1.5,
                }}
              >
                SCENARIO
              </span>
            </div>
            <div
              style={{
                color: "#e6edf3",
                fontSize: 18,
                fontWeight: 700,
                marginBottom: 10,
                letterSpacing: 1,
              }}
            >
              LONE WOLF
            </div>
            <div
              style={{
                display: "flex",
                gap: 12,
                justifyContent: "center",
                marginBottom: 12,
              }}
            >
              <span
                style={{
                  padding: "3px 10px",
                  borderRadius: 10,
                  background: "#d2992222",
                  border: "1px solid #d2992244",
                  color: "#d29922",
                  fontSize: 10,
                  fontWeight: 600,
                }}
              >
                BEGINNER
              </span>
              <span
                style={{
                  padding: "3px 10px",
                  borderRadius: 10,
                  background: "#58a6ff11",
                  border: "1px solid #58a6ff33",
                  color: "#58a6ff",
                  fontSize: 10,
                  fontWeight: 600,
                }}
              >
                SINGLE TARGET
              </span>
            </div>
            <div
              style={{
                color: "#8b949e",
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              Commercial quadcopter (DJI-class) on direct approach. Low altitude,
              single target. Classify the threat and select an appropriate
              countermeasure before it reaches the base.
            </div>
          </div>

          {/* Start button */}
          <button
            onClick={handleStart}
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
            START MISSION
          </button>
        </div>
      </div>
    );
  }

  // --- Running / Active state ---
  const selectedTrack =
    tracks.find((t) => t.id === selectedTrackId) || null;

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
        }}
      >
        <TacticalMap
          tracks={tracks}
          selectedTrackId={selectedTrackId}
          onSelectTrack={setSelectedTrackId}
          engagementZones={engagementZones}
          elapsed={elapsed}
        />
      </div>

      {/* Right sidebar */}
      <div
        style={{
          gridRow: "2",
          gridColumn: "3",
          background: "#161b22",
          borderLeft: "1px solid #30363d",
          display: "flex",
          flexDirection: "column",
          overflow: "auto",
        }}
      >
        <TrackDetailPanel track={selectedTrack} />
        <EngagementPanel
          track={selectedTrack}
          effectors={effectors}
          onConfirmTrack={confirmTrack}
          onIdentify={identify}
          onEngage={engage}
        />
      </div>

      {/* Bottom: Event Log */}
      <EventLog events={events} />

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
