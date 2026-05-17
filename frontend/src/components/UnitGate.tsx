import { useState, type FormEvent } from "react";
import { sendTrackingData } from "../utils/tracking";

interface Props {
  scenarioName: string;
  onSubmit: () => void;
  onSkip: () => void;
}

const inputAttrs = {
  style: {
    width: "100%",
    boxSizing: "border-box" as const,
    background: "#0d1117",
    border: "1px solid #30363d",
    borderRadius: 6,
    color: "#e6edf3",
    fontFamily: "'Inter', sans-serif",
    fontSize: 14,
    outline: "none",
    padding: "10px 12px",
  },
};

const labelStyle: React.CSSProperties = {
  color: "#8b949e",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 1,
  marginBottom: 6,
  textTransform: "uppercase" as const,
};

export default function UnitGate({ scenarioName, onSubmit, onSkip }: Props) {
  const [unit, setUnit] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const trimmed = unit.trim();
    if (!trimmed) {
      setError("Unit is required.");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      await sendTrackingData({
        unit: trimmed,
        name: name.trim() || undefined,
        email: email.trim() || undefined,
        scenario: scenarioName,
      });
    } catch {
      // Silently fail — don't block launch
    }

    setSubmitting(false);
    onSubmit();
  }

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        overflowY: "auto",
        background: "#0d1117",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Inter', sans-serif",
        color: "#e6edf3",
        boxSizing: "border-box",
      }}
    >
      <div style={{ maxWidth: 420, width: "100%", padding: "0 24px" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#58a6ff",
              letterSpacing: 2,
              marginBottom: 8,
            }}
          >
            OPEN SENTRY
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
            One Quick Thing
          </h2>
          <p style={{ color: "#8b949e", fontSize: 13, marginTop: 8, lineHeight: 1.5 }}>
            This helps me track who's using the simulator.
            Nothing to me is shared anywhere else — just internal metrics.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 18 }}>
            <label style={labelStyle} htmlFor="unit-gate-unit">
              Unit <span style={{ color: "#f85149" }}>*</span>
            </label>
            <input
              id="unit-gate-unit"
              {...inputAttrs}
              value={unit}
              onChange={(e) => { setUnit(e.target.value); setError(""); }}
              placeholder="e.g. 1st Cavalry Division, 12 CAB, 1-4 IN, etc."
              autoFocus
            />
          </div>

          <div style={{ marginBottom: 18 }}>
            <label style={labelStyle} htmlFor="unit-gate-name">
              Name <span style={{ color: "#484f58" }}>(optional)</span>
            </label>
            <input
              id="unit-gate-name"
              {...inputAttrs}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. SGT Smith"
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={labelStyle} htmlFor="unit-gate-email">
              Email <span style={{ color: "#484f58" }}>(optional)</span>
            </label>
            <input
              id="unit-gate-email"
              type="email"
              {...inputAttrs}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. smith@example.com"
            />
          </div>

          {error && (
            <div
              style={{
                color: "#f85149",
                fontSize: 12,
                marginBottom: 16,
                textAlign: "center",
              }}
            >
              {error}
            </div>
          )}

          <div style={{ display: "flex", gap: 12 }}>
            <button
              type="button"
              onClick={onSkip}
              style={{
                flex: 1,
                padding: "12px 0",
                fontSize: 13,
                fontWeight: 600,
                fontFamily: "'Inter', sans-serif",
                letterSpacing: 1,
                border: "1px solid #30363d",
                borderRadius: 8,
                cursor: "pointer",
                background: "transparent",
                color: "#8b949e",
              }}
            >
              SKIP
            </button>
            <button
              type="submit"
              disabled={submitting}
              style={{
                flex: 2,
                padding: "12px 0",
                fontSize: 13,
                fontWeight: 700,
                fontFamily: "'Inter', sans-serif",
                letterSpacing: 1,
                border: "none",
                borderRadius: 8,
                cursor: submitting ? "not-allowed" : "pointer",
                background: "#3fb950",
                color: "#0d1117",
                opacity: submitting ? 0.7 : 1,
              }}
            >
              {submitting ? "SUBMITTING..." : "CONTINUE"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
