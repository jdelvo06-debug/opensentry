import { useRef, useState } from "react";

interface Props {
  missionTime: number;
  scenarioName: string;
  notes: string[];
  onAddNote: (note: string) => void;
  onDeleteNote: (index: number) => void;
  onExportNotes: () => void;
}

export default function PauseOverlay({
  missionTime,
  scenarioName,
  notes,
  onAddNote,
  onDeleteNote,
  onExportNotes,
}: Props) {
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSave = () => {
    const text = draft.trim();
    if (!text) return;
    const mins = Math.floor(missionTime / 60);
    const secs = Math.floor(missionTime % 60);
    const tag = `[T+${mins}:${secs.toString().padStart(2, "0")}] [${scenarioName}]`;
    onAddNote(`${tag} ${text}`);
    setDraft("");
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 90,
        background: "rgba(0, 0, 0, 0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "#161b22",
          border: "1px solid #d29922",
          borderRadius: 8,
          padding: 24,
          width: 480,
          maxHeight: "70vh",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {/* Header */}
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 24,
              fontWeight: 700,
              color: "#d29922",
              letterSpacing: 4,
            }}
          >
            MISSION PAUSED
          </div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
              color: "#8b949e",
              marginTop: 8,
            }}
          >
            {scenarioName} — T+
            {Math.floor(missionTime / 60)}:
            {Math.floor(missionTime % 60)
              .toString()
              .padStart(2, "0")}
          </div>
        </div>

        {/* Note input */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add note..."
            rows={4}
            style={{
              background: "#0d1117",
              border: "1px solid #30363d",
              borderRadius: 4,
              color: "#e6edf3",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
              padding: 10,
              resize: "vertical",
              outline: "none",
            }}
          />
          <button
            onClick={handleSave}
            disabled={!draft.trim()}
            style={{
              alignSelf: "flex-end",
              padding: "4px 14px",
              background: draft.trim()
                ? "rgba(210, 153, 34, 0.15)"
                : "rgba(210, 153, 34, 0.05)",
              border: `1px solid rgba(210, 153, 34, ${draft.trim() ? "0.4" : "0.15"})`,
              borderRadius: 4,
              color: draft.trim() ? "#d29922" : "#8b7a3a",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 1,
              cursor: draft.trim() ? "pointer" : "default",
            }}
          >
            SAVE NOTE
          </button>
        </div>

        {/* Notes list */}
        {notes.length > 0 && (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 4,
              maxHeight: 200,
            }}
          >
            {notes.map((note, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  padding: "6px 8px",
                  background: "#0d1117",
                  borderRadius: 4,
                  border: "1px solid #21262d",
                }}
              >
                <span
                  style={{
                    flex: 1,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 11,
                    color: "#c9d1d9",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {note}
                </span>
                <button
                  onClick={() => onDeleteNote(i)}
                  title="Delete note"
                  style={{
                    background: "none",
                    border: "none",
                    color: "#484f58",
                    cursor: "pointer",
                    fontFamily: "monospace",
                    fontSize: 13,
                    padding: "0 4px",
                    lineHeight: 1,
                    flexShrink: 0,
                  }}
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Export button */}
        {notes.length > 0 && (
          <button
            onClick={onExportNotes}
            style={{
              alignSelf: "center",
              padding: "4px 14px",
              background: "rgba(88, 166, 255, 0.1)",
              border: "1px solid rgba(88, 166, 255, 0.3)",
              borderRadius: 4,
              color: "#58a6ff",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 1,
              cursor: "pointer",
            }}
          >
            EXPORT NOTES
          </button>
        )}
      </div>
    </div>
  );
}
