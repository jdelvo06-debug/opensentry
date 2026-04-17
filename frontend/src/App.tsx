import React, { useCallback, useEffect, useRef, useState } from "react";
import HeaderBar from "./components/HeaderBar";
import SensorPanel from "./components/SensorPanel";
import EffectorPanel from "./components/EffectorPanel";
import TrackList from "./components/TrackList";
import TacticalMap from "./components/TacticalMap";
import type { InterceptAnimationData } from "./components/TacticalMap";
import TrackDetailPanel from "./components/TrackDetailPanel";
import EngagementPanel from "./components/EngagementPanel";
import EventLog from "./components/EventLog";
import DebriefScreen from "./components/DebriefScreen";
import ScenarioSelect from "./components/ScenarioSelect";
import LandingPage from "./components/LandingPage";
import "./components/LandingPage.css";
import LoadoutScreen from "./components/LoadoutScreen";
import PlacementScreen from "./components/PlacementScreen";
import CameraPanel from "./components/CameraPanel";
import TutorialStepTracker from "./components/TutorialStepTracker";
import { TutorialTourOverlay, TutorialPracticeOverlay, UI_TOUR_STEPS } from "./components/TutorialOverlay";
import FeedbackModal from "./components/FeedbackModal";
import TutorialFeedback from "./components/TutorialFeedback";
import ATCCommsPanel from "./components/ATCCommsPanel";
import PauseOverlay from "./components/PauseOverlay";
import ROEBriefing from "./components/ROEBriefing";
import StudyLibrary from "./components/StudyLibrary";
import StudyModule from "./components/StudyModule";
import BaseDefenseArchitect from "./components/BaseDefenseArchitect";

import { useGameEngine as useWebSocket } from "./hooks/useGameEngine";
import "./app.css";
import { soundEngine } from "./audio/SoundEngine";
import type {
  BaseTemplate,
  CatalogCombined,
  CatalogEffector,
  CatalogSensor,
  DebriefStats,
  EffectorStatus,
  EngagementZones,
  EventEntry,
  GamePhase,
  PlacementConfig,
  ProtectedAreaInfo,
  ScoreBreakdown,
  SensorStatus,
  ServerMessage,
  ThreatLevel,
  TrackData,
} from "./types";

const API_BASE = window.location.origin;

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null; errorInfo: React.ErrorInfo | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ error, errorInfo });
    console.error("[ErrorBoundary] Caught render error:", error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "#1a0000",
            color: "#ff6b6b",
            padding: 32,
            overflow: "auto",
            fontFamily: "monospace",
          }}
        >
          <h2 style={{ color: "#ff4444", margin: "0 0 16px" }}>
            RENDER ERROR
          </h2>
          <div
            style={{
              background: "#2d0000",
              border: "1px solid #ff4444",
              borderRadius: 6,
              padding: 16,
              marginBottom: 16,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
              {this.state.error.message}
            </div>
            <pre
              style={{
                fontSize: 11,
                color: "#cc8888",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                margin: 0,
              }}
            >
              {this.state.error.stack}
            </pre>
          </div>
          {this.state.errorInfo && (
            <div
              style={{
                background: "#2d0000",
                border: "1px solid #662222",
                borderRadius: 6,
                padding: 16,
              }}
            >
              <div
                style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: "#ff6b6b" }}
              >
                Component Stack
              </div>
              <pre
                style={{
                  fontSize: 11,
                  color: "#cc8888",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  margin: 0,
                }}
              >
                {this.state.errorInfo.componentStack}
              </pre>
            </div>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  // --- Flow state ---
  const [phase, setPhase] = useState<GamePhase>("waiting");
  const [showFeedback, setShowFeedback] = useState(false);
  const [activeStudyModule, setActiveStudyModule] = useState<string | null>(null);

  // ROE briefing
  const [roeBriefing, setRoeBriefing] = useState<string[]>([]);
  const [roeScenarioName, setRoeScenarioName] = useState("");
  const pendingRoeLaunchRef = useRef<(() => void) | null>(null);
  const [showRoeOverlay, setShowRoeOverlay] = useState(false);

  // Scenario + base selection
  const [scenarioId, setScenarioId] = useState<string>("");
  const [baseId, setBaseId] = useState<string>("");
  const [baseTemplate, setBaseTemplate] = useState<BaseTemplate | null>(null);

  // Equipment loadout
  const [selectedSensors, setSelectedSensors] = useState<CatalogSensor[]>([]);
  const [selectedEffectors, setSelectedEffectors] = useState<CatalogEffector[]>(
    [],
  );
  const [selectedCombined, setSelectedCombined] = useState<CatalogCombined[]>(
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
  const [hookedTrackIds, setHookedTrackIds] = useState<Set<string>>(new Set());
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
  const [baseBreached, setBaseBreached] = useState(false);
  const [engagementZones, setEngagementZones] =
    useState<EngagementZones | null>(null);
  const [protectedArea, setProtectedArea] = useState<ProtectedAreaInfo | null>(null);

  // Camera panel
  const [cameraTrackId, setCameraTrackId] = useState<string | null>(null);

  // Track which tracks have already auto-opened the camera (so we only do it once)
  const autoOpenedCameraRef = useRef<Set<string>>(new Set());

  // Free-play state
  const [isFreePlay, setIsFreePlay] = useState(false);

  // Tutorial state
  const [isTutorial, setIsTutorial] = useState(false);
  const [tutorialMessage, setTutorialMessage] = useState<string | null>(null);
  const tutorialTimeoutRef = useRef<number>(0);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [tutorialFeedback, setTutorialFeedback] = useState<string | null>(null);
  const [tutorialTourActive, setTutorialTourActive] = useState(false);
  const [tutorialTourStep, setTutorialTourStep] = useState(0);

  // Pause state
  const [paused, setPaused] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);

  // Audio state
  const [audioMuted, setAudioMuted] = useState(soundEngine.muted);
  const [audioVolume, setAudioVolume] = useState(soundEngine.volume);
  const prevThreatLevelRef = useRef<ThreatLevel>("green");

  // Wave system
  const [waveNumber, setWaveNumber] = useState(1);
  const [wavesCompleted, setWavesCompleted] = useState(1);
  const [ambientSuppressedUntil, setAmbientSuppressedUntil] = useState(0);

  // Active jamming state: maps effector id -> expiry timestamp
  const [activeJammers, setActiveJammers] = useState<Record<string, number>>({});

  // Active JACKAL intercept animations
  const [activeIntercepts, setActiveIntercepts] = useState<InterceptAnimationData[]>([]);

  // Alert system state
  const [alertCount, setAlertCount] = useState(0);
  const [newContactBanner, setNewContactBanner] = useState<string | null>(null);
  const newContactTimerRef = useRef<number>(0);
  const [trackBlinkStates, setTrackBlinkStates] = useState<Record<string, string>>({});
  const prevTrackIdsRef = useRef<Set<string>>(new Set());
  const tracksInWarningRef = useRef<Set<string>>(new Set());
  const tracksInProtectedRef = useRef<Set<string>>(new Set());
  const tracksCriticalRef = useRef<Set<string>>(new Set());
  const engagedTracksRef = useRef<Set<string>>(new Set());
  const detectionPingedRef = useRef<Set<string>>(new Set()); // tracks that have already triggered a detection ping

  // ATC coordination state
  const [atcCommsMessages, setAtcCommsMessages] = useState<Record<string, { direction: "out" | "in"; text: string }[]>>({});
  const [atcPanelTrackId, setAtcPanelTrackId] = useState<string | null>(null);
  const atcPanelTimerRef = useRef<number>(0);

  const atcIffAssignedRef = useRef<Set<string>>(new Set()); // track IDs already assigned iff_status

  // Debrief scorecard state
  const [debriefStats, setDebriefStats] = useState<DebriefStats | null>(null);
  const tracksSpawnedRef = useRef<Set<string>>(new Set());
  const tracksDetectedRef = useRef<Set<string>>(new Set());
  const tracksConfirmedRef = useRef<Set<string>>(new Set());
  const tracksIdentifiedRef = useRef<Set<string>>(new Set());
  const tracksDefeatedRef = useRef<Set<string>>(new Set());
  const blueOnBlueRef = useRef<number>(0);
  const atcCallsMadeRef = useRef<number>(0);
  const atcCallLogRef = useRef<{ trackId: string; response: string }[]>([]);
  const roeViolationsRef = useRef<string[]>([]);

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
        try {
          console.log("[game_start] Received:", JSON.stringify(msg, null, 2));
          setScenarioName(msg.scenario.name);
          setSensors(msg.sensors);
          setSensorConfigs(msg.sensors);
          setEffectors(msg.effectors);
          setEffectorConfigs(msg.effectors);
          setEngagementZones(msg.engagement_zones);
          setProtectedArea(msg.protected_area ?? null);
          setIsTutorial(msg.tutorial ?? false);
          setPhase("running");
          setEvents([
            {
              timestamp: 0,
              message: `SCENARIO LOADED: ${msg.scenario.name}`,
            },
          ]);
        } catch (err) {
          console.error("[game_start] Error processing game_start message:", err);
          console.error("[game_start] Message was:", msg);
        }
        break;

      case "state":
        setTracks((prev) => {
          return msg.tracks.map((t) => {
            // Preserve ATC fields from previous state
            const prevTrack = prev.find((p) => p.id === t.id);
            if (prevTrack?.iff_status != null) {
              return {
                ...t,
                iff_status: prevTrack.iff_status,
                atc_called: prevTrack.atc_called,
                atc_response_pending: prevTrack.atc_response_pending,
                atc_response_received: prevTrack.atc_response_received,
                atc_response_text: prevTrack.atc_response_text,
                affiliation: t.affiliation,
              };
            }
            // Assign iff_status to new tracks: 15% chance of UNKNOWN, or if affiliation is already unknown/UNKNOWN
            if (!atcIffAssignedRef.current.has(t.id)) {
              atcIffAssignedRef.current.add(t.id);
              const isUnknownAffil = t.affiliation?.toLowerCase() === "unknown";
              if (!t.is_ambient && !t.is_interceptor && (isUnknownAffil || Math.random() < 0.15)) {
                return {
                  ...t,
                  affiliation: "unknown" as const,
                  iff_status: "unknown" as const,
                  atc_called: false,
                  atc_response_pending: false,
                  atc_response_received: false,
                  atc_response_text: "",
                };
              }
            }
            return t;
          });
        });
        // Track debrief stats from incoming tracks
        for (const t of msg.tracks) {
          if (t.is_ambient || t.is_interceptor) continue;
          tracksSpawnedRef.current.add(t.id);
          if (t.dtid_phase === "detected" || t.dtid_phase === "tracked" || t.dtid_phase === "identified" || t.dtid_phase === "defeated") {
            tracksDetectedRef.current.add(t.id);
          }
          if (t.dtid_phase === "tracked" || t.dtid_phase === "identified" || t.dtid_phase === "defeated") {
            tracksConfirmedRef.current.add(t.id);
          }
          if (t.dtid_phase === "identified" || t.dtid_phase === "defeated") {
            tracksIdentifiedRef.current.add(t.id);
          }
          if (t.dtid_phase === "defeated" || t.neutralized) {
            tracksDefeatedRef.current.add(t.id);
          }
        }
        setElapsed(msg.elapsed);
        setTimeRemaining(msg.time_remaining);
        setThreatLevel(msg.threat_level);
        if (msg.wave_number != null) setWaveNumber(msg.wave_number);
        if (msg.ambient_suppressed_until != null) setAmbientSuppressedUntil(msg.ambient_suppressed_until);
        if (msg.paused != null) setPaused(msg.paused);
        if (msg.tutorial_step != null) setTutorialStep(msg.tutorial_step);
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
            // During tutorial steps 0-1, don't auto-select — player must click the track themselves
            if (isTutorialRef.current && tutorialStepRef.current < 2) return prev;
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
          // Extract track ID to debounce — only ping once per unique track
          const trackMatch = m.match(/—\s+([A-Z0-9-]+)\s*$/);
          const trackId = trackMatch ? trackMatch[1].toLowerCase() : m;
          if (!detectionPingedRef.current.has(trackId)) {
            detectionPingedRef.current.add(trackId);
            soundEngine.play("detection_ping");
          }
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
        // Track JACKAL intercept animation
        const effLower = msg.effector.toLowerCase();
        if (effLower.includes("jackal") || effLower.includes("interceptor")) {
          // Find effector and target positions
          const effObj = effectors.find((e) => e.id === msg.effector) || effectorConfigs.find((e) => e.id === msg.effector);
          const target = tracks.find((t) => t.id === msg.target_id);
          if (effObj && target && effObj.x != null) {
            const interceptId = `intercept-${Date.now()}`;
            const duration = 4000; // 4 seconds
            const newIntercept: InterceptAnimationData = {
              id: interceptId,
              effectorId: msg.effector,
              targetId: msg.target_id,
              startX: effObj.x ?? 0,
              startY: effObj.y ?? 0,
              targetX: target.x,
              targetY: target.y,
              effective: msg.effective,
              startTime: Date.now(),
              duration,
            };
            setActiveIntercepts((prev) => [...prev, newIntercept]);
            // Remove after animation completes + explosion time
            setTimeout(() => {
              setActiveIntercepts((prev) => prev.filter((a) => a.id !== interceptId));
            }, duration + 1500);
          }
        }

        // Track active jammer state for EW radiate visual
        if (effLower.includes("jammer") || effLower.includes("rf")) {
          // Mark jammer as radiating for its recharge duration
          const rechargeMs = 10000; // 10s default jammer recharge
          const expiry = Date.now() + rechargeMs;
          setActiveJammers((prev) => ({ ...prev, [msg.effector]: expiry }));
          setTimeout(() => {
            setActiveJammers((prev) => {
              const next = { ...prev };
              delete next[msg.effector];
              return next;
            });
          }, rechargeMs);
        }

        // Play engagement sound based on effector type, then success/fail
        const eff = msg.effector.toLowerCase();
        if (eff.includes("kinetic") || eff.includes("interceptor")) {
          soundEngine.play("engagement_kinetic");
        } else if (eff.includes("jammer") || eff.includes("rf")) {
          soundEngine.play("engagement_electronic");
        } else if (eff.includes("directed") || eff.includes("energy") || eff.includes("laser") || eff.includes("de_laser") || eff.includes("de_hpm") || eff.includes("hpm")) {
          soundEngine.play("engagement_directed_energy");
        } else {
          soundEngine.play("engagement_electronic");
        }
        if (msg.effective) {
          setTimeout(() => soundEngine.play("target_defeated"), 500);
          // Green flash on defeated track
          setTrackBlinkStates((prev) => ({ ...prev, [msg.target_id]: "track-flash-green" }));
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

      case "tutorial_feedback":
        setTutorialFeedback(msg.message);
        break;

      case "base_breach":
        setBaseBreached(true);
        soundEngine.play("critical_alarm");
        setEvents((prev) => [
          ...prev,
          { timestamp: msg.timestamp, message: msg.message || "\u26a0 BASE PERIMETER BREACHED" },
        ]);
        break;

      case "debrief":
        setScore(msg.score);
        setDroneReachedBase(msg.drone_reached_base);
        setWavesCompleted(msg.waves_completed ?? 1);
        setPhase("debrief");
        setDebriefStats({
          scenarioName: scenarioNameRef.current || "Unknown",
          durationSeconds: elapsedRef.current,
          tracksSpawned: tracksSpawnedRef.current.size,
          tracksDetected: tracksDetectedRef.current.size,
          tracksConfirmed: tracksConfirmedRef.current.size,
          tracksIdentified: tracksIdentifiedRef.current.size,
          tracksDefeated: tracksDefeatedRef.current.size,
          blueOnBlueCount: blueOnBlueRef.current,
          atcCallsMade: atcCallsMadeRef.current,
          atcCallLog: [...atcCallLogRef.current],
          roeViolations: [...roeViolationsRef.current],
          success: isFreePlayRef.current ? !msg.drone_reached_base : !msg.drone_reached_base && tracksDefeatedRef.current.size > 0,
          isTutorial: isTutorialRef.current,
        });
        if (msg.drone_reached_base) {
          soundEngine.play("mission_fail");
          soundEngine.play("critical_alarm");
        } else {
          soundEngine.play("debrief_reveal");
        }
        break;
    }
  }, []);

  const { connect, send, connected } = useWebSocket(handleMessage);
  const sendRef = useRef(send);
  sendRef.current = send;

  // Alert system: detect new tracks, zone entries, threat escalation
  useEffect(() => {
    if (phase !== "running" || !protectedArea) return;

    const currentTrackIds = new Set(tracks.filter((t) => !t.neutralized).map((t) => t.id));
    const prevIds = prevTrackIdsRef.current;
    const newBlinks: Record<string, string> = {};
    let alerts = 0;

    for (const track of tracks) {
      if (track.neutralized) continue;

      const isNew = !prevIds.has(track.id);
      const eta = track.eta_protected;
      const distToProtected = eta != null ? eta : Infinity;

      // New contact detection
      if (isNew && track.dtid_phase === "detected") {
        // Flash track 3 times (slow blink)
        newBlinks[track.id] = "track-blink-slow";
        alerts++;

        // Show NEW CONTACT banner
        setNewContactBanner((track.display_label || track.id).toUpperCase());
        window.clearTimeout(newContactTimerRef.current);
        newContactTimerRef.current = window.setTimeout(() => {
          setNewContactBanner(null);
        }, 3000);
      }

      // Warning area entry — eta_protected is in SECONDS
      if (eta != null) {
        // Thresholds: warning = 120s out, critical = 45s, protected = 10s
        const inWarning = distToProtected <= 120;
        const isCritical = distToProtected <= 45;
        const inProtected = distToProtected <= 10;

        // Only fire each alert once per approach (set-based dedup)
        if (isCritical && !tracksCriticalRef.current.has(track.id)) {
          tracksCriticalRef.current.add(track.id);
          newBlinks[track.id] = "track-blink-rapid";
          if (!isNew) soundEngine.play("critical_alarm"); // suppress on spawn
          alerts++;
        } else if (inProtected && !tracksInProtectedRef.current.has(track.id)) {
          tracksInProtectedRef.current.add(track.id);
          newBlinks[track.id] = "track-blink-fast";
          if (!isNew) soundEngine.play("protected_area_entry");
          alerts++;
        } else if (inWarning && !tracksInWarningRef.current.has(track.id)) {
          tracksInWarningRef.current.add(track.id);
          newBlinks[track.id] = "track-blink-fast";
          if (!isNew) soundEngine.play("warning_area_entry");
          alerts++;
        } else if (tracksCriticalRef.current.has(track.id)) {
          newBlinks[track.id] = "track-blink-rapid";
          alerts++;
        } else if (tracksInProtectedRef.current.has(track.id)) {
          newBlinks[track.id] = "track-blink-fast";
          alerts++;
        } else if (tracksInWarningRef.current.has(track.id)) {
          // Keep fast blink while in warning zone
          newBlinks[track.id] = "track-blink-fast";
          alerts++;
        }
      }

      // Engagement blink (track in "defeated" phase but not yet neutralized = engaged)
      if (track.dtid_phase === "defeated" && !track.neutralized) {
        newBlinks[track.id] = "track-blink-engaged";
      }
    }

    // Clean up refs for neutralized/removed tracks
    for (const id of prevIds) {
      if (!currentTrackIds.has(id)) {
        tracksInWarningRef.current.delete(id);
        tracksInProtectedRef.current.delete(id);
        tracksCriticalRef.current.delete(id);
        engagedTracksRef.current.delete(id);
      }
    }

    prevTrackIdsRef.current = currentTrackIds;
    setTrackBlinkStates(newBlinks);
    setAlertCount(alerts);
  }, [tracks, phase, protectedArea]);

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

  // --- Refs for callbacks that need current values ---
  const scenarioNameRef = useRef(scenarioName);
  scenarioNameRef.current = scenarioName;
  const elapsedRef = useRef(elapsed);
  elapsedRef.current = elapsed;
  const isTutorialRef = useRef(isTutorial);
  isTutorialRef.current = isTutorial;
  const tutorialStepRef = useRef(tutorialStep);
  tutorialStepRef.current = tutorialStep;
  const isFreePlayRef = useRef(isFreePlay);
  isFreePlayRef.current = isFreePlay;
  const droneReachedBaseRef = useRef(droneReachedBase);
  droneReachedBaseRef.current = droneReachedBase;

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
        case "KeyP": {
          e.preventDefault();
          if (pausedRef.current) {
            send({ type: "action", action: "resume_mission" });
          } else {
            send({ type: "action", action: "pause_mission" });
          }
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
            send({ type: "action", action: "slew_camera", target_id: tid });
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
        case "Escape": {
          if (phaseRef.current === "running") {
            send({ type: "action", action: "end_mission", target_id: "" });
          }
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
    customLocation?: { lat: number; lng: number; name: string },
  ) => {
    setScenarioId(selScenarioId);
    setBaseId(selBaseId);

    if (customLocation) {
      // Build a custom base template from Small FOB structure at the custom coordinates
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}data/bases/small_fob.json`);
        const fobData = await res.json();
        const customBase: BaseTemplate = {
          ...fobData,
          id: "custom_location",
          name: `Custom: ${customLocation.name}`,
          description: `Custom location at ${customLocation.lat.toFixed(4)}, ${customLocation.lng.toFixed(4)}`,
          center_lat: customLocation.lat,
          center_lng: customLocation.lng,
          default_zoom: 15,
        };
        setBaseTemplate(customBase);
        setMaxSensors(customBase.max_sensors);
        setMaxEffectors(customBase.max_effectors);
      } catch {
        setMaxSensors(3);
        setMaxEffectors(2);
      }
    } else {
      // Fetch base template for the loadout screen limits
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}data/bases/${selBaseId}.json`);
        const data = await res.json();
        setBaseTemplate(data);
        setMaxSensors(data.max_sensors);
        setMaxEffectors(data.max_effectors);
      } catch {
        setMaxSensors(4);
        setMaxEffectors(3);
      }
    }

    // Fetch scenario ROE and show briefing before equip
    try {
      const scenarioRes = await fetch(`${import.meta.env.BASE_URL}data/scenarios/${selScenarioId}.json`);
      const scenarioData = await scenarioRes.json();
      const roe: string[] = scenarioData.roe_briefing ?? [];
      setRoeBriefing(roe);
      setRoeScenarioName(scenarioData.name ?? selScenarioId);
      pendingRoeLaunchRef.current = () => {
        setPhase("equip");
      };
      setPhase("roe_briefing");
    } catch {
      // If we can't load ROE, skip to equip
      setPhase("equip");
    }
  };

  const handleLoadoutConfirm = (
    sensors: CatalogSensor[],
    effectors: CatalogEffector[],
    combined: CatalogCombined[] = [],
  ) => {
    setSelectedSensors(sensors);
    setSelectedEffectors(effectors);
    setSelectedCombined(combined);
    setPhase("plan");
  };

  const handlePlacementConfirm = (
    placement: PlacementConfig,
    overrideScenarioId?: string,
    overrideBaseId?: string,
  ) => {
    setPlacementConfig(placement);
    // Reset running state
    setScore(null);
    setTracks([]);
    setSelectedTrackId(null);
    setHookedTrackIds(new Set());
    setEvents([]);
    setSensors([]);
    setSensorConfigs([]);
    setEffectors([]);
    setEffectorConfigs([]);
    setEngagementZones(null);
    setProtectedArea(null);
    setElapsed(0);
    setTimeRemaining(0);
    setThreatLevel("green");
    setCameraTrackId(null);
    autoOpenedCameraRef.current.clear();
      detectionPingedRef.current.clear();
    setTutorialMessage(null);
    setIsTutorial(false);
    setIsFreePlay(false);
    setTutorialStep(0);
    setTutorialFeedback(null);
    setPaused(false);
    setNotes([]);
    setWaveNumber(1);

    // Connect with placement data — score placement since player placed equipment
    connect({
      scenarioId: overrideScenarioId ?? scenarioId,
      baseId: overrideBaseId ?? baseId,
      placement,
      scorePlacement: true,
    });
  };

  const resetAllState = () => {
    setScore(null);
    setTracks([]);
    setSelectedTrackId(null);
    setHookedTrackIds(new Set());
    setEvents([]);
    setSensors([]);
    setSensorConfigs([]);
    setEffectors([]);
    setEffectorConfigs([]);
    setEngagementZones(null);
    setProtectedArea(null);
    setElapsed(0);
    setTimeRemaining(0);
    setThreatLevel("green");
    setCameraTrackId(null);
    autoOpenedCameraRef.current.clear();
      detectionPingedRef.current.clear();
    setBaseBreached(false);
    setPlacementConfig(null);
    setTutorialMessage(null);
    setIsTutorial(false);
    setIsFreePlay(false);
    setTutorialStep(0);
    setTutorialFeedback(null);
    setPaused(false);
    setNotes([]);
    setWaveNumber(1);
    setShowRoeOverlay(false);
    // ATC reset
    setAtcCommsMessages({});
    setAtcPanelTrackId(null);
    window.clearTimeout(atcPanelTimerRef.current);
    atcIffAssignedRef.current.clear();
    // Debrief stats reset
    setDebriefStats(null);
    tracksSpawnedRef.current = new Set();
    tracksDetectedRef.current = new Set();
    tracksConfirmedRef.current = new Set();
    tracksIdentifiedRef.current = new Set();
    tracksDefeatedRef.current = new Set();
    blueOnBlueRef.current = 0;
    atcCallsMadeRef.current = 0;
    atcCallLogRef.current = [];
    roeViolationsRef.current = [];
  };

  const handleRestart = () => {
    send({ type: "restart" });
    resetAllState();
    setPhase("waiting");
  };

  const handleMainMenu = () => {
    send({ type: "restart" });
    resetAllState();
    setPhase("waiting");
  };

  const confirmTrack = (trackId: string) => {
    // BLUE-ON-BLUE check for confirm on UNKNOWN track without ATC
    const ct = tracks.find((t) => t.id === trackId);
    if (ct?.iff_status === "unknown" && !ct.atc_response_received) {
      const label = ct.display_label ?? trackId;
      blueOnBlueRef.current++;
      roeViolationsRef.current.push(`Confirmed UNKNOWN track ${label.toUpperCase()} without ATC clearance`);
      setEvents((prev) => [
        ...prev,
        { timestamp: elapsed, message: `BLUE-ON-BLUE: Action on unverified track ${label.toUpperCase()} — ATC not consulted! Score penalty applied.` },
      ]);
    }
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

  const declareAffiliation = (trackId: string, affiliation: string) => {
    send({
      type: "action",
      action: "declare_affiliation",
      target_id: trackId,
      affiliation,
    });
  };

  const engage = (trackId: string, effectorId: string, shenobiCm?: string) => {
    // BLUE-ON-BLUE check: engaging UNKNOWN track without ATC response
    const engTrack = tracks.find((t) => t.id === trackId);
    if (engTrack?.iff_status === "unknown" && !engTrack.atc_response_received) {
      const label = engTrack.display_label ?? trackId;
      blueOnBlueRef.current++;
      roeViolationsRef.current.push(`Engaged UNKNOWN track ${label.toUpperCase()} without ATC clearance`);
      setEvents((prev) => [
        ...prev,
        { timestamp: elapsed, message: `BLUE-ON-BLUE: Engagement on unverified track ${label.toUpperCase()} — ATC not consulted! Score penalty applied.` },
      ]);
    }
    if (shenobiCm) {
      // Shenobi Protocol Manipulation — send specific CM action
      send({
        type: "action",
        action: shenobiCm,
        target_id: trackId,
        effector: effectorId,
        shenobi_cm: shenobiCm,
      });
    } else {
      send({
        type: "action",
        action: "engage",
        target_id: trackId,
        effector: effectorId,
      });
    }
  };

  const handleSlewCamera = (trackId: string) => {
    setCameraTrackId(trackId);
    soundEngine.play("camera_slew");
    // Send slew_camera action to backend (needed for tutorial gating)
    send({ type: "action", action: "slew_camera", target_id: trackId });
  };

  const handleHoldFire = (trackId: string) => {
    send({ type: "action", action: "hold_fire", target_id: trackId });
    soundEngine.play("threat_orange"); // Warning tone for hold fire
  };

  const handleReleaseHoldFire = (trackId: string) => {
    send({ type: "action", action: "release_hold_fire", target_id: trackId });
  };

  const handleJammerToggle = (effectorId: string) => {
    send({ type: "action", action: "jammer_toggle", effector_id: effectorId });
  };

  const handleJamAll = () => {
    send({ type: "action", action: "jam_all" });
  };

  const handleCeaseJam = () => {
    send({ type: "action", action: "cease_jam" });
  };

  const handleClearAirspace = () => {
    send({ type: "action", action: "clear_airspace" });
  };

  const callATC = useCallback((trackId: string) => {
    // Tutorial: if player clicks CALL ATC while still on step 1, auto-advance step 1→2 first
    if (isTutorialRef.current && tutorialStepRef.current === 1) {
      sendRef.current({ type: "action", action: "select_track", target_id: trackId });
    }
    // Tutorial step 2→3: ATC call advances tutorial (via game engine)
    if (isTutorialRef.current && (tutorialStepRef.current === 2 || tutorialStepRef.current === 1)) {
      sendRef.current({ type: "action", action: "call_atc", target_id: trackId });
    }
    atcCallsMadeRef.current++;
    setTracks((prev) =>
      prev.map((t) =>
        t.id === trackId ? { ...t, atc_called: true, atc_response_pending: true } : t,
      ),
    );
    const label = tracksRef.current.find((t) => t.id === trackId)?.display_label ?? trackId;
    const outMsg = `Requesting IFF check — Track ${label.toUpperCase()}`;
    setAtcCommsMessages((prev) => ({ ...prev, [trackId]: [...(prev[trackId] ?? []), { direction: "out", text: outMsg }] }));
    setAtcPanelTrackId(trackId);
    window.clearTimeout(atcPanelTimerRef.current);
    setEvents((prev) => [...prev, { timestamp: elapsedRef.current, message: `ATC CALL: IFF check requested — ${label.toUpperCase()}` }]);

    const delay = 6000 + Math.random() * 2000;
    const track = tracksRef.current.find((t) => t.id === trackId);
    const cls = (track?.classification ?? "").toLowerCase();
    // Only manned aircraft can be ATC-authorized; UAS/drone/quad/rotor are never in the system
    const canBeAuthorized = cls.includes("fixed-wing") || cls.includes("manned") || cls.includes("helicopter") || cls.includes("aircraft");
    const isAuthorized = canBeAuthorized && Math.random() < 0.5;
    const responseText = isAuthorized
      ? `Track ${label.toUpperCase()} — confirmed authorized aircraft`
      : `Track ${label.toUpperCase()} — not in our system`;

    setTimeout(() => {
      setTracks((prev) =>
        prev.map((t) =>
          t.id === trackId
            ? { ...t, atc_response_pending: false, atc_response_received: true, atc_response_text: responseText }
            : t,
        ),
      );
      const inMsg = responseText;
      atcCallLogRef.current.push({ trackId: label.toUpperCase(), response: responseText });
      setAtcCommsMessages((prev) => ({ ...prev, [trackId]: [...(prev[trackId] ?? []), { direction: "in", text: inMsg }] }));
      setEvents((prev) => [...prev, { timestamp: elapsedRef.current, message: `ATC RESPONSE: ${responseText}` }]);
      // Auto-dismiss panel 10s after response
      window.clearTimeout(atcPanelTimerRef.current);
      atcPanelTimerRef.current = window.setTimeout(() => setAtcPanelTrackId(null), 10000);
    }, delay);
  }, []);

  const tagFriendly = useCallback((trackId: string) => {
    setTracks((prev) =>
      prev.map((t) =>
        t.id === trackId ? { ...t, affiliation: "friendly" } : t,
      ),
    );
    const label = tracksRef.current.find((t) => t.id === trackId)?.display_label ?? trackId;
    setEvents((prev) => [...prev, { timestamp: elapsedRef.current, message: `TAGGED FRIENDLY: ${label.toUpperCase()} re-classified as FRIENDLY by operator` }]);
  }, []);

  const handlePause = () => {
    send({ type: "action", action: "pause_mission" });
  };

  const handleResume = () => {
    send({ type: "action", action: "resume_mission" });
  };

  const handlePauseToggle = () => {
    if (paused) {
      handleResume();
    } else {
      handlePause();
    }
  };

  const handleAddNote = (note: string) => {
    setNotes((prev) => [...prev, note]);
  };

  const handleDeleteNote = (index: number) => {
    setNotes((prev) => prev.filter((_, i) => i !== index));
  };

  const handleExportNotes = () => {
    const text = notes.join("\n");
    navigator.clipboard.writeText(text).catch(() => {
      // Fallback: open in a prompt
      window.prompt("Copy notes:", text);
    });
  };

  const handleEndMission = () => {
    send({ type: "action", action: "end_mission", target_id: "" });
  };

  // --- Scenario card metadata ---
  const SCENARIO_CARDS = [
    {
      id: "tutorial",
      name: "TUTORIAL",
      description: "Learn the basics of C-UAS detection, tracking, and defeat.",
      difficulty: "BEGINNER",
      duration: "5 min",
      accent: "#58a6ff",
    },
    {
      id: "lone_wolf",
      name: "LONE WOLF",
      description: "Single hostile UAS inbound. Detect, identify, and neutralize before breach.",
      difficulty: "INTERMEDIATE",
      accent: "#3fb950",
      duration: "10 min",
    },
    {
      id: "swarm_attack",
      name: "SWARM ATTACK",
      description: "Multi-vector swarm assault. Triage threats, manage effector economy.",
      difficulty: "ADVANCED",
      accent: "#f85149",
      duration: "15 min",
    },
    {
      id: "recon_probe",
      name: "RECON PROBE",
      description: "Mixed contacts — apply ROE, identify hostiles, avoid fratricide.",
      difficulty: "ADVANCED",
      accent: "#d29922",
      duration: "12 min",
    },
    {
      id: "thermopylae",
      name: "THERMOPYLAE",
      subtitle: "Free Play",
      description: "Unscripted free-play. Three escalating phases then endless chaos. End when done.",
      difficulty: "VARIABLE",
      accent: "#8b949e",
      duration: "20+ min",
    },
    {
      id: "free_play",
      name: "FREE PLAY",
      description: "Open sandbox — steady mixed threats, one of each system, no timer. Practice at your own pace.",
      difficulty: "CASUAL",
      accent: "#79c0ff",
      duration: "∞",
    },
  ];

  // --- Scenario Launch handler (replaces handleTutorialStart + handleQuickStart) ---
  const handleScenarioLaunch = async (scenarioId: string) => {
    if (phase !== "waiting") return;
    soundEngine.init();

    const isTut = scenarioId === "tutorial";
    const baseId = isTut ? "small_fob" : "medium_airbase";

    // Doctrine: every scenario = L-Band + EO/IR + RF Jammer + Shenobi baseline
    // Ku-Band FCS always paired with JACKAL (fire control requirement)
    // Shahed threats (Swarm, Lone Wolf) need kinetic defeat — JACKAL mandatory
    const tutorialPlacement: PlacementConfig = {
      base_id: "small_fob",
      sensors: [
        { catalog_id: "tpq51", x: 0.0, y: 0.0, facing_deg: 0 },
        { catalog_id: "eoir_camera", x: -0.2, y: 0.1, facing_deg: 0 },
      ],
      effectors: [
        { catalog_id: "rf_jammer", x: 0.0, y: 0.05, facing_deg: 0 },
      ],
      combined: [
        { catalog_id: "shenobi", x: 0.0, y: 0.0, facing_deg: 0 },
      ],
    };

    const loneWolfPlacement: PlacementConfig = {
      base_id: "medium_airbase",
      sensors: [
        { catalog_id: "tpq51", x: 0.0, y: -0.1, facing_deg: 0 },
        { catalog_id: "kufcs", x: 0.2, y: 0.1, facing_deg: 0 },
        { catalog_id: "eoir_camera", x: -0.3, y: 0.15, facing_deg: 0 },
      ],
      effectors: [
        { catalog_id: "rf_jammer", x: 0.0, y: 0.05, facing_deg: 0 },
        { catalog_id: "jackal_pallet", x: 0.15, y: 0.0, facing_deg: 0 },
        { catalog_id: "jackal_pallet", x: -0.15, y: 0.0, facing_deg: 180 },
      ],
      combined: [
        { catalog_id: "shenobi", x: 0.0, y: 0.0, facing_deg: 0 },
      ],
    };

    const swarmPlacement: PlacementConfig = {
      base_id: "medium_airbase",
      sensors: [
        { catalog_id: "tpq51", x: 0.0, y: -0.1, facing_deg: 0 },
        { catalog_id: "kufcs", x: 0.2, y: 0.1, facing_deg: 0 },
        { catalog_id: "eoir_camera", x: -0.3, y: 0.15, facing_deg: 0 },
        { catalog_id: "eoir_camera", x: 0.4, y: -0.2, facing_deg: 180 },
      ],
      effectors: [
        { catalog_id: "rf_jammer", x: 0.0, y: 0.05, facing_deg: 0 },
        { catalog_id: "rf_jammer", x: -0.2, y: -0.1, facing_deg: 0 },
        { catalog_id: "jackal_pallet", x: 0.15, y: 0.0, facing_deg: 0 },
        { catalog_id: "jackal_pallet", x: -0.15, y: 0.0, facing_deg: 180 },
      ],
      combined: [
        { catalog_id: "shenobi", x: 0.0, y: 0.0, facing_deg: 0 },
        { catalog_id: "shenobi", x: 0.3, y: 0.1, facing_deg: 0 },
      ],
    };

    const reconPlacement: PlacementConfig = {
      base_id: "medium_airbase",
      sensors: [
        { catalog_id: "tpq51", x: 0.0, y: -0.1, facing_deg: 0 },
        { catalog_id: "kufcs", x: 0.2, y: 0.1, facing_deg: 0 },
        { catalog_id: "eoir_camera", x: -0.3, y: 0.15, facing_deg: 0 },
        { catalog_id: "eoir_camera", x: 0.4, y: -0.2, facing_deg: 180 },
      ],
      effectors: [
        { catalog_id: "rf_jammer", x: 0.0, y: 0.05, facing_deg: 0 },
        { catalog_id: "jackal_pallet", x: 0.1, y: 0.0, facing_deg: 0 },
      ],
      combined: [
        { catalog_id: "shenobi", x: 0.0, y: 0.0, facing_deg: 0 },
      ],
    };

    // Free Play: one of each system — casual sandbox loadout
    const freePlayPlacement: PlacementConfig = {
      base_id: "medium_airbase",
      sensors: [
        { catalog_id: "tpq51", x: 0.0, y: -0.1, facing_deg: 0 },
        { catalog_id: "kufcs", x: 0.2, y: 0.1, facing_deg: 0 },
        { catalog_id: "eoir_camera", x: -0.3, y: 0.15, facing_deg: 0 },
      ],
      effectors: [
        { catalog_id: "rf_jammer", x: 0.0, y: 0.05, facing_deg: 0 },
        { catalog_id: "jackal_pallet", x: 0.15, y: 0.0, facing_deg: 0 },
      ],
      combined: [
        { catalog_id: "shenobi", x: 0.0, y: 0.0, facing_deg: 0 },
      ],
    };

    // Thermopylae gets the full swarm loadout (heavy threat environment)
    const openSkiesPlacement: PlacementConfig = {
      base_id: "medium_airbase",
      sensors: [
        { catalog_id: "tpq51", x: 0.0, y: -0.1, facing_deg: 0 },
        { catalog_id: "kufcs", x: 0.2, y: 0.1, facing_deg: 0 },
        { catalog_id: "eoir_camera", x: -0.3, y: 0.15, facing_deg: 0 },
        { catalog_id: "eoir_camera", x: 0.4, y: -0.2, facing_deg: 180 },
      ],
      effectors: [
        { catalog_id: "rf_jammer", x: 0.0, y: 0.05, facing_deg: 0 },
        { catalog_id: "rf_jammer", x: -0.2, y: -0.1, facing_deg: 0 },
        { catalog_id: "jackal_pallet", x: 0.15, y: 0.0, facing_deg: 0 },
        { catalog_id: "jackal_pallet", x: -0.15, y: 0.0, facing_deg: 180 },
      ],
      combined: [
        { catalog_id: "shenobi", x: 0.0, y: 0.0, facing_deg: 0 },
        { catalog_id: "shenobi", x: 0.3, y: 0.1, facing_deg: 0 },
      ],
    };

    const placementMap: Record<string, PlacementConfig> = {
      tutorial: tutorialPlacement,
      lone_wolf: loneWolfPlacement,
      swarm_attack: swarmPlacement,
      recon_probe: reconPlacement,
      thermopylae: openSkiesPlacement,
      free_play: freePlayPlacement,
    };
    const placement = placementMap[scenarioId] ?? loneWolfPlacement;

    try {
      const [baseRes, scenarioRes] = await Promise.all([
        fetch(`${import.meta.env.BASE_URL}data/bases/${baseId}.json`),
        fetch(`${import.meta.env.BASE_URL}data/scenarios/${scenarioId}.json`),
      ]);
      const base = await baseRes.json();
      const scenarioData = await scenarioRes.json();
      setBaseTemplate(base);
      setScenarioId(scenarioId);
      setBaseId(baseId);

      // Show ROE briefing before launching
      const roe: string[] = scenarioData.roe_briefing ?? [];
      setRoeBriefing(roe);
      setRoeScenarioName(scenarioData.name ?? scenarioId);
      pendingRoeLaunchRef.current = () => {
        // Reset running state
        setScore(null);
        setTracks([]);
        setSelectedTrackId(null);
        setHookedTrackIds(new Set());
        setEvents([]);
        setSensors([]);
        setSensorConfigs([]);
        setEffectors([]);
        setEffectorConfigs([]);
        setEngagementZones(null);
        setProtectedArea(null);
        setElapsed(0);
        setTimeRemaining(0);
        setThreatLevel("green");
        setCameraTrackId(null);
        autoOpenedCameraRef.current.clear();
        detectionPingedRef.current.clear();
        setTutorialMessage(null);
        setIsTutorial(isTut);
        setIsFreePlay(scenarioId === "thermopylae" || scenarioId === "free_play");
        setTutorialStep(0);
        setTutorialFeedback(null);
        setTutorialTourActive(isTut);
        setTutorialTourStep(0);
        setPaused(false);
        setPlacementConfig(placement);
        setWaveNumber(1);
        // Reset debrief stats
        setDebriefStats(null);
        tracksSpawnedRef.current = new Set();
        tracksDetectedRef.current = new Set();
        tracksConfirmedRef.current = new Set();
        tracksIdentifiedRef.current = new Set();
        tracksDefeatedRef.current = new Set();
        blueOnBlueRef.current = 0;
        atcCallsMadeRef.current = 0;
        atcCallLogRef.current = [];
        roeViolationsRef.current = [];

        connect({ scenarioId, baseId, placement });
      };
      setPhase("roe_briefing");
    } catch {
      setPhase("waiting");
    }
  };

  // --- Phase: Waiting (title screen) ---
  if (phase === "waiting") {
    return (
      <>
        <LandingPage
          onScenarioLaunch={(id) => handleScenarioLaunch(id)}
          onCustomMission={() => { soundEngine.init(); setPhase("scenario_select"); }}
          onBDA={() => { soundEngine.init(); setPhase("architect"); }}
          onFeedback={() => setShowFeedback(true)}
          onStudy={() => { setPhase("study"); setActiveStudyModule(null); }}
        />
        {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
      </>
    );
  }

  // --- Phase: Base Defense Architect ---
  if (phase === "architect") {
    return (
      <ErrorBoundary>
        <BaseDefenseArchitect
          onBack={() => setPhase("waiting")}
          onExportToMission={(placement, exportScenarioId, exportBaseId, exportBaseTemplate) => {
            setScenarioId(exportScenarioId);
            setBaseId(exportBaseId);
            setBaseTemplate(exportBaseTemplate);
            handlePlacementConfirm(placement, exportScenarioId, exportBaseId);
            setPhase("running");
          }}
        />
      </ErrorBoundary>
    );
  }

  // --- Phase: Study (Training Library) ---
  if (phase === "study") {
    if (activeStudyModule) {
      return (
        <StudyModule
          moduleId={activeStudyModule}
          onBack={() => setActiveStudyModule(null)}
          onLaunchScenario={(scenario) => {
            setActiveStudyModule(null);
            setPhase("waiting");
            // Find matching scenario card and launch it
            const match = SCENARIO_CARDS.find(
              (sc) => sc.name.toLowerCase() === scenario.toLowerCase()
            );
            if (match) {
              handleScenarioLaunch(match.id);
            }
          }}
        />
      );
    }
    return (
      <StudyLibrary
        onSelectModule={(id) => setActiveStudyModule(id)}
        onBack={() => { setPhase("waiting"); setActiveStudyModule(null); }}
      />
    );
  }

  // --- Phase: Scenario Select ---
  if (phase === "scenario_select") {
    return <ScenarioSelect onSelect={handleScenarioSelect} />;
  }

  // --- Phase: ROE Briefing ---
  if (phase === "roe_briefing") {
    return (
      <ROEBriefing
        scenarioName={roeScenarioName}
        roeBriefing={roeBriefing}
        onConfirm={() => {
          const launch = pendingRoeLaunchRef.current;
          pendingRoeLaunchRef.current = null;
          if (launch) launch();
        }}
        onBack={() => {
          pendingRoeLaunchRef.current = null;
          setPhase("waiting");
        }}
      />
    );
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
        selectedCombined={selectedCombined}
        onConfirm={handlePlacementConfirm}
        onBack={() => setPhase("equip")}
      />
    );
  }

  // --- Phase: Debrief ---
  if (phase === "debrief" && debriefStats) {
    return (
      <DebriefScreen
        stats={debriefStats}
        onMainMenu={() => { setDebriefStats(null); handleMainMenu(); }}
        onReplay={() => { setDebriefStats(null); handleRestart(); }}
      />
    );
  }

  // --- Phase: Running ---
  const selectedTrack =
    tracks.find((t) => t.id === selectedTrackId) || null;
  const cameraTrack =
    cameraTrackId ? tracks.find((t) => t.id === cameraTrackId) || null : null;

  return (
    <ErrorBoundary>
    <div
      style={{
        height: "100vh",
        overflow: "hidden",
        display: "grid",
        gridTemplateRows: "48px 1fr 120px",
        gridTemplateColumns: "220px 1fr 360px",
        background: "#0d1117",
      }}
    >
      {/* Header */}
      <div data-tutorial-id="tutorial-header" style={{ gridRow: "1", gridColumn: "1 / -1" }}>
      <HeaderBar
        elapsed={elapsed}
        timeRemaining={timeRemaining}
        threatLevel={threatLevel}
        scenarioName={scenarioName}
        muted={audioMuted}
        volume={audioVolume}
        onToggleMute={handleToggleMute}
        onVolumeChange={handleVolumeChange}
        alertCount={alertCount}
        waveNumber={waveNumber}
        onEndMission={handleEndMission}
        onJamAll={handleJamAll}
        onCeaseJam={handleCeaseJam}
        onClearAirspace={handleClearAirspace}
        isPaused={paused}
        onPause={handlePause}
        onResume={handleResume}
        effectors={effectors}
        ambientSuppressedUntil={ambientSuppressedUntil}
        onShowRoe={() => setShowRoeOverlay(true)}
        freePlayPhase={isFreePlay ? (elapsed >= 1200 ? "ENDLESS" : elapsed >= 720 ? "OVERWHELM" : elapsed >= 300 ? "BUILDUP" : "RECON") : null}
        isEndless={isFreePlay && elapsed >= 1200}
      />
      </div>

      {/* Left sidebar */}
      <div
        style={{
          gridRow: "2",
          gridColumn: "1",
          background: "#161b22",
          borderRight: "1px solid #30363d",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {isTutorial && !tutorialTourActive && (
          <TutorialStepTracker tutorialStep={tutorialStep} />
        )}
        <div data-tutorial-id="tutorial-sensors"><SensorPanel sensors={sensors} /></div>
        <div data-tutorial-id="tutorial-effectors"><EffectorPanel effectors={effectors} activeJammers={activeJammers} /></div>
        <div data-tutorial-id="tutorial-tracklist" style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
        <TrackList
          tracks={tracks.filter((t) => !t.neutralized && !t.is_interceptor)}
          selectedTrackId={selectedTrackId}
          onSelectTrack={(id) => {
            setSelectedTrackId(id);
            if (id) setHookedTrackIds((prev) => { const next = new Set(prev); next.add(id); return next; });
            if (id && isTutorial && tutorialStep === 1) send({ type: "action", action: "select_track", target_id: id });
          }}
        />
        </div>
      </div>

      {/* Center: Tactical Map */}
      <div
        data-tutorial-id="tutorial-map"
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
          onSelectTrack={(id) => {
            setSelectedTrackId(id);
            if (id) setHookedTrackIds((prev) => { const next = new Set(prev); next.add(id); return next; });
            if (id && isTutorial && tutorialStep === 1) send({ type: "action", action: "select_track", target_id: id });
          }}
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
          onHoldFire={handleHoldFire}
          onReleaseHoldFire={handleReleaseHoldFire}
          onCallATC={callATC}
          onDeclareAffiliation={declareAffiliation}
          cameraTrackId={cameraTrackId}
          sensorConfigs={sensorConfigs}
          protectedArea={protectedArea}
          trackBlinkStates={trackBlinkStates}
          newContactBanner={newContactBanner}
          baseAssets={baseTemplate?.protected_assets}
          baseBoundary={placementConfig?.boundary ?? baseTemplate?.boundary}
          activeJammers={activeJammers}
          activeIntercepts={activeIntercepts}
          onJammerToggle={handleJammerToggle}
          baseBreached={baseBreached}
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

        {/* Tutorial feedback tooltip */}
        {isTutorial && (
          <TutorialFeedback
            message={tutorialFeedback}
            onDismiss={() => setTutorialFeedback(null)}
          />
        )}

        {/* Pause overlay */}
        {paused && phase === "running" && (
          <PauseOverlay
            missionTime={elapsed}
            scenarioName={scenarioName}
            notes={notes}
            onAddNote={handleAddNote}
            onDeleteNote={handleDeleteNote}
            onExportNotes={handleExportNotes}
          />
        )}
      </div>

      {/* Right sidebar — full height: TrackDetail + Engagement (scrollable) + Camera (fixed bottom) */}
      <div
        style={{
          gridRow: "2 / -1",
          gridColumn: "3",
          background: "#161b22",
          borderLeft: "1px solid #30363d",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Scrollable area: TrackDetail + Engagement */}
        <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
          <div data-tutorial-id="tutorial-trackdetail" style={{ maxHeight: "220px", flexShrink: 0, overflow: "hidden" }}>
            <TrackDetailPanel track={selectedTrack} />
          </div>
          <div data-tutorial-id="tutorial-engagement">
          <EngagementPanel
            track={selectedTrack}
            effectors={effectors}
            onConfirmTrack={confirmTrack}
            onIdentify={identify}
            onEngage={engage}
            onSlewCamera={handleSlewCamera}
            onCallATC={callATC}
            onDeclareAffiliation={declareAffiliation}

            tutorialStep={isTutorial && !tutorialTourActive ? tutorialStep : undefined}
          />
          </div>
        </div>
        {/* Fixed bottom: Camera */}
        <div data-tutorial-id="tutorial-camera" style={{ borderTop: "1px solid #30363d", background: "#161b22", flexShrink: 0 }}>
          <CameraPanel
            track={cameraTrack}
            allTracks={tracks}
            sensorConfigs={sensorConfigs}
          />
        </div>
      </div>

      {/* Bottom: Event Log (left side only, stops before sidebar) */}
      <div
        data-tutorial-id="tutorial-eventlog"
        style={{
          gridRow: "3",
          gridColumn: "1 / 3",
          background: "#0d1117",
          borderTop: "1px solid #30363d",
        }}
      >
        <EventLog
          events={events}
          hookedTracks={tracks.filter((t) => hookedTrackIds.has(t.id))}
          onUnhook={(id) => setHookedTrackIds((prev) => { const next = new Set(prev); next.delete(id); return next; })}
          onCallATC={callATC}
          onTagFriendly={tagFriendly}
        />
      </div>

      {/* ATC Comms Popup */}
      {atcPanelTrackId && (atcCommsMessages[atcPanelTrackId]?.length ?? 0) > 0 && (
        <ATCCommsPanel
          messages={atcCommsMessages[atcPanelTrackId]}
          onClose={() => { window.clearTimeout(atcPanelTimerRef.current); setAtcPanelTrackId(null); }}
        />
      )}

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
          P:Pause TAB:Cycle 1:Confirm 2:Slew 4:Unslew M:Mute ESC:End Mission
        </div>
      )}

      {/* Tutorial Phase 1: UI Tour overlay (Next/Back navigation) */}
      {isTutorial && tutorialTourActive && phase === "running" && (
        <TutorialTourOverlay
          currentStep={tutorialTourStep}
          totalSteps={UI_TOUR_STEPS.length}
          onNext={() => setTutorialTourStep((s) => Math.min(s + 1, UI_TOUR_STEPS.length - 1))}
          onBack={() => setTutorialTourStep((s) => Math.max(s - 1, 0))}
          onComplete={() => setTutorialTourActive(false)}
        />
      )}

      {/* Tutorial Phase 2: DTID Practice guide (advances with game engine) */}
      {isTutorial && !tutorialTourActive && phase === "running" && tutorialStep < 7 && (
        <TutorialPracticeOverlay gameStep={tutorialStep} />
      )}

      {/* ROE overlay (viewable during mission) */}
      {showRoeOverlay && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9000,
            background: "rgba(13, 17, 23, 0.92)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "'Inter', sans-serif",
          }}
          onClick={() => setShowRoeOverlay(false)}
        >
          <div
            style={{
              maxWidth: 560,
              width: "100%",
              padding: 32,
              background: "#161b22",
              border: "1px solid #30363d",
              borderRadius: 12,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: "#3fb950", letterSpacing: 2, marginBottom: 8 }}>
              RULES OF ENGAGEMENT
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#e6edf3", marginBottom: 20 }}>
              {roeScenarioName}
            </div>
            {roeBriefing.map((rule, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                  padding: "10px 0",
                  borderBottom: i < roeBriefing.length - 1 ? "1px solid #21262d" : "none",
                }}
              >
                <span
                  style={{
                    flexShrink: 0,
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    background: "rgba(63, 185, 80, 0.12)",
                    border: "1px solid rgba(63, 185, 80, 0.3)",
                    color: "#3fb950",
                    fontSize: 11,
                    fontWeight: 700,
                    fontFamily: "'JetBrains Mono', monospace",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {i + 1}
                </span>
                <span style={{ fontSize: 13, lineHeight: 1.6, color: "#e6edf3", paddingTop: 1 }}>
                  {rule}
                </span>
              </div>
            ))}
            <button
              onClick={() => setShowRoeOverlay(false)}
              style={{
                marginTop: 20,
                padding: "10px 32px",
                fontSize: 12,
                fontWeight: 700,
                fontFamily: "'Inter', sans-serif",
                letterSpacing: 1.5,
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                background: "#3fb950",
                color: "#0d1117",
                width: "100%",
                transition: "all 0.15s",
              }}
            >
              DISMISS
            </button>
          </div>
        </div>
      )}

    </div>
    </ErrorBoundary>
  );
}
