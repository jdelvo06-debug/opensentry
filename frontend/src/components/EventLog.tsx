import { useEffect, useRef } from "react";
import type { EventEntry } from "../types";

interface Props {
  events: EventEntry[];
}

function getEventColor(message: string): string {
  const lower = message.toLowerCase();
  if (
    lower.includes("engag") ||
    lower.includes("neutraliz") ||
    lower.includes("defeat") ||
    lower.includes("missed") ||
    lower.includes("effective")
  ) {
    return "#f85149";
  }
  if (
    lower.includes("warning") ||
    lower.includes("caution") ||
    lower.includes("unknown") ||
    lower.includes("lost")
  ) {
    return "#d29922";
  }
  if (
    lower.includes("detect") ||
    lower.includes("track") ||
    lower.includes("sensor") ||
    lower.includes("identif")
  ) {
    return "#58a6ff";
  }
  return "#8b949e";
}

export default function EventLog({ events }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [events.length]);

  return (
    <div
      style={{
        gridColumn: "1 / -1",
        height: 120,
        background: "#161b22",
        borderTop: "1px solid #30363d",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Title bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "6px 14px",
          borderBottom: "1px solid #1c2333",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: "#8b949e",
            letterSpacing: 1.5,
          }}
        >
          EVENT LOG
        </span>
        <span
          style={{
            marginLeft: 8,
            fontSize: 9,
            color: "#484f58",
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {events.length} events
        </span>
      </div>

      {/* Scrollable events */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: "auto",
          padding: "4px 14px",
        }}
      >
        {events.length === 0 && (
          <div
            style={{
              color: "#484f58",
              fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace",
              padding: "4px 0",
            }}
          >
            Awaiting mission events...
          </div>
        )}
        {events.map((evt, i) => {
          const color = getEventColor(evt.message);
          return (
            <div
              key={i}
              style={{
                fontSize: 12,
                fontFamily: "'JetBrains Mono', monospace",
                lineHeight: 1.6,
                color: color,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              <span style={{ color: "#484f58" }}>
                [T+{evt.timestamp.toFixed(1)}s]
              </span>{" "}
              {evt.message}
            </div>
          );
        })}
      </div>
    </div>
  );
}
