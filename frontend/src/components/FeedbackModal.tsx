import { useState } from "react";

// Replace with your Formspree form ID from formspree.io
const FORMSPREE_ID = "xbdzbkjl";

interface FeedbackModalProps {
  onClose: () => void;
}

export default function FeedbackModal({ onClose }: FeedbackModalProps) {
  const [category, setCategory] = useState("General");
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    setStatus("sending");
    try {
      const res = await fetch(`https://formspree.io/f/${FORMSPREE_ID}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ name: name || "Anonymous", category, message }),
      });
      if (res.ok) {
        setStatus("sent");
        setTimeout(onClose, 2000);
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  };

  const overlay: React.CSSProperties = {
    position: "fixed", inset: 0, zIndex: 9999,
    background: "rgba(0,0,0,0.7)",
    display: "flex", alignItems: "center", justifyContent: "center",
  };

  const modal: React.CSSProperties = {
    background: "#161b22", border: "1px solid #30363d", borderRadius: 10,
    padding: 28, width: "100%", maxWidth: 440,
    fontFamily: "'Inter', sans-serif", color: "#e6edf3",
    boxShadow: "0 24px 48px rgba(0,0,0,0.6)",
  };

  const label: React.CSSProperties = {
    display: "block", fontSize: 11, fontWeight: 700,
    letterSpacing: 1, color: "#8b949e", marginBottom: 6, marginTop: 16,
  };

  const input: React.CSSProperties = {
    width: "100%", background: "#0d1117", border: "1px solid #30363d",
    borderRadius: 6, padding: "8px 10px", color: "#e6edf3",
    fontFamily: "'Inter', sans-serif", fontSize: 13,
    boxSizing: "border-box", outline: "none",
  };

  const btnPrimary: React.CSSProperties = {
    padding: "10px 24px", background: "#238636", border: "1px solid #2ea043",
    borderRadius: 6, color: "#fff", fontFamily: "'Inter', sans-serif",
    fontSize: 13, fontWeight: 700, letterSpacing: 1, cursor: "pointer",
  };

  const btnSecondary: React.CSSProperties = {
    padding: "10px 20px", background: "transparent", border: "1px solid #30363d",
    borderRadius: 6, color: "#8b949e", fontFamily: "'Inter', sans-serif",
    fontSize: 13, fontWeight: 600, cursor: "pointer", marginRight: 10,
  };

  if (status === "sent") {
    return (
      <div style={overlay}>
        <div style={{ ...modal, textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>✓</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#3fb950" }}>Feedback received</div>
          <div style={{ fontSize: 13, color: "#8b949e", marginTop: 6 }}>Thanks — closing in a moment.</div>
        </div>
      </div>
    );
  }

  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={modal}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: 0.5 }}>Send Feedback</div>
            <div style={{ fontSize: 12, color: "#8b949e", marginTop: 2 }}>Bug report, feature request, or general thoughts</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#8b949e", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        <form onSubmit={handleSubmit}>
          <label style={label}>TYPE</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={{ ...input, cursor: "pointer" }}
          >
            <option>General</option>
            <option>Bug Report</option>
            <option>Feature Request</option>
            <option>Scenario Feedback</option>
          </select>

          <label style={label}>FEEDBACK <span style={{ color: "#f85149" }}>*</span></label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="What's on your mind?"
            required
            rows={4}
            style={{ ...input, resize: "vertical", minHeight: 90 }}
          />

          <label style={label}>NAME (optional)</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Anonymous"
            style={input}
          />

          {status === "error" && (
            <div style={{ fontSize: 12, color: "#f85149", marginTop: 10 }}>
              Something went wrong — try again or open a GitHub issue.
            </div>
          )}

          <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
            <button type="button" onClick={onClose} style={btnSecondary}>Cancel</button>
            <button
              type="submit"
              disabled={status === "sending" || !message.trim()}
              style={{ ...btnPrimary, opacity: status === "sending" || !message.trim() ? 0.5 : 1 }}
            >
              {status === "sending" ? "Sending..." : "Submit Feedback"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
