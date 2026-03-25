import { useEffect, useRef, useState } from "react";

interface ATCMessage {
  direction: "out" | "in";
  text: string;
}

interface Props {
  messages: ATCMessage[];
  onClose: () => void;
}

function TypewriterText({ text, duration = 1500 }: { text: string; duration?: number }) {
  const [displayed, setDisplayed] = useState("");
  const indexRef = useRef(0);

  useEffect(() => {
    indexRef.current = 0;
    setDisplayed("");
    const interval = duration / text.length;
    const timer = setInterval(() => {
      indexRef.current++;
      setDisplayed(text.slice(0, indexRef.current));
      if (indexRef.current >= text.length) clearInterval(timer);
    }, interval);
    return () => clearInterval(timer);
  }, [text, duration]);

  return <>{displayed}<span style={{ opacity: displayed.length < text.length ? 1 : 0 }}>_</span></>;
}

export default function ATCCommsPanel({ messages, onClose }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <div
      style={{
        position: "fixed",
        bottom: 130,
        left: 8,
        zIndex: 200,
        width: 320,
        maxHeight: 260,
        background: "rgba(12, 16, 21, 0.92)",
        border: "1px solid #22d3ee",
        borderRadius: 8,
        fontFamily: "'JetBrains Mono', monospace",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxShadow: "0 4px 24px rgba(34, 211, 238, 0.15)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 10px",
          borderBottom: "1px solid rgba(34, 211, 238, 0.3)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 9, fontWeight: 700, color: "#22d3ee", letterSpacing: 1.5 }}>
          ATC COMMS
        </span>
        <span
          onClick={onClose}
          style={{
            fontSize: 11,
            color: "#484f58",
            cursor: "pointer",
            padding: "1px 6px",
            border: "1px solid #30363d",
            borderRadius: 3,
            lineHeight: 1.4,
          }}
        >
          X
        </span>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: "auto",
          padding: "8px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {messages.map((msg, i) => {
          const isOut = msg.direction === "out";
          return (
            <div
              key={i}
              style={{
                alignSelf: isOut ? "flex-end" : "flex-start",
                maxWidth: "85%",
                fontSize: 10,
                lineHeight: 1.5,
                padding: "5px 8px",
                borderRadius: 6,
                background: isOut ? "rgba(139, 148, 158, 0.12)" : "rgba(34, 211, 238, 0.1)",
                color: isOut ? "#8b949e" : "#22d3ee",
                border: isOut ? "1px solid #30363d" : "1px solid rgba(34, 211, 238, 0.25)",
              }}
            >
              {isOut ? msg.text : <TypewriterText text={msg.text} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
