import { useState, useEffect, useRef, useCallback } from "react";
import type { ScenarioInfo, BaseInfo } from "../types";

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

interface CustomLocation {
  lat: number;
  lng: number;
  name: string;
}

interface Props {
  onSelect: (scenarioId: string, baseId: string, customLocation?: CustomLocation) => void;
}

const API_BASE = window.location.origin;

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: "#3fb950",
  medium: "#d29922",
  hard: "#f85149",
};

const SIZE_COLORS: Record<string, string> = {
  small: "#3fb950",
  medium: "#d29922",
  large: "#f85149",
};

export default function ScenarioSelect({ onSelect }: Props) {
  const [scenarios, setScenarios] = useState<ScenarioInfo[]>([]);
  const [bases, setBases] = useState<BaseInfo[]>([]);
  const [selectedScenario, setSelectedScenario] = useState<string | null>(null);
  const [selectedBase, setSelectedBase] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Location search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<NominatimResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [customLocation, setCustomLocation] = useState<CustomLocation | null>(null);
  const debounceRef = useRef<number>(0);

  const searchLocation = useCallback(async (query: string) => {
    if (query.trim().length < 3) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`,
        { headers: { "User-Agent": "OpenSentry-Training-Sim/1.0" } },
      );
      const data: NominatimResult[] = await res.json();
      setSearchResults(data);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const handleSearchInput = useCallback(
    (value: string) => {
      setSearchQuery(value);
      setCustomLocation(null);
      window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => searchLocation(value), 300);
    },
    [searchLocation],
  );

  const handleSelectLocation = useCallback((result: NominatimResult) => {
    const parts = result.display_name.split(", ");
    const shortName = parts.length > 2
      ? `${parts[0]}, ${parts[parts.length - 1]}`
      : result.display_name;
    setCustomLocation({
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
      name: shortName,
    });
    setSearchResults([]);
    setSearchQuery(result.display_name);
    setSelectedBase("custom_location");
  }, []);

  useEffect(() => {
    Promise.all([
      fetch(`${import.meta.env.BASE_URL}data/scenarios/index.json`).then((r) => {
        if (!r.ok) throw new Error("Failed to fetch scenarios");
        return r.json();
      }),
      fetch(`${import.meta.env.BASE_URL}data/bases/index.json`).then((r) => {
        if (!r.ok) throw new Error("Failed to fetch bases");
        return r.json();
      }),
    ])
      .then(([scenarioData, baseData]) => {
        setScenarios(scenarioData);
        setBases(baseData);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const canContinue = selectedScenario !== null && selectedBase !== null
    && (selectedBase !== "custom_location" || customLocation !== null);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "#0d1117",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        fontFamily: "'Inter', sans-serif",
        color: "#e6edf3",
        overflow: "auto",
      }}
    >
      {/* Title */}
      <div
        style={{
          marginTop: 48,
          marginBottom: 8,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: 4,
            color: "#e6edf3",
          }}
        >
          OpenSentry
        </span>
        <span
          style={{
            fontSize: 11,
            color: "#8b949e",
            letterSpacing: 2,
            fontWeight: 500,
          }}
        >
          C-UAS TRAINING SIMULATOR
        </span>
      </div>

      {/* Subtitle */}
      <div
        style={{
          marginTop: 24,
          marginBottom: 32,
          fontSize: 14,
          color: "#8b949e",
          letterSpacing: 1,
        }}
      >
        SELECT SCENARIO & BASE
      </div>

      {loading && (
        <div style={{ fontSize: 14, color: "#8b949e", marginTop: 48 }}>
          Loading...
        </div>
      )}

      {error && (
        <div style={{ fontSize: 14, color: "#f85149", marginTop: 48 }}>
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Two-column layout */}
          <div
            style={{
              display: "flex",
              gap: 32,
              width: "100%",
              maxWidth: 960,
              padding: "0 24px",
              boxSizing: "border-box",
              flex: 1,
              minHeight: 0,
            }}
          >
            {/* Scenarios column */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#8b949e",
                  letterSpacing: 1.5,
                  marginBottom: 4,
                }}
              >
                SCENARIOS
              </div>
              {scenarios.map((s) => {
                const isSelected = selectedScenario === s.id;
                const diffColor =
                  DIFFICULTY_COLORS[s.difficulty.toLowerCase()] || "#8b949e";
                return (
                  <div
                    key={s.id}
                    onClick={() => setSelectedScenario(s.id)}
                    style={{
                      background: "#161b22",
                      border: isSelected
                        ? "1px solid #58a6ff"
                        : "1px solid #30363d",
                      borderRadius: 8,
                      padding: 16,
                      cursor: "pointer",
                      transition: "border-color 0.15s",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: 8,
                      }}
                    >
                      <span style={{ fontSize: 15, fontWeight: 600 }}>
                        {s.name}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          fontFamily: "'JetBrains Mono', monospace",
                          letterSpacing: 1,
                          padding: "2px 8px",
                          borderRadius: 10,
                          background: `${diffColor}18`,
                          border: `1px solid ${diffColor}55`,
                          color: diffColor,
                          textTransform: "uppercase",
                        }}
                      >
                        {s.difficulty}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: "#8b949e",
                        lineHeight: 1.5,
                      }}
                    >
                      {s.description}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Bases column */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#8b949e",
                  letterSpacing: 1.5,
                  marginBottom: 4,
                }}
              >
                BASE TEMPLATES
              </div>
              {bases.map((b) => {
                const isSelected = selectedBase === b.id;
                const sizeColor =
                  SIZE_COLORS[b.size.toLowerCase()] || "#8b949e";
                return (
                  <div
                    key={b.id}
                    onClick={() => { setSelectedBase(b.id); setCustomLocation(null); setSearchQuery(""); setSearchResults([]); }}
                    style={{
                      background: "#161b22",
                      border: isSelected
                        ? "1px solid #58a6ff"
                        : "1px solid #30363d",
                      borderRadius: 8,
                      padding: 16,
                      cursor: "pointer",
                      transition: "border-color 0.15s",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: 8,
                      }}
                    >
                      <span style={{ fontSize: 15, fontWeight: 600 }}>
                        {b.name}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          fontFamily: "'JetBrains Mono', monospace",
                          letterSpacing: 1,
                          padding: "2px 8px",
                          borderRadius: 10,
                          background: `${sizeColor}18`,
                          border: `1px solid ${sizeColor}55`,
                          color: sizeColor,
                          textTransform: "uppercase",
                        }}
                      >
                        {b.size}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: "#8b949e",
                        lineHeight: 1.5,
                        marginBottom: 10,
                      }}
                    >
                      {b.description}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: 12,
                        fontSize: 11,
                        color: "#8b949e",
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >
                      <span>
                        Sensors: <span style={{ color: "#e6edf3" }}>{b.max_sensors}</span>
                      </span>
                      <span>
                        Effectors: <span style={{ color: "#e6edf3" }}>{b.max_effectors}</span>
                      </span>
                    </div>
                  </div>
                );
              })}

              {/* Custom Location option */}
              <div
                onClick={() => setSelectedBase("custom_location")}
                style={{
                  background: "#161b22",
                  border: selectedBase === "custom_location"
                    ? "1px solid #58a6ff"
                    : "1px solid #30363d",
                  borderRadius: 8,
                  padding: 16,
                  cursor: "pointer",
                  transition: "border-color 0.15s",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 8,
                  }}
                >
                  <span style={{ fontSize: 15, fontWeight: 600 }}>
                    Custom Location
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      fontFamily: "'JetBrains Mono', monospace",
                      letterSpacing: 1,
                      padding: "2px 8px",
                      borderRadius: 10,
                      background: "#58a6ff18",
                      border: "1px solid #58a6ff55",
                      color: "#58a6ff",
                      textTransform: "uppercase",
                    }}
                  >
                    ANY
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: "#8b949e",
                    lineHeight: 1.5,
                    marginBottom: 10,
                  }}
                >
                  Search for any real-world location. Uses Small FOB layout centered on your chosen coordinates.
                </div>

                {/* Location search bar */}
                {selectedBase === "custom_location" && (
                  <div style={{ position: "relative" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 14, color: "#8b949e", flexShrink: 0 }}>&#128269;</span>
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => handleSearchInput(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        placeholder="Search location (e.g., Shaw AFB)"
                        style={{
                          flex: 1,
                          padding: "8px 12px",
                          background: "#0d1117",
                          border: "1px solid #30363d",
                          borderRadius: 6,
                          color: "#e6edf3",
                          fontSize: 13,
                          fontFamily: "'Inter', sans-serif",
                          outline: "none",
                        }}
                        onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "#58a6ff"; }}
                        onBlur={(e) => { (e.target as HTMLInputElement).style.borderColor = "#30363d"; }}
                      />
                    </div>

                    {/* Search status */}
                    {searching && (
                      <div style={{ fontSize: 11, color: "#8b949e", marginTop: 6, fontStyle: "italic" }}>
                        Searching...
                      </div>
                    )}

                    {/* Search results dropdown */}
                    {searchResults.length > 0 && (
                      <div
                        style={{
                          marginTop: 4,
                          background: "#0d1117",
                          border: "1px solid #30363d",
                          borderRadius: 6,
                          overflow: "hidden",
                          maxHeight: 200,
                          overflowY: "auto",
                        }}
                      >
                        {searchResults.map((result) => (
                          <div
                            key={result.place_id}
                            onClick={(e) => { e.stopPropagation(); handleSelectLocation(result); }}
                            style={{
                              padding: "8px 12px",
                              fontSize: 12,
                              color: "#e6edf3",
                              cursor: "pointer",
                              borderBottom: "1px solid #21262d",
                              lineHeight: 1.4,
                              transition: "background 0.1s",
                            }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "#161b22"; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                          >
                            {result.display_name}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Selected location confirmation */}
                    {customLocation && (
                      <div
                        style={{
                          marginTop: 8,
                          padding: "8px 12px",
                          background: "#58a6ff12",
                          border: "1px solid #58a6ff33",
                          borderRadius: 6,
                          fontSize: 12,
                          color: "#58a6ff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}
                      >
                        <span>{customLocation.name}</span>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#8b949e" }}>
                          {customLocation.lat.toFixed(4)}, {customLocation.lng.toFixed(4)}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    fontSize: 11,
                    color: "#8b949e",
                    fontFamily: "'JetBrains Mono', monospace",
                    marginTop: selectedBase === "custom_location" ? 8 : 0,
                  }}
                >
                  <span>
                    Sensors: <span style={{ color: "#e6edf3" }}>3</span>
                  </span>
                  <span>
                    Effectors: <span style={{ color: "#e6edf3" }}>2</span>
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Continue button */}
          <div style={{ padding: "32px 0 48px" }}>
            <button
              disabled={!canContinue}
              onClick={() => {
                if (selectedScenario && selectedBase) {
                  onSelect(
                    selectedScenario,
                    selectedBase === "custom_location" ? "small_fob" : selectedBase,
                    selectedBase === "custom_location" && customLocation ? customLocation : undefined,
                  );
                }
              }}
              style={{
                padding: "12px 48px",
                fontSize: 14,
                fontWeight: 600,
                fontFamily: "'Inter', sans-serif",
                letterSpacing: 1.5,
                border: "none",
                borderRadius: 8,
                cursor: canContinue ? "pointer" : "default",
                background: canContinue ? "#58a6ff" : "#30363d",
                color: canContinue ? "#0d1117" : "#484f58",
                transition: "background 0.15s, color 0.15s",
              }}
            >
              CONTINUE
            </button>
          </div>
        </>
      )}
    </div>
  );
}
