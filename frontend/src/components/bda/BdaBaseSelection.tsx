// frontend/src/components/bda/BdaBaseSelection.tsx
import React, { useState, useEffect, useCallback } from "react";
import type { BaseInfo, BaseTemplate } from "../../types";
import { COLORS } from "./constants";
import { useLocationSearch, type LocationSearchResult } from "../../hooks/useLocationSearch";
import { type AliasEntry } from "../../utils/resolvePreset";
import { slugifyBaseName } from "../../utils/baseSlug";
import { buildGenericCustomBase } from "../../utils/customLocationBase";
import {
  loadBaseTemplateWithBrowserOverride,
  loadSavedSearchBaseTemplate,
} from "../../utils/browserBasePresets";
import {
  normalizeLoadedBaseTemplate,
  stripCustomBaseScaffold,
} from "../../utils/recenterCustomBase";

// ─── Helpers ────────────────────────────────────────────────────────────────

function getSizeColor(size: string): string {
  if (size === "small") return COLORS.success;
  if (size === "medium") return COLORS.warning;
  return COLORS.danger;
}

// ─── Component ──────────────────────────────────────────────────────────────

interface Props {
  selectedBaseId: string | null;
  onSelectBase: (baseId: string, template: BaseTemplate) => void;
  onBack: () => void;
  onNext: () => void;
}

export default function BdaBaseSelection({ selectedBaseId, onSelectBase, onBack, onNext }: Props) {
  const [bases, setBases] = useState<BaseInfo[]>([]);
  const [basesLoading, setBasesLoading] = useState(true);
  const [basesError, setBasesError] = useState<string | null>(null);

  const [presetAliases, setPresetAliases] = useState<AliasEntry[]>([]);

  const [baseFilter, setBaseFilter] = useState("");

  const sortedBases = [...bases].sort((a, b) => a.name.localeCompare(b.name));
  const filteredBases = baseFilter.trim()
    ? sortedBases.filter((b) => b.name.toLowerCase().includes(baseFilter.toLowerCase()) || b.id.toLowerCase().includes(baseFilter.toLowerCase()))
    : sortedBases;

  const { query: searchQuery, setQuery: setSearchQuery, results: annotatedResults, loading: searchLoading, clearResults } = useLocationSearch(presetAliases);

  // ─── Load base index + preset aliases ───────────────────────────────────────

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/bases/index.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: BaseInfo[]) => {
        setBases(data);
        setBasesLoading(false);
      })
      .catch((err) => {
        setBasesError(err.message);
        setBasesLoading(false);
      });

    fetch(`${import.meta.env.BASE_URL}data/bases/preset-aliases.json`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: AliasEntry[]) => setPresetAliases(data))
      .catch(() => {
        // Preset aliases are optional; fail silently
      });
  }, []);

  // ─── Select a base template card ─────────────────────────────────────────

  const handleSelectCard = useCallback(
    (baseId: string) => {
      loadBaseTemplateWithBrowserOverride(baseId)
        .then((template) => {
          if (!template) throw new Error(`Base not found: ${baseId}`);
          onSelectBase(baseId, normalizeLoadedBaseTemplate(template));
        })
        .catch((err) => {
          console.error("[BdaBaseSelection] Failed to load template:", err);
        });
    },
    [onSelectBase],
  );



  // ─── Select geo result → load preset or fallback template ──────────────────

  const handleSelectGeoResult = useCallback(
    async (result: LocationSearchResult) => {
      try {
        const slug = slugifyBaseName(result.name);
        const savedTemplate = await loadSavedSearchBaseTemplate(result.name);

        if (savedTemplate) {
          const template = normalizeLoadedBaseTemplate(savedTemplate);
          onSelectBase(template.id || slug, template);
        } else if (result.presetFile) {
          const curatedTemplate = await loadBaseTemplateWithBrowserOverride(result.presetFile);
          if (!curatedTemplate) {
            throw new Error(`Curated preset not found: ${result.presetFile}`);
          }
          onSelectBase(result.presetFile, normalizeLoadedBaseTemplate(curatedTemplate));
        } else {
          const customTemplate: BaseTemplate = stripCustomBaseScaffold(
            buildGenericCustomBase(
              { lat: result.lat, lng: result.lng, name: result.name },
              "custom",
            ),
          );
          onSelectBase("custom", customTemplate);
        }

        setSearchQuery(result.name);
        clearResults();
      } catch (err) {
        console.error("[BdaBaseSelection] Failed to load template for location:", err);
      }
    },
    [clearResults, onSelectBase, setSearchQuery],
  );

  // ─── Styles ───────────────────────────────────────────────────────────────

  const containerStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    background: COLORS.bg,
    fontFamily: "'Inter', sans-serif",
    color: COLORS.text,
    overflow: "hidden",
  };

  const bodyStyle: React.CSSProperties = {
    flex: 1,
    overflowY: "auto",
    padding: "24px 24px 0",
  };

  const sectionTitleStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 1.5,
    color: COLORS.muted,
    textTransform: "uppercase",
    marginBottom: 12,
  };

  const gridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: 12,
    marginBottom: 28,
  };

  const bottomBarStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "14px 24px",
    background: COLORS.card,
    borderTop: `1px solid ${COLORS.border}`,
    flexShrink: 0,
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={containerStyle}>
      {/* Body */}
      <div style={bodyStyle}>
        {/* Quick search filter */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, maxWidth: 480 }}>
          <span style={{ fontSize: 16, color: COLORS.muted, flexShrink: 0 }}>&#128269;</span>
          <input
            type="text"
            value={baseFilter}
            onChange={(e) => setBaseFilter(e.target.value)}
            placeholder="Filter bases..."
            style={{
              flex: 1,
              padding: "8px 12px",
              background: COLORS.card,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 6,
              color: COLORS.text,
              fontSize: 13,
              fontFamily: "'Inter', sans-serif",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          {baseFilter && (
            <button
              onClick={() => setBaseFilter("")}
              style={{ background: "none", border: "none", color: COLORS.muted, cursor: "pointer", fontSize: 16, padding: 0 }}
            >
              &#10005;
            </button>
          )}
        </div>

        {/* Custom Location Search — always at top */}
        <div style={sectionTitleStyle}>Custom Location</div>
        <div style={{ marginBottom: 24, position: "relative", maxWidth: 480 }}>
          <input
            type="text"
            placeholder="Search any location (e.g., Shaw AFB, Lugoff SC)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: "100%",
              padding: "9px 12px",
              fontSize: 13,
              background: COLORS.card,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 6,
              color: COLORS.text,
              fontFamily: "'Inter', sans-serif",
              outline: "none",
              boxSizing: "border-box",
            }}
          />

          {searchLoading && (
            <div
              style={{
                marginTop: 4,
                fontSize: 11,
                color: COLORS.muted,
              }}
            >
              Searching...
            </div>
          )}

          {annotatedResults.length > 0 && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                background: COLORS.card,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 6,
                marginTop: 4,
                zIndex: 10,
                overflow: "hidden",
              }}
            >
              {annotatedResults.map((result, i) => (
                <button
                  key={i}
                  onClick={() => handleSelectGeoResult(result)}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "9px 12px",
                    textAlign: "left",
                    background: "none",
                    border: "none",
                    borderTop: i > 0 ? `1px solid ${COLORS.border}` : "none",
                    color: COLORS.text,
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>{result.name}</span>
                    {result.presetId && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          color: COLORS.accent,
                          background: `${COLORS.accent}18`,
                          border: `1px solid ${COLORS.accent}40`,
                          borderRadius: 3,
                          padding: "1px 5px",
                          whiteSpace: "nowrap",
                          letterSpacing: 0.3,
                        }}
                      >
                        ⭐ Preset boundary available
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Base template cards */}
        <div style={sectionTitleStyle}>Select Base Template</div>

        {basesLoading && (
          <div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 16 }}>
            Loading base templates...
          </div>
        )}

        {basesError && (
          <div style={{ color: COLORS.danger, fontSize: 13, marginBottom: 16 }}>
            Failed to load bases: {basesError}
          </div>
        )}

        {!basesLoading && !basesError && (
          <>
            {baseFilter.trim() && filteredBases.length === 0 && (
              <div style={{ fontSize: 13, color: COLORS.muted, marginBottom: 16 }}>
                No bases match "{baseFilter}"
              </div>
            )}
            <div style={gridStyle}>
              {filteredBases.map((base) => {
              const isSelected = selectedBaseId === base.id;
              const sizeColor = getSizeColor(base.size);
              return (
                <button
                  key={base.id}
                  onClick={() => handleSelectCard(base.id)}
                  style={{
                    background: COLORS.card,
                    border: `1px solid ${isSelected ? COLORS.accent : COLORS.border}`,
                    borderRadius: 8,
                    padding: "14px 16px",
                    textAlign: "left",
                    cursor: "pointer",
                    color: COLORS.text,
                    fontFamily: "'Inter', sans-serif",
                    transition: "border-color 0.15s",
                    outline: isSelected ? `1px solid ${COLORS.accent}` : "none",
                  }}
                >
                  {/* Header row */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 6,
                    }}
                  >
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{base.name}</span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: 1,
                        textTransform: "uppercase",
                        color: sizeColor,
                        border: `1px solid ${sizeColor}`,
                        borderRadius: 3,
                        padding: "2px 6px",
                      }}
                    >
                      {base.size}
                    </span>
                  </div>

                  {/* Description */}
                  <div
                    style={{
                      fontSize: 12,
                      color: COLORS.muted,
                      lineHeight: 1.5,
                      marginBottom: 10,
                    }}
                  >
                    {base.description}
                  </div>

                  {/* Base info - no sensor/effector limits displayed */}
                </button>
              );
            })}
            </div>
          </>
        )}

        {/* Geo search section — REMOVED: moved to top as Custom Location */}
      </div>

      {/* Bottom navigation bar */}
      <div style={bottomBarStyle}>
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: `1px solid ${COLORS.border}`,
            borderRadius: 6,
            padding: "9px 18px",
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: 0.5,
            color: COLORS.muted,
            fontFamily: "'Inter', sans-serif",
            cursor: "pointer",
          }}
        >
          ← BACK TO MENU
        </button>

        <button
          onClick={onNext}
          disabled={selectedBaseId === null}
          style={{
            background: selectedBaseId !== null ? COLORS.accent : COLORS.border,
            border: "none",
            borderRadius: 8,
            padding: "12px 40px",
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: 1,
            color: selectedBaseId !== null ? COLORS.bg : COLORS.muted,
            fontFamily: "'Inter', sans-serif",
            cursor: selectedBaseId !== null ? "pointer" : "not-allowed",
            boxShadow: selectedBaseId !== null ? `0 4px 24px ${COLORS.accent}44` : "none",
            transition: "background 0.15s",
          }}
        >
          SELECT EQUIPMENT →
        </button>
      </div>
    </div>
  );
}
