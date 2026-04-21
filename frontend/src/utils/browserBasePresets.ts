import type { BaseTemplate } from "../types";
import { customPresetIdForName, slugifyBaseName } from "./baseSlug";

const STORAGE_PREFIX = "opensentry.baseTemplate.";

function storageKey(baseId: string): string {
  return `${STORAGE_PREFIX}${baseId}`;
}

function canUseLocalStorage(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
}

export function shouldAttemptBackendPresetSave(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

export function loadBrowserBasePreset(baseId: string): BaseTemplate | null {
  if (!canUseLocalStorage()) return null;
  try {
    const raw = window.localStorage.getItem(storageKey(baseId));
    if (!raw) return null;
    return JSON.parse(raw) as BaseTemplate;
  } catch {
    return null;
  }
}

export function saveBrowserBasePreset(baseId: string, template: BaseTemplate): boolean {
  if (!canUseLocalStorage()) return false;
  try {
    window.localStorage.setItem(storageKey(baseId), JSON.stringify(template));
    return true;
  } catch {
    return false;
  }
}

export async function loadBaseTemplateWithBrowserOverride(baseId: string): Promise<BaseTemplate | null> {
  const browserTemplate = loadBrowserBasePreset(baseId);
  if (browserTemplate) return browserTemplate;

  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/bases/${baseId}.json`);
    if (!res.ok) return null;
    return await res.json() as BaseTemplate;
  } catch {
    return null;
  }
}

export async function loadSavedSearchBaseTemplate(name: string): Promise<BaseTemplate | null> {
  const customPresetId = customPresetIdForName(name);
  const browserCustomPreset = loadBrowserBasePreset(customPresetId);
  if (browserCustomPreset) return browserCustomPreset;

  try {
    const customPresetRes = await fetch(`${import.meta.env.BASE_URL}data/bases/${customPresetId}.json`);
    if (customPresetRes.ok) {
      return await customPresetRes.json() as BaseTemplate;
    }
  } catch {
    // Fall through to legacy slug lookup.
  }

  const legacySlug = slugifyBaseName(name);
  const browserLegacyPreset = loadBrowserBasePreset(legacySlug);
  if (browserLegacyPreset?.location_name) return browserLegacyPreset;

  try {
    const legacyPresetRes = await fetch(`${import.meta.env.BASE_URL}data/bases/${legacySlug}.json`);
    if (!legacyPresetRes.ok) return null;
    const legacyPreset = await legacyPresetRes.json() as BaseTemplate;
    return legacyPreset.location_name ? legacyPreset : null;
  } catch {
    return null;
  }
}
