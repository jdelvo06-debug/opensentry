const STORAGE_PREFIX = "opensentry.customScenario.";

export interface CustomScenario {
  id: string;
  name: string;
  instructorNotes: string;
  scenarioData: Record<string, unknown>;
  baseId: string;
  createdAt: string;
}

function storageKey(scenarioId: string): string {
  return `${STORAGE_PREFIX}${scenarioId}`;
}

function canUseLocalStorage(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
}

export function saveCustomScenario(scenario: CustomScenario): boolean {
  if (!canUseLocalStorage()) return false;
  try {
    window.localStorage.setItem(storageKey(scenario.id), JSON.stringify(scenario));
    return true;
  } catch {
    return false;
  }
}

export function loadCustomScenario(id: string): CustomScenario | null {
  if (!canUseLocalStorage()) return null;
  try {
    const raw = window.localStorage.getItem(storageKey(id));
    if (!raw) return null;
    return JSON.parse(raw) as CustomScenario;
  } catch {
    return null;
  }
}

export function deleteCustomScenario(id: string): boolean {
  if (!canUseLocalStorage()) return false;
  try {
    window.localStorage.removeItem(storageKey(id));
    return true;
  } catch {
    return false;
  }
}

export function listCustomScenarios(): CustomScenario[] {
  if (!canUseLocalStorage()) return [];
  try {
    const scenarios: CustomScenario[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key?.startsWith(STORAGE_PREFIX)) continue;

      const raw = window.localStorage.getItem(key);
      if (!raw) continue;

      try {
        scenarios.push(JSON.parse(raw) as CustomScenario);
      } catch {
        // Skip malformed custom scenario entries.
      }
    }
    return scenarios.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export function generateScenarioId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${slug}-${Date.now()}`;
}
