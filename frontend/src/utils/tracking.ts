const TRACKING_URL = "https://script.google.com/macros/s/AKfycbxbJqx_2ip44wKNFcwOO9J4QW21WvqI-GNwf43amu_espLTrtwLElynzYdhR2fh1jNIlQ/exec";

const TRACKING_PROFILE_KEY = "opensentry-tracking-profile";

export interface TrackingProfile {
  unit: string;
  name: string;
  email: string;
}

export function isLocalDevHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function blankProfile(): TrackingProfile {
  return { unit: "", name: "", email: "" };
}

export function loadSavedTrackingProfile(storage: Storage = window.localStorage): TrackingProfile {
  try {
    const raw = storage.getItem(TRACKING_PROFILE_KEY);
    if (!raw) return blankProfile();

    const parsed = JSON.parse(raw) as Partial<TrackingProfile>;
    return {
      unit: typeof parsed.unit === "string" ? parsed.unit : "",
      name: typeof parsed.name === "string" ? parsed.name : "",
      email: typeof parsed.email === "string" ? parsed.email : "",
    };
  } catch {
    return blankProfile();
  }
}

export function saveTrackingProfile(
  profile: TrackingProfile,
  storage: Storage = window.localStorage,
): void {
  try {
    storage.setItem(TRACKING_PROFILE_KEY, JSON.stringify({
      unit: profile.unit.trim(),
      name: profile.name.trim(),
      email: profile.email.trim(),
    }));
  } catch {
    // localStorage can be unavailable in privacy-restricted browsers. Non-critical.
  }
}

export async function sendTrackingData(payload: {
  unit: string;
  name?: string;
  email?: string;
  scenario?: string;
}): Promise<boolean> {
  if (!TRACKING_URL) return false;

  try {
    await fetch(TRACKING_URL, {
      method: "POST",
      // Keep this as a simple request so Apps Script does not need CORS preflight handling.
      body: JSON.stringify(payload),
    });
    return true;
  } catch {
    return false;
  }
}

export { TRACKING_PROFILE_KEY, TRACKING_URL };
