// frontend/src/hooks/useLocationSearch.ts

import { useState, useEffect, useRef, useCallback } from "react";
import { resolvePreset, type AliasEntry } from "../utils/resolvePreset";

export interface LocationSearchResult {
  name: string;
  lat: number;
  lng: number;
  presetId: string | null;
  presetFile: string | null;
}

export interface UseLocationSearchReturn {
  query: string;
  setQuery: (q: string) => void;
  results: LocationSearchResult[];
  loading: boolean;
  clearResults: () => void;
}

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;
const NOMINATIM_LIMIT = 5;

interface BaseCenterPayload {
  name?: string;
  center_lat: number;
  center_lng: number;
}

export function useLocationSearch(aliases: AliasEntry[] = []): UseLocationSearchReturn {
  const [query, setQueryState] = useState("");
  const [results, setResults] = useState<LocationSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<number>(0);
  const abortRef = useRef<AbortController | null>(null);

  const clearResults = useCallback(() => {
    setResults([]);
  }, []);

  const setQuery = useCallback(
    (value: string) => {
      setQueryState(value);

      // Cancel pending debounce
      window.clearTimeout(debounceRef.current);
      // Abort in-flight request
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }

      if (value.trim().length < MIN_QUERY_LENGTH) {
        setResults([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      debounceRef.current = window.setTimeout(async () => {
        const controller = new AbortController();
        abortRef.current = controller;

        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(value)}&limit=${NOMINATIM_LIMIT}`,
            {
              headers: {
                "Accept-Language": "en",
                "User-Agent": "OpenSentry/1.0",
              },
              signal: controller.signal,
            },
          );
          const data: { display_name: string; lat: string; lon: string }[] = await res.json();

          // Abort check — if a newer request was made, discard these results
          if (abortRef.current !== controller) return;

          const mapped: LocationSearchResult[] = data.map((r) => {
            const name = r.display_name.split(",").slice(0, 2).join(",");
            const preset = aliases.length > 0 ? resolvePreset(name, aliases) : null;
            return {
              name,
              lat: parseFloat(r.lat),
              lng: parseFloat(r.lon),
              presetId: preset?.id ?? null,
              presetFile: preset?.baseFile ?? null,
            };
          });

          const directPreset = aliases.length > 0 ? resolvePreset(value, aliases) : null;

          if (
            directPreset &&
            !mapped.some((result) => result.presetFile === directPreset.baseFile)
          ) {
            try {
              const presetRes = await fetch(
                `${import.meta.env.BASE_URL}data/bases/${directPreset.baseFile}.json`,
                { signal: controller.signal },
              );
              if (presetRes.ok) {
                const presetData = (await presetRes.json()) as BaseCenterPayload;
                mapped.unshift({
                  name: presetData.name || directPreset.id,
                  lat: presetData.center_lat,
                  lng: presetData.center_lng,
                  presetId: directPreset.id,
                  presetFile: directPreset.baseFile,
                });
              }
            } catch (presetErr) {
              if ((presetErr as Error).name !== "AbortError") {
                console.warn("[useLocationSearch] Preset fallback load failed:", presetErr);
              }
            }
          }

          setResults(mapped);
          setLoading(false);
        } catch (err) {
          if ((err as Error).name === "AbortError") return; // swallowed — a newer request superseded this
          console.error("[useLocationSearch] Nominatim error:", err);
          if (abortRef.current === controller) {
            setResults([]);
            setLoading(false);
          }
        }
      }, DEBOUNCE_MS);
    },
    [aliases],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      window.clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  return { query, setQuery, results, loading, clearResults };
}
