const TRACKING_URL = "https://script.google.com/macros/s/AKfycbxbJqx_2ip44wKNFcwOO9J4QW21WvqI-GNwf43amu_espLTrtwLElynzYdhR2fh1jNIlQ/exec";

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

export { TRACKING_URL };
